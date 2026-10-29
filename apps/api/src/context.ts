/**
 * AppContext: everything a module needs, built once per process from Config.
 * Tests build one with fakes through `overrides` (clock, fetch, sockets,
 * store, pulse...). `closeContext` stops background work and closes pools.
 */
import type { NetworkKey } from "@elyia/core";
import { EventBus } from "./bus.js";
import { EvmChains } from "./chains/evm.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { elysiumNetworkFor, type Config } from "./config.js";
import { PulseService, type PulseFeed, type PulseOptions } from "./elysium/pulse.js";
import { createHttpLimits, type HttpLimits } from "./http/limits.js";
import { HyperliquidClients } from "./hyperliquid/index.js";
import type { FetchLike } from "./hyperliquid/info.js";
import type { SocketFactory } from "./hyperliquid/ws.js";
import { createLogger, type Logger } from "./log.js";
import { createStore } from "./store/index.js";
import type { Store } from "./store/types.js";

export interface AppContext {
  readonly config: Config;
  readonly log: Logger;
  readonly store: Store;
  /** viem clients and reads for the EVM networks (Elysium, HyperEVM). */
  readonly chains: EvmChains;
  /** Hyperliquid info clients and shared WebSockets per HyperCore network. */
  readonly hyperliquid: HyperliquidClients;
  /** The Elysium block poller (pulse + block stream). */
  readonly pulse: PulseFeed;
  readonly bus: EventBus;
  readonly clock: Clock;
  /** Per-IP rate-limit buckets and SSE slots; routes add `limits.heavy` / `limits.auth` as needed. */
  readonly limits: HttpLimits;
  /** Outbound HTTP used by upstream clients and probes (a seam for tests). */
  readonly fetch: FetchLike;
}

export interface ContextOverrides {
  readonly log?: Logger;
  readonly clock?: Clock;
  readonly store?: Store;
  readonly fetch?: FetchLike;
  readonly createSocket?: SocketFactory;
  readonly pulse?: PulseFeed;
  readonly pulseOptions?: Partial<PulseOptions>;
  readonly limits?: HttpLimits;
}

export function createContext(config: Config, overrides: ContextOverrides = {}): AppContext {
  const clock = overrides.clock ?? systemClock;
  const log = overrides.log ?? createLogger({ level: config.logLevel, base: { service: "elyia-api" }, clock });
  const fetchImpl: FetchLike = overrides.fetch ?? ((input, init) => fetch(input, init));
  const bus = new EventBus(log.child({ component: "bus" }));
  const store = overrides.store ?? createStore({ databaseUrl: config.databaseUrl, clock, log: log.child({ component: "store" }) });
  const chains = new EvmChains(config.networks);
  const hyperliquid = new HyperliquidClients({
    networks: config.networks,
    weightPerMinute: config.hyperliquid.weightPerMinute,
    clock,
    log,
    fetch: fetchImpl,
    ...(overrides.createSocket ? { createSocket: overrides.createSocket } : {}),
  });
  const defaultNetwork: NetworkKey = elysiumNetworkFor(config.mode);
  const pulse =
    overrides.pulse ??
    new PulseService({
      networks: config.networks,
      defaultNetwork,
      bus,
      clock,
      log,
      fetch: fetchImpl,
      ...(overrides.pulseOptions ? { options: overrides.pulseOptions } : {}),
    });
  const limits = overrides.limits ?? createHttpLimits(config.rateLimits);
  return { config, log, store, chains, hyperliquid, pulse, bus, clock, limits, fetch: fetchImpl };
}

/** Stops pollers and sockets, then closes the store. Safe to call twice. */
export async function closeContext(ctx: AppContext): Promise<void> {
  ctx.pulse.close();
  ctx.hyperliquid.close();
  ctx.bus.clear();
  await ctx.store.close().catch((error: unknown) => {
    ctx.log.warn("store close failed", { error: error instanceof Error ? error.message : String(error) });
  });
}
