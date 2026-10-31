import { LAYERS as PALETTES } from "../../../pixel/ely";
import type { Layer } from "../../../topo/geometry/relief";
import type { SheetColors } from "./sheetColors";

export type Glyph = "rebalance" | "dust" | "gas" | "descent";
export const GLYPH_W = 48;
export const GLYPH_H = 24;
const FILL_HEX: Readonly<Record<Layer, string>> = { floor: PALETTES.Floor[2]!, ridge: PALETTES.Ridge[2]!, summit: PALETTES.Summit[1]! };

export interface JobGlyphInput {
  readonly kind: Glyph;
  /** rebalance: each layer's share and its target. */
  readonly shares?: readonly { readonly layer: Layer; readonly share: number; readonly target: number }[];
  /** dust: how many specks. */
  readonly specks?: number;
  /** gas: each camp's tank (0..1, null = no gas needed / not read). */
  readonly tanks?: readonly { readonly layer: Layer; readonly level: number | null }[];
  /** descent: how many items are on the trail. */
  readonly walkers?: number;
}

/** A job's state as a small pixel diagram (pure painting on a 48 x 24 canvas). */
export function paintJobGlyph(ctx: CanvasRenderingContext2D, input: JobGlyphInput, colors: SheetColors, seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, GLYPH_W, GLYPH_H);
  const ink = colors.ink;
  const ground = () => {
    ctx.fillStyle = ink;
    ctx.fillRect(2, GLYPH_H - 2, GLYPH_W - 4, 1);
  };
  if (input.kind === "rebalance") {
    ground();
    (input.shares ?? []).forEach((entry, index) => {
      const x = 7 + index * 13;
      const h = Math.max(1, Math.round(entry.share * 18));
      ctx.fillStyle = FILL_HEX[entry.layer];
      ctx.fillRect(x, GLYPH_H - 2 - h, 8, h);
      ctx.fillStyle = ink;
      ctx.fillRect(x, GLYPH_H - 2 - h, 8, 1);
      // the target: a sun tick across the column
      const t = Math.round(entry.target * 18);
      ctx.fillStyle = colors.signal;
      ctx.fillRect(x - 2, GLYPH_H - 2 - t, 12, 1);
      ctx.fillStyle = ink;
      ctx.fillRect(x - 2, GLYPH_H - 1 - t, 1, 1);
      ctx.fillRect(x + 9, GLYPH_H - 1 - t, 1, 1);
    });
    return;
  }
  if (input.kind === "dust") {
    ground();
    const n = Math.min(14, input.specks ?? 0);
    const sweep = still ? 0 : Math.floor(seconds * 2) % 4;
    for (let i = 0; i < n; i += 1) {
      const x = 4 + ((i * 7) % 26) + (i % 2) * sweep;
      const y = GLYPH_H - 4 - ((i * 5) % 6);
      ctx.fillStyle = i % 3 === 0 ? colors.signal : colors.ink3;
      ctx.fillRect(x, y, 1, 1);
    }
    // the broom, sweeping to the right
    const bx = 34 + (still ? 0 : sweep);
    ctx.fillStyle = PALETTES.Ridge[2]!;
    for (let i = 0; i < 12; i += 1) ctx.fillRect(bx + Math.floor(i / 3), 6 + i, 1, 1);
    ctx.fillStyle = colors.signal;
    ctx.fillRect(bx + 2, GLYPH_H - 6, 6, 4);
    ctx.fillStyle = ink;
    ctx.fillRect(bx + 2, GLYPH_H - 6, 6, 1);
    // the pile of USDC
    if (n === 0) {
      ctx.fillStyle = colors.up;
      ctx.fillRect(10, GLYPH_H - 5, 3, 3);
      ctx.fillRect(14, GLYPH_H - 5, 3, 3);
    }
    return;
  }
  if (input.kind === "gas") {
    ground();
    (input.tanks ?? []).forEach((tank, index) => {
      const x = 7 + index * 13;
      const top = 6;
      const h = GLYPH_H - 2 - top;
      ctx.fillStyle = ink;
      ctx.fillRect(x, top, 8, 1);
      ctx.fillRect(x, top, 1, h);
      ctx.fillRect(x + 7, top, 1, h);
      ctx.fillRect(x + 2, top - 2, 4, 2);
      if (tank.level === null) {
        // no gas needed: a dashed tank
        ctx.fillStyle = colors.ink3;
        for (let y = top + 2; y < GLYPH_H - 2; y += 2) ctx.fillRect(x + 3, y, 2, 1);
        return;
      }
      const fill = Math.round(Math.max(0, Math.min(1, tank.level)) * (h - 1));
      ctx.fillStyle = tank.level < 0.25 ? colors.down : FILL_HEX[tank.layer];
      ctx.fillRect(x + 1, GLYPH_H - 2 - fill, 6, fill);
    });
    return;
  }
  // descent: a trail zig-zagging down, walkers on it
  const trail: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) trail.push([4 + i, 6 + Math.round(i * 0.36) + (Math.floor(i / 6) % 2 === 0 ? 0 : 1)]);
  ctx.fillStyle = colors.ink3;
  trail.forEach(([x, y], i) => {
    if (i % 2 === 0) ctx.fillRect(x, y, 1, 1);
  });
  ctx.fillStyle = ink;
  ctx.fillRect(2, GLYPH_H - 2, GLYPH_W - 4, 1);
  const walkers = Math.min(4, input.walkers ?? 0);
  for (let w = 0; w < walkers; w += 1) {
    const step = still ? w * 9 : (Math.floor(seconds * 3) + w * 9) % trail.length;
    const [x, y] = trail[step]!;
    ctx.fillStyle = colors.signal;
    ctx.fillRect(x, y - 3, 2, 3);
    ctx.fillStyle = ink;
    ctx.fillRect(x, y - 4, 2, 1);
  }
  if (walkers === 0) {
    // the hut at the bottom, door shut
    ctx.fillStyle = PALETTES.Ridge[2]!;
    ctx.fillRect(38, GLYPH_H - 7, 7, 5);
    ctx.fillStyle = ink;
    ctx.fillRect(37, GLYPH_H - 8, 9, 1);
    ctx.fillRect(41, GLYPH_H - 5, 1, 3);
  }
}

