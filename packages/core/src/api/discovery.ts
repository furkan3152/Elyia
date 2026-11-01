/**
 * Wire contract of the discovery endpoints: protocol registry listings and
 * the live on-chain check, address lookups, the flagged-token list, the
 * launch radar, the Shield token check and the Elysium ecosystem stats.
 * Import as `@elyia/core/api/discovery`.
 *
 * Conventions:
 * - Rows are the core registry rows (`ProtocolDescriptor`) unless a light
 *   `ProtocolSummary` view is asked for; `executable` reports what the
 *   running engine executes (`withExecutable`).
 * - Filters combine with AND; an unknown filter value is a 400, never an
 *   empty list.
 * - Look-alike and suspicious tokens are listed so clients can warn; they
 *   are never routable.
 */
import type { FlaggedToken } from "../assets.js";
import type { NetworkKey } from "../networks.js";
import type {
  DeploymentStatus,
  ProtocolCategory,
  ProtocolContract,
  ProtocolDescriptor,
  ProtocolKind,
  ProtocolStatus,
  ProtocolVerb,
} from "../protocols.js";

/** `?view=` of GET /v1/protocols. */
export type ProtocolView = "full" | "summary";

/** Query of GET /v1/protocols (all optional; strings as they arrive). */
export interface ProtocolListQuery {
  readonly network?: NetworkKey;
  /** Exact kind (`dex`, `nft`, `game`). */
  readonly kind?: ProtocolKind;
  /** A kind or a coarse category (`launchpad` also matches NFT rows). */
  readonly category?: ProtocolKind;
  readonly status?: ProtocolStatus;
  /** `true` / `false`: what the running engine executes. */
  readonly executable?: "true" | "false";
  readonly tag?: string;
  /** Case-insensitive text search over id, name, description, tags and contract addresses (2-64 chars). */
  readonly q?: string;
  readonly view?: ProtocolView;
}

export interface ProtocolNetworkSummary {
  readonly network: NetworkKey;
  readonly status: DeploymentStatus;
  /** Verified contracts listed on that network. */
  readonly contracts: number;
}

/** One protocol without contracts or adapter hints. */
export interface ProtocolSummary {
  readonly id: string;
  readonly name: string;
  readonly category: ProtocolCategory;
  readonly kind: ProtocolKind;
  readonly status: ProtocolStatus;
  readonly url: string;
  readonly networks: readonly ProtocolNetworkSummary[];
  readonly executable: boolean;
  readonly capabilities: readonly ProtocolVerb[];
  /** Census adapter tier, null when no selector was verified. */
  readonly adapterTier: "simulated" | "selectors" | null;
  readonly tags: readonly string[];
}

export interface ProtocolCounts {
  readonly byKind: Readonly<Record<ProtocolKind, number>>;
  readonly byStatus: Readonly<Record<ProtocolStatus, number>>;
}

/** GET /v1/protocols. */
export interface ProtocolListResponse<Row extends ProtocolDescriptor | ProtocolSummary = ProtocolDescriptor> {
  readonly count: number;
  readonly protocols: readonly Row[];
  /** Counts of the filtered rows. */
  readonly counts: ProtocolCounts;
  /** Rows in the whole registry. */
  readonly total: number;
  /** Registry ids the running engine executes (`withExecutable` input). */
  readonly executableIds: readonly string[];
}

/** GET /v1/protocols/:id. */
export interface ProtocolDetailResponse {
  readonly protocol: ProtocolDescriptor;
}

/* ------------------------------------------------- live registry check */

/** One protocol's on-chain presence and recent activity on a network (GET /v1/protocols/live). */
export interface ProtocolLiveRow {
  readonly protocolId: string;
  readonly name: string;
  readonly kind: ProtocolKind;
  readonly status: ProtocolStatus;
  readonly deploymentStatus: DeploymentStatus;
  /** Registry contracts on this network. */
  readonly contracts: number;
  /** Contracts whose bytecode is there now. */
  readonly present: number;
  /** Contracts that answered with no bytecode (gone, self-destructed or a wrong pin). */
  readonly missing: readonly string[];
  /** Contracts the check could not read. */
  readonly unknown: number;
  /** Logs the protocol's contracts emitted inside the activity window; null when the logs could not be read. */
  readonly recentLogs: number | null;
  /** At least one log inside the window; null when unknown. */
  readonly active: boolean | null;
  readonly lastActivityBlock: number | null;
}

export interface ProtocolLiveResponse {
  readonly network: NetworkKey;
  /** ISO time of the check (results are cached, see cacheSeconds). */
  readonly checkedAt: string;
  readonly cacheSeconds: number;
  readonly head: number | null;
  /** The recent-activity window (address-filtered eth_getLogs, at most 2,000 blocks per request). */
  readonly window: { readonly fromBlock: number; readonly toBlock: number; readonly blocks: number; readonly approxSeconds: number | null } | null;
  readonly protocols: readonly ProtocolLiveRow[];
  readonly totals: { readonly protocols: number; readonly contracts: number; readonly present: number; readonly missing: number; readonly active: number };
  /** What the check could not do and why (RPC limits, a network without RPC). */
  readonly notes: readonly string[];
}

/* -------------------------------------------------------- launch radar */

/** What a launch event is: a new AMM pair/pool or an event from a launchpad contract. */
export type LaunchKind = "v2-pair" | "v3-pool" | "v4-pool" | "launchpad-event";

export interface LaunchTokenView {
  readonly address: string;
  /** Read on chain; null when the getter is missing or the read failed. */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  /** In Elyia's verified token registry (quote assets such as WHYPE and USDC). */
  readonly verified: boolean;
  /** A known look-alike or suspicious token: never routable. */
  readonly flagged: FlaggedToken | null;
}

export interface LaunchView {
  /** `<network>:<txHash>:<logIndex>`, stable. */
  readonly id: string;
  readonly network: NetworkKey;
  readonly kind: LaunchKind;
  readonly protocolId: string;
  readonly protocolName: string;
  /** The registry contract that emitted the event. */
  readonly source: { readonly address: string; readonly role: string };
  /** The new pair / pool (V4: the pool id), when the event names one. */
  readonly pool: string | null;
  /** The tokens the event names (new launch tokens first, verified quote assets last). */
  readonly tokens: readonly LaunchTokenView[];
  /** topic0 of the event. */
  readonly topic: string;
  readonly blockNumber: number;
  readonly txHash: string;
  readonly logIndex: number;
  /** ISO time the radar first saw it. */
  readonly seenAt: string;
}

/** GET /v1/discovery/launches (`?network=&protocol=&kind=&limit=`). */
export interface LaunchesResponse {
  readonly network: NetworkKey;
  readonly launches: readonly LaunchView[];
  /** Highest block scanned so far; null before the first scan. */
  readonly scannedThrough: number | null;
  /** Registry factories / launchpads watched. */
  readonly sources: number;
  /** Blocks per eth_getLogs request (never more than 2,000). */
  readonly windowBlocks: number;
  readonly running: boolean;
  readonly notes: readonly string[];
}

/** SSE names on GET /v1/discovery/launches/stream: `launch` (LaunchView) and `status` (LaunchesResponse without launches). */
export const LAUNCH_STREAM_EVENTS = { launch: "launch", status: "status" } as const;

/* -------------------------------------------------------------- shield */

/**
 * The Shield verdict. Never "safe": `verified` means the token is in Elyia's
 * verified registry; `no-red-flags` means every check ran and none failed,
 * which is evidence, not a guarantee.
 */
export type ShieldVerdict = "verified" | "flagged" | "danger" | "caution" | "no-red-flags" | "unknown";

export type ShieldCheckId =
  | "registry"
  | "lookalike"
  | "bytecode"
  | "proxy"
  | "owner"
  | "privileges"
  | "metadata"
  | "route"
  | "buy"
  | "sell";

export interface ShieldCheck {
  readonly id: ShieldCheckId;
  readonly status: "pass" | "warn" | "fail" | "skipped";
  readonly title: string;
  readonly detail: string;
}

export interface ShieldSimulation {
  /** Engine venue the buy and sell were simulated on. */
  readonly venue: string;
  /** eth_simulateV1 from a state-overridden dummy account; nothing is broadcast. */
  readonly method: "eth_simulateV1";
  readonly buy: { readonly ok: boolean; readonly amountIn: string; readonly inSymbol: string; readonly quoted: string; readonly received: string | null; readonly taxBps: number | null; readonly gasUsed: string | null; readonly error?: string };
  readonly sell: { readonly ok: boolean; readonly amountIn: string | null; readonly delivered: string | null; readonly taxBps: number | null; readonly gasUsed: string | null; readonly error?: string } | null;
}

/** GET /v1/discovery/shield/:token?network=. */
export interface ShieldReport {
  readonly network: NetworkKey;
  readonly token: { readonly address: string; readonly symbol: string | null; readonly name: string | null; readonly decimals: number | null; readonly totalSupply: string | null };
  readonly verdict: ShieldVerdict;
  /** One sentence for the verdict. */
  readonly summary: string;
  readonly registry: { readonly verified: boolean; readonly flagged: FlaggedToken | null; readonly protocols: readonly AddressTouch[]; readonly warning: string | null };
  readonly bytecode: { readonly bytes: number | null; readonly proxy: { readonly kind: "eip1167" | "eip1967" | "eip1967-beacon"; readonly implementation: string | null; readonly admin: string | null } | null; readonly privileged: readonly string[] };
  readonly owner: { readonly address: string | null; readonly renounced: boolean | null };
  readonly simulation: ShieldSimulation | null;
  readonly checks: readonly ShieldCheck[];
  readonly checkedAt: string;
  readonly cacheSeconds: number;
  readonly disclaimer: string;
}

/* ------------------------------------------------------- elysium stats */

/** One figure with how it was obtained. */
export interface StatFigure<T = number> {
  readonly value: T | null;
  /** measured: read from the chain now; estimate: extrapolated from a sample; registry: counted from Elyia's registry. */
  readonly basis: "measured" | "estimate" | "registry";
  readonly source: string;
}

/** GET /v1/elysium/stats?network=. */
export interface ElysiumStatsResponse {
  readonly network: NetworkKey;
  readonly at: string;
  readonly chain: {
    readonly head: StatFigure;
    readonly blockTimeMs: StatFigure;
    readonly tps: StatFigure;
    readonly gasPriceGwei: StatFigure;
    readonly blocksPerDay: StatFigure;
    readonly txPerDay: StatFigure;
  };
  readonly ecosystem: {
    readonly protocols: StatFigure;
    readonly liveProtocols: StatFigure;
    readonly announcedProtocols: StatFigure;
    readonly verifiedContracts: StatFigure;
    readonly executableProtocols: StatFigure;
    readonly byKind: Readonly<Partial<Record<ProtocolKind, number>>>;
  };
  readonly activity: {
    readonly activeProtocols: StatFigure;
    readonly presentContracts: StatFigure;
    readonly launchesSeen: StatFigure;
    readonly launchWindowBlocks: StatFigure;
  };
  readonly notes: readonly string[];
}

/** One registry contract at the looked-up address. */
export interface AddressTouch {
  readonly protocolId: string;
  readonly protocolName: string;
  readonly network: NetworkKey;
  readonly deploymentStatus: DeploymentStatus;
  readonly contract: ProtocolContract;
}

/** GET /v1/addresses/:address/protocols (`?network=` optional). */
export interface AddressLookupResponse {
  readonly address: string;
  readonly protocols: readonly AddressTouch[];
  /** Set when the address is a known look-alike or suspicious token. */
  readonly flaggedToken: FlaggedToken | null;
}

/** GET /v1/tokens/flagged (`?network=` optional). */
export interface FlaggedTokenListResponse {
  readonly count: number;
  readonly tokens: readonly FlaggedToken[];
}
