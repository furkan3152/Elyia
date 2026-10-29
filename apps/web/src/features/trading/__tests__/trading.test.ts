import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidPrice, marketPrice, sizeToWire, type MarketInfo } from "@elyia/core/hypercore/wire";
import { actionHash } from "@elyia/core/hypercore/signing";
import { DEFAULT_RULE_BOOK } from "@elyia/core/policy";

import { accountSummaryFrom, fillWindow, guardAccountFacts, openOrdersFrom, positionsFrom, twapsFrom } from "../accountModel";
import { bookSummary, combineEvaluations, effectiveRuleBook, evaluateAction, guardFactsFor, guardLines, type GuardContext } from "../guard";
import { distanceBar, distanceTone, estimateLiquidation, liquidationDistance, liquidationPrice, maintenanceFraction } from "../liquidation";
import { cancelOrders, closePositionOrder, flattenPlan, leverageAction, limitOrder, lotSize, marketOrder, positionTpslOrder, scaleOrder, TicketError, tickPrice, twapOrder } from "../orderBuilders";
import { averagePrice, ladderPrices, scaleDistribution, scaleWeights, splitLots } from "../scale";
import { baseSize, dangerLeverage, feeFor, feeRatesFrom, leverageTicks, maxSizeFor, presetAmount, priceForRoe, roeAt } from "../ticketMath";

const ETH: MarketInfo = { coin: "ETH", displayName: "ETH", asset: 4, szDecimals: 4, isSpot: false, maxLeverage: 25, onlyIsolated: false, isDelisted: false };
const BTC: MarketInfo = { coin: "BTC", displayName: "BTC", asset: 3, szDecimals: 5, isSpot: false, maxLeverage: 40, onlyIsolated: false, isDelisted: false };
const HYPE: MarketInfo = { coin: "HYPE", displayName: "HYPE", asset: 135, szDecimals: 2, isSpot: false, maxLeverage: 10, onlyIsolated: true, isDelisted: false };
const HYPE_SPOT: MarketInfo = { coin: "@1035", displayName: "HYPE/USDC", asset: 11035, szDecimals: 2, isSpot: true, maxLeverage: null, onlyIsolated: false, isDelisted: false };
const KPEPE: MarketInfo = { coin: "kPEPE", displayName: "kPEPE", asset: 77, szDecimals: 0, isSpot: false, maxLeverage: 10, onlyIsolated: false, isDelisted: false };

let counter = 0;
const cloid = () => `0x${(counter += 1).toString(16).padStart(32, "0")}`;

describe("order builders: rounding against core wire rules", () => {
  it("market = IOC at mid ± slippage, rounded toward the mid, valid on the tick", () => {
    const buy = marketOrder({ market: ETH, side: "buy", size: "0.12345", mid: "2317.95", slippageBps: 100, cloid });
    const leg = buy.action.orders[0]!;
    assert.deepEqual(leg.t, { limit: { tif: "Ioc" } });
    assert.equal(leg.s, "0.1234", "size rounds down to szDecimals 4");
    assert.equal(leg.p, marketPrice({ mid: "2317.95", isBuy: true, slippageBps: 100, szDecimals: 4, isSpot: false }));
    assert.equal(leg.p, "2341.1", "2317.95 x 1.01 = 2341.1295 -> 5 sig figs, rounded down for a buy");
    assert.ok(isValidPrice(leg.p, 4, false));
    const sell = marketOrder({ market: BTC, side: "sell", size: 0.001, mid: 80432, slippageBps: 50, cloid });
    assert.equal(sell.action.orders[0]!.p, "80030", "80432 x 0.995 = 80029.84 -> rounded up to the integer tick for a sell");
    assert.equal(sell.action.orders[0]!.b, false);
    // Spot uses 8 - szDecimals decimals.
    const spot = marketOrder({ market: HYPE_SPOT, side: "buy", size: "1.239", mid: "158.875", slippageBps: 100, cloid });
    assert.equal(spot.action.orders[0]!.s, "1.23");
    assert.ok(isValidPrice(spot.action.orders[0]!.p, 2, true));
    // Sub-penny perp (szDecimals 0) keeps 5 significant figures within 6 decimals.
    const pepe = marketOrder({ market: KPEPE, side: "buy", size: "2000", mid: "0.012345", slippageBps: 300, cloid });
    assert.ok(isValidPrice(pepe.action.orders[0]!.p, 0, false));
  });

  it("limit prices round to the tick, never worse for the person", () => {
    assert.equal(tickPrice("2317.987", ETH, "buy"), "2317.9");
    assert.equal(tickPrice("2317.912", ETH, "sell"), "2318");
    assert.equal(tickPrice("80432.7", BTC, "buy"), "80432");
    const gtc = limitOrder({ market: ETH, side: "buy", size: "1", price: "2300.04", tif: "Gtc", cloid });
    assert.deepEqual(gtc.action.orders[0]!.t, { limit: { tif: "Gtc" } });
    assert.equal(gtc.action.orders[0]!.p, "2300");
    const alo = limitOrder({ market: ETH, side: "sell", size: "1", price: "2400", tif: "Alo", reduceOnly: true, cloid });
    assert.equal(alo.action.orders[0]!.r, true);
    assert.equal(gtc.notional, 2300);
    assert.equal(sizeToWire(gtc.action.orders[0]!.s, 4), "1");
  });

  it("refuses dust, sub-$10 orders and empty sizes in plain words", () => {
    assert.throws(() => lotSize("0.00001", ETH), /below one lot/u);
    assert.throws(() => limitOrder({ market: ETH, side: "buy", size: "0.004", price: "2300", tif: "Gtc" }), /at least \$10/u);
    assert.throws(() => marketOrder({ market: ETH, side: "buy", size: "", mid: "2300", slippageBps: 100 }), TicketError);
    // Reduce-only closes may be small.
    assert.doesNotThrow(() => limitOrder({ market: ETH, side: "sell", size: "0.001", price: "2300", tif: "Gtc", reduceOnly: true }));
  });

  it("attaches TP/SL as reduce-only triggers with normalTpsl, on the right side", () => {
    const built = limitOrder({ market: ETH, side: "buy", size: "1", price: "2300", tif: "Gtc", tpsl: { tp: "2400", sl: "2250" }, cloid });
    assert.equal(built.action.grouping, "normalTpsl");
    assert.equal(built.action.orders.length, 3);
    const [entry, tp, sl] = built.action.orders;
    assert.equal(entry!.r, false);
    for (const leg of [tp!, sl!]) {
      assert.equal(leg.r, true, "TP/SL are reduce-only");
      assert.equal(leg.b, false, "they sell a long");
      assert.equal(leg.s, "1");
      assert.ok("trigger" in leg.t);
    }
    assert.deepEqual(Object.keys((tp!.t as { trigger: object }).trigger), ["isMarket", "triggerPx", "tpsl"]);
    assert.equal((tp!.t as { trigger: { triggerPx: string; tpsl: string } }).trigger.tpsl, "tp");
    assert.equal((sl!.t as { trigger: { triggerPx: string } }).trigger.triggerPx, "2250");
    // A market stop sells with up to 10% slippage below the trigger.
    assert.equal(sl!.p, "2025");
    assert.deepEqual(built.legs.map((leg) => leg.role), ["entry", "tp", "sl"]);
    assert.throws(() => limitOrder({ market: ETH, side: "buy", size: "1", price: "2300", tif: "Gtc", tpsl: { tp: "2200" } }), /above/u);
    assert.throws(() => limitOrder({ market: ETH, side: "sell", size: "1", price: "2300", tif: "Gtc", tpsl: { sl: "2200" } }), /above/u);
    // Keys keep the hashed order and the action hashes deterministically.
    assert.deepEqual(Object.keys(entry!), ["a", "b", "p", "s", "r", "t", "c"]);
    assert.equal(actionHash(built.action, null, 1, null), actionHash(JSON.parse(JSON.stringify(built.action)), null, 1, null));
  });

  it("modifies TP/SL of a position with positionTpsl", () => {
    const built = positionTpslOrder({ market: ETH, szi: "-2.5", reference: 2300, tpsl: { tp: "2100", sl: "2450", isMarket: false }, cloid });
    assert.equal(built.action.grouping, "positionTpsl");
    assert.ok(built.action.orders.every((order) => order.b && order.r && order.s === "2.5"));
    assert.throws(() => positionTpslOrder({ market: ETH, szi: "0", reference: 2300, tpsl: { tp: "1" } }), /no position/u);
  });

  it("closes a position (all or part) with a reduce-only IOC on the other side", () => {
    const close = closePositionOrder({ market: ETH, szi: "-2.6801", mid: "2300", slippageBps: 100, cloid });
    const leg = close.action.orders[0]!;
    assert.equal(leg.b, true);
    assert.equal(leg.r, true);
    assert.equal(leg.s, "2.6801");
    assert.deepEqual(leg.t, { limit: { tif: "Ioc" } });
    const half = closePositionOrder({ market: ETH, szi: "2.6801", mid: "2300", slippageBps: 100, fraction: 0.5, cloid });
    assert.equal(half.action.orders[0]!.s, "1.34");
    assert.equal(half.action.orders[0]!.b, false);
  });

  it("flattens: cancel every order, then one batch of reduce-only closes", () => {
    const plan = flattenPlan({
      orders: [{ asset: 4, oid: 11 }, { asset: 3, oid: 12 }],
      positions: [
        { market: ETH, szi: "1.5", mid: "2300" },
        { market: BTC, szi: "-0.01", mid: 80000 },
        { market: HYPE, szi: "3", mid: null },
      ],
      slippageBps: 100,
      cloid,
    });
    assert.deepEqual(plan.cancel, { type: "cancel", cancels: [{ a: 4, o: 11 }, { a: 3, o: 12 }] });
    assert.equal(plan.close?.action.orders.length, 2);
    assert.ok(plan.close?.action.orders.every((order) => order.r));
    assert.deepEqual(plan.skipped, [{ coin: "HYPE", reason: "no live price" }]);
    assert.equal(cancelOrders([]), null);
  });

  it("builds TWAPs within HyperCore's bounds", () => {
    const twap = twapOrder({ market: ETH, side: "buy", size: "0.5", minutes: 30, randomize: true, referencePx: 2300 });
    assert.deepEqual(twap, { type: "twapOrder", twap: { a: 4, b: true, s: "0.5", r: false, m: 30, t: true } });
    assert.throws(() => twapOrder({ market: ETH, side: "buy", size: "0.5", minutes: 3, randomize: false }), /5 to 1440/u);
    assert.throws(() => twapOrder({ market: ETH, side: "buy", size: "0.01", minutes: 30, randomize: false, referencePx: 2300 }), /\$100/u);
  });

  it("checks leverage against the market", () => {
    assert.deepEqual(leverageAction(ETH, 5, true), { type: "updateLeverage", asset: 4, isCross: true, leverage: 5 });
    assert.throws(() => leverageAction(ETH, 26, true), /at most 25x/u);
    assert.throws(() => leverageAction(HYPE, 3, true), /isolated/u);
    assert.deepEqual(leverageAction(HYPE, 3, false), { type: "updateLeverage", asset: 135, isCross: false, leverage: 3 });
    assert.throws(() => leverageAction(HYPE_SPOT, 2, false), /Spot/u);
  });
});

describe("scale orders", () => {
  it("distributes flat, front- and back-loaded weights that sum to 1", () => {
    for (const skew of ["flat", "front", "back"] as const) {
      const distribution = scaleDistribution(5, skew);
      assert.ok(Math.abs(distribution.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
    }
    assert.deepEqual(scaleWeights(4, "front"), [4, 3, 2, 1]);
    assert.deepEqual(scaleWeights(4, "back"), [1, 2, 3, 4]);
    assert.throws(() => scaleWeights(1, "flat"));
  });

  it("splits whole lots exactly (largest remainder, never more than asked)", () => {
    assert.deepEqual(splitLots(10n, [1, 1, 1]), [4n, 3n, 3n]);
    assert.deepEqual(splitLots(7n, [3, 2, 1]), [4n, 2n, 1n]);
    for (const total of [1n, 99n, 12_345n]) {
      for (const weights of [[1, 1, 1, 1, 1, 1, 1], [7, 6, 5, 4, 3, 2, 1]]) {
        assert.equal(splitLots(total, weights).reduce((a, b) => a + b, 0n), total);
      }
    }
  });

  it("builds a ladder on valid ticks with the exact total", () => {
    const built = scaleOrder({ market: ETH, side: "buy", totalSize: "1.00007", from: "2300", to: "2200", count: 5, skew: "back", cloid });
    const sizes = built.action.orders.map((order) => Number(order.s));
    assert.equal(Math.round(sizes.reduce((a, b) => a + b, 0) * 1e4), 10_000, "1.00007 rounds down to 1.0000 and is split exactly");
    assert.deepEqual(built.action.orders.map((order) => order.p), ["2300", "2275", "2250", "2225", "2200"]);
    assert.ok(sizes[4]! > sizes[0]!, "back-loaded: more at the last price");
    assert.ok(built.action.orders.every((order) => isValidPrice(order.p, 4, false)));
    assert.deepEqual(ladderPrices(1, 3, 3), [1, 2, 3]);
    assert.equal(averagePrice([{ px: 100, sz: 1 }, { px: 200, sz: 3 }]), 175);
    assert.throws(() => scaleOrder({ market: ETH, side: "buy", totalSize: "0.01", from: "2300", to: "2200", count: 5, skew: "flat" }), /at least \$10/u);
    assert.throws(() => scaleOrder({ market: BTC, side: "buy", totalSize: "1", from: "80000", to: "80002", count: 10, skew: "flat" }), /too close/u);
  });
});

describe("liquidation estimates", () => {
  it("matches the documented formula for isolated longs and shorts", () => {
    // Long 1 BTC at 100,000, 10x isolated, max 40x: l = 1/80, margin 10,000.
    const l = maintenanceFraction(40);
    assert.equal(l, 1 / 80);
    const long = estimateLiquidation({ side: 1, entryPx: 100_000, size: 1, leverage: 10, maxLeverage: 40, marginMode: "isolated" });
    assert.ok(Math.abs((long ?? 0) - 90_000 / (1 - 1 / 80)) < 1e-6);
    const short = estimateLiquidation({ side: -1, entryPx: 100_000, size: 1, leverage: 10, maxLeverage: 40, marginMode: "isolated" });
    assert.ok(Math.abs((short ?? 0) - 110_000 / (1 + 1 / 80)) < 1e-6);
    // Same answer from the generic formula at a later mark.
    const mark = 95_000;
    const accountValue = 10_000 + (mark - 100_000);
    assert.ok(Math.abs((liquidationPrice({ side: 1, price: mark, size: 1, marginAvailable: accountValue - mark / 80, maxLeverage: 40 }) ?? 0) - (long ?? 0)) < 1e-6);
  });

  it("uses the whole account for cross and refuses impossible liquidations", () => {
    const cross = estimateLiquidation({ side: 1, entryPx: 2000, size: 1, leverage: 5, maxLeverage: 25, marginMode: "cross", accountValue: 1000, otherMaintenance: 0 });
    const isolated = estimateLiquidation({ side: 1, entryPx: 2000, size: 1, leverage: 5, maxLeverage: 25, marginMode: "isolated" });
    assert.ok((cross ?? 0) < (isolated ?? 0), "more margin pushes the liquidation further away");
    assert.equal(estimateLiquidation({ side: 1, entryPx: 2000, size: 1, leverage: 1, maxLeverage: 25, marginMode: "isolated" }), null, "a 1x long cannot be liquidated");
  });

  it("reads distance, tone and bar", () => {
    assert.ok(Math.abs((liquidationDistance(3342.7, 2693.4) ?? 0) - 0.1942) < 0.0005);
    assert.equal(distanceTone(0.06), "rose");
    assert.equal(distanceTone(0.19), "gold");
    assert.equal(distanceTone(0.33), "mint");
    assert.ok(distanceBar(0.19) > 0.75 && distanceBar(0.19) < 0.85);
    assert.ok(distanceBar(0.06) < distanceBar(0.19));
    assert.equal(liquidationDistance(100, null), null);
  });
});

describe("ticket math", () => {
  it("sizes from USD or base, rounded down to lots", () => {
    assert.equal(baseSize({ amount: "1000", unit: "usd", px: 3342.7, szDecimals: 4 }), "0.2991");
    assert.equal(baseSize({ amount: "0.123456", unit: "base", px: null, szDecimals: 4 }), "0.1234");
    assert.equal(baseSize({ amount: "1000", unit: "usd", px: null, szDecimals: 4 }), null);
    assert.equal(maxSizeFor({ side: "sell", maxTradeSzs: ["0.61082", "0.6197"], leverage: 25, px: 80498 }), 0.6197);
    assert.equal(maxSizeFor({ side: "buy", availableUsd: 1000, leverage: 5, px: 2000 }), 2.5);
    assert.equal(presetAmount({ percent: 50, maxBase: 2.5, unit: "base", px: 2000, szDecimals: 4 }), "1.25");
    assert.equal(presetAmount({ percent: 50, maxBase: 2.5, unit: "usd", px: 2000, szDecimals: 4 }), "2500.00");
  });

  it("converts ROE targets to trigger prices and back", () => {
    const tp = priceForRoe({ entryPx: 3318, isLong: true, roePct: 10, leverage: 5, kind: "tp" });
    assert.ok(Math.abs((tp ?? 0) - 3318 * 1.02) < 1e-9);
    const sl = priceForRoe({ entryPx: 3318, isLong: false, roePct: 5, leverage: 5, kind: "sl" });
    assert.ok(Math.abs((sl ?? 0) - 3318 * 1.01) < 1e-9);
    assert.ok(Math.abs((roeAt({ entryPx: 3318, px: 3390, isLong: true, leverage: 5 }) ?? 0) - 0.1085) < 0.001);
  });

  it("reads fees and leverage ticks", () => {
    assert.deepEqual(feeRatesFrom(null, false), { taker: 0.00045, maker: 0.00015 });
    assert.deepEqual(feeRatesFrom({ userCrossRate: "0.0004", userAddRate: "0.0001" }, false), { taker: 0.0004, maker: 0.0001 });
    assert.equal(feeFor(10_000, { taker: 0.00045, maker: 0.00015 }, true), 4.5);
    assert.deepEqual(leverageTicks(25), [1, 5, 10, 15, 20, 25]);
    assert.deepEqual(leverageTicks(5), [1, 2, 3, 5]);
    assert.equal(leverageTicks(10).at(-1), 10);
    assert.equal(dangerLeverage(25), 13);
    assert.equal(dangerLeverage(3), 2);
  });
});

describe("account model", () => {
  const chs = {
    user: "0x4547b9e33f07965711f67d0be2423939a4e33af5",
    clearinghouseStates: [
      ["", {
        marginSummary: { accountValue: "3649.22", totalNtlPos: "2005.67", totalRawUsd: "4970.66", totalMarginUsed: "155.7" },
        crossMarginSummary: { accountValue: "3649.22", totalNtlPos: "2005.67", totalRawUsd: "4970.66", totalMarginUsed: "155.7" },
        crossMaintenanceMarginUsed: "75.28",
        withdrawable: "3341.58",
        assetPositions: [
          { type: "oneWay", position: { coin: "SOL", szi: "-11.51", leverage: { type: "cross", value: 10 }, entryPx: "110.4114", positionValue: "1258.043", unrealizedPnl: "12.79", returnOnEquity: "0.1", liquidationPx: "405.02", marginUsed: "125.8", maxLeverage: 10, cumFunding: { allTime: "1", sinceOpen: "-0.4", sinceChange: "0" } } },
          { type: "oneWay", position: { coin: "BTC", szi: "0.00425", leverage: { type: "cross", value: 25 }, entryPx: "80000", positionValue: "342.1", unrealizedPnl: "2.1", returnOnEquity: "0.15", liquidationPx: null, marginUsed: "13.6", maxLeverage: 40, cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" } } },
        ],
        time: 1,
      }],
      ["xyz", { marginSummary: { accountValue: "0", totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" }, crossMarginSummary: { accountValue: "0", totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" }, crossMaintenanceMarginUsed: "0", withdrawable: "0", assetPositions: [], time: 1 }],
    ],
  };

  it("reads positions across dexes with liquidation distance", () => {
    const rows = positionsFrom(chs);
    assert.deepEqual(rows.map((row) => row.coin), ["SOL", "BTC"]);
    const sol = rows[0]!;
    assert.equal(sol.isLong, false);
    assert.equal(sol.leverage, 10);
    assert.ok(Math.abs(sol.markPx - 1258.043 / 11.51) < 1e-9);
    assert.ok((sol.liquidationDistance ?? 0) > 2);
    assert.equal(rows[1]!.liquidationPx, null);
    const summary = accountSummaryFrom(chs);
    assert.equal(summary?.accountValue, 3649.22);
    assert.equal(summary?.crossAccountValue, 3649.22);
    assert.deepEqual(positionsFrom({ dex: "", user: "0x", clearinghouseState: chs.clearinghouseStates[0]![1] }).length, 2);
  });

  it("reads open orders and TWAPs", () => {
    const orders = openOrdersFrom({ dex: "", user: "0x", orders: [{ coin: "SOL", side: "B", limitPx: "107.77", sz: "0.4", oid: 63997047450, timestamp: 1, isTrigger: false, reduceOnly: false, orderType: "Limit", origSz: "0.4", tif: "Alo", cloid: null, triggerCondition: "N/A", triggerPx: "0.0", children: [], isPositionTpsl: false }] });
    assert.equal(orders.length, 1);
    const twaps = twapsFrom({ states: [[8713, { coin: "ETH", side: "A", sz: "5.0", executedSz: "2.0", executedNtl: "4600", minutes: 70, reduceOnly: false, randomize: true, timestamp: 1000 }]] });
    assert.equal(twaps[0]?.id, 8713);
    assert.equal(twaps[0]?.isBuy, false);
    assert.equal(twaps[0]?.executed, 2);
  });

  it("measures 24 h volume and realized loss, or says it cannot", () => {
    const now = 10 * 86_400_000;
    const fills = [
      { time: now - 1_000, px: "100", sz: "2", dir: "Open Long", closedPnl: "0", fee: "0.1" },
      { time: now - 2_000, px: "100", sz: "1", dir: "Close Long", closedPnl: "-30", fee: "0.1" },
      { time: now - 2 * 86_400_000, px: "100", sz: "50", dir: "Open Short", closedPnl: "0", fee: "1" },
    ];
    const window = fillWindow(fills, now);
    assert.equal(window.volume, 200);
    assert.ok(Math.abs((window.realizedLoss ?? 0) - 30.2) < 1e-9);
    assert.deepEqual(fillWindow(fills.slice(0, 2), now, 86_400_000, false), { volume: null, realizedLoss: null }, "a capped list whose oldest fill is inside the window is unknown");
    assert.deepEqual(fillWindow(null, now), { volume: null, realizedLoss: null });
    const facts = guardAccountFacts({ positions: positionsFrom(chs), openOrders: [], fills, fillsComplete: true, now });
    assert.equal(facts.trading.openOrders, 0);
    assert.equal(facts.trading.dayVolumeUsdMicros, 200_000_000n);
    assert.equal(facts.weekUsdMicros, 5_200_000_000n);
  });
});

describe("guard strip decisions", () => {
  const now = 1_793_290_000_000;
  const markets = new Map<number, { coin: string; displayName: string; kind: "perp" | "spot" | "hip3"; quote: string; asset: number }>([
    [4, { coin: "ETH", displayName: "ETH", kind: "perp", quote: "USD", asset: 4 }],
    [11035, { coin: "@1035", displayName: "HYPE/USDC", kind: "spot", quote: "USDC", asset: 11035 }],
  ]);
  const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({
    mode: "testnet",
    networkKey: "hypercore-testnet",
    master: "0x4547b9e33f07965711f67d0be2423939a4e33af5",
    marketByAsset: (asset) => markets.get(asset) ?? null,
    priceOf: (coin) => (coin === "ETH" ? 2300 : coin === "@1035" ? 159 : null),
    leverageOf: () => 5,
    marketSlippageBps: 100,
    trading: { openOrders: 3, openNotionalUsdMicros: 0n, dayVolumeUsdMicros: 0n, dayRealizedLossUsdMicros: 0n },
    dayUsdMicros: 0n,
    weekUsdMicros: 0n,
    now,
    ...overrides,
  });
  const book = DEFAULT_RULE_BOOK;

  it("allows an ordinary order and reads the facts from the action", () => {
    const built = marketOrder({ market: ETH, side: "buy", size: "0.5", mid: "2300", slippageBps: 100 });
    const facts = guardFactsFor(built.action, ctx());
    assert.equal(facts.steps.length, 1);
    assert.equal(facts.steps[0]?.trade?.notionalUsdMicros, 1_161_500_000n, "0.5 x worst price 2323");
    assert.equal(facts.steps[0]?.trade?.slippageBps, 100);
    assert.equal(facts.steps[0]?.network, "hypercore-testnet");
    assert.equal(evaluateAction(book, built.action, ctx()).decision, "allow");
  });

  it("confirms above $2,500 or 10x, denies above $10,000, 20x or the slippage cap", () => {
    assert.equal(evaluateAction(book, limitOrder({ market: ETH, side: "buy", size: "1.2", price: "2300", tif: "Gtc" }).action, ctx()).decision, "confirm");
    assert.equal(evaluateAction(book, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, ctx({ plannedLeverage: { ETH: 15 } })).decision, "confirm");
    const big = evaluateAction(book, limitOrder({ market: ETH, side: "buy", size: "5", price: "2300", tif: "Gtc" }).action, ctx());
    assert.equal(big.decision, "deny");
    assert.ok(big.reasons.some((reason) => reason.rule === "trading.maxNotionalUsd"));
    assert.equal(evaluateAction(book, leverageAction(ETH, 21, true), ctx()).decision, "deny");
    const slippy = marketOrder({ market: ETH, side: "buy", size: "0.5", mid: "2300", slippageBps: 500 });
    assert.equal(evaluateAction(book, slippy.action, ctx({ marketSlippageBps: 500 })).decision, "deny");
  });

  it("fails closed when an account fact is unknown, but lets de-risking through", () => {
    const unknown = ctx({ trading: { openOrders: null, openNotionalUsdMicros: null, dayVolumeUsdMicros: null, dayRealizedLossUsdMicros: null }, dayUsdMicros: null, weekUsdMicros: null });
    const opening = evaluateAction(book, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, unknown);
    assert.equal(opening.decision, "deny");
    assert.ok(opening.reasons.some((reason) => reason.rule === "facts.unavailable"));
    assert.equal(evaluateAction(book, cancelOrders([{ asset: 4, oid: 1 }])!, unknown).decision, "allow");
    assert.equal(guardLines(opening.reasons).some((line) => /Waiting for account data/u.test(line.text)), true);
  });

  it("the kill switch blocks new risk but never closes or cancels", () => {
    const paused = effectiveRuleBook({ paused: true }).book;
    assert.equal(evaluateAction(paused, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, ctx()).decision, "deny");
    assert.equal(evaluateAction(paused, closePositionOrder({ market: ETH, szi: "1", mid: "2300", slippageBps: 100 }).action, ctx()).decision, "allow");
    assert.equal(evaluateAction(paused, cancelOrders([{ asset: 4, oid: 9 }])!, ctx()).decision, "allow");
  });

  it("applies overrides: market list, tighter leverage, mainnet opt-in", () => {
    const { book: tight, issues } = effectiveRuleBook({ maxLeverage: 3, markets: ["BTC", "SOL"], maxNotionalUsd: "500" });
    assert.deepEqual(issues, []);
    const verdict = evaluateAction(tight, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, ctx());
    assert.equal(verdict.decision, "deny");
    const rules = verdict.reasons.map((reason) => reason.rule);
    assert.ok(rules.includes("trading.markets.allow") && rules.includes("trading.maxLeverage") && rules.includes("trading.maxNotionalUsd"));
    assert.match(bookSummary(tight), /max 3× · max \$500 per order · BTC, SOL only/u);
    // Mainnet is outside the default book.
    const mainnetCtx = ctx({ mode: "mainnet", networkKey: "hypercore-mainnet" });
    const order = limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action;
    assert.equal(evaluateAction(book, order, mainnetCtx).decision, "deny");
    assert.equal(evaluateAction(effectiveRuleBook({ allowMainnet: true }).book, order, mainnetCtx).decision, "allow");
    assert.ok(effectiveRuleBook({ maxNotionalUsd: "12.345" }).issues.length > 0, "invalid overrides are reported and dropped");
  });

  it("prices spot by its stable quote and combines verdicts of one click", () => {
    const spot = marketOrder({ market: HYPE_SPOT, side: "buy", size: "2", mid: "159", slippageBps: 100 });
    const facts = guardFactsFor(spot.action, ctx());
    assert.equal(facts.steps[0]?.trade?.marketKind, "spot");
    assert.equal(facts.steps[0]?.trade?.leverage, 1);
    const combined = combineEvaluations([
      evaluateAction(book, leverageAction(ETH, 15, true), ctx()),
      evaluateAction(book, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, ctx({ plannedLeverage: { ETH: 15 } })),
    ]);
    assert.equal(combined.decision, "confirm");
    assert.equal(combined.reasons.filter((reason) => reason.rule === "confirm.leverageAbove").length, 1, "the same reason is listed once");
  });
});
