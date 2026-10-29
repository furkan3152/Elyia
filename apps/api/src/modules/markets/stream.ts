/**
 * GET /v1/markets/stream?network=&coins=A,B&channels=mids,trades,book
 *
 * SSE fan-out of the shared Hyperliquid WebSocket (one upstream subscription
 * per coin and channel, refcounted across every client). Events: `ready`,
 * `mids`, `book`, `trades`, `dropped`, `error` (see @elyia/core/api/markets).
 * At most MAX_STREAM_COINS coins per stream. Mids of HIP-3 coins are derived
 * from their book (the shared `allMids` subscription covers the first dex
 * and spot only).
 */
import { MARKET_STREAM_EVENTS, type MarketStreamChannel, type MarketStreamReady } from "@elyia/core/api/markets";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { isElyiaHttpError } from "../../http/errors.js";
import { openSse } from "../../http/sse.js";
import { parseQuery, queryList } from "../../http/validate.js";
import { levelsView, MAX_BOOK_DEPTH, summarizeBook, tradeView } from "./book.js";
import { perpDexOf } from "./catalog.js";
import { StreamCoalescer } from "./coalescer.js";
import { coinParam, hyperCoreKeyFor, hyperCoreNetworkParam } from "./query.js";
import type { LedgerServices } from "./services.js";

export const MAX_STREAM_COINS = 8;
export const STREAM_FLUSH_MS = 250;
const CHANNELS: readonly MarketStreamChannel[] = ["mids", "trades", "book"];

const StreamQuery = z.object({
  network: hyperCoreNetworkParam.optional(),
  coins: queryList(MAX_STREAM_COINS, coinParam).refine((coins) => coins.length > 0, "Name at least one coin."),
  channels: queryList(3, z.enum(["mids", "trades", "book"])).optional(),
});

export function registerMarketStream(router: Router, ctx: AppContext, services: LedgerServices): void {
  router.get("/markets/stream", async (req, res) => {
    const query = parseQuery(req, StreamQuery);
    const network = query.network ?? hyperCoreKeyFor(ctx.config.mode);
    const channels = new Set<MarketStreamChannel>(query.channels && query.channels.length > 0 ? query.channels : CHANNELS);
    // Unknown coins fail with 404 before any SSE header is written.
    const markets = await Promise.all(query.coins.map((coin) => services.catalog.resolve(network, coin)));
    const coins = [...new Set(markets.map((market) => market.coin))];

    const ws = ctx.hyperliquid.ws(network);
    const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
    if (stream.closed) return;
    const coalescer = new StreamCoalescer(() => ctx.clock.now());
    const sink = { get closed() { return stream.closed; }, send: (event: string, data: unknown) => stream.send(event, data, undefined, { droppable: true }) };
    const offs: Array<() => void> = [];
    const fail = (coin: string | null, channel: MarketStreamChannel | null, error: unknown) => {
      const code = isElyiaHttpError(error) ? error.code : "STREAM_SUBSCRIBE_FAILED";
      const message = isElyiaHttpError(error) ? error.message : "This feed could not be opened.";
      stream.send(MARKET_STREAM_EVENTS.error, { coin, channel, code, message });
    };
    const subscribe = (coin: string | null, channel: MarketStreamChannel, open: () => () => void) => {
      try {
        offs.push(open());
      } catch (error) {
        fail(coin, channel, error);
      }
    };

    const midCoins = new Set(coins.filter((coin) => perpDexOf(coin) === ""));
    const bookMidCoins = new Set(coins.filter((coin) => perpDexOf(coin) !== ""));
    if (channels.has("mids") && midCoins.size > 0) {
      subscribe(null, "mids", () => ws.subscribe({ type: "allMids" }, (data) => coalescer.pushMids(data.mids, midCoins)));
    }
    for (const coin of coins) {
      const wantsBook = channels.has("book");
      const deriveMid = channels.has("mids") && bookMidCoins.has(coin);
      if (wantsBook || deriveMid) {
        subscribe(coin, wantsBook ? "book" : "mids", () =>
          ws.subscribe({ type: "l2Book", coin }, (book) => {
            if (wantsBook) {
              coalescer.pushBook({ coin, time: book.time, bids: levelsView(book.levels[0], MAX_BOOK_DEPTH), asks: levelsView(book.levels[1], MAX_BOOK_DEPTH) });
            }
            const mid = deriveMid ? summarizeBook(book, 1).mid : null;
            if (mid !== null) coalescer.pushMids({ [coin]: String(mid) }, new Set([coin]));
          }),
        );
      }
      if (channels.has("trades")) {
        subscribe(coin, "trades", () => ws.subscribe({ type: "trades", coin }, (prints) => coalescer.pushTrades(coin, prints.map(tradeView))));
      }
    }

    const ready: MarketStreamReady = { network, coins, channels: CHANNELS.filter((channel) => channels.has(channel)), maxCoins: MAX_STREAM_COINS };
    stream.send(MARKET_STREAM_EVENTS.ready, ready);
    const timer = setInterval(() => coalescer.flush(sink), STREAM_FLUSH_MS);
    timer.unref();
    stream.onClose(() => {
      clearInterval(timer);
      for (const off of offs.splice(0)) off();
    });
  });
}
