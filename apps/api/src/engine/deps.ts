/**
 * What adapters, the planner and the service read from: the chain ports,
 * reference prices, the clock and a monotonic nonce source. Built once from
 * the AppContext (see engine/index.ts); tests build it from fakes.
 */
import type { Network, NetworkKey } from "@elyia/core";
import type { Clock } from "../clock.js";
import type { Logger } from "../log.js";
import type { EvmPort } from "./ports/evm.js";
import type { HyperCorePort } from "./ports/hypercore.js";
import type { ReferencePrices } from "./prices.js";

export interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/**
 * HyperCore nonces are unix ms, unique per signer: a monotonic counter
 * (max(now, last + 1)) so two payloads prepared in the same millisecond
 * never share one.
 */
export class NonceSource {
  private last = 0;
  constructor(private readonly clock: Clock) {}

  next(): number {
    const now = this.clock.now();
    this.last = Math.max(now, this.last + 1);
    return this.last;
  }
}

export interface EngineDeps {
  readonly evm: EvmPort;
  readonly core: HyperCorePort;
  readonly prices: ReferencePrices;
  readonly clock: Clock;
  readonly log: Logger;
  /** The config's network registry (RPC overrides applied). */
  readonly networks: Readonly<Record<NetworkKey, Network>>;
  readonly nonces: NonceSource;
  readonly random: RandomSource;
}
