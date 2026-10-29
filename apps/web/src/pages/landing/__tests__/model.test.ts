import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiChips, daysUntil, hasTerrain, layerShares, parseTrader, pickRopes, reliefHoldings, sentenceChips, sentenceGrade, sentenceLayers, signedUsd } from "../model";
import { SAMPLE_TRADER } from "../sample";

const LIVE = {
  address: "0x6e190168dc30077b827eb6c1eb7629a7c16f912a",
  mode: "testnet",
  generatedAt: 1,
  totals: { netWorthUsd: 3168.78, byLayer: { hypercore: 3168.78, hyperevm: 0, elysium: 0 }, unrealizedPnlUsd: 64.9, grossPerpNotionalUsd: 2327 },
  layers: [
    { layer: "hypercore", status: "ok", totalUsd: 3168.78, unpricedLines: 0, lines: [{ id: "x", asset: "USDC", account: "perp", usd: 3168.78 }], sources: [] },
    { layer: "hyperevm", status: "ok", totalUsd: 0, unpricedLines: 0, lines: [], sources: [] },
  ],
  positions: [
    { id: "|BNB", coin: "BNB", side: "short", entryPx: "755.41", markPx: 741.5, liquidationPx: "941.66", liquidationDistancePct: 26.99, leverage: { type: "isolated", value: 10 }, positionValue: 1303.5, positionValueUsd: 1303.5, unrealizedPnl: 24 },
    { id: "|ETH", coin: "ETH", side: "long", entryPx: "2339.24", markPx: 2312, liquidationPx: "1894.3", liquidationDistancePct: 18.06, leverage: { type: "isolated", value: 5 }, positionValue: 744.9, positionValueUsd: 744.9, unrealizedPnl: -8 },
    { id: "|NEAR", coin: "NEAR", side: "long", entryPx: "1.75", markPx: 4.37, liquidationPx: "0.87", liquidationDistancePct: 80.04, leverage: { type: "isolated", value: 1 }, positionValue: 83.9, positionValueUsd: 83.9, unrealizedPnl: 50 },
    { id: "|KAITO", coin: "KAITO", side: "long", entryPx: "0.67", markPx: 0.25, liquidationPx: null, liquidationDistancePct: null, leverage: { type: "isolated", value: 1 }, positionValue: 12.3, positionValueUsd: 12.3, unrealizedPnl: -20 },
    { coin: "BAD", side: "sideways" },
  ],
};

describe("landing trader model", () => {
  it("parses the portfolio slice and drops malformed positions", () => {
    const trader = parseTrader(LIVE);
    assert.ok(trader);
    assert.equal(trader.positions.length, 4);
    assert.equal(trader.layers.length, 2);
    assert.equal(parseTrader({ nope: true }), null);
    assert.equal(hasTerrain(trader), true);
    assert.equal(hasTerrain({ ...trader, positions: [] }), false);
  });

  it("turns positions and lines into relief holdings, largest first", () => {
    const holdings = reliefHoldings(parseTrader(LIVE)!);
    assert.equal(holdings[0]!.symbol, "USDC");
    assert.equal(holdings[0]!.note, "margin");
    const bnb = holdings.find((h) => h.symbol === "BNB")!;
    assert.equal(bnb.side, "short");
    assert.equal(bnb.leverage, 10);
    assert.equal(bnb.note, "rope 27%");
    assert.ok(holdings.every((h, i) => i === 0 || holdings[i - 1]!.usd >= h.usd));
    assert.equal(reliefHoldings(parseTrader(LIVE)!, 2).length, 2);
  });

  it("picks the tightest long, the tightest short and the safest long", () => {
    const ropes = pickRopes(parseTrader(LIVE)!);
    assert.deepEqual(
      ropes.map((r) => [r.coin, r.role]),
      [
        ["ETH", "tight"],
        ["BNB", "short"],
        ["NEAR", "safe"],
      ],
    );
    assert.ok(ropes.every((r) => r.liquidation !== null));
    assert.equal(pickRopes(SAMPLE_TRADER).length, 3);
  });

  it("splits net worth by altitude", () => {
    const shares = layerShares(SAMPLE_TRADER);
    assert.deepEqual(shares.map((s) => s.layer), ["floor", "ridge", "summit"]);
    assert.ok(Math.abs(shares.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-9);
  });
});

describe("landing sentence model", () => {
  it("merges amounts with assets and stops with their level", () => {
    const chips = sentenceChips("long ETH 5x with 200 USDC, stop at -3%");
    assert.deepEqual(chips.map((c) => c.text), ["long", "ETH", "5x", "200 USDC", "stop -3%"]);
    assert.equal(chips[0]!.direction, "up");
    assert.equal(sentenceChips("short BTC")[0]!.direction, "down");
  });

  it("knows the altitudes a sentence travels", () => {
    assert.deepEqual([...sentenceLayers("long ETH 5x")], ["floor"]);
    assert.deepEqual([...sentenceLayers("bridge 20 HYPE to Elysium and swap half to USDC")].sort(), ["ridge", "summit"]);
    assert.deepEqual([...sentenceLayers("stake 10 HYPE to kHYPE")], ["ridge"]);
  });

  it("grades by the words", () => {
    assert.equal(sentenceGrade("long ETH 5x"), 3);
    assert.equal(sentenceGrade("long ETH 8x"), 4);
    assert.equal(sentenceGrade("long ETH 20x"), 5);
    assert.equal(sentenceGrade("swap 10 HYPE to USDC"), 2);
    assert.equal(sentenceGrade("stake 10 HYPE"), 1);
    assert.equal(sentenceGrade("   "), null);
  });

  it("reads API chips loosely", () => {
    const chips = apiChips({ chips: [{ text: "long", kind: "side", span: [0, 4] }, { text: "to", kind: "connector", span: [5, 7] }, { text: "5x", kind: "leverage", value: "5x cross", span: [8, 10] }] });
    assert.deepEqual(chips?.map((c) => [c.text, c.direction]), [
      ["long", "up"],
      ["5x cross", null],
    ]);
    assert.equal(apiChips({}), null);
  });

  it("formats signed money and countdowns", () => {
    assert.equal(signedUsd(64.9), "▲ +$64.90");
    assert.equal(signedUsd(-3), "▼ −$3.00");
    assert.equal(daysUntil(Date.UTC(2026, 10, 9), Date.UTC(2026, 9, 29, 20)), 11);
    assert.equal(daysUntil(0, 1), 0);
  });
});

describe("landing map scale", () => {
  it("draws any book at one map scale and keeps the factor for labels", async () => {
    const { mapScale, MAP_TOP_USD } = await import("../model");
    const { holdings, factor } = mapScale([
      { id: "a", symbol: "A", usd: 3000, layer: "floor" },
      { id: "b", symbol: "B", usd: 300, layer: "floor" },
    ]);
    assert.equal(holdings[0]!.usd, MAP_TOP_USD);
    assert.equal(holdings[1]!.usd / factor, 300);
    assert.equal(mapScale([]).factor, 1);
  });
});
