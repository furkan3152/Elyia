import { NETWORKS, isNetworkKey, type NetworkFamily, type NetworkKey } from "@elyia/core/networks";

import type { Layer } from "../topo/geometry/relief";
import type { Tone } from "./tones";

/**
 * Fixed realm identity, the same everywhere (app, Telegram cards, agent):
 * the three layers are altitudes. HyperCore is THE FLOOR (lake teal),
 * HyperEVM THE RIDGE (rock ochre), Elysium THE SUMMIT (glacier aqua).
 */
export interface RealmMeta {
  readonly family: NetworkFamily;
  readonly label: string;
  /** Altitude name. */
  readonly layer: Layer;
  readonly altitude: string;
  readonly tone: Tone;
  /** Raw CSS colour for canvases and SVG. */
  readonly color: string;
  readonly role: string;
}

export const REALMS: Readonly<Record<NetworkFamily, RealmMeta>> = Object.freeze({
  elysium: { family: "elysium", label: "Elysium", layer: "summit", altitude: "The Summit", tone: "summit", color: "rgb(var(--summit))", role: "Arbitrum Orbit L2, ~114 ms blocks" },
  hyperevm: { family: "hyperevm", label: "HyperEVM", layer: "ridge", altitude: "The Ridge", tone: "ridge", color: "rgb(var(--ridge))", role: "Hyperliquid's EVM, Elysium's settlement layer" },
  hypercore: { family: "hypercore", label: "HyperCore", layer: "floor", altitude: "The Floor", tone: "floor", color: "rgb(var(--floor))", role: "Perps and spot order books" },
});

/** Layer -> network family. */
export const LAYER_FAMILY: Readonly<Record<Layer, NetworkFamily>> = Object.freeze({ floor: "hypercore", ridge: "hyperevm", summit: "elysium" });

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
