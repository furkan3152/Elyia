/**
 * The intent engine wired from the AppContext: chain and HyperCore ports
 * over the shared clients (cached, weight-budgeted), reference prices, the
 * adapter registry, planner, Rule Book gate, store and events, and the
 * service on top. One engine per context.
 */
import type { AppContext } from "../context.js";
import { NonceSource, type EngineDeps } from "./deps.js";
import { IntentEvents } from "./events.js";
import { Planner } from "./planner/build.js";
import { defaultRuleBooks, PolicyGate, type RuleBookSource } from "./policy.js";
import { ChainsEvmPort } from "./ports/evm.js";
import { InfoHyperCorePort } from "./ports/hypercore.js";
import { ReferencePrices } from "./prices.js";
import { AdapterRegistry, createAdapters } from "./registry.js";
import { IntentService } from "./service.js";
import { IntentStore } from "./store.js";

export interface Engine {
  readonly deps: EngineDeps;
  readonly registry: AdapterRegistry;
  readonly planner: Planner;
  readonly store: IntentStore;
  readonly events: IntentEvents;
  readonly gate: PolicyGate;
  readonly service: IntentService;
}

export interface EngineOptions {
  /** Overrides for tests (fake ports, a fixed rule book source). */
  readonly deps?: Partial<EngineDeps>;
  readonly ruleBooks?: RuleBookSource;
}

const engines = new WeakMap<AppContext, Engine>();

export function createEngine(ctx: AppContext, options: EngineOptions = {}): Engine {
  const core = options.deps?.core ?? new InfoHyperCorePort(ctx.hyperliquid);
  const deps: EngineDeps = {
    evm: options.deps?.evm ?? new ChainsEvmPort(ctx.chains, ctx.clock),
    core,
    prices: options.deps?.prices ?? new ReferencePrices(core, ctx.clock),
    clock: options.deps?.clock ?? ctx.clock,
    log: options.deps?.log ?? ctx.log.child({ component: "engine" }),
    networks: options.deps?.networks ?? ctx.config.networks,
    nonces: options.deps?.nonces ?? new NonceSource(ctx.clock),
    random: options.deps?.random ?? globalThis.crypto,
  };
  const registry = new AdapterRegistry(createAdapters(deps));
  const planner = new Planner(deps, registry);
  const store = new IntentStore(ctx.store, deps.clock);
  const events = new IntentEvents(ctx.bus, deps.clock);
  const gate = new PolicyGate(deps, options.ruleBooks ?? defaultRuleBooks, store);
  const service = new IntentService({ deps, registry, planner, store, events, gate, log: deps.log });
  return { deps, registry, planner, store, events, gate, service };
}

/** The context's engine (created on first use). */
export function engineFor(ctx: AppContext, options?: EngineOptions): Engine {
  let engine = engines.get(ctx);
  if (!engine) {
    engine = createEngine(ctx, options);
    engines.set(ctx, engine);
  }
  return engine;
}

/** Installs a prebuilt engine for a context (tests). */
export function setEngine(ctx: AppContext, engine: Engine): void {
  engines.set(ctx, engine);
}
