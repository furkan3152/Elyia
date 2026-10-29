/**
 * The terminal's Rule Book guard (pure). Every action the agent key would
 * sign is turned into @elyia/core policy facts and evaluated with
 * `evaluatePolicy` (the same evaluator the API and the Keeper run) before
 * the key is touched. The guard strip shows the same evaluation live under
 * the ticket, so the user sees the verdict before pressing the button.
 *
 * Facts come from the action itself (asset ids, sizes, limit prices,
 * reduce-only, triggers), the market catalogue, live prices and the
 * account feeds. Nothing is guessed: an unknown price or count stays null
 * and the evaluator denies (fail closed).
 */
import type { L1Action, OrderWire } from "@elyia/core/hypercore/actions";
import { formatAccountId, marginAssetId } from "@elyia/core/caip";
import type { NetworkEnvironment, NetworkKey } from "@elyia/core/networks";
import { DEFAULT_RULE_BOOK, RULE_BOOK_SCHEMA, validateRuleBook, type RuleBook } from "@elyia/core/policy";
import { decimalProductMicros, evaluatePolicy, POLICY_RULES, type PolicyEvaluation, type PolicyFacts, type StepFact, type TradeFact, type TradingFacts } from "@elyia/core/policyEvaluate";

import { applyDeriskLane, type LaneEvaluation } from "./derisk";

/** What the guard needs to know about a market (a TradeMarket fits). */
export interface GuardMarket {
  readonly coin: string;
  readonly displayName: string;
  readonly kind: "perp" | "hip3" | "spot";
  readonly quote: string;
  readonly asset: number;
}

export interface GuardContext {
  readonly mode: NetworkEnvironment;
  readonly networkKey: NetworkKey;
  /** The trading account (the user's wallet address). */
  readonly master: string;
  readonly marketByAsset: (asset: number) => GuardMarket | null;
  /** Live mid or mark of a market (book coin), for TWAPs; null when unknown. */
  readonly priceOf: (coin: string) => number | null;
  /** The account's leverage on a perp now (activeAssetData or the position); null when unknown. */
  readonly leverageOf: (coin: string) => number | null;
  /** Leverage this same submission sets first (the ticket's slider), per coin. */
  readonly plannedLeverage?: Readonly<Record<string, number>>;
  /** Slippage allowed by "market" (IOC) entries in this submission. */
  readonly marketSlippageBps?: number | null;
  readonly trading: TradingFacts;
  readonly dayUsdMicros: bigint | null;
  readonly weekUsdMicros: bigint | null;
  readonly now: number;
}

const STABLE_QUOTES = new Set(["USDC", "USDH", "USDT0", "USDE", "USD"]);

function tradeFor(wire: OrderWire, market: GuardMarket | null, ctx: GuardContext, isIoc: boolean): TradeFact {
  const coin = market?.coin ?? `asset:${wire.a}`;
  const spot = market?.kind === "spot";
  // Size x limit price is the worst case for every order type (a trigger's limit, an IOC's slippage bound).
  const priced = market !== null && (!spot || STABLE_QUOTES.has(market.quote.toUpperCase()));
  const leverage = spot ? 1 : (ctx.plannedLeverage?.[coin] ?? ctx.leverageOf(coin));
  return {
    market: coin,
    ...(market ? { displayName: market.displayName } : {}),
    marketKind: spot ? "spot" : "perp",
    side: wire.b ? "buy" : "sell",
    sz: wire.s,
    notionalUsdMicros: priced ? decimalProductMicros(wire.s, wire.p) : null,
    leverage: leverage ?? null,
    reduceOnly: wire.r,
    isTrigger: "trigger" in wire.t,
    isTwap: false,
    // "Market" entries carry the slippage they were built with; a hand-priced IOC limit has none to report.
    ...(isIoc && !("trigger" in wire.t) && ctx.marketSlippageBps !== undefined && ctx.marketSlippageBps !== null ? { slippageBps: ctx.marketSlippageBps } : {}),
  };
}

function protocolFor(market: GuardMarket | null): string {
  return market?.kind === "spot" ? "hypercore-spot" : "hypercore-perps";
}

/** Policy facts for one L1 action the agent key would sign. */
export function guardFactsFor(action: L1Action, ctx: GuardContext): PolicyFacts {
  const account = formatAccountId(ctx.networkKey, ctx.master);
  const base = (index: number, kind: StepFact["kind"], protocol: string): Omit<StepFact, "trade"> => ({
    id: `s${index}`,
    index,
    kind,
    protocol,
    network: ctx.networkKey,
    root: true,
    inputs: [],
    outputs: [],
    recipient: account,
    signer: "agent",
    agentAction: action.type,
  });
  const steps: StepFact[] = [];
  switch (action.type) {
    case "order":
      action.orders.forEach((wire, index) => {
        const market = ctx.marketByAsset(wire.a);
        const ioc = "limit" in wire.t && wire.t.limit.tif === "Ioc";
        const trade = tradeFor(wire, market, ctx, ioc);
        steps.push({ ...base(index, "order", protocolFor(market)), trade, ...(ioc && typeof trade.slippageBps === "number" ? { slippageBps: trade.slippageBps } : {}) });
      });
      break;
    case "modify":
    case "batchModify": {
      const wires = action.type === "modify" ? [action.order] : action.modifies.map((entry) => entry.order);
      wires.forEach((wire, index) => {
        const market = ctx.marketByAsset(wire.a);
        steps.push({ ...base(index, "order", protocolFor(market)), trade: tradeFor(wire, market, ctx, false) });
      });
      break;
    }
    case "updateLeverage": {
      const market = ctx.marketByAsset(action.asset);
      steps.push({
        ...base(0, "leverage", "hypercore-perps"),
        trade: { market: market?.coin ?? `asset:${action.asset}`, ...(market ? { displayName: market.displayName } : {}), marketKind: "perp", side: "buy", sz: "0", notionalUsdMicros: 0n, leverage: action.leverage, reduceOnly: false, isTrigger: false, isTwap: false },
      });
      break;
    }
    case "twapOrder": {
      const market = ctx.marketByAsset(action.twap.a);
      const coin = market?.coin ?? `asset:${action.twap.a}`;
      const px = market ? ctx.priceOf(coin) : null;
      const spot = market?.kind === "spot";
      const priced = px !== null && px > 0 && (!spot || STABLE_QUOTES.has((market?.quote ?? "").toUpperCase()));
      steps.push({
        ...base(0, "twap", "hypercore-twap"),
        trade: {
          market: coin,
          ...(market ? { displayName: market.displayName } : {}),
          marketKind: spot ? "spot" : "perp",
          side: action.twap.b ? "buy" : "sell",
          sz: action.twap.s,
          notionalUsdMicros: priced ? decimalProductMicros(action.twap.s, (px as number).toFixed(8)) : null,
          leverage: spot ? 1 : (ctx.plannedLeverage?.[coin] ?? ctx.leverageOf(coin)),
          reduceOnly: action.twap.r,
          isTrigger: false,
          isTwap: true,
        },
      });
      break;
    }
    case "updateIsolatedMargin": {
      const amount = BigInt(Math.abs(action.ntli));
      steps.push({
        ...base(0, "margin", "hypercore-perps"),
        inputs: [{ asset: marginAssetId(ctx.networkKey), symbol: "USDC", decimals: 6, amount: amount.toString(), listed: true, usdMicros: amount }],
      });
      break;
    }
    default:
      // cancel, cancelByCloid, twapCancel, scheduleCancel, noop: de-risking, no value moves.
      steps.push(base(0, "cancel", action.type === "twapCancel" ? "hypercore-twap" : "hypercore-perps"));
  }

  const derisking = steps.every((step) => step.kind === "cancel" || ((step.kind === "order" || step.kind === "twap") && step.trade?.reduceOnly === true));
  // De-risking adds no value to the rolling windows, so an unread window cannot make it riskier: it may always pass (core invariant).
  const day = ctx.dayUsdMicros ?? (derisking ? 0n : null);
  const week = ctx.weekUsdMicros ?? (derisking ? 0n : null);
  return {
    stage: "sign",
    origin: "user",
    stored: false,
    accounts: [account],
    steps,
    feesUsdMicros: 0n,
    ...(day !== null && week !== null ? { usage: { dayUsdMicros: day, weekUsdMicros: week } } : {}),
    trading: ctx.trading,
    now: ctx.now,
  };
}

/** Core evaluation of one action, through the de-risk lane (cancels and reduce-only orders are never blocked). */
export function evaluateAction(book: RuleBook, action: L1Action, ctx: GuardContext): LaneEvaluation {
  return applyDeriskLane(action, evaluatePolicy(book, guardFactsFor(action, ctx)));
}

/** The worst verdict of several actions signed for one click (leverage first, then the order). */
export function combineEvaluations(evaluations: readonly PolicyEvaluation[]): { readonly decision: PolicyEvaluation["decision"]; readonly reasons: PolicyEvaluation["reasons"]; readonly passed: number } {
  const rank = { allow: 0, confirm: 1, deny: 2 } as const;
  let decision: PolicyEvaluation["decision"] = "allow";
  const reasons: PolicyEvaluation["reasons"][number][] = [];
  const seen = new Set<string>();
  let passed = 0;
  for (const evaluation of evaluations) {
    if (rank[evaluation.decision] > rank[decision]) decision = evaluation.decision;
    for (const reason of evaluation.reasons) {
      const key = `${reason.rule}|${reason.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        reasons.push(reason);
      }
    }
    passed = Math.max(passed, evaluation.rules.filter((rule) => rule.status === "pass").length);
  }
  return { decision, reasons, passed };
}

/* ------------------------------------------------------- user overrides */

/** The few trading limits a person can tune from the terminal (stored per device). */
export interface GuardOverrides {
  readonly maxLeverage?: number;
  readonly maxNotionalUsd?: string;
  readonly maxSlippageBps?: number;
  readonly dailyVolumeUsd?: string;
  readonly dailyLossUsd?: string;
  readonly confirmAboveUsd?: string;
  /** Upper-case coins; empty or absent = every market. */
  readonly markets?: readonly string[];
  /** De-risk only: just reduce-only orders and cancels. */
  readonly reduceOnly?: boolean;
  /** The kill switch: nothing new runs, closes and cancels still do. */
  readonly paused?: boolean;
  /** Allow HyperCore mainnet (testnet only by default). */
  readonly allowMainnet?: boolean;
}

/**
 * DEFAULT_RULE_BOOK with the user's overrides applied, validated by core.
 * An invalid override is dropped (the default stands) and reported.
 */
export function effectiveRuleBook(overrides: GuardOverrides): { readonly book: RuleBook; readonly issues: readonly string[] } {
  const base = DEFAULT_RULE_BOOK;
  const trading = { ...(base.trading ?? {}) } as Record<string, unknown>;
  const confirm = { ...(base.confirm ?? {}) } as Record<string, unknown>;
  const limits = { ...(base.limits ?? {}) } as Record<string, unknown>;
  if (overrides.maxLeverage !== undefined) trading.maxLeverage = overrides.maxLeverage;
  if (overrides.maxNotionalUsd !== undefined) trading.maxNotionalUsd = overrides.maxNotionalUsd;
  if (overrides.maxSlippageBps !== undefined) {
    trading.maxSlippageBps = overrides.maxSlippageBps;
    limits.maxSlippageBps = overrides.maxSlippageBps;
  }
  if (overrides.dailyVolumeUsd !== undefined) trading.dailyVolumeUsd = overrides.dailyVolumeUsd;
  if (overrides.dailyLossUsd !== undefined) trading.dailyLossUsd = overrides.dailyLossUsd;
  if (overrides.markets && overrides.markets.length > 0) trading.markets = { allow: [...overrides.markets] };
  if (overrides.reduceOnly) trading.reduceOnly = true;
  if (overrides.confirmAboveUsd !== undefined) confirm.aboveUsd = overrides.confirmAboveUsd;
  const candidate = {
    ...base,
    schema: RULE_BOOK_SCHEMA,
    label: "Terminal",
    mode: overrides.paused ? "paused" : (base.mode ?? "live"),
    networks: { environments: overrides.allowMainnet ? ["testnet", "mainnet"] : ["testnet"] },
    limits,
    trading,
    confirm,
  };
  const result = validateRuleBook(candidate);
  if (result.ok) return { book: result.value, issues: [] };
  return { book: base, issues: result.issues.map((issue) => `${issue.path}: ${issue.message}`) };
}

export interface GuardLine {
  readonly tone: "mint" | "gold" | "rose";
  readonly text: string;
}

/** One-line summary of the book for the strip ("max 20x · max $10,000 per order · every market"). */
export function bookSummary(book: RuleBook): string {
  const parts: string[] = [];
  if (book.mode === "paused") parts.push("kill switch on");
  if (book.trading?.reduceOnly) parts.push("de-risk only");
  if (book.trading?.maxLeverage !== undefined) parts.push(`max ${book.trading.maxLeverage}×`);
  if (book.trading?.maxNotionalUsd !== undefined) parts.push(`max $${Number(book.trading.maxNotionalUsd).toLocaleString("en-US")} per order`);
  const allow = book.trading?.markets?.allow;
  parts.push(allow && allow.length > 0 ? `${allow.slice(0, 3).join(", ")}${allow.length > 3 ? ` +${allow.length - 3}` : ""} only` : "every market");
  return parts.join(" · ");
}

/** The reasons as strip lines: denies first, then confirmations. */
export function guardLines(reasons: PolicyEvaluation["reasons"]): GuardLine[] {
  const lines: GuardLine[] = [];
  for (const reason of reasons) {
    if (reason.rule === "facts.unavailable") {
      lines.push({ tone: "rose", text: "Waiting for account data the rules need (open orders, 24 h volume, prices): Elyia will not sign until it has them." });
      continue;
    }
    lines.push({ tone: reason.outcome === "deny" ? "rose" : "gold", text: reason.message || POLICY_RULES[reason.rule].title });
  }
  return lines.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "rose" ? -1 : b.tone === "rose" ? 1 : 0));
}
