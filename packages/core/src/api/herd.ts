/**
 * Wire contract of The Herd (the Ely NFT collection) and its WL platform:
 * collection config and live counters, metadata, holder perks, WL tasks and
 * applications, the usage score, raffles, Merkle lists, snapshots, the mint
 * dashboard and the admin's prepared transactions. Import as
 * `@elyia/core/api/herd`.
 *
 * Nothing here promises financial returns: utilities are platform perks.
 * The server never signs: every on-chain action is calldata the wallet signs.
 */
import type { NetworkKey } from "../networks.js";

export const HERD_API_VERSION = "elyia.api.herd/v1" as const;

/** Spec defaults (the contract is the source of truth once deployed). */
export const HERD_MAX_SUPPLY = 3333;
export const HERD_DEFAULT_ALLOCATIONS = Object.freeze({ team: 111, public: 1611, wlAndCollab: 1611 });

/** On-chain phase order: CLOSED → WL (allowlist + collab) → PUBLIC → ENDED. */
export const HERD_PHASES = Object.freeze(["closed", "wl", "public", "ended"] as const);
export type HerdPhase = (typeof HERD_PHASES)[number];

/** Merkle lists: the WL allowlist, collab partner lists, and the testnet → mainnet snapshot. */
export const HERD_LISTS = Object.freeze(["wl", "collab", "snapshot"] as const);
export type HerdListId = (typeof HERD_LISTS)[number];
/** The contract's `listId` for setMerkleRoot (snapshot is published as the mainnet WL root). */
export const HERD_LIST_INDEX: Readonly<Record<"wl" | "collab", number>> = Object.freeze({ wl: 0, collab: 1 });

export type HerdPriceMode = "fixed" | "usd";

export interface HerdPhaseWindow {
  readonly phase: HerdPhase;
  /** ISO 8601, null = not scheduled. */
  readonly start: string | null;
  readonly end: string | null;
  readonly priceMode: HerdPriceMode;
  /** Fixed price in wei (decimal string). */
  readonly priceWei: string;
  /** USD price with 6 decimals (decimal string), mainnet mode. */
  readonly priceUsd6: string;
}

export interface HerdAllocations {
  readonly team: number;
  readonly wl: number;
  readonly collab: number;
  readonly public: number;
  readonly teamMinted: number;
  readonly wlMinted: number;
  readonly collabMinted: number;
  readonly publicMinted: number;
  /** Supply removed for good by rollover(…, BURN, …). */
  readonly burned: number;
}

/** rollover buckets (ElyHerd.Bucket order). */
export const HERD_BUCKETS = Object.freeze(["team", "wl", "collab", "public", "burn"] as const);
export type HerdBucket = (typeof HERD_BUCKETS)[number];

export interface HerdOracleState {
  /** Kalos V3 WHYPE/USD pool; null = no TWAP configured. */
  readonly pool: string | null;
  readonly twapSeconds: number;
  readonly maxDeviationBps: number;
  /** Admin fallback HYPE/USD price (6 decimals as a decimal string); "0" = off. */
  readonly fallbackUsdPerHype6: string;
  readonly fallbackUpdatedAt: string | null;
  readonly fallbackMaxStaleness: number;
  /** The fallback is older than its staleness window (a USD-priced mint then needs the TWAP). */
  readonly fallbackStale: boolean;
}

export interface HerdAdminState {
  readonly owner: string | null;
  readonly pendingOwner: string | null;
  readonly treasury: string | null;
  readonly eoaOnly: boolean | null;
  readonly maxMintable: number | null;
  readonly placeholderURI: string | null;
  readonly baseURI: string | null;
  readonly contractURI: string | null;
  readonly revealCommitBlock: number | null;
  readonly revealOffset: number | null;
  readonly revealDelayBlocks: number | null;
  readonly oracle: HerdOracleState | null;
  readonly balanceWei: string | null;
}

export interface HerdQuote {
  readonly phase: HerdPhase;
  /** Wei due now (decimal string); null when the price source is unavailable (the mint fails closed). */
  readonly wei: string | null;
  readonly source: "fixed" | "twap" | "fallback" | "unavailable";
  readonly note: string | null;
}

export type HerdChainSource = "chain" | "not-deployed" | "chain-error";

/** GET /v1/herd?network=. */
export interface HerdConfigResponse {
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly testnet: boolean;
  /** "not-deployed": no ElyHerd recorded in the admin registry; counters are spec defaults, labelled. */
  readonly source: HerdChainSource;
  readonly address: string | null;
  readonly note: string | null;
  readonly name: string;
  readonly symbol: string;
  readonly maxSupply: number;
  readonly totalSupply: number | null;
  readonly remaining: number | null;
  readonly soldOut: boolean;
  readonly phase: HerdPhase | null;
  readonly paused: boolean | null;
  readonly allocations: HerdAllocations | null;
  readonly defaults: typeof HERD_DEFAULT_ALLOCATIONS;
  readonly timeline: readonly HerdPhaseWindow[];
  readonly quotes: readonly HerdQuote[];
  readonly merkleRoots: { readonly wl: string | null; readonly collab: string | null };
  readonly reveal: { readonly revealed: boolean | null; readonly provenanceHash: string | null; readonly frozen: boolean | null };
  /** Owner-side state (public reads too: nothing here is secret). Null when not deployed. */
  readonly admin: HerdAdminState | null;
  /** Each phase's window holds now and the phase is current and unpaused (isOpen). */
  readonly open: { readonly wl: boolean | null; readonly public: boolean | null };
  readonly royalty: { readonly receiver: string | null; readonly bps: number | null };
  readonly perWallet: 1;
  /** Recorded ElyHerd per network (public addresses). */
  readonly deployments: readonly { readonly network: NetworkKey; readonly address: string }[];
  readonly links: HerdLinks;
  readonly generatedAt: string;
}

/** Owner-provided links (null = not configured; never invented). */
export interface HerdLinks {
  readonly xProfile: string | null;
  readonly engagementPosts: readonly string[];
  readonly marketplace: string | null;
  readonly treasury: string | null;
  readonly mainnetLaunch: string | null;
  readonly xApi: boolean;
}

/** OpenSea-style metadata, as marketplaces read it. */
export interface HerdTokenMetadata {
  readonly name: string;
  readonly description: string;
  readonly image: string;
  readonly external_url?: string;
  readonly attributes: readonly { readonly trait_type: string; readonly value: string | number }[];
  readonly revealed?: boolean;
}

/* ---------------------------------------------------------------- perks */

export interface HerdPerks {
  readonly holder: boolean;
  readonly balance: number;
  /** Signed-in agent chat turns per UTC day. */
  readonly agentChatPerDay: number;
  readonly automations: number;
  readonly alerts: number;
  /** Multiplier on developer API key quotas. */
  readonly developerQuotaMultiplier: number;
  readonly priorityKeeper: boolean;
  readonly earlyAccess: boolean;
  readonly badge: boolean;
  /** "chain": balanceOf read now or cached briefly; "not-deployed" / "chain-error": base perks. */
  readonly source: HerdChainSource;
  readonly checkedAt: string;
}

export const HERD_BASE_PERKS = Object.freeze({ agentChatPerDay: 200, automations: 12, alerts: 50, developerQuotaMultiplier: 1 });
export const HERD_HOLDER_PERKS = Object.freeze({ agentChatPerDay: 1000, automations: 24, alerts: 100, developerQuotaMultiplier: 2 });

/** GET /v1/herd/holder/:address. */
export interface HerdHolderResponse {
  readonly address: string;
  readonly network: NetworkKey;
  readonly balance: number;
  /** From the mint indexer (Transfer-aware); may lag the chain by a poll. */
  readonly tokenIds: readonly number[];
  readonly minted: boolean | null;
  readonly perks: HerdPerks;
}

/* ------------------------------------------------------------ WL tasks */

export const HERD_TASK_KINDS = Object.freeze(["share-card", "follow-x", "engage-post", "custom"] as const);
export type HerdTaskKind = (typeof HERD_TASK_KINDS)[number];
export const HERD_VERIFICATION_MODES = Object.freeze(["manual", "link-check", "x-api"] as const);
export type HerdVerificationMode = (typeof HERD_VERIFICATION_MODES)[number];
/** What the applicant types for a task. */
export const HERD_EVIDENCE_KINDS = Object.freeze(["tweet-url", "post-url", "x-handle", "text", "none"] as const);
export type HerdEvidenceKind = (typeof HERD_EVIDENCE_KINDS)[number];

export interface HerdTask {
  readonly id: string;
  readonly kind: HerdTaskKind;
  readonly label: string;
  readonly description: string | null;
  /** The link to follow / engage with; null = not configured yet (the task shows "not configured"). */
  readonly url: string | null;
  readonly required: boolean;
  readonly points: number;
  readonly verification: HerdVerificationMode;
  readonly evidence: HerdEvidenceKind;
  readonly active: boolean;
  readonly order: number;
  readonly updatedAt: string;
}

export interface HerdTaskInput {
  readonly kind: HerdTaskKind;
  readonly label: string;
  readonly description?: string | null;
  readonly url?: string | null;
  readonly required?: boolean;
  readonly points?: number;
  readonly verification?: HerdVerificationMode;
  readonly evidence?: HerdEvidenceKind;
  readonly active?: boolean;
  readonly order?: number;
}

/** GET /v1/herd/wl/tasks. */
export interface HerdTasksResponse {
  readonly tasks: readonly HerdTask[];
  readonly applicationsOpen: boolean;
  readonly reapplyLimit: number;
  readonly links: HerdLinks;
}

/* ---------------------------------------------------------- the score */

export interface HerdScoreComponent {
  readonly key: string;
  readonly label: string;
  /** The raw measure ("7 settled routes"). */
  readonly measure: string;
  readonly points: number;
  readonly max: number;
  /** How to earn more of these points (using Elyia, never paying). */
  readonly tip: string | null;
}

export type HerdFlagSeverity = "info" | "warn" | "high";

export interface HerdSybilFlag {
  readonly code: "fresh-wallet" | "shared-ip" | "shared-device" | "handle-reused" | "no-usage" | "funding-cluster" | "wallet-moved";
  readonly severity: HerdFlagSeverity;
  readonly detail: string;
}

export interface HerdUsageScore {
  /** 0..100. */
  readonly score: number;
  /** Raffle weight: 1 + score/25, capped at 5; 0 when a high flag is not cleared. */
  readonly weight: number;
  readonly components: readonly HerdScoreComponent[];
  readonly computedAt: string;
  readonly formula: string;
}

/* -------------------------------------------------------- applications */

export const HERD_APPLICATION_STATUSES = Object.freeze(["pending", "approved", "rejected", "waitlist"] as const);
export type HerdApplicationStatus = (typeof HERD_APPLICATION_STATUSES)[number];

export interface HerdTaskCheck {
  readonly taskId: string;
  readonly evidence: string | null;
  readonly state: "missing" | "submitted" | "verified" | "failed";
  readonly detail: string | null;
}

export interface HerdApplicationNote {
  readonly at: string;
  readonly by: string;
  readonly text: string;
}

export interface HerdApplication {
  readonly id: string;
  /** The SIWE-bound wallet (lower case). */
  readonly wallet: string;
  readonly xHandle: string;
  readonly status: HerdApplicationStatus;
  readonly tasks: readonly HerdTaskCheck[];
  readonly score: HerdUsageScore;
  readonly flags: readonly HerdSybilFlag[];
  /** An admin cleared the flags (the raffle weight counts again). */
  readonly flagsCleared: boolean;
  readonly notes: readonly HerdApplicationNote[];
  /** Times applied (1 = first application; a re-application after rejection adds one). */
  readonly attempts: number;
  readonly referral: string;
  readonly referredBy: string | null;
  readonly movedFrom: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

/** POST /v1/herd/wl/apply. */
export interface HerdApplyRequest {
  /** Must equal the session's address. */
  readonly wallet: string;
  readonly xHandle: string;
  /** taskId -> evidence (a URL or text per the task's evidence kind). */
  readonly evidence: Readonly<Record<string, string>>;
  readonly referredBy?: string;
  /** A coarse, client-hashed device fingerprint (hashed again on the server). */
  readonly device?: string;
}

/** GET /v1/herd/wl/me. */
export interface HerdMeResponse {
  readonly wallet: string;
  readonly application: HerdApplication | null;
  /** The live score (also before applying). */
  readonly score: HerdUsageScore;
  readonly canApply: boolean;
  readonly reason: string | null;
  readonly reapplyLeft: number;
  readonly onList: { readonly list: "wl" | "collab"; readonly partner: string | null } | null;
  readonly pendingMove: { readonly to: string; readonly expiresAt: string } | null;
}

/** GET /v1/herd/wl/proof/:wallet. */
export interface HerdProofResponse {
  readonly wallet: string;
  readonly list: "wl" | "collab" | null;
  readonly partnerTag: string | null;
  readonly partnerTagHex: string | null;
  readonly proof: readonly string[];
  readonly root: string | null;
  /** The built root equals the contract's root for that list (false: the admin has not published it yet). */
  readonly rootOnChain: boolean | null;
  readonly note: string | null;
}

/* ------------------------------------------------------- admin: queue */

export interface HerdApplicationsQuery {
  readonly status?: HerdApplicationStatus;
  readonly minScore?: number;
  readonly flagged?: boolean;
  readonly tasksDone?: boolean;
  readonly q?: string;
  readonly sort?: "score" | "created" | "updated";
  readonly limit?: number;
  readonly cursor?: string;
}

export interface HerdApplicationsResponse {
  readonly applications: readonly HerdApplication[];
  readonly counts: Readonly<Record<HerdApplicationStatus, number>> & { readonly total: number; readonly flagged: number };
  readonly nextCursor: string | null;
}

export interface HerdDecisionRequest {
  readonly ids: readonly string[];
  readonly status: HerdApplicationStatus;
  readonly note?: string;
}

/* ------------------------------------------------------------ raffle */

export interface HerdRaffle {
  readonly id: string;
  readonly network: NetworkKey;
  readonly status: "committed" | "drawn" | "applied";
  readonly winners: number;
  readonly targetBlock: number;
  readonly committedAtBlock: number;
  readonly entrants: number;
  readonly totalWeight: number;
  /** keccak256 of the sorted (wallet, weight×1000) entrant list, fixed at commit. */
  readonly entrantsHash: string;
  readonly blockHash: string | null;
  /** keccak256(abi.encode(blockHash, entrantsHash, raffleId)). */
  readonly seed: string | null;
  readonly drawn: readonly string[];
  readonly algorithm: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly drawnAt: string | null;
}

/* ------------------------------------------------------- merkle lists */

export interface HerdMerkleBuild {
  readonly list: HerdListId;
  readonly network: NetworkKey;
  readonly root: string;
  readonly count: number;
  readonly leafEncoding: string;
  readonly builtAt: string;
  readonly builtBy: string;
  /** The contract's current root for this list (null: not deployed / not readable). */
  readonly onChainRoot: string | null;
}

export interface HerdPartner {
  readonly tag: string;
  /** bytes32 of the tag (what the contract and the leaves use). */
  readonly tagHex: string;
  readonly name: string;
  readonly cap: number;
  readonly wallets: readonly string[];
  readonly updatedAt: string;
}

export interface HerdSnapshotEntry {
  readonly address: string;
  readonly reasons: readonly ("wl-approved" | "collab" | "minted")[];
}

export interface HerdSnapshot {
  readonly network: NetworkKey;
  readonly generatedAt: string;
  readonly count: number;
  readonly root: string;
  readonly leafEncoding: string;
  readonly entries: readonly HerdSnapshotEntry[];
}

/* ------------------------------------------------- admin: prepared txs */

/** An unsigned owner call for the admin wallet. The server never signs or sends. */
export interface HerdPreparedTx {
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly to: string;
  readonly data: `0x${string}`;
  readonly value: "0";
  readonly functionName: string;
  readonly args: readonly string[];
  readonly summary: string;
  readonly warnings: readonly string[];
  readonly abiSource: "artifact" | "spec";
  /** eth_call from the owner now (null: no RPC). A revert is also listed in warnings. */
  readonly simulation: { readonly ok: boolean; readonly error: string | null } | null;
}

export interface HerdPrepareRequest {
  readonly network?: NetworkKey;
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/* ------------------------------------------------------ mint dashboard */

export interface HerdMintEvent {
  readonly tokenId: number;
  readonly to: string;
  readonly phase: HerdPhase | null;
  /** "team" (TeamMinted) or "collab" (CollabMinted) when the mint came from that bucket, else null. */
  readonly bucket?: "team" | "collab" | null;
  readonly priceWei: string;
  readonly block: number;
  readonly txHash: string;
}

export interface HerdDashboardResponse {
  readonly network: NetworkKey;
  readonly address: string | null;
  readonly indexedTo: number | null;
  readonly head: number | null;
  readonly minted: number;
  readonly byPhase: Readonly<Record<string, number>>;
  readonly revenueWei: string;
  readonly contractBalanceWei: string | null;
  readonly holders: number;
  readonly recent: readonly HerdMintEvent[];
  readonly topHolders: readonly { readonly address: string; readonly count: number }[];
  readonly applications: Readonly<Record<HerdApplicationStatus, number>> & { readonly total: number };
  readonly note: string | null;
}

export interface HerdAuditEntry {
  readonly at: string;
  readonly by: string;
  readonly action: string;
  readonly detail: string;
}

/** Admin-settable WL settings (store). */
export interface HerdSettings {
  readonly applicationsOpen: boolean;
  /** Re-applications allowed after a rejection (default 1). */
  readonly reapplyLimit: number;
  /** Wallet moves allowed per application (default 1). */
  readonly moveLimit: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export const DEFAULT_HERD_SETTINGS: Omit<HerdSettings, "updatedAt" | "updatedBy"> = Object.freeze({ applicationsOpen: true, reapplyLimit: 1, moveLimit: 1 });

/** Raffle weight from a score: 1 + score/25, capped at 5×. */
export function herdWeight(score: number): number {
  const value = 1 + Math.max(0, Math.min(100, score)) / 25;
  return Math.min(5, Math.round(value * 1000) / 1000);
}

/** "@Name" / "x.com/Name" / "name" -> "name" (lower case), or null when not a valid X handle. */
export function normalizeXHandle(input: string): string | null {
  let value = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)/iu.exec(value);
  if (url?.[1]) value = url[1];
  value = value.replace(/^@/u, "");
  return /^[A-Za-z0-9_]{1,15}$/u.test(value) ? value.toLowerCase() : null;
}

/** An x.com / twitter.com status URL -> { handle, id }, or null. */
export function parseXStatusUrl(input: string): { readonly handle: string; readonly id: string } | null {
  const match = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/iu.exec(input.trim());
  return match?.[1] && match[2] ? { handle: match[1].toLowerCase(), id: match[2] } : null;
}
