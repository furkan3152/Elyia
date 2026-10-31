/**
 * Equity as a stepped pixel ridgeline (pure). The series is resampled to one
 * value per pixel column and snapped to 2 px steps; the ridge is painted in
 * altitude bands, the all-time high carries a summit flag, and the worst
 * drawdown is flooded as a valley lake.
 */
import { athIndex, maxDrawdown } from "../topo/geometry/profile";
import type { PixelSurface } from "./draw";
import { INK, LAYERS, ROPE_RED, SUN } from "./ely";
import { shade } from "./topo";

export interface PixelProfileModel {
  readonly w: number;
  readonly h: number;
  /** Ridge top per column (pixel y). */
  readonly tops: readonly number[];
  readonly min: number;
  readonly max: number;
  /** Column of the all-time high. */
  readonly athColumn: number;
  /** Valley: columns of the worst drawdown's peak and trough, its water line and depth. */
  readonly valley: { readonly from: number; readonly to: number; readonly level: number; readonly fraction: number } | null;
  /** Bottom of the drawing area (above the axis gutter). */
  readonly base: number;
}

const STEP = 2;
const HEADROOM = 18;

/** Resamples `values` to `w` columns and snaps the heights to the pixel step. */
export function profileColumns(values: readonly number[], w: number, h: number): PixelProfileModel {
  const base = h - 2;
  if (values.length === 0 || w <= 0) return { w, h, tops: Array<number>(Math.max(0, w)).fill(base), min: 0, max: 0, athColumn: 0, valley: null, base };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const lo = min - span * 0.12;
  const usable = base - HEADROOM;
  const yOf = (value: number) => {
    const y = base - ((value - lo) / (max - lo || 1)) * usable;
    return Math.round(y / STEP) * STEP;
  };
  const indexAt = (column: number) => (values.length === 1 ? 0 : Math.round((column / Math.max(1, w - 1)) * (values.length - 1)));
  const columnOf = (index: number) => (values.length === 1 ? 0 : Math.round((index / (values.length - 1)) * (w - 1)));
  const tops = Array.from({ length: w }, (_, column) => yOf(values[indexAt(column)]!));
  const drawdown = maxDrawdown(values);
  const valley =
    drawdown.fraction > 0.005
      ? { from: columnOf(drawdown.peakIndex), to: columnOf(drawdown.troughIndex), level: yOf(values[drawdown.peakIndex]!), fraction: drawdown.fraction }
      : null;
  return { w, h, tops, min, max, athColumn: columnOf(athIndex(values)), valley, base };
}

export interface ProfilePaint {
  /** Sky colour behind the ridge (null: transparent). */
  readonly sky?: string | null;
  /** Flag waves (false: the still pose). */
  readonly wave?: boolean;
}

/** Paints the ridge, the valley lake and the summit flag. */
export function paintProfile(ctx: PixelSurface & { clearRect?: (x: number, y: number, w: number, h: number) => void }, model: PixelProfileModel, paint: ProfilePaint = {}): void {
  const { w, h, tops, valley, base } = model;
  if (paint.sky) {
    ctx.fillStyle = paint.sky;
    ctx.fillRect(0, 0, w, h);
  } else ctx.clearRect?.(0, 0, w, h);
  const palette = [...LAYERS.Floor.slice(1, 4), ...LAYERS.Ridge.slice(2, 4), ...LAYERS.Summit.slice(2)];
  const bandH = Math.max(4, Math.round((base - 10) / palette.length / 2) * 2);
  // the valley: water between the old high and the ridge
  if (valley) {
    for (let x = valley.from; x <= valley.to; x += 1) {
      const top = tops[x]!;
      for (let y = valley.level; y < top; y += 1) {
        ctx.fillStyle = (x + y) % 5 === 0 ? "#5FB0B8" : y === valley.level ? "#A7D6D6" : "#2D8796";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  for (let x = 0; x < w; x += 1) {
    const top = tops[x]!;
    for (let y = top; y < base; y += 1) {
      const band = Math.min(palette.length - 1, Math.max(0, Math.floor((base - y) / bandH)));
      const edge = (base - y) % bandH === 0;
      const c = palette[band]!;
      ctx.fillStyle = edge ? shade(c, -0.22) : c;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
    const prev = tops[x - 1];
    if (prev !== undefined && prev !== top) ctx.fillRect(x, Math.min(prev, top), 1, Math.abs(prev - top));
  }
  // ground line
  ctx.fillStyle = INK;
  ctx.fillRect(0, base, w, 2);
  // summit flag at the all-time high
  const fx = Math.max(1, Math.min(w - 9, model.athColumn));
  const fy = tops[model.athColumn]! - 12;
  ctx.fillStyle = INK;
  ctx.fillRect(fx, fy, 1, 12);
  const wave = paint.wave ? 1 : 0;
  ctx.fillStyle = ROPE_RED;
  for (let y = 0; y < 5; y += 1) ctx.fillRect(fx + 1, fy + y, 7 - (y === 2 ? wave : 0), 1);
  ctx.fillStyle = SUN;
  ctx.fillRect(fx + 3, fy + 1, 2, 2);
}
