/**
 * The sample trader the landing draws when the Elyia API cannot be reached
 * (or the public trader is flat). Always shown with a SAMPLE label.
 */
import type { TraderSnapshot } from "./model";

/** A busy public trader on the HyperCore testnet (the ledger's default address). */
export const PUBLIC_TRADER = "0x6e190168dc30077b827eb6c1eb7629a7c16f912a";

export const SAMPLE_TRADER: TraderSnapshot = {
  address: "0x7a3e5b2c91d04f6e8a7b3c2d1e0f9a8b7c6d3f2c",
  mode: "testnet",
  generatedAt: 0,
  totals: { netWorthUsd: 48_213, byLayer: { hypercore: 30_993, hyperevm: 6_040, elysium: 11_180 }, unrealizedPnlUsd: 1_204 },
  layers: [
    { layer: "hypercore", totalUsd: 30_993, lines: [{ id: "core-usdc", asset: "USDC", account: "perp", usd: 9_633 }] },
    { layer: "hyperevm", totalUsd: 6_040, lines: [{ id: "evm-khype", asset: "kHYPE", account: "wallet", usd: 6_040 }] },
    {
      layer: "elysium",
      totalUsd: 11_180,
      lines: [
        { id: "ely-usdc", asset: "USDC", account: "wallet", usd: 4_180 },
        { id: "ely-hype", asset: "HYPE", account: "wallet", usd: 7_000 },
      ],
    },
  ],
  positions: [
    { id: "|HYPE", coin: "HYPE", side: "long", entryPx: "38.20", markPx: 41.32, liquidationPx: "27.61", liquidationDistancePct: 33.2, leverage: { value: 3 }, positionValue: 12_400, positionValueUsd: 12_400, unrealizedPnl: 936 },
    { id: "|ETH", coin: "ETH", side: "long", entryPx: "3318", markPx: 3342.7, liquidationPx: "2693", liquidationDistancePct: 19.4, leverage: { value: 5 }, positionValue: 8_960, positionValueUsd: 8_960, unrealizedPnl: 66 },
    { id: "|FARTCOIN", coin: "FARTCOIN", side: "short", entryPx: "0.5810", markPx: 0.598, liquidationPx: "0.636", liquidationDistancePct: 6.4, leverage: { value: 3 }, positionValue: 2_100, positionValueUsd: 2_100, unrealizedPnl: -61 },
  ],
};
