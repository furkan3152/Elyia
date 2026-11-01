/**
 * The Elyia Telegram bot (grammY 1.46).
 *
 * - No TELEGRAM_BOT_TOKEN: everything else works; the bot reports "not
 *   configured" (GET /v1/telegram/status, /v1/health features).
 * - Production with TELEGRAM_WEBHOOK_SECRET: webhook at POST
 *   /telegram/webhook (own 64 KB JSON parser, secret header checked by
 *   grammY); `setWebhook` is called when TELEGRAM_WEBHOOK_URL is set.
 *   Otherwise (development) long polling. Never both.
 * - Commands: /start [code], /help, /portfolio, /positions, /alerts,
 *   /price <coin>, /agent <question>, /link; replies in English or Turkish
 *   by the user's language. HTML replies, every value escaped.
 * - Rate limits: one message per chat per second, 25 per second overall
 *   (an outgoing transformer queues sends).
 * - Data comes from in-process calls (portfolio, markets, alerts, Ely).
 * - Alert firings and keeper actions are delivered to the linked chat.
 */
import { Bot, webhookCallback, type Context, type Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import express, { type Express } from "express";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { chatTurn } from "../agent/chat.js";
import { marketRow, snapshot } from "../agent/perception.js";
import { webOrigin } from "../developers/mcp/tools.js";
import { listAlerts } from "./alerts.js";
import { linkOfAddress, linkOfChat, redeemLinkCode } from "./auth/telegram.js";

type Lang = "en" | "tr";

export function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function langOf(code: string | undefined): Lang {
  return code?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

const TEXT = {
  notLinked: { en: "This chat is not linked to a wallet yet. Sign in on Elyia, tap <b>Link Telegram</b>, then open the link.", tr: "Bu sohbet henüz bir cüzdana bağlı değil. Elyia'da giriş yap, <b>Telegram'ı bağla</b>'ya dokun ve bağlantıyı aç." },
  linked: { en: "Linked to <code>{address}</code>. Try /portfolio or /agent what's my exposure?", tr: "<code>{address}</code> cüzdanına bağlandı. /portfolio ya da /agent maruziyetim ne? dene." },
  badCode: { en: "That link code is unknown or already used. Create a new one in the app.", tr: "Bu bağlantı kodu bilinmiyor ya da kullanılmış. Uygulamada yenisini oluştur." },
  welcome: { en: "Hi, I'm Ely. I watch your HyperCore, HyperEVM and Elysium accounts. I never hold your keys: every move is signed in your wallet.", tr: "Merhaba, ben Ely. HyperCore, HyperEVM ve Elysium hesaplarını izlerim. Anahtarlarını asla tutmam: her hamle cüzdanında imzalanır." },
  help: {
    en: "/portfolio net worth and layers\n/positions perp positions and liquidation distance\n/alerts your alerts\n/price BTC a market price\n/agent &lt;question&gt; ask Ely\n/link link this chat",
    tr: "/portfolio net değer ve katmanlar\n/positions perp pozisyonlar ve tasfiye mesafesi\n/alerts uyarıların\n/price BTC piyasa fiyatı\n/agent &lt;soru&gt; Ely'ye sor\n/link bu sohbeti bağla",
  },
  noPositions: { en: "No open perp positions.", tr: "Açık perp pozisyonu yok." },
  noAlerts: { en: "No alerts. Create them in the app or ask /agent.", tr: "Uyarı yok. Uygulamada oluştur ya da /agent'a sor." },
  failed: { en: "That did not work right now. Try again shortly.", tr: "Şu an olmadı. Biraz sonra tekrar dene." },
  priceUsage: { en: "Usage: /price BTC", tr: "Kullanım: /price BTC" },
  agentUsage: { en: "Usage: /agent what's my HYPE exposure?", tr: "Kullanım: /agent HYPE maruziyetim ne?" },
} as const;

function t(key: keyof typeof TEXT, lang: Lang, vars: Record<string, string> = {}): string {
  return Object.entries(vars).reduce<string>((text, [name, value]) => text.replace(`{${name}}`, escapeHtml(value)), TEXT[key][lang]);
}

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Outgoing limits: 1 message/s per chat, 25/s overall. */
export function rateLimiter(now: () => number = Date.now): Transformer {
  const perChat = new Map<string, number>();
  let windowStart = 0;
  let windowCount = 0;
  return async (prev, method, payload, signal) => {
    if (method === "sendMessage" || method === "editMessageText") {
      const chat = String((payload as { chat_id?: unknown }).chat_id ?? "");
      for (;;) {
        const at = now();
        if (at - windowStart >= 1_000) {
          windowStart = at;
          windowCount = 0;
        }
        const wait = Math.max(0, (perChat.get(chat) ?? 0) + 1_000 - at, windowCount >= 25 ? windowStart + 1_000 - at : 0);
        if (wait === 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 1_000)));
      }
      perChat.set(chat, now());
      windowCount += 1;
      if (perChat.size > 10_000) perChat.delete(perChat.keys().next().value as string);
    }
    return prev(method, payload, signal);
  };
}

export interface BotOptions {
  readonly botInfo?: UserFromGetMe;
  /** Extra transformers (tests capture outgoing calls). */
  readonly transformers?: readonly Transformer[];
  readonly limiterClock?: () => number;
}

export function createBot(ctx: AppContext, options: BotOptions = {}): Bot {
  const token = ctx.config.telegram.botToken;
  if (!token) throw new ElyiaHttpError("TELEGRAM_NOT_CONFIGURED", 503, "The Telegram bot is not configured.");
  const bot = new Bot(token, options.botInfo ? { botInfo: options.botInfo } : {});
  for (const transformer of options.transformers ?? []) bot.api.config.use(transformer);
  bot.api.config.use(rateLimiter(options.limiterClock));
  const reply = (c: Context, html: string) => c.reply(html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  const openButton = { reply_markup: { inline_keyboard: [[{ text: "Open Elyia", web_app: { url: `${webOrigin(ctx)}/tg` } }]] } };

  const linked = async (c: Context): Promise<string | null> => {
    const chatId = c.chat?.id;
    if (chatId === undefined) return null;
    return (await linkOfChat(ctx, chatId))?.address ?? null;
  };

  bot.command("start", async (c) => {
    const lang = langOf(c.from?.language_code);
    const code = typeof c.match === "string" ? c.match.trim() : "";
    if (code && c.chat && c.from) {
      const link = await redeemLinkCode(ctx, code, { chatId: c.chat.id, userId: c.from.id, languageCode: c.from.language_code ?? null });
      await reply(c, link ? t("linked", lang, { address: link.address }) : t("badCode", lang));
      return;
    }
    await c.reply(`${t("welcome", lang)}\n\n${t("help", lang)}`, { parse_mode: "HTML", ...(webOrigin(ctx).startsWith("https://") ? openButton : {}) });
  });

  bot.command(["help", "yardim"], async (c) => reply(c, t("help", langOf(c.from?.language_code))));
  bot.command("link", async (c) => reply(c, t("notLinked", langOf(c.from?.language_code))));

  bot.command(["portfolio", "portfoy"], async (c) => {
    const lang = langOf(c.from?.language_code);
    const address = await linked(c);
    if (!address) return void (await reply(c, t("notLinked", lang)));
    try {
      const snap = await snapshot(ctx, address);
      const layers = snap.layers.map((layer) => `${escapeHtml(layer.layer)}: ${usd(layer.totalUsd)}${layer.unpricedLines ? ` (+${layer.unpricedLines} ${lang === "tr" ? "fiyatsız" : "unpriced"})` : ""}`).join("\n");
      const label = snap.pricing.label === "reference" ? (lang === "tr" ? "referans fiyatlar" : "reference prices") : lang === "tr" ? "piyasa fiyatları" : "market prices";
      await reply(c, `<b>${lang === "tr" ? "Net değer" : "Net worth"}: ${usd(snap.totals.netWorthUsd)}</b> (${label})\n${layers}\n${lang === "tr" ? "Gerçekleşmemiş" : "Unrealized"}: ${usd(snap.totals.unrealizedPnlUsd)}`);
    } catch {
      await reply(c, t("failed", lang));
    }
  });

  bot.command(["positions", "pozisyonlar"], async (c) => {
    const lang = langOf(c.from?.language_code);
    const address = await linked(c);
    if (!address) return void (await reply(c, t("notLinked", lang)));
    try {
      const snap = await snapshot(ctx, address);
      if (snap.positions.length === 0) return void (await reply(c, t("noPositions", lang)));
      const rows = snap.positions.map((position) => `<b>${escapeHtml(position.coin)}</b> ${position.side} ${escapeHtml(position.size)} @ ${escapeHtml(position.entryPx)} · PnL ${usd(position.unrealizedPnl)} · ${lang === "tr" ? "ip" : "rope"} ${position.liquidationDistancePct === null ? "∞" : `${position.liquidationDistancePct}%`} (${position.liquidationRisk})`);
      await reply(c, rows.join("\n"));
    } catch {
      await reply(c, t("failed", lang));
    }
  });

  bot.command(["alerts", "uyarilar"], async (c) => {
    const lang = langOf(c.from?.language_code);
    const address = await linked(c);
    if (!address) return void (await reply(c, t("notLinked", lang)));
    const list = await listAlerts(ctx, address);
    if (list.length === 0) return void (await reply(c, t("noAlerts", lang)));
    await reply(c, list.slice(0, 20).map((alert) => `${alert.enabled ? "●" : "○"} ${escapeHtml(alert.kind)} ${escapeHtml(alert.coin ?? "")} ${escapeHtml(alert.threshold ?? "")}`).join("\n"));
  });

  bot.command(["price", "fiyat"], async (c) => {
    const lang = langOf(c.from?.language_code);
    const coin = (typeof c.match === "string" ? c.match : "").trim().toUpperCase();
    if (!coin || !/^[A-Z0-9:/@]{1,30}$/u.test(coin)) return void (await reply(c, t("priceUsage", lang)));
    try {
      const row = await marketRow(ctx, coin);
      await reply(c, `<b>${escapeHtml(row.displayName)}</b> ${escapeHtml(row.markPx ?? "?")}${row.change24hPct !== null ? ` (${row.change24hPct > 0 ? "+" : ""}${row.change24hPct}% 24h)` : ""}${row.fundingAprPct !== null ? ` · funding ${row.fundingAprPct}% APR` : ""}${ctx.config.mode === "testnet" ? (lang === "tr" ? "\n<i>Testnet fiyatı (gerçek piyasa değil)</i>" : "\n<i>Testnet price (not the real market)</i>") : ""}`);
    } catch {
      await reply(c, t("failed", lang));
    }
  });

  bot.command(["agent", "ely"], async (c) => {
    const lang = langOf(c.from?.language_code);
    const question = (typeof c.match === "string" ? c.match : "").trim();
    if (!question) return void (await reply(c, t("agentUsage", lang)));
    const address = await linked(c);
    if (!address) return void (await reply(c, t("notLinked", lang)));
    try {
      // Proposals made here are signed in the app (the bot never signs).
      const done = await chatTurn({ ctx, owner: address, address, message: question.slice(0, 1_000), threadId: null, locale: lang, integratorFee: null, emit: () => undefined });
      const extra = done.proposals.length > 0 ? (lang === "tr" ? `\n\n${done.proposals.length} öneri imzanı bekliyor: uygulamada aç.` : `\n\n${done.proposals.length} proposal(s) wait for your signature: open the app.`) : "";
      await reply(c, `${escapeHtml(done.text.slice(0, 3_500))}${extra}`);
    } catch {
      await reply(c, t("failed", lang));
    }
  });

  bot.catch((error) => ctx.log.warn("telegram update failed", { error: error.message.slice(0, 160) }));
  return bot;
}

/* --------------------------------------------------------------- runtime */

interface BotRuntime {
  readonly bot: Bot;
  readonly mode: "webhook" | "polling";
  readonly unsubscribe: Array<() => void>;
}

const runtimes = new WeakMap<AppContext, BotRuntime>();

export function botMode(ctx: AppContext): "webhook" | "polling" | "off" {
  if (!ctx.config.telegram.botToken) return "off";
  return ctx.config.env === "production" && ctx.config.telegram.webhookSecret ? "webhook" : ctx.config.env === "test" ? "off" : "polling";
}

/** POST /telegram/webhook (outside /v1, own body parser). */
export function mountTelegramWebhook(app: Express, ctx: AppContext): void {
  if (botMode(ctx) !== "webhook") return;
  const bot = createBot(ctx);
  runtimes.set(ctx, { bot, mode: "webhook", unsubscribe: [] });
  app.post("/telegram/webhook", express.json({ limit: "64kb" }), webhookCallback(bot, "express", { secretToken: ctx.config.telegram.webhookSecret as string }));
}

/** Delivers alert firings and agent actions to linked chats. */
export function wireDeliveries(ctx: AppContext, bot: Bot): Array<() => void> {
  const send = async (owner: string, html: string) => {
    const link = await linkOfAddress(ctx, owner);
    if (link) await bot.api.sendMessage(link.chatId, html, { parse_mode: "HTML" });
  };
  return [
    ctx.bus.on("ops.alert.delivery", ({ firing }) => {
      void linkOfAddress(ctx, firing.owner)
        .then((link) => (link ? bot.api.sendMessage(link.chatId, `🔔 ${escapeHtml(firing.message[langOf(link.languageCode ?? undefined)])}`, { parse_mode: "HTML" }) : null))
        .catch(() => undefined);
    }),
    ctx.bus.on("agent.action", ({ owner, text, ok }) => {
      void send(owner, `${ok ? "🐐" : "⚠️"} ${escapeHtml(text.en)}`).catch(() => undefined);
    }),
  ];
}

export async function startBot(ctx: AppContext): Promise<void> {
  const mode = botMode(ctx);
  if (mode === "off") return;
  let runtime = runtimes.get(ctx);
  if (!runtime) {
    runtime = { bot: createBot(ctx), mode: "polling", unsubscribe: [] };
    runtimes.set(ctx, runtime);
  }
  runtime.unsubscribe.push(...wireDeliveries(ctx, runtime.bot));
  if (runtime.mode === "webhook") {
    if (ctx.config.telegram.webhookUrl) await runtime.bot.api.setWebhook(ctx.config.telegram.webhookUrl, { secret_token: ctx.config.telegram.webhookSecret as string, allowed_updates: ["message", "callback_query"] }).catch((error: unknown) => ctx.log.warn("telegram setWebhook failed", { error: error instanceof Error ? error.message.slice(0, 120) : String(error) }));
    return;
  }
  // Long polling (development): one poller, never alongside a webhook.
  await runtime.bot.api.deleteWebhook().catch(() => undefined);
  void runtime.bot.start({ drop_pending_updates: true, allowed_updates: ["message", "callback_query"] }).catch((error: unknown) => ctx.log.warn("telegram polling stopped", { error: error instanceof Error ? error.message.slice(0, 120) : String(error) }));
}

export async function stopBot(ctx: AppContext): Promise<void> {
  const runtime = runtimes.get(ctx);
  if (!runtime) return;
  for (const off of runtime.unsubscribe.splice(0)) off();
  if (runtime.mode === "polling") await runtime.bot.stop().catch(() => undefined);
  runtimes.delete(ctx);
}
