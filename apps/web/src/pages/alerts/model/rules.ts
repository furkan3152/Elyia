/**
 * Alert rules and the Guide's standing orders, as plain sentences (pure).
 *
 * A rule watches one reading (a price, a funding rate, a rope's distance to
 * its crevasse, a new fill, a bridge that settled) and fires when the
 * condition is met. A standing order is the same rule with an `action`
 * sentence: when it fires, the Guide drafts that action for the user to
 * sign. Nothing here signs or sends; evaluation runs in the open tab.
 */

export type AlertKind = "price" | "funding" | "rope" | "fill" | "bridge";
export type Direction = "above" | "below";

export interface AlertChannels {
  readonly app: boolean;
  readonly telegram: boolean;
}

export interface AlertRule {
  readonly id: string;
  readonly kind: AlertKind;
  /** Upper-case coin; null = any (any rope, any fill). */
  readonly coin: string | null;
  readonly direction: Direction;
  /**
   * price: USD. funding: APR as a fraction (0.3 = 30% a year, + = longs pay).
   * rope: distance as a fraction of the mark (0.1 = 10%). fill / bridge: unused.
   */
  readonly threshold: number | null;
  readonly channels: AlertChannels;
  readonly armed: boolean;
  /** Fire once, then disarm (otherwise re-arms after the cooldown). */
  readonly once: boolean;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  /** Standing order: what the Guide drafts when it fires ("close half of ETH"). */
  readonly action?: string;
}

export interface RuleReadings {
  /** Mid prices by coin (numbers). */
  readonly mids: Readonly<Record<string, number>>;
  /** Hourly funding rate by coin (fraction). */
  readonly funding: Readonly<Record<string, number>>;
  readonly ropes: readonly { readonly coin: string; readonly distance: number | null }[];
  readonly fills: readonly { readonly coin: string; readonly time: number; readonly side: "buy" | "sell"; readonly px: string; readonly sz: string }[];
  /** Bridge journeys that settled (from the tracker; empty until it is online). */
  readonly bridges: readonly { readonly id: string; readonly time: number; readonly label: string }[];
  readonly now: number;
}

export interface RuleStatus {
  /** The watched value now (null = no reading yet). */
  readonly value: number | null;
  readonly met: boolean;
  /** How far the reading still has to travel, as a fraction of it (0 = there). */
  readonly gap: number | null;
  /** "ETH 3,312 · 2.7% to go". */
  readonly reading: string;
  /** What fired, for the feed ("ETH crossed 3,400 at 3,402"). */
  readonly event: string | null;
  /** The coin the reading is about (the nearest rope for "any rope"). */
  readonly subject?: string;
}

export const COOLDOWN_MS = 15 * 60_000;
export const HOURS_PER_YEAR = 24 * 365;

export const KIND_LABEL: Readonly<Record<AlertKind, string>> = {
  price: "price",
  funding: "funding",
  rope: "rope distance",
  fill: "fills",
  bridge: "bridge settled",
};

/** Funding APR (fraction) from an hourly rate. */
export function aprFromHourly(hourly: number): number {
  return hourly * HOURS_PER_YEAR;
}

function sig(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function pctText(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits).replace(/\.0+$/u, "")}%`;
}

/** The rule as one plain sentence. */
export function ruleSentence(rule: AlertRule): string {
  const what = ruleCondition(rule);
  if (rule.action) return `When ${what}, draft: ${rule.action}`;
  return `Tell me when ${what}`;
}

/** The condition alone ("ETH price goes above 3,400"). */
export function ruleCondition(rule: AlertRule): string {
  const coin = rule.coin ?? "any";
  switch (rule.kind) {
    case "price":
      return `${coin} goes ${rule.direction} ${rule.threshold === null ? "…" : `$${sig(rule.threshold)}`}`;
    case "funding":
      return `${coin} funding goes ${rule.direction} ${rule.threshold === null ? "…" : `${pctText(rule.threshold)} APR`}`;
    case "rope":
      return `${rule.coin ? `my ${rule.coin} rope` : "any rope"} is closer than ${rule.threshold === null ? "…" : pctText(rule.threshold, 0)} to the crevasse`;
    case "fill":
      return rule.coin ? `a ${rule.coin} order fills` : "any order fills";
    case "bridge":
      return "a bridge journey settles";
  }
}

function crossed(direction: Direction, value: number, threshold: number): boolean {
  return direction === "above" ? value >= threshold : value <= threshold;
}

function gapOf(direction: Direction, value: number, threshold: number): number {
  if (crossed(direction, value, threshold)) return 0;
  const base = Math.abs(value) > 1e-12 ? Math.abs(value) : Math.abs(threshold) || 1;
  return Math.abs(threshold - value) / base;
}

/** Where a rule stands against the readings. */
export function evaluateRule(rule: AlertRule, readings: RuleReadings): RuleStatus {
  const since = Math.max(rule.createdAt, rule.lastFiredAt ?? 0);
  switch (rule.kind) {
    case "price": {
      const value = rule.coin ? readings.mids[rule.coin] : undefined;
      if (value === undefined) return { value: null, met: false, gap: null, reading: `${rule.coin ?? "?"} · waiting for a price`, event: null };
      if (rule.threshold === null) return { value, met: false, gap: null, reading: `${rule.coin} $${sig(value)} · set your line`, event: null };
      const met = crossed(rule.direction, value, rule.threshold);
      const gap = gapOf(rule.direction, value, rule.threshold);
      return { value, met, gap, reading: `${rule.coin} $${sig(value)}${met ? " · crossed" : ` · ${pctText(gap)} to go`}`, event: met ? `${rule.coin} is ${rule.direction} $${sig(rule.threshold)} (now $${sig(value)})` : null };
    }
    case "funding": {
      const hourly = rule.coin ? readings.funding[rule.coin] : undefined;
      if (hourly === undefined) return { value: null, met: false, gap: null, reading: `${rule.coin ?? "?"} · waiting for funding`, event: null };
      const apr = aprFromHourly(hourly);
      if (rule.threshold === null) return { value: apr, met: false, gap: null, reading: `${rule.coin} ${pctText(apr)} APR now · set your line`, event: null };
      const met = crossed(rule.direction, apr, rule.threshold);
      return {
        value: apr,
        met,
        gap: Math.abs(rule.threshold - apr),
        reading: `${rule.coin} ${pctText(apr)} APR${met ? " · crossed" : ` · ${pctText(Math.abs(rule.threshold - apr))} pts to go`}`,
        event: met ? `${rule.coin} funding is ${pctText(apr)} APR, ${rule.direction} ${pctText(rule.threshold)} (${apr >= 0 ? "longs pay" : "shorts pay"})` : null,
      };
    }
    case "rope": {
      const ropes = readings.ropes.filter((rope) => rope.distance !== null && (rule.coin === null || rope.coin === rule.coin));
      if (ropes.length === 0 || rule.threshold === null) return { value: null, met: false, gap: null, reading: rule.coin ? `no ${rule.coin} rope out` : "no ropes out", event: null };
      const nearest = ropes.reduce((a, b) => ((b.distance ?? 1) < (a.distance ?? 1) ? b : a));
      const distance = nearest.distance as number;
      const met = distance <= rule.threshold;
      return {
        value: distance,
        met,
        gap: met ? 0 : distance - rule.threshold,
        subject: nearest.coin,
        reading: `${nearest.coin} rope ${pctText(distance)}${met ? " · inside the line" : ` · ${pctText(distance - rule.threshold)} of slack`}`,
        event: met ? `${nearest.coin} rope is ${pctText(distance)} from the crevasse (your line: ${pctText(rule.threshold, 0)})` : null,
      };
    }
    case "fill": {
      const fresh = readings.fills.filter((fill) => fill.time > since && (rule.coin === null || fill.coin === rule.coin));
      const latest = fresh.reduce<(typeof fresh)[number] | null>((a, b) => (a === null || b.time > a.time ? b : a), null);
      return {
        value: fresh.length,
        met: latest !== null,
        gap: null,
        ...(latest ? { subject: latest.coin } : {}),
        reading: latest ? `${fresh.length} new fill${fresh.length === 1 ? "" : "s"}` : "listening for fills",
        event: latest ? `${latest.side === "buy" ? "Bought" : "Sold"} ${latest.sz} ${latest.coin} at ${latest.px}` : null,
      };
    }
    case "bridge": {
      const fresh = readings.bridges.filter((bridge) => bridge.time > since);
      const latest = fresh[0] ?? null;
      return { value: fresh.length, met: latest !== null, gap: null, reading: latest ? latest.label : "listening to the tracker", event: latest ? `${latest.label} settled` : null };
    }
  }
}

/** Whether an armed rule should fire now (met, and out of its cooldown). */
export function shouldFire(rule: AlertRule, status: RuleStatus, now: number): boolean {
  if (!rule.armed || !status.met) return false;
  if (rule.lastFiredAt !== null && now - rule.lastFiredAt < COOLDOWN_MS) return false;
  return true;
}

/** The rule after it fired: stamped, and disarmed when it was one-shot. */
export function afterFire(rule: AlertRule, now: number): AlertRule {
  return { ...rule, lastFiredAt: now, armed: rule.once ? false : rule.armed };
}

export function newRuleId(now: number, salt = Math.random()): string {
  return `r${now.toString(36)}${Math.floor(salt * 1e6).toString(36)}`;
}

/* ------------------------------------------------------------ parsing */

const COIN = /^[A-Za-z][A-Za-z0-9]{1,9}$/u;
const STOP = new Set(["ALERT", "ME", "IF", "WHEN", "TELL", "PING", "NOTIFY", "THE", "PRICE", "FUNDING", "GOES", "IS", "ABOVE", "BELOW", "UNDER", "OVER", "MY", "ROPE", "ANY", "APR", "TO", "CROSSES", "DROPS", "RISES", "GETS", "FILLS", "ORDER", "A", "AN", "BRIDGE", "SETTLES", "CLOSER", "THAN", "FROM", "CREVASSE", "LIQUIDATION", "AND", "THEN", "EVERY", "DRAFT", "PROPOSE", "CLOSE", "HALF", "OF", "BUY", "SELL", "ON", "AT", "LIQ"]);

/** Tickers people type in lower case. Anything else must be written in capitals ("TSLA"). */
const KNOWN = new Set(["hype", "btc", "eth", "sol", "purr", "fartcoin", "khype", "doge", "xrp", "sui", "avax", "link", "bnb", "ena", "pump", "wif", "kpepe", "tkntq", "ltc", "arb", "op"]);

function coinIn(text: string): string | null {
  const words = text.split(/[^A-Za-z0-9:]+/u).filter(Boolean);
  for (const word of words) {
    const upper = word.toUpperCase();
    if (STOP.has(upper) || /^\d/u.test(word) || !COIN.test(word) || word.length > 10) continue;
    if (KNOWN.has(word.toLowerCase()) || (word === upper && /[A-Z]/u.test(word))) return upper;
  }
  return null;
}

function numberIn(text: string): { readonly value: number; readonly percent: boolean; readonly apr: boolean } | null {
  const match = /([-+−]?\$?\d[\d,]*(?:\.\d+)?)\s*(k|m)?\s*(%)?\s*(apr|a year|annual)?/iu.exec(text.replace(/−/gu, "-"));
  if (!match) return null;
  let value = Number(match[1]!.replace(/[$,]/gu, ""));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "k") value *= 1_000;
  if (unit === "m") value *= 1_000_000;
  return { value, percent: match[3] === "%", apr: Boolean(match[4]) };
}

export interface ParsedRule {
  readonly rule: Omit<AlertRule, "id" | "createdAt" | "lastFiredAt" | "armed" | "channels" | "once">;
  /** What the parser understood, in words, for the confirmation line. */
  readonly understood: string;
}

/**
 * Reads a plain sentence into a rule ("alert me if ETH funding goes above
 * 0.05%", "tell me when BTC drops below 90k", "ping me when any rope is under
 * 10%", "when ETH funding is below -30% APR, close half of ETH"). Funding
 * given without "APR" is read as HyperCore's hourly rate. Returns null when
 * the sentence is not a rule.
 */
export function parseRuleSentence(sentence: string): ParsedRule | null {
  const text = sentence.trim();
  const lower = text.toLowerCase();
  if (!/\b(alert|tell|ping|notify|when|if|whenever)\b/u.test(lower)) return null;
  const [conditionPart, actionPart] = splitAction(text);
  const condition = conditionPart.toLowerCase();
  const direction: Direction = /\b(below|under|drops|falls|less|lower|beneath|<)\b/u.test(condition) || condition.includes("<") ? "below" : "above";
  const action = actionPart?.trim() ? actionPart.trim().replace(/[.!]+$/u, "") : undefined;
  const base = action ? { action } : {};

  if (/\bfill(s|ed)?\b/u.test(condition)) {
    const coin = coinIn(conditionPart);
    return { rule: { kind: "fill", coin, direction: "above", threshold: null, ...base }, understood: coin ? `${coin} fills` : "any fill" };
  }
  if (/\bbridge|settle/u.test(condition)) {
    return { rule: { kind: "bridge", coin: null, direction: "above", threshold: null, ...base }, understood: "a bridge journey settles" };
  }
  const number = numberIn(conditionPart);
  if (/\b(rope|liq|liquidation|crevasse)\b/u.test(condition)) {
    if (!number) return null;
    const coin = /\bany\b/u.test(condition) ? null : coinIn(conditionPart);
    const threshold = Math.abs(number.value) / 100;
    if (!(threshold > 0 && threshold < 1)) return null;
    return { rule: { kind: "rope", coin, direction: "below", threshold, ...base }, understood: `${coin ? `${coin} rope` : "any rope"} under ${pctText(threshold, 0)}` };
  }
  if (/\bfunding\b/u.test(condition)) {
    const coin = coinIn(conditionPart);
    if (!coin || !number) return null;
    const fraction = number.value / 100;
    const apr = number.apr ? fraction : aprFromHourly(fraction);
    return { rule: { kind: "funding", coin, direction, threshold: apr, ...base }, understood: `${coin} funding ${direction} ${pctText(apr)} APR${number.apr ? "" : ` (${number.value}% an hour)`}` };
  }
  const coin = coinIn(conditionPart);
  if (!coin || !number || number.percent || number.value <= 0) return null;
  return { rule: { kind: "price", coin, direction, threshold: number.value, ...base }, understood: `${coin} ${direction} $${sig(number.value)}` };
}

/** "when X, close half" / "if X then buy 10 HYPE" -> [condition, action]. */
function splitAction(text: string): readonly [string, string | undefined] {
  const then = /\s*(?:,|\bthen\b|\bdraft\b:?|\bpropose\b:?)\s*/iu;
  const lower = text.toLowerCase();
  const verbs = /(?:,\s*|\bthen\s+)(close|halve|buy|sell|reduce|flatten|cancel|move|set|trail|long|short|swap|bridge)\b/iu.exec(text);
  if (verbs && verbs.index > 0) return [text.slice(0, verbs.index), text.slice(verbs.index).replace(then, "")];
  if (lower.includes(" then ")) {
    const at = lower.indexOf(" then ");
    return [text.slice(0, at), text.slice(at + 6)];
  }
  return [text, undefined];
}
