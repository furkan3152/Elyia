import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FrontendOpenOrder } from "@elyia/core/hypercore/info";

import { accountSummaryFrom, positionsFrom } from "../accountModel";
import {
  accountTopo,
  avalancheBulletin,
  depthBook,
  fundingWindsock,
  groupLevels,
  leverageGrade,
  mergeCandle,
  realizedVolatility,
  riskBand,
  ropeLayout,
  ropesFrom,
  shockRopes,
  volatilityWeather,
  weatherKind,
  windsockStripes,
} from "../topo";

const close = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

function trigger(coin: string, oid: number, orderType: string, triggerPx: string, extra: Partial<FrontendOpenOrder> = {}): FrontendOpenOrder {
  return {
    coin,
    side: "A",
    limitPx: triggerPx,
    sz: "0.0",
    oid,
    timestamp: oid,
    origSz: "0.0",
    triggerCondition: "",
    isTrigger: true,
    triggerPx,
    children: [],
    isPositionTpsl: true,
    reduceOnly: true,
    orderType,
    tif: null,
    cloid: null,
    ...extra,
  };
}

// A cross account with an ETH long and a BTC short (shapes as the clearinghouseState feed sends them).
const STATE = {
  dex: "",
  user: "0x1bf4a05d525549b26c9b0529e49c96c43b100bbc",
  clearinghouseState: {
    marginSummary: { accountValue: "1000.0", totalNtlPos: "5600.0", totalRawUsd: "0", totalMarginUsed: "560.0" },
    crossMarginSummary: { accountValue: "1000.0", totalNtlPos: "5600.0", totalRawUsd: "0", totalMarginUsed: "560.0" },
    crossMaintenanceMarginUsed: "250.0",
    withdrawable: "440.0",
    assetPositions: [
      { type: "oneWay", position: { coin: "ETH", szi: "2.0", leverage: { type: "cross", value: 10 }, entryPx: "2300.0", positionValue: "4700.0", unrealizedPnl: "100.0", returnOnEquity: "0.217", liquidationPx: "2000.0", marginUsed: "470.0", maxLeverage: 25, cumFunding: { allTime: "0", sinceOpen: "1.2", sinceChange: "0" } } },
      { type: "oneWay", position: { coin: "BTC", szi: "-0.01", leverage: { type: "isolated", value: 25 }, entryPx: "88000.0", positionValue: "900.0", unrealizedPnl: "-20.0", returnOnEquity: "-0.56", liquidationPx: "92000.0", marginUsed: "90.0", maxLeverage: 40, cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" } } },
    ],
    time: 1,
  },
};

const ORDERS: FrontendOpenOrder[] = [
  trigger("ETH", 11, "Take Profit Market", "2600"),
  trigger("ETH", 12, "Stop Market", "2100"),
  // A farther ETH TP and a non-reduce-only trigger are ignored.
  trigger("ETH", 13, "Take Profit Limit", "2900"),
  trigger("ETH", 14, "Stop Market", "2200", { reduceOnly: false }),
  trigger("BTC", 21, "Stop Market", "91000", { side: "B" }),
];

describe("TOPO ropes", () => {
  const positions = positionsFrom(STATE);

  it("reads liquidation from the API, TP/SL from open triggers, mark from the mids", () => {
    const ropes = ropesFrom(positions, ORDERS, (coin) => (coin === "ETH" ? 2350 : null));
    const eth = ropes.find((rope) => rope.coin === "ETH")!;
    assert.equal(eth.side, "long");
    assert.equal(eth.markPx, 2350, "live mid wins");
    assert.equal(eth.liquidationPx, 2000);
    assert.equal(eth.tp?.px, 2600);
    assert.equal(eth.tp?.oid, 11);
    assert.equal(eth.sl?.px, 2100);
    assert.ok(close(eth.distance!, 350 / 2350));
    assert.equal(eth.band, "watch");
    assert.equal(eth.grade, "T4");
    assert.ok(close(eth.toStop!, 250 / 2350));
    assert.ok(close(eth.toTarget!, 250 / 2350));
    const btc = ropes.find((rope) => rope.coin === "BTC")!;
    assert.equal(btc.side, "short");
    assert.equal(btc.markPx, 90_000, "falls back to value / size");
    assert.ok(close(btc.distance!, 2000 / 90_000));
    assert.equal(btc.band, "critical");
    assert.equal(btc.grade, "T6");
    assert.equal(btc.tp, null);
    assert.equal(btc.sl?.px, 91_000);
    assert.ok(close(btc.toStop!, 1000 / 90_000), "a short's stop is above the mark");
    assert.equal(btc.stopBeyondLiquidation, false);
    // Seen live on testnet: a long's stop below its liquidation price never fires first.
    const useless = ropesFrom(positions, [trigger("ETH", 31, "Stop Market", "1900")], () => 2350).find((rope) => rope.coin === "ETH")!;
    assert.equal(useless.stopBeyondLiquidation, true);
  });

  it("lays every rope out crevasse-left, flag-right, for longs and shorts", () => {
    const long = ropeLayout({ side: "long", entryPx: 2300, markPx: 2350, liquidationPx: 2000, tp: { px: 2600, oid: 1, wholePosition: true }, sl: { px: 2100, oid: 2, wholePosition: true } });
    assert.equal(long.crevasse, 0);
    assert.equal(long.flag, 1);
    assert.ok(close(long.anchor!, 100 / 600));
    assert.ok(close(long.entry, 300 / 600));
    assert.ok(close(long.climber, 350 / 600));
    const short = ropeLayout({ side: "short", entryPx: 2300, markPx: 2250, liquidationPx: 2600, tp: { px: 2000, oid: 1, wholePosition: true }, sl: { px: 2500, oid: 2, wholePosition: true } });
    assert.equal(short.crevasse, 0);
    assert.equal(short.flag, 1);
    assert.ok(close(short.anchor!, 100 / 600));
    assert.ok(close(short.climber, 350 / 600));
    assert.equal(short.from, 2600);
    assert.equal(short.to, 2000);
    // No liquidation price and no TP: the open ends get padding, absent levels are null.
    const open = ropeLayout({ side: "long", entryPx: 100, markPx: 110, liquidationPx: null, tp: null, sl: null });
    assert.equal(open.crevasse, null);
    assert.equal(open.flag, null);
    assert.ok(open.entry > 0 && open.climber < 1 && open.climber > open.entry);
  });

  it("bands distances and grades leverage", () => {
    assert.deepEqual([0.03, 0.07, 0.2, 0.4, null].map(riskBand), ["critical", "danger", "watch", "safe", "unknown"]);
    assert.deepEqual([1, 3, 10, 15, 40].map(leverageGrade), ["T2", "T3", "T4", "T5", "T6"]);
  });

  it("shocks the ropes and says which snap", () => {
    const ropes = ropesFrom(positions, ORDERS, (coin) => (coin === "ETH" ? 2350 : null));
    const down = shockRopes(ropes, -0.2);
    const eth = down.find((rope) => rope.coin === "ETH")!;
    assert.equal(eth.snaps, true, "2350 -20% = 1880, below the 2000 liquidation");
    assert.ok(close(eth.pnlChange, 2 * (1880 - 2350)));
    const btc = down.find((rope) => rope.coin === "BTC")!;
    assert.equal(btc.snaps, false, "a short gains when the price falls");
    assert.ok(btc.distance! > ropes.find((rope) => rope.coin === "BTC")!.distance!);
    const perCoin = shockRopes(ropes, { BTC: 0.03 });
    assert.equal(perCoin.find((rope) => rope.coin === "BTC")?.snaps, true, "90,000 +3% = 92,700, above 92,000");
    assert.equal(perCoin.find((rope) => rope.coin === "ETH")?.markPx, 2350, "coins not in the map do not move");
  });
});

describe("TOPO account summary and avalanche bulletin", () => {
  it("sums equity, exposure and leverage, and finds the nearest rope", () => {
    const summary = accountSummaryFrom(STATE);
    const account = accountTopo(summary, positionsFrom(STATE), [{ coin: "USDC", token: 0, total: "250.5", hold: "0", entryNtl: "0" }])!;
    assert.equal(account.equity, 1250.5);
    assert.equal(account.perpValue, 1000);
    assert.equal(account.longNotional, 4700);
    assert.equal(account.shortNotional, 900);
    assert.equal(account.netExposure, 3800);
    assert.ok(close(account.leverage!, 5.6));
    assert.equal(account.marginRatio, 0.25);
    assert.equal(account.unrealizedPnl, 80);
    assert.equal(account.nearest?.coin, "BTC");
    const bulletin = avalancheBulletin(account);
    assert.equal(bulletin.level, 5, "BTC is 2.2% from liquidation");
    assert.match(bulletin.driver, /BTC/u);
  });

  it("rates calm, crowded and over-levered accounts", () => {
    const base = { equity: 0, perpValue: 1000, spotUsdc: 0, withdrawable: 0, marginUsed: 0, maintenance: 0, unrealizedPnl: 0, longNotional: 0, shortNotional: 0, netExposure: 0, positions: 1 };
    assert.equal(avalancheBulletin(null).level, 1);
    assert.equal(avalancheBulletin({ ...base, positions: 0, marginRatio: null, leverage: null, nearest: null }).label, "low");
    assert.equal(avalancheBulletin({ ...base, marginRatio: 0.1, leverage: 2, nearest: { coin: "ETH", distance: 0.5 } }).level, 1);
    assert.equal(avalancheBulletin({ ...base, marginRatio: 0.45, leverage: 3, nearest: { coin: "ETH", distance: 0.5 } }).level, 3, "margin ratio drives");
    assert.equal(avalancheBulletin({ ...base, marginRatio: 0.1, leverage: 12, nearest: { coin: "ETH", distance: 0.15 } }).level, 4, "10x+ account leverage lifts one level");
  });
});

describe("TOPO windsock", () => {
  it("reads funding direction, strength and the countdown to the hour", () => {
    const now = Date.UTC(2026, 9, 29, 14, 18, 48);
    const sock = fundingWindsock(0.0000125, now)!;
    assert.equal(sock.payer, "longs");
    assert.equal(sock.receiver, "shorts");
    assert.ok(close(sock.apr, 0.1095));
    assert.equal(sock.stripes, 1);
    assert.equal(sock.countdown, "41:12");
    assert.equal(sock.nextAt, Date.UTC(2026, 9, 29, 15, 0, 0));
    const negative = fundingWindsock(-0.0001, now)!;
    assert.equal(negative.payer, "shorts");
    assert.equal(negative.stripes, 4);
    assert.equal(fundingWindsock(0, now)?.payer, "none");
    assert.equal(fundingWindsock(null, now), null, "spot has no funding");
    assert.deepEqual([0, 0.02, 0.2, 0.3, 0.6, 2].map(windsockStripes), [0, 1, 2, 3, 4, 5]);
  });
});

describe("TOPO weather", () => {
  const HOUR = 3_600_000;
  // Deterministic noise.
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const series = (calm: number, last: number, count = 30 * 24): { t: number; c: string }[] => {
    let px = 100;
    return Array.from({ length: count }, (_, index) => {
      const scale = index >= count - 24 ? last : calm;
      px *= Math.exp(noise() * scale);
      return { t: index * HOUR, c: px.toFixed(6) };
    });
  };

  it("annualises realised volatility from log returns", () => {
    // Alternating +1% / -1% hourly: stdev of log returns ~ 0.01 x sqrt(n/(n-1)).
    const closes = [100];
    for (let index = 0; index < 48; index += 1) closes.push(closes[closes.length - 1]! * (index % 2 === 0 ? 1.01 : 1 / 1.01));
    const vol = realizedVolatility(closes, HOUR)!;
    const expected = Math.log(1.01) * Math.sqrt(48 / 47) * Math.sqrt(24 * 365);
    assert.ok(close(vol, expected, 1e-9));
    assert.equal(realizedVolatility([100, 101], HOUR), null);
  });

  it("ranks the latest day against the month: storm after a quiet month, clear after a wild one", () => {
    const storm = volatilityWeather(series(0.004, 0.04), HOUR)!;
    assert.equal(storm.kind, "storm");
    assert.equal(storm.percentile, 1);
    const clear = volatilityWeather(series(0.03, 0.002), HOUR)!;
    assert.equal(clear.kind, "clear");
    assert.ok(clear.percentile < 0.1);
    assert.ok(clear.samples > 100);
    assert.equal(volatilityWeather(series(0.01, 0.01, 40), HOUR), null, "too little history");
    assert.deepEqual([0.1, 0.5, 0.8, 0.95].map(weatherKind), ["clear", "few-clouds", "overcast", "storm"]);
  });

  it("folds the live candle into the snapshot", () => {
    const base = [{ t: 0, c: "1" }, { t: HOUR, c: "2" }];
    assert.deepEqual(mergeCandle(base, { t: HOUR, c: "3" }).map((candle) => candle.c), ["1", "3"]);
    assert.deepEqual(mergeCandle(base, { t: 2 * HOUR, c: "4" }).map((candle) => candle.c), ["1", "2", "4"]);
    assert.deepEqual(mergeCandle(base, { t: 0, c: "9" }).map((candle) => candle.c), ["1", "2"], "an older candle is ignored");
  });
});

describe("TOPO book depth", () => {
  const bids = [
    { px: "100.07", sz: "1", n: 1 },
    { px: "100.03", sz: "2", n: 2 },
    { px: "99.98", sz: "3", n: 1 },
    { px: "99.9", sz: "4", n: 1 },
  ];
  const asks = [
    { px: "100.12", sz: "0.5", n: 1 },
    { px: "100.18", sz: "1.5", n: 1 },
    { px: "100.21", sz: "2", n: 3 },
  ];

  it("groups bids down and asks up, never better than the real level", () => {
    assert.deepEqual(groupLevels(bids, 0.1, "bid", 10), [
      { px: 100, sz: 3, n: 3 },
      { px: 99.9, sz: 7, n: 2 },
    ]);
    assert.deepEqual(groupLevels(asks, 0.1, "ask", 10), [
      { px: 100.2, sz: 2, n: 2 },
      { px: 100.3, sz: 2, n: 3 },
    ]);
    // A level already on the bucket edge stays there despite float noise (99.9 / 0.1 = 998.9999…).
    assert.equal(groupLevels([{ px: "99.9", sz: "1", n: 1 }], 0.1, "ask", 1)[0]?.px, 99.9);
    assert.equal(groupLevels(bids, 0.1, "bid", 1).length, 1);
  });

  it("adds cumulative depth on one scale, spread and imbalance", () => {
    const depth = depthBook(bids, asks, 0.1, 10);
    assert.equal(depth.bids[1]?.cumSz, 10);
    assert.ok(close(depth.bids[0]!.cumNtl, 300));
    assert.equal(depth.bids[1]?.depth, 1, "the deeper side fills the bar");
    assert.equal(depth.asks[1]?.depth, 0.4);
    assert.equal(depth.bestBid, 100.07);
    assert.equal(depth.bestAsk, 100.12);
    assert.ok(close(depth.spread!, 0.05, 1e-9));
    assert.ok(close(depth.spreadBps!, (0.05 / 100.095) * 10_000, 1e-6));
    assert.ok(close(depth.imbalance!, 10 / 14));
    assert.equal(depthBook([], [], 1).imbalance, null);
  });
});
