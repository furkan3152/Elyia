/**
 * Markets: HyperCore perps/spot/HIP-3 markets, books, trades, candles, funding, reference prices and the market SSE stream.
 *
 * Routes (relative to /v1): GET /markets/stream (SSE), /markets, /markets/:coin,
 * /markets/:coin/book, /markets/:coin/trades, /markets/:coin/candles,
 * /funding, /prices, /vaults, /whales. Contract types: @elyia/core/api/markets.
 */
import type { ApiModule } from "../../http/router.js";
import { registerMarketRoutes } from "./routes.js";
import { closeLedgerServices, ledgerServices } from "./services.js";
import { registerMarketStream } from "./stream.js";

export const marketsModule: ApiModule = {
  name: "markets",
  register(router, ctx) {
    const services = ledgerServices(ctx);
    // The stream route first: `/markets/stream` must not be read as a coin.
    registerMarketStream(router, ctx, services);
    registerMarketRoutes(router, ctx, services);
  },
  stop(ctx) {
    closeLedgerServices(ctx);
  },
};
