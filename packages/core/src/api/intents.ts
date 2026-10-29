/**
 * Contract types of the intents endpoints (`/v1/intents/*`), shared by the
 * API, the web app, Telegram and the Elysium Agent.
 *
 *   POST /v1/intents                              plan (and store unless dryRun)
 *   GET  /v1/intents/:id                          the graph (status re-derived on read)
 *   POST /v1/intents/:id/steps/:sid/prepare       fresh quote -> unsigned requests + quote binding
 *   POST /v1/intents/:id/steps/:sid/submit        references only -> verified from chain / info API
 *   GET  /v1/intents/:id/journey                  "where is my money"
 *   POST /v1/intents/:id/stop                     skip every unstarted step
 *   GET  /v1/intents/:id/stream                   SSE of IntentStreamEvent (Last-Event-ID resumes)
 *
 * The server never signs: wallets sign EVM transactions and user-signed
 * HyperCore actions, the in-browser agent key (or the opt-in Keeper) signs
 * L1 trading actions, and clients submit only references.
 */
import type { AccountId, EvmAddress } from "../caip.js";
import type { Sha256Digest } from "../canonical.js";
import type { GoalItem } from "../goals.js";
import type { IntentActionSpec, IntentConstraints, IntentGraph, IntentStatus, IntentStep, StepEvidence, StepExecutionPayload, StepStatus } from "../intent.js";
import type { Journey } from "../journey.js";
import type { NetworkEnvironment, NetworkKey } from "../networks.js";
import type { PolicyDecision, PolicyRuleId } from "../policyEvaluate.js";

export const INTENTS_API_VERSION = "elyia.api.intents/v1" as const;

/** Who signs HyperCore L1 trading actions: the in-browser agent key (default) or the opt-in Keeper. */
export type IntentSigner = "agent" | "keeper";

/** POST /v1/intents. Send `text`, `actions` or `goals`. */
export interface CreateIntentBody {
  readonly text?: string;
  readonly actions?: readonly IntentActionSpec[];
  /** Goal IR from the language layer (core goals.ts); compiled to actions by the planner. */
  readonly goals?: readonly GoalItem[];
  /** The user's own accounts, CAIP-10 (one 0x address re-homed per network is enough). */
  readonly accounts: readonly AccountId[];
  /** testnet (default in testnet mode) or mainnet. Capital never mixes. */
  readonly mode?: NetworkEnvironment;
  readonly constraints?: IntentConstraints;
  /** Signer of L1 trading actions. Default `agent`. */
  readonly signer?: IntentSigner;
  /** Address of the in-browser trade-only agent key (lets the planner skip or insert approveAgent). */
  readonly agent?: EvmAddress;
  /** Plan and quote only: nothing is stored. Also `?dryRun=true`. */
  readonly dryRun?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly clientReference?: string;
}

export interface PolicyReasonView {
  readonly rule: PolicyRuleId;
  readonly outcome: "deny" | "confirm";
  readonly message: string;
  readonly path?: string;
  readonly observed?: string;
  readonly limit?: string;
}

/** Rule Book decision as the API reports it. USD values use reference prices (HyperCore mainnet mids). */
export interface PolicySummary {
  readonly decision: PolicyDecision;
  readonly ruleBookHash: Sha256Digest;
  readonly reasons: readonly PolicyReasonView[];
  /** Notional of the intent in USD (2 decimals); null when unpriced. */
  readonly notionalUsd: string | null;
  /** Where USD values came from: always labelled, never a testnet pool. */
  readonly priceSource: "reference:hypercore-mainnet-mids";
  readonly evaluatedAt: string;
  /** True when the Rule Book was not consulted because every step only reduces risk (reduce-only orders, cancels). */
  readonly derisking?: boolean;
}

/** One venue that quoted a step during planning (the winner first). */
export interface VenueQuoteView {
  readonly stepId: string;
  readonly protocol: string;
  readonly expected: string;
  readonly minimum: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly winner: boolean;
  /** Why the venue cannot win, when it cannot. */
  readonly excluded?: "slow" | "unpriced" | "asset" | "failed";
  readonly note?: string;
}

export interface CreateIntentResponse {
  readonly intent: IntentGraph;
  readonly journey: Journey;
  readonly policy: PolicySummary;
  readonly quotes: readonly VenueQuoteView[];
  readonly dryRun: boolean;
  /** True when a repeated clientReference returned an earlier intent. */
  readonly replayed: boolean;
}

/** POST /v1/intents/:id/steps/:sid/prepare. */
export interface PrepareStepBody {
  /** Chain id the wallet is connected to, for user-signed HyperCore actions (`signatureChainId`). Default: the step's environment Elysium chain. */
  readonly signatureChainId?: number;
  /** In-browser agent address that will sign L1 actions (must be approved on HyperCore). */
  readonly agent?: EvmAddress;
  /** The user confirmed what the Rule Book asked to confirm (see PolicySummary reasons with outcome `confirm`). */
  readonly confirmed?: boolean;
}

export interface PrepareStepResponse {
  readonly intent: IntentGraph;
  readonly payload: StepExecutionPayload;
  readonly policy: PolicySummary;
  readonly warnings: readonly string[];
}

/** POST /v1/intents/:id/steps/:sid/submit: one reference per prepared request, in order. */
export interface SubmitStepBody {
  /** `0x…` tx hashes (EVM), `hc:cloid:<user>:<cloid>` (orders) or `hc:nonce:<signer>:<nonce>` (other HyperCore actions). */
  readonly references: readonly string[];
}

export interface SubmitStepResponse {
  readonly intent: IntentGraph;
  readonly step: IntentStep;
  /** What verification concluded right now (pending references are re-checked by the poller). */
  readonly verification: "confirmed" | "pending" | "failed";
}

export interface StopIntentResponse {
  readonly intent: IntentGraph;
}

export type IntentStreamEventType = "intent.snapshot" | "intent.created" | "intent.status_changed" | "intent.step_updated";

export interface IntentStepUpdate {
  readonly intentId: string;
  readonly stepId: string;
  readonly network: NetworkKey;
  readonly status: StepStatus;
  readonly evidence?: StepEvidence;
}

export interface IntentStatusChange {
  readonly intentId: string;
  readonly status: IntentStatus;
  readonly previous: IntentStatus;
}

/** SSE events of GET /v1/intents/:id/stream (`id:` = event id; send it back as Last-Event-ID). */
export type IntentStreamEvent =
  | { readonly id: string; readonly type: "intent.snapshot"; readonly at: string; readonly data: IntentGraph }
  | { readonly id: string; readonly type: "intent.created"; readonly at: string; readonly data: { readonly intentId: string; readonly status: IntentStatus } }
  | { readonly id: string; readonly type: "intent.status_changed"; readonly at: string; readonly data: IntentStatusChange }
  | { readonly id: string; readonly type: "intent.step_updated"; readonly at: string; readonly data: IntentStepUpdate };

/** Error codes the intents endpoints add to the catalog (errors.ts) and the infrastructure codes. */
export const INTENTS_ERROR_CODES = Object.freeze([
  "TEXT_NOT_SUPPORTED_YET",
  "INTENT_CLARIFY",
  "AGENT_KEY_REQUIRED",
  "AGENT_NOT_APPROVED",
  "KEEPER_DISABLED",
  "STEP_NOT_READY",
  "STEP_NOT_PREPARABLE",
  "STEP_NOT_AWAITING_SIGNATURE",
  "QUOTE_MOVED",
  "REFERENCE_INVALID",
  "REFERENCE_COUNT_MISMATCH",
  "REFERENCE_MISMATCH",
  "REFERENCE_WRONG_SENDER",
  "REFERENCE_WRONG_NETWORK",
  "REFERENCE_STALE",
  "REFERENCE_ALREADY_USED",
  "INTENT_IN_FLIGHT",
  "POLICY_DENIED",
  "POLICY_CONFIRMATION_REQUIRED",
  "FEATURE_UNAVAILABLE",
] as const);

export type { StepExecutionPayload };
