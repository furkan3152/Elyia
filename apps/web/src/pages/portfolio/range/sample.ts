/**
 * SAMPLE range: what the pages draw when no address is followed. It is
 * documentation, never data: every surface that shows it says "sample".
 * Figures follow the Survey sheet ($48,213 across three layers).
 */
import type { BalanceLine, PerpPositionView, PortfolioHistory, PortfolioSnapshot, TimelineEvent } from "@elyia/core/api/portfolio";

import { ropeLayout, type Rope } from "../../../features/trading/topo";
import type { RopeView } from "../../../features/trading/useTopoData";
import { seededRandom } from "../../../motion/tokens";
import { calendarFromTimeline } from "./model";

export const SAMPLE_ADDRESS = "0x7a3e5b2c91d04f6e8a7b3c2d1e0f9a8b7c6d3f2c";
/** The view-as example: an account with live testnet positions. */
export const EXAMPLE_ADDRESS = "0xdc0054d9962fb4adf760f669dc3e02c07aa5af95";

const DAY = 86_400_000;

function sampleLine(id: string, layer: BalanceLine["layer"], account: BalanceLine["account"], asset: string, amount: number, priceUsd: number, underlying: string, note: string | null = null): BalanceLine {
  const network = layer === "hypercore" ? "hypercore-testnet" : layer === "hyperevm" ? "hyperevm-testnet" : "elysium-testnet";
  return { id, layer, account, network, asset, assetId: null, amount: String(amount), priceUsd, usd: amount * priceUsd, underlying, underlyingAmount: amount, locked: null, note };
}

const HYPE = 40;

const POSITIONS: readonly PerpPositionView[] = [
  { id: "|HYPE", dex: "", coin: "HYPE", side: "long", size: "310", szi: "310", entryPx: "36.2", markPx: 40, positionValue: 12_400, unrealizedPnl: 1178, roePct: 31.4, leverage: { type: "cross", value: 3 }, maxLeverage: 5, liquidationPx: "26.8", liquidationDistancePct: 33, liquidationRisk: "safe", marginUsed: 4133, fundingSinceOpen: 42, fundingAllTime: 120, positionValueUsd: 12_400 },
  { id: "|ETH", dex: "", coin: "ETH", side: "long", size: "2.2", szi: "2.2", entryPx: "3950", markPx: 4072, positionValue: 8_958, unrealizedPnl: 268, roePct: 15.4, leverage: { type: "isolated", value: 5 }, maxLeverage: 25, liquidationPx: "3298", liquidationDistancePct: 19, liquidationRisk: "safe", marginUsed: 1792, fundingSinceOpen: -18, fundingAllTime: -40, positionValueUsd: 8_958 },
  { id: "|FARTCOIN", dex: "", coin: "FARTCOIN", side: "short", size: "1840", szi: "-1840", entryPx: "1.00", markPx: 1.06, positionValue: 1_950, unrealizedPnl: -110, roePct: -16.9, leverage: { type: "isolated", value: 3 }, maxLeverage: 5, liquidationPx: "1.124", liquidationDistancePct: 6, liquidationRisk: "watch", marginUsed: 650, fundingSinceOpen: 22, fundingAllTime: 22, positionValueUsd: 1_950 },
];

const LINES = {
  hypercore: [
    sampleLine("s|perp", "hypercore", "perp", "USDC", 9_420, 1, "USD", "Perps: account value incl. unrealized PnL of 3 position(s)"),
    sampleLine("s|hlp", "hypercore", "vault", "HLP vault", 1_410, 1, "USD"),
    sampleLine("s|staked", "hypercore", "staking", "HYPE", 27.8, HYPE, "HYPE", "Delegated 27.8, undelegated 0, pending withdrawal 2.5 (1)"),
    sampleLine("s|purr-dust", "hypercore", "spot", "PURR", 14, 0.12, "PURR"),
    sampleLine("s|jeff-dust", "hypercore", "spot", "JEFF", 2.1, 1.3, "JEFF"),
  ],
  hyperevm: [sampleLine("s|khype", "hyperevm", "wallet", "kHYPE", 147, HYPE * 1.0273, "HYPE"), sampleLine("s|usdc-r", "hyperevm", "wallet", "USDC", 2_600, 1, "USD"), sampleLine("s|gas-r", "hyperevm", "wallet", "HYPE", 0.42, HYPE, "HYPE")],
  elysium: [
    sampleLine("s|usdc-s", "elysium", "wallet", "USDC", 4_180, 1, "USD"),
    sampleLine("s|lp", "elysium", "wallet", "WHYPE/USDC LP", 1, 2_880, "USD", "Kalos V3"),
    sampleLine("s|purr-s", "elysium", "wallet", "PURR", 9_150, 0.1241, "PURR"),
    sampleLine("s|gas-s", "elysium", "wallet", "HYPE", 0.02, HYPE, "HYPE"),
  ],
};

const sum = (lines: readonly BalanceLine[]) => lines.reduce((total, entry) => total + (entry.usd ?? 0), 0);

export function sampleSnapshot(now: number): PortfolioSnapshot {
  const byLayer = { hypercore: sum(LINES.hypercore), hyperevm: sum(LINES.hyperevm), elysium: sum(LINES.elysium) };
  const layer = (name: keyof typeof LINES) => ({ layer: name, status: "ok" as const, totalUsd: byLayer[name], unpricedLines: 0, lines: LINES[name], sources: [] });
  return {
    address: SAMPLE_ADDRESS,
    mode: "testnet",
    generatedAt: now,
    pricing: { source: "hypercore-mainnet-reference" as PortfolioSnapshot["pricing"]["source"], label: "reference", time: now, khypeToHype: 1.0273 },
    totals: { netWorthUsd: byLayer.hypercore + byLayer.hyperevm + byLayer.elysium, byLayer, unpricedLines: 0, unrealizedPnlUsd: 1336, grossPerpNotionalUsd: 23_308 },
    layers: [layer("hypercore"), layer("hyperevm"), layer("elysium")],
    positions: POSITIONS,
    accounts: [],
    exposure: [
      { underlying: "USD", perp: 0, spot: 20_490, lst: 0, net: 20_490, priceUsd: 1, netUsd: 20_490, isCash: true },
      { underlying: "HYPE", perp: 310, spot: 28.24, lst: 151, net: 489.2, priceUsd: HYPE, netUsd: 19_568, isCash: false },
      { underlying: "ETH", perp: 2.2, spot: 0, lst: 0, net: 2.2, priceUsd: 4072, netUsd: 8_958, isCash: false },
      { underlying: "FARTCOIN", perp: -1840, spot: 0, lst: 0, net: -1840, priceUsd: 1.06, netUsd: -1_950, isCash: false },
      { underlying: "PURR", perp: 0, spot: 9_164, lst: 0, net: 9_164, priceUsd: 0.1241, netUsd: 1_137, isCash: false },
    ],
    dexes: [],
    notes: ["Sample range: not anyone's money."],
  };
}

export function sampleRopes(): RopeView[] {
  const ropes: Rope[] = POSITIONS.map((position) => {
    const mark = position.markPx;
    const liq = Number(position.liquidationPx);
    const tp = position.coin === "ETH" ? { px: 4600, oid: 1, wholePosition: true } : position.coin === "FARTCOIN" ? { px: 0.82, oid: 2, wholePosition: true } : null;
    const sl = position.coin === "ETH" ? { px: 3600, oid: 3, wholePosition: true } : null;
    const distance = Math.abs(mark - liq) / mark;
    return {
      coin: position.coin,
      dex: "",
      side: position.side,
      size: Number(position.size),
      entryPx: Number(position.entryPx),
      markPx: mark,
      liquidationPx: liq,
      tp,
      sl,
      distance,
      band: distance < 0.05 ? "critical" : distance < 0.1 ? "danger" : distance < 0.25 ? "watch" : "safe",
      grade: position.leverage.value <= 5 ? "T3" : "T4",
      leverage: position.leverage.value,
      leverageType: position.leverage.type,
      positionValue: position.positionValue,
      unrealizedPnl: position.unrealizedPnl,
      roe: position.roePct / 100,
      toStop: sl ? (mark - sl.px) / mark : null,
      toTarget: tp ? Math.abs(tp.px - mark) / mark : null,
      stopBeyondLiquidation: false,
    };
  });
  return ropes.map((rope) => ({ ...rope, layout: ropeLayout(rope) }));
}

export function sampleHistory(now: number): PortfolioHistory {
  const random = seededRandom(35);
  const start = now - 35 * DAY;
  const curve: (readonly [number, number])[] = [];
  let value = 39_449;
  for (let index = 0; index <= 35 * 4; index += 1) {
    const day = index / 4;
    const drift = day < 9 ? 45 : day < 14 ? -105 : day < 27 ? 90 : day < 31 ? -30 : 65;
    value = Math.max(30_000, value + drift + (random() - 0.5) * 260);
    if (index === 16) value += 5_000;
    curve.push([start + index * (DAY / 4), value]);
  }
  curve[curve.length - 1] = [now, 48_213];
  const slice = (days: number) => curve.filter(([t]) => t >= now - days * DAY);
  const pnl = curve.map(([t, v]) => [t, v - 39_449] as const);
  const timeline: TimelineEvent[] = [];
  const coins = ["HYPE", "ETH", "FARTCOIN"] as const;
  for (let day = 34; day >= 0; day -= 1) {
    const t = now - day * DAY - 3_600_000 * (3 + (day % 7));
    const coin = coins[day % 3]!;
    const closed = (random() - 0.42) * 420;
    timeline.push({ kind: "funding", id: `sf${day}`, time: t + 1800_000, coin, usdc: (random() - 0.6) * 18, szi: "1", fundingRate: "0.0000125", samples: 24 });
    if (day % 2 === 0) {
      timeline.push({ kind: "fill", id: `sx${day}`, time: t, hash: "0x", coin, side: closed > 0 ? "sell" : "buy", dir: closed > 0 ? "Close Long" : "Open Long", px: coin === "ETH" ? "4012" : coin === "HYPE" ? "38.4" : "1.02", sz: coin === "ETH" ? "0.4" : "50", notional: 1_600, fee: 0.72, feeToken: "USDC", builderFee: null, closedPnl: closed > 0 ? closed : 0, oid: day, tid: day, crossed: true, liquidation: false });
    }
  }
  timeline.push({ kind: "ledger", id: "sl1", time: start + 4 * DAY, hash: "0x", type: "deposit", usdc: 5_000, token: "USDC", amount: "5000", summary: "Deposit 5000 USDC" });
  timeline.push({ kind: "fill", id: "so1", time: start + 18 * DAY, hash: "0x", coin: "HYPE", side: "buy", dir: "Open Long", px: "36.2", sz: "310", notional: 11_222, fee: 5.05, feeToken: "USDC", builderFee: null, closedPnl: 0, oid: 900, tid: 900, crossed: true, liquidation: false });
  timeline.push({ kind: "fill", id: "so2", time: start + 29 * DAY, hash: "0x", coin: "ETH", side: "buy", dir: "Open Long", px: "3950", sz: "2.2", notional: 8_690, fee: 3.9, feeToken: "USDC", builderFee: null, closedPnl: 0, oid: 901, tid: 901, crossed: true, liquidation: false });
  timeline.sort((a, b) => b.time - a.time);
  const calendar = calendarFromTimeline(timeline);
  const totals = calendar.reduce((acc, day) => ({ realizedPnl: acc.realizedPnl + day.realizedPnl, fees: acc.fees + day.fees, funding: acc.funding + day.funding, net: acc.net + day.net, volume: acc.volume + day.volume }), { realizedPnl: 0, fees: 0, funding: 0, net: 0, volume: 0 });
  const ok = { status: "ok" as const, message: null, truncated: false, count: 0 };
  return {
    address: SAMPLE_ADDRESS,
    mode: "testnet",
    from: start,
    to: now,
    generatedAt: now,
    timeline,
    equity: {
      day: { accountValue: slice(1), pnl: [], volume: 0 },
      week: { accountValue: slice(7), pnl: [], volume: 0 },
      month: { accountValue: slice(30), pnl: [], volume: 0 },
      allTime: { accountValue: curve, pnl, volume: 0 },
    },
    calendar,
    totals,
    sections: { fills: ok, funding: ok, ledger: ok, equity: ok },
  };
}
