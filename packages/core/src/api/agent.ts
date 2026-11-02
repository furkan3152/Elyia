/**
 * Wire contract of Ely, the Elyia agent: chat (SSE), threads, memory,
 * proposals and route cards, portfolio insights, automations and opt-in
 * Keeper mode. Import as `@elyia/core/api/agent`.
 *
 * Every write the agent makes is a proposal: a list of intent actions the
 * engine plans and the user signs. The only exception is Keeper mode, which
 * the owner turns on explicitly, bounds with caps and an expiry, and can
 * revoke at any time; even then the keeper only trades (no withdrawals,
 * no transfers to anyone but the owner).
 */
import type { IntentActionSpec } from "../intent.js";
import type { NetworkKey } from "../networks.js";
import type { LanguageAnswer, LanguageQuestion } from "./language.js";

export const AGENT_API_VERSION = "elyia.api.agent/v1" as const;

/* ---------------------------------------------------------- route cards */

/** What the user sees before signing: one card per proposal. */
export interface RouteCard {
  readonly title: string;
  /** One line per step, in order ("Swap 10 HYPE to USDC on Kalos V3"). */
  readonly steps: readonly { readonly network: NetworkKey; readonly protocol: string; readonly title: string }[];
  /** Expected and guaranteed outputs of the last step(s). */
  readonly outputs: readonly { readonly symbol: string; readonly expected: string; readonly minimum: string }[];
  readonly venues: readonly { readonly protocol: string; readonly expected: string; readonly winner: boolean; readonly note?: string }[];
  readonly feesUsd: string | null;
  readonly notionalUsd: string | null;
  /** Integrator fee of the developer whose widget or key asked (null: none). */
  readonly integratorFee: { readonly bps: number; readonly recipient: string; readonly developerId: string } | null;
  readonly policy: {
    readonly decision: string;
    readonly reasons: readonly string[];
    /** The same reasons with their Rule Book rule id and limit ("trading.maxNotionalUsd", "10000"). */
    readonly details?: readonly { readonly rule: string; readonly outcome: string; readonly message: string; readonly limit?: string; readonly observed?: string }[];
  };
  readonly warnings: readonly string[];
  readonly priceSource: "reference:hypercore-mainnet-mids";
  readonly estimatedSeconds: number | null;
}

/* ------------------------------------------------------------ proposals */

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";
export type ProposalOrigin = "chat" | "insight" | "automation" | "keeper";

export interface Proposal {
  readonly id: string;
  readonly owner: string;
  readonly origin: ProposalOrigin;
  readonly title: string;
  /** Deterministic reasoning with the numbers it used. */
  readonly explanation: string;
  readonly actions: readonly IntentActionSpec[];
  /** Dry-run plan of `actions`; null when the engine could not plan them (see `planError`). */
  readonly card: RouteCard | null;
  readonly planError: { readonly code: string; readonly message: string } | null;
  readonly status: ProposalStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Set once approved: the stored intent the client prepares and signs step by step. */
  readonly intentId: string | null;
  readonly insightId: string | null;
  readonly automationId: string | null;
  /** True when the keeper may execute it (trade-only, inside the keeper's caps). */
  readonly keeperEligible: boolean;
}

export interface ProposalListResponse {
  readonly proposals: readonly Proposal[];
}

/** POST /v1/agent/proposals/:id/decision. */
export interface ProposalDecisionRequest {
  readonly decision: "approve" | "reject";
  /** Approve through the opt-in keeper instead of the wallet (trade-only proposals). */
  readonly via?: "wallet" | "keeper";
  /** The signing browser's trade-only HyperCore key (needed when the proposal has HyperCore order steps). */
  readonly agent?: string;
}

export interface ProposalDecisionResponse {
  readonly proposal: Proposal;
  /** For wallet approvals: the intent to prepare and sign (`POST /v1/intents/:id/steps/:sid/prepare`). */
  readonly next: { readonly intentId: string; readonly firstStepId: string | null; readonly preparePath: string | null } | null;
  readonly keeper: { readonly executed: boolean; readonly detail: string } | null;
}

/* ----------------------------------------------------------------- chat */

/** POST /v1/agent/chat (SSE). */
export interface ChatRequest {
  readonly message: string;
  readonly threadId?: string;
  readonly locale?: "en" | "tr";
  /** The wallet the conversation is about (default: the session address). */
  readonly address?: string;
  /**
   * Answers to a `clarify` event's questions. Send them with the same
   * `message` the questions were asked about; the reader re-reads it with
   * the answers (and its signed `thread`) and Ely plans the result, or asks
   * the next questions in another `clarify` event.
   */
  readonly clarify?: ChatClarifyAnswers;
}

export interface ChatClarifyAnswers {
  /** `ChatClarifyEvent.thread`, verbatim. */
  readonly thread?: string;
  readonly answers: readonly LanguageAnswer[];
}

export const CHAT_STREAM_EVENTS = Object.freeze({
  thread: "thread",
  token: "token",
  toolCall: "tool_call",
  toolResult: "tool_result",
  proposal: "proposal",
  routeCard: "route_card",
  note: "note",
  clarify: "clarify",
  done: "done",
  error: "error",
} as const);

export interface ChatThreadEvent {
  readonly threadId: string;
  readonly mode: "ai" | "deterministic";
  readonly model: string | null;
}
export interface ChatTokenEvent {
  readonly text: string;
}
export interface ChatToolCallEvent {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export interface ChatToolResultEvent {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly summary: string;
}
/**
 * The turn ends asking: the language reader's open questions for the
 * sentence, with their options (shown as choice chips). Sent before `done`.
 * The turn's text still carries the prompts, for clients that ignore it.
 */
export interface ChatClarifyEvent {
  /** The chat thread the turn is stored in (null for anonymous chats). */
  readonly threadId: string | null;
  /** The sentence the questions are about: send it back as `message` with the answers. */
  readonly sentence: string;
  /** The reader's signed answer thread (null when no signer is configured). */
  readonly thread: string | null;
  readonly questions: readonly LanguageQuestion[];
  readonly locale: "en" | "tr";
}

export interface ChatDoneEvent {
  readonly threadId: string;
  readonly text: string;
  readonly proposals: readonly string[];
  readonly stopReason: string;
}

export interface ThreadMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  readonly proposals?: readonly string[];
}

export interface ThreadView {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ThreadMessage[];
}

export interface ThreadListResponse {
  readonly threads: readonly { readonly id: string; readonly title: string; readonly updatedAt: string; readonly messages: number }[];
}

/* --------------------------------------------------------------- memory */

export type RiskProfile = "careful" | "balanced" | "bold";

export interface TargetMix {
  /** Underlying (`HYPE`, `BTC`, `USD`) -> percent of net worth; sums to 100. */
  readonly weights: Readonly<Record<string, number>>;
  /** Drift in percentage points before a rebalance is proposed. */
  readonly bandPct: number;
}

export interface AgentMemory {
  readonly owner: string;
  readonly goals: readonly string[];
  readonly riskProfile: RiskProfile;
  readonly targetMix: TargetMix | null;
  /** Keep at least this much HYPE (gas) on each EVM layer. */
  readonly gasFloorHype: string;
  /** Holdings below this USD value count as dust. */
  readonly dustUsd: number;
  readonly locale: "en" | "tr";
  readonly updatedAt: string | null;
}

/* ------------------------------------------------------------- insights */

export const INSIGHT_KINDS = Object.freeze([
  "rebalance",
  "auto-protect",
  "liquidation-guard",
  "funding-harvest",
  "idle-cash",
  "what-if",
  "gas-top-up",
  "dust-sweep",
  "explain-pnl",
] as const);
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export interface Insight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly severity: "info" | "watch" | "act";
  readonly title: { readonly en: string; readonly tr: string };
  readonly explanation: { readonly en: string; readonly tr: string };
  /** The numbers behind it (deterministic, reproducible from the snapshot). */
  readonly figures: Readonly<Record<string, string | number | null>>;
  /** Draft actions the user can turn into a proposal (empty: information only). */
  readonly actions: readonly IntentActionSpec[];
  /** Paper only (testnet funding harvester): never executable. */
  readonly paper: boolean;
}

export interface ShockScenario {
  readonly underlying: string;
  readonly movePct: number;
  readonly pnlUsd: number;
  readonly netWorthAfterUsd: number;
  readonly liquidated: readonly string[];
}

export interface InsightsResponse {
  readonly address: string;
  readonly mode: "testnet" | "mainnet";
  readonly generatedAt: string;
  readonly netWorthUsd: number;
  readonly insights: readonly Insight[];
  readonly shocks: readonly ShockScenario[];
  readonly priceLabel: "reference" | "market";
  readonly notes: readonly string[];
}

/* ---------------------------------------------------------- automations */

export const AUTOMATION_KINDS = Object.freeze(["auto-protect", "liquidation-guard", "idle-sweep", "gas-top-up", "dust-sweep", "rebalance", "funding-harvest-paper"] as const);
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export interface AutomationInput {
  readonly kind: AutomationKind;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly enabled?: boolean;
  /** Let the opt-in keeper execute eligible proposals of this automation (trade-only). */
  readonly keeper?: boolean;
}

export interface Automation {
  readonly id: string;
  readonly owner: string;
  readonly kind: AutomationKind;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly enabled: boolean;
  readonly keeper: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
  readonly runs: number;
}

export interface AutomationListResponse {
  readonly automations: readonly Automation[];
  readonly catalog: readonly { readonly kind: AutomationKind; readonly title: { readonly en: string; readonly tr: string }; readonly params: Readonly<Record<string, { readonly type: string; readonly default: string | number | boolean; readonly description: string }>> }[];
}

/* --------------------------------------------------------------- keeper */

export type KeeperRealm = "hypercore" | "elysium";

export interface KeeperLimits {
  /** Largest notional of one keeper order, USD (reference prices). */
  readonly maxOrderUsd: number;
  /** Total notional per UTC day. */
  readonly maxDailyUsd: number;
  /** HyperCore coins the keeper may trade (empty: any coin; the keeper only ever places reduce-only orders). */
  readonly coins: readonly string[];
  /** Only orders that shrink a position. */
  readonly reduceOnly: boolean;
}

export const DEFAULT_KEEPER_LIMITS: KeeperLimits = Object.freeze({ maxOrderUsd: 250, maxDailyUsd: 1_000, coins: Object.freeze([]) as readonly string[], reduceOnly: true });
export const KEEPER_MAX_DAYS = 30;

/** POST /v1/agent/keeper/prepare. */
export interface KeeperPrepareRequest {
  readonly realm?: KeeperRealm;
  readonly days?: number;
  readonly limits?: Partial<KeeperLimits>;
  /** realm `elysium`: the owner's ElyAccount. */
  readonly account?: string;
}

export interface KeeperPrepareResponse {
  readonly realm: KeeperRealm;
  /** The fresh keeper key's address (the key never leaves the server, encrypted at rest). */
  readonly agentAddress: string;
  readonly agentName: string;
  readonly validUntil: string;
  readonly limits: KeeperLimits;
  /** What the owner signs: HyperCore `approveAgent` typed data, or the ElyAccount policy grant transaction. */
  readonly sign:
    | { readonly kind: "hypercore-approve-agent"; readonly action: Readonly<Record<string, unknown>>; readonly typedData: unknown }
    | { readonly kind: "elyaccount-grant"; readonly transaction: { readonly network: NetworkKey; readonly to: string; readonly data: string; readonly value: "0" } | null; readonly note: string };
}

export interface KeeperAuditEntry {
  readonly at: string;
  readonly action: string;
  readonly detail: string;
  readonly proposalId: string | null;
  readonly ok: boolean;
}

export interface KeeperStatusResponse {
  readonly configured: boolean;
  readonly state: "none" | "prepared" | "active" | "revoked" | "killed";
  readonly realm: KeeperRealm | null;
  readonly agentAddress: string | null;
  readonly validUntil: string | null;
  readonly limits: KeeperLimits | null;
  readonly spentTodayUsd: number;
  readonly killed: boolean;
  readonly audit: readonly KeeperAuditEntry[];
}

export interface KeeperRevokeResponse {
  readonly revoked: boolean;
  /** Also revoke on HyperCore: approve the zero address under the same agent name (sign in the wallet). */
  readonly revokeOnChain: { readonly kind: "hypercore-approve-agent"; readonly action: Readonly<Record<string, unknown>>; readonly typedData: unknown } | { readonly kind: "elyaccount-revoke"; readonly note: string } | null;
}

/** GET /v1/agent/feed. */
export interface FeedEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: "insight" | "proposal" | "automation" | "keeper" | "alert";
  readonly text: { readonly en: string; readonly tr: string };
  readonly proposalId: string | null;
}

export interface FeedResponse {
  readonly entries: readonly FeedEntry[];
}
