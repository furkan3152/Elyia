/**
 * Elyia Intent Specification v1 (`elyia.intent/v1`).
 *
 * An intent is a user-level outcome ("bridge 20 HYPE to Elysium and swap half
 * to USDC", "long BTC 5x with a stop at 58k"). The planner compiles it into
 * an IntentGraph: a DAG of steps, each owned by exactly one CAIP-10 account
 * on one network and executed through one protocol. EVM steps (Elysium,
 * HyperEVM) are wallet transactions; HyperCore steps are signed actions,
 * either EIP-712 "user-signed" by the wallet or L1 actions signed by the
 * trade-only agent key. Nothing in the graph is globally atomic:
 * cross-network legs settle asynchronously and carry their own evidence.
 *
 * Invariants the engine keeps (see lifecycle.ts, binding.ts, references.ts):
 * the server never signs; `prepare` returns unsigned requests plus a quote
 * binding; `submit` takes only references (tx hashes, `hc:cloid:`,
 * `hc:nonce:`) and re-derives the binding from evidence; references are
 * claimed globally once; unknown facts fail closed.
 */
import type { AccountId, AssetId, CaipChainId, EvmAddress } from "./caip.js";
import type { Sha256Digest } from "./canonical.js";
import type { NetworkEnvironment, NetworkKey } from "./networks.js";
import type { L1Action, OrderGrouping, Tif, Tpsl, UserSignedAction } from "./hypercore/actions.js";
import type { Eip712TypedData } from "./hypercore/signing.js";
import type { Cloid } from "./hypercore/wire.js";

export const INTENT_SPEC_VERSION = "elyia.intent/v1" as const;

/* --------------------------------------------------------------- steps */

export const STEP_KINDS = Object.freeze([
  "approve",
  "swap",
  "bridge",
  "claim",
  "link",
  "margin",
  "transfer",
  "stake",
  "unstake",
  "deposit",
  "withdraw",
  "agent",
  "order",
  "cancel",
  "leverage",
  "twap",
  "alert",
  "automation",
] as const);

/**
 * - approve: ERC-20 allowance; swap: DEX or aggregator swap;
 * - bridge: Orbit deposit or withdrawal between HyperEVM and Elysium; claim: Outbox execute after the challenge period;
 * - link: HyperEVM <-> HyperCore spot through the system addresses; margin: spot <-> perp, or isolated margin;
 * - transfer: send to another account; stake / unstake: kHYPE or native delegation; deposit / withdraw: venues and vaults;
 * - agent: approveAgent for the trade-only key; order / cancel / leverage / twap: HyperCore trading;
 * - alert / automation: Elysium Agent rules (no value moves until a rule fires and plans a new intent).
 */
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_STATUSES = Object.freeze([
  "blocked",
  "ready",
  "preparing",
  "awaiting-signature",
  "submitted",
  "settling",
  "settled",
  "failed",
  "skipped",
  "stopped",
] as const);

/**
 * - blocked: waits for the steps it depends on;
 * - ready: may be prepared now; preparing: the server is building the payload;
 * - awaiting-signature: unsigned payload handed out, waiting for references;
 * - submitted: references received, verification in progress;
 * - settling: confirmed at the origin, waiting for the destination, a resting order or a challenge period;
 * - settled: outcome proven from receipts, logs or the info API;
 * - failed: see `failure` (retryable, or held for review); skipped: not needed (e.g. an agent already approved);
 * - stopped: the user stopped the intent before this step started.
 */
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Who authorises a step: `wallet` (the user's wallet signs an EVM transaction
 * or EIP-712 message), `agent` (the in-browser trade-only HyperCore key),
 * `keeper` (the opt-in server-held trade-only key), `settlement` (an
 * off-chain process completes it, nothing to sign), `read` (no value moves).
 */
export type ExecutionMode = "wallet" | "agent" | "keeper" | "settlement" | "read";

export interface AssetRef {
  readonly asset: AssetId;
  readonly symbol: string;
  readonly decimals: number;
}

/** An asset amount on a step. Amounts are base units as decimal integer strings. */
export interface StepAmount extends AssetRef {
  /** Expected amount, base units. */
  readonly expected: string;
  /** Outputs: the guaranteed floor; the step fails below it. */
  readonly minimum?: string;
  /** Inputs: the most the step may spend (exact-out swaps, IOC buys). */
  readonly maximum?: string;
  /** Conservative USD value of `expected` (decimal string); null = unpriced, never zero. */
  readonly usd?: string | null;
}

export type SettlementMechanism =
  | "receipt"
  | "orbit-deposit"
  | "orbit-withdrawal"
  | "outbox-claim"
  | "core-link"
  | "order-fill"
  | "ledger";

export interface StepSettlement {
  readonly kind: "same-network" | "cross-network";
  readonly destinationNetwork?: NetworkKey;
  readonly mechanism?: SettlementMechanism;
  readonly expectedSeconds?: number;
  /** Retryable ticket id, L2->L1 position, order id or ledger hash once known. */
  readonly trackingId?: string;
  /** Orbit withdrawals: when the HyperEVM claim opens (ISO 8601). */
  readonly claimableAt?: string;
}

/** Plan-time snapshot of a HyperCore order. Verification compares against it, never against live markets. */
export interface OrderSnapshot {
  /** Book coin: `BTC`, `@1035`. */
  readonly market: string;
  readonly displayName?: string;
  readonly marketKind: "perp" | "spot";
  readonly assetIndex: number;
  readonly side: "buy" | "sell";
  /** Wire decimals. */
  readonly sz: string;
  readonly limitPx: string;
  /** null for trigger orders. */
  readonly tif: Tif | null;
  readonly reduceOnly: boolean;
  readonly cloid: Cloid;
  readonly trigger?: { readonly triggerPx: string; readonly isMarket: boolean; readonly tpsl: Tpsl };
  readonly grouping: OrderGrouping;
  /** IOC "market" orders: the planned worst price; a re-prepared buy may not exceed it, a sell may not go below. */
  readonly worstPx?: string;
  readonly leverage?: { readonly value: number; readonly mode: "cross" | "isolated" };
  /** sz x limitPx in USD (decimal string); null when not priced. */
  readonly notionalUsd?: string | null;
}

export interface TwapSnapshot {
  readonly market: string;
  readonly marketKind: "perp" | "spot";
  readonly assetIndex: number;
  readonly side: "buy" | "sell";
  readonly sz: string;
  readonly minutes: number;
  readonly randomize: boolean;
  readonly reduceOnly: boolean;
}

export interface CancelSnapshot {
  readonly market: string;
  readonly assetIndex: number;
  readonly oid?: number;
  readonly cloid?: Cloid;
  readonly twapId?: number;
}

export interface LeverageSnapshot {
  readonly market: string;
  readonly assetIndex: number;
  readonly leverage: number;
  readonly isCross: boolean;
}

export interface AgentSnapshot {
  readonly address: EvmAddress;
  readonly name: string | null;
  /** Unix ms; null for no expiry. */
  readonly validUntil: number | null;
  readonly scope: "browser" | "keeper";
}

export interface StepFunding {
  /** Step whose output this step spends (the `funds` edge's `from`). */
  readonly from: string;
  /** Share of that output, basis points (10000 = all). */
  readonly portionBps: number;
  /** Gas-asset units kept back when the input is the gas asset (amount flow F6). */
  readonly gasReserve?: string;
}

export type EvidenceKind = "transaction" | "receipt" | "settlement" | "quote" | "balance" | "ledger" | "order" | "fill" | "note";

export interface StepEvidence {
  readonly kind: EvidenceKind;
  readonly network: NetworkKey;
  readonly reference?: string;
  readonly url?: string;
  readonly observedAt: string;
  readonly detail?: string;
}

export interface StepFailure {
  /** Error catalog code (errors.ts). */
  readonly code: string;
  readonly message: string;
  /** The step may be prepared again. */
  readonly retryable: boolean;
  /** The outcome is unknown: held for manual review and never retried automatically. */
  readonly review?: boolean;
}

/** What the signer was asked to sign for a step (recorded at prepare). */
export interface PreparedStepRecord {
  readonly quoteBinding: Sha256Digest;
  readonly preparedAt: string;
  /** Unix seconds after which the payload must be prepared again. */
  readonly expiresAt: number;
  readonly requests: readonly {
    readonly vm: "evm" | "hypercore";
    readonly network: NetworkKey;
    readonly kind?: "user-signed" | "l1-action";
    readonly to?: string;
    readonly actionType?: string;
    readonly description: string;
  }[];
}

export interface IntentStep {
  /** `s1`, `s2`, ... */
  readonly id: string;
  readonly index: number;
  readonly kind: StepKind;
  readonly title: string;
  readonly network: NetworkKey;
  readonly chain: CaipChainId;
  readonly account: AccountId;
  /** Protocol registry id (protocols.ts). */
  readonly protocol: string;
  readonly mode: ExecutionMode;
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  readonly recipient?: AccountId;
  readonly dependsOn: readonly string[];
  readonly settlement?: StepSettlement;
  readonly status: StepStatus;
  readonly order?: OrderSnapshot;
  readonly twap?: TwapSnapshot;
  readonly cancel?: CancelSnapshot;
  readonly leverage?: LeverageSnapshot;
  readonly agent?: AgentSnapshot;
  readonly funding?: StepFunding;
  /** Value paid on top of the inputs (retryable submission fees, builder fees). */
  readonly extraCosts?: readonly StepAmount[];
  /** Estimated network fees in USD (decimal string); null = unknown. */
  readonly feesUsd?: string | null;
  readonly estimatedSeconds?: number;
  readonly evidence: readonly StepEvidence[];
  readonly warnings?: readonly string[];
  readonly prepared?: PreparedStepRecord;
  /** Submitted references, in order (references.ts). */
  readonly references?: readonly string[];
  /** Observed outcome once settled (fills, credits). */
  readonly actualOutputs?: readonly StepAmount[];
  readonly failure?: StepFailure;
}

export interface IntentEdge {
  readonly from: string;
  readonly to: string;
  /** funds: `from`'s output is `to`'s input. orders: sequencing only. */
  readonly kind: "funds" | "orders";
}

/* ------------------------------------------------------- transactions */

export interface EvmTransactionRequest {
  readonly vm: "evm";
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly from: EvmAddress;
  readonly to: EvmAddress;
  readonly data: `0x${string}`;
  /** Wei, decimal integer string. */
  readonly value: string;
  readonly gas?: string;
  /** Pinned account nonce (decimal) when the rule book pins nonces. */
  readonly nonce?: string;
  readonly description: string;
}

export interface HyperCoreUserSignedRequest {
  readonly vm: "hypercore";
  readonly network: NetworkKey;
  readonly kind: "user-signed";
  readonly signer: "wallet";
  /** The master address; must equal the step account's address. */
  readonly from: EvmAddress;
  /** Exact JSON to POST, including `hyperliquidChain` and `signatureChainId`. */
  readonly action: UserSignedAction;
  /** What `eth_signTypedData_v4` receives. */
  readonly typedData: Eip712TypedData;
  /** Unix ms, equal to the action's `time` / `nonce`. */
  readonly nonce: string;
  readonly description: string;
}

export interface HyperCoreL1ActionRequest {
  readonly vm: "hypercore";
  readonly network: NetworkKey;
  readonly kind: "l1-action";
  readonly signer: "agent" | "keeper";
  /** The account the action acts for. */
  readonly from: EvmAddress;
  /** Agent address expected to sign (approved through approveAgent). */
  readonly agent: EvmAddress;
  readonly action: L1Action;
  /** Unix ms; unique per agent signer. */
  readonly nonce: string;
  /** Unix ms; always set so a leaked signed action cannot be replayed later. */
  readonly expiresAfter: number;
  /** Subaccount or vault the action trades for (must be owned by `from`). */
  readonly vaultAddress?: EvmAddress;
  /** keccak(msgpack(action) || nonce || vault || expiresAfter), for display and binding. */
  readonly connectionId: `0x${string}`;
  readonly description: string;
}

export type HyperCoreRequest = HyperCoreUserSignedRequest | HyperCoreL1ActionRequest;
export type TransactionRequest = EvmTransactionRequest | HyperCoreUserSignedRequest | HyperCoreL1ActionRequest;

/** Ties a prepared payload to the Rule Book decision that cleared it. */
export interface StepPolicyClearance {
  readonly decisionId: string;
  /** USD counted against caps (2 decimals); null when no USD rule applied. */
  readonly notionalUsd: string | null;
  readonly ruleBookHash: Sha256Digest;
}

/** Ordered requests that together complete one step (e.g. approve + swap). */
export interface StepExecutionPayload {
  readonly intentId: string;
  readonly stepId: string;
  readonly vm: "evm" | "hypercore";
  readonly requests: readonly TransactionRequest[];
  /** Unix seconds after which the payload must be prepared again. */
  readonly expiresAt: number;
  readonly quoteBinding: Sha256Digest;
  readonly policy?: StepPolicyClearance;
}

/* -------------------------------------------------------------- graph */

export const INTENT_STATUSES = Object.freeze([
  "planned",
  "executing",
  "settling",
  "completed",
  "partially-completed",
  "failed",
  "needs-review",
  "expired",
  "stopped",
  "cancelled",
] as const);

export type IntentStatus = (typeof INTENT_STATUSES)[number];

/** Rule Book stamp of a stored intent (immutable, like the plan). */
export interface IntentPolicyStamp {
  readonly decisionId: string;
  readonly decision: "allow" | "confirm";
  readonly ruleBookHash: Sha256Digest;
  /** Fresh USD value of the intent (2 decimals); null when no USD rule needed it. */
  readonly notionalUsd: string | null;
  readonly evaluatedAt: string;
  /** Rule ids that asked for a confirmation. */
  readonly confirmations: readonly string[];
  readonly approval?: { readonly id: string; readonly expiresAt: string; readonly ceilingUsd: string };
}

export interface IntentSummary {
  readonly title: string;
  readonly networks: readonly NetworkKey[];
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  readonly signatures: { readonly wallet: number; readonly agent: number };
  readonly crossNetwork: boolean;
  readonly estimatedSeconds?: number;
  readonly totalFeesUsd?: string | null;
}

export type IntentSource = "text" | "structured" | "assistant" | "automation" | "telegram";

export interface IntentGraph {
  readonly spec: typeof INTENT_SPEC_VERSION;
  /** `int_` + 32 hex. */
  readonly id: string;
  /** The sentence the user typed, when there was one. */
  readonly text?: string;
  readonly source: IntentSource;
  /** Testnet and mainnet capital never share an intent. */
  readonly environment: NetworkEnvironment;
  /** The user's own accounts (one 0x address re-homed per network). */
  readonly accounts: readonly AccountId[];
  readonly steps: readonly IntentStep[];
  readonly edges: readonly IntentEdge[];
  readonly status: IntentStatus;
  readonly createdAt: string;
  /** Also the optimistic-concurrency token. */
  readonly updatedAt: string;
  /** Unstarted intents expire; started ones never do (long withdrawals stay valid). */
  readonly expiresAt: string;
  readonly summary: IntentSummary;
  readonly warnings: readonly string[];
  readonly policy?: IntentPolicyStamp;
  /** Automation that planned this intent, if any. */
  readonly automationId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export const INTENT_ID_PATTERN = /^int_[0-9a-f]{32}$/u;
export const STEP_ID_PATTERN = /^s[1-9]\d{0,2}$/u;

export function isIntentId(value: unknown): value is string {
  return typeof value === "string" && INTENT_ID_PATTERN.test(value);
}

/** `int_` + 32 hex from `crypto.getRandomValues`. */
export function newIntentId(random: { getRandomValues(array: Uint8Array): Uint8Array } | undefined = globalThis.crypto): string {
  if (!random) throw new Error("No secure random source (crypto.getRandomValues) is available.");
  const bytes = random.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `int_${hex}`;
}

/* ------------------------------------------------------------ requests */

/** A structured action an integrator or the assistant can send instead of text. */
export interface IntentActionSpec {
  readonly kind: StepKind;
  readonly network: NetworkKey;
  /** Input asset: symbol on `network`, or a CAIP-19 id. */
  readonly from?: string;
  /** Output asset: symbol or CAIP-19 id (for bridges, on `toNetwork`). */
  readonly to?: string;
  /** Decimal amount of `from`, or "max" (the previous step's output). */
  readonly amount?: string;
  readonly toNetwork?: NetworkKey;
  /** Address or CAIP-10 account; defaults to the acting account. */
  readonly recipient?: string;
  readonly protocol?: string;
  /** Trading: book coin or display name ("BTC", "HYPE/USDC"). */
  readonly market?: string;
  readonly side?: "buy" | "sell" | "long" | "short";
  /** Base-asset size, decimal string. */
  readonly size?: string;
  /** Limit price, decimal string; absent = IOC "market". */
  readonly price?: string;
  readonly tif?: Tif;
  readonly reduceOnly?: boolean;
  readonly leverage?: { readonly value: number; readonly mode?: "cross" | "isolated" };
  readonly takeProfit?: string;
  readonly stopLoss?: string;
  readonly minutes?: number;
  /** Indexes of earlier actions this one waits for (fan-out). */
  readonly after?: readonly number[];
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

export interface IntentConstraints {
  /** Per swap or IOC order, basis points. Default 50. */
  readonly maxSlippageBps?: number;
  /** Unix seconds after which the plan must not be executed. */
  readonly deadline?: number;
  readonly maxFeeUsd?: string;
  /** Longest acceptable settlement estimate for a cross-network step, seconds. */
  readonly maxSeconds?: number;
  readonly preferProtocols?: readonly string[];
  readonly avoidProtocols?: readonly string[];
}

export interface IntentRequest {
  /** Natural-language outcome. Either `text` or `actions` is required. */
  readonly text?: string;
  readonly actions?: readonly IntentActionSpec[];
  readonly accounts: readonly AccountId[];
  readonly environment?: NetworkEnvironment;
  readonly constraints?: IntentConstraints;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Client idempotency key. */
  readonly clientReference?: string;
}
