/**
 * Portfolio: one balance sheet across HyperCore, HyperEVM and Elysium, with history and a live stream.
 *
 *   GET /portfolio/:address?mode=testnet|mainnet           PortfolioSnapshot
 *   GET /portfolio/:address/history?mode=&days=1..90        PortfolioHistory
 *   GET /portfolio/:address/stream?mode=                    SSE: snapshot | unchanged | error
 *
 * Contract types: @elyia/core/api/portfolio. Read-only; nothing is signed.
 */
import { PORTFOLIO_STREAM_EVENTS, type PortfolioHistory, type PortfolioMode, type PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import type { ApiModule } from "../../http/router.js";
import { openSse } from "../../http/sse.js";
import { evmAddress, parseParams, parseQuery, queryInteger } from "../../http/validate.js";
import { closeLedgerServices, ledgerServices } from "../markets/services.js";
import { HistoryReader } from "./historyReader.js";
import { PortfolioHub } from "./hub.js";
import { hyperCoreNetworkFor, PortfolioReader } from "./sources.js";
import { buildSnapshot } from "./valuation.js";

const AddressParams = z.object({ address: evmAddress });
const ModeQuery = z.object({ mode: z.enum(["testnet", "mainnet"], { errorMap: () => ({ message: "Expected testnet or mainnet." }) }).optional() });
const HistoryQuery = ModeQuery.extend({ days: queryInteger(1, 90).optional() });

interface PortfolioServices {
  readonly reader: PortfolioReader;
  readonly history: HistoryReader;
  readonly hub: PortfolioHub;
}

const SERVICES = new WeakMap<AppContext, PortfolioServices>();

function portfolioServices(ctx: AppContext): PortfolioServices {
  let services = SERVICES.get(ctx);
  if (services) return services;
  const ledger = ledgerServices(ctx);
  const log = ctx.log.child({ component: "portfolio" });
  const reader = new PortfolioReader({ hyperliquid: ctx.hyperliquid, chains: ctx.chains, services: ledger, clock: ctx.clock, log });
  const hub = new PortfolioHub({
    load: async (address, mode) => buildSnapshot(await reader.read(address, mode)),
    now: () => ctx.clock.now(),
    remainingWeight: (mode) => ctx.hyperliquid.info(hyperCoreNetworkFor(mode)).remainingWeight,
    log,
  });
  services = { reader, history: new HistoryReader({ hyperliquid: ctx.hyperliquid, services: ledger, clock: ctx.clock }), hub };
  SERVICES.set(ctx, services);
  ledger.onClose(() => {
    hub.close();
    SERVICES.delete(ctx);
  });
  return services;
}

export const portfolioModule: ApiModule = {
  name: "portfolio",
  register(router, ctx) {
    const modeOf = (mode: PortfolioMode | undefined): PortfolioMode => mode ?? ctx.config.mode;

    router.get("/portfolio/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const mode = modeOf(parseQuery(req, ModeQuery).mode);
      const sources = await portfolioServices(ctx).reader.read(address, mode);
      res.json(buildSnapshot(sources));
    });

    router.get("/portfolio/:address/history", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const query = parseQuery(req, HistoryQuery);
      res.json(await portfolioServices(ctx).history.get(address, modeOf(query.mode), query.days ?? 30));
    });

    router.get("/portfolio/:address/stream", (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const mode = modeOf(parseQuery(req, ModeQuery).mode);
      const { hub } = portfolioServices(ctx);
      // Capacity fails as a 503 envelope before any SSE header; check, open and subscribe run in one synchronous section.
      hub.assertCapacity(address, mode);
      const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
      if (stream.closed) return;
      const unsubscribe = hub.subscribe(address, mode, (event) => {
        if (event.type === "snapshot") stream.send(PORTFOLIO_STREAM_EVENTS.snapshot, event.payload, event.payload.seq);
        else if (event.type === "unchanged") stream.send(PORTFOLIO_STREAM_EVENTS.unchanged, event.payload, undefined, { droppable: true });
        else stream.send(PORTFOLIO_STREAM_EVENTS.error, event.payload);
      });
      stream.onClose(unsubscribe);
    });
  },
  stop(ctx) {
    closeLedgerServices(ctx);
  },
};

/** In-process read of one snapshot (agent, MCP and Telegram reuse it; same caches as the route). */
export async function readPortfolio(ctx: AppContext, address: string, mode: PortfolioMode): Promise<PortfolioSnapshot> {
  return buildSnapshot(await portfolioServices(ctx).reader.read(address.toLowerCase(), mode));
}

/** In-process read of the history (fills, funding, PnL days). */
export async function readPortfolioHistory(ctx: AppContext, address: string, mode: PortfolioMode, days = 30): Promise<PortfolioHistory> {
  return portfolioServices(ctx).history.get(address.toLowerCase(), mode, days);
}
