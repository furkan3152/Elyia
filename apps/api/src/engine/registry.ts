/**
 * The adapter registry (ported from Kletia's adapters/registry.ts): the
 * default preference order (the auction's last tie-break), candidate
 * selection for a route (supports + requested/avoided/preferred protocols,
 * explicit-only venues) and the adapter of a stored step.
 */
import type { IntentStep } from "@elyia/core";
import { createElysiumBridgeAdapter, createMirrorBridgeAdapter } from "./adapters/elysiumBridge.js";
import { createHypercoreLinkAdapter } from "./adapters/hypercoreLink.js";
import { createHypercoreTradeAdapter } from "./adapters/hypercoreTrade.js";
import { createHypercoreAgentAdapter, createHypercoreTransferAdapter } from "./adapters/hypercoreWallet.js";
import { createKinetiqAdapter } from "./adapters/kinetiq.js";
import { createV2SwapAdapter } from "./adapters/swapV2.js";
import { createV3SwapAdapter } from "./adapters/swapV3.js";
import { createEvmTransferAdapter, createWrapAdapter } from "./adapters/transfer.js";
import type { EngineDeps } from "./deps.js";
import { engineError } from "./errors.js";
import type { AdapterRoute, ProtocolAdapter } from "./types.js";
import { createLendingAdapter } from "./adapters/lending.js";
import { createSignalAdapter } from "./adapters/signalV4.js";
import { createVaultAdapter } from "./adapters/vault4626.js";
import { LENDING_VENUES, V2_VENUES, V3_VENUES, VAULT_VENUES } from "./venues.js";

/** The built-in adapters in preference order. */
export function createAdapters(deps: EngineDeps): ProtocolAdapter[] {
  return [
    createEvmTransferAdapter(deps),
    createWrapAdapter(deps),
    ...V3_VENUES.map((venue) => createV3SwapAdapter(deps, venue)),
    ...V2_VENUES.map((venue) => createV2SwapAdapter(deps, venue)),
    createSignalAdapter(deps),
    createKinetiqAdapter(deps),
    ...VAULT_VENUES.map((venue) => createVaultAdapter(deps, venue)),
    ...LENDING_VENUES.map((venue) => createLendingAdapter(deps, venue)),
    createElysiumBridgeAdapter(deps),
    createMirrorBridgeAdapter(deps),
    createHypercoreLinkAdapter(deps),
    createHypercoreAgentAdapter(deps),
    createHypercoreTransferAdapter(deps),
    createHypercoreTradeAdapter(deps),
  ];
}

export interface CandidateOptions {
  /** A protocol (or venue id) the request named. */
  readonly requested?: string;
  readonly prefer?: readonly string[];
  readonly avoid?: readonly string[];
}

export class AdapterRegistry {
  constructor(readonly adapters: readonly ProtocolAdapter[]) {}

  /** Adapters that can serve the route, preferred first; a named protocol narrows to it. */
  candidates(route: AdapterRoute, options: CandidateOptions = {}): ProtocolAdapter[] {
    const avoid = new Set(options.avoid ?? []);
    const prefer = options.prefer ?? [];
    const matches = this.adapters.filter((adapter) => {
      if (!adapter.supports(route)) return false;
      if (adapter.protocols.some((protocol) => avoid.has(protocol)) && !(options.requested && adapter.protocols.includes(options.requested))) return false;
      if (options.requested) return adapter.protocols.includes(options.requested) || adapter.id === options.requested;
      return !adapter.explicitOnly || adapter.protocols.some((protocol) => prefer.includes(protocol));
    });
    const rank = (adapter: ProtocolAdapter) => {
      const index = adapter.protocols.map((protocol) => prefer.indexOf(protocol)).filter((value) => value >= 0);
      return index.length > 0 ? Math.min(...index) : prefer.length;
    };
    return matches
      .map((adapter, order) => ({ adapter, order }))
      .sort((a, b) => rank(a.adapter) - rank(b.adapter) || a.order - b.order)
      .map((entry) => entry.adapter);
  }

  /** The adapter that executes a stored step. */
  forStep(step: IntentStep): ProtocolAdapter {
    const byKind = this.adapters.find((adapter) => adapter.handles?.(step));
    if (byKind) return byKind;
    if (step.kind === "agent") return this.byId("hypercore-agent");
    if ((step.kind === "transfer" || step.kind === "margin") && step.protocol === "hypercore-transfers") return this.byId("hypercore-transfers");
    const adapter = this.adapters.find((candidate) => candidate.protocols.includes(step.protocol) && candidate.id !== "hypercore-agent");
    if (!adapter) throw engineError("STEP_INVALID", `No adapter executes protocol ${step.protocol}.`);
    return adapter;
  }

  byId(id: string): ProtocolAdapter {
    const adapter = this.adapters.find((candidate) => candidate.id === id);
    if (!adapter) throw engineError("STEP_INVALID", `No adapter ${id}.`);
    return adapter;
  }
}

/**
 * Registry protocol ids the running adapters execute (feed for core
 * `withExecutable`, so the protocol registry reports what actually runs).
 */
export function activeProtocolIds(adapters: readonly ProtocolAdapter[]): string[] {
  return [...new Set(adapters.flatMap((adapter) => adapter.protocols))];
}
