/**
 * Markets REST routes (paths relative to /v1):
 *
 *   GET /markets?network=&type=perp|spot|all&dex=&q=&limit=   rows sorted by 24 h USD volume
 *   GET /markets/:coin                                         one row + margin tiers or spot tokens
 *   GET /markets/:coin/book?nSigFigs=&mantissa=&depth=         L2 book (live feed when warm)
 *   GET /markets/:coin/trades?limit=                           recent prints (server tape)
 *   GET /markets/:coin/candles?interval=&from=&to=&limit=      candleSnapshot, aligned and capped
 *   GET /funding?network=&coins=                               current + predicted funding, hourly and APR
 *   GET /prices?symbols=                                       reference USD prices (HyperCore mainnet)
 *   GET /vaults?network=&limit=&includeClosed=                 vaults by TVL (stats dump)
 *   GET /whales?network=&coin=&bucketPct=&minNotionalUsd=      liquidation map of top accounts
 *
 * Coins in paths are URL-encoded (`PURR%2FUSDC`); spot pairs also resolve by
 * display name (`HYPE%2FUSDC`).
 */
import type {
  BookResponse,
  CandleIntervalParam,
  CandlesResponse,
  FundingResponse,
  MarketDetailResponse,
  MarketRow,
  MarketsResponse,
  PerpDexSummary,
  PricesResponse,
  ReferencePrice,
  TradesResponse,
  VaultsResponse,
  WhalesResponse,
} from "@elyia/core/api/markets";
import type { Candle } from "@elyia/core/hypercore/info";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError, invalidRequest } from "../../http/errors.js";
import { cachePublicly } from "../../http/request.js";
import { parseParams, parseQuery, queryBoolean, queryInteger, queryList, queryString } from "../../http/validate.js";
import { MAX_BOOK_DEPTH, summarizeBook } from "./book.js";
import { candleView, CANDLE_INTERVALS, MAX_CANDLES, planCandles } from "./candles.js";
import { marginTiersFor, matchesQuery, perpDexOf, sortByVolume, spotTokenView } from "./catalog.js";
import { buildFundingRows, fundingOutliers, fundingStats } from "./funding.js";
import { CoinParams, coinParam, dexName, hyperCoreKeyFor, hyperCoreNetworkParam } from "./query.js";
import { priceSymbol, REFERENCE_SOURCE } from "./reference.js";
import type { LedgerServices } from "./services.js";
import { liquidationMap } from "./whales.js";

export const DEFAULT_MARKETS_LIMIT = 300;
export const DEFAULT_PRICE_SYMBOLS = ["HYPE", "BTC", "ETH", "SOL", "PURR", "kHYPE", "KNTQ", "UBTC", "UETH", "USDC", "USDT0", "USDH"] as const;
const TESTNET_NOTE = "Testnet volumes, open interest and PnL are in test USDC: real on the venue, worth nothing.";

const MarketsQuery = z.object({
  network: hyperCoreNetworkParam.optional(),
  type: z.enum(["perp", "spot", "all"]).optional(),
  dex: z.union([z.literal("all"), dexName]).optional(),
  q: queryString(64).optional(),
  limit: queryInteger(1, 2_000).optional(),
});
const NetworkQuery = z.object({ network: hyperCoreNetworkParam.optional() });
const BookQuery = NetworkQuery.extend({
  nSigFigs: z.enum(["2", "3", "4", "5"]).transform((value) => Number(value) as 2 | 3 | 4 | 5).optional(),
  mantissa: z.enum(["1", "2", "5"]).transform((value) => Number(value) as 1 | 2 | 5).optional(),
  depth: queryInteger(1, MAX_BOOK_DEPTH).optional(),
});
const TradesQuery = NetworkQuery.extend({ limit: queryInteger(1, 200).optional() });
const CandlesQuery = NetworkQuery.extend({
  interval: z.enum(CANDLE_INTERVALS as [CandleIntervalParam, ...CandleIntervalParam[]]).optional(),
  from: queryInteger(0, 8_640_000_000_000).optional(),
  to: queryInteger(0, 8_640_000_000_000).optional(),
  limit: queryInteger(1, MAX_CANDLES).optional(),
});
const FundingQuery = NetworkQuery.extend({ coins: queryList(50, coinParam).optional() });
const PricesQuery = z.object({ symbols: queryList(50, z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9₮._-]+$/u, "Expected a token or coin symbol.")).optional() });
const VaultsQuery = NetworkQuery.extend({ limit: queryInteger(1, 500).optional(), includeClosed: queryBoolean.optional() });
const WhalesQuery = NetworkQuery.extend({
  coin: coinParam,
  bucketPct: z
    .string()
    .regex(/^\d{1,2}(?:\.\d{1,2})?$/u, "Expected a percent such as 1 or 0.5.")
    .transform(Number)
    .refine((value) => value >= 0.25 && value <= 20, "Expected 0.25 to 20.")
    .optional(),
  minNotionalUsd: queryInteger(0, 1_000_000_000_000).optional(),
  limit: queryInteger(1, 100).optional(),
});

function environmentOf(network: string): "testnet" | "mainnet" {
  return network === "hypercore-mainnet" ? "mainnet" : "testnet";
}

export function registerMarketRoutes(router: Router, ctx: AppContext, services: LedgerServices): void {
  const { catalog } = services;
  const networkOr = (value: MarketsResponse["network"] | undefined) => value ?? hyperCoreKeyFor(ctx.config.mode);

  router.get("/markets", ctx.limits.heavy, async (req, res) => {
    const query = parseQuery(req, MarketsQuery);
    const network = networkOr(query.network);
    const type = query.type ?? "all";
    if (type === "spot" && query.dex) throw invalidRequest("dex applies to perp markets; drop it or use type=perp.");
    const notes: string[] = network === "hypercore-testnet" ? [TESTNET_NOTE] : [];
    let dexes: readonly PerpDexSummary[] = [];
    try {
      dexes = (await catalog.directory(network)).dexes;
    } catch {
      notes.push("The HIP-3 dex directory is unavailable right now.");
    }
    const rows: MarketRow[] = [];
    let dexesOmitted = 0;
    if (type !== "spot") {
      if (query.dex === "all") {
        rows.push(...(await catalog.perpRows(network, "")));
        const bulk = await catalog.bulkDexes(network);
        dexesOmitted = bulk.omitted;
        for (const dex of bulk.selected) rows.push(...(await catalog.perpRows(network, dex, true)));
        notes.push(`HIP-3 contexts in dex=all are refreshed every minute${bulk.omitted > 0 ? `; ${bulk.omitted} more dexes are available with dex=<name>` : ""}.`);
      } else {
        rows.push(...(await catalog.perpRows(network, query.dex ?? "")));
      }
    }
    if (type !== "perp" && (query.dex === undefined || query.dex === "all")) rows.push(...(await catalog.spotRows(network)));
    const matching = sortByVolume(query.q ? rows.filter((row) => matchesQuery(row, query.q as string)) : rows);
    const limited = matching.slice(0, query.limit ?? DEFAULT_MARKETS_LIMIT);
    const body: MarketsResponse = {
      network,
      type,
      dex: query.dex ?? null,
      generatedAt: ctx.clock.now(),
      total: matching.length,
      count: limited.length,
      markets: limited,
      dexes,
      dexesOmitted,
      notes,
    };
    cachePublicly(res, 5);
    res.json(body);
  });

  router.get("/markets/:coin", async (req, res) => {
    const { coin } = parseParams(req, CoinParams);
    const network = networkOr(parseQuery(req, NetworkQuery).network);
    const market = await catalog.resolve(network, coin);
    const { row, perpMeta, spotMeta } = await catalog.row(network, market);
    let spot: MarketDetailResponse["spot"] = null;
    if (market.type === "spot" && spotMeta) {
      const pair = spotMeta.universe.find((candidate) => candidate.index === market.pairIndex);
      const base = spotMeta.tokens.find((token) => token.index === pair?.tokens[0]);
      const quote = spotMeta.tokens.find((token) => token.index === pair?.tokens[1]);
      if (base && quote) spot = { base: spotTokenView(base), quote: spotTokenView(quote) };
    }
    const body: MarketDetailResponse = {
      network,
      generatedAt: ctx.clock.now(),
      market: row,
      marginTiers: market.type === "perp" && perpMeta ? marginTiersFor(perpMeta, market.universeIndex) : null,
      spot,
    };
    cachePublicly(res, 5);
    res.json(body);
  });

  router.get("/markets/:coin/book", async (req, res) => {
    const { coin } = parseParams(req, CoinParams);
    const query = parseQuery(req, BookQuery);
    if (query.mantissa !== undefined && query.nSigFigs !== 5) throw invalidRequest("mantissa is only allowed with nSigFigs=5.");
    const network = networkOr(query.network);
    const market = await catalog.resolve(network, coin);
    const aggregated = query.nSigFigs !== undefined;
    const live = aggregated ? null : ctx.hyperliquid.ws(network).last({ type: "l2Book", coin: market.coin });
    const aggregation = query.nSigFigs !== undefined ? { nSigFigs: query.nSigFigs, ...(query.mantissa !== undefined ? { mantissa: query.mantissa } : {}) } : {};
    const book = live ?? (await ctx.hyperliquid.info(network).l2Book(market.coin, aggregation));
    if (!book) throw new ElyiaHttpError("BOOK_UNAVAILABLE", 503, "HyperCore returned no book for this market. Try again shortly.", { coin: market.coin });
    const summary = summarizeBook(book, query.depth ?? MAX_BOOK_DEPTH);
    const body: BookResponse = {
      network,
      coin: market.coin,
      time: book.time,
      nSigFigs: query.nSigFigs ?? null,
      mantissa: query.mantissa ?? null,
      ...summary,
      source: live ? "ws" : "info",
    };
    res.json(body);
  });

  router.get("/markets/:coin/trades", async (req, res) => {
    const { coin } = parseParams(req, CoinParams);
    const query = parseQuery(req, TradesQuery);
    const network = networkOr(query.network);
    const market = await catalog.resolve(network, coin);
    const { trades, source } = await services.tape(network).recent(market.coin, query.limit ?? 50);
    const body: TradesResponse = { network, coin: market.coin, trades, source };
    res.json(body);
  });

  router.get("/markets/:coin/candles", ctx.limits.heavy, async (req, res) => {
    const { coin } = parseParams(req, CoinParams);
    const query = parseQuery(req, CandlesQuery);
    if (query.from !== undefined && query.to !== undefined && query.from >= query.to) throw invalidRequest("from must be before to.");
    const network = networkOr(query.network);
    const market = await catalog.resolve(network, coin);
    const interval = query.interval ?? "1h";
    const plan = planCandles({ interval, from: query.from, to: query.to, limit: query.limit }, ctx.clock.now());
    const candles = await ctx.hyperliquid
      .info(network)
      .request<readonly Candle[]>(
        { type: "candleSnapshot", req: { coin: market.coin, interval, startTime: plan.startTime, ...(plan.endTime !== undefined ? { endTime: plan.endTime } : {}) } },
        plan.closed ? { cacheMs: 5 * 60_000 } : {},
      );
    const body: CandlesResponse = {
      network,
      coin: market.coin,
      interval,
      from: plan.from,
      to: plan.to,
      candles: candles.filter((candle) => candle.t >= plan.from && candle.t <= plan.to).map(candleView),
      truncated: plan.truncated,
    };
    if (plan.closed) cachePublicly(res, 60);
    res.json(body);
  });

  router.get("/funding", ctx.limits.heavy, async (req, res) => {
    const query = parseQuery(req, FundingQuery);
    const network = networkOr(query.network);
    const [perps, predicted] = await Promise.all([
      catalog.perpRows(network, ""),
      catalog.predictedFundings(network),
    ]);
    const wanted = query.coins && query.coins.length > 0 ? new Set(query.coins) : null;
    const rows = buildFundingRows(wanted ? perps.filter((row) => wanted.has(row.coin)) : perps, predicted).sort(
      (a, b) => (b.openInterestUsd ?? -1) - (a.openInterestUsd ?? -1) || a.coin.localeCompare(b.coin),
    );
    const notes = ["Binance and Bybit predictions come from HyperCore's predictedFundings; rates are normalized to one hour, APR is simple (hourly x 8760)."];
    if (network === "hypercore-testnet") notes.push("Testnet HyperCore funding does not track real markets; the Binance and Bybit columns are real venues.");
    const body: FundingResponse = { network, generatedAt: ctx.clock.now(), rows, stats: fundingStats(rows), outliers: fundingOutliers(rows), notes };
    cachePublicly(res, 10);
    res.json(body);
  });

  router.get("/prices", async (req, res) => {
    const query = parseQuery(req, PricesQuery);
    const symbols = query.symbols && query.symbols.length > 0 ? query.symbols : [...DEFAULT_PRICE_SYMBOLS];
    const { value: table } = await services.reference.table();
    const prices: ReferencePrice[] = [];
    const unknown: string[] = [];
    for (const symbol of symbols) {
      const price = priceSymbol(table, symbol);
      if (price) prices.push(price);
      else unknown.push(symbol);
    }
    const body: PricesResponse = { source: REFERENCE_SOURCE, label: "reference price", time: table.time, prices, unknown };
    cachePublicly(res, 2);
    res.json(body);
  });

  router.get("/vaults", ctx.limits.heavy, async (req, res) => {
    const query = parseQuery(req, VaultsQuery);
    const network = networkOr(query.network);
    const { value, fetchedAt } = await services.vaults.list(environmentOf(network));
    const rows = query.includeClosed ? value.rows : value.rows.filter((row) => !row.isClosed);
    const vaults = rows.slice(0, query.limit ?? 50);
    const body: VaultsResponse = { network, fetchedAt, total: value.rows.length, count: vaults.length, vaults, source: "stats-data.hyperliquid.xyz" };
    cachePublicly(res, 60);
    res.json(body);
  });

  router.get("/whales", ctx.limits.heavy, async (req, res) => {
    const query = parseQuery(req, WhalesQuery);
    const network = networkOr(query.network);
    if (perpDexOf(query.coin) !== "") throw invalidRequest("The whale map covers perps of the first dex only (BTC, ETH, HYPE...).");
    const market = await catalog.resolve(network, query.coin);
    if (market.type !== "perp") throw invalidRequest("The whale map covers perp markets only.");
    const [{ row }, sweep] = await Promise.all([catalog.row(network, market), services.whales.latest(network)]);
    const bucketPct = query.bucketPct ?? 1;
    const map = liquidationMap({
      coin: market.coin,
      mark: row.markPx === null ? null : Number(row.markPx),
      positions: sweep.value.positions,
      bucketPct,
      minNotionalUsd: query.minNotionalUsd ?? 0,
      limit: query.limit ?? 25,
    });
    const body: WhalesResponse = {
      network,
      coin: market.coin,
      markPx: row.markPx,
      sweptAt: sweep.value.sweptAt,
      stale: sweep.stale,
      sampledAccounts: sweep.value.accounts,
      ...map,
      bucketPct,
      source: "stats-data leaderboard + clearinghouseState",
    };
    cachePublicly(res, 30);
    res.json(body);
  });
}
