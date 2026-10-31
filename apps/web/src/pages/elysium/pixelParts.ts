/**
 * Small pixel drawings of the weather station (pure): the altitude badge on
 * each layer's altimeter card and the trail sign glyph of the registry.
 */
import type { PixelSurface } from "../../pixel/draw";
import { INK, LAYERS, ROPE_RED, WHITE } from "../../pixel/ely";
import type { GlyphRows } from "../../pixel/glyphs";
import { shade } from "../../pixel/topo";
import type { Layer } from "../../topo/geometry/relief";

export const BADGE_W = 64;
export const BADGE_H = 26;

const PEAK: Readonly<Record<Layer, { readonly top: number; readonly pal: readonly string[] }>> = {
  floor: { top: 17, pal: LAYERS.Floor },
  ridge: { top: 10, pal: LAYERS.Ridge },
  summit: { top: 4, pal: LAYERS.Summit },
};

/** A symmetric pixel peak whose height is the layer's altitude; the Summit carries snow and a flag. */
export function paintLayerPeak(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, layer: Layer, seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, BADGE_W, BADGE_H);
  const { top, pal } = PEAK[layer];
  const c = BADGE_W / 2;
  for (let x = 0; x < BADGE_W; x += 1) {
    const d = Math.abs(x + 0.5 - c);
    const t = Math.round(Math.max(top, top + (d - 3) * ((BADGE_H - top) / (c - 3)) * 0.9));
    if (t >= BADGE_H) continue;
    for (let y = t; y < BADGE_H; y += 1) {
      const depth = y - t;
      const k = Math.min(pal.length - 1, Math.floor(depth / 3));
      let col = pal[pal.length - 1 - k]!;
      if (depth > 0 && depth % 3 === 0) col = shade(col, -0.22);
      if (layer === "summit" && y < top + 4) col = WHITE;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, t, 1, 1);
  }
  if (layer === "summit") {
    const wave = still ? 0 : Math.floor(seconds * 2) % 2;
    ctx.fillStyle = INK;
    ctx.fillRect(c, top - 4, 1, 4);
    ctx.fillStyle = ROPE_RED;
    ctx.fillRect(c + 1, top - 4, 4, 1);
    ctx.fillRect(c + 1, top - 3, 4 - wave, 1);
  }
}

/** A trail sign: an arrow board on a post (palette: k ink, b board, p post). */
export const SIGN_GLYPH: GlyphRows = [
  ".kkkkkkkkkk..",
  "kbbbbbbbbbbk.",
  "kbbbbbbbbbbbk",
  "kbbbbbbbbbbk.",
  ".kkkkkkkkkk..",
  ".....kpk.....",
  ".....kpk.....",
  ".....kpk.....",
  "....kkkkk....",
];
