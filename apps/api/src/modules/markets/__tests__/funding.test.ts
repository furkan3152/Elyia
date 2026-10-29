import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FundingRow } from "@elyia/core/api/markets";
import type { MetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { PredictedFundings } from "../../../hyperliquid/types.js";
import { buildPerpRows } from "../catalog.js";
import { buildFundingRows, flagOutliers, fundingOutliers, fundingStats, normalizeVenue, venueName } from "../funding.js";
import { fixture } from "./fakes.js";

const [meta, ctxs] = fixture<MetaAndAssetCtxs>("testnet-meta-ctxs.json");
const predicted = fixture<PredictedFundings>("testnet-predicted-fundings.json");
const perps = buildPerpRows({ dex: "", dexIndex: 0, meta, ctxs, collateral: "USDC", quoteUsd: 1 });

describe("funding normalization", () => {
  it("divides by the venue interval and annualizes hourly x 8760", () => {
    const binance = normalizeVenue("BinPerp", { fundingRate: "0.0001", nextFundingTime: 1_793_318_400_000, fundingIntervalHours: 8 });
    assert.deepEqual(binance, { venue: "binance", rate: "0.0001", intervalHours: 8, hourly: 0.0000125, aprPct: 10.95, nextFundingTime: 1_793_318_400_000 });
    const hl = normalizeVenue("HlPerp", { fundingRate: "0.0000125", nextFundingTime: 1, fundingIntervalHours: 1 });
    assert.equal(hl?.aprPct, 10.95);
    assert.equal(venueName("BybitPerp"), "bybit");
    assert.equal(venueName("OkxPerp"), "OkxPerp", "unknown venues keep their name");
  });

  it("never assumes an interval: a prediction without one has no hourly rate", () => {
    const raw = normalizeVenue("BinPerp", { fundingRate: "0.0001", nextFundingTime: 5 });
    assert.equal(raw?.hourly, null);
    assert.equal(raw?.aprPct, null);
    assert.equal(raw?.rate, "0.0001");
    assert.equal(normalizeVenue("BinPerp", null), null);
  });

  it("joins the recorded testnet perps with their cross-venue predictions", () => {
    const rows = buildFundingRows(perps, predicted);
    const btc = rows.find((row) => row.coin === "BTC");
    assert.ok(btc);
    assert.deepEqual(btc.venues.map((venue) => venue.venue).sort(), ["binance", "bybit", "hyperliquid"]);
    const hl = btc.venues.find((venue) => venue.venue === "hyperliquid");
    assert.equal(hl?.intervalHours, 1);
    const aprs = btc.venues.map((venue) => venue.aprPct).filter((apr): apr is number => apr !== null);
    assert.ok(Math.abs((btc.spreadAprPct ?? 0) - (Math.max(...aprs) - Math.min(...aprs))) < 1e-3);
    assert.equal(btc.currentHourly, Number(ctxs[3]?.funding));
    assert.ok(rows.every((row) => perps.some((perp) => perp.coin === row.coin && !perp.isDelisted)));
  });
});

describe("funding outliers", () => {
  const row = (coin: string, apr: number | null, spread: number | null = null): FundingRow => ({
    coin,
    markPx: null,
    openInterestUsd: null,
    currentHourly: apr === null ? null : apr / 876_000,
    currentAprPct: apr,
    venues: [],
    spreadAprPct: spread,
    outlier: false,
  });

  it("flags rows more than 5 MADs from the median and lists extremes", () => {
    const rows = flagOutliers([row("A", 10), row("B", 11), row("C", 12), row("D", 9), row("E", 10.5), row("F", 400), row("G", null, 50)]);
    assert.deepEqual(rows.filter((entry) => entry.outlier).map((entry) => entry.coin), ["F"]);
    const stats = fundingStats(rows);
    assert.equal(stats.medianAprPct, 10.75);
    const lists = fundingOutliers(rows, 2);
    assert.deepEqual(lists.highestApr, ["F", "C"]);
    assert.deepEqual(lists.lowestApr, ["D", "A"]);
    assert.deepEqual(lists.widestSpread, ["G"]);
  });

  it("a flat market (zero MAD) still flags rates far from the baseline, using the MAD floor", () => {
    assert.ok(flagOutliers([row("A", 5), row("B", 5), row("C", 5)]).every((entry) => !entry.outlier));
    const flat = flagOutliers([row("A", 10.95), row("B", 10.95), row("C", 10.95), row("D", 15), row("E", 80)]);
    assert.deepEqual(flat.filter((entry) => entry.outlier).map((entry) => entry.coin), ["E"], "10 APR points is the minimum distance");
  });
});
