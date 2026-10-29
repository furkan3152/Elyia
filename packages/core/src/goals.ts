/**
 * The goal IR the language layer produces.
 * One clause becomes one typed goal:
 * - `ValueGoal`: move or convert value (swap, bridge, send, stake, earn);
 * - `TradeGoal`: open, close, reduce or protect a HyperCore position, place
 *   or cancel orders, TWAP, set leverage. Positions do not fit "spend X, get
 *   Y", so trading has its own IR;
 * - `Rule`: a schedule or condition with goals to run when it fires (the
 *   Elysium Agent's automations), with hard limits;
 * - `AlertGoal`, `QueryGoal`.
 *
 * Serialisable and free of the user's words: symbols, decimal strings,
 * network keys and protocol ids only. Funding rates and thresholds are
 * decimal strings, not integer basis points ("0.0013" %/h exists).
 */
import { isDecimalAmount } from "./amounts.js";
import { isNetworkKey, type NetworkKey } from "./networks.js";

export const GOAL_SPEC = "elyia.goal/v1" as const;

/** How a goal was read: the strict reader, connector frames, or the assistant's proposal. */
export const GOAL_CONFIDENCES = Object.freeze(["exact", "frame", "assistant"] as const);
export type GoalConfidence = (typeof GOAL_CONFIDENCES)[number];

export const ASSET_CLASSES = Object.freeze(["usd-stable", "hype", "any-stable", "gas"] as const);
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** A listed symbol (or address), or a class of assets ("my stables"). */
export type AssetSel = { readonly symbol: string } | { readonly class: AssetClass };

/** Where value sits. */
export type Custody =
  | { readonly kind: "wallet" }
  | { readonly kind: "venue"; readonly protocol?: string; readonly vault?: string; readonly category?: "lending" | "staking" | "vault" | "any" }
  | { readonly kind: "position"; readonly protocol?: string }
  | { readonly kind: "hypercore"; readonly class: "spot" | "perp" | "unknown"; readonly vault?: string; readonly subAccount?: string }
  | { readonly kind: "loan"; readonly protocol?: string };

export interface Place {
  readonly network?: NetworkKey;
  readonly custody: Custody;
}

export type AmountSel =
  | { readonly t: "exact"; readonly value: string }
  | { readonly t: "usd"; readonly value: string }
  | { readonly t: "portion"; readonly bps: number }
  | { readonly t: "max" }
  | { readonly t: "allBut"; readonly keep: string }
  | { readonly t: "previous" };

export type Holder =
  | { readonly t: "self" }
  | { readonly t: "address"; readonly value: string }
  | { readonly t: "name"; readonly value: string }
  | { readonly t: "nickname" }
  | { readonly t: "selfOther" };

export const VALUE_GOAL_KINDS = Object.freeze(["convert", "relocate", "deliver", "earn", "exit", "acquire", "stake", "unstake", "borrow", "repay"] as const);
export type ValueGoalKind = (typeof VALUE_GOAL_KINDS)[number];

export interface ValueGoal {
  readonly kind: ValueGoalKind;
  /** The verb said, if any: a constraint on the route. */
  readonly op?: string;
  readonly spend: { readonly asset?: AssetSel; readonly amount?: AmountSel; readonly from?: Place };
  readonly want: { readonly asset?: AssetSel; readonly amount?: AmountSel; readonly at?: Place };
  readonly holder: Holder;
  readonly constraints: { readonly via?: readonly string[]; readonly avoid?: readonly string[]; readonly prefer?: "cheapest" | "fastest" | "safest"; readonly keepGas?: boolean };
  /** Depends on goal #after's output. */
  readonly chain?: { readonly after: number };
  readonly confidence: GoalConfidence;
}

/* ------------------------------------------------------------- trading */

export interface MarketSel {
  /** "BTC", "HYPE"; spot pairs by base symbol with kind spot. */
  readonly coin: string;
  readonly kind: "perp" | "spot";
  /** Builder-deployed perp dex name (HIP-3), when not the default dex. */
  readonly dex?: string;
}

export type SizeSel =
  | { readonly t: "base"; readonly value: string }
  | { readonly t: "notional"; readonly usd: string }
  | { readonly t: "margin"; readonly usd: string }
  | { readonly t: "portion"; readonly bps: number; readonly of: "position" | "accountValue" | "withdrawable" }
  | { readonly t: "max" };

export type PriceSel =
  | { readonly t: "market" }
  | { readonly t: "limit"; readonly px: string }
  | { readonly t: "offset"; readonly pct: string; readonly from: "mark" | "mid" | "oracle" | "entry"; readonly dir: "above" | "below" }
  | { readonly t: "breakeven" };

export interface Trigger {
  readonly kind: "tp" | "sl";
  readonly px: PriceSel;
  readonly exec: "market" | "limit";
}

export const TRADE_GOAL_KINDS = Object.freeze(["open", "close", "reduce", "order", "twap", "protect", "cancel", "setLeverage"] as const);
export type TradeGoalKind = (typeof TRADE_GOAL_KINDS)[number];

export interface TradeGoal {
  readonly kind: TradeGoalKind;
  readonly market: MarketSel | { readonly all: true };
  readonly side?: "long" | "short" | "buy" | "sell";
  readonly size?: SizeSel;
  readonly leverage?: { readonly x: number | "max"; readonly mode?: "cross" | "isolated" };
  /** Absent = market. */
  readonly price?: PriceSel;
  readonly tif?: "gtc" | "ioc" | "alo";
  readonly reduceOnly?: boolean;
  readonly tp?: Trigger;
  readonly sl?: Trigger;
  readonly twap?: { readonly minutes: number; readonly randomize?: boolean };
  readonly maxSlippageBps?: number;
  readonly confidence: GoalConfidence;
}

/* ------------------------------------------------- automations and alerts */

export type Schedule = {
  readonly t: "every";
  readonly seconds: number;
  readonly at?: { readonly hour: number; readonly minute: number; readonly tz: string };
  /** 0 = Sunday ... 6 = Saturday. */
  readonly weekdays?: readonly number[];
};

export const CONDITION_METRICS = Object.freeze([
  "price", "mark", "oracle", "funding", "openInterest", "pnl", "roe", "liqDistance", "healthFactor", "apy", "balance",
] as const);
export type ConditionMetric = (typeof CONDITION_METRICS)[number];

export const CONDITION_OPS = Object.freeze([">", ">=", "<", "<=", "crossesAbove", "crossesBelow"] as const);
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface Condition {
  readonly metric: ConditionMetric;
  readonly subject: MarketSel | AssetSel | { readonly position: MarketSel };
  readonly op: ConditionOp;
  /** Decimal string; may be negative for funding / pnl. */
  readonly value: string;
  readonly unit: "usd" | "pct" | "x" | "ratio";
  readonly period?: "1h" | "8h" | "apr";
}

export interface AlertGoal {
  readonly channel: "telegram" | "web";
  readonly repeat: "once" | "always";
  readonly cooldownSec?: number;
}

export interface QueryGoal {
  readonly what: "balance" | "positions" | "pnl" | "price" | "funding" | "orders" | "liqPrice" | "apy" | "portfolio";
  readonly subject?: MarketSel | AssetSel;
}

export interface RuleLimits {
  readonly maxRuns?: number;
  readonly maxUsdPerRun?: string;
  readonly maxUsdTotal?: string;
  readonly expiresAt?: string;
  readonly cooldownSec?: number;
}

export type GoalItem =
  | { readonly t: "value"; readonly goal: ValueGoal }
  | { readonly t: "trade"; readonly goal: TradeGoal }
  | { readonly t: "alert"; readonly goal: AlertGoal };

export interface Rule {
  readonly when: Schedule | Condition | { readonly all: readonly Condition[] };
  readonly then: readonly GoalItem[];
  readonly limits: RuleLimits;
  /**
   * agent: signed by a trade-only key under the Rule Book (browser autopilot
   * or opt-in Keeper mode); signEachRun: every run asks the wallet.
   */
  readonly execution: "agent" | "signEachRun";
  readonly confidence: GoalConfidence;
}

/* ------------------------------------------------------------ validation */

export interface GoalIssue {
  readonly path: string;
  readonly message: string;
}

/** Shortest schedule interval an automation may use. */
export const MIN_SCHEDULE_SECONDS = 60;
export const TWAP_MINUTES_RANGE = Object.freeze({ min: 5, max: 1_440 });

const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const COIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;

function positive(value: string): boolean {
  return isDecimalAmount(value) && !/^0(?:\.0+)?$/u.test(value);
}

function checkMarket(market: MarketSel, path: string, issues: GoalIssue[]): void {
  if (!COIN.test(market.coin)) issues.push({ path: `${path}.coin`, message: "Unknown market name." });
  if (market.kind !== "perp" && market.kind !== "spot") issues.push({ path: `${path}.kind`, message: "Market kind is perp or spot." });
}

function checkPrice(price: PriceSel, path: string, issues: GoalIssue[]): void {
  if (price.t === "limit" && !positive(price.px)) issues.push({ path, message: "A limit price is a positive decimal." });
  if (price.t === "offset" && !positive(price.pct)) issues.push({ path, message: "An offset is a positive percent." });
}

function checkBps(bps: number, path: string, issues: GoalIssue[]): void {
  if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) issues.push({ path, message: "A portion is 1-10000 basis points." });
}

/** Structural checks of a trade goal (numbers, bounds, combinations). Empty when valid. */
export function validateTradeGoal(goal: TradeGoal, path = "goal"): GoalIssue[] {
  const issues: GoalIssue[] = [];
  if (!TRADE_GOAL_KINDS.includes(goal.kind)) issues.push({ path: `${path}.kind`, message: `Unknown trade kind ${String(goal.kind)}.` });
  if ("coin" in goal.market) checkMarket(goal.market, `${path}.market`, issues);
  else if (goal.kind !== "close" && goal.kind !== "cancel") issues.push({ path: `${path}.market`, message: "Only close and cancel apply to every market at once." });
  const size = goal.size;
  if (size) {
    if (size.t === "base" && !positive(size.value)) issues.push({ path: `${path}.size`, message: "Size is a positive decimal." });
    if ((size.t === "notional" || size.t === "margin") && !positive(size.usd)) issues.push({ path: `${path}.size`, message: "USD size is a positive decimal." });
    if (size.t === "portion") checkBps(size.bps, `${path}.size.bps`, issues);
  }
  if ((goal.kind === "open" || goal.kind === "order" || goal.kind === "twap") && !size) issues.push({ path: `${path}.size`, message: "How much? A size is needed." });
  if ((goal.kind === "open" || goal.kind === "order" || goal.kind === "twap") && !goal.side) issues.push({ path: `${path}.side`, message: "Long or short (buy or sell)?" });
  if (goal.leverage && goal.leverage.x !== "max" && (!Number.isInteger(goal.leverage.x) || goal.leverage.x < 1 || goal.leverage.x > 100)) {
    issues.push({ path: `${path}.leverage`, message: "HyperCore leverage is a whole number (1x, 2x, ...)." });
  }
  if (goal.leverage && "coin" in goal.market && goal.market.kind === "spot") issues.push({ path: `${path}.leverage`, message: "Spot has no leverage." });
  if (goal.price) checkPrice(goal.price, `${path}.price`, issues);
  if (goal.tp) checkPrice(goal.tp.px, `${path}.tp`, issues);
  if (goal.sl) checkPrice(goal.sl.px, `${path}.sl`, issues);
  if (goal.kind === "twap") {
    const minutes = goal.twap?.minutes;
    if (minutes === undefined || !Number.isInteger(minutes) || minutes < TWAP_MINUTES_RANGE.min || minutes > TWAP_MINUTES_RANGE.max) {
      issues.push({ path: `${path}.twap.minutes`, message: "A TWAP runs 5 minutes to 24 hours." });
    }
  }
  if (goal.maxSlippageBps !== undefined && (!Number.isInteger(goal.maxSlippageBps) || goal.maxSlippageBps < 1 || goal.maxSlippageBps > 1_000)) {
    issues.push({ path: `${path}.maxSlippageBps`, message: "Slippage is 1-1000 basis points." });
  }
  return issues;
}

function checkCondition(condition: Condition, path: string, issues: GoalIssue[]): void {
  if (!CONDITION_METRICS.includes(condition.metric)) issues.push({ path: `${path}.metric`, message: `Unknown metric ${String(condition.metric)}.` });
  if (!CONDITION_OPS.includes(condition.op)) issues.push({ path: `${path}.op`, message: `Unknown comparison ${String(condition.op)}.` });
  if (!SIGNED_DECIMAL.test(condition.value)) issues.push({ path: `${path}.value`, message: "A threshold is a decimal number." });
}

/** Structural checks of an automation rule. Empty when valid. */
export function validateRule(rule: Rule, path = "rule"): GoalIssue[] {
  const issues: GoalIssue[] = [];
  const when = rule.when;
  if ("t" in when) {
    if (!Number.isInteger(when.seconds) || when.seconds < MIN_SCHEDULE_SECONDS) issues.push({ path: `${path}.when.seconds`, message: "Schedules run at most once a minute." });
    if (when.at && (when.at.hour < 0 || when.at.hour > 23 || when.at.minute < 0 || when.at.minute > 59 || !when.at.tz)) issues.push({ path: `${path}.when.at`, message: "Times are HH:MM with a time zone." });
    if (when.weekdays?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) issues.push({ path: `${path}.when.weekdays`, message: "Weekdays are 0 (Sunday) to 6." });
  } else if ("all" in when) {
    if (when.all.length === 0) issues.push({ path: `${path}.when.all`, message: "At least one condition." });
    when.all.forEach((condition, index) => checkCondition(condition, `${path}.when.all[${index}]`, issues));
  } else {
    checkCondition(when, `${path}.when`, issues);
  }
  if (rule.then.length === 0) issues.push({ path: `${path}.then`, message: "A rule needs something to do." });
  rule.then.forEach((item, index) => {
    if (item.t === "trade") issues.push(...validateTradeGoal(item.goal, `${path}.then[${index}].goal`));
    if (item.t === "value" && item.goal.spend.from?.network !== undefined && !isNetworkKey(item.goal.spend.from.network)) {
      issues.push({ path: `${path}.then[${index}].goal.spend.from.network`, message: "Unknown network." });
    }
  });
  const limits = rule.limits;
  if (limits.maxRuns !== undefined && (!Number.isInteger(limits.maxRuns) || limits.maxRuns < 1)) issues.push({ path: `${path}.limits.maxRuns`, message: "maxRuns is a positive integer." });
  for (const key of ["maxUsdPerRun", "maxUsdTotal"] as const) {
    const value = limits[key];
    if (value !== undefined && !positive(value)) issues.push({ path: `${path}.limits.${key}`, message: `${key} is a positive USD decimal.` });
  }
  if (limits.expiresAt !== undefined && Number.isNaN(Date.parse(limits.expiresAt))) issues.push({ path: `${path}.limits.expiresAt`, message: "expiresAt is an ISO date." });
  // Unattended trading must be bounded: an agent rule that trades needs a per-run cap.
  if (rule.execution === "agent" && rule.then.some((item) => item.t === "trade" || item.t === "value") && limits.maxUsdPerRun === undefined) {
    issues.push({ path: `${path}.limits.maxUsdPerRun`, message: "An agent rule that moves value needs a per-run USD cap." });
  }
  return issues;
}
