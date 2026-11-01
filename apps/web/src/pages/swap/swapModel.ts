/**
 * Swap model (pure): where you can swap on each layer, the planner action
 * for a swap, and the price altitude: a log-scale reading of each venue's
 * implied HYPE price next to the HyperCore mainnet reference.
 *
 * Venues (the same list the API engine uses):
 * - Summit (Elysium testnet): Kalos V3 (canonical WHYPE/USDC, 2% tier),
 *   Dex Da Costa (Uniswap V2; wraps HYPE into its own WETH), PerpMe V3
 *   (its own WHYPE / PERPME launch pool) and HexSwap (its own HEX pair);
 * - Ridge (HyperEVM testnet): HyperSwap V3 (pools exist, empty today);
 * - Floor (HyperCore): the spot order book, traded in the terminal.
 *
 * Each venue is probed with a pair it actually holds (`VenueProbe`, from
 * GET /v1/venues, pinned below when the catalog is down): only HYPE/USDC
 * probes give a USD-comparable price; the others report what they fill.
 *
 * Testnet pool prices are not market prices: test USDC is unbacked
 * (Kalos ≈ 20,850 test-USDC per HYPE). USD values always come from the
 * HyperCore mainnet mids, labelled "reference price".
 */
import type { VenueProbe } from "@elyia/core/api/intents";
import type { IntentActionSpec } from "@elyia/core/intent";
import { layersFor, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";

import type { Layer } from "../../topo/geometry/relief";

export type SwapLayer = Layer;
export type SwapToken = "HYPE" | "USDC";

export interface SwapVenue {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly explicitOnly?: boolean;
  readonly probe?: VenueProbe;
}

/** Pinned fallback when the venue catalog (GET /v1/venues) cannot be read (the API's pins, apps/api/src/engine/venues.ts). */
export const VENUES: Readonly<Record<SwapLayer, readonly SwapVenue[]>> = {
  summit: [
    { id: "kalos-v3", label: "Kalos V3", note: "canonical WHYPE/USDC · 2% pool", probe: { from: "HYPE", to: "USDC", toSymbol: "USDC", amount: "1", pair: "HYPE/USDC", verified: true, liquid: true, note: "canonical WHYPE/USDC 2% pool 0x591a…b05c", checked: "2026-11-01" } },
    { id: "dex-da-costa", label: "Dex Da Costa", note: "Uniswap V2 · own wrapped HYPE", probe: { from: "HYPE", to: "USDC", toSymbol: "USDC", amount: "1", pair: "HYPE/USDC", verified: true, liquid: true, note: "WETH/USDC pair 0xfb3a…746a (its own wrapped HYPE)", checked: "2026-11-01" } },
    { id: "perpme", label: "PerpMe V3", note: "launch pools · own WHYPE", explicitOnly: true, probe: { from: "HYPE", to: "0xd089ff84573e35626aae2cc92d1acfc4b3e225e1", toSymbol: "PERPME", amount: "0.01", pair: "HYPE/PERPME", verified: false, liquid: true, note: "PerpMe's own WHYPE / PERPME launch pool (no HYPE/USDC pool)", checked: "2026-11-01" } },
    { id: "hexswap", label: "HexSwap", note: "Uniswap V2 · own test tokens", explicitOnly: true, probe: { from: "HYPE", to: "0x26aa352bd4324aa507c924af9edd65b2c7bdc1c2", toSymbol: "HEX", amount: "0.01", pair: "HYPE/HEX", verified: false, liquid: true, note: "HEX/WNATIVE pair, HexSwap's own test token (no HYPE/USDC pool)", checked: "2026-11-01" } },
  ],
  ridge: [{ id: "hyperswap-v3", label: "HyperSwap V3", note: "SwapRouter02 + QuoterV2", probe: { from: "HYPE", to: "USDC", toSymbol: "USDC", amount: "0.05", pair: "HYPE/USDC", verified: true, liquid: false, note: "WETH/USDC 0.05% and 1% pools exist but read liquidity() = 0", checked: "2026-11-01" } }],
  floor: [{ id: "hypercore-spot", label: "HyperCore book", note: "HYPE/USDC spot, in the terminal" }],
};

/** The probe of a venue: its own pair, else 1 HYPE -> USDC (a catalog row without one). */
export function probeOf(venue: Pick<SwapVenue, "id" | "probe">): VenueProbe {
  return venue.probe ?? { from: "HYPE", to: "USDC", toSymbol: "USDC", amount: "1", pair: "HYPE/USDC", verified: true, liquid: true, note: "HYPE/USDC", checked: "" };
}

/** The dry-run action that quotes a venue with its probe pair (named venue, so venue-specific tokens resolve). */
export function probeAction(venue: Pick<SwapVenue, "id" | "probe">, layer: SwapLayer, mode: NetworkEnvironment): IntentActionSpec {
  const probe = probeOf(venue);
  return { kind: "swap", network: swapNetwork(layer, mode), from: probe.from, to: probe.to, amount: probe.amount, protocol: venue.id };
}

/** Whether a probe's price reads as HYPE in USDC (the price altitude plots only those). */
export function probeIsUsd(probe: VenueProbe): boolean {
  return probe.from === "HYPE" && probe.toSymbol === "USDC";
}

/** What a probe dry run said, reduced to what the page shows. */
export type ProbeResult =
  | { readonly kind: "quoted"; readonly out: number; readonly fake: boolean }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "pending" }
  | { readonly kind: "offline" };

function amountText(value: number): string {
  if (!(value > 0)) return "0";
  if (value >= 1000) return Math.round(value).toLocaleString("en-US");
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

export interface ProbeView {
  readonly pair: string;
  /** Short, for the signpost: "0.01 HYPE → 46,797 PERPME", "no liquidity". */
  readonly result: string;
  /** One line: what the pair is and why it was picked. */
  readonly note: string;
  /** The venue filled its probe. */
  readonly ok: boolean;
  /** No answer yet. */
  readonly pending: boolean;
  /** The pins already said the pools were empty (HyperSwap testnet today). */
  readonly knownEmpty: boolean;
}

export function probeView(venue: Pick<SwapVenue, "id" | "probe">, result: ProbeResult): ProbeView {
  const probe = probeOf(venue);
  const base = { pair: probe.pair, knownEmpty: !probe.liquid, pending: result.kind === "pending" };
  const note = `${probe.note}${probe.verified ? "" : ` · ${probe.toSymbol} is unverified and unpriced`}${probe.checked ? ` · read ${probe.checked}` : ""}`;
  switch (result.kind) {
    case "quoted":
      return { ...base, ok: true, note, result: `${probe.amount} ${probe.from} → ${amountText(result.out)} ${probe.toSymbol}${result.fake ? " · fake price" : ""}` };
    case "refused":
      return { ...base, ok: false, note: `${note} · ${result.message}`, result: probe.liquid ? `no ${probe.pair} liquidity now` : "no liquidity today" };
    case "pending":
      return { ...base, ok: false, note, result: "quoting…" };
    case "offline":
      return { ...base, ok: false, note, result: "planner offline" };
  }
}

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

export function swapSentence(layer: SwapLayer, from: SwapToken, amount: string, venue: string | null, venueLabel?: string): string {
  const to = from === "HYPE" ? "USDC" : "HYPE";
  const where = layer === "summit" ? "on Elysium" : layer === "ridge" ? "on HyperEVM" : "on HyperCore";
  const via = venue ? ` via ${venueLabel ?? VENUES[layer].find((item) => item.id === venue)?.label ?? venue}` : "";
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
  /** `none`: a venue that quoted nothing for this pair (drawn as a survey stake, never a price). */
  readonly kind: "reference" | "pool" | "book" | "none";
  readonly detail: string;
  /** Slot text of a `none` stake (default "no pool"). */
  readonly none?: string;
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
