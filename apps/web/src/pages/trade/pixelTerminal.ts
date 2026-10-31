/**
 * Pure helpers behind the terminal's Pixel Survey pieces: whole-unit depth
 * bars, the leverage ridge's mood, the ascent (what Ely says after a send)
 * and the rope alarm (which ropes just slipped under 10%).
 */
import type { SubmitResult, TradePlan } from "../../features/trading/executor";

/** The pixel unit (CSS px). Depth bars and meters grow in whole units. */
export const PU = 4;

/** A bar `fraction` of `width` px wide, snapped to whole units (at least one unit when there is anything). */
export function unitWidth(fraction: number, width: number, unit = PU): number {
  if (!(fraction > 0) || !(width > 0)) return 0;
  const units = Math.round((Math.min(1, fraction) * width) / unit);
  return Math.max(1, units) * unit;
}

/** How many of `n` meter blocks the bid side fills (0..n; never empty or full while both sides hold size). */
export function balanceBlocks(bidShare: number, n = 20): number {
  if (!Number.isFinite(bidShare)) return Math.round(n / 2);
  const blocks = Math.round(Math.min(1, Math.max(0, bidShare)) * n);
  if (bidShare > 0 && bidShare < 1) return Math.min(n - 1, Math.max(1, blocks));
  return blocks;
}

/** Ely's mood on the leverage ridge. */
export type RidgeMood = "calm" | "steady" | "tense" | "worried";

/**
 * Leverage is altitude: low is calm, mountain grades make Ely steady then
 * tense, alpine grades (T5+) or the market's danger zone make Ely hold on.
 */
export function ridgeMood(grade: number, leverage: number, danger: number): RidgeMood {
  if (leverage >= danger || grade >= 5) return "worried";
  if (grade >= 4) return "tense";
  if (grade >= 3) return "steady";
  return "calm";
}

/** Where the slider's value sits along its track, 0..1. */
export function trackFraction(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** What Ely says after the trade button: climbing while it flies, then the outcome. */
export interface Ascent {
  /** Changes on every send, so a new stamp thumps once. */
  readonly id: number;
  readonly state: "climb" | "summit" | "rest" | "refused";
  /** The plan's own label ("Long 0.2991 ETH at market"). */
  readonly title: string;
  /** "0.2991 filled at 3,201.4", "resting on the book", the refusal. */
  readonly detail: string;
  /** Stamp word. */
  readonly stamp: string;
}

export function ascentClimbing(id: number, plan: Pick<TradePlan, "label">): Ascent {
  return { id, state: "climb", title: plan.label, detail: "Signed in this browser · on its way to HyperCore", stamp: "CLIMBING" };
}

/**
 * The outcome of a send in Ely's words. Null for a Rule Book "confirm": the
 * review dialog takes over and nothing was sent.
 */
export function ascentOf(id: number, plan: Pick<TradePlan, "label">, result: SubmitResult): Ascent | null {
  if (result.ok) {
    const filled = result.outcomes.filter((outcome) => outcome.kind === "filled");
    if (filled.length > 0) {
      const detail = filled.map((outcome) => (outcome.kind === "filled" ? `${outcome.totalSz} filled at ${outcome.avgPx}` : "")).join(" · ");
      return { id, state: "summit", title: plan.label, detail, stamp: "SUMMIT · FILLED" };
    }
    if (result.outcomes.some((outcome) => outcome.kind === "running")) return { id, state: "rest", title: plan.label, detail: "TWAP running: sliced every 30 s", stamp: "ON THE TRAIL" };
    const resting = result.outcomes.filter((outcome) => outcome.kind === "resting" || outcome.kind === "waiting").length;
    if (resting > 0) return { id, state: "rest", title: plan.label, detail: `${resting} order${resting === 1 ? "" : "s"} resting on the book`, stamp: "CAMP SET" };
    return { id, state: "summit", title: plan.label, detail: "Done", stamp: "SUMMIT · DONE" };
  }
  if (result.kind === "confirm") return null;
  return { id, state: "refused", title: plan.label, detail: result.message, stamp: result.kind === "blocked" ? "RULE BOOK" : "REFUSED" };
}

export interface RopeReading {
  readonly coin: string;
  /** |mark - liquidation| / mark, or null without a liquidation price. */
  readonly distance: number | null;
}

/** The rope alarm threshold (10% to the crevasse). */
export const ROPE_ALARM = 0.1;

/**
 * Ropes that just slipped under 10% (compared with the coins already under),
 * and the new "under" set. A rope must climb back above 12% before it can
 * alarm again, so a mark hovering at 10% does not chatter.
 */
export function ropeAlarms(readings: readonly RopeReading[], under: ReadonlySet<string>): { readonly fresh: readonly RopeReading[]; readonly under: ReadonlySet<string> } {
  const next = new Set<string>();
  const fresh: RopeReading[] = [];
  for (const reading of readings) {
    const d = reading.distance;
    if (d === null || !Number.isFinite(d)) continue;
    const was = under.has(reading.coin);
    if (d < ROPE_ALARM) {
      next.add(reading.coin);
      if (!was) fresh.push(reading);
    } else if (was && d < ROPE_ALARM * 1.2) {
      next.add(reading.coin);
    }
  }
  return { fresh, under: next };
}
