import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MetaAndAssetCtxs, PerpMeta, SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { PerpDex } from "../../../hyperliquid/types.js";
import { buildPerpRows, buildSpotRows, marginTiersFor, matchesQuery, perpAssetId, perpBase, perpDexOf, sortByVolume } from "../catalog.js";
import { buildDexDirectory, resolveSpot } from "../catalogService.js";
import { fixture } from "./fakes.js";

const [meta, ctxs] = fixture<MetaAndAssetCtxs>("testnet-meta-ctxs.json");
const [spotMeta, spotCtxs] = fixture<SpotMetaAndAssetCtxs>("testnet-spot-ctxs.json");

describe("perp rows (recorded testnet metaAndAssetCtxs)", () => {
  const rows = buildPerpRows({ dex: "", dexIndex: 0, meta, ctxs, collateral: "USDC", quoteUsd: 1 });

  it("keeps the universe index as the asset id and derives funding APR, OI and 24 h change", () => {
    const btc = rows.find((row) => row.coin === "BTC");
    assert.ok(btc);
    assert.equal(btc.assetId, 3, "testnet BTC is perp index 3");
    assert.equal(rows.find((row) => row.coin === "ETH")?.assetId, 4);
    const ctx = ctxs[3];
    assert.ok(ctx);
    assert.equal(btc.markPx, ctx.markPx);
    assert.equal(btc.fundingHourly, ctx.funding);
    assert.ok(Math.abs((btc.fundingAprPct ?? 0) - Number(ctx.funding) * 8760 * 100) < 1e-3);
    assert.ok(Math.abs((btc.openInterestUsd ?? 0) - Number(ctx.openInterest) * Number(ctx.markPx)) < 1e-3);
    assert.ok(Math.abs((btc.change24hPct ?? 0) - ((Number(ctx.markPx) - Number(ctx.prevDayPx)) / Number(ctx.prevDayPx)) * 100) < 1e-3);
    assert.equal(btc.volume24hUsd, Number(Number(ctx.dayNtlVlm).toFixed(6)));
    assert.equal(btc.maxLeverage, 40);
    assert.deepEqual(btc.impactPxs, ctx.impactPxs);
  });

  it("unknown quote value leaves USD figures null, never zero", () => {
    const unknown = buildPerpRows({ dex: "", dexIndex: 0, meta, ctxs, collateral: "USDC", quoteUsd: null });
    assert.ok(unknown.every((row) => row.volume24hUsd === null && row.openInterestUsd === null));
    assert.ok(unknown.every((row) => row.volume24hQuote !== null));
  });

  it("HIP-3 rows use 100000 + dex * 10000 + index and strip the dex prefix from the base", () => {
    assert.equal(perpAssetId(5, 0), 150_000);
    assert.equal(perpAssetId(9, 3), 190_003);
    assert.equal(perpBase("xyz:TSLA"), "TSLA");
    assert.equal(perpDexOf("xyz:TSLA"), "xyz");
    assert.equal(perpDexOf("BTC"), "");
    const hip3 = buildPerpRows({ dex: "test", dexIndex: 1, meta: { universe: [{ name: "test:ABC", szDecimals: 0, maxLeverage: 3 }] }, ctxs: [], collateral: "USDC", quoteUsd: 1 });
    assert.equal(hip3[0]?.assetId, 110_000);
    assert.equal(hip3[0]?.base, "ABC");
    assert.equal(hip3[0]?.markPx, null);
  });

  it("sorts by USD volume with unknown volume last", () => {
    const sorted = sortByVolume([
      { ...(rows[0] as (typeof rows)[number]), coin: "A", displayName: "A", volume24hUsd: null },
      { ...(rows[0] as (typeof rows)[number]), coin: "B", displayName: "B", volume24hUsd: 5 },
      { ...(rows[0] as (typeof rows)[number]), coin: "C", displayName: "C", volume24hUsd: 50 },
    ]);
    assert.deepEqual(sorted.map((row) => row.coin), ["C", "B", "A"]);
    assert.ok(matchesQuery(rows[3] as (typeof rows)[number], "bt"));
    assert.ok(!matchesQuery(rows[3] as (typeof rows)[number], "eth"));
  });
});

describe("spot rows (recorded testnet spotMetaAndAssetCtxs)", () => {
  const rows = buildSpotRows({ meta: spotMeta, ctxs: spotCtxs, quoteUsd: (index) => (index === 0 ? 1 : null) });

  it("names pairs BASE/QUOTE and uses 10000 + pair index as the asset id", () => {
    const hype = rows.find((row) => row.coin === "@1035");
    assert.equal(hype?.displayName, "HYPE/USDC");
    assert.equal(hype?.assetId, 11_035);
    assert.equal(hype?.szDecimals, 2);
    assert.equal(rows.find((row) => row.coin === "PURR/USDC")?.assetId, 10_000);
  });

  it("a pair quoted in an unpriced token has no USD volume", () => {
    const other = rows.find((row) => row.coin === "@1201");
    assert.equal(other?.quote, "USDZZ");
    assert.equal(other?.volume24hUsd, null);
    assert.equal(other?.quoteUsd, null);
  });

  it("resolves by book coin or display name, refuses unknown pairs", () => {
    assert.equal(resolveSpot(spotMeta, "@1035").coin, "@1035");
    assert.equal(resolveSpot(spotMeta, "HYPE/USDC").coin, "@1035");
    assert.equal(resolveSpot(spotMeta, "hype/usdc").coin, "@1035");
    assert.equal(resolveSpot(spotMeta, "PURR/USDC").coin, "PURR/USDC");
    assert.throws(() => resolveSpot(spotMeta, "NOPE/USDC"), (error: unknown) => (error as { code?: string }).code === "MARKET_NOT_FOUND");
  });

  it("ties between same-named tokens go to the registry-linked base token", () => {
    const clash = {
      tokens: [...spotMeta.tokens, { ...spotMeta.tokens[2], index: 9_999, name: "HYPE" } as (typeof spotMeta.tokens)[number]],
      universe: [{ name: "@5", tokens: [9_999, 0] as const, index: 5, isCanonical: false }, ...spotMeta.universe],
    };
    assert.equal(resolveSpot(clash, "HYPE/USDC").coin, "@5", "without registry knowledge the oldest pair wins");
    assert.equal(resolveSpot(clash, "HYPE/USDC", (index) => index === 1105).coin, "@1035");
  });
});

describe("margin tiers and the dex directory", () => {
  it("computes maintenance rates and deductions of a tiered table (testnet BTC, table 54)", () => {
    const tiers = marginTiersFor(meta, 3);
    assert.deepEqual(tiers, [
      { lowerBoundUsd: 0, maxLeverage: 40, maintenanceMarginRate: 0.0125, maintenanceDeductionUsd: 0 },
      { lowerBoundUsd: 10_000, maxLeverage: 25, maintenanceMarginRate: 0.02, maintenanceDeductionUsd: 75 },
      { lowerBoundUsd: 50_000, maxLeverage: 10, maintenanceMarginRate: 0.05, maintenanceDeductionUsd: 1_575 },
    ]);
  });

  it("an unlisted margin table is one flat tier at max leverage", () => {
    const sol = marginTiersFor(meta, 0);
    assert.deepEqual(sol, [{ lowerBoundUsd: 0, maxLeverage: 10, maintenanceMarginRate: 0.05, maintenanceDeductionUsd: 0 }]);
    assert.equal(marginTiersFor(meta, 999), null);
  });

  it("lists HIP-3 dexes with market counts and collateral from allPerpMetas", () => {
    const directory = buildDexDirectory(fixture<Array<PerpDex | null>>("testnet-perp-dexs.json"), fixture<PerpMeta[]>("testnet-all-perp-metas.json"), new Map([[0, "USDC"]]));
    assert.deepEqual(
      directory.dexes.map((dex) => [dex.name, dex.index, dex.markets, dex.liveMarkets, dex.collateral, dex.collateralToken]),
      [
        ["test", 1, 1, 1, "USDC", 0],
        ["unit", 2, 2, 1, "USDC", 0],
        ["scam", 3, 2, 2, "USDC", 0],
      ],
    );
    assert.equal(directory.indexByName.get("unit"), 2);
    assert.equal(directory.indexByName.has(""), false, "the first dex is not a HIP-3 dex");
  });
});
