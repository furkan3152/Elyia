/**
 * The Rope (pure): one position as a pitch of rope. From the danger end to
 * the goal: crevasse (liquidation), anchor (stop), climber (mark), entry
 * tick, flag (take-profit). Longs climb with price, so price rises left to
 * right; shorts climb as price falls, so their axis runs the other way. The
 * visible rope between crevasse and climber is the liquidation distance.
 */

export type RopeSide = "long" | "short";
export type RopeMarkerKind = "crevasse" | "anchor" | "climber" | "entry" | "flag";
export type RopeState = "safe" | "fraying" | "critical" | "unroped";

export interface RopeInput {
  readonly side: RopeSide;
  readonly entry: number;
  readonly mark: number;
  readonly liquidation?: number | null;
  readonly stop?: number | null;
  readonly takeProfit?: number | null;
}

export interface RopeMarker {
  readonly kind: RopeMarkerKind;
  readonly price: number;
  /** Position on the rope, 0 = danger end, 1 = goal end. */
  readonly at: number;
  /** Signed distance from the mark as a fraction of the mark (-0.19 = 19% toward danger). */
  readonly fromMark: number;
}

export interface RopeGeometry {
  readonly side: RopeSide;
  readonly markers: readonly RopeMarker[];
  /** Fraction of the mark price to the liquidation price (null without one). */
  readonly distance: number | null;
  readonly state: RopeState;
  /** Under 10%: the rope frays (dashed). */
  readonly frays: boolean;
  /** Under 5%: it pulses slowly (at most 1 Hz). */
  readonly pulses: boolean;
  /** Prices at the two ends of the drawn rope. */
  readonly ends: readonly [number, number];
  /** No take-profit set: the goal end is open. */
  readonly openEnd: boolean;
}

export const FRAY_BELOW = 0.1;
export const PULSE_BELOW = 0.05;

const valid = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Liquidation distance as a fraction of the mark; 0 when already past it. */
export function ropeDistance(side: RopeSide, mark: number, liquidation: number | null | undefined): number | null {
  if (!valid(mark) || !valid(liquidation)) return null;
  const toward = side === "long" ? mark - liquidation : liquidation - mark;
  return Math.max(0, toward / mark);
}

export function ropeState(distance: number | null): RopeState {
  if (distance === null) return "unroped";
  if (distance < PULSE_BELOW) return "critical";
  if (distance < FRAY_BELOW) return "fraying";
  return "safe";
}

export function ropeGeometry(input: RopeInput): RopeGeometry {
  const { side, mark, entry } = input;
  const liquidation = valid(input.liquidation) ? input.liquidation : null;
  const stop = valid(input.stop) ? input.stop : null;
  const takeProfit = valid(input.takeProfit) ? input.takeProfit : null;
  const direction = side === "long" ? 1 : -1;
  // "progress" grows toward the goal for both sides
  const progress = (price: number) => direction * price;
  const distance = ropeDistance(side, mark, liquidation);

  const prices = [mark, entry, ...(liquidation !== null ? [liquidation] : []), ...(stop !== null ? [stop] : []), ...(takeProfit !== null ? [takeProfit] : [])].filter(valid);
  const progresses = prices.map(progress);
  let low = Math.min(...progresses);
  let high = Math.max(...progresses);
  const pad = Math.max(Math.abs(mark) * 0.02, (high - low) * 0.06);
  // Without a crevasse or a flag, leave visible slack on that side.
  if (liquidation === null) low -= Math.max(Math.abs(mark) * 0.1, pad * 3);
  if (takeProfit === null) high += Math.max(Math.abs(mark) * 0.1, pad * 3);
  low -= pad;
  high += pad;
  const at = (price: number) => (progress(price) - low) / (high - low || 1);
  const fromMark = (price: number) => (direction * (price - mark)) / mark;

  const markers: RopeMarker[] = [];
  if (liquidation !== null) markers.push({ kind: "crevasse", price: liquidation, at: at(liquidation), fromMark: fromMark(liquidation) });
  if (stop !== null) markers.push({ kind: "anchor", price: stop, at: at(stop), fromMark: fromMark(stop) });
  if (valid(entry)) markers.push({ kind: "entry", price: entry, at: at(entry), fromMark: fromMark(entry) });
  markers.push({ kind: "climber", price: mark, at: at(mark), fromMark: 0 });
  if (takeProfit !== null) markers.push({ kind: "flag", price: takeProfit, at: at(takeProfit), fromMark: fromMark(takeProfit) });
  markers.sort((a, b) => a.at - b.at);

  const state = ropeState(distance);
  const endLow = direction * low;
  const endHigh = direction * high;
  return {
    side,
    markers,
    distance,
    state,
    frays: state === "fraying" || state === "critical",
    pulses: state === "critical",
    ends: [endLow, endHigh],
    openEnd: takeProfit === null,
  };
}
