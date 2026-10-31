/**
 * Automations: schedules ("every day", "her gün"), conditions ("if HYPE drops
 * below 60", "HYPE 60'ın altına düşerse", "if ETH funding > 0.05%"), alerts,
 * and the hard limits every rule carries. A rule that adds risk or moves
 * value without a per-run cap is not armed: the cap is derived from the
 * body when the size is in USD (or a reference price is known), else asked.
 */
import type { Condition, ConditionMetric, ConditionOp, GoalItem, LanguageGoal, MarketSel, Rule, RuleLimits, Schedule } from "@elyia/core";
import { isDerisking } from "@elyia/core";
import { t } from "../clarify.js";
import { marketsFor } from "../entities.js";
import { readNumber } from "../numbers.js";
import type { Tok, TokOf } from "../types.js";
import { ask, Bag, parseAmountAnswer, specOf, type FrameCtx } from "./common.js";

const TIMEZONES = ["UTC", "Europe/Istanbul", "Europe/London", "America/New_York", "Asia/Singapore"] as const;

export function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The schedule tokens of a sentence (taken from the bag). */
export function scheduleOf(bag: Bag, ctx: FrameCtx): Schedule | null | "none" {
  const sched = bag.take("sched");
  if (!sched) return "none";
  const clock = bag.take("clock");
  bag.take("prep", (tok) => tok.role === "at");
  const schedule: { t: "every"; seconds: number; weekdays?: readonly number[]; at?: { hour: number; minute: number; tz: string } } = { t: "every", seconds: sched.seconds, ...(sched.weekdays ? { weekdays: sched.weekdays } : {}) };
  if (clock) {
    let tz = clock.tz ?? ctx.facts.timezone;
    if (!tz) {
      const spec = specOf(ctx, "timezone", "TIMEZONE_MISSING", {
        prompt: t(`${pad(clock.hour)}:${pad(clock.minute)} in which time zone?`, `${pad(clock.hour)}:${pad(clock.minute)} hangi saat diliminde?`),
        options: TIMEZONES.map((zone) => ({ id: zone, en: zone, tr: zone })),
        allowsText: true,
        placeholder: t("IANA zone, e.g. Europe/Istanbul", "IANA dilimi, örn. Europe/Istanbul"),
      });
      const answer = ctx.clar.ask(spec);
      const zone = answer?.option ?? answer?.text;
      if (zone && !validTimezone(zone)) ctx.clar.reject(spec, t("That is not a time zone name.", "Bu bir saat dilimi adı değil."));
      else tz = zone ?? undefined;
    }
    if (tz) schedule.at = { hour: clock.hour, minute: clock.minute, tz };
    else return null;
  }
  return schedule;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const OP_WORD: Readonly<Record<string, ConditionOp>> = Object.freeze({ "<": "<", "<=": "<=", ">": ">", ">=": ">=", crossesAbove: "crossesAbove", crossesBelow: "crossesBelow" });

/** Reads one condition; null when a question was asked or nothing could be read. */
export function readCondition(tokens: readonly Tok[], ctx: FrameCtx): { condition?: Condition; unreadable?: { en: string; tr: string } } {
  const bag = new Bag(tokens);
  bag.take("cond");
  const metricTok = bag.take("metric");
  let metric: ConditionMetric = metricTok?.metric ?? "price";
  const positionTok = bag.take("scope", (tok) => tok.what === "position");
  const sideTok = bag.take("side");
  let subject: Condition["subject"] | undefined;
  const market = bag.take("market");
  const asset = market ? null : bag.take("asset", (tok) => tok.role !== "worth");
  const coin = market?.coin ?? asset?.symbol;
  if (coin) {
    const facts = marketsFor(ctx.facts.markets, coin);
    const perp = facts.find((fact) => fact.kind === "perp" && !fact.dex) ?? facts.find((fact) => fact.kind === "perp");
    const spot = facts.find((fact) => fact.kind === "spot");
    const sel: MarketSel | undefined = market?.dex
      ? { coin: market.coin, kind: "perp", dex: market.dex }
      : perp
        ? { coin: perp.coin, kind: "perp", ...(perp.dex ? { dex: perp.dex } : {}) }
        : spot
          ? { coin: spot.coin, kind: "spot" }
          : undefined;
    if (positionTok || sideTok || metric === "pnl" || metric === "roe" || metric === "liqDistance") {
      if (!sel) return { unreadable: t(`${coin} is not a HyperCore market.`, `${coin} bir HyperCore piyasası değil.`) };
      subject = { position: sel };
    } else if (sel) subject = sel;
    else subject = { symbol: coin };
  }
  // Comparison: an operator word, a Turkish conditional verb, or "over".
  const cmp = bag.take("cmp");
  const condEnd = bag.take("condEnd");
  const over = cmp ? null : bag.take("prep", (tok) => tok.role === "over");
  let op: ConditionOp | "=" | undefined = cmp ? (cmp.op === "neg" ? "<" : cmp.op === "pos" ? ">" : cmp.op === "=" ? "=" : OP_WORD[cmp.op]) : over ? ">" : undefined;
  if ((!op || op === "=") && condEnd?.op) op = condEnd.op === "=" ? (op ?? "=") : condEnd.op;
  const signed = cmp && (cmp.op === "neg" || cmp.op === "pos");
  const num = signed ? null : bag.take("num");
  bag.take("usd");
  const periodTok = bag.take("period");
  if (!subject) return { unreadable: t("Say what to watch (for example HYPE price).", "Neyin izleneceğini yazın (örneğin HYPE fiyatı).") };
  if (!op) return { unreadable: t("Say above or below.", "Üstünde mi altında mı, yazın.") };
  if (!num && !signed) return { unreadable: t("Say the level to watch.", "İzlenecek seviyeyi yazın.") };
  if (num?.ambiguous) return { unreadable: t(`Write ${tokText(num)} without a separator, or with a dot for decimals.`, `${tokText(num)} değerini ayraçsız yazın.`) };
  let value = signed ? "0" : (num as TokOf<"num">).value;
  if (num?.neg) value = `-${value}`;
  if (metric === "price" && num?.pct) {
    return { unreadable: t("Price conditions take a price; for a move in percent, give the level.", "Fiyat koşulu bir fiyat ister; yüzde yerine seviyeyi yazın.") };
  }
  if (metric === "pnl" && num?.pct) metric = "roe";
  const unit: Condition["unit"] = metric === "funding" || metric === "roe" || metric === "liqDistance" || metric === "apy" ? "pct" : metric === "healthFactor" ? "ratio" : "usd";
  if (op === "=") {
    const px = coin ? ctx.facts.prices?.[coin.toUpperCase()] : undefined;
    if (px && metric === "price") {
      op = Number(value) >= Number(px) ? "crossesAbove" : "crossesBelow";
      ctx.clar.assume(ctx.goal, "trigger", op === "crossesAbove" ? t(`when it rises to ${value} (reference price now ${px})`, `${value} seviyesine yükselince (referans fiyat şu an ${px})`) : t(`when it falls to ${value} (reference price now ${px})`, `${value} seviyesine düşünce (referans fiyat şu an ${px})`), true);
    } else {
      const answer = ask(ctx, "trigger", "TRIGGER_AMBIGUOUS", {
        prompt: t(`When it rises to ${value}, or when it falls to ${value}?`, `${value} seviyesine yükselince mi, düşünce mi?`),
        options: [{ id: "crossesAbove", en: `Rises to ${value}`, tr: `${value} seviyesine yükselince` }, { id: "crossesBelow", en: `Falls to ${value}`, tr: `${value} seviyesine düşünce` }],
      });
      if (!answer?.option) return {};
      op = answer.option as ConditionOp;
    }
  }
  let period: Condition["period"] | undefined = periodTok?.period;
  if (metric === "funding" && !period) {
    const answer = ask(ctx, "funding.period", "FUNDING_PERIOD_AMBIGUOUS", {
      prompt: t(`${value}% funding per hour (how HyperCore quotes it), per 8 hours, or a yearly rate?`, `%${value} fonlama saatlik mi (HyperCore böyle verir), 8 saatlik mi, yıllık mı?`),
      options: [{ id: "1h", en: "Per hour", tr: "Saatlik" }, { id: "8h", en: "Per 8 hours", tr: "8 saatlik" }, { id: "apr", en: "Yearly (APR)", tr: "Yıllık (APR)" }],
    });
    if (!answer?.option) return {};
    period = answer.option as Condition["period"];
  }
  const leftovers = bag.leftovers();
  if (leftovers.length > 0) return { unreadable: t(`I could not read "${tokText(leftovers[0] as Tok)}" in the condition.`, `Koşuldaki "${tokText(leftovers[0] as Tok)}" okunamadı.`) };
  return { condition: { metric, subject, op: op as ConditionOp, value, unit, ...(period ? { period } : {}) } };
}

function tokText(tok: Tok): string {
  if (tok.k === "unknown") return tok.raw;
  if (tok.k === "num") return tok.value;
  if (tok.k === "asset") return tok.symbol;
  return tok.k;
}

/* --------------------------------------------------------------- limits */

export interface LimitTokens {
  readonly times?: number;
  readonly days?: number;
  readonly until?: string;
  readonly cap?: string;
  readonly telegram?: boolean;
  readonly web?: boolean;
}

/** Takes rule limit words from the bag ("30 times", "for 30 days", "until 2026-12-01", "cap $500"). */
export function limitTokens(bag: Bag): LimitTokens | { bad: { en: string; tr: string } } {
  const out: { times?: number; days?: number; until?: string; cap?: string; telegram?: boolean; web?: boolean } = {};
  const times = bag.take("times");
  if (times) out.times = times.n;
  const forDays = bag.take("forDays");
  if (forDays) out.days = forDays.days;
  else {
    const forPrep = bag.find("dur", (tok) => tok.minutes % 1_440 === 0);
    if (forPrep) {
      const prev = bag.prevBefore(forPrep.index);
      if (prev && prev.tok.k === "prep" && prev.tok.role === "to") {
        bag.use(prev.index);
        bag.use(forPrep.index);
        out.days = forPrep.tok.minutes / 1_440;
      }
    }
  }
  const until = bag.find("until");
  if (until) {
    const date = bag.nextAfter(until.index) ?? bag.prevBefore(until.index);
    if (!date || date.tok.k !== "date") return { bad: t("Give the end date as YYYY-MM-DD.", "Bitiş tarihini YYYY-AA-GG olarak yazın.") };
    bag.use(until.index);
    bag.use(date.index);
    out.until = date.tok.iso;
  } else {
    const date = bag.take("date");
    if (date) out.until = date.iso;
  }
  const cap = bag.find("flag", (tok) => tok.flag === "cap");
  if (cap) {
    bag.use(cap.index);
    const near = [bag.nextAfter(cap.index), bag.prevBefore(cap.index)].find((entry) => entry && entry.tok.k === "num" && !bag.isUsed(entry.index));
    if (!near) return { bad: t("Give the cap in USD (for example cap $100 per run).", "Limiti USD olarak yazın (örneğin çalışma başına en fazla $100).") };
    bag.use(near.index);
    out.cap = (near.tok as TokOf<"num">).value;
  }
  if (bag.take("flag", (tok) => tok.flag === "telegram")) out.telegram = true;
  if (bag.take("flag", (tok) => tok.flag === "web")) out.web = true;
  return out;
}

/** USD a body item may move per run, when the reading says it (USD sizes, or base sizes at a reference price). */
function usdOf(item: GoalItem, ctx: FrameCtx): number | null | "none" {
  if (item.t === "alert") return "none";
  if (item.t === "trade") {
    const goal = item.goal;
    if (isDerisking(goal)) return "none";
    const size = goal.size;
    if (!size) return null;
    if (size.t === "notional") return Number(size.usd);
    if (size.t === "margin") return Number(size.usd) * (typeof goal.leverage?.x === "number" ? goal.leverage.x : 1);
    if (size.t === "base" && "coin" in goal.market) {
      const px = ctx.facts.prices?.[goal.market.coin.toUpperCase()];
      return px ? Number(size.value) * Number(px) : null;
    }
    return null;
  }
  const amount = item.goal.spend.amount;
  const symbol = item.goal.spend.asset && "symbol" in item.goal.spend.asset ? item.goal.spend.asset.symbol : undefined;
  if (!amount) return null;
  if (amount.t === "usd") return Number(amount.value);
  if (amount.t === "exact" && symbol) {
    if (["USDC", "USDH", "USDT0"].includes(symbol.toUpperCase())) return Number(amount.value);
    const px = ctx.facts.prices?.[symbol.toUpperCase()];
    return px ? Number(amount.value) * Number(px) : null;
  }
  return null;
}

function roundCap(value: number): string {
  if (value <= 0 || !Number.isFinite(value)) return "1";
  const magnitude = value < 10 ? 1 : value < 1_000 ? 5 : 50;
  return String(Math.ceil((value * 1.02) / magnitude) * magnitude);
}

/** Builds the rule from its trigger, body and limit words; asks for the end and the cap when they matter. */
export function buildRule(ctx: FrameCtx, when: Rule["when"], body: readonly GoalItem[], limitWords: LimitTokens, repeat: boolean): { rule?: Rule; partial: boolean } {
  let partial = false;
  const limits: { maxRuns?: number; maxUsdPerRun?: string; expiresAt?: string } = {};
  const scheduled = "t" in when;
  const alertsOnly = body.every((item) => item.t === "alert");
  const agentRunnable = body.every((item) => item.t === "alert" || item.t === "trade");
  const execution: Rule["execution"] = agentRunnable ? "agent" : "signEachRun";
  if (!alertsOnly) {
    ctx.clar.assume(ctx.goal, "execution", agentRunnable ? t("runs with your trade-only HyperCore agent key (it can never withdraw)", "yalnızca işlem yapabilen HyperCore ajan anahtarınızla çalışır (para çekemez)") : t("each run asks your wallet to sign (swaps, bridges and stakes cannot run on the agent key)", "her çalışma cüzdanınızdan imza ister (swap, köprü ve stake ajan anahtarıyla çalışmaz)"), true);
  }
  if (limitWords.times !== undefined) limits.maxRuns = limitWords.times;
  if (limitWords.until) limits.expiresAt = limitWords.until;
  else if (limitWords.days !== undefined) limits.expiresAt = new Date(ctx.facts.now + limitWords.days * 86_400_000).toISOString();
  if (!scheduled && !repeat && limits.maxRuns === undefined) {
    limits.maxRuns = 1;
    if (!alertsOnly) ctx.clar.assume(ctx.goal, "maxRuns", t("runs once, then disarms", "bir kez çalışır, sonra kapanır"), false);
  }
  const needsEnd = (scheduled || repeat) && !alertsOnly && limits.maxRuns === undefined && limits.expiresAt === undefined;
  if (needsEnd) {
    const answer = ask(ctx, "rule.end", "RULE_END_MISSING", {
      prompt: t("How long should it keep running?", "Ne kadar süre çalışmaya devam etsin?"),
      options: [{ id: "runs:10", en: "10 times", tr: "10 kez" }, { id: "runs:30", en: "30 times", tr: "30 kez" }, { id: "days:7", en: "For 7 days", tr: "7 gün boyunca" }, { id: "days:30", en: "For 30 days", tr: "30 gün boyunca" }],
    });
    if (!answer?.option) partial = true;
    else {
      const [kind, count] = answer.option.split(":") as [string, string];
      if (kind === "runs") limits.maxRuns = Number(count);
      else limits.expiresAt = new Date(ctx.facts.now + Number(count) * 86_400_000).toISOString();
    }
  }
  const risky = body.some((item) => item.t === "value" || (item.t === "trade" && !isDerisking(item.goal)));
  if (limitWords.cap) limits.maxUsdPerRun = limitWords.cap;
  else if (risky) {
    const sizes = body.map((item) => usdOf(item, ctx));
    if (sizes.every((size) => size !== null)) {
      const total = sizes.reduce<number>((sum, size) => sum + (size === "none" ? 0 : size), 0);
      limits.maxUsdPerRun = roundCap(total);
      ctx.clar.assume(ctx.goal, "maxUsdPerRun", t(`at most $${limits.maxUsdPerRun} per run${ctx.facts.prices ? " (reference price)" : ""}`, `çalışma başına en fazla $${limits.maxUsdPerRun}${ctx.facts.prices ? " (referans fiyat)" : ""}`), true);
    } else {
      const spec = specOf(ctx, "rule.cap", "RULE_CAP_MISSING", {
        prompt: t("At most how many USD per run? Elyia never runs an automation without a cap.", "Çalışma başına en fazla kaç USD? Elyia limitsiz otomasyon çalıştırmaz."),
        options: [],
        allowsText: true,
        placeholder: t("$ per run", "çalışma başına $"),
      });
      const answer = ctx.clar.ask(spec);
      const parsed = answer?.text ? parseAmountAnswer(answer.text, ctx.locale, readNumber) : null;
      if (answer?.text && !parsed) ctx.clar.reject(spec, t("Type the cap as a number of USD.", "Limiti USD cinsinden sayı olarak yazın."));
      if (parsed) limits.maxUsdPerRun = parsed;
      else partial = true;
    }
  }
  const finalLimits: RuleLimits = { ...limits };
  return { rule: { when, then: body, limits: finalLimits, execution, confidence: "exact" }, partial };
}

export function alertItem(ctx: FrameCtx, limitWords: LimitTokens, repeat: boolean): GoalItem {
  let channel: "telegram" | "web" = limitWords.web ? "web" : limitWords.telegram || ctx.facts.telegramLinked ? "telegram" : "web";
  if (limitWords.telegram && ctx.facts.telegramLinked === false) {
    ctx.clar.warn("TELEGRAM_NOT_LINKED", t("Telegram is not linked yet: link it in settings, or the alert shows in the app.", "Telegram henüz bağlı değil: ayarlardan bağlayın, yoksa uyarı uygulamada görünür."));
    channel = "telegram";
  }
  if (!limitWords.telegram && !limitWords.web) ctx.clar.assume(ctx.goal, "channel", channel === "telegram" ? t("alert on Telegram", "Telegram'dan uyarı") : t("alert in the app", "uygulamada uyarı"), false);
  return { t: "alert", goal: { channel, repeat: repeat ? "always" : "once", ...(repeat ? { cooldownSec: 3_600 } : {}) } };
}

export function ruleGoal(rule: Rule): LanguageGoal {
  return { t: "rule", rule };
}
