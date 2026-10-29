/**
 * The ledger services (markets + portfolio) of one AppContext, created on
 * first use and shared by both modules so caches, tapes and sweeps exist
 * once per process. `closeLedgerServices` stops their timers (module stop).
 */
import type { HyperCoreNetworkKey } from "@elyia/core/api/markets";
import type { AppContext } from "../../context.js";
import { MarketCatalog } from "./catalogService.js";
import { readKhypeToHype, ReferencePriceService } from "./reference.js";
import { TradeTape } from "./tape.js";
import { VaultDirectory } from "./vaults.js";
import { WhaleWatch } from "./whales.js";

export interface LedgerServices {
  readonly reference: ReferencePriceService;
  readonly catalog: MarketCatalog;
  readonly vaults: VaultDirectory;
  readonly whales: WhaleWatch;
  tape(network: HyperCoreNetworkKey): TradeTape;
  /** Extra teardown registered by other ledger parts (the portfolio stream hub). */
  onClose(callback: () => void): void;
  close(): void;
}

const SERVICES = new WeakMap<AppContext, LedgerServices>();

function createLedgerServices(ctx: AppContext): LedgerServices {
  const log = ctx.log.child({ component: "ledger" });
  const reference = new ReferencePriceService({
    info: () => ctx.hyperliquid.info("hypercore-mainnet"),
    khypeRate: () => readKhypeToHype(ctx.chains),
    clock: ctx.clock,
    log,
  });
  const catalog = new MarketCatalog({ hyperliquid: ctx.hyperliquid, reference, clock: ctx.clock });
  const vaults = new VaultDirectory({ fetch: ctx.fetch, clock: ctx.clock });
  const whales = new WhaleWatch({ hyperliquid: ctx.hyperliquid, fetch: ctx.fetch, clock: ctx.clock, log });
  const tapes = new Map<HyperCoreNetworkKey, TradeTape>();
  const closers: Array<() => void> = [];
  return {
    reference,
    catalog,
    vaults,
    whales,
    tape(network) {
      let tape = tapes.get(network);
      if (!tape) {
        tape = new TradeTape({ info: () => ctx.hyperliquid.info(network), ws: () => ctx.hyperliquid.ws(network), now: () => ctx.clock.now(), log });
        tapes.set(network, tape);
      }
      return tape;
    },
    onClose(callback) {
      closers.push(callback);
    },
    close() {
      for (const tape of tapes.values()) tape.close();
      tapes.clear();
      for (const callback of closers.splice(0)) callback();
    },
  };
}

export function ledgerServices(ctx: AppContext): LedgerServices {
  let services = SERVICES.get(ctx);
  if (!services) {
    services = createLedgerServices(ctx);
    SERVICES.set(ctx, services);
  }
  return services;
}

/** Stops the ledger's timers and subscriptions; the next `ledgerServices(ctx)` starts fresh. Idempotent. */
export function closeLedgerServices(ctx: AppContext): void {
  const services = SERVICES.get(ctx);
  if (!services) return;
  SERVICES.delete(ctx);
  services.close();
}
