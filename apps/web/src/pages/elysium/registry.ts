/**
 * The ecosystem registry (@elyia/core/protocols) as trail signs (pure): each
 * protocol filed under the highest altitude it is deployed on, with a route
 * condition from its most real deployment status. Nothing reads OPEN until a
 * deployment was seen working.
 */
import type { DeploymentStatus, ProtocolCategory, ProtocolDescriptor } from "@elyia/core/protocols";

import type { Condition } from "../../topo/geometry/conditions";
import type { Layer } from "../../topo/geometry/relief";

const ORDER: readonly DeploymentStatus[] = ["live", "testnet-live", "coming", "announced", "unverified"];

/** Best (most real) status across a protocol's deployments, or null when it lists none. */
export function bestStatus(protocol: ProtocolDescriptor): DeploymentStatus | null {
  let best: DeploymentStatus | null = null;
  let rank = Number.POSITIVE_INFINITY;
  for (const deployment of protocol.deployments) {
    const position = ORDER.indexOf(deployment.status);
    if (position >= 0 && position < rank) {
      rank = position;
      best = deployment.status;
    }
  }
  return best;
}

/** The highest altitude a protocol stands on: Summit (Elysium) over Ridge (HyperEVM) over Floor (HyperCore). */
export function altitudeOf(protocol: ProtocolDescriptor): Layer {
  const altitudes = protocol.deployments.map((deployment) => networkAltitude(deployment.network));
  if (altitudes.includes("summit")) return "summit";
  if (altitudes.includes("ridge")) return "ridge";
  return "floor";
}

function networkAltitude(network: string): Layer {
  return network.startsWith("elysium") ? "summit" : network.startsWith("hyperevm") ? "ridge" : "floor";
}

export function conditionOf(status: DeploymentStatus | null): Condition {
  return status === "live" || status === "testnet-live" ? "open" : "caution";
}

const STATUS_WORDS: Readonly<Record<DeploymentStatus, string>> = {
  live: "live on mainnet",
  "testnet-live": "working on testnet",
  coming: "scheduled",
  announced: "announced, nothing deployed",
  unverified: "reported, not confirmed",
};

const CATEGORY_WORDS: Readonly<Record<ProtocolCategory, string>> = {
  bridge: "bridge",
  perps: "perps",
  "spot-orderbook": "spot book",
  dex: "dex",
  aggregator: "aggregator",
  lending: "lending",
  cdp: "cdp",
  "liquid-staking": "liquid staking",
  staking: "staking",
  vault: "vaults",
  launchpad: "launchpad",
  prediction: "prediction",
  oracle: "oracle",
  infra: "infra",
  wallet: "wallet",
  indexer: "indexer",
  analytics: "analytics",
};

export interface TrailSign {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly url: string;
  readonly altitude: Layer;
  readonly status: DeploymentStatus | null;
  readonly condition: Condition;
  readonly reason: string;
  /** Elyia can route verbs through it (not discovery only). */
  readonly routable: boolean;
}

/** Trail signs grouped by altitude, Summit first; open signs first within an altitude, registry order otherwise. */
export function trailSigns(protocols: readonly ProtocolDescriptor[]): Readonly<Record<Layer, readonly TrailSign[]>> {
  const groups: Record<Layer, { sign: TrailSign; index: number }[]> = { summit: [], ridge: [], floor: [] };
  protocols.forEach((protocol, index) => {
    const altitude = altitudeOf(protocol);
    // The sign speaks for the altitude it stands on: Multicall3 on the Summit reads its Elysium status, not mainnet HyperEVM's.
    const status = bestStatus({ ...protocol, deployments: protocol.deployments.filter((deployment) => networkAltitude(deployment.network) === altitude) });
    const sign: TrailSign = {
      id: protocol.id,
      name: protocol.name,
      category: CATEGORY_WORDS[protocol.category] ?? protocol.category,
      url: protocol.url,
      altitude,
      status,
      condition: conditionOf(status),
      reason: status ? STATUS_WORDS[status] : "no deployment listed",
      routable: protocol.capabilities.length > 0,
    };
    groups[sign.altitude].push({ sign, index });
  });
  const rank = (sign: TrailSign) => (sign.status ? ORDER.indexOf(sign.status) : ORDER.length);
  const sort = (list: { sign: TrailSign; index: number }[]) => list.sort((a, b) => rank(a.sign) - rank(b.sign) || a.index - b.index).map((entry) => entry.sign);
  return { summit: sort(groups.summit), ridge: sort(groups.ridge), floor: sort(groups.floor) };
}
