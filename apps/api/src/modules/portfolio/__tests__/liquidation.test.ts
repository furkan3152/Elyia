import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClearinghouseState, MetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import { marginTiersFor } from "../../markets/catalog.js";
import { fixture } from "../../markets/__tests__/fakes.js";
import {
  estimateCrossLiquidationPx,
  isolatedLiquidationPx,
  liquidationDistancePct,
  liquidationPxFromMargin,
  liquidationRisk,
  maintenanceMargin,
  signedDistancePct,
  tierFor,
} from "../liquidation.js";

const state = fixture<ClearinghouseState>("testnet-clearinghouse-isolated.json", "portfolio");
const [meta] = fixture<MetaAndAssetCtxs>("testnet-meta-ctxs.json");
/** Tiers from the trimmed meta; a coin outside it falls back to one flat tier at the position's own maxLeverage. */
const tiersOf = (coin: string) => {
  const tiers = marginTiersFor(meta, meta.universe.findIndex((asset) => asset.name === coin));
  if (tiers) return tiers;
  const maxLeverage = state.assetPositions.find((asset) => asset.position.coin === coin)?.position.maxLeverage ?? 1;
  return [{ lowerBoundUsd: 0, maxLeverage, maintenanceMarginRate: 1 / (2 * maxLeverage), maintenanceDeductionUsd: 0 }];
};

describe("isolated liquidation price (recorded testnet positions)", () => {
  for (const coin of ["BTC", "ETH", "BNB", "AVAX", "NEAR"]) {
    it(`reproduces HyperCore's liquidationPx for ${coin}`, () => {
      const position = state.assetPositions.find((asset) => asset.position.coin === coin)?.position;
      assert.ok(position && position.leverage.type === "isolated");
      const computed = isolatedLiquidationPx({ szi: Number(position.szi), rawUsd: Number(position.leverage.rawUsd), tiers: tiersOf(coin) });
      const api = Number(position.liquidationPx);
      assert.ok(computed !== null && Math.abs(computed - api) / api < 1e-8, `${coin}: ${computed} vs ${api}`);
    });
  }

  it("returns null when no positive price liquidates the position (API says null)", () => {
    const kaito = state.assetPositions.find((asset) => asset.position.coin === "KAITO")?.position;
    assert.ok(kaito && kaito.leverage.type === "isolated");
    assert.equal(kaito.liquidationPx, null);
    assert.equal(isolatedLiquidationPx({ szi: Number(kaito.szi), rawUsd: Number(kaito.leverage.rawUsd), tiers: [{ lowerBoundUsd: 0, maxLeverage: 5, maintenanceMarginRate: 0.1, maintenanceDeductionUsd: 0 }] }), null);
    assert.equal(isolatedLiquidationPx({ szi: 0, rawUsd: 10, tiers: tiersOf("BTC") }), null);
  });

  it("the docs formula from margin available agrees with the rawUsd form", () => {
    const btc = state.assetPositions.find((asset) => asset.position.coin === "BTC")?.position;
    assert.ok(btc && btc.leverage.type === "isolated");
    const size = Number(btc.szi);
    const mark = Number(btc.positionValue) / size;
    const rate = tierFor(Number(btc.positionValue), tiersOf("BTC"))?.maintenanceMarginRate ?? 0;
    const marginAvailable = Number(btc.marginUsed) - Number(btc.positionValue) * rate;
    const fromDocs = liquidationPxFromMargin({ price: mark, side: 1, size, marginAvailable, maintenanceRate: rate });
    assert.ok(fromDocs !== null && Math.abs(fromDocs - Number(btc.liquidationPx)) / Number(btc.liquidationPx) < 1e-6);
  });
});

describe("tiers, distance and risk", () => {
  const tiers = tiersOf("BTC");

  it("picks the tier of the position value and keeps maintenance continuous", () => {
    assert.equal(tierFor(5_000, tiers)?.maxLeverage, 40);
    assert.equal(tierFor(10_000, tiers)?.maxLeverage, 25);
    assert.equal(tierFor(60_000, tiers)?.maxLeverage, 10);
    const below = maintenanceMargin(9_999.99, tiers) ?? 0;
    const at = maintenanceMargin(10_000, tiers) ?? 0;
    assert.ok(Math.abs(at - below) < 0.01, "no jump at a tier boundary");
  });

  it("measures the adverse move to liquidation for longs and shorts", () => {
    assert.equal(liquidationDistancePct(1, 100, 80), 20);
    assert.equal(liquidationDistancePct(-1, 100, 125), 25);
    assert.equal(liquidationDistancePct(1, 100, null), null);
    assert.equal(liquidationDistancePct(1, 0, 80), null);
    assert.equal(signedDistancePct(100, 80), -20);
    assert.equal(liquidationRisk(30), "safe");
    assert.equal(liquidationRisk(14.99), "watch");
    assert.equal(liquidationRisk(4), "danger");
    assert.equal(liquidationRisk(null), "none");
  });

  it("the cross estimate uses perp-only margin and lands on the conservative side of a single-position account", () => {
    // One cross long: equity 1000 USDC, 10 HYPE at 100, maintenance 5 %.
    const estimate = estimateCrossLiquidationPx({ mark: 100, szi: 10, crossAccountValue: 1_000, crossMaintenanceMarginUsed: 50, maintenanceRate: 0.05 });
    assert.ok(estimate === null, "1000 USDC backing 1000 USD of HYPE cannot be liquidated at a positive price");
    const levered = estimateCrossLiquidationPx({ mark: 100, szi: 50, crossAccountValue: 1_000, crossMaintenanceMarginUsed: 250, maintenanceRate: 0.05 });
    // At P: equity 1000 + 50 (P - 100) = maintenance 0.05 * 50 P  =>  P = 4000 / 47.5.
    assert.ok(levered !== null && Math.abs(levered - 4_000 / 47.5) < 1e-6);
    const short = estimateCrossLiquidationPx({ mark: 100, szi: -50, crossAccountValue: 1_000, crossMaintenanceMarginUsed: 250, maintenanceRate: 0.05 });
    assert.ok(short !== null && Math.abs(short - 6_000 / 52.5) < 1e-6);
  });
});
