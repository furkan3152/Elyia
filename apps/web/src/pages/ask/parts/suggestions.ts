import type { GlyphName } from "../../../features/ely/draw";

export interface Suggestion {
  readonly glyph: GlyphName;
  readonly title: string;
  /** The sentence sent to Ely (shown on desktop). */
  readonly sentence: string;
  readonly layer: string;
  readonly short: string;
}

/** Sentences the API reads today (deterministic planner or the model): every one plans, protects or reads for real. */
export const SUGGESTIONS: readonly Suggestion[] = [
  { glyph: "swap", title: "Best-price swap", sentence: "Swap 50 HYPE to USDC on Elysium", layer: "Summit · Elysium", short: "Summit" },
  // Two chained steps: the swap spends half of what the bridge delivers (`after` + "max" + portionBps).
  { glyph: "peak", title: "Climb to the Summit", sentence: "Bridge 20 HYPE to Elysium and swap half to USDC", layer: "Ridge → Summit", short: "Ridge → Summit" },
  { glyph: "anchor", title: "Anchor my ropes", sentence: "Protect my positions", layer: "Floor · HyperCore", short: "Floor" },
  { glyph: "coin", title: "Wake idle cash", sentence: "Put my idle USDC to work", layer: "All layers", short: "All layers" },
];
