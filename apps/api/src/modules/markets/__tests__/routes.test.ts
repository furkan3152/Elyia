import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { BookResponse, CandlesResponse, FundingResponse, MarketDetailResponse, MarketsResponse, PricesResponse, TradesResponse, VaultsResponse, WhalesResponse } from "@elyia/core/api/markets";
import type { PerpMeta, RecentTrade } from "@elyia/core/hypercore/info";
import { createApp } from "../../../app.js";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import { json, readSse, routedFetch, serve, testConfig, waitFor, type Served } from "../../../__tests__/support.js";
import { statsDataUrl } from "../statsData.js";
import { closeLedgerServices } from "../services.js";
import { fakeChains, fixture, infoEndpoint, mainnetReferenceAnswers, MAINNET_INFO, socketFactory, testnetMarketAnswers, TESTNET_INFO, type InfoBody } from "./fakes.js";

describe("markets routes (recorded testnet answers behind a fake HyperCore)", () => {
  let ctx: AppContext;
  let served: Served;
  const testnetCalls: InfoBody[] = [];
  const sockets = socketFactory();

  before(async () => {
    const allPerpMetas = fixture<PerpMeta[]>("testnet-all-perp-metas.json");
    const answers = testnetMarketAnswers();
    const routes = {
      [TESTNET_INFO]: infoEndpoint(
        {
          ...answers,
          meta: (body: InfoBody) => (typeof body.dex === "string" && body.dex ? allPerpMetas[["", "test", "unit", "scam"].indexOf(body.dex)] : (answers.meta as unknown)),
          metaAndAssetCtxs: (body: InfoBody) => (typeof body.dex === "string" && body.dex ? [allPerpMetas[["", "test", "unit", "scam"].indexOf(body.dex)], []] : answers.metaAndAssetCtxs),
          clearinghouseState: fixture("testnet-clearinghouse-cross.json"),
        },
        testnetCalls,
      ),
      [MAINNET_INFO]: infoEndpoint(mainnetReferenceAnswers()),
      [statsDataUrl("testnet", "vaults")]: () => json(fixture("testnet-vaults-dump.json")),
      [statsDataUrl("testnet", "leaderboard")]: () => json(fixture("testnet-leaderboard.json")),
    };
    const base = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_RATE_LIMIT_HEAVY: "10000" }), { fetch: routedFetch(routes), createSocket: sockets.create });
    ctx = { ...base, chains: fakeChains({}) };
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    closeLedgerServices(ctx);
    await closeContext(ctx);
  });

  async function get<T>(path: string): Promise<{ status: number; body: T; headers: Headers }> {
    const response = await fetch(`${served.url}${path}`);
    return { status: response.status, body: (await response.json()) as T, headers: response.headers };
  }

  it("GET /v1/markets lists perps and spot sorted by USD volume, with the HIP-3 directory", async () => {
    const { status, body, headers } = await get<MarketsResponse>("/v1/markets");
    assert.equal(status, 200);
    assert.equal(body.network, "hypercore-testnet");
    assert.equal(body.type, "all");
    assert.ok(body.markets.some((row) => row.coin === "BTC" && row.assetId === 3));
    assert.ok(body.markets.some((row) => row.coin === "@1035" && row.displayName === "HYPE/USDC"));
    const volumes = body.markets.map((row) => row.volume24hUsd ?? -1);
    assert.deepEqual(volumes, [...volumes].sort((a, b) => b - a));
    assert.deepEqual(body.dexes.map((dex) => dex.name), ["test", "unit", "scam"]);
    assert.match(body.notes.join(" "), /test USDC/u);
    assert.match(headers.get("cache-control") ?? "", /public/u);
  });

  it("filters by type, query and HIP-3 dex; refuses dex with spot", async () => {
    const perps = await get<MarketsResponse>("/v1/markets?type=perp&q=bt&limit=5");
    assert.deepEqual(perps.body.markets.map((row) => row.coin), ["BTC"]);
    const hip3 = await get<MarketsResponse>("/v1/markets?dex=unit");
    assert.ok(hip3.body.markets.length > 0 && hip3.body.markets.every((row) => row.dex === "unit" && row.assetId >= 120_000 && row.assetId < 130_000));
    assert.ok(hip3.body.markets.every((row) => row.markPx === null), "no contexts recorded for this dex: unknown, not zero");
    const bad = await get<{ error: { code: string } }>("/v1/markets?type=spot&dex=unit");
    assert.equal(bad.status, 400);
    const unknownDex = await get<{ error: { code: string } }>("/v1/markets?dex=nope");
    assert.equal(unknownDex.body.error.code, "DEX_NOT_FOUND");
    const badNetwork = await get<{ error: { code: string; details: { issues: Array<{ path: string }> } } }>("/v1/markets?network=solana");
    assert.equal(badNetwork.status, 400);
    assert.equal(badNetwork.body.error.details.issues[0]?.path, "query.network");
  });

  it("GET /v1/markets/:coin answers perps with margin tiers and spot pairs by display name", async () => {
    const btc = await get<MarketDetailResponse>("/v1/markets/BTC");
    assert.equal(btc.status, 200);
    assert.equal(btc.body.marginTiers?.length, 3);
    const hype = await get<MarketDetailResponse>(`/v1/markets/${encodeURIComponent("HYPE/USDC")}`);
    assert.equal(hype.body.market.coin, "@1035");
    assert.equal(hype.body.spot?.base.name, "HYPE");
    assert.equal(hype.body.spot?.base.index, 1105);
    const missing = await get<{ error: { code: string } }>("/v1/markets/NOPE");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "MARKET_NOT_FOUND");
    const unknownDex = await get<{ error: { code: string } }>(`/v1/markets/${encodeURIComponent("zzz:ABC")}`);
    assert.equal(unknownDex.body.error.code, "MARKET_NOT_FOUND");
  });

  it("GET /v1/markets/:coin/book passes aggregation through and validates it", async () => {
    const plain = await get<BookResponse>("/v1/markets/BTC/book?depth=2");
    assert.equal(plain.status, 200);
    assert.equal(plain.body.source, "info");
    assert.equal(plain.body.bids.length, 2);
    assert.ok((plain.body.spreadBps ?? -1) >= 0);
    const before = testnetCalls.length;
    await get<BookResponse>("/v1/markets/BTC/book?nSigFigs=3");
    assert.deepEqual(testnetCalls.slice(before).find((call) => call.type === "l2Book"), { type: "l2Book", coin: "BTC", nSigFigs: 3 });
    const bad = await get<{ error: { code: string } }>("/v1/markets/BTC/book?mantissa=2");
    assert.equal(bad.status, 400);
  });

  it("GET /v1/markets/:coin/trades serves the WebSocket tape seeded once from REST", async () => {
    const first = await get<TradesResponse>("/v1/markets/BTC/trades?limit=3");
    assert.equal(first.body.source, "tape");
    assert.equal(first.body.trades.length, 3);
    await waitFor(() => sockets.sockets.some((socket) => socket.subscriptions().some((sub) => (sub as { type?: string }).type === "trades")));
    const socket = sockets.sockets.find((candidate) => candidate.url.includes("testnet")) ?? sockets.sockets[0];
    const recorded = fixture<RecentTrade[]>("testnet-trades-btc.json");
    socket?.message("trades", [{ ...(recorded[0] as RecentTrade), tid: 42, time: (recorded[0]?.time ?? 0) + 60_000 }]);
    const second = await get<TradesResponse>("/v1/markets/BTC/trades?limit=2");
    assert.equal(second.body.trades[0]?.tid, 42);
    assert.equal(testnetCalls.filter((call) => call.type === "recentTrades").length, 1, "one REST seed");
  });

  it("GET /v1/markets/:coin/candles plans an aligned, capped range", async () => {
    const { status, body } = await get<CandlesResponse>("/v1/markets/BTC/candles?interval=1h&limit=5");
    assert.equal(status, 200);
    assert.equal(body.interval, "1h");
    assert.equal(body.from % 3_600_000, 0);
    const call = [...testnetCalls].reverse().find((entry) => entry.type === "candleSnapshot") as { req?: { endTime?: number } } | undefined;
    assert.equal(call?.req?.endTime, undefined, "an open range omits endTime");
    const bad = await get<{ error: { code: string } }>("/v1/markets/BTC/candles?from=10&to=5");
    assert.equal(bad.status, 400);
    const badInterval = await get<{ error: { code: string } }>("/v1/markets/BTC/candles?interval=7m");
    assert.equal(badInterval.status, 400);
  });

  it("GET /v1/funding normalizes venues to hourly and lists outliers", async () => {
    const { status, body } = await get<FundingResponse>("/v1/funding");
    assert.equal(status, 200);
    const btc = body.rows.find((row) => row.coin === "BTC");
    assert.ok(btc?.venues.some((venue) => venue.venue === "binance" && venue.intervalHours === 8));
    assert.ok(body.outliers.highestApr.length > 0);
    const subset = await get<FundingResponse>("/v1/funding?coins=BTC,ETH");
    assert.deepEqual(subset.body.rows.map((row) => row.coin).sort(), ["BTC", "ETH"]);
  });

  it("GET /v1/prices answers reference prices from mainnet and lists unknown symbols", async () => {
    const { body } = await get<PricesResponse>("/v1/prices?symbols=HYPE,BTC,USDC,NOTATOKEN");
    assert.equal(body.source, "hypercore-mainnet-reference");
    assert.equal(body.label, "reference price");
    assert.deepEqual(body.prices.map((price) => price.symbol), ["HYPE", "BTC", "USDC"]);
    assert.deepEqual(body.unknown, ["NOTATOKEN"]);
    const defaults = await get<PricesResponse>("/v1/prices");
    assert.ok(defaults.body.prices.some((price) => price.symbol === "kHYPE" && price.basis === "lst-rate"), "kHYPE through the (fake) StakingAccountant rate");
  });

  it("GET /v1/vaults lists vaults by TVL from the stats dump", async () => {
    const open = await get<VaultsResponse>("/v1/vaults?limit=2");
    assert.equal(open.body.vaults[0]?.name, "Hyperliquidity Provider (HLP)");
    assert.equal(open.body.count, 2);
    const all = await get<VaultsResponse>("/v1/vaults?includeClosed=true&limit=50");
    assert.ok(all.body.vaults.some((vault) => vault.isClosed));
    assert.ok(!open.body.vaults.some((vault) => vault.isClosed));
  });

  it("GET /v1/whales maps liquidations of the sampled accounts; HIP-3 coins are refused", async () => {
    const { status, body } = await get<WhalesResponse>("/v1/whales?coin=SOL&bucketPct=2");
    assert.equal(status, 200);
    assert.equal(body.sampledAccounts, 6);
    assert.equal(body.accountsWithPosition, 6, "every fake account holds the recorded SOL short");
    assert.ok(body.shortLiquidations.length > 0);
    assert.equal(body.bucketPct, 2);
    const hip3 = await get<{ error: { code: string } }>(`/v1/whales?coin=${encodeURIComponent("xyz:TSLA")}`);
    assert.equal(hip3.status, 400);
    const missingCoin = await get<{ error: { code: string } }>("/v1/whales");
    assert.equal(missingCoin.status, 400);
  });

  it("GET /v1/markets/stream fans out the shared WebSocket as SSE", async () => {
    const reading = readSse(`${served.url}/v1/markets/stream?coins=ETH&channels=book,trades`, (messages) => messages.some((message) => message.event === "book"), { timeoutMs: 3_000 });
    await waitFor(() => sockets.sockets.some((socket) => socket.subscriptions().some((sub) => (sub as { type?: string; coin?: string }).type === "l2Book" && (sub as { coin?: string }).coin === "ETH")));
    const socket = sockets.sockets.find((candidate) => candidate.subscriptions().some((sub) => (sub as { coin?: string }).coin === "ETH"));
    socket?.message("l2Book", { coin: "ETH", time: 5, levels: [[{ px: "2350.0", sz: "1.0", n: 1 }], [{ px: "2351.0", sz: "2.0", n: 2 }]] });
    const { status, messages } = await reading;
    assert.equal(status, 200);
    assert.equal(messages[0]?.event, "ready");
    assert.deepEqual(JSON.parse(messages[0]?.data ?? "{}").coins, ["ETH"]);
    const book = messages.find((message) => message.event === "book");
    assert.deepEqual(JSON.parse(book?.data ?? "{}"), { coin: "ETH", time: 5, bids: [{ px: "2350.0", sz: "1.0", n: 1, cumSz: 1 }], asks: [{ px: "2351.0", sz: "2.0", n: 2, cumSz: 2 }] });
    const unknown = await fetch(`${served.url}/v1/markets/stream?coins=NOPE`);
    assert.equal(unknown.status, 404, "unknown coins fail before any SSE header");
    const tooMany = await fetch(`${served.url}/v1/markets/stream?coins=A,B,C,D,E,F,G,H,I`);
    assert.equal(tooMany.status, 400);
    await unknown.body?.cancel();
    await tooMany.body?.cancel();
  });
});
