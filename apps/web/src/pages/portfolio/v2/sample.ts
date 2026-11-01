/**
 * The labelled sample shown before a wallet is connected (or when the API
 * cannot be reached): what Ely's insights look like, on the same sample
 * range the terrain draws. Never anyone's money; every place it shows says
 * "sample". The draft actions are real intent actions, so the sign flow can
 * be explored (planned for your own wallet once connected).
 */
import type { Insight } from "@elyia/core/api/agent";

export const SAMPLE_INSIGHTS: readonly Insight[] = [
  {
    id: "sample_liquidation-guard_ETH",
    kind: "liquidation-guard",
    severity: "watch",
    title: { en: "Your ETH rope is 19% from the edge", tr: "ETH ipin kenara %19 uzaklıkta" },
    explanation: { en: "ETH 5× long: liquidation sits 19% under the mark. Trimming 25% (reduce-only) moves it away and frees margin.", tr: "ETH 5× long: tasfiye fiyatı işaretin %19 altında. %25 azaltmak (yalnızca azaltan) onu uzaklaştırır." },
    figures: { coin: "ETH", liquidationDistancePct: 19, reduceBps: 2500 },
    actions: [{ kind: "order", network: "hypercore-testnet", market: "ETH", params: { reduce: true, portionBps: 2500 } }],
    paper: false,
  },
  {
    id: "sample_idle-cash_usdc",
    kind: "idle-cash",
    severity: "info",
    title: { en: "4,200 USDC idle on the Summit", tr: "Zirvede 4,200 USDC boşta" },
    explanation: { en: "The Cheshire USDC vault is the verified ERC-4626 venue on Elysium. Its yield is not measured yet, so no APY is promised. Sweep 4,000 and keep 200.", tr: "Cheshire USDC kasası Elysium'da doğrulanmış ERC-4626 alanı. Getiri henüz ölçülmedi. 4,000 yatır, 200 bırak." },
    figures: { idleUsdc: 4200, depositUsdc: 4000, venue: "cheshire", apyPct: null },
    actions: [{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "4000", protocol: "cheshire" }],
    paper: false,
  },
  {
    id: "sample_gas-top-up",
    kind: "gas-top-up",
    severity: "watch",
    title: { en: "Gas is low on the Ridge", tr: "Sırtta gaz az" },
    explanation: { en: "0.02 HYPE on HyperEVM: under the 0.2 HYPE floor a route needs. Bridge 0.3 HYPE up before the next climb.", tr: "HyperEVM'de 0.02 HYPE: bir rotanın gerektirdiği 0.2 HYPE'ın altında." },
    figures: { layer: "HyperEVM", hype: 0.02, floor: 0.2 },
    actions: [{ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.3" }],
    paper: false,
  },
  {
    id: "sample_funding-harvest_ETH",
    kind: "funding-harvest",
    severity: "info",
    title: { en: "ETH funding pays 11.4% APR", tr: "ETH fonlaması yıllık %11.4" },
    explanation: { en: "A delta-neutral carry of $1,000 would collect about $0.31 a day while funding stays there. Paper only on testnet.", tr: "1,000$'lık delta-nötr bir pozisyon günde ~0.31$ toplar. Testnette yalnızca kağıt üzerinde." },
    figures: { coin: "ETH", aprPct: 11.4, dailyCarryUsd: 0.31 },
    actions: [],
    paper: true,
  },
];

/** 30-day explain-PnL figures for the sample (they reconcile: net = realized + funding − fees + unrealized). */
export const SAMPLE_PNL = { realizedPnlUsd: 1318, fundingUsd: -51, feesUsd: 21, unrealizedPnlUsd: 38, days: 30 } as const;
