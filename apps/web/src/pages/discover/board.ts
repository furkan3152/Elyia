/**
 * The trail board (pure): the protocol registry as signs, filterable by
 * altitude, category and whether Elyia can route through it, each with the
 * route condition from its most real deployment and, when Elyia executes a
 * verb there, one sentence that plans a route through it.
 */
import type { DeploymentStatus, ProtocolCategory, ProtocolDescriptor, ProtocolKind, ProtocolStatus, ProtocolVerb } from "@elyia/core/protocols";

import type { Condition } from "../../topo/geometry/conditions";
import type { Layer } from "../../topo/geometry/relief";
import { altitudeOf, bestStatus, conditionOf } from "../elysium/registry";

export interface BoardDeployment {
  readonly network: string;
  readonly layer: Layer;
  readonly status: DeploymentStatus;
  readonly since: string | null;
}

export interface BoardSign {
  readonly id: string;
  readonly name: string;
  readonly category: ProtocolCategory;
  /** The census kind (game, nft, tools, rwa, names, otc, stablecoin… or the category). */
  readonly kind: ProtocolKind;
  /** The registry's one-word status, with `prelaunch-mainnet` for rows deployed ahead of the public mainnet. */
  readonly status: BoardStatus;
  readonly description: string;
  readonly url: string;
  readonly altitude: Layer;
  readonly condition: Condition;
  readonly reason: string;
  readonly deployments: readonly BoardDeployment[];
  readonly verbs: readonly ProtocolVerb[];
  /** Elyia plans and executes here today. */
  readonly executable: boolean;
  /** A sentence that plans a route through this protocol, when one is safe to suggest. */
  readonly sentence: string | null;
}

const NETWORK_SHORT: Readonly<Record<string, string>> = {
  "elysium-testnet": "Elysium test",
  "elysium-mainnet": "Elysium",
  "hyperevm-testnet": "HyperEVM test",
  "hyperevm-mainnet": "HyperEVM",
  "hypercore-testnet": "HyperCore test",
  "hypercore-mainnet": "HyperCore",
};

export function networkShort(network: string): string {
  return NETWORK_SHORT[network] ?? network;
}

const STATUS_SHORT: Readonly<Record<DeploymentStatus, string>> = {
  live: "live",
  "testnet-live": "working",
  coming: "scheduled",
  announced: "announced",
  unverified: "unconfirmed",
};

export function statusShort(status: DeploymentStatus): string {
  return STATUS_SHORT[status];
}

const REASON: Readonly<Record<DeploymentStatus, string>> = {
  live: "live on mainnet",
  "testnet-live": "seen working on testnet",
  coming: "scheduled, not deployed",
  announced: "announced, nothing deployed",
  unverified: "reported, not confirmed",
};

function layerOf(network: string): Layer {
  return network.startsWith("elysium") ? "summit" : network.startsWith("hyperevm") ? "ridge" : "floor";
}

/** One sentence per verb that the planner understands, filled with small, safe amounts. */
/** Sentences checked against the live reader and planner (2026-11-01) for the venues that need their name. */
const SENTENCE_BY_ID: Readonly<Record<string, string | null>> = {
  "kalos-v3": "swap 0.01 HYPE to USDC on Kalos",
  "dex-da-costa": "swap 0.01 HYPE to USDC on dex da costa",
  cheshire: "lend 1 USDC on cheshire",
  "elyra-lending": "lend 0.1 USDC on elyra",
  kinetiq: "stake 1 HYPE with kinetiq",
  // Venue-specific tokens only (no HYPE/USDC pool, or an unpriced token the Rule Book refuses): no safe example.
  perpme: null,
  hexswap: null,
  "kalos-stkalos": null,
  signal: null,
};

function sentenceFor(protocol: ProtocolDescriptor): string | null {
  if (!protocol.executable) return null;
  if (protocol.id in SENTENCE_BY_ID) return SENTENCE_BY_ID[protocol.id] ?? null;
  const verbs = new Set(protocol.capabilities);
  if (verbs.has("bridge")) return "bridge 20 HYPE to Elysium";
  if (verbs.has("long")) return "long ETH 3x with 100 USDC, stop at -4%";
  if (verbs.has("twap")) return "twap buy 40 HYPE over 30 minutes";
  if (verbs.has("stake")) return protocol.id === "kinetiq" ? "stake 10 HYPE to kHYPE" : "stake 10 HYPE";
  if (verbs.has("swap")) return `swap 10 HYPE to USDC on ${protocol.name}`;
  if (verbs.has("deposit")) return `deposit 100 USDC into ${protocol.name}`;
  if (verbs.has("link") || verbs.has("transfer")) return "move all my HyperEVM USDC to perps";
  return null;
}

export function boardSigns(protocols: readonly ProtocolDescriptor[]): BoardSign[] {
  return protocols.map((protocol) => {
    const altitude = altitudeOf(protocol);
    const status = bestStatus({ ...protocol, deployments: protocol.deployments.filter((deployment) => layerOf(deployment.network) === altitude) });
    return {
      id: protocol.id,
      name: protocol.name,
      category: protocol.category,
      kind: protocol.kind,
      status: statusOf(protocol),
      description: protocol.description,
      url: protocol.url,
      altitude,
      condition: conditionOf(status),
      reason: status ? REASON[status] : "no deployment listed",
      deployments: protocol.deployments.map((deployment) => ({ network: deployment.network, layer: layerOf(deployment.network), status: deployment.status, since: deployment.since ?? null })),
      verbs: protocol.capabilities,
      executable: protocol.executable,
      sentence: sentenceFor(protocol),
    };
  });
}

export interface BoardFilter {
  readonly altitude: Layer | "all";
  readonly category: ProtocolCategory | "all";
  readonly kind: ProtocolKind | "all";
  readonly status: BoardStatus | "all";
  readonly network: BoardNetwork | "all";
  readonly routable: boolean;
  readonly query: string;
}

export const EMPTY_FILTER: BoardFilter = { altitude: "all", category: "all", kind: "all", status: "all", network: "all", routable: false, query: "" };

/** Status words the board filters on (core `ProtocolStatus`, with announced and prelaunch split out). */
export type BoardStatus = "live-testnet" | "live-mainnet" | "announced" | "prelaunch-mainnet" | "unknown" | "deprecated";
export const BOARD_STATUSES: readonly BoardStatus[] = ["live-testnet", "live-mainnet", "prelaunch-mainnet", "announced", "unknown", "deprecated"];

export function statusOf(protocol: Pick<ProtocolDescriptor, "status" | "mainnetPrelaunch" | "tags">): BoardStatus {
  const status: ProtocolStatus = protocol.status;
  if (status === "deprecated") return "deprecated";
  if (status === "live-mainnet") return "live-mainnet";
  if (protocol.mainnetPrelaunch || protocol.tags.includes("prelaunch-mainnet")) return status === "live-testnet" ? "live-testnet" : "prelaunch-mainnet";
  if (status === "announced-mainnet") return "announced";
  return status;
}

/** Networks grouped as the board shows them. */
export type BoardNetwork = "elysium-testnet" | "elysium-mainnet" | "hyperevm" | "hypercore";
export const BOARD_NETWORKS: readonly BoardNetwork[] = ["elysium-testnet", "elysium-mainnet", "hyperevm", "hypercore"];

export function boardNetworkOf(network: string): BoardNetwork | null {
  if (network === "elysium-testnet" || network === "elysium-mainnet") return network;
  if (network.startsWith("hyperevm")) return "hyperevm";
  if (network.startsWith("hypercore")) return "hypercore";
  return null;
}

/** Rows per kind, most common first (every kind present at least once). */
export function boardKinds(signs: readonly BoardSign[]): Array<{ readonly kind: ProtocolKind; readonly count: number }> {
  const counts = new Map<ProtocolKind, number>();
  for (const sign of signs) counts.set(sign.kind, (counts.get(sign.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export function countBy<K extends string>(signs: readonly BoardSign[], key: (sign: BoardSign) => readonly K[] | K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const sign of signs) {
    const keys = key(sign);
    for (const value of new Set(Array.isArray(keys) ? (keys as readonly K[]) : [keys as K])) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function signNetworks(sign: BoardSign): BoardNetwork[] {
  return [...new Set(sign.deployments.map((deployment) => boardNetworkOf(deployment.network)).filter((network): network is BoardNetwork => network !== null))];
}

const ALTITUDE_RANK: Readonly<Record<Layer, number>> = { summit: 0, ridge: 1, floor: 2 };
const CONDITION_RANK: Readonly<Record<Condition, number>> = { open: 0, caution: 1, closed: 2 };

/** Filtered and sorted: Summit first, open before caution, Elyia-routable first, then by name. */
export function filterBoard(signs: readonly BoardSign[], filter: BoardFilter): BoardSign[] {
  const query = filter.query.trim().toLowerCase();
  return signs
    .filter((sign) => filter.altitude === "all" || sign.altitude === filter.altitude)
    .filter((sign) => filter.category === "all" || sign.category === filter.category)
    .filter((sign) => (filter.kind ?? "all") === "all" || sign.kind === filter.kind)
    .filter((sign) => (filter.status ?? "all") === "all" || sign.status === filter.status)
    .filter((sign) => (filter.network ?? "all") === "all" || signNetworks(sign).includes(filter.network as BoardNetwork))
    .filter((sign) => !filter.routable || sign.executable)
    .filter((sign) => !query || `${sign.id} ${sign.name} ${sign.kind} ${sign.category} ${sign.description} ${sign.verbs.join(" ")}`.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        ALTITUDE_RANK[a.altitude] - ALTITUDE_RANK[b.altitude] ||
        CONDITION_RANK[a.condition] - CONDITION_RANK[b.condition] ||
        Number(b.executable) - Number(a.executable) ||
        a.name.localeCompare(b.name),
    );
}

/** Categories present on the board, most common first. */
export function boardCategories(signs: readonly BoardSign[]): Array<{ readonly category: ProtocolCategory; readonly count: number }> {
  const counts = new Map<ProtocolCategory, number>();
  for (const sign of signs) counts.set(sign.category, (counts.get(sign.category) ?? 0) + 1);
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
