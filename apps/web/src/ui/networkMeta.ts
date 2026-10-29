import { NETWORKS, isNetworkKey, type NetworkFamily, type NetworkKey } from "@elyia/core/networks";

import type { Tone } from "./tones";

/**
 * Fixed realm identity, the same everywhere (app, Telegram cards, agent):
 * Elysium is the sun (gold), HyperEVM is sky, HyperCore is violet.
 */
export interface RealmMeta {
  readonly family: NetworkFamily;
  readonly label: string;
  readonly tone: Tone;
  /** Raw CSS colour for canvases and SVG. */
  readonly color: string;
  readonly role: string;
}

export const REALMS: Readonly<Record<NetworkFamily, RealmMeta>> = Object.freeze({
  elysium: { family: "elysium", label: "Elysium", tone: "gold", color: "rgb(var(--gold))", role: "Arbitrum Orbit L2, ~115 ms blocks" },
  hyperevm: { family: "hyperevm", label: "HyperEVM", tone: "sky", color: "rgb(var(--sky))", role: "Hyperliquid's EVM, Elysium's settlement layer" },
  hypercore: { family: "hypercore", label: "HyperCore", tone: "violet", color: "rgb(var(--violet-glow))", role: "Perps and spot order books" },
});

export interface NetworkView {
  readonly family: NetworkFamily;
  readonly key: NetworkKey | null;
  readonly label: string;
  readonly environment: "testnet" | "mainnet" | null;
  readonly realm: RealmMeta;
}

/** Display data for a network key or a bare family. */
export function networkView(network: NetworkKey | NetworkFamily): NetworkView {
  if (isNetworkKey(network)) {
    const entry = NETWORKS[network];
    return { family: entry.family, key: network, label: entry.shortName, environment: entry.environment, realm: REALMS[entry.family] };
  }
  return { family: network, key: null, label: REALMS[network].label, environment: null, realm: REALMS[network] };
}
