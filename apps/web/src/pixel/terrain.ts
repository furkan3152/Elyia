/**
 * The portfolio as pixel terrain (pure). Every holding is a gaussian hill
 * whose height is its value; shorts are lakes. A market shock scales the
 * hills; a position whose rope (distance to liquidation) is shorter than the
 * shock snaps and its hill collapses into a lake.
 */
import type { PixelSurface } from "./draw";
import { shade, type HeightField } from "./topo";

export interface TerrainHolding {
  readonly id: string;
  readonly label: string;
  /** Value in USD (always positive; the side says long or short). */
  readonly usd: number;
  readonly side?: "long" | "short";
  /** Distance to liquidation in percent (19 = 19%). Omit for unlevered holdings. */
  readonly rope?: number | null;
  /** Stable value (USDC, vault shares): the shock does not move it. */
  readonly stable?: boolean;
  /** Fixed position as fractions of the map (0..1); otherwise laid out on a spiral. */
  readonly x?: number;
  readonly y?: number;
}

export interface TerrainPeak {
  readonly holding: TerrainHolding;
  /** Map pixel position of the summit. */
  readonly x: number;
  readonly y: number;
  readonly snapped: boolean;
  /** Value after the shock (0 when snapped). */
  readonly value: number;
  readonly lake: boolean;
}

export interface TerrainModel {
  readonly w: number;
  readonly h: number;
  readonly field: HeightField;
  /** Height of the top land band. */
  readonly top: number;
  readonly peaks: readonly TerrainPeak[];
  readonly netWorth: number;
  readonly snaps: number;
  /** The tallest hill still standing (Ely stands here). */
  readonly tallest: TerrainPeak | null;
}

/** Land bands, shore to snow. */
export const LAND = ["#A9D3B4", "#C9DDA0", "#E2D49A", "#D3A66E", "#B07A44", "#8A5A2B", "#E9DFC8", "#FFFFFF"] as const;
export const WATER = { shallow: "#1F5866", deep: "#173F4C", glint: "#5FB0B8", shore: "#2F7E8C" } as const;

/** A long's rope snaps when the market falls by its distance; a short's when it rises by it. */
export function snappedBy(holding: TerrainHolding, shock: number): boolean {
  if (typeof holding.rope !== "number" || !Number.isFinite(holding.rope)) return false;
  return holding.side === "short" ? shock >= holding.rope : -shock >= holding.rope;
}

/** Positions as fractions: given ones kept, the rest on a golden-angle spiral, largest in the middle. */
export function layoutTerrain(holdings: readonly TerrainHolding[]): ReadonlyArray<readonly [number, number]> {
  const order = holdings.map((holding, index) => ({ holding, index })).sort((a, b) => b.holding.usd - a.holding.usd);
  const out: Array<readonly [number, number]> = holdings.map(() => [0.5, 0.5] as const);
  const n = Math.max(1, holdings.length);
  order.forEach(({ holding, index }, rank) => {
    if (holding.x !== undefined && holding.y !== undefined) {
      out[index] = [holding.x, holding.y];
      return;
    }
    const r = 0.4 * Math.sqrt(rank / n);
    const a = rank * 2.39996 + 0.6;
    out[index] = [0.5 + r * Math.cos(a) * 0.95, 0.54 + r * Math.sin(a) * 0.8];
  });
  return out;
}

/** Builds the height field for `shock` (percent, -30..30). */
export function terrainModel(holdings: readonly TerrainHolding[], w: number, h: number, shock = 0): TerrainModel {
  const k = 1 + shock / 100;
  const maxUsd = Math.max(1, ...holdings.map((holding) => holding.usd));
  const top = maxUsd * 1.03;
  const positions = layoutTerrain(holdings);
  const unit = w / 200;
  const hills = holdings.map((holding, index) => {
    const [fx, fy] = positions[index]!;
    const snapped = snappedBy(holding, shock);
    const sigma = (4 + Math.sqrt(holding.usd / maxUsd) * 13.4) * unit;
    const height = snapped ? -holding.usd * 0.45 : holding.side === "short" ? -holding.usd * (2 - k) : holding.usd * (holding.stable ? 1 : k);
    return { holding, x: fx * w, y: fy * h, sigma, height, snapped };
  });
  const field: number[][] = [];
  const ripple = maxUsd * 0.024;
  for (let y = 0; y < h; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < w; x += 1) {
      let v = 0;
      for (const hill of hills) v += hill.height * Math.exp(-((x - hill.x) ** 2 + (y - hill.y) ** 2) / (2 * hill.sigma * hill.sigma));
      v += ripple * Math.sin(x / (23 * unit)) * Math.cos(y / (19 * unit));
      row.push(v);
    }
    field.push(row);
  }
  const peaks: TerrainPeak[] = hills.map((hill) => {
    const lake = hill.snapped || hill.holding.side === "short";
    const value = hill.snapped ? 0 : hill.holding.side === "short" || hill.holding.stable ? hill.holding.usd : hill.holding.usd * k;
    return { holding: hill.holding, x: Math.round(hill.x), y: Math.round(hill.y), snapped: hill.snapped, value, lake };
  });
  const standing = peaks.filter((peak) => !peak.lake);
  const tallest = standing.length ? standing.reduce((best, peak) => (peak.value > best.value ? peak : best)) : null;
  return {
    w,
    h,
    field,
    top,
    peaks,
    netWorth: peaks.reduce((sum, peak) => sum + peak.value, 0),
    snaps: peaks.filter((peak) => peak.snapped).length,
    tallest,
  };
}

/** Land band of a height: -1 under water, then 0..LAND.length-1. */
export function landBand(v: number, top: number): number {
  if (v < 0) return -1;
  return Math.min(LAND.length - 1, Math.floor((v / top) * LAND.length));
}

/** Paints the terrain: banded land with contour pixels, lakes with a slow glint that drifts with `seconds`. */
export function paintTerrain(ctx: PixelSurface, model: TerrainModel, seconds = 0): void {
  const { field, w, h, top } = model;
  const drift = Math.floor(seconds / 0.3);
  const deep = -top * 0.12;
  for (let y = 0; y < h; y += 1) {
    const row = field[y]!;
    for (let x = 0; x < w; x += 1) {
      const v = row[x]!;
      let c: string;
      if (v < 0) {
        c = (x + y + drift) % 7 === 0 ? WATER.glint : v < deep ? WATER.deep : WATER.shallow;
      } else {
        const b = landBand(v, top);
        c = LAND[b]!;
        const r = x + 1 < w ? landBand(row[x + 1]!, top) : b;
        const d = y + 1 < h ? landBand(field[y + 1]![x]!, top) : b;
        if (r !== b || d !== b) c = shade(c, -0.25);
      }
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** The reference sample: seven holdings on a 200 x 110 sheet. Documentation only: label it as a sample. */
export const SAMPLE_TERRAIN: readonly TerrainHolding[] = [
  { id: "hype", label: "HYPE 3×", usd: 12400, side: "long", rope: 33, x: 52 / 200, y: 52 / 110 },
  { id: "eth", label: "ETH 5×", usd: 8960, side: "long", rope: 19, x: 86 / 200, y: 34 / 110 },
  { id: "fart", label: "FART SHORT", usd: 1950, side: "short", rope: 6, x: 102 / 200, y: 72 / 110 },
  { id: "khype", label: "kHYPE", usd: 6040, side: "long", x: 150 / 200, y: 40 / 110 },
  { id: "usdc", label: "USDC", usd: 4180, stable: true, x: 160 / 200, y: 78 / 110 },
  { id: "hlp", label: "HLP", usd: 1410, stable: true, x: 30 / 200, y: 86 / 110 },
  { id: "lp", label: "LP", usd: 2880, side: "long", rope: 60, x: 124 / 200, y: 92 / 110 },
];

export interface LabelSpot {
  /** Summit position in CSS px. */
  readonly x: number;
  readonly y: number;
  /** Label box size in CSS px. */
  readonly w: number;
  readonly h: number;
}

export type LabelPlacement = "right-up" | "left-up" | "right-down" | "left-down";

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The label box for a placement, 6 px off the summit dot. */
export function labelBox(spot: LabelSpot, placement: LabelPlacement): Box {
  const right = placement.startsWith("right");
  const up = placement.endsWith("up");
  const x0 = right ? spot.x + 6 : spot.x - 6 - spot.w;
  const y0 = up ? spot.y - 6 - spot.h : spot.y + 6;
  return { x0, y0, x1: x0 + spot.w, y1: y0 + spot.h };
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Places peak labels so they never cover each other (or the given obstacles,
 * such as Ely's sprite), preferring up-right, inside a `width` x `height`
 * map. Larger holdings are placed first (pass spots in that order).
 */
export function placeLabels(spots: readonly LabelSpot[], width: number, height: number, obstacles: readonly Box[] = []): LabelPlacement[] {
  const placed: Box[] = [...obstacles];
  const order: LabelPlacement[] = ["right-up", "left-up", "right-down", "left-down"];
  return spots.map((spot) => {
    const inside = (box: Box) => box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 <= height;
    const scored = order.map((placement) => {
      const box = labelBox(spot, placement);
      const hits = placed.filter((other) => overlaps(box, other)).length;
      return { placement, box, cost: hits * 10 + (inside(box) ? 0 : 5) };
    });
    const best = scored.reduce((a, b) => (b.cost < a.cost ? b : a));
    placed.push(best.box);
    return best.placement;
  });
}
