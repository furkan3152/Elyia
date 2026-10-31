/**
 * The 404 sheet in pixels (pure): a surveyed elevation map torn off at the
 * right, blank paper beyond it, the YOU ARE HERE pin out in the blank, base
 * camp on the map and a dotted trail between them. Ely starts lost at the
 * pin (worried, a "?" over its head), walks the trail back and arrives at
 * base camp (happy). The end state (reduced motion) is Ely at base camp.
 */
import type { PixelSurface } from "../../pixel/draw";
import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, SUN, type PixelGrid } from "../../pixel/ely";
import { rngOf, shade, topoField, type HeightField } from "../../pixel/topo";

export const SHEET_W = 240;
export const SHEET_H = 120;
/** Where the survey stops (the tear wanders around this column). */
export const EDGE = 150;
export const CAMP: readonly [number, number] = [88, 70];
export const CYCLE = 16;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The pin for a reading: out on the blank paper, its height from the lost path. */
export function pinFor(y: number): Point {
  return { x: 206, y: Math.round(36 + y * (SHEET_H - 62)) };
}

/** The tear: the surveyed edge per row, jagged and stable. */
export function tearAt(row: number): number {
  const r = rngOf(404 + row * 13)();
  return EDGE + Math.round(Math.sin(row / 6) * 3 + (r - 0.5) * 5);
}

/** The trail back: a quadratic curve from the pin, over the tear, to camp, sampled per pixel step. */
export function trailPoints(pin: Point): Point[] {
  const ctrl = { x: EDGE + 8, y: Math.min(SHEET_H - 10, Math.max(10, (pin.y + CAMP[1]) / 2 + 26)) };
  const out: Point[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: Math.round(u * u * pin.x + 2 * u * t * ctrl.x + t * t * CAMP[0]), y: Math.round(u * u * pin.y + 2 * u * t * ctrl.y + t * t * CAMP[1]) });
  }
  return out;
}

/** Where Ely is in the cycle: lost at the pin, walking, home. */
export function elyPhase(seconds: number, still: boolean): { readonly phase: "lost" | "walk" | "home"; readonly t: number } {
  if (still) return { phase: "home", t: 1 };
  const s = ((seconds % CYCLE) + CYCLE) % CYCLE;
  if (s < 3.5) return { phase: "lost", t: 0 };
  if (s < 12) return { phase: "walk", t: (s - 3.5) / 8.5 };
  return { phase: "home", t: 1 };
}

let field: HeightField | null = null;
let max = 1;
const PALETTE = [...LAYERS.Floor.slice(2), ...LAYERS.Ridge.slice(2), ...LAYERS.Summit.slice(2)] as const;

function surveyField(): HeightField {
  if (!field) {
    field = topoField(EDGE + 8, SHEET_H, 404, [
      [40, 36, 1, 20],
      [70, 62, 0.6, 14],
      [118, 88, 0.85, 18],
      [128, 24, 0.7, 14],
      [24, 100, 0.55, 16],
      [92, 104, 0.35, 10],
    ]);
    max = 0;
    for (const row of field) for (const v of row) max = Math.max(max, v);
  }
  return field;
}

const sprites: { lost?: PixelGrid; walk?: PixelGrid; home?: PixelGrid } = {};

export interface SheetColours {
  /** The blank paper beyond the tear (the sheet's card). */
  readonly paper: string;
  /** Faint marks on the blank paper. */
  readonly faint: string;
  /** Ink of lines drawn on the blank paper (dark by DAY, light by NIGHT). */
  readonly line: string;
}

export function paintSheet(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, pin: Point, seconds: number, still: boolean, colours: SheetColours): void {
  const f = surveyField();
  const levels = PALETTE.length;
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);
  // blank paper with a survey-dot grid
  ctx.fillStyle = colours.paper;
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.fillStyle = colours.faint;
  for (let y = 4; y < SHEET_H; y += 8) for (let x = EDGE + 4; x < SHEET_W; x += 8) ctx.fillRect(x, y, 1, 1);
  // the surveyed part: banded elevation with contour pixels, cut at the tear
  const band = (v: number) => Math.min(levels - 1, Math.floor((v / max) * levels));
  for (let y = 0; y < SHEET_H; y += 1) {
    const edge = tearAt(y);
    const row = f[y]!;
    for (let x = 0; x < edge; x += 1) {
      const b = band(row[x]!);
      let c: string = PALETTE[b]!;
      const r = x + 1 < row.length ? band(row[x + 1]!) : b;
      const d = y + 1 < SHEET_H ? band(f[y + 1]![x]!) : b;
      if (r !== b || d !== b) c = shade(c, -0.28);
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
    // the torn edge: ink, then a one-pixel shadow on the blank side
    ctx.fillStyle = INK;
    ctx.fillRect(edge, y, 1, 1);
    const prev = y > 0 ? tearAt(y - 1) : edge;
    if (prev !== edge) ctx.fillRect(Math.min(prev, edge), y, Math.abs(prev - edge) + 1, 1);
    ctx.fillStyle = colours.faint;
    ctx.fillRect(edge + 1, y, 1, 1);
  }
  // question marks on the blank paper, mirrored about the blank's centre line
  const qs: readonly [number, number][] = [
    [172, 18],
    [228, 18],
    [178, 98],
    [222, 98],
  ];
  ctx.fillStyle = colours.faint;
  for (const [qx, qy] of qs) {
    ctx.fillRect(qx, qy, 3, 1);
    ctx.fillRect(qx + 3, qy + 1, 1, 2);
    ctx.fillRect(qx + 2, qy + 3, 1, 1);
    ctx.fillRect(qx + 1, qy + 4, 1, 1);
    ctx.fillRect(qx + 1, qy + 6, 1, 1);
  }
  // the trail back: dotted; the part already walked turns into footprints
  const trail = trailPoints(pin);
  const { phase, t } = elyPhase(seconds, still);
  const walked = Math.round(t * (trail.length - 1));
  for (let i = 0; i < trail.length; i += 4) {
    const p = trail[i]!;
    const onPaper = p.x > tearAt(p.y);
    ctx.fillStyle = i <= walked && phase !== "lost" ? ROPE_RED : onPaper ? colours.line : INK;
    ctx.fillRect(p.x, p.y, 1, 1);
  }
  // base camp: a stepped hut with a flag
  const [cx, cy] = CAMP;
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = INK;
    ctx.fillRect(cx - i - 1, cy - 8 + i, i * 2 + 3, 1);
    ctx.fillStyle = i < 2 ? "#FFFFFF" : ROPE_RED;
    ctx.fillRect(cx - i, cy - 8 + i, i * 2 + 1, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 6, cy - 2, 13, 4);
  ctx.fillStyle = "#B07A44";
  ctx.fillRect(cx - 5, cy - 2, 11, 3);
  ctx.fillStyle = SUN;
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(cx + 8, cy - 14, 1, 16);
  ctx.fillStyle = SUN;
  const wave = still ? 0 : Math.floor(seconds * 2) % 2;
  ctx.fillRect(cx + 9, cy - 14, 5, 1);
  ctx.fillRect(cx + 9, cy - 13, 5 - wave, 1);
  ctx.fillRect(cx + 9, cy - 12, 4 + wave, 1);
  // YOU ARE HERE: a sun-yellow diamond in a dashed ring (the ring steps once a second)
  const ring = still ? 0 : Math.floor(seconds) % 2;
  ctx.fillStyle = colours.line;
  for (let a = 0; a < 16; a += 1) {
    if ((a + ring) % 2 !== 0) continue;
    const ang = (a / 16) * Math.PI * 2;
    ctx.fillRect(Math.round(pin.x + Math.cos(ang) * 9), Math.round(pin.y + Math.sin(ang) * 9), 1, 1);
  }
  for (let dy = -4; dy <= 4; dy += 1) {
    const half = 4 - Math.abs(dy);
    ctx.fillStyle = INK;
    ctx.fillRect(pin.x - half - 1, pin.y + dy, half * 2 + 3, 1);
    ctx.fillStyle = SUN;
    ctx.fillRect(pin.x - half, pin.y + dy, half * 2 + 1, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(pin.x, pin.y, 1, 1);
  // Ely
  sprites.lost ??= mini(elySprite({ gear: "rope", eye: "worried", mouth: "o" }));
  sprites.walk ??= mini(elySprite({ gear: "lamp" }));
  sprites.home ??= mini(elySprite({ gear: "lamp", eye: "happy", mouth: "grin" }));
  let ex: number;
  let ey: number;
  let sprite: PixelGrid;
  if (phase === "lost") {
    ex = pin.x - 8 + (Math.floor(seconds * 6) % 4 === 0 ? 1 : 0);
    ey = pin.y - 26;
    sprite = sprites.lost;
    // "?" bubble
    ctx.fillStyle = colours.line;
    const qx = pin.x + 8;
    const qy = pin.y - 32;
    ctx.fillRect(qx, qy, 3, 1);
    ctx.fillRect(qx + 3, qy + 1, 1, 2);
    ctx.fillRect(qx + 2, qy + 3, 1, 1);
    ctx.fillRect(qx + 1, qy + 4, 1, 1);
    ctx.fillRect(qx + 1, qy + 6, 1, 1);
  } else if (phase === "walk") {
    const p = trail[Math.round(Math.floor(t * 24) / 24 * (trail.length - 1))]!;
    const bob = Math.floor(seconds * 4) % 2;
    ex = p.x - 8;
    ey = p.y - 17 - bob;
    sprite = sprites.walk;
  } else {
    ex = cx - 22;
    ey = cy - 15;
    sprite = sprites.home;
  }
  drawGrid(ctx, sprite, ex, ey, 1);
}
