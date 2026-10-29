/**
 * Swap model (pure): where you can swap on each layer, the planner action
 * for a swap, and the price altitude: a log-scale reading of each venue's
 * implied HYPE price next to the HyperCore mainnet reference.
 *
 * Venues (the same list the API engine uses):
 * - Summit (Elysium testnet): Kalos V3 (canonical WHYPE/USDC, 2% tier) and
 *   Dex Da Costa (Uniswap V2; wraps HYPE into its own WETH);
 * - Ridge (HyperEVM testnet): HyperSwap V3;
 * - Floor (HyperCore): the spot order book, traded in the terminal.
 *
 * Testnet pool prices are not market prices: test USDC is unbacked
 * (Kalos ≈ 20,850 test-USDC per HYPE). USD values always come from the
 * HyperCore mainnet mids, labelled "reference price".
 */
import type { IntentActionSpec } from "@elyia/core/intent";
import { layersFor, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";

import type { Layer } from "../../topo/geometry/relief";

export type SwapLayer = Layer;
export type SwapToken = "HYPE" | "USDC";

export interface SwapVenue {
  readonly id: string;
  readonly label: string;
  readonly note: string;
}

export const VENUES: Readonly<Record<SwapLayer, readonly SwapVenue[]>> = {
  summit: [
    { id: "kalos-v3", label: "Kalos V3", note: "canonical WHYPE/USDC · 2% pool" },
    { id: "dex-da-costa", label: "Dex Da Costa", note: "Uniswap V2 · own wrapped HYPE" },
  ],
  ridge: [{ id: "hyperswap-v3", label: "HyperSwap V3", note: "SwapRouter02 + QuoterV2" }],
  floor: [{ id: "hypercore-spot", label: "HyperCore book", note: "HYPE/USDC spot, in the terminal" }],
};

export function swapNetwork(layer: SwapLayer, mode: NetworkEnvironment): NetworkKey {
  const layers = layersFor(mode);
  return layer === "summit" ? layers.elysium.key : layer === "ridge" ? layers.hyperevm.key : layers.hypercore.key;
}

export const SLIPPAGE_CHOICES = [30, 50, 100, 200] as const;
export type SlippageBps = (typeof SLIPPAGE_CHOICES)[number];

export function swapAction(input: { readonly layer: SwapLayer; readonly from: SwapToken; readonly amount: string; readonly venue: string | null; readonly mode: NetworkEnvironment }): IntentActionSpec {
  const to: SwapToken = input.from === "HYPE" ? "USDC" : "HYPE";
  return {
    kind: "swap",
    network: swapNetwork(input.layer, input.mode),
    from: input.from,
    to,
    amount: input.amount,
    ...(input.venue ? { protocol: input.venue } : {}),
  };
}

export function swapSentence(layer: SwapLayer, from: SwapToken, amount: string, venue: string | null): string {
  const to = from === "HYPE" ? "USDC" : "HYPE";
  const where = layer === "summit" ? "on Elysium" : layer === "ridge" ? "on HyperEVM" : "on HyperCore";
  const via = venue ? ` via ${VENUES[layer].find((item) => item.id === venue)?.label ?? venue}` : "";
  return `swap ${amount || "…"} ${from} to ${to} ${where}${via}`;
}

/**
 * Implied USDC per HYPE of a quote: `out / in` for HYPE -> USDC, `in / out`
 * for USDC -> HYPE. Null when either side is zero or unreadable.
 */
export function impliedHypePrice(from: SwapToken, amountIn: number, amountOut: number): number | null {
  if (!(amountIn > 0) || !(amountOut > 0)) return null;
  return from === "HYPE" ? amountOut / amountIn : amountIn / amountOut;
}

/** How many times a price sits above (or below) the reference: 434 means "434x". */
export function distortion(price: number, reference: number): number | null {
  if (!(price > 0) || !(reference > 0)) return null;
  return price / reference;
}

/* ------------------------------------------------- the price altitude */

export const ALTITUDE_DECADES = [0, 1, 2, 3, 4, 5] as const; // $1 … $100k

/** Height fraction (0 bottom … 1 top) of a price on the log scale $1 … $100k. */
export function altitudeOf(price: number): number {
  if (!(price > 0)) return 0;
  const decade = Math.log10(price);
  return Math.min(1, Math.max(0, decade / ALTITUDE_DECADES[ALTITUDE_DECADES.length - 1]!));
}

export function decadeLabel(decade: number): string {
  const value = 10 ** decade;
  return value >= 1000 ? `$${value / 1000}k` : `$${value}`;
}

export interface AltitudeMark {
  readonly id: string;
  readonly label: string;
  readonly price: number;
  readonly kind: "reference" | "pool" | "book";
  readonly detail: string;
}

/**
 * Spreads marks vertically so their labels never overlap: each keeps its
 * true tick at `y`, and its label moves to `labelY` at least `gap` apart.
 */
export function placeMarks(marks: readonly AltitudeMark[], height: number, gap: number): Array<AltitudeMark & { readonly y: number; readonly labelY: number }> {
  const placed = marks
    .map((mark) => ({ ...mark, y: height - altitudeOf(mark.price) * height }))
    .sort((a, b) => a.y - b.y)
    .map((mark) => ({ ...mark, labelY: mark.y }));
  for (let index = 1; index < placed.length; index += 1) {
    const previous = placed[index - 1]!;
    const current = placed[index]!;
    if (current.labelY - previous.labelY < gap) placed[index] = { ...current, labelY: previous.labelY + gap };
  }
  // Push back up if the last label fell off the bottom.
  const overflow = (placed.at(-1)?.labelY ?? 0) - height;
  if (overflow > 0) {
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const current = placed[index]!;
      const limit = index === placed.length - 1 ? height : placed[index + 1]!.labelY - gap;
      placed[index] = { ...current, labelY: Math.min(current.labelY, limit) };
    }
  }
  return placed;
}
