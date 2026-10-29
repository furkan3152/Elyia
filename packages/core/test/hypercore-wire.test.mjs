// HyperCore wire formatting: float_to_wire parity, tick and lot rules, asset indexes, cloids.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hypercore as hc } from "../dist/index.js";

// Outputs of the Python SDK's float_to_wire (signing.py, transcribed verbatim
// into a stdlib-only script and run under CPython 3.13 on 2026-10-29).
const FLOAT_TO_WIRE = [
  [0, "0"], [1, "1"], [100, "100"], [103, "103"], [1670.1, "1670.1"], [0.0147, "0.0147"], [79650, "79650"],
  [2321.8, "2321.8"], [4.5795, "4.5795"], [79.837, "79.837"], [0.00001231, "0.00001231"], [12345.6789, "12345.6789"],
  [0.1 + 0.2, "0.3"], [1e-8, "0.00000001"], [123456789.12345678, "123456789.12345678"], [1.5e-7, "0.00000015"],
  [99999.99999999, "99999.99999999"], [108.43, "108.43"], [3.5, "3.5"], [0.5, "0.5"], [84000, "84000"],
  [76500.5, "76500.5"], [1e15, "1000000000000000"], [1234567890123.5, "1234567890123.5"], [5e-5, "0.00005"],
];
const FLOAT_TO_WIRE_ERRORS = [1.000000001, 0.123456789, 1e-9, 2.0000000049, 0.001953125];

test("floatToWire matches the SDK's float_to_wire", () => {
  for (const [input, wire] of FLOAT_TO_WIRE) assert.equal(hc.floatToWire(input), wire, String(input));
  for (const input of FLOAT_TO_WIRE_ERRORS) assert.throws(() => hc.floatToWire(input), { code: "FLOAT_ROUNDING" }, String(input));
  assert.equal(hc.floatToWire(-0), "0");
  assert.throws(() => hc.floatToWire(Number.NaN), { code: "FLOAT_INVALID" });
  assert.throws(() => hc.floatToWire(Number.POSITIVE_INFINITY), { code: "FLOAT_INVALID" });
});

test("decimal strings: canonical wire form, strict parsing", () => {
  assert.equal(hc.decimalToWire("2.50"), "2.5");
  assert.equal(hc.decimalToWire("100.000"), "100");
  assert.equal(hc.decimalToWire("0.00000001"), "0.00000001");
  for (const bad of ["1e5", "1,5", ".5", "5.", "+1", " 1", "0x10", "1.000000001"]) assert.throws(() => hc.decimalToWire(bad), String(bad));
  assert.equal(hc.isWireDecimal("1670.1"), true);
  assert.equal(hc.isWireDecimal("1670.10"), false);
  assert.equal(hc.isWireDecimal("01"), false);
  assert.equal(hc.isWireDecimal("0.123456789"), false);
  assert.equal(hc.numberToPlainString(1.5e-7), "0.00000015");
  assert.equal(hc.numberToPlainString(1e21), "1000000000000000000000");
  assert.equal(hc.numberToPlainString(-2.5e-3), "-0.0025");
});

test("tick rules: the Hyperliquid docs' own examples", () => {
  // Perps (MAX_DECIMALS 6).
  assert.equal(hc.isValidPrice("1234.5", 0, false), true);
  assert.equal(hc.isValidPrice("1234.56", 0, false), false, "too many significant figures");
  assert.equal(hc.isValidPrice("0.001234", 0, false), true);
  assert.equal(hc.isValidPrice("0.0012345", 0, false), false, "more than 6 decimals");
  assert.equal(hc.isValidPrice("0.01234", 1, false), true);
  assert.equal(hc.isValidPrice("0.012345", 1, false), false, "more than 6 - szDecimals decimals");
  // Integer prices are always valid, whatever their significant figures.
  assert.equal(hc.isValidPrice("123456", 0, false), true);
  assert.equal(hc.isValidPrice("12345.6", 0, false), false);
  // Spot (MAX_DECIMALS 8): 0.0001234 has 7 decimals, so it needs szDecimals <= 1.
  assert.equal(hc.isValidPrice("0.0001234", 0, true), true);
  assert.equal(hc.isValidPrice("0.0001234", 1, true), true);
  assert.equal(hc.isValidPrice("0.0001234", 2, true), false);
  assert.equal(hc.isValidPrice("0.0001234", 3, true), false);
  // Never zero, negative or non-decimal.
  for (const bad of ["0", "-1", "1e3", "abc", ""]) assert.equal(hc.isValidPrice(bad, 0, false), false, bad);
  assert.equal(hc.maxPriceDecimals(5, false), 1);
  assert.equal(hc.maxPriceDecimals(7, false), 0);
  assert.equal(hc.maxPriceDecimals(2, true), 6);
});

test("roundPrice: 5 significant figures within the decimal cap, integers above 100000", () => {
  assert.equal(hc.roundPrice("1234.56", 0, false), "1234.6");
  assert.equal(hc.roundPrice("1234.56", 0, false, "down"), "1234.5");
  assert.equal(hc.roundPrice("1234.51", 0, false, "up"), "1234.6");
  assert.equal(hc.roundPrice("0.0012345", 0, false), "0.001235");
  assert.equal(hc.roundPrice("0.0012345", 0, false, "down"), "0.001234");
  assert.equal(hc.roundPrice("123456.7", 0, false), "123457");
  assert.equal(hc.roundPrice("79650.37", 5, false), "79650", "BTC perp: szDecimals 5");
  assert.equal(hc.roundPrice("79.8375", 2, false), "79.838", "HYPE perp: szDecimals 2");
  assert.equal(hc.roundPrice("4.57951", 0, true), "4.5795", "PURR/USDC spot");
  assert.equal(hc.roundPrice("99999.5", 0, false), "100000");
  assert.equal(hc.roundPrice("9.999996", 0, false), "10");
  assert.equal(hc.roundPrice(0.1 + 0.2, 0, false), "0.3");
  for (const [px, sz, spot] of [["1234.56", 0, false], ["0.0012345", 0, false], ["123456.7", 0, false], ["0.000123456", 1, true], ["2345.0685", 4, false]]) {
    assert.equal(hc.isValidPrice(hc.roundPrice(px, sz, spot), sz, spot), true, `${px}`);
  }
  assert.throws(() => hc.roundPrice("0", 0, false), { code: "PRICE_INVALID" });
  assert.throws(() => hc.roundPrice("-5", 0, false), { code: "PRICE_INVALID" });
  assert.throws(() => hc.roundPrice("0.0000001", 0, false, "down"), { code: "PRICE_INVALID" });
});

test("priceToWire refuses invalid ticks and names the nearest valid price", () => {
  assert.equal(hc.priceToWire(1670.1, 2, false), "1670.1");
  assert.equal(hc.priceToWire("1670.10", 2, false), "1670.1");
  assert.throws(() => hc.priceToWire("1670.15", 2, false), (error) => error.code === "PRICE_TICK" && /1670\.2/u.test(error.message));
  assert.throws(() => hc.priceToWire("0", 2, false), { code: "PRICE_TICK" });
});

test("sizes: rounded down to szDecimals by default; wire form refuses finer sizes and zero", () => {
  assert.equal(hc.roundSize("0.0123456", 5), "0.01234");
  assert.equal(hc.roundSize("0.0123456", 5, "nearest"), "0.01235");
  assert.equal(hc.roundSize("12.9", 0), "12");
  assert.equal(hc.roundSize("0.000001", 5), "0");
  assert.equal(hc.sizeToWire("0.01234", 5), "0.01234");
  assert.equal(hc.sizeToWire(0.0147, 4), "0.0147");
  assert.throws(() => hc.sizeToWire("0.012345", 5), (error) => error.code === "SIZE_LOT" && /0\.01234/u.test(error.message));
  assert.throws(() => hc.sizeToWire("0", 5), { code: "SIZE_INVALID" });
  assert.throws(() => hc.roundSize("-1", 2), { code: "SIZE_INVALID" });
});

test("market prices: mid x (1 +/- slippage), rounded toward the mid so slippage is never exceeded", () => {
  assert.equal(hc.marketPrice({ mid: "79650", isBuy: true, slippageBps: 50, szDecimals: 5, isSpot: false }), "80048");
  assert.equal(hc.marketPrice({ mid: "79650", isBuy: false, slippageBps: 50, szDecimals: 5, isSpot: false }), "79252");
  assert.equal(hc.marketPrice({ mid: "2321.85", isBuy: true, slippageBps: 100, szDecimals: 4, isSpot: false }), "2345");
  assert.equal(hc.marketPrice({ mid: "4.55685", isBuy: true, slippageBps: 500, szDecimals: 0, isSpot: true }), "4.7846");
  const buy = hc.marketPrice({ mid: "79.8375", isBuy: true, slippageBps: 30, szDecimals: 2, isSpot: false });
  assert.equal(buy, "80.077");
  assert.ok(Number(buy) <= 79.8375 * 1.003 && Number(buy) > 79.8375);
  assert.throws(() => hc.marketPrice({ mid: "0", isBuy: true, slippageBps: 50, szDecimals: 0, isSpot: false }), { code: "PRICE_INVALID" });
  // Integer-only ticks (spot, szDecimals 8): 1.5 + 0.5% rounds down to 1, below the mid, so it is refused.
  assert.throws(() => hc.marketPrice({ mid: "1.5", isBuy: true, slippageBps: 50, szDecimals: 8, isSpot: true }), { code: "PRICE_TICK" });
  assert.throws(() => hc.marketPrice({ mid: "1.5", isBuy: false, slippageBps: 50, szDecimals: 8, isSpot: true }), { code: "PRICE_TICK" });
  assert.equal(hc.marketPrice({ mid: "80000", isBuy: true, slippageBps: 0, szDecimals: 5, isSpot: false }), "80000", "zero slippage is the mid itself");
  assert.throws(() => hc.marketPrice({ mid: "1", isBuy: true, slippageBps: 10_000, szDecimals: 0, isSpot: false }), { code: "PRICE_INVALID" });
});

test("integer encodings: float_to_usd_int and micro-USD", () => {
  assert.equal(hc.floatToUsdInt(-12.5), -12500000n);
  assert.equal(hc.floatToUsdInt("1"), 1000000n);
  assert.equal(hc.usdToMicros("0.000001"), 1);
  assert.equal(hc.usdToMicros("-250.75"), -250750000);
  assert.throws(() => hc.usdToMicros("0.0000001"), { code: "FLOAT_ROUNDING" });
});

const META_SAMPLE = [
  { szDecimals: 2, name: "SOL", maxLeverage: 10 },
  { szDecimals: 2, name: "APT", maxLeverage: 3 },
  { szDecimals: 2, name: "ATOM", maxLeverage: 10 },
  { szDecimals: 5, name: "BTC", maxLeverage: 25 },
  { szDecimals: 4, name: "ETH", maxLeverage: 25, onlyIsolated: false },
  { szDecimals: 0, name: "OLD", maxLeverage: 3, isDelisted: true },
];
const SPOT_SAMPLE = {
  universe: [
    { tokens: [1, 0], name: "PURR/USDC", index: 0, isCanonical: true },
    { tokens: [1105, 0], name: "@1035", index: 1035, isCanonical: false },
  ],
  tokens: [
    { name: "USDC", szDecimals: 8, weiDecimals: 8, index: 0 },
    { name: "PURR", szDecimals: 0, weiDecimals: 5, index: 1 },
    { name: "HYPE", szDecimals: 2, weiDecimals: 8, index: 1105 },
  ],
};

test("asset indexes: perp universe position, spot 10000 + pair index, builder dexes from 110000", () => {
  assert.equal(hc.perpAssetIndex(META_SAMPLE, "BTC"), 3);
  assert.throws(() => hc.perpAssetIndex(META_SAMPLE, "DOGE"), { code: "ASSET_UNKNOWN" });
  assert.equal(hc.spotAssetIndex(0), 10000);
  assert.equal(hc.spotAssetIndex(1035), 11035);
  assert.equal(hc.isSpotAsset(11035), true);
  assert.equal(hc.isSpotAsset(3), false);
  assert.equal(hc.builderPerpAssetIndex(1, 0), 110000);
  assert.equal(hc.builderPerpAssetIndex(2, 7), 120007);
  assert.equal(hc.isSpotAsset(110000), false);
  assert.throws(() => hc.builderPerpAssetIndex(0, 1), { code: "ASSET_UNKNOWN" });
  const markets = hc.buildMarketIndex(META_SAMPLE, SPOT_SAMPLE);
  assert.deepEqual(markets.get("BTC"), { coin: "BTC", displayName: "BTC", asset: 3, szDecimals: 5, isSpot: false, maxLeverage: 25, onlyIsolated: false, isDelisted: false });
  assert.equal(markets.get("OLD")?.isDelisted, true);
  assert.equal(markets.get("PURR/USDC")?.asset, 10000);
  assert.equal(markets.get("HYPE/USDC")?.coin, "@1035");
  assert.equal(markets.get("HYPE/USDC")?.asset, 11035);
  assert.equal(markets.get("HYPE/USDC")?.szDecimals, 2);
  assert.equal(markets.get("@1035")?.displayName, "HYPE/USDC");
});

test("cloids: 16 random bytes as 0x + 32 hex, validated and lower-cased", () => {
  const stub = { getRandomValues: (array) => { array.fill(0xab); return array; } };
  assert.equal(hc.newCloid(stub), `0x${"ab".repeat(16)}`);
  const fresh = hc.newCloid();
  assert.match(fresh, /^0x[0-9a-f]{32}$/u);
  assert.notEqual(fresh, hc.newCloid());
  assert.equal(hc.cloidFromInt(1), "0x00000000000000000000000000000001");
  assert.equal(hc.normalizeCloid("0x0000000000000000000000000000BEEF"), "0x0000000000000000000000000000beef");
  assert.equal(hc.isCloid("0x1234"), false);
  assert.throws(() => hc.cloidFromInt(-1), { code: "CLOID_INVALID" });
  assert.throws(() => hc.newCloid({}), { code: "CLOID_INVALID" });
});
