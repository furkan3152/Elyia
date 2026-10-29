/**
 * Relief (pure): a portfolio as terrain. Every holding is a Gaussian hill
 * whose height is its USD value (sigma = 20 + 0.46 * sqrt(usd)); shorts are
 * basins (negative hills) drawn at half the interval as dashed red rings;
 * the three layers are regions of the sheet (FLOOR, RIDGE, SUMMIT). Contours
 * come from marching squares (contours.ts), smoothed, with an index contour
 * every fourth interval.
 *
 * Deterministic: the same holdings always give the same map. Memoise it (it
 * runs in a few ms for ~30 holdings at the default grid).
 */
import { seededRandom } from "../../motion/tokens";
import { isolines, sampleField, simplify, smoothPath, polylineLength, type Field, type Point } from "./contours";

export type Layer = "floor" | "ridge" | "summit";

export interface ReliefHolding {
  readonly id: string;
  /** "HYPE", "ETH", "kHYPE". */
  readonly symbol: string;
  /** Absolute USD value (notional for positions). */
  readonly usd: number;
  readonly layer: Layer;
  /** Shorts become basins. */
  readonly side?: "long" | "short" | "spot";
  /** Leverage > 1 draws hatched cliffs. */
  readonly leverage?: number;
  /** Small print after the value ("rope 19%"). */
  readonly note?: string;
}

export interface ReliefOptions {
  readonly width?: number;
  readonly height?: number;
  /** Grid step in px (smaller is finer and slower). */
  readonly step?: number;
  /** Contour interval in USD; default picks a round number for ~10 lines on the tallest hill. */
  readonly interval?: number;
  readonly seed?: number;
}

export interface PlacedHill {
  readonly holding: ReliefHolding;
  readonly x: number;
  readonly y: number;
  readonly sigma: number;
  /** +1 hill, -1 basin. */
  readonly sign: 1 | -1;
}

export interface ContourPath {
  readonly level: number;
  /** Every 4th interval is an index contour (thicker). */
  readonly index: boolean;
  /** Below zero: a short's basin. */
  readonly basin: boolean;
  readonly d: string;
  readonly closed: boolean;
  /** Path length in px, for draw-on timing. */
  readonly length: number;
}

export interface ReliefRegion {
  readonly layer: Layer;
  /** Polygon of the region (for the hypsometric tint). */
  readonly d: string;
  /** Where the cartographic label sits. */
  readonly label: Point;
}

export interface Hachure {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface ReliefModel {
  readonly width: number;
  readonly height: number;
  readonly interval: number;
  readonly hills: readonly PlacedHill[];
  readonly contours: readonly ContourPath[];
  readonly regions: readonly ReliefRegion[];
  /** Region boundaries (dotted lines). */
  readonly boundaries: readonly string[];
  /** Hatched cliffs around leveraged hills. */
  readonly hachures: readonly Hachure[];
  readonly totalUsd: number;
}

export const RELIEF_WIDTH = 900;
export const RELIEF_HEIGHT = 620;

/** Hill width grows with the square root of value, so a whale does not swallow the sheet. */
export function hillSigma(usd: number): number {
  return 20 + 0.46 * Math.sqrt(Math.max(0, usd));
}

/** A round contour interval ($700, $1,500 ...) giving about `lines` contours on the tallest hill. */
export function contourInterval(maxUsd: number, lines = 16): number {
  if (!(maxUsd > 0)) return 100;
  const raw = maxUsd / lines;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const nice of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10]) {
    if (nice * power >= raw) return Math.round(nice * power * 1e6) / 1e6;
  }
  return 10 * power;
}

/*
 * The sheet's three regions, as fractions of the sheet: FLOOR the left
 * lowlands, RIDGE the right, SUMMIT the bottom band. Boundaries wobble a
 * little so they read as drawn lines, not a grid.
 */
const REGION_BOXES: Readonly<Record<Layer, readonly [number, number, number, number]>> = {
  floor: [0.03, 0.1, 0.6, 0.72],
  ridge: [0.62, 0.1, 0.97, 0.72],
  summit: [0.08, 0.76, 0.95, 0.94],
};

function wobbleLine(from: Point, to: Point, random: () => number, amplitude: number): Point[] {
  const points: Point[] = [];
  const steps = 8;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const edge = index === 0 || index === steps ? 0 : 1;
    const nx = -(to[1] - from[1]);
    const ny = to[0] - from[0];
    const length = Math.hypot(nx, ny) || 1;
    const offset = edge * (random() - 0.5) * 2 * amplitude;
    points.push([from[0] + (to[0] - from[0]) * t + (nx / length) * offset, from[1] + (to[1] - from[1]) * t + (ny / length) * offset]);
  }
  return points;
}

function regionGeometry(width: number, height: number, random: () => number): { regions: ReliefRegion[]; boundaries: string[] } {
  const splitX = width * 0.615;
  const splitY = height * 0.74;
  const vertical = wobbleLine([splitX - width * 0.03, 0], [splitX + width * 0.02, splitY], random, 10);
  const horizontal = wobbleLine([0, splitY + height * 0.04], [width, splitY - height * 0.03], random, 8);
  const toPath = (points: readonly Point[]) => `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
  // the vertical boundary meets the horizontal near (splitX, splitY)
  const joint = vertical[vertical.length - 1]!;
  const horizontalLeft = horizontal.filter(([x]) => x <= joint[0]);
  const horizontalRight = horizontal.filter(([x]) => x >= joint[0]);
  const floorPolygon: Point[] = [[0, 0], ...vertical, ...[...horizontalLeft].reverse(), [0, height * 0.78]];
  const ridgePolygon: Point[] = [...vertical, ...horizontalRight, [width, 0]];
  const summitPolygon: Point[] = [...horizontal, [width, height], [0, height]];
  const close = (points: readonly Point[]) => `${toPath(points)}Z`;
  return {
    regions: [
      { layer: "floor", d: close(floorPolygon), label: [width * 0.035, height * 0.075] },
      { layer: "ridge", d: close(ridgePolygon), label: [width * 0.965, height * 0.075] },
      { layer: "summit", d: close(summitPolygon), label: [width * 0.045, height * 0.965] },
    ],
    boundaries: [toPath(vertical), toPath(horizontal)],
  };
}

/**
 * Places hills inside their layer's region: biggest first near the region's
 * centre of gravity, the rest on a golden-angle spiral, never closer than
 * their combined footprints allow.
 */
export function layoutHills(holdings: readonly ReliefHolding[], width = RELIEF_WIDTH, height = RELIEF_HEIGHT, seed = 7): PlacedHill[] {
  const random = seededRandom(seed);
  const placed: PlacedHill[] = [];
  const sorted = [...holdings].filter((holding) => holding.usd > 0).sort((a, b) => b.usd - a.usd || a.id.localeCompare(b.id));
  const scale = Math.min(1, Math.sqrt((width * height) / (RELIEF_WIDTH * RELIEF_HEIGHT)));
  for (const holding of sorted) {
    const box = REGION_BOXES[holding.layer];
    const [x0, y0, x1, y1] = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
    const sigma = hillSigma(holding.usd) * scale;
    const margin = Math.min(sigma * 0.9, (x1 - x0) / 3, (y1 - y0) / 3);
    const cx = (x0 + x1) / 2 + (random() - 0.5) * (x1 - x0) * 0.12;
    const cy = (y0 + y1) / 2 + (random() - 0.5) * (y1 - y0) * 0.12;
    let best: Point = [cx, cy];
    let bestScore = -Infinity;
    const phase = random() * Math.PI * 2;
    const reach = Math.hypot(x1 - x0, y1 - y0) * 0.5;
    const sign = holding.side === "short" ? -1 : 1;
    for (let attempt = 0; attempt < 220; attempt += 1) {
      const radius = Math.sqrt(attempt / 220) * reach;
      const angle = phase + attempt * 2.39996;
      const x = Math.min(x1 - margin, Math.max(x0 + margin, cx + Math.cos(angle) * radius));
      const y = Math.min(y1 - margin, Math.max(y0 + margin, cy + Math.sin(angle) * radius * 0.8));
      let clearance = Infinity;
      for (const other of placed) {
        // Peaks stay distinct: 1.35 combined sigmas apart; a basin keeps
        // further from hills so their slopes do not fill its rings.
        const spacing = other.sign === sign ? 1.35 : 1.9;
        const gap = Math.hypot(other.x - x, other.y - y) / ((other.sigma + sigma) * spacing);
        if (gap < clearance) clearance = gap;
      }
      if (clearance >= 1) {
        best = [x, y];
        break;
      }
      if (clearance > bestScore) {
        bestScore = clearance;
        best = [x, y];
      }
    }
    placed.push({ holding, x: best[0], y: best[1], sigma, sign: holding.side === "short" ? -1 : 1 });
  }
  return placed;
}

/**
 * The terrain height at (x, y): every hill plus a gentle base that keeps
 * lines organic. `only` restricts the sum to hills (+1) or basins (-1):
 * basins are contoured on their own so a short always reads as its own pit.
 */
export function terrainHeight(hills: readonly PlacedHill[], x: number, y: number, baseAmplitude: number, only?: 1 | -1): number {
  let sum = only === -1 ? 0 : baseAmplitude * Math.sin(x / 150) * Math.cos(y / 180);
  for (const hill of hills) {
    if (only !== undefined && hill.sign !== only) continue;
    const dx = x - hill.x;
    const dy = y - hill.y;
    const s2 = 2 * hill.sigma * hill.sigma;
    const d2 = dx * dx + dy * dy;
    if (d2 > s2 * 9) continue;
    sum += hill.sign * hill.holding.usd * Math.exp(-d2 / s2);
  }
  return sum;
}

function hachuresFor(hill: PlacedHill, random: () => number): Hachure[] {
  const leverage = hill.holding.leverage ?? 1;
  if (leverage <= 1.5 || hill.sign < 0) return [];
  const count = Math.round(Math.min(48, 14 + leverage * 4));
  const inner = hill.sigma * 0.55;
  const length = Math.min(14, 4 + leverage * 1.4);
  const out: Hachure[] = [];
  // cliffs on the downhill side facing south-east (light from the north-west)
  for (let index = 0; index < count; index += 1) {
    const angle = -0.35 + (index / count) * Math.PI * 1.25 + (random() - 0.5) * 0.05;
    const r = inner + (random() - 0.5) * 2;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    out.push({ x1: hill.x + cx * r, y1: hill.y + cy * r, x2: hill.x + cx * (r + length), y2: hill.y + cy * (r + length) });
  }
  return out;
}

/** Builds the whole map: placement, field, contour paths, regions and cliffs. */
export function buildRelief(holdings: readonly ReliefHolding[], options: ReliefOptions = {}): ReliefModel {
  const width = options.width ?? RELIEF_WIDTH;
  const height = options.height ?? RELIEF_HEIGHT;
  const step = options.step ?? 6;
  const seed = options.seed ?? 7;
  const random = seededRandom(seed + 101);
  const hills = layoutHills(holdings, width, height, seed);
  const maxUsd = hills.reduce((max, hill) => Math.max(max, hill.holding.usd), 0);
  const interval = options.interval && options.interval > 0 ? options.interval : contourInterval(maxUsd);
  const baseAmplitude = interval * 0.36;
  const field: Field = sampleField(width, height, step, (x, y) => terrainHeight(hills, x, y, baseAmplitude, 1));
  const hasBasins = hills.some((hill) => hill.sign < 0);
  const basinField: Field | null = hasBasins ? sampleField(width, height, step, (x, y) => terrainHeight(hills, x, y, 0, -1)) : null;

  const contours: ContourPath[] = [];
  const tolerance = step * 0.18;
  const addLevel = (level: number, index: boolean, basin: boolean) => {
    const source = basin ? basinField : field;
    if (!source) return;
    for (const line of isolines(source, level)) {
      if (line.points.length < 4) continue;
      const points = simplify(line.points, tolerance);
      if (points.length < 3) continue;
      contours.push({ level, index, basin, d: smoothPath(points, line.closed), closed: line.closed, length: polylineLength(points, line.closed) });
    }
  };
  if (maxUsd > 0) {
    for (let k = 1; k * interval < field.max; k += 1) addLevel(k * interval, k % 4 === 0, false);
  }
  const half = interval / 2;
  if (basinField) for (let k = 1; -k * half > basinField.min; k += 1) addLevel(-k * half, k % 4 === 0, true);

  const { regions, boundaries } = regionGeometry(width, height, random);
  const hachures = hills.flatMap((hill) => hachuresFor(hill, random));
  const totalUsd = holdings.reduce((sum, holding) => sum + Math.max(0, holding.usd), 0);
  return { width, height, interval, hills, contours, regions, boundaries, hachures, totalUsd };
}

/** A stable cache key for memoising buildRelief on live data. */
export function reliefKey(holdings: readonly ReliefHolding[], options: ReliefOptions = {}): string {
  const parts = holdings.map((h) => `${h.id}:${Math.round(h.usd)}:${h.layer}:${h.side ?? ""}:${h.leverage ?? 1}`);
  return `${options.width ?? RELIEF_WIDTH}x${options.height ?? RELIEF_HEIGHT}/${options.step ?? 6}/${options.interval ?? 0}/${options.seed ?? 7}|${parts.join(",")}`;
}
