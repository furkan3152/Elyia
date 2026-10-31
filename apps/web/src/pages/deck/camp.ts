/**
 * How base camp reads the followed account (pure): Ely's state and the
 * line the deck prints under the scene. Ely is purposeful: worried only
 * when a rope is under 10% to the crevasse, asleep only when there is
 * nothing on any layer, crowned only at a new high.
 */
import type { ElyState } from "../../pixel/states";

export type CampMood = "loading" | "sample" | "empty" | "worry" | "summit" | "watch" | "calm";

export interface CampInput {
  readonly loading: boolean;
  readonly sample: boolean;
  /** Watching someone else's address (read only). */
  readonly watching: boolean;
  readonly netWorthUsd: number;
  readonly positions: number;
  /** Ropes: coin and fraction to liquidation (null: no crevasse). */
  readonly ropes: readonly { readonly coin: string; readonly distance: number | null }[];
  /** The month's equity values, oldest first (for "a new high"). */
  readonly equity: readonly number[];
}

export interface CampReading {
  readonly mood: CampMood;
  readonly ely: ElyState;
  /** The nearest fraying rope, when Ely worries. */
  readonly rope: { readonly coin: string; readonly distance: number } | null;
}

const EMPTY_USD = 1;

export function campReading(input: CampInput): CampReading {
  if (input.loading) return { mood: "loading", ely: "climb", rope: null };
  const fraying = input.ropes
    .filter((rope): rope is { coin: string; distance: number } => rope.distance !== null && rope.distance < 0.1)
    .sort((a, b) => a.distance - b.distance)[0];
  if (input.sample) return { mood: "sample", ely: fraying ? "worry" : "idle", rope: fraying ?? null };
  if (input.netWorthUsd < EMPTY_USD && input.positions === 0) return { mood: "empty", ely: "sleep", rope: null };
  if (fraying) return { mood: "worry", ely: "worry", rope: fraying };
  const values = input.equity;
  if (values.length >= 2) {
    const last = values[values.length - 1]!;
    const before = Math.max(...values.slice(0, -1));
    if (last > before && last > 0) return { mood: "summit", ely: "summit", rope: null };
  }
  if (input.watching) return { mood: "watch", ely: "watch", rope: null };
  return { mood: "calm", ely: "idle", rope: null };
}
