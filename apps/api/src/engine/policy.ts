/**
 * The Rule Book gate at plan and prepare (core evaluatePolicy). Facts are
 * prefetched and handed to the synchronous evaluator: reference USD prices
 * (HyperCore MAINNET mids, labelled), the owner's rolling usage from the
 * spend ledger and, when the intent trades, live HyperCore account facts.
 * A fact that cannot be read stays null and the evaluator fails closed.
 * De-risking intents (only cancels and reduce-only orders / TWAPs) are never
 * blocked: they bypass the gate, even when the Rule Book is paused.
 */
import {
  buildPolicyFacts,
  DEFAULT_RULE_BOOK,
  evaluatePolicy,
  formatUsdMicros,
  ruleBookHash,
  type IntentGraph,
  type IntentPolicyStamp,
  type IntentStep,
  type PolicyEvaluation,
  type PolicyStage,
  type RuleBook,
} from "@elyia/core";
import type { PolicySummary } from "@elyia/core/api/intents";
import type { EngineDeps } from "./deps.js";
import { engineError } from "./errors.js";
import { PRICE_SOURCE, ReferencePrices } from "./prices.js";
import type { IntentStore } from "./store.js";

/** Where an owner's Rule Book comes from (the Agent settings own it; the default is the testnet book). */
export interface RuleBookSource {
  forOwner(owner: string): Promise<RuleBook>;
}

export const defaultRuleBooks: RuleBookSource = { forOwner: () => Promise.resolve(DEFAULT_RULE_BOOK) };

const DAY_MS = 24 * 60 * 60 * 1000;

/** A step that only reduces risk (never blocked by the Rule Book). */
export function isDerisking(step: IntentStep): boolean {
  if (step.kind === "cancel") return true;
  if (step.kind === "order") return step.order?.reduceOnly === true;
  if (step.kind === "twap") return step.twap?.reduceOnly === true;
  return false;
}

function micros(value: string | undefined): bigint {
  if (!value || !/^-?\d+(?:\.\d+)?$/u.test(value)) return 0n;
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace(/^-/u, "").split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -units : units;
}

function productMicros(a: string, b: string): bigint {
  return (micros(a) * micros(b)) / 1_000_000n;
}

export interface GateResult {
  readonly evaluation: PolicyEvaluation;
  readonly summary: PolicySummary;
  readonly decisionId: string;
  readonly ruleBookHash: string;
}

export class PolicyGate {
  constructor(
    private readonly deps: EngineDeps,
    private readonly books: RuleBookSource,
    private readonly store: IntentStore | null,
  ) {}

  private decisionId(): string {
    const bytes = this.deps.random.getRandomValues(new Uint8Array(12));
    return `pol_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  /** Reads trading facts when the intent trades on HyperCore (null fields when a read fails). */
  private async tradingFacts(graph: IntentGraph, owner: string) {
    const trading = graph.steps.filter((step) => step.kind === "order" || step.kind === "twap" || step.kind === "leverage");
    if (trading.length === 0) return { facts: undefined, leverage: new Map<string, number>() };
    const network = trading[0]?.network;
    if (!network) return { facts: undefined, leverage: new Map<string, number>() };
    const now = this.deps.clock.now();
    const [orders, state, fills] = await Promise.allSettled([
      this.deps.core.frontendOpenOrders(network, owner),
      this.deps.core.clearinghouseState(network, owner),
      this.deps.core.userFillsByTime(network, owner, now - DAY_MS),
    ]);
    const leverage = new Map<string, number>();
    if (state.status === "fulfilled") {
      for (const { position } of state.value.assetPositions) leverage.set(position.coin, position.leverage.value);
    }
    // Markets without a position: the account's configured leverage (activeAssetData), when an order sets none.
    const unknown = [...new Set(trading.flatMap((step) => (step.order && !step.order.leverage && step.order.marketKind === "perp" && !leverage.has(step.order.market) ? [step.order.market] : [])))];
    await Promise.all(
      unknown.slice(0, 4).map(async (coin) => {
        try {
          const data = await this.deps.core.activeAssetData(network, owner, coin);
          leverage.set(coin, data.leverage.value);
        } catch {
          // stays unknown: the evaluator fails closed where a leverage rule needs it.
        }
      }),
    );
    const fillList = fills.status === "fulfilled" ? fills.value : null;
    return {
      leverage,
      facts: {
        openOrders: orders.status === "fulfilled" ? orders.value.length : null,
        openNotionalUsdMicros: state.status === "fulfilled" ? state.value.assetPositions.reduce((sum, entry) => sum + (micros(entry.position.positionValue) < 0n ? -micros(entry.position.positionValue) : micros(entry.position.positionValue)), 0n) : null,
        dayVolumeUsdMicros: fillList ? fillList.filter((fill) => fill.dir.startsWith("Open") || fill.dir === "Buy" || fill.dir === "Sell").reduce((sum, fill) => sum + productMicros(fill.sz, fill.px), 0n) : null,
        dayRealizedLossUsdMicros: fillList ? fillList.reduce((sum, fill) => (micros(fill.closedPnl) < 0n ? sum - micros(fill.closedPnl) : sum), 0n) : null,
      },
    };
  }

  async evaluate(graph: IntentGraph, options: { readonly stage: PolicyStage; readonly stored: boolean; readonly owner: string }): Promise<GateResult> {
    const now = this.deps.clock.now();
    const decisionId = this.decisionId();
    const book = await this.books.forOwner(options.owner);
    const hash = ruleBookHash(book);
    const live = graph.steps.filter((step) => step.status !== "skipped" && step.status !== "stopped");
    if (live.length > 0 && live.every(isDerisking)) {
      const evaluation: PolicyEvaluation = { decision: "allow", reasons: [], rules: [], notionalUsdMicros: null, code: null, retryAfterSeconds: null };
      return { evaluation, decisionId, ruleBookHash: hash, summary: { decision: "allow", ruleBookHash: hash, reasons: [], notionalUsd: null, priceSource: PRICE_SOURCE, evaluatedAt: new Date(now).toISOString(), derisking: true } };
    }
    const snapshot = await this.deps.prices.snapshot();
    const symbols = new Map<string, string>();
    const displayNames = new Map<string, string>();
    for (const step of graph.steps) {
      for (const amount of [...step.inputs, ...step.outputs, ...(step.extraCosts ?? [])]) symbols.set(amount.asset.toLowerCase(), amount.symbol);
      if (step.order?.displayName) displayNames.set(step.order.market, step.order.displayName);
    }
    const [usage, trading] = await Promise.all([this.store ? this.store.usage(options.owner, graph.id).catch(() => undefined) : Promise.resolve(undefined), this.tradingFacts(graph, options.owner)]);
    const fees = graph.summary.totalFeesUsd;
    const facts = buildPolicyFacts(graph, {
      stage: options.stage,
      stored: options.stored,
      priceUsdMicros: (asset) => ReferencePrices.assetMicros(snapshot, asset, symbols.get(asset.toLowerCase())),
      marketPriceUsdMicros: (market, kind) => {
        const base = kind === "spot" ? (displayNames.get(market) ?? market).split("/")[0] ?? market : market;
        return ReferencePrices.symbolMicros(snapshot, base);
      },
      currentLeverage: (market) => trading.leverage.get(market) ?? null,
      feesUsdMicros: fees === undefined || fees === null ? null : micros(fees),
      ...(usage ? { usage } : {}),
      ...(trading.facts ? { trading: trading.facts } : {}),
      now,
    });
    const evaluation = evaluatePolicy(book, facts);
    const summary: PolicySummary = {
      decision: evaluation.decision,
      ruleBookHash: hash,
      reasons: evaluation.reasons.map((reason) => ({
        rule: reason.rule,
        outcome: reason.outcome,
        message: reason.message,
        ...(reason.path !== undefined ? { path: reason.path } : {}),
        ...(reason.observed !== undefined ? { observed: reason.observed } : {}),
        ...(reason.limit !== undefined ? { limit: reason.limit } : {}),
      })),
      notionalUsd: evaluation.notionalUsdMicros === null ? null : formatUsdMicros(evaluation.notionalUsdMicros),
      priceSource: PRICE_SOURCE,
      evaluatedAt: new Date(now).toISOString(),
    };
    return { evaluation, summary, decisionId, ruleBookHash: hash };
  }

  /** Throws the evaluator's code for a deny. */
  static enforce(result: GateResult): void {
    const { evaluation } = result;
    if (evaluation.decision !== "deny") return;
    const code = evaluation.code ?? "POLICY_DENIED";
    throw engineError(code, evaluation.reasons[0]?.message, { reasons: result.summary.reasons, ruleBookHash: result.ruleBookHash }, evaluation.retryAfterSeconds ?? undefined);
  }

  static stamp(result: GateResult): IntentPolicyStamp {
    return {
      decisionId: result.decisionId,
      decision: result.evaluation.decision === "confirm" ? "confirm" : "allow",
      ruleBookHash: result.ruleBookHash as IntentPolicyStamp["ruleBookHash"],
      notionalUsd: result.summary.notionalUsd,
      evaluatedAt: result.summary.evaluatedAt,
      confirmations: result.evaluation.reasons.filter((reason) => reason.outcome === "confirm").map((reason) => reason.rule),
    };
  }
}
