/**
 * SAMPLE data for the map key (/system). Documentation, never data: every
 * surface that shows it says "sample".
 */
import type { RadioEntry } from "../../topo/RadioLog";
import type { RegisterRow } from "../../topo/SummitRegister";
import type { RouteStep } from "../../topo/RouteCard";
import type { ProfileCamp, ProfilePoint } from "../../topo/geometry/profile";
import type { ReliefHolding } from "../../topo/geometry/relief";
import type { ShockPosition } from "../../topo/geometry/shock";
import { seededRandom } from "../../motion/tokens";

export const SAMPLE_HOLDINGS: readonly ReliefHolding[] = [
  { id: "hype", symbol: "HYPE", usd: 12400, layer: "floor", side: "long", leverage: 3, note: "rope 33%" },
  { id: "eth", symbol: "ETH", usd: 8960, layer: "floor", side: "long", leverage: 5, note: "rope 19%" },
  { id: "fart", symbol: "FARTCOIN", usd: 1950, layer: "floor", side: "short", leverage: 3, note: "rope 6%" },
  { id: "hlp", symbol: "HLP vault", usd: 1410, layer: "floor" },
  { id: "staked", symbol: "Staked HYPE", usd: 1112, layer: "floor" },
  { id: "khype", symbol: "kHYPE", usd: 6040, layer: "ridge", note: "×1.0273" },
  { id: "usdc-r", symbol: "USDC", usd: 2600, layer: "ridge" },
  { id: "usdc-s", symbol: "USDC", usd: 4180, layer: "summit" },
  { id: "lp", symbol: "WHYPE/USDC LP", usd: 2880, layer: "summit", note: "Kalos V3" },
  { id: "purr", symbol: "PURR", usd: 1136, layer: "summit" },
];

export const SAMPLE_STEPS: readonly RouteStep[] = [
  { id: "w1", layer: "floor", toLayer: "ridge", action: "send", venue: "HyperCore", inOut: "1,000 USDC → exact", fee: "$0.00", eta: "2 s", state: "settled", block: "41,077,288", time: "14:02:11" },
  { id: "w2", layer: "ridge", action: "swap", venue: "HyperSwap V3", inOut: "500 USDC → 11.94 HYPE", fee: "$0.25", eta: "1 s", state: "settled", block: "41,077,312", time: "14:02:13" },
  { id: "w3", layer: "ridge", action: "stake", venue: "Kinetiq", inOut: "11.94 HYPE → 11.62 kHYPE", fee: "$0.00", eta: "1 s", state: "climbing" },
  { id: "w4", layer: "ridge", toLayer: "summit", action: "ascend", venue: "canonical", inOut: "500 USDC + 0.3 HYPE gas", fee: "~$0.04", eta: "~3 min", state: "next" },
  { id: "w5", layer: "summit", action: "pool", venue: "Kalos V3 ±12%", inOut: "250 → WHYPE, mint LP", fee: "$5.00", eta: "1 s", state: "waiting" },
];

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 24);

export const SAMPLE_EQUITY: readonly ProfilePoint[] = (() => {
  const random = seededRandom(35);
  const points: ProfilePoint[] = [];
  let value = 39_449;
  for (let day = 0; day <= 35; day += 1) {
    const drift = day < 9 ? 180 : day < 14 ? -420 : day < 27 ? 360 : day < 31 ? -120 : 260;
    value = Math.max(30_000, value + drift + (random() - 0.5) * 900);
    if (day === 4) value += 5_000;
    points.push({ t: START + day * DAY, value });
  }
  points[points.length - 1] = { t: START + 35 * DAY, value: 48_213 };
  return points;
})();

export const SAMPLE_CAMPS: readonly ProfileCamp[] = [
  { t: START + 4 * DAY, label: "CAMP I · +5k USDC" },
  { t: START + 18 * DAY, label: "CAMP II · HYPE 3× opened" },
  { t: START + 29 * DAY, label: "CAMP III · ETH 5× long" },
];

export const SAMPLE_SHOCK: readonly ShockPosition[] = [
  { id: "hype", symbol: "HYPE 3× long", side: "long", size: 310, mark: 40, liquidation: 26.8, beta: 1 },
  { id: "eth", symbol: "ETH 5× long", side: "long", size: 2.2, mark: 4072, liquidation: 3298, beta: 0.7 },
  { id: "fart", symbol: "FARTCOIN 3× short", side: "short", size: 1840, mark: 1.06, liquidation: 1.124, beta: 1.4 },
];

export const SAMPLE_RADIO: readonly RadioEntry[] = [
  { id: "r1", at: "13:12:40", from: "GUIDE", to: "you", message: "ETH funding flipped, your long now pays 11% APR" },
  { id: "r2", at: "13:40:02", from: "ALERT", message: "FARTCOIN rope 6%, fraying", tone: "alert" },
  { id: "r3", at: "14:02:07", from: "GUIDE", to: "you", message: "route 7F3A planned, quote bound" },
  { id: "r4", at: "14:02:11", from: "FLOOR", message: "W1 settled · 1,000 USDC on the Ridge", tone: "settled" },
  { id: "r5", at: "14:02:13", from: "RIDGE", message: "W2 settled · 11.94 HYPE · tx 0x5e1c…9a04", tone: "settled" },
  { id: "r6", at: "14:02:14", from: "RIDGE", message: "W3 in block · awaiting receipt", live: true },
];

export const SAMPLE_REGISTER: readonly RegisterRow[] = [
  { id: "g1", when: "29 OCT 14:02", entry: "Sent 1,000 USDC from the Floor to the Ridge", layer: "floor", amount: "1,000 USDC", direction: "down", proof: { label: "hc:nonce:1730…531", href: "https://app.hyperliquid-testnet.xyz/explorer" } },
  { id: "g2", when: "29 OCT 14:02", entry: "Swapped 500 USDC for 11.94 HYPE on HyperSwap", layer: "ridge", amount: "11.94 HYPE", direction: "up", proof: { label: "0x5e1c…9a04", href: "https://testnet.purrsec.com" } },
  { id: "g3", when: "29 OCT 13:40", entry: "Opened FARTCOIN 3× short", layer: "floor", amount: "1,950 USD", direction: "down" },
  { id: "g4", when: "28 OCT 09:00", entry: "TWAP bought 10 HYPE (the Friday route)", layer: "floor", amount: "10 HYPE", direction: "up", proof: { label: "hc:cloid:0x9f…", href: "https://app.hyperliquid-testnet.xyz/explorer" } },
];
