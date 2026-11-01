/**
 * Ely without a model (no ANTHROPIC_API_KEY, the `agentLlm` flag off, or the
 * model unreachable): a small EN/TR command grammar for the portfolio
 * superpowers, then the language reader (apps/api/src/language) for moves,
 * questions and rules. Same tools, same proposals, same SSE events; every
 * number comes from a tool result.
 */
import { goalsToActions } from "../../engine/planner/goals.js";
import type { GoalItem, IntentActionSpec } from "@elyia/core";
import type { Insight } from "@elyia/core/api/agent";
import type { ReadResult } from "../../language/index.js";
import { readSentenceFor } from "../intents/language.js";
import type { AppContext } from "../../context.js";
import { isElyiaHttpError } from "../../http/errors.js";
import { insightsFor } from "./proposals.js";
import { runAgentTool, type ToolContext } from "./tools.js";

type Locale = "en" | "tr";

interface Command {
  readonly id: "exposure" | "insights" | "protect" | "guard" | "rebalance" | "pnl" | "shock" | "gas" | "dust" | "idle" | "funding" | "portfolio" | "help";
  readonly underlying?: string;
  readonly movePct?: number;
}

const SYMBOL = /\b(HYPE|BTC|ETH|SOL|USDC|USD|KHYPE|PURR)\b/iu;

/** The fixed grammar (checked before the language reader). */
export function commandOf(text: string): Command | null {
  const lower = text.toLowerCase();
  const symbol = SYMBOL.exec(text)?.[1]?.toUpperCase();
  // "20%" (English) or "%20" (Turkish).
  const shockMatch = /(?:%\s*(\d{1,2}(?:\.\d+)?)|(-?\+?\d{1,2}(?:\.\d+)?)\s*%)/u.exec(text);
  const shock = shockMatch ? [shockMatch[0], shockMatch[1] ?? shockMatch[2]] : null;
  if (/(what if|what-if|ya .*(düşerse|düserse|çökerse|yükselirse)|(drops?|falls?|crash(es)?|dumps?|pumps?|rises?) .*%|%.*(düşerse|düserse))/iu.test(text) && shock && symbol) {
    const value = Number(shock[1]);
    const down = /(drop|fall|crash|dump|düş|dus|çök)/iu.test(lower);
    return { id: "shock", underlying: symbol, movePct: down ? -Math.abs(value) : value };
  }
  if (/\b(exposure|exposed|maruz|pozisyonum ne kadar)\b/iu.test(text)) return { id: "exposure", ...(symbol ? { underlying: symbol } : {}) };
  if (/(liquidat|tasfiye)/iu.test(lower)) return { id: "guard" };
  if (/\b(protect|stop ?loss|koru|stop koy)\b/iu.test(lower)) return { id: "protect" };
  if (/(rebalanc|dengele)/iu.test(lower)) return { id: "rebalance" };
  if (/(explain .*pnl|my pnl|pnl|kâr|kar zarar|kâr\/zarar)/iu.test(lower)) return { id: "pnl" };
  if (/\b(gas|gaz)\b/iu.test(lower)) return { id: "gas" };
  if (/\b(dust|kırıntı|kirinti|küçük bakiye)\b/iu.test(lower)) return { id: "dust" };
  if (/\b(idle|boşta|bosta|yield|getiri)\b/iu.test(lower)) return { id: "idle" };
  if (/\b(funding|fonlama)\b/iu.test(lower) && /\b(harvest|carry|topla|hasat)\b/iu.test(lower)) return { id: "funding" };
  if (/\b(insight|ideas|what should i|ne yapmalıyım|öneri)/iu.test(lower)) return { id: "insights" };
  if (/^\s*(help|yardım|yardim)\s*\??\s*$/iu.test(lower)) return { id: "help" };
  return null;
}

const T = {
  help: {
    en: "I can read your portfolio across HyperCore, HyperEVM and Elysium, protect positions, rebalance, explain your PnL, run what-if shocks, and plan moves you sign. Try: \"what's my HYPE exposure?\", \"protect my positions\", \"what if HYPE drops 20%?\", \"swap 1 HYPE to USDC on Elysium\".",
    tr: "Portföyünü HyperCore, HyperEVM ve Elysium genelinde okuyabilir, pozisyonlarını koruyabilir, yeniden dengeleyebilir, kâr/zararını açıklayabilir, senaryo şokları çalıştırabilir ve imzalayacağın hamleleri planlayabilirim. Dene: \"HYPE maruziyetim ne?\", \"pozisyonlarımı koru\", \"HYPE %20 düşerse?\", \"Elysium'da 1 HYPE'ı USDC'ye çevir\".",
  },
  none: { en: "Nothing to flag right now.", tr: "Şu an işaretlenecek bir şey yok." },
  unreadable: { en: "I could not read that as a move or a question. Ask \"help\" for examples.", tr: "Bunu bir hamle ya da soru olarak okuyamadım. Örnekler için \"yardım\" yaz." },
  proposed: { en: "Proposed: waiting for your signature.", tr: "Önerildi: imzanı bekliyor." },
  signIn: { en: "Sign in with this wallet to turn this into a proposal you can sign.", tr: "Bunu imzalanabilir bir öneriye çevirmek için bu cüzdanla giriş yap." },
} as const;

function money(value: number): string {
  return `$${(Math.round(value * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface DeterministicInput {
  readonly ctx: AppContext;
  readonly message: string;
  readonly locale: Locale;
  readonly tools: ToolContext;
  readonly emit: (event: string, data: unknown) => void;
  /** A reading already made for this message (clarify answers applied). */
  readonly reading?: ReadResult;
}

async function call(input: DeterministicInput, name: string, args: unknown): Promise<{ ok: boolean; data: unknown }> {
  const id = `det_${name}_${Math.random().toString(16).slice(2, 8)}`;
  input.emit("tool_call", { id, name, input: args });
  const outcome = await runAgentTool(name, args, input.tools);
  input.emit("tool_result", { id, name, ok: outcome.ok, summary: outcome.summary });
  const parsed = JSON.parse(outcome.content) as { ok: boolean; data?: unknown; message?: string };
  return { ok: parsed.ok, data: parsed.ok ? parsed.data : parsed.message };
}

async function propose(input: DeterministicInput, title: string, explanation: string, actions: readonly IntentActionSpec[]): Promise<string> {
  if (actions.length === 0) return "";
  if (input.tools.address !== input.tools.owner) {
    const plan = await call(input, "plan_intent", { actions });
    return plan.ok ? `\n${T.signIn[input.locale]}` : `\n${String(plan.data)}`;
  }
  const result = await call(input, "propose_intent", { title, explanation, actions });
  const data = result.data as { planError?: { message: string } | null } | string;
  if (!result.ok) return `\n${String(data)}`;
  return typeof data === "object" && data.planError ? `\n${data.planError.message}` : `\n${T.proposed[input.locale]}`;
}

function insightText(insight: Insight, locale: Locale): string {
  return `${insight.title[locale]}: ${insight.explanation[locale]}`;
}

async function fromInsights(input: DeterministicInput, kinds: readonly Insight["kind"][]): Promise<string> {
  const id = `det_get_insights_${Math.random().toString(16).slice(2, 8)}`;
  input.emit("tool_call", { id, name: "get_insights", input: {} });
  let found: Insight[];
  try {
    found = (await insightsFor(input.ctx, input.tools.address)).insights.filter((insight) => kinds.includes(insight.kind));
    input.emit("tool_result", { id, name: "get_insights", ok: true, summary: `${found.length} insights` });
  } catch (error) {
    input.emit("tool_result", { id, name: "get_insights", ok: false, summary: "failed" });
    return isElyiaHttpError(error) && error.status < 500 ? error.message : input.locale === "tr" ? "Portföy şu an okunamadı." : "The portfolio could not be read right now.";
  }
  if (found.length === 0) return T.none[input.locale];
  const parts: string[] = [];
  for (const insight of found.slice(0, 4)) {
    parts.push(`• ${insightText(insight, input.locale)}`);
    if (insight.actions.length > 0 && !insight.paper) parts.push((await propose(input, insight.title.en, insight.explanation.en, insight.actions)).trim());
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * The plannable goals (value moves and trades) of a reading, with chain
 * links (`chain.after`, an index into the whole reading) re-pointed at the
 * filtered list, so "bridge … and swap half" stays one chained plan even
 * when a question or a rule sits between the moves.
 */
export function movesOf(goals: readonly GoalItem[]): GoalItem[] {
  const kept: number[] = [];
  goals.forEach((goal, index) => {
    if (goal.t === "value" || goal.t === "trade") kept.push(index);
  });
  return kept.map((index) => {
    const item = goals[index] as GoalItem;
    if (item.t !== "value" || item.goal.chain === undefined) return item;
    const parent = kept.indexOf(item.goal.chain.after);
    if (parent < 0) {
      const { chain: _dropped, ...rest } = item.goal;
      return { ...item, goal: rest } as GoalItem;
    }
    return { ...item, goal: { ...item.goal, chain: { ...item.goal.chain, after: parent } } } as GoalItem;
  });
}

export interface DeterministicResult {
  readonly text: string;
  /** The reader's reading when the turn ends asking (its questions become a `clarify` event). */
  readonly clarify?: ReadResult;
}

export async function runDeterministicTurn(input: DeterministicInput): Promise<DeterministicResult> {
  const { locale } = input;
  const command = commandOf(input.message);
  let text: string;
  if (command) {
    switch (command.id) {
      case "help":
        text = T.help[locale];
        break;
      case "exposure": {
        const result = await call(input, "get_portfolio", {});
        if (!result.ok) {
          text = String(result.data);
          break;
        }
        const snap = result.data as { netWorthUsd: number; priceLabel: string; exposure: Array<{ underlying: string; net: number; netUsd: number | null; perp: number; spot: number; isCash: boolean }> };
        const rows = command.underlying ? snap.exposure.filter((row) => row.underlying === (command.underlying === "KHYPE" ? "HYPE" : command.underlying)) : snap.exposure.slice(0, 5);
        if (rows.length === 0) {
          text = locale === "tr" ? `${command.underlying ?? ""} maruziyetin yok. Net değer ${money(snap.netWorthUsd)} (${snap.priceLabel}).` : `No ${command.underlying ?? ""} exposure. Net worth ${money(snap.netWorthUsd)} (${snap.priceLabel} prices).`;
          break;
        }
        const lines = rows.map((row) => {
          const share = snap.netWorthUsd > 0 && row.netUsd !== null ? ` (${Math.round((row.netUsd / snap.netWorthUsd) * 1000) / 10}%)` : "";
          return locale === "tr"
            ? `${row.underlying}: net ${row.net} (spot ${row.spot}, perp ${row.perp}) = ${row.netUsd === null ? "fiyatsız" : money(row.netUsd)}${share}`
            : `${row.underlying}: net ${row.net} (spot ${row.spot}, perp ${row.perp}) = ${row.netUsd === null ? "unpriced" : money(row.netUsd)}${share}`;
        });
        text = `${lines.join("\n")}\n${locale === "tr" ? `Net değer ${money(snap.netWorthUsd)} (${snap.priceLabel} fiyatları).` : `Net worth ${money(snap.netWorthUsd)} (${snap.priceLabel} prices).`}`;
        break;
      }
      case "shock": {
        const result = await call(input, "simulate_shock", { underlying: command.underlying, movePct: command.movePct });
        const data = result.data as { pnlUsd?: number; netWorthAfterUsd?: number; liquidated?: string[]; note?: string };
        text = !result.ok
          ? String(result.data)
          : data.note
            ? data.note
            : locale === "tr"
              ? `${command.underlying} %${Math.abs(command.movePct ?? 0)} ${(command.movePct ?? 0) < 0 ? "düşerse" : "yükselirse"}: ${money(data.pnlUsd ?? 0)}, net değer ${money(data.netWorthAfterUsd ?? 0)}. ${data.liquidated && data.liquidated.length > 0 ? `Tasfiye: ${data.liquidated.join(", ")}.` : "Tasfiye yok."}`
              : `If ${command.underlying} moves ${command.movePct}%: ${money(data.pnlUsd ?? 0)}, net worth ${money(data.netWorthAfterUsd ?? 0)}. ${data.liquidated && data.liquidated.length > 0 ? `Liquidated: ${data.liquidated.join(", ")}.` : "No liquidation."}`;
        break;
      }
      case "insights":
      case "portfolio":
        text = await fromInsights(input, ["liquidation-guard", "auto-protect", "rebalance", "gas-top-up", "idle-cash", "dust-sweep", "funding-harvest", "what-if", "explain-pnl"]);
        break;
      case "protect":
        text = await fromInsights(input, ["auto-protect"]);
        break;
      case "guard":
        text = await fromInsights(input, ["liquidation-guard", "auto-protect"]);
        break;
      case "rebalance":
        text = await fromInsights(input, ["rebalance"]);
        if (text === T.none[locale]) text = locale === "tr" ? "Hedef karışım yok ya da bant içindesin. Hedefi söyle: \"hedef HYPE %50 USD %50\"." : "No target mix set, or you are inside the band. Tell me one: \"target HYPE 50% USD 50%\".";
        break;
      case "pnl":
        text = await fromInsights(input, ["explain-pnl"]);
        break;
      case "gas":
        text = await fromInsights(input, ["gas-top-up"]);
        break;
      case "dust":
        text = await fromInsights(input, ["dust-sweep"]);
        break;
      case "idle":
        text = await fromInsights(input, ["idle-cash"]);
        break;
      case "funding":
        text = await fromInsights(input, ["funding-harvest"]);
        break;
    }
    return { text };
  }

  const reading = input.reading ?? (await readSentenceFor(input.ctx, { text: input.message, locale, account: input.tools.address }));
  if (reading.status === "needs_input") return { text: reading.questions.map((question) => question.prompt).join("\n"), clarify: reading };
  if (reading.status !== "ready") return { text: reading.unsupported ?? T.unreadable[locale] };
  const goals = reading.goals as unknown as Array<{ t: string; goal?: { what?: string; subject?: { symbol?: string; coin?: string } } }>;
  const queries = goals.filter((goal) => goal.t === "query");
  const rules = goals.filter((goal) => goal.t === "rule");
  const moves = movesOf(reading.goals as unknown as GoalItem[]);
  const parts: string[] = [];
  for (const query of queries) {
    const what = query.goal?.what;
    const coin = query.goal?.subject?.coin ?? query.goal?.subject?.symbol;
    if ((what === "price" || what === "funding") && coin) {
      const result = await call(input, "get_market", { coin });
      const data = result.data as { coin: string; markPx: string | null; fundingAprPct: number | null };
      parts.push(result.ok ? `${data.coin}: ${data.markPx ?? "?"}${what === "funding" ? `, funding ${data.fundingAprPct ?? "?"}% APR` : ""}` : String(result.data));
    } else {
      parts.push(await fromInsights(input, ["liquidation-guard", "auto-protect", "what-if", "explain-pnl"]));
    }
  }
  if (rules.length > 0) {
    parts.push(locale === "tr" ? "Bu bir kural: Uyarılar veya Otomasyonlar bölümünden onayla." : "That is a rule: confirm it under Alerts or Automations.");
    input.tools.drafts.push({ kind: "alert", body: rules });
  }
  if (moves.length > 0) {
    const actions = goalsToActions(moves, input.ctx.config.mode);
    parts.push((await propose(input, reading.canonical ?? input.message.slice(0, 100), reading.canonical ?? input.message, actions)).trim());
  }
  return { text: parts.filter(Boolean).join("\n") || T.unreadable[locale] };
}
