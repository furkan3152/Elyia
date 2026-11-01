/**
 * Portfolio × Ely drawings (pure painting, ported from the v2 mockup):
 * the five automation vignettes (92 x 36) and the PnL waterfall whose bars
 * rise in four steps. An off automation is drawn dimmed and still.
 */
import { drawGrid, type PixelSurface } from "../../../pixel/draw";
import { shade } from "../../../pixel/topo";
import { elyMini, GLYPHS, SUN, type Pal } from "../../../features/ely/draw";
import type { Waterfall } from "./model";

type Surface = PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void; globalAlpha: number };

function glyph(ctx: PixelSurface, name: keyof typeof GLYPHS, ox: number, oy: number, pal: Pal) {
  const colors: Readonly<Record<string, string>> = { i: pal.ink, a: pal.accent, s: SUN, S: "#FFE27A", o: "#B89100", d: pal.down, u: pal.up, w: pal.card, r: "#B07A44", f: "#1E6B7D", m: pal.ink3, k: pal.onAccent };
  const rows = GLYPHS[name];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = colors[row[x]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

export type VignetteKind = "protect" | "guard" | "stairs" | "sweep" | "gas";

export const VIGNETTE_W = 92;
export const VIGNETTE_H = 36;

/** One automation's live vignette. */
export function drawVignette(ctx: Surface, kind: VignetteKind, T: number, on: boolean, pal: Pal): void {
  const W = VIGNETTE_W;
  const H = VIGNETTE_H;
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = on ? 1 : 0.4;
  const t = on ? T : 0;
  switch (kind) {
    case "protect": {
      ctx.fillStyle = pal.up;
      for (let i = 0; i < W; i += 3) ctx.fillRect(i, 6, 2, 1);
      ctx.fillStyle = pal.down;
      for (let i = 0; i < W; i += 3) ctx.fillRect(i, 29, 2, 1);
      let prev: number | null = null;
      for (let i = 0; i < W - 14; i += 1) {
        const u = i + t * 8;
        const y = Math.round(18 + Math.sin(u / 7) * 5 + Math.sin(u / 3.1) * 2);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(i, Math.min(y, prev ?? y), 1, Math.abs(y - (prev ?? y)) + 1);
        prev = y;
      }
      glyph(ctx, "shield", W - 11, 13, pal);
      break;
    }
    case "guard": {
      ctx.fillStyle = pal.night ? "#3D1F1B" : "#F6DCD6";
      ctx.fillRect(4, 12, 16, 12);
      for (let i = 4; i < W - 4; i += 1) {
        ctx.fillStyle = (i >> 1) % 2 ? SUN : "#C62D1F";
        ctx.fillRect(i, 17, 1, 2);
      }
      const period = 5;
      const phase = (t % period) / period;
      const pos = phase < 0.8 ? Math.round(64 - (phase / 0.8) * 40) : 64;
      ctx.fillStyle = pal.ink;
      ctx.fillRect(pos - 3, 13, 7, 10);
      ctx.fillStyle = SUN;
      ctx.fillRect(pos - 2, 14, 5, 8);
      if (on && phase >= 0.72 && phase < 0.95) {
        ctx.fillStyle = pal.up;
        const yy = 6 - Math.floor((phase - 0.72) * 20);
        ctx.fillRect(pos + 6, yy + 2, 5, 1);
        ctx.fillRect(pos + 8, yy, 1, 5);
      }
      ctx.fillStyle = pal.ink2;
      ctx.fillRect(W - 6, 9, 1, 18);
      ctx.fillStyle = pal.up;
      ctx.fillRect(W - 5, 9, 4, 3);
      break;
    }
    case "stairs": {
      const steps = 5;
      for (let s = 0; s < steps; s += 1) {
        const sx = 10 + s * 15;
        const sy = 30 - s * 5;
        ctx.fillStyle = "#B07A44";
        ctx.fillRect(sx, sy, 15, H - sy);
        ctx.fillStyle = "#E2BD86";
        ctx.fillRect(sx, sy, 15, 1);
      }
      const k = on ? Math.floor(t / 0.9) % (steps + 2) : steps;
      for (let s = 0; s < Math.min(k, steps); s += 1) glyph(ctx, "coin", 14 + s * 15, 21 - s * 5, pal);
      break;
    }
    case "sweep": {
      for (let i = 0; i < 4; i += 1) glyph(ctx, "coin", 6 + (i % 2) * 5, 24 - i * 5, pal);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(W - 26, 8, 22, 24);
      ctx.fillStyle = shade("#17788C", 0.4);
      ctx.fillRect(W - 26, 8, 22, 2);
      ctx.fillStyle = pal.card;
      ctx.fillRect(W - 21, 18, 12, 4);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(W - 17, 19, 4, 2);
      if (on) {
        const p = (t % 1.4) / 1.4;
        glyph(ctx, "coin", Math.round(18 + p * (W - 50)), Math.round(20 - Math.sin(p * Math.PI) * 14), pal);
      }
      break;
    }
    case "gas": {
      const colors = ["#1E6B7D", "#8A5A2B", "#17788C"];
      const levels = [16, 9, 20];
      for (let i = 0; i < 3; i += 1) {
        const bx = 12 + i * 26;
        ctx.fillStyle = pal.rule;
        ctx.fillRect(bx, 6, 14, 26);
        ctx.fillStyle = pal.card;
        ctx.fillRect(bx + 2, 8, 10, 22);
        const level = on ? Math.max(4, levels[i]! - (Math.floor(t * 2 + i) % 6)) : levels[i]!;
        ctx.fillStyle = colors[i]!;
        ctx.fillRect(bx + 2, 30 - level, 10, level);
      }
      break;
    }
  }
  ctx.globalAlpha = 1;
  if (!on) {
    // asleep: a still "z" (no blinking when off)
    ctx.fillStyle = pal.ink2;
    ctx.fillRect(80, 4, 4, 1);
    ctx.fillRect(82, 5, 1, 1);
    ctx.fillRect(81, 6, 1, 1);
    ctx.fillRect(80, 7, 4, 1);
  }
}

/** The waterfall (W x H): bars rise in four steps one after another from `T0`; dotted connectors once a bar lands. */
/** When the waterfall's last bar has finished rising (local seconds). */
export const WATERFALL_END_S = 0.3 + 0.25 * 8 + 0.5;

/** How far bar `index` has risen at local time `T` (0..1 in 4 steps: bars grow in 4 steps, one after another). */
export function barProgress(index: number, T: number): number {
  const p = Math.max(0, Math.min(1, (T - 0.3 - index * 0.25) / 0.5));
  return Math.floor(p * 4) / 4;
}

/**
 * The waterfall at local time `T` (seconds since it came into view; the
 * caller passes WATERFALL_END_S or more for the end state). Every bar,
 * Net included, is drawn once T has passed its slot.
 */
export function drawWaterfall(ctx: Surface, fall: Waterfall, W: number, H: number, T: number, pal: Pal): void {
  ctx.clearRect(0, 0, W, H);
  const top = 4;
  const base = H - 5;
  const span = Math.max(1e-9, fall.max - fall.min);
  const y = (value: number) => Math.round(base - ((Math.max(fall.min, Math.min(fall.max, value)) - fall.min) / span) * (base - top));
  ctx.fillStyle = pal.rule;
  for (let i = 0; i < W; i += 4) ctx.fillRect(i, base + 1, 2, 1);
  if (fall.min < 0 && fall.max > 0) {
    ctx.fillStyle = pal.ink3;
    for (let i = 0; i < W; i += 2) ctx.fillRect(i, y(0), 1, 1);
  }
  const n = fall.bars.length;
  const slot = Math.floor(W / n);
  const bw = Math.max(4, Math.round(slot * 0.62));
  fall.bars.forEach((bar, index) => {
    const stepped = barProgress(index, T);
    const x = index * slot + Math.round((slot - bw) / 2);
    const from = bar.kind === "total" || bar.kind === "start" ? Math.max(fall.min, Math.min(0, fall.max)) : bar.from;
    const yTop = Math.min(y(from), y(bar.to));
    const yBot = Math.max(y(from), y(bar.to));
    const height = Math.max(2, yBot - yTop);
    const color = bar.kind === "start" ? pal.ink3 : bar.kind === "up" ? pal.up : bar.kind === "down" ? pal.down : pal.accent;
    const shown = Math.max(stepped > 0 ? 2 : 0, Math.round(height * stepped));
    const by = bar.kind === "down" || (bar.kind === "total" && bar.to < 0) ? yTop : yBot - shown;
    ctx.fillStyle = color;
    ctx.fillRect(x, by, bw, shown);
    if (shown > 2) {
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.fillRect(x, by, bw, 1);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(x + bw - 1, by + 1, 1, shown - 1);
    }
    if (index < n - 1 && stepped >= 1) {
      ctx.fillStyle = pal.ink3;
      const ny = y(bar.to);
      for (let j = x + bw + 1; j < (index + 1) * slot + Math.round((slot - bw) / 2); j += 2) ctx.fillRect(j, ny, 1, 1);
    }
  });
}

/** A small Ely for the insights header (mini sprite, talking). */
export function drawTalkingEly(ctx: Surface, T: number): void {
  ctx.clearRect(0, 0, 20, 22);
  drawGrid(ctx, elyMini({ gear: "lamp", ...(Math.floor(T * 5) % 2 ? { mouth: "o" as const } : {}) }), 2, 4, 1);
}
