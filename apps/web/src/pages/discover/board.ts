/**
 * The trail board (pure): the protocol registry as signs, filterable by
 * altitude, category and whether Elyia can route through it, each with the
 * route condition from its most real deployment and, when Elyia executes a
 * verb there, one sentence that plans a route through it.
 */
import type { DeploymentStatus, ProtocolCategory, ProtocolDescriptor, ProtocolVerb } from "@elyia/core/protocols";

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
function sentenceFor(protocol: ProtocolDescriptor): string | null {
  if (!protocol.executable) return null;
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
  readonly routable: boolean;
  readonly query: string;
}

export const EMPTY_FILTER: BoardFilter = { altitude: "all", category: "all", routable: false, query: "" };

const ALTITUDE_RANK: Readonly<Record<Layer, number>> = { summit: 0, ridge: 1, floor: 2 };
const CONDITION_RANK: Readonly<Record<Condition, number>> = { open: 0, caution: 1, closed: 2 };

/** Filtered and sorted: Summit first, open before caution, Elyia-routable first, then by name. */
export function filterBoard(signs: readonly BoardSign[], filter: BoardFilter): BoardSign[] {
  const query = filter.query.trim().toLowerCase();
  return signs
    .filter((sign) => filter.altitude === "all" || sign.altitude === filter.altitude)
    .filter((sign) => filter.category === "all" || sign.category === filter.category)
    .filter((sign) => !filter.routable || sign.executable)
    .filter((sign) => !query || `${sign.name} ${sign.category} ${sign.description} ${sign.verbs.join(" ")}`.toLowerCase().includes(query))
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
