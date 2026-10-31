/**
 * Wire contract of the discovery endpoints (protocol registry listings,
 * address lookups and the flagged-token list). Import as
 * `@elyia/core/api/discovery`.
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
  /** A kind or a coarse category (`nft`, `launchpad`). */
  readonly category?: ProtocolKind;
  readonly status?: ProtocolStatus;
  /** `true` / `false`. */
  readonly executable?: "true" | "false";
  readonly tag?: string;
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
  readonly counts: ProtocolCounts;
}

/** GET /v1/protocols/:id. */
export interface ProtocolDetailResponse {
  readonly protocol: ProtocolDescriptor;
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
