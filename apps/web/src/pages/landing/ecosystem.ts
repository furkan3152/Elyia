/** Kept only for src/visuals/constellation/__tests__ (retired visuals); delete together with src/visuals. The /elysium registry lives in pages/elysium/registry.ts. */
/** Ecosystem chips for the landing page, from @elyia/core's protocol registry (pure). */
import type { DeploymentStatus, ProtocolDescriptor } from "@elyia/core/protocols";

import type { Tone } from "../../ui/tones";

export interface EcosystemChip {
  readonly id: string;
  readonly name: string;
  readonly status: DeploymentStatus | "listed";
  readonly label: string;
  readonly tone: Tone;
}

const ORDER: readonly DeploymentStatus[] = ["live", "testnet-live", "coming", "announced", "unverified"];
const LABEL: Readonly<Record<DeploymentStatus | "listed", string>> = {
  live: "live",
  "testnet-live": "testnet",
  coming: "soon",
  announced: "announced",
  unverified: "unverified",
  listed: "listed",
};
const TONE: Readonly<Record<DeploymentStatus | "listed", Tone>> = {
  live: "mint",
  "testnet-live": "sky",
  coming: "violet",
  announced: "gold",
  unverified: "neutral",
  listed: "neutral",
};

/** Best (most real) status across a protocol's deployments. */
export function bestStatus(protocol: ProtocolDescriptor): DeploymentStatus | "listed" {
  let best: DeploymentStatus | "listed" = "listed";
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

/** User-facing protocols (infrastructure and indexers left out), most real first, registry order within a status. */
export function ecosystemChips(protocols: readonly ProtocolDescriptor[]): EcosystemChip[] {
  return protocols
    .filter((protocol) => protocol.category !== "infra" && protocol.category !== "indexer" && protocol.category !== "analytics")
    .map((protocol, index) => {
      const status = bestStatus(protocol);
      return { chip: { id: protocol.id, name: protocol.name, status, label: LABEL[status], tone: TONE[status] }, index };
    })
    .sort((a, b) => {
      const ra = a.chip.status === "listed" ? ORDER.length : ORDER.indexOf(a.chip.status);
      const rb = b.chip.status === "listed" ? ORDER.length : ORDER.indexOf(b.chip.status);
      return ra - rb || a.index - b.index;
    })
    .map((entry) => entry.chip);
}
