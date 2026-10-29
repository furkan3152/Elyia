import type { NetworkKey } from "@elyia/core/networks";
import { useEffect, useSyncExternalStore } from "react";

import { getPulseHub, type BlockFeed, type PulseSnapshot } from "../lib/pulse/pulseHub";

export type { BlockFeed, PulseSnapshot } from "../lib/pulse/pulseHub";

/**
 * The live Elysium pulse. Subscribes to GET /v1/elysium/blocks/stream (events
 * "block" and "pulse", typed by @elyia/core's PulseBlock and Pulse); if the API
 * is unreachable the shared hub polls the Elysium testnet public RPC from the
 * browser (~250 ms) so the Sun keeps living, and returns to the API when it
 * answers again. Every component shares one connection.
 *
 * Re-renders on every block. Components that only need a slice should use
 * `usePulseSelector` with a selector returning a primitive or a stored value.
 */
export function usePulse(network: NetworkKey = "elysium-testnet"): PulseSnapshot {
  const hub = getPulseHub(network);
  useEffect(() => hub.retain(), [hub]);
  return useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
}

/** A slice of the pulse; the component re-renders only when the slice changes (compare by Object.is). */
export function usePulseSelector<T>(selector: (snapshot: PulseSnapshot) => T, network: NetworkKey = "elysium-testnet"): T {
  const hub = getPulseHub(network);
  useEffect(() => hub.retain(), [hub]);
  const read = () => selector(hub.getSnapshot());
  return useSyncExternalStore(hub.subscribe, read, read);
}

/** The per-block feed for imperative visuals (Sun rays, heartbeat), stable for the network. */
export function usePulseFeed(network: NetworkKey = "elysium-testnet"): BlockFeed {
  const hub = getPulseHub(network);
  useEffect(() => hub.retain(), [hub]);
  return hub.feed;
}
