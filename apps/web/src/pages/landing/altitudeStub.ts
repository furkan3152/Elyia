/**
 * The route card's stub, drawn in pixels (pure): Floor, Ridge and Summit as
 * three steps of a side-view range, each in its altitude bands. Layers the
 * sentence travels stand clear with a flag; the others sit in a dithered fog.
 * Ely stands on the highest layer touched and hops when that changes.
 */
import type { PixelSurface } from "../../pixel/draw";
import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, type PixelGrid } from "../../pixel/ely";
import { shade } from "../../pixel/topo";
import type { Layer } from "../../topo/geometry/relief";

export const STUB_H = 46;
export const STUB_LAYERS: readonly Layer[] = ["floor", "ridge", "summit"];
/** Ground height of each step, from the top of the stub. */
const TOPS: Readonly<Record<Layer, number>> = { floor: 33, ridge: 24, summit: 15 };
const PALETTE: Readonly<Record<Layer, readonly string[]>> = { floor: LAYERS.Floor, ridge: LAYERS.Ridge, summit: LAYERS.Summit };

/** Mixes two #rrggbb / rgb() colours, `k` of the way from a to b. */
export function mix(a: string, b: string, k: number): string {
  const parse = (c: string): number[] => (c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/gu) ?? ["0", "0", "0"]).slice(0, 3).map(Number));
  const x = parse(a);
  const y = parse(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * k)).join(",")})`;
}

/** Column of a layer: [x0, x1) in stub pixels. */
export function stubColumn(layer: Layer, w: number): readonly [number, number] {
  const i = STUB_LAYERS.indexOf(layer);
  return [Math.round((i * w) / 3), Math.round(((i + 1) * w) / 3)];
}

/** Ground line at x: the step's height plus a little rock, stable per x. */
export function stubGround(x: number, w: number): number {
  const layer = STUB_LAYERS[Math.min(2, Math.max(0, Math.floor((x * 3) / Math.max(1, w))))]!;
  const rock = (x * 7 + (x >> 2) * 3) % 9 === 0 ? -1 : (x * 5) % 11 === 0 ? 1 : 0;
  return TOPS[layer] + rock;
}

/** Where Ely stands: the highest layer touched, or the Floor when none is. */
export function elyLayer(touched: ReadonlySet<Layer>): Layer {
  if (touched.has("summit")) return "summit";
  if (touched.has("ridge")) return "ridge";
  return "floor";
}

export interface HopState {
  from: number;
  to: number;
  start: number;
}

let calm: PixelGrid | null = null;
let hopping: PixelGrid | null = null;

export interface StubFrame {
  readonly touched: ReadonlySet<Layer>;
  readonly seconds: number;
  readonly still: boolean;
  /** Card colour for the fog dither (follows the sheet). */
  readonly fog: string;
  /** Sheet ink for the flag poles (dark by DAY, light by NIGHT). */
  readonly line?: string;
  /** Mutable hop memory (fractions of the width), owned by the caller. */
  readonly hop: HopState;
}

/** Paints the stub on a w x STUB_H canvas. */
export function paintStub(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, w: number, frame: StubFrame): void {
  const h = STUB_H;
  ctx.clearRect(0, 0, w, h);
  for (const layer of STUB_LAYERS) {
    const [x0, x1] = stubColumn(layer, w);
    const pal = PALETTE[layer];
    const on = frame.touched.has(layer);
    for (let x = x0; x < x1; x += 1) {
      const top = stubGround(x, w);
      for (let y = top; y < h; y += 1) {
        const depth = y - top;
        const k = Math.min(pal.length - 1, Math.floor(depth / 3));
        let c = pal[pal.length - 1 - k]!;
        if (depth > 0 && depth % 3 === 0) c = shade(c, -0.22);
        if (layer === "summit" && depth < 2) c = "#FFFFFF";
        ctx.fillStyle = on ? c : mix(c, frame.fog, (x + y) % 2 === 0 ? 0.72 : 0.6);
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = on ? INK : mix(INK, frame.fog, 0.45);
      ctx.fillRect(x, top, 1, 1);
    }
    // the step's cliff edge, inked
    if (x0 > 0) {
      const a = stubGround(x0 - 1, w);
      const b = stubGround(x0, w);
      ctx.fillStyle = INK;
      ctx.fillRect(x0, Math.min(a, b), 1, Math.abs(a - b) + 1);
    }
    if (on) {
      const fx = Math.round((x0 + x1) / 2) + 9;
      const top = stubGround(fx, w);
      const wave = frame.still ? 0 : Math.floor(frame.seconds * 2) % 2;
      ctx.fillStyle = frame.line ?? INK;
      ctx.fillRect(fx, top - 10, 1, 10);
      ctx.fillStyle = ROPE_RED;
      ctx.fillRect(fx + 1, top - 10, 5, 1);
      ctx.fillRect(fx + 1, top - 9, 5 - wave, 1);
      ctx.fillRect(fx + 1, top - 8, 4 + wave, 1);
    }
  }
  // Ely: hop to the new layer in eight steps over 0.64 s
  const [tx0, tx1] = stubColumn(elyLayer(frame.touched), w);
  const target = (tx0 + tx1) / 2 / w;
  const hop = frame.hop;
  if (Math.abs(hop.to - target) > 1e-6) {
    const t0 = Math.min(1, Math.max(0, (frame.seconds - hop.start) / 0.64));
    hop.from = hop.from + (hop.to - hop.from) * t0;
    hop.to = target;
    hop.start = frame.seconds;
  }
  const t = frame.still ? 1 : Math.floor(Math.min(1, Math.max(0, (frame.seconds - hop.start) / 0.64)) * 8) / 8;
  const fx = hop.from + (hop.to - hop.from) * t;
  const ex = Math.round(fx * w);
  const lift = t < 1 ? Math.round(Math.sin(Math.PI * t) * 7) : 0;
  const ground = Math.min(stubGround(ex - 4, w), stubGround(ex + 3, w));
  calm ??= mini(elySprite({ gear: "lamp" }));
  hopping ??= mini(elySprite({ gear: "rope", eye: "happy" }));
  const bob = !frame.still && t >= 1 ? Math.floor(frame.seconds * 2) % 2 : 0;
  drawGrid(ctx, t < 1 ? hopping : calm, ex - 8, ground - 16 - lift - bob, 1);
}
