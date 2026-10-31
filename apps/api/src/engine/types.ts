/**
 * Protocol adapter contract (ported from Kletia's `ProtocolAdapter`). An
 * adapter turns one resolved action into a quote-backed planned step,
 * re-quotes it into unsigned requests on prepare, verifies submitted
 * references against the chain or the HyperCore info API and, for
 * cross-network or resting steps, polls settlement.
 *
 * Contracts every adapter honours (Kletia §1.3):
 * - pins only: every called contract and approval spender comes from the
 *   core registries or is read back on-chain from a pinned router;
 * - exact approvals, only when the allowance is short;
 * - plan is cheap and best effort; prepare is strict and re-quotes the
 *   recorded route (`step.route`), never a fresh search;
 * - outcomes are proven from logs / info API, never from a receipt status
 *   alone; unknown is never zero.
 */
import type {
  AgentSnapshot,
  CancelSnapshot,
  EvidenceKind,
  ExecutionMode,
  IntentGraph,
  IntentStep,
  LeverageSnapshot,
  MarginSnapshot,
  NetworkEnvironment,
  NetworkKey,
  OrderSnapshot,
  ParsedAccountId,
  ParsedReference,
  StepAmount,
  StepEvidence,
  StepKind,
  StepRoute,
  StepSettlement,
  TransactionRequest,
  TwapSnapshot,
} from "@elyia/core";
import type { ResolvedAsset } from "./assets.js";

/** The shape an adapter decides support from (pure, no I/O). */
export interface AdapterRoute {
  readonly kind: StepKind;
  readonly network: NetworkKey;
  readonly destinationNetwork: NetworkKey;
  readonly input: ResolvedAsset | null;
  readonly output: ResolvedAsset | null;
  /** Adapter-specific route variant the planner asks for (e.g. `retryable-redeem`). */
  readonly variant?: string;
}

/** HyperCore trading detail of an action (orders, cancels, leverage, TWAP, isolated margin). */
export interface TradeRequest {
  readonly market: string;
  readonly side?: "buy" | "sell";
  /** Base size (decimal string). */
  readonly size?: string;
  /** Limit price; absent = IOC "market" at mid +/- slippage. */
  readonly price?: string;
  readonly tif?: "Gtc" | "Ioc" | "Alo";
  readonly reduceOnly?: boolean;
  readonly takeProfit?: string;
  readonly stopLoss?: string;
  /** Standalone trigger order (TP or SL) instead of an entry. */
  readonly trigger?: { readonly kind: "tp" | "sl"; readonly price: string; readonly isMarket: boolean };
  readonly leverage?: { readonly value: number; readonly mode: "cross" | "isolated" };
  readonly minutes?: number;
  readonly randomize?: boolean;
  readonly cancel?: { readonly oid?: number; readonly cloid?: string; readonly twapId?: number; readonly scheduleAt?: number | null };
  /** Isolated margin change, USD decimal (negative removes). */
  readonly marginUsd?: string;
}

export interface AdapterAction extends AdapterRoute {
  readonly environment: NetworkEnvironment;
  /** Base units of `input` (0 when the step spends nothing). */
  readonly amount: bigint;
  readonly account: ParsedAccountId;
  readonly recipient: ParsedAccountId;
  readonly slippageBps: number;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly trade?: TradeRequest;
  /** Signer of L1 actions. */
  readonly signer: "agent" | "keeper";
  /** Agent address expected to sign L1 actions, when known. */
  readonly agent?: string;
  /** True when the input comes from an earlier step (it may not be in the wallet yet). */
  readonly funded: boolean;
}

export interface PlannedStep {
  /** Where the step runs; default the action's network (set on before / after steps that run elsewhere). */
  readonly network?: NetworkKey;
  readonly protocol: string;
  readonly kind: StepKind;
  readonly title: string;
  readonly mode: ExecutionMode;
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  readonly extraCosts?: readonly StepAmount[];
  /** Network fees in USD (decimal string), null when unknown. */
  readonly feesUsd?: string | null;
  readonly estimatedSeconds: number;
  readonly settlement?: StepSettlement;
  readonly warnings: readonly string[];
  readonly route: StepRoute;
  /** Unsigned requests the step needs (approve + action counts 2). */
  readonly requestCount: number;
  /** "onchain" when the transaction itself reverts below the minimum. */
  readonly floor?: "onchain" | "claimed";
  readonly recipient?: ParsedAccountId;
  readonly order?: OrderSnapshot;
  readonly twap?: TwapSnapshot;
  readonly cancel?: CancelSnapshot;
  readonly leverage?: LeverageSnapshot;
  readonly margin?: MarginSnapshot;
  readonly agent?: AgentSnapshot;
  /** Steps that must run before this one (one-time setup such as the mirror bridge escrow wallet). */
  readonly before?: readonly PlannedStep[];
  /** Steps that complete this one later (the HyperEVM claim of a withdrawal); the last one carries the output. */
  readonly after?: readonly PlannedStep[];
}

export interface PrepareContext {
  readonly graph: IntentGraph;
  readonly step: IntentStep;
  /** The amount to execute now (funded steps: their share of the parent's observed output). */
  readonly amount: bigint;
  readonly now: number;
  /** Unix seconds after which the payload must be prepared again. */
  readonly expiresAt: number;
  /** Wallet chain for user-signed HyperCore actions. */
  readonly signatureChainId: number;
  /** Agent that signs L1 actions. */
  readonly agent?: string;
}

export interface PreparedPayload {
  readonly requests: readonly TransactionRequest[];
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  readonly extraCosts?: readonly StepAmount[];
  readonly warnings: readonly string[];
  /** Fresh snapshots (new cloids, limit prices) replacing the planned ones. */
  readonly order?: OrderSnapshot;
  readonly cancel?: CancelSnapshot;
  readonly agent?: AgentSnapshot;
  /** Readings verification compares against later (balances before a credit). */
  readonly observed?: Readonly<Record<string, string>>;
  readonly settlement?: Partial<StepSettlement>;
  /** Nothing to sign: the step is already satisfied on-chain (the service skips it with this reason). */
  readonly skip?: string;
}

export interface VerifyContext {
  readonly graph: IntentGraph;
  readonly step: IntentStep;
  readonly references: readonly ParsedReference[];
  /** Unix ms when the references were submitted. */
  readonly submittedAt: number;
  readonly now: number;
}

export interface AdapterFailure {
  readonly code: string;
  readonly message: string;
}

export type VerificationResult =
  | {
      readonly status: "confirmed";
      readonly evidence: readonly StepEvidence[];
      readonly actualOutputs?: readonly StepAmount[];
      /** Settlement facts learned at the origin (ticket id, L2->L1 position, order id). */
      readonly settlement?: Partial<StepSettlement>;
      /** True when the step is done at the origin (same-network effect proven). */
      readonly settled: boolean;
    }
  | { readonly status: "pending"; readonly evidence: readonly StepEvidence[]; readonly reason: string; readonly stale: boolean }
  | { readonly status: "failed"; readonly evidence: readonly StepEvidence[]; readonly failure: AdapterFailure };

export type SettlementResult =
  | { readonly status: "settling"; readonly evidence: readonly StepEvidence[]; readonly settlement?: Partial<StepSettlement>; readonly followUp?: FollowUpStep }
  | { readonly status: "settled"; readonly evidence: readonly StepEvidence[]; readonly actualOutputs?: readonly StepAmount[]; readonly settlement?: Partial<StepSettlement> }
  | { readonly status: "failed"; readonly evidence: readonly StepEvidence[]; readonly failure: AdapterFailure; readonly review?: boolean };

/** A step the engine appends to a live intent (a retryable redeem when the auto-redeem failed). */
export interface FollowUpStep {
  /** Dedupe key: at most one follow-up per key per intent. */
  readonly key: string;
  readonly kind: StepKind;
  readonly network: NetworkKey;
  readonly protocol: string;
  readonly title: string;
  readonly route: StepRoute;
}

export interface ProtocolAdapter {
  readonly id: string;
  /** Protocol registry ids this adapter executes. */
  readonly protocols: readonly string[];
  readonly label: string;
  /** Served only when the request names the protocol. */
  readonly explicitOnly?: boolean;
  supports(route: AdapterRoute): boolean;
  /** Whether this adapter executes a stored step (default: its protocol is one of `protocols`). */
  handles?(step: IntentStep): boolean;
  plan(action: AdapterAction): Promise<PlannedStep>;
  prepare(context: PrepareContext): Promise<PreparedPayload>;
  verify(context: VerifyContext): Promise<VerificationResult>;
  poll?(step: IntentStep, graph: IntentGraph, now: number): Promise<SettlementResult>;
}

export function evidence(kind: EvidenceKind, network: NetworkKey, now: number, detail: string, extra: { readonly reference?: string; readonly url?: string | null } = {}): StepEvidence {
  return {
    kind,
    network,
    observedAt: new Date(now).toISOString(),
    detail: detail.slice(0, 300),
    ...(extra.reference ? { reference: extra.reference } : {}),
    ...(extra.url ? { url: extra.url } : {}),
  };
}
