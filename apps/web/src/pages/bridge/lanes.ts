/**
 * The bridge lanes (pure): every way value moves between the three layers,
 * with the facts that matter for each:
 *
 * - up to the Summit: the canonical Orbit bridge. HYPE is a kind-12 deposit
 *   (≈1–2 min, same address credited); an ERC-20 travels as a retryable
 *   ticket, and 5 of 6 live testnet tickets needed a manual redeem;
 * - down to the Ridge: withdraw on Elysium, wait for the rollup to confirm
 *   (testnet `confirmPeriodBlocks` 10 ≈ 30 min with the assertion cadence;
 *   mainnet 483,840 HyperEVM blocks ≈ 5 d 14 h), then claim on HyperEVM;
 * - down to the Floor: HyperEVM -> HyperCore through the CoreDepositWallet
 *   (USDC) or the system address 0x2222…2222 (HYPE), seconds;
 * - up to the Ridge: HyperCore -> HyperEVM, a spotSend to the system address;
 * - spot <-> perps on the Floor: usdClassTransfer, seconds.
 */
import type { IntentActionSpec } from "@elyia/core/intent";
import { layersFor, type NetworkEnvironment } from "@elyia/core/networks";

import type { Grade } from "../../topo/geometry/conditions";
import type { Layer } from "../../topo/geometry/relief";
import { withdrawalSeconds } from "../track/flow/orbit";
import type { Packs } from "../track/flow/usePacks";

export type LaneId = "up-summit" | "down-ridge" | "down-floor" | "up-ridge" | "to-perps" | "to-spot";
export type BridgeAsset = "HYPE" | "USDC";

export interface Lane {
  readonly id: LaneId;
  readonly from: Layer;
  readonly to: Layer;
  /** Signpost blade: "Up to the Summit". */
  readonly title: string;
  /** What carries you: "cable car", "the long trail". */
  readonly carrier: string;
  /** Short tag drawn on the section ("CABLE CAR"). */
  readonly tag: string;
  readonly assets: readonly BridgeAsset[];
  readonly grade: Grade;
  /** Testnet seconds per asset (the practice wall). */
  readonly seconds: (asset: BridgeAsset) => number;
  /** Mainnet seconds, when they differ in a way people must know. */
  readonly mainnetSeconds?: number;
  /** One line on how it works. */
  readonly how: (asset: BridgeAsset) => string;
  readonly signatures: (asset: BridgeAsset) => number;
}

/** Testnet rollup confirm period (core networks.ts, read on-chain 2026-10-29). */
export const TESTNET_CONFIRM_BLOCKS = 10;
/** Mainnet `confirmPeriodBlocks` (483,840 HyperEVM blocks). */
export const MAINNET_CONFIRM_BLOCKS = 483_840;
/** Of 6 live testnet retryable tickets, 5 were not auto-redeemed. */
export const TICKET_SURVEY = { tickets: 6, manual: 5 } as const;

export const LANES: readonly Lane[] = [
  {
    id: "up-summit",
    tag: "cable car",
    from: "ridge",
    to: "summit",
    title: "Up to the Summit",
    carrier: "cable car",
    assets: ["HYPE", "USDC"],
    grade: 1,
    seconds: (asset) => (asset === "HYPE" ? 120 : 180),
    how: (asset) =>
      asset === "HYPE"
        ? "Inbox.depositEth on HyperEVM; Elysium credits the same address in about two minutes."
        : "approve + L1GatewayRouter.outboundTransferCustomRefund; the USDC rides a retryable ticket that Elyia watches.",
    signatures: (asset) => (asset === "HYPE" ? 1 : 2),
  },
  {
    id: "down-ridge",
    tag: "long trail",
    from: "summit",
    to: "ridge",
    title: "Down to the Ridge",
    carrier: "the long trail",
    assets: ["HYPE", "USDC"],
    grade: 2,
    seconds: () => withdrawalSeconds(TESTNET_CONFIRM_BLOCKS),
    mainnetSeconds: withdrawalSeconds(MAINNET_CONFIRM_BLOCKS),
    how: (asset) =>
      asset === "HYPE"
        ? "ArbSys.withdrawEth on Elysium, then claim on HyperEVM once the rollup confirms."
        : "L2GatewayRouter.outboundTransfer on Elysium, then claim on HyperEVM once the rollup confirms.",
    signatures: () => 2,
  },
  {
    id: "down-floor",
    tag: "core link ↓",
    from: "ridge",
    to: "floor",
    title: "Down to the Floor",
    carrier: "the Core link",
    assets: ["USDC", "HYPE"],
    grade: 1,
    seconds: () => 10,
    how: (asset) => (asset === "USDC" ? "approve + CoreDepositWallet.deposit: USDC lands as HyperCore margin." : "A plain transfer to the system address 0x2222…2222: HYPE lands on HyperCore spot."),
    signatures: (asset) => (asset === "USDC" ? 2 : 1),
  },
  {
    id: "up-ridge",
    tag: "core link ↑",
    from: "floor",
    to: "ridge",
    title: "Up to the Ridge",
    carrier: "the Core link",
    assets: ["USDC", "HYPE"],
    grade: 1,
    seconds: () => 15,
    how: () => "spotSend to the system address, signed by your wallet; HyperEVM credits the same address.",
    signatures: () => 1,
  },
  {
    id: "to-perps",
    tag: "spot → perps",
    from: "floor",
    to: "floor",
    title: "Spot → perps",
    carrier: "a traverse",
    assets: ["USDC"],
    grade: 1,
    seconds: () => 3,
    how: () => "usdClassTransfer, signed by your wallet: USDC moves from spot to perp margin.",
    signatures: () => 1,
  },
  {
    id: "to-spot",
    tag: "perps → spot",
    from: "floor",
    to: "floor",
    title: "Perps → spot",
    carrier: "a traverse",
    assets: ["USDC"],
    grade: 1,
    seconds: () => 3,
    how: () => "usdClassTransfer, signed by your wallet: withdrawable perp margin moves to spot.",
    signatures: () => 1,
  },
];

export function laneById(id: string | null | undefined): Lane | null {
  return LANES.find((lane) => lane.id === id) ?? null;
}

/** The planner action for a lane. */
export function laneAction(lane: Lane, asset: BridgeAsset, amount: string, mode: NetworkEnvironment): IntentActionSpec {
  const layers = layersFor(mode);
  switch (lane.id) {
    case "up-summit":
      return { kind: "bridge", network: layers.hyperevm.key, toNetwork: layers.elysium.key, from: asset, amount };
    case "down-ridge":
      return { kind: "bridge", network: layers.elysium.key, toNetwork: layers.hyperevm.key, from: asset, amount };
    case "down-floor":
      return { kind: "link", network: layers.hyperevm.key, toNetwork: layers.hypercore.key, from: asset, amount };
    case "up-ridge":
      return { kind: "link", network: layers.hypercore.key, toNetwork: layers.hyperevm.key, from: asset, amount };
    case "to-perps":
      return { kind: "margin", network: layers.hypercore.key, from: "USDC", amount, params: { toPerp: true } };
    case "to-spot":
      return { kind: "margin", network: layers.hypercore.key, from: "USDC", amount, params: { toPerp: false } };
  }
}

const PLACE: Readonly<Record<Layer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };

/** The sentence on the route card ("bridge 0.5 HYPE to Elysium"). */
export function laneSentence(lane: Lane, asset: BridgeAsset, amount: string): string {
  const what = `${amount || "…"} ${asset}`;
  if (lane.id === "to-perps") return `move ${what} from spot to perps`;
  if (lane.id === "to-spot") return `move ${what} from perps to spot`;
  if (lane.id === "up-summit") return `bridge ${what} to Elysium`;
  if (lane.id === "down-ridge") return `withdraw ${what} from Elysium to HyperEVM`;
  return `move ${what} from ${PLACE[lane.from]} to ${PLACE[lane.to]}`;
}

/** The asset to show when a lane does not carry the current one. */
export function laneAsset(lane: Lane, wanted: BridgeAsset): BridgeAsset {
  return lane.assets.includes(wanted) ? wanted : lane.assets[0]!;
}

/** HYPE kept back for gas when you press Max on an EVM camp. */
const GAS_RESERVE = 0.01;

/** What you can move from the lane's starting camp. */
export function laneBalance(lane: Lane, asset: BridgeAsset, packs: Packs): number | null {
  if (lane.id === "to-spot") return packs.perps;
  const camp = packs[lane.from];
  const value = camp[asset];
  if (value === null) return null;
  return asset === "HYPE" && lane.from !== "floor" ? Math.max(0, value - GAS_RESERVE) : value;
}

