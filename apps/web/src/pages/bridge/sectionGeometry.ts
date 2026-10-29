/**
 * Geometry of the ascent section (pure): a cross-section of the range with
 * the three camps on their terraces (FLOOR, RIDGE, SUMMIT) and the lanes
 * between them, in one 640 x 400 viewBox. The terraces are the diagram, not
 * scenery: each camp is a layer, each lane a real bridge route.
 */
import type { Layer } from "../../topo/geometry/relief";
import type { LaneId } from "./lanes";

export const SECTION_W = 640;
export const SECTION_H = 400;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Terrace heights (the ground line of each camp). */
export const GROUND: Readonly<Record<Layer, number>> = { floor: 345, ridge: 212, summit: 80 };

/** The section line: floor plateau, slope, ridge terrace, slope, summit plateau. */
export const SECTION_PATH = `M0,${GROUND.floor} H220 C262,${GROUND.floor} 268,${GROUND.ridge + 2} 310,${GROUND.ridge} H420 C462,${GROUND.ridge - 2} 470,${GROUND.summit + 2} 512,${GROUND.summit} H${SECTION_W}`;
export const SECTION_FILL = `${SECTION_PATH} V${SECTION_H} H0 Z`;

export const CAMPS: Readonly<Record<"spot" | "perps" | "ridge" | "summit", Point>> = {
  spot: { x: 104, y: GROUND.floor },
  perps: { x: 200, y: GROUND.floor },
  ridge: { x: 365, y: GROUND.ridge },
  summit: { x: 590, y: GROUND.summit },
};

const f = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * A switchback trail from `from` down to `to`: legs alternate between the
 * slope line and a point lifted `amp` above it, so the trail always stays
 * above ground.
 */
export function switchbacks(from: Point, to: Point, legs: number, amp: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Unit normal pointing up (into the air).
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const points: Point[] = [from];
  for (let index = 1; index < legs; index += 1) {
    const t = index / legs;
    const lift = index % 2 === 1 ? amp : amp * 0.2;
    points.push({ x: from.x + dx * t + nx * lift, y: from.y + dy * t + ny * lift });
  }
  points.push(to);
  return `M${points.map((point) => `${f(point.x)},${f(point.y)}`).join("L")}`;
}

export interface LaneGeometry {
  readonly id: LaneId;
  readonly d: string;
  /** Where the lane's tag sits. */
  readonly label: Point;
  readonly anchor: "start" | "middle" | "end";
  /** The arrowhead at the arrival end. */
  readonly arrive: Point;
  /** Direction of arrival, radians (for the arrowhead). */
  readonly heading: number;
}

function heading(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

const CABLE_FROM: Point = { x: CAMPS.ridge.x + 14, y: CAMPS.ridge.y - 22 };
const CABLE_TO: Point = { x: CAMPS.summit.x - 12, y: CAMPS.summit.y - 22 };
/** The cable sags a little: a quadratic through a low control point. */
export const CABLE_CONTROL: Point = { x: (CABLE_FROM.x + CABLE_TO.x) / 2, y: (CABLE_FROM.y + CABLE_TO.y) / 2 + 16 };

/** A point on the cable at t (0 at the ridge, 1 at the summit). */
export function cablePoint(t: number): Point {
  const u = Math.min(1, Math.max(0, t));
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return { x: a * CABLE_FROM.x + b * CABLE_CONTROL.x + c * CABLE_TO.x, y: a * CABLE_FROM.y + b * CABLE_CONTROL.y + c * CABLE_TO.y };
}

export const CABLE_PATH = `M${f(CABLE_FROM.x)},${f(CABLE_FROM.y)} Q${f(CABLE_CONTROL.x)},${f(CABLE_CONTROL.y)} ${f(CABLE_TO.x)},${f(CABLE_TO.y)}`;

/** The upper slope of the section (ridge terrace -> summit plateau), the same cubic as SECTION_PATH. */
const UPPER_SLOPE: readonly [Point, Point, Point, Point] = [
  { x: 420, y: GROUND.ridge },
  { x: 462, y: GROUND.ridge - 2 },
  { x: 470, y: GROUND.summit + 2 },
  { x: 512, y: GROUND.summit },
];

function cubic(points: readonly [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const [a, b, c, d] = points;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/**
 * The long trail down: switchbacks that hug the real slope, lifted off the
 * ground along its upward normal (wide legs, narrow turns), so the trail is
 * always in the air above the section line.
 */
export function slopeTrail(legs: number, amp: number, clearance = 5): Point[] {
  const out: Point[] = [];
  for (let index = 0; index <= legs; index += 1) {
    const t = 1 - index / legs;
    const here = cubic(UPPER_SLOPE, t);
    const ahead = cubic(UPPER_SLOPE, Math.min(1, t + 0.01));
    const behind = cubic(UPPER_SLOPE, Math.max(0, t - 0.01));
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const length = Math.hypot(dx, dy) || 1;
    // Normal pointing into the air (up and to the left of an up-right slope).
    const nx = dy / length;
    const ny = -dx / length;
    const lift = clearance + (index % 2 === 1 ? amp : 0);
    out.push({ x: here.x + nx * lift, y: here.y + ny * lift });
  }
  return out;
}

export const LANE_GEOMETRY: Readonly<Record<LaneId, LaneGeometry>> = {
  "up-summit": { id: "up-summit", d: CABLE_PATH, label: { x: 452, y: 112 }, anchor: "end", arrive: CABLE_TO, heading: heading(cablePoint(0.95), CABLE_TO) },
  "down-ridge": {
    id: "down-ridge",
    d: `M${CAMPS.summit.x - 16},${GROUND.summit - 6} ${slopeTrail(8, 16).map((point) => `L${f(point.x)},${f(point.y)}`).join(" ")} L${CAMPS.ridge.x + 18},${GROUND.ridge - 6}`,
    label: { x: 630, y: 150 },
    anchor: "end",
    arrive: { x: CAMPS.ridge.x + 18, y: GROUND.ridge - 6 },
    heading: Math.PI,
  },
  "down-floor": {
    id: "down-floor",
    d: `M${CAMPS.ridge.x - 16},${GROUND.ridge - 6} Q270,${GROUND.ridge + 8} ${CAMPS.perps.x + 14},${GROUND.floor - 10}`,
    label: { x: 282, y: 300 },
    anchor: "start",
    arrive: { x: CAMPS.perps.x + 14, y: GROUND.floor - 10 },
    heading: heading({ x: 220, y: GROUND.floor - 40 }, { x: CAMPS.perps.x + 14, y: GROUND.floor - 10 }),
  },
  "up-ridge": {
    id: "up-ridge",
    d: `M${CAMPS.perps.x + 4},${GROUND.floor - 26} Q246,${GROUND.ridge - 20} ${CAMPS.ridge.x - 22},${GROUND.ridge - 22}`,
    label: { x: 226, y: 222 },
    anchor: "end",
    arrive: { x: CAMPS.ridge.x - 22, y: GROUND.ridge - 22 },
    heading: 0,
  },
  "to-perps": {
    id: "to-perps",
    d: `M${CAMPS.spot.x + 12},${GROUND.floor - 12} Q${(CAMPS.spot.x + CAMPS.perps.x) / 2},${GROUND.floor - 54} ${CAMPS.perps.x - 12},${GROUND.floor - 12}`,
    label: { x: CAMPS.spot.x - 2, y: GROUND.floor - 60 },
    anchor: "start",
    arrive: { x: CAMPS.perps.x - 12, y: GROUND.floor - 12 },
    heading: Math.PI / 4,
  },
  "to-spot": {
    id: "to-spot",
    d: `M${CAMPS.perps.x - 12},${GROUND.floor - 6} Q${(CAMPS.spot.x + CAMPS.perps.x) / 2},${GROUND.floor - 26} ${CAMPS.spot.x + 12},${GROUND.floor - 6}`,
    label: { x: (CAMPS.spot.x + CAMPS.perps.x) / 2, y: GROUND.floor + 26 },
    anchor: "middle",
    arrive: { x: CAMPS.spot.x + 12, y: GROUND.floor - 6 },
    heading: (3 * Math.PI) / 4,
  },
};

/** Arrowhead triangle at `tip`, pointing along `angle`. */
export function arrowHead(tip: Point, angle: number, size = 9): string {
  const back = { x: tip.x - Math.cos(angle) * size, y: tip.y - Math.sin(angle) * size };
  const side = size * 0.55;
  const left = { x: back.x + Math.sin(angle) * side, y: back.y - Math.cos(angle) * side };
  const right = { x: back.x - Math.sin(angle) * side, y: back.y + Math.cos(angle) * side };
  return `M${f(tip.x)},${f(tip.y)}L${f(left.x)},${f(left.y)}L${f(right.x)},${f(right.y)}Z`;
}
