/**
 * Rule Book evaluation: facts, the rule catalogue, the pure evaluator and the
 * schedule clock. The same evaluator runs in the API (plan, prepare), in the
 * browser guard before every agent-key signature and in the Keeper before
 * every server-signed action.
 *
 * Fail closed: when a rule needs a fact that is missing (a price, the open
 * order count, the day's volume or losses, the leverage of an order) the
 * decision is `deny` with rule `facts.unavailable`, never `allow`. The one
 * exception is a token that has no reference price at all (`noReference`:
 * test tokens, vault shares, launch tokens): on testnet it is allowed up to
 * the book's `unpriced` cap in token units and valued at $0, with a note; on
 * mainnet it is always refused (`assets.unpriced`).
 *
 * Every rule runs (so the explanation is complete); the decision is the
 * worst of the lattice allow < confirm < deny.
 *
 * De-risking always stays possible: reduce-only orders and cancels pass the
 * kill switch and are exempt from size, volume, loss, leverage and
 * open-order limits (they still obey market, protocol, network and agent
 * rules).
 */
import { getToken } from "./assets.js";
import { normalizeAssetId, parseAssetId, sameOwner, type AccountId } from "./caip.js";
import { NETWORKS, type NetworkKey } from "./networks.js";
import { getProtocol } from "./protocols.js";
import {
  accountMatchesPattern,
  effectiveUnpriced,
  tokenAmountUnits,
  DEFAULT_AGENT_ACTIONS,
  DEFAULT_AGENT_MODES,
  formatUsdMicros,
  normalizeMarketEntry,
  timeMinutes,
  usdMicros,
  WEEKDAYS,
  type AgentMode,
  type RuleBook,
  type Weekday,
} from "./policy.js";
import { KEEPER_SIGNABLE_ACTIONS, AGENT_SIGNABLE_ACTIONS, type L1ActionType } from "./hypercore/actions.js";
import type { IntentGraph, IntentStep, StepAmount, StepKind } from "./intent.js";

/* --------------------------------------------------------------- facts */

export type PolicyStage = "plan" | "prepare" | "sign";
/** Who signs: the user's wallet, the in-browser agent key, or the opt-in server Keeper. */
export type PolicySigner = "wallet" | "agent" | "keeper";

export interface AssetFact {
  readonly asset: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Base units. */
  readonly amount: string;
  /** In the verified token registry (or a HyperCore margin / perp / spot asset). */
  readonly listed: boolean;
  readonly group?: string;
  /** Conservative USD, micro-dollars, rounded up; null = unpriced. */
  readonly usdMicros: bigint | null;
  /**
   * True when no reference price source exists for the asset at all (a test
   * token, a vault share, a launch token), as opposed to a price that could
   * not be read right now. Only such assets fall under the `unpriced` rules;
   * a missing price of a priced asset always fails closed (`facts.unavailable`).
   */
  readonly noReference?: boolean;
}

export interface TradeFact {
  /** Book coin ("BTC", "@1035"). */
  readonly market: string;
  /** Display name ("HYPE/USDC"), also matched by market rules. */
  readonly displayName?: string;
  readonly marketKind: "perp" | "spot";
  readonly side: "buy" | "sell";
  readonly sz: string;
  /** Size x worst price, micro-dollars; null = unknown. */
  readonly notionalUsdMicros: bigint | null;
  /** Leverage the order trades at (spot = 1); null = unknown. */
  readonly leverage: number | null;
  readonly reduceOnly: boolean;
  readonly isTrigger: boolean;
  readonly isTwap: boolean;
  /** IOC "market" orders: worst price distance from mid, bps; null = unknown. */
  readonly slippageBps?: number | null;
}

export interface StepFact {
  readonly id: string;
  readonly index: number;
  readonly kind: StepKind;
  readonly protocol: string;
  readonly network: NetworkKey;
  readonly destinationNetwork?: NetworkKey;
  /** No incoming funds edge: its inputs count toward the intent's value. */
  readonly root: boolean;
  readonly inputs: readonly AssetFact[];
  readonly outputs: readonly AssetFact[];
  /** CAIP-10 (or 0x address) that receives the outputs. */
  readonly recipient: string;
  readonly slippageBps?: number;
  readonly extraCosts?: readonly AssetFact[];
  readonly estimatedSeconds?: number;
  readonly trade?: TradeFact;
  /** Who signs this step ("none" for settlement and read-only steps). */
  readonly signer: PolicySigner | "none";
  /** For agent / keeper signatures: the L1 action type being signed. */
  readonly agentAction?: L1ActionType;
}

export interface TradingFacts {
  /** Open orders on the account now; null = unread. */
  readonly openOrders: number | null;
  /** Notional of open perp positions now, micro-dollars; null = unread. */
  readonly openNotionalUsdMicros: bigint | null;
  /** Risk-increasing traded notional in the last 24 h; null = unread. */
  readonly dayVolumeUsdMicros: bigint | null;
  /** Realized losses in the last 24 h (positive number); null = unread. */
  readonly dayRealizedLossUsdMicros: bigint | null;
}

export interface PolicyFacts {
  readonly stage: PolicyStage;
  /** Who asked: the user, or an automation (Elysium Agent). */
  readonly origin: "user" | "automation";
  /** False for dry runs and previews. */
  readonly stored: boolean;
  /** The user's own accounts. */
  readonly accounts: readonly AccountId[];
  readonly steps: readonly StepFact[];
  /** Estimated network fees of the intent, micro-dollars; null = unknown. */
  readonly feesUsdMicros?: bigint | null;
  /** Value already counted in the rolling windows (excluding this intent); undefined = unread. */
  readonly usage?: { readonly dayUsdMicros: bigint; readonly weekUsdMicros: bigint };
  readonly trading?: TradingFacts;
  readonly now?: number;
}

/* --------------------------------------------------------------- rules */

export type PolicyRuleId =
  | "mode.paused"
  | "mode.dryRun"
  | "networks.allow"
  | "networks.environments"
  | "kinds.allow"
  | "protocols.allow"
  | "protocols.deny"
  | "assets.allow"
  | "assets.unlisted"
  | "assets.unpriced"
  | "recipients.deny"
  | "recipients.own"
  | "recipients.allowlist"
  | "limits.maxSteps"
  | "limits.maxSlippageBps"
  | "limits.maxFeeUsd"
  | "limits.maxSeconds"
  | "caps.perStepUsd"
  | "caps.perIntentUsd"
  | "caps.dailyUsd"
  | "caps.weeklyUsd"
  | "trading.markets.allow"
  | "trading.markets.deny"
  | "trading.maxNotionalUsd"
  | "trading.maxOpenNotionalUsd"
  | "trading.maxLeverage"
  | "trading.reduceOnly"
  | "trading.maxOpenOrders"
  | "trading.dailyVolumeUsd"
  | "trading.dailyLossUsd"
  | "trading.triggers"
  | "trading.twap"
  | "trading.maxSlippageBps"
  | "agent.actions"
  | "agent.modes"
  | "schedule.window"
  | "confirm.aboveUsd"
  | "confirm.leverageAbove"
  | "confirm.externalRecipient"
  | "confirm.crossNetwork"
  | "confirm.agentProposal"
  | "confirm.unlistedAsset"
  | "facts.unavailable";

export interface PolicyRuleInfo {
  readonly title: string;
  readonly outcome: "deny" | "confirm";
  /** Error catalog code a violation maps to. */
  readonly code: "POLICY_DENIED" | "POLICY_CONFIRMATION_REQUIRED" | "POLICY_LIMIT_REACHED" | "POLICY_FACTS_UNAVAILABLE" | "POLICY_PAUSED" | "POLICY_SCHEDULE_CLOSED";
}

const deny = (title: string, code: PolicyRuleInfo["code"] = "POLICY_DENIED"): PolicyRuleInfo => ({ title, outcome: "deny", code });
const confirmRule = (title: string): PolicyRuleInfo => ({ title, outcome: "confirm", code: "POLICY_CONFIRMATION_REQUIRED" });

/** Rule ids are stable API: UIs, the agent feed and Telegram show them. */
export const POLICY_RULES: Readonly<Record<PolicyRuleId, PolicyRuleInfo>> = Object.freeze({
  "mode.paused": deny("The rule book is not paused (kill switch)", "POLICY_PAUSED"),
  "mode.dryRun": deny("Dry-run mode: plans and quotes only"),
  "networks.allow": deny("Every network is allowed"),
  "networks.environments": deny("Every network is in an allowed environment"),
  "kinds.allow": deny("Every step kind is allowed"),
  "protocols.allow": deny("Every protocol is allowed"),
  "protocols.deny": deny("No protocol is denied"),
  "assets.allow": deny("Inputs and outputs are allowed assets"),
  "assets.unlisted": deny("No unverified tokens"),
  "assets.unpriced": deny("Tokens without a reference price: testnet only, within the cap"),
  "recipients.deny": deny("No recipient is denied"),
  "recipients.own": deny("Funds only go to your own accounts"),
  "recipients.allowlist": deny("Funds only go to your accounts or allowed recipients"),
  "limits.maxSteps": deny("Step count within the limit"),
  "limits.maxSlippageBps": deny("Slippage within the limit"),
  "limits.maxFeeUsd": deny("Network fees within the limit"),
  "limits.maxSeconds": deny("Cross-network settlement time within the limit"),
  "caps.perStepUsd": deny("Each step within the per-step cap"),
  "caps.perIntentUsd": deny("The intent within the per-intent cap"),
  "caps.dailyUsd": deny("Rolling 24 h value within the cap", "POLICY_LIMIT_REACHED"),
  "caps.weeklyUsd": deny("Rolling 7 day value within the cap", "POLICY_LIMIT_REACHED"),
  "trading.markets.allow": deny("Only allowed markets"),
  "trading.markets.deny": deny("No denied market"),
  "trading.maxNotionalUsd": deny("Order notional within the limit"),
  "trading.maxOpenNotionalUsd": deny("Open notional within the limit"),
  "trading.maxLeverage": deny("Leverage within the limit"),
  "trading.reduceOnly": deny("De-risk only: orders must be reduce-only"),
  "trading.maxOpenOrders": deny("Open orders within the limit", "POLICY_LIMIT_REACHED"),
  "trading.dailyVolumeUsd": deny("Rolling 24 h traded volume within the limit", "POLICY_LIMIT_REACHED"),
  "trading.dailyLossUsd": deny("Rolling 24 h realized loss below the stop", "POLICY_LIMIT_REACHED"),
  "trading.triggers": deny("TP/SL trigger orders allowed"),
  "trading.twap": deny("TWAP orders allowed"),
  "trading.maxSlippageBps": deny("Market-order slippage within the limit"),
  "agent.actions": deny("The agent key may sign this action type"),
  "agent.modes": deny("This execution mode is enabled"),
  "schedule.window": deny("Inside the trading schedule", "POLICY_SCHEDULE_CLOSED"),
  "confirm.aboveUsd": confirmRule("Above the confirmation threshold"),
  "confirm.leverageAbove": confirmRule("Leverage above the confirmation threshold"),
  "confirm.externalRecipient": confirmRule("Pays someone else"),
  "confirm.crossNetwork": confirmRule("Crosses networks"),
  "confirm.agentProposal": confirmRule("Proposed by an automation"),
  "confirm.unlistedAsset": confirmRule("Touches an unverified token"),
  "facts.unavailable": deny("Every fact a rule needs is known", "POLICY_FACTS_UNAVAILABLE"),
});

/** Codes by precedence when several rules deny (the most actionable first). */
const CODE_PRECEDENCE: readonly PolicyRuleInfo["code"][] = ["POLICY_PAUSED", "POLICY_DENIED", "POLICY_FACTS_UNAVAILABLE", "POLICY_LIMIT_REACHED", "POLICY_SCHEDULE_CLOSED"];

export type PolicyDecision = "allow" | "confirm" | "deny";

export interface PolicyReason {
  readonly rule: PolicyRuleId;
  readonly outcome: "deny" | "confirm";
  readonly message: string;
  readonly path?: string;
  readonly observed?: string;
  readonly limit?: string;
}

export interface PolicyRuleResult {
  readonly rule: PolicyRuleId;
  readonly status: "pass" | "fail" | "trigger";
  readonly path?: string;
  readonly observed?: string;
  readonly limit?: string;
}

/**
 * A token without a reference price the intent touches. `allowed`: testnet,
 * within the cap, valued at $0 by the USD rules (shown as an "unpriced"
 * warning); `refused`: mainnet (always), testnet `deny` mode, or over the cap.
 */
export interface UnpricedAssetNote {
  readonly asset: string;
  readonly symbol: string;
  readonly network: NetworkKey;
  /** What the intent does with it: spends it (`input`, `cost`) or receives it (`output`). */
  readonly role: "input" | "output" | "cost";
  /** Base units the intent spends of it (inputs and costs summed per intent) or receives. */
  readonly amount: string;
  readonly decimals: number;
  /** Whole-token cap that applied (spent amounts on testnet), null when none applies. */
  readonly cap: string | null;
  readonly status: "allowed" | "refused";
  readonly message: string;
  readonly path: string;
}

export interface PolicyEvaluation {
  readonly decision: PolicyDecision;
  /** Every deny and confirm, in evaluation order. */
  readonly reasons: readonly PolicyReason[];
  /** Every evaluated rule, passes included (for the guardrails page). */
  readonly rules: readonly PolicyRuleResult[];
  /** Fresh USD value of the intent; null when unpriced. */
  readonly notionalUsdMicros: bigint | null;
  /** Error code of a deny (or POLICY_CONFIRMATION_REQUIRED), null when allowed. */
  readonly code: PolicyRuleInfo["code"] | null;
  /** Schedule: seconds until the next opening when closed. */
  readonly retryAfterSeconds: number | null;
  /** Tokens without a reference price (empty when every asset is priced). */
  readonly unpriced?: readonly UnpricedAssetNote[];
}

/* ------------------------------------------------------------ schedule */

export interface ScheduleState {
  readonly open: boolean;
  /** ISO time of the next opening or closing within 8 days; null when it never changes. */
  readonly nextChange: string | null;
  readonly retryAfterSeconds: number | null;
  /** The zone could not be read: treated as closed (fail closed). */
  readonly error?: true;
}

const WEEKDAY_SHORT: Readonly<Record<string, number>> = Object.freeze({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 });

function localMinuteOfWeek(formatter: Intl.DateTimeFormat, time: number): number {
  const parts = formatter.formatToParts(new Date(time));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = WEEKDAY_SHORT[value("weekday")];
  const hour = Number(value("hour")) % 24;
  const minute = Number(value("minute"));
  if (day === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Unexpected time format.");
  return day * 1_440 + hour * 60 + minute;
}

function openAt(schedule: NonNullable<RuleBook["schedule"]>, minuteOfWeek: number): boolean {
  const day = WEEKDAYS[Math.floor(minuteOfWeek / 1_440)] as Weekday;
  const minute = minuteOfWeek % 1_440;
  return schedule.windows.some((window) => window.days.includes(day) && minute >= (timeMinutes(window.from) ?? 0) && minute < (timeMinutes(window.to) ?? 0));
}

/** Whether `now` is inside a window (read in the schedule's IANA zone, DST included) and when that changes. */
export function scheduleState(schedule: RuleBook["schedule"] | undefined, now: number = Date.now()): ScheduleState {
  if (!schedule) return { open: true, nextChange: null, retryAfterSeconds: null };
  let formatter: Intl.DateTimeFormat;
  let current: number;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    current = localMinuteOfWeek(formatter, now);
  } catch {
    return { open: false, nextChange: null, retryAfterSeconds: null, error: true };
  }
  const open = openAt(schedule, current);
  const startOfNextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
  let local = (current + 1) % 10_080;
  let nextChange: number | null = null;
  for (let step = 0; step < 8 * 1_440; step += 1) {
    const candidate = startOfNextMinute + step * 60_000;
    // Re-read the wall clock every 15 minutes so DST shifts are seen.
    if (candidate % 900_000 === 0 || step === 0) local = localMinuteOfWeek(formatter, candidate);
    if (openAt(schedule, local) !== open) {
      nextChange = candidate;
      break;
    }
    local = (local + 1) % 10_080;
  }
  return {
    open,
    nextChange: nextChange === null ? null : new Date(nextChange).toISOString(),
    retryAfterSeconds: open || nextChange === null ? null : Math.min(86_400, Math.max(1, Math.ceil((nextChange - now) / 1_000))),
  };
}

/* ----------------------------------------------------------- evaluation */

/** Kinds that move no value of their own: a missing input is not an unknown amount. */
const NO_VALUE_KINDS: ReadonlySet<StepKind> = new Set(["approve", "claim", "agent", "cancel", "leverage", "alert", "automation"]);
/** Kinds that lower risk: allowed through the kill switch. */
function derisking(step: StepFact): boolean {
  if (step.kind === "cancel") return true;
  return (step.kind === "order" || step.kind === "twap") && step.trade?.reduceOnly === true;
}

/** Symbols and groups come from the registry only: an unlisted token matches nothing but its exact CAIP-19 id. */
function assetEntryMatches(asset: AssetFact, entry: string): boolean {
  const id = normalizeAssetId(asset.asset);
  if (entry.includes("/")) return id === entry;
  const listed = getToken(asset.asset);
  if (!listed) return false;
  if (entry.startsWith("group:")) return listed.group === entry.slice(6);
  const at = entry.lastIndexOf("@");
  if (at > 0) return listed.symbol.toUpperCase() === entry.slice(0, at).toUpperCase() && listed.network === entry.slice(at + 1);
  return listed.symbol.toUpperCase() === entry.toUpperCase();
}

function marketMatches(trade: TradeFact, entries: readonly string[]): boolean {
  const names = [trade.market, trade.displayName].map((name) => (name === undefined ? null : normalizeMarketEntry(name))).filter((name): name is string => name !== null);
  return entries.some((entry) => names.includes(entry) || (trade.displayName !== undefined && entry === normalizeMarketEntry(trade.displayName.split("/")[0])));
}

/**
 * Fresh value of an intent: inputs of root steps plus every extra cost, and
 * for trades the order notional (reduce-only trades count zero). Null when
 * anything that counts is unpriced.
 */
export function intentNotionalUsdMicros(steps: readonly StepFact[]): { readonly value: bigint | null; readonly unpriced: readonly string[] } {
  let total = 0n;
  const unpriced: string[] = [];
  for (const step of steps) {
    const path = `steps[${step.index}]`;
    if (step.trade) {
      if (!step.trade.reduceOnly) {
        if (step.trade.notionalUsdMicros === null) unpriced.push(`${path}.trade`);
        else total += step.trade.notionalUsdMicros;
      }
    } else if (step.root) {
      if (step.inputs.length === 0 && !NO_VALUE_KINDS.has(step.kind)) unpriced.push(`${path}.inputs`);
      step.inputs.forEach((input, index) => {
        if (input.usdMicros === null) unpriced.push(`${path}.inputs[${index}]`);
        else total += input.usdMicros;
      });
    }
    (step.extraCosts ?? []).forEach((cost, index) => {
      if (cost.usdMicros === null) unpriced.push(`${path}.extraCosts[${index}]`);
      else total += cost.usdMicros;
    });
  }
  return { value: unpriced.length > 0 ? null : total, unpriced };
}

interface UnpricedResolution {
  /** The steps with allowed unpriced amounts valued at $0. */
  readonly steps: readonly StepFact[];
  readonly notes: readonly UnpricedAssetNote[];
}

function environmentOf(asset: string): "testnet" | "mainnet" | null {
  const parsed = parseAssetId(asset);
  return parsed ? parsed.network.environment : null;
}

function wholeTokens(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${units / scale}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Applies the unpriced-token policy (owner decision 2026-11-01): mainnet
 * always refuses a token without a reference price; testnet allows one up to
 * a cap in token units (summed per intent over what the intent spends) unless
 * the book says `deny`. Allowed amounts are valued at $0 for the USD rules;
 * refused ones stay unpriced (null), so the USD rules fail closed as well.
 */
function resolveUnpriced(book: RuleBook, steps: readonly StepFact[]): UnpricedResolution {
  const rules = effectiveUnpriced(book);
  const notes: UnpricedAssetNote[] = [];
  const allowed = new Set<string>();
  // Spent amounts per asset: what intentNotionalUsdMicros counts (root inputs of non-trade steps, every extra cost).
  const spent = new Map<string, { fact: AssetFact; units: bigint; role: "input" | "cost"; path: string }>();
  const received = new Map<string, { fact: AssetFact; units: bigint; path: string }>();
  for (const step of steps) {
    if (derisking(step)) continue;
    const counted = step.trade === undefined && step.root;
    step.inputs.forEach((input, index) => {
      if (input.usdMicros !== null || input.noReference !== true || !counted) return;
      const key = normalizeAssetId(input.asset);
      const entry = spent.get(key);
      spent.set(key, { fact: input, units: (entry?.units ?? 0n) + BigInt(input.amount), role: entry?.role ?? "input", path: entry?.path ?? `steps[${step.index}].inputs[${index}]` });
    });
    (step.extraCosts ?? []).forEach((cost, index) => {
      if (cost.usdMicros !== null || cost.noReference !== true) return;
      const key = normalizeAssetId(cost.asset);
      const entry = spent.get(key);
      spent.set(key, { fact: cost, units: (entry?.units ?? 0n) + BigInt(cost.amount), role: entry?.role ?? "cost", path: entry?.path ?? `steps[${step.index}].extraCosts[${index}]` });
    });
    [...(counted ? [] : step.inputs.map((input, index) => ({ fact: input, path: `steps[${step.index}].inputs[${index}]` }))), ...step.outputs.map((output, index) => ({ fact: output, path: `steps[${step.index}].outputs[${index}]` }))].forEach(({ fact, path }) => {
      if (fact.usdMicros !== null || fact.noReference !== true) return;
      const key = normalizeAssetId(fact.asset);
      if (!received.has(key)) received.set(key, { fact, units: BigInt(fact.amount), path });
    });
  }
  const networkOf = (asset: string) => parseAssetId(asset)?.network.key ?? null;
  for (const [key, entry] of spent) {
    const network = networkOf(entry.fact.asset);
    if (network === null) continue;
    const environment = environmentOf(entry.fact.asset);
    const base = { asset: entry.fact.asset, symbol: entry.fact.symbol, network, role: entry.role, amount: entry.units.toString(), decimals: entry.fact.decimals, path: entry.path } as const;
    if (environment !== "testnet") {
      notes.push({ ...base, cap: null, status: "refused", message: `${entry.fact.symbol} has no reference price: on mainnet Elyia never moves a token it cannot value.` });
      continue;
    }
    if (rules.testnet === "deny") {
      notes.push({ ...base, cap: null, status: "refused", message: `${entry.fact.symbol} has no reference price and your rules refuse unpriced tokens on testnet.` });
      continue;
    }
    const caps = rules.tokens.filter((cap) => assetEntryMatches(entry.fact, cap.asset)).map((cap) => cap.max);
    const capText = caps.length > 0 ? caps.reduce((low, cap) => (tokenAmountUnits(cap, 18) < tokenAmountUnits(low, 18) ? cap : low)) : rules.defaultMax;
    const cap = tokenAmountUnits(capText, entry.fact.decimals);
    if (entry.units > cap) {
      notes.push({ ...base, cap: capText, status: "refused", message: `${wholeTokens(entry.units, entry.fact.decimals)} ${entry.fact.symbol} is above the ${capText} ${entry.fact.symbol} cap for tokens without a reference price.` });
    } else {
      allowed.add(key);
      notes.push({ ...base, cap: capText, status: "allowed", message: `${entry.fact.symbol} has no reference price: testnet only, capped at ${capText} ${entry.fact.symbol} per intent; USD totals count it as $0.` });
    }
  }
  for (const [key, entry] of received) {
    if (spent.has(key)) continue;
    const network = networkOf(entry.fact.asset);
    if (network === null) continue;
    const environment = environmentOf(entry.fact.asset);
    const base = { asset: entry.fact.asset, symbol: entry.fact.symbol, network, role: "output", amount: entry.units.toString(), decimals: entry.fact.decimals, cap: null, path: entry.path } as const;
    if (environment !== "testnet") notes.push({ ...base, status: "refused", message: `${entry.fact.symbol} has no reference price: on mainnet Elyia never routes into a token it cannot value.` });
    else if (rules.testnet === "deny") notes.push({ ...base, status: "refused", message: `${entry.fact.symbol} has no reference price and your rules refuse unpriced tokens on testnet.` });
    else {
      allowed.add(key);
      notes.push({ ...base, status: "allowed", message: `${entry.fact.symbol} has no reference price (testnet): its value is unknown and shown as unpriced.` });
    }
  }
  if (allowed.size === 0) return { steps, notes };
  const zero = (fact: AssetFact): AssetFact => (fact.usdMicros === null && allowed.has(normalizeAssetId(fact.asset)) ? { ...fact, usdMicros: 0n } : fact);
  return {
    steps: steps.map((step) => ({ ...step, inputs: step.inputs.map(zero), outputs: step.outputs.map(zero), ...(step.extraCosts ? { extraCosts: step.extraCosts.map(zero) } : {}) })),
    notes,
  };
}

/** Evaluates one rule book against facts (use DEFAULT_RULE_BOOK when the user has not written one). */
export function evaluatePolicy(book: RuleBook, facts: PolicyFacts): PolicyEvaluation {
  const reasons: PolicyReason[] = [];
  const rules: PolicyRuleResult[] = [];
  const missing: string[] = [];
  let retryAfterSeconds: number | null = null;
  const enforcing = facts.stage === "prepare" || facts.stage === "sign";

  const pass = (rule: PolicyRuleId, detail: Omit<PolicyRuleResult, "rule" | "status"> = {}) => rules.push({ rule, status: "pass", ...detail });
  const fail = (rule: PolicyRuleId, message: string, detail: Omit<PolicyRuleResult, "rule" | "status"> = {}) => {
    reasons.push({ rule, outcome: "deny", message, ...detail });
    rules.push({ rule, status: "fail", ...detail });
  };
  const raise = (rule: PolicyRuleId, message: string, detail: Omit<PolicyRuleResult, "rule" | "status"> = {}) => {
    reasons.push({ rule, outcome: "confirm", message, ...detail });
    rules.push({ rule, status: "trigger", ...detail });
  };
  /** One result per rule, failing on each offender. */
  const each = <T>(rule: PolicyRuleId, items: readonly T[], test: (item: T) => { readonly path: string; readonly message: string; readonly observed?: string } | null, limit?: string) => {
    let failed = false;
    for (const item of items) {
      const problem = test(item);
      if (problem) {
        failed = true;
        fail(rule, problem.message, { path: problem.path, ...(problem.observed !== undefined ? { observed: problem.observed } : {}), ...(limit !== undefined ? { limit } : {}) });
      }
    }
    if (!failed) pass(rule, limit !== undefined ? { limit } : {});
  };
  const need = (path: string) => missing.push(path);

  const unpriced = resolveUnpriced(book, facts.steps);
  const steps = unpriced.steps;
  const risky = steps.filter((step) => !derisking(step));
  const trades = steps.filter((step): step is StepFact & { readonly trade: TradeFact } => step.trade !== undefined);
  const riskyTrades = trades.filter((step) => !step.trade.reduceOnly);

  /* service */
  const mode = book.mode ?? "live";
  if (mode === "paused") {
    each("mode.paused", risky, (step) => ({ path: `steps[${step.index}]`, message: "The kill switch is on: only closing positions and cancelling orders run.", observed: step.kind }), "paused");
  } else pass("mode.paused", { observed: mode });
  if (mode === "dry-run") {
    if (facts.stored || enforcing) fail("mode.dryRun", "Dry-run mode: Elyia plans and quotes, but nothing is stored, prepared or signed.", { observed: facts.stored ? "stored intent" : facts.stage });
    else pass("mode.dryRun", { observed: "dry run" });
  }

  /* where */
  const networksOf = (step: StepFact) => [
    { network: step.network, path: `steps[${step.index}].network` },
    ...(step.destinationNetwork && step.destinationNetwork !== step.network ? [{ network: step.destinationNetwork, path: `steps[${step.index}].destinationNetwork` }] : []),
  ];
  if (book.networks?.allow) {
    const allow = book.networks.allow;
    each("networks.allow", steps.flatMap(networksOf), (entry) => (allow.includes(entry.network) ? null : { path: entry.path, message: `${NETWORKS[entry.network].name} is not an allowed network.`, observed: entry.network }), allow.join(", "));
  }
  if (book.networks?.environments) {
    const environments = book.networks.environments as readonly string[];
    each("networks.environments", steps.flatMap(networksOf), (entry) => (environments.includes(NETWORKS[entry.network].environment) ? null : { path: entry.path, message: `${NETWORKS[entry.network].name} is ${NETWORKS[entry.network].environment}, which your rules do not allow.`, observed: NETWORKS[entry.network].environment }), environments.join(", "));
  }

  /* what */
  if (book.kinds?.allow) {
    const allow = book.kinds.allow;
    each("kinds.allow", steps, (step) => (allow.includes(step.kind) ? null : { path: `steps[${step.index}].kind`, message: `${step.kind} steps are not allowed.`, observed: step.kind }), allow.join(", "));
  }
  if (book.protocols?.allow) {
    const allow = book.protocols.allow;
    each("protocols.allow", steps, (step) => (allow.includes(step.protocol) ? null : { path: `steps[${step.index}].protocol`, message: `${getProtocol(step.protocol)?.name ?? step.protocol} is not an allowed protocol.`, observed: step.protocol }), allow.join(", "));
  }
  if (book.protocols?.deny) {
    const denied = book.protocols.deny;
    each("protocols.deny", steps, (step) => (denied.includes(step.protocol) ? { path: `steps[${step.index}].protocol`, message: `${getProtocol(step.protocol)?.name ?? step.protocol} is denied.`, observed: step.protocol } : null), denied.join(", "));
  }
  const assetsOf = (step: StepFact) => [
    ...step.inputs.map((asset, index) => ({ asset, path: `steps[${step.index}].inputs[${index}]` })),
    ...step.outputs.map((asset, index) => ({ asset, path: `steps[${step.index}].outputs[${index}]` })),
  ];
  const stepAssets = steps.flatMap(assetsOf);
  if (book.assets?.allow) {
    const allow = book.assets.allow;
    each("assets.allow", stepAssets, (entry) => (allow.some((pattern) => assetEntryMatches(entry.asset, pattern)) ? null : { path: entry.path, message: `${entry.asset.symbol} is not an allowed asset.`, observed: entry.asset.asset }), allow.join(", "));
  }
  if (book.assets?.unlisted === "deny") {
    each("assets.unlisted", stepAssets, (entry) => (entry.asset.listed ? null : { path: entry.path, message: `${entry.asset.symbol} is not a verified token.`, observed: entry.asset.asset }), "verified tokens only");
  }
  if (unpriced.notes.length > 0) {
    each(
      "assets.unpriced",
      unpriced.notes,
      (note) => (note.status === "refused" ? { path: note.path, message: note.message, observed: `${wholeTokens(BigInt(note.amount), note.decimals)} ${note.symbol} on ${note.network}` } : null),
      `testnet only; ${effectiveUnpriced(book).testnet === "deny" ? "refused" : `cap ${effectiveUnpriced(book).defaultMax} tokens unless set per token`}`,
    );
  }

  /* who */
  const own = facts.accounts;
  const external = (step: StepFact) => !own.some((account) => sameOwner(account, step.recipient));
  const recipients = book.recipients;
  if (recipients?.deny) {
    const denied = recipients.deny;
    each("recipients.deny", steps, (step) => (denied.some((pattern) => accountMatchesPattern(step.recipient, pattern)) ? { path: `steps[${step.index}].recipient`, message: "This recipient is denied by your rules.", observed: step.recipient } : null), `${denied.length} denied`);
  }
  const recipientMode = recipients?.mode ?? "any";
  if (recipientMode === "own") {
    each("recipients.own", steps, (step) => (external(step) ? { path: `steps[${step.index}].recipient`, message: "Your rules only send funds to your own accounts.", observed: step.recipient } : null), "own accounts");
  } else if (recipientMode === "allowlist") {
    const allow = recipients?.allow ?? [];
    each(
      "recipients.allowlist",
      steps,
      (step) => (!external(step) || allow.some((pattern) => accountMatchesPattern(step.recipient, pattern)) ? null : { path: `steps[${step.index}].recipient`, message: "This recipient is not on your allowlist.", observed: step.recipient }),
      `${allow.length} allowed`,
    );
  }

  /* how much */
  const notional = intentNotionalUsdMicros(steps);
  const needNotional = (rule: PolicyRuleId): bigint | null => {
    if (notional.value === null) notional.unpriced.forEach((path) => need(`${path} (${rule})`));
    return notional.value;
  };
  const limits = book.limits;
  if (limits?.maxSteps !== undefined) {
    if (steps.length > limits.maxSteps) fail("limits.maxSteps", `${steps.length} steps exceed your limit.`, { observed: String(steps.length), limit: String(limits.maxSteps) });
    else pass("limits.maxSteps", { observed: String(steps.length), limit: String(limits.maxSteps) });
  }
  if (limits?.maxSlippageBps !== undefined) {
    const max = limits.maxSlippageBps;
    each("limits.maxSlippageBps", steps.filter((step) => step.slippageBps !== undefined), (step) => ((step.slippageBps ?? 0) > max ? { path: `steps[${step.index}].slippageBps`, message: `Slippage ${step.slippageBps} bps is above your limit.`, observed: String(step.slippageBps) } : null), String(max));
  }
  if (limits?.maxFeeUsd !== undefined) {
    const max = usdMicros(limits.maxFeeUsd);
    const fees = facts.feesUsdMicros;
    if (fees === undefined || fees === null) need("intent.feesUsd (limits.maxFeeUsd)");
    else if (fees > max) fail("limits.maxFeeUsd", `Fees of $${formatUsdMicros(fees)} are above your limit.`, { observed: formatUsdMicros(fees), limit: formatUsdMicros(max) });
    else pass("limits.maxFeeUsd", { observed: formatUsdMicros(fees), limit: formatUsdMicros(max) });
  }
  if (limits?.maxSeconds !== undefined) {
    const max = limits.maxSeconds;
    each(
      "limits.maxSeconds",
      steps.filter((step) => step.destinationNetwork !== undefined && step.destinationNetwork !== step.network),
      (step) => {
        if (step.estimatedSeconds === undefined) {
          need(`steps[${step.index}].estimatedSeconds (limits.maxSeconds)`);
          return null;
        }
        return step.estimatedSeconds > max ? { path: `steps[${step.index}].estimatedSeconds`, message: `Settlement takes about ${step.estimatedSeconds} s, above your limit.`, observed: String(step.estimatedSeconds) } : null;
      },
      String(max),
    );
  }
  const caps = book.caps;
  if (caps?.perStepUsd !== undefined) {
    const max = usdMicros(caps.perStepUsd);
    each(
      "caps.perStepUsd",
      risky,
      (step) => {
        const value = step.trade ? step.trade.notionalUsdMicros : step.inputs.length === 0 ? (NO_VALUE_KINDS.has(step.kind) ? 0n : null) : step.inputs.reduce<bigint | null>((sum, input) => (sum === null || input.usdMicros === null ? null : sum + input.usdMicros), 0n);
        if (value === null) {
          need(`steps[${step.index}] (caps.perStepUsd)`);
          return null;
        }
        return value > max ? { path: `steps[${step.index}]`, message: `This step moves $${formatUsdMicros(value)}, above your per-step cap.`, observed: formatUsdMicros(value) } : null;
      },
      formatUsdMicros(max),
    );
  }
  if (caps?.perIntentUsd !== undefined) {
    const max = usdMicros(caps.perIntentUsd);
    const value = needNotional("caps.perIntentUsd");
    if (value !== null) {
      if (value > max) fail("caps.perIntentUsd", `This moves $${formatUsdMicros(value)}, above your per-intent cap.`, { observed: formatUsdMicros(value), limit: formatUsdMicros(max) });
      else pass("caps.perIntentUsd", { observed: formatUsdMicros(value), limit: formatUsdMicros(max) });
    }
  }
  for (const [rule, cap, window] of [
    ["caps.dailyUsd", caps?.dailyUsd, "dayUsdMicros"],
    ["caps.weeklyUsd", caps?.weeklyUsd, "weekUsdMicros"],
  ] as const) {
    if (cap === undefined) continue;
    const max = usdMicros(cap);
    const value = needNotional(rule);
    const used = facts.usage?.[window];
    if (used === undefined) need(`usage.${window} (${rule})`);
    if (value === null || used === undefined) continue;
    const observed = `${formatUsdMicros(value)} + ${formatUsdMicros(used)} used`;
    if (used + value > max) fail(rule, `This would bring the window to $${formatUsdMicros(used + value)}, above your cap.`, { observed, limit: formatUsdMicros(max) });
    else pass(rule, { observed, limit: formatUsdMicros(max) });
  }

  /* trading */
  const trading = book.trading;
  if (trading?.markets?.allow) {
    const allow = trading.markets.allow;
    each("trading.markets.allow", trades, (step) => (marketMatches(step.trade, allow) ? null : { path: `steps[${step.index}].trade.market`, message: `${step.trade.displayName ?? step.trade.market} is not on your market list.`, observed: step.trade.market }), allow.join(", "));
  }
  if (trading?.markets?.deny) {
    const denied = trading.markets.deny;
    each("trading.markets.deny", trades, (step) => (marketMatches(step.trade, denied) ? { path: `steps[${step.index}].trade.market`, message: `${step.trade.displayName ?? step.trade.market} is denied by your rules.`, observed: step.trade.market } : null), denied.join(", "));
  }
  if (trading?.maxNotionalUsd !== undefined) {
    const max = usdMicros(trading.maxNotionalUsd);
    each(
      "trading.maxNotionalUsd",
      riskyTrades,
      (step) => {
        const value = step.trade.notionalUsdMicros;
        if (value === null) {
          need(`steps[${step.index}].trade.notional (trading.maxNotionalUsd)`);
          return null;
        }
        return value > max ? { path: `steps[${step.index}].trade`, message: `This order is worth $${formatUsdMicros(value)}, above your per-order limit.`, observed: formatUsdMicros(value) } : null;
      },
      formatUsdMicros(max),
    );
  }
  const riskyNotional = riskyTrades.reduce<bigint | null>((sum, step) => (sum === null || step.trade.notionalUsdMicros === null ? null : sum + step.trade.notionalUsdMicros), 0n);
  if (trading?.maxOpenNotionalUsd !== undefined && riskyTrades.some((step) => step.trade.marketKind === "perp")) {
    const max = usdMicros(trading.maxOpenNotionalUsd);
    const open = facts.trading?.openNotionalUsdMicros;
    if (open === undefined || open === null) need("trading.openNotional (trading.maxOpenNotionalUsd)");
    if (riskyNotional === null) need("trades.notional (trading.maxOpenNotionalUsd)");
    if (open !== undefined && open !== null && riskyNotional !== null) {
      const after = open + riskyNotional;
      if (after > max) fail("trading.maxOpenNotionalUsd", `Open positions would reach $${formatUsdMicros(after)}, above your limit.`, { observed: formatUsdMicros(after), limit: formatUsdMicros(max) });
      else pass("trading.maxOpenNotionalUsd", { observed: formatUsdMicros(after), limit: formatUsdMicros(max) });
    }
  }
  const leverageSteps = steps.filter((step) => (step.trade !== undefined && !step.trade.reduceOnly && step.trade.marketKind === "perp") || step.kind === "leverage");
  if (trading?.maxLeverage !== undefined) {
    const max = trading.maxLeverage;
    each(
      "trading.maxLeverage",
      leverageSteps,
      (step) => {
        const leverage = step.trade?.leverage ?? null;
        if (leverage === null) {
          need(`steps[${step.index}].trade.leverage (trading.maxLeverage)`);
          return null;
        }
        return leverage > max ? { path: `steps[${step.index}].trade.leverage`, message: `${leverage}x is above your ${max}x limit.`, observed: `${leverage}x` } : null;
      },
      `${max}x`,
    );
  }
  if (trading?.reduceOnly === true) {
    each("trading.reduceOnly", trades, (step) => (step.trade.reduceOnly ? null : { path: `steps[${step.index}].trade`, message: "Your rules are in de-risk mode: only reduce-only orders.", observed: "opens risk" }), "reduce-only");
  }
  if (trading?.maxOpenOrders !== undefined) {
    const placing = steps.filter((step) => step.kind === "order" && step.trade !== undefined).length;
    if (placing > 0) {
      const open = facts.trading?.openOrders;
      if (open === undefined || open === null) need("trading.openOrders (trading.maxOpenOrders)");
      else if (open + placing > trading.maxOpenOrders) fail("trading.maxOpenOrders", `You would have ${open + placing} open orders, above your limit.`, { observed: String(open + placing), limit: String(trading.maxOpenOrders) });
      else pass("trading.maxOpenOrders", { observed: String(open + placing), limit: String(trading.maxOpenOrders) });
    }
  }
  if (trading?.dailyVolumeUsd !== undefined && riskyTrades.length > 0) {
    const max = usdMicros(trading.dailyVolumeUsd);
    const used = facts.trading?.dayVolumeUsdMicros;
    if (used === undefined || used === null) need("trading.dayVolume (trading.dailyVolumeUsd)");
    if (riskyNotional === null) need("trades.notional (trading.dailyVolumeUsd)");
    if (used !== undefined && used !== null && riskyNotional !== null) {
      const observed = `${formatUsdMicros(riskyNotional)} + ${formatUsdMicros(used)} traded`;
      if (used + riskyNotional > max) fail("trading.dailyVolumeUsd", "This would pass your 24 h trading volume limit.", { observed, limit: formatUsdMicros(max) });
      else pass("trading.dailyVolumeUsd", { observed, limit: formatUsdMicros(max) });
    }
  }
  if (trading?.dailyLossUsd !== undefined && riskyTrades.length > 0) {
    const max = usdMicros(trading.dailyLossUsd);
    const loss = facts.trading?.dayRealizedLossUsdMicros;
    if (loss === undefined || loss === null) need("trading.dayRealizedLoss (trading.dailyLossUsd)");
    else if (loss >= max) fail("trading.dailyLossUsd", `You lost $${formatUsdMicros(loss)} in 24 h, reaching your loss stop: only closing positions runs now.`, { observed: formatUsdMicros(loss), limit: formatUsdMicros(max) });
    else pass("trading.dailyLossUsd", { observed: formatUsdMicros(loss), limit: formatUsdMicros(max) });
  }
  if (trading?.triggers === false) {
    each("trading.triggers", trades, (step) => (step.trade.isTrigger ? { path: `steps[${step.index}].trade`, message: "Your rules do not allow TP/SL trigger orders.", observed: "trigger" } : null), "no triggers");
  }
  if (trading?.twap === false) {
    each("trading.twap", steps, (step) => (step.kind === "twap" || step.trade?.isTwap === true ? { path: `steps[${step.index}]`, message: "Your rules do not allow TWAP orders.", observed: "twap" } : null), "no twap");
  }
  if (trading?.maxSlippageBps !== undefined) {
    const max = trading.maxSlippageBps;
    each(
      "trading.maxSlippageBps",
      trades.filter((step) => step.trade.slippageBps !== undefined),
      (step) => {
        const bps = step.trade.slippageBps ?? null;
        if (bps === null) {
          need(`steps[${step.index}].trade.slippage (trading.maxSlippageBps)`);
          return null;
        }
        return bps > max ? { path: `steps[${step.index}].trade.slippageBps`, message: `This market order allows ${bps} bps of slippage, above your limit.`, observed: String(bps) } : null;
      },
      String(max),
    );
  }

  /* agent */
  const agentSteps = steps.filter((step) => step.signer === "agent" || step.signer === "keeper");
  if (agentSteps.length > 0) {
    const allowed = book.agent?.actions ?? DEFAULT_AGENT_ACTIONS;
    each(
      "agent.actions",
      agentSteps,
      (step) => {
        // Hard floor whatever the book says: agents only ever sign trading L1 actions, and the Keeper fewer still.
        const floor: readonly L1ActionType[] = step.signer === "keeper" ? KEEPER_SIGNABLE_ACTIONS : AGENT_SIGNABLE_ACTIONS;
        if (step.agentAction === undefined) return { path: `steps[${step.index}].agentAction`, message: "An agent signature needs a known HyperCore action type.", observed: "unknown" };
        if (!floor.includes(step.agentAction)) return { path: `steps[${step.index}].agentAction`, message: `The ${step.signer} key may never sign ${step.agentAction}.`, observed: step.agentAction };
        return allowed.includes(step.agentAction) ? null : { path: `steps[${step.index}].agentAction`, message: `Your rules do not let the agent sign ${step.agentAction}.`, observed: step.agentAction };
      },
      allowed.join(", "),
    );
  }
  const modes = book.agent?.modes ?? DEFAULT_AGENT_MODES;
  const modeOf = (signer: StepFact["signer"]): AgentMode | null => (signer === "keeper" ? "keeper" : signer === "agent" ? "browser" : signer === "wallet" ? "propose" : null);
  // Automations must use enabled modes; the Keeper must be enabled whoever asks.
  const usedModes = [...new Set(steps.map((step) => modeOf(step.signer)).filter((mode): mode is AgentMode => mode !== null))].filter((mode) => facts.origin === "automation" || mode === "keeper");
  if (usedModes.length > 0) {
    const blocked = usedModes.filter((mode) => !modes.includes(mode));
    if (blocked.length === 0) pass("agent.modes", { observed: usedModes.join(", "), limit: modes.join(", ") });
    else fail("agent.modes", blocked.includes("keeper") ? "Keeper mode is not enabled in your rules." : `Automations may not run in ${blocked.join(", ")} mode under your rules.`, { observed: blocked.join(", "), limit: modes.join(", ") });
  }

  /* when */
  if (book.schedule) {
    const state = scheduleState(book.schedule, facts.now ?? Date.now());
    if (state.open) pass("schedule.window", { observed: "open", limit: book.schedule.timezone });
    else if (risky.length > 0) {
      const message = state.error
        ? `The time zone ${book.schedule.timezone} cannot be read here.`
        : `Outside your trading schedule (${book.schedule.timezone})${state.nextChange ? `; it opens ${state.nextChange}` : ""}.`;
      fail("schedule.window", message, { observed: "closed", limit: book.schedule.timezone });
      retryAfterSeconds = state.retryAfterSeconds;
    } else pass("schedule.window", { observed: "closed, de-risking only" });
  }

  /* confirmations */
  const confirm = book.confirm;
  if (confirm?.aboveUsd !== undefined) {
    const threshold = usdMicros(confirm.aboveUsd);
    const value = needNotional("confirm.aboveUsd");
    if (value !== null && value > threshold) raise("confirm.aboveUsd", `This moves $${formatUsdMicros(value)}, above your confirmation threshold.`, { observed: formatUsdMicros(value), limit: formatUsdMicros(threshold) });
    else if (value !== null) pass("confirm.aboveUsd", { observed: formatUsdMicros(value), limit: formatUsdMicros(threshold) });
  }
  if (confirm?.leverageAbove !== undefined) {
    const threshold = confirm.leverageAbove;
    let triggered = false;
    for (const step of leverageSteps) {
      const leverage = step.trade?.leverage ?? null;
      if (leverage === null) need(`steps[${step.index}].trade.leverage (confirm.leverageAbove)`);
      else if (leverage > threshold) {
        triggered = true;
        raise("confirm.leverageAbove", `${leverage}x is above ${threshold}x: confirm it.`, { path: `steps[${step.index}].trade.leverage`, observed: `${leverage}x`, limit: `${threshold}x` });
      }
    }
    if (!triggered) pass("confirm.leverageAbove", { limit: `${threshold}x` });
  }
  const when = confirm?.when ?? [];
  if (when.includes("external-recipient")) {
    const outside = steps.find(external);
    if (outside) raise("confirm.externalRecipient", "This pays an account that is not yours.", { path: `steps[${outside.index}].recipient`, observed: outside.recipient });
    else pass("confirm.externalRecipient");
  }
  if (when.includes("cross-network")) {
    if (steps.some((step) => step.destinationNetwork !== undefined && step.destinationNetwork !== step.network)) raise("confirm.crossNetwork", "This moves funds between networks.");
    else pass("confirm.crossNetwork");
  }
  if (when.includes("agent-proposal")) {
    if (facts.origin === "automation") raise("confirm.agentProposal", "An automation proposed this.");
    else pass("confirm.agentProposal");
  }
  if (when.includes("unlisted-asset")) {
    const unlisted = stepAssets.find((entry) => !entry.asset.listed);
    if (unlisted) raise("confirm.unlistedAsset", `${unlisted.asset.symbol} is not a verified token: check it before confirming.`, { path: unlisted.path, observed: unlisted.asset.asset });
    else pass("confirm.unlistedAsset");
  }

  if (missing.length > 0) {
    fail("facts.unavailable", "A fact your rules need is unknown (price, open orders, volume or leverage), so Elyia refuses rather than guess.", {
      path: missing[0] as string,
      observed: [...new Set(missing)].slice(0, 6).join(", "),
    });
  }

  const denied = reasons.filter((reason) => reason.outcome === "deny");
  const decision: PolicyDecision = denied.length > 0 ? "deny" : reasons.length > 0 ? "confirm" : "allow";
  const codes = new Set(denied.map((reason) => POLICY_RULES[reason.rule].code));
  const code = decision === "deny" ? (CODE_PRECEDENCE.find((candidate) => codes.has(candidate)) ?? "POLICY_DENIED") : decision === "confirm" ? "POLICY_CONFIRMATION_REQUIRED" : null;
  return {
    decision,
    reasons,
    rules,
    notionalUsdMicros: notional.value,
    code,
    retryAfterSeconds: denied.some((reason) => reason.rule === "schedule.window") ? retryAfterSeconds : null,
    unpriced: unpriced.notes,
  };
}

/* --------------------------------------------------------- facts builder */

export interface FactSources {
  readonly stage: PolicyStage;
  readonly origin?: "user" | "automation";
  readonly stored?: boolean;
  /** Conservative price of one whole unit of `asset` in micro-dollars, or null when unpriced. */
  readonly priceUsdMicros: (asset: string) => bigint | null;
  /**
   * Whether a reference price source exists for `asset` at all. False marks a
   * null price as "this token has no reference price" (the `unpriced` rules
   * apply); absent or true keeps a null price fail-closed.
   */
  readonly hasReferencePrice?: (asset: string) => boolean;
  /** USD price of one unit of a market's base asset (spot pairs, TWAPs), micro-dollars; null = unpriced. */
  readonly marketPriceUsdMicros?: (market: string, kind: "perp" | "spot") => bigint | null;
  /** Current leverage on a perp market when the intent does not set it; null = unknown. */
  readonly currentLeverage?: (market: string) => number | null;
  readonly feesUsdMicros?: bigint | null;
  readonly usage?: PolicyFacts["usage"];
  readonly trading?: TradingFacts;
  readonly now?: number;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function assetFact(amount: StepAmount, price: (asset: string) => bigint | null, hasReference?: (asset: string) => boolean): AssetFact {
  const parsed = parseAssetId(amount.asset);
  const hypercoreNative = parsed !== null && parsed.network.vm === "hypercore";
  const token = getToken(amount.asset);
  const unitPrice = price(amount.asset);
  const units = BigInt(amount.maximum ?? amount.expected);
  return {
    asset: amount.asset,
    symbol: amount.symbol,
    decimals: amount.decimals,
    amount: units.toString(),
    listed: token !== null || hypercoreNative,
    ...(token?.group ? { group: token.group } : {}),
    usdMicros: unitPrice === null ? null : ceilDiv(units * unitPrice, 10n ** BigInt(amount.decimals)),
    ...(unitPrice === null && hasReference !== undefined && !hasReference(amount.asset) ? { noReference: true } : {}),
  };
}

function scaled(text: string): { readonly units: bigint; readonly scale: number } {
  const [whole = "0", fraction = ""] = text.split(".");
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

/** sz x px in micro-dollars, exact and rounded up; both are decimal strings (px in USD). */
export function decimalProductMicros(sz: string, px: string): bigint {
  const a = scaled(sz);
  const b = scaled(px);
  return ceilDiv(a.units * b.units * 1_000_000n, 10n ** BigInt(a.scale + b.scale));
}

/** sz (decimal string) x a micro-dollar unit price, rounded up. */
export function sizeTimesMicros(sz: string, priceMicros: bigint): bigint {
  const a = scaled(sz);
  return ceilDiv(a.units * priceMicros, 10n ** BigInt(a.scale));
}

function tradeFact(step: IntentStep, graph: IntentGraph, sources: FactSources): TradeFact | undefined {
  const order = step.order;
  if (order) {
    const px = order.worstPx ?? order.limitPx;
    // Perp prices are USD; a spot pair's quote may not be, so spot notionals come from the base asset's USD price.
    const spotPrice = order.marketKind === "spot" ? sources.marketPriceUsdMicros?.(order.market, "spot") ?? null : null;
    const notional = order.marketKind === "perp" ? decimalProductMicros(order.sz, px) : spotPrice === null ? null : sizeTimesMicros(order.sz, spotPrice);
    const planned = graph.steps.find((other) => other.kind === "leverage" && other.leverage?.market === order.market)?.leverage?.leverage;
    const leverage = order.marketKind === "spot" ? 1 : order.leverage?.value ?? planned ?? sources.currentLeverage?.(order.market) ?? null;
    return {
      market: order.market,
      ...(order.displayName !== undefined ? { displayName: order.displayName } : {}),
      marketKind: order.marketKind,
      side: order.side,
      sz: order.sz,
      notionalUsdMicros: notional,
      leverage,
      reduceOnly: order.reduceOnly,
      isTrigger: order.trigger !== undefined,
      isTwap: false,
    };
  }
  const twap = step.twap;
  if (twap) {
    const unitPrice = sources.marketPriceUsdMicros?.(twap.market, twap.marketKind) ?? null;
    const notional = unitPrice === null ? null : sizeTimesMicros(twap.sz, unitPrice);
    return {
      market: twap.market,
      marketKind: twap.marketKind,
      side: twap.side,
      sz: twap.sz,
      notionalUsdMicros: notional,
      leverage: twap.marketKind === "spot" ? 1 : sources.currentLeverage?.(twap.market) ?? null,
      reduceOnly: twap.reduceOnly,
      isTrigger: false,
      isTwap: true,
    };
  }
  if (step.leverage) {
    return {
      market: step.leverage.market,
      marketKind: "perp",
      side: "buy",
      sz: "0",
      notionalUsdMicros: 0n,
      leverage: step.leverage.leverage,
      reduceOnly: false,
      isTrigger: false,
      isTwap: false,
    };
  }
  return undefined;
}

const AGENT_ACTION_BY_KIND: Partial<Record<StepKind, L1ActionType>> = { order: "order", cancel: "cancel", leverage: "updateLeverage", twap: "twapOrder", margin: "updateIsolatedMargin" };

/**
 * Facts for an intent graph, priced with the caller's (conservative) oracle,
 * never with adapters' advisory USD values. Unknown prices stay null so the
 * evaluator fails closed.
 */
export function buildPolicyFacts(graph: IntentGraph, sources: FactSources): PolicyFacts {
  const funded = new Set(graph.edges.filter((edge) => edge.kind === "funds").map((edge) => edge.to));
  const steps: StepFact[] = graph.steps.map((step) => {
    const trade = tradeFact(step, graph, sources);
    const signer: StepFact["signer"] = step.mode === "agent" || step.mode === "keeper" || step.mode === "wallet" ? step.mode : "none";
    const agentAction = signer === "agent" || signer === "keeper" ? (step.cancel?.twapId !== undefined ? "twapCancel" : step.cancel?.cloid !== undefined ? "cancelByCloid" : AGENT_ACTION_BY_KIND[step.kind]) : undefined;
    const fact: StepFact = {
      id: step.id,
      index: step.index,
      kind: step.kind,
      protocol: step.protocol,
      network: step.network,
      ...(step.settlement?.destinationNetwork ? { destinationNetwork: step.settlement.destinationNetwork } : {}),
      root: !funded.has(step.id) && step.funding === undefined,
      inputs: step.inputs.map((amount) => assetFact(amount, sources.priceUsdMicros, sources.hasReferencePrice)),
      outputs: step.outputs.map((amount) => assetFact(amount, sources.priceUsdMicros, sources.hasReferencePrice)),
      recipient: step.recipient ?? step.account,
      ...(step.extraCosts ? { extraCosts: step.extraCosts.map((amount) => assetFact(amount, sources.priceUsdMicros, sources.hasReferencePrice)) } : {}),
      ...(step.settlement?.expectedSeconds !== undefined ? { estimatedSeconds: step.settlement.expectedSeconds } : step.estimatedSeconds !== undefined ? { estimatedSeconds: step.estimatedSeconds } : {}),
      ...(trade ? { trade } : {}),
      signer,
      ...(agentAction ? { agentAction } : {}),
    };
    return fact;
  });
  return {
    stage: sources.stage,
    origin: sources.origin ?? (graph.source === "automation" ? "automation" : "user"),
    stored: sources.stored ?? true,
    accounts: graph.accounts,
    steps,
    ...(sources.feesUsdMicros !== undefined ? { feesUsdMicros: sources.feesUsdMicros } : {}),
    ...(sources.usage ? { usage: sources.usage } : {}),
    ...(sources.trading ? { trading: sources.trading } : {}),
    ...(sources.now !== undefined ? { now: sources.now } : {}),
  };
}
