/**
 * The pixel trail gauge (pure drawing). Every rule is a short climb: the
 * trail rises in altitude bands from "25% away" on the left to your line,
 * a flag on the right. Ely stands where the reading is now; the stretch
 * already climbed is rope, the rest is dotted. Crossed: Ely wears the crown
 * at the flag. Event rules (fills, bridges) are a radio mast listening.
 */
import { drawGrid, type PixelSurface } from "../../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, SUN, type PixelGrid } from "../../../pixel/ely";
import { shade } from "../../../pixel/topo";

/** Full scale: the left end of the trail is this far (fraction) from your line. */
export const TRAIL_SPAN = 0.25;
export const TRAIL_H = 38;
export const TRAIL_H_COMPACT = 14;

export interface TrailFrame {
  readonly w: number;
  readonly compact: boolean;
  /** "event" rules listen on a mast; "level" rules climb to a flag. */
  readonly kind: "level" | "event";
  readonly met: boolean;
  /** Fraction still to travel (0 = there), null = no reading yet. */
  readonly gap: number | null;
  readonly seconds: number;
  readonly still: boolean;
  /** Ink for the dotted trail and outlines (follows the sheet). */
  readonly ink: string;
}

/** 0..1 along the trail for a reading `gap` away (crossed = 1, no reading = 0). */
export function trailProgress(met: boolean, gap: number | null): number {
  if (met) return 1;
  if (gap === null || !Number.isFinite(gap)) return 0;
  return 1 - Math.min(Math.max(gap, 0), TRAIL_SPAN) / TRAIL_SPAN;
}

const SPRITES: { climb?: PixelGrid; top?: PixelGrid; watch?: PixelGrid } = {};
function sprites() {
  SPRITES.climb ??= mini(elySprite({ gear: "lamp" }));
  SPRITES.top ??= mini(elySprite({ gear: "crown", eye: "happy", mouth: "grin" }));
  SPRITES.watch ??= mini(elySprite({ gear: "goggles", fur: "Night", horn: "Obsidian" }));
  return SPRITES as Required<typeof SPRITES>;
}

/** The trail's geometry for a canvas `w` wide. */
export function trailGeometry(w: number, compact: boolean) {
  const h = compact ? TRAIL_H_COMPACT : TRAIL_H;
  const start = 3;
  const flag = w - (compact ? 6 : 10);
  const base = h - (compact ? 3 : 4);
  const rise = compact ? 5 : 14;
  const surface = (x: number) => Math.round(base - rise * Math.pow(Math.max(0, Math.min(1, (x - start) / Math.max(1, flag - start))), 1.3));
  return { h, start, flag, base, surface };
}

export function drawTrail(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, frame: TrailFrame): void {
  const { w, compact, kind, met, gap, ink } = frame;
  const T = frame.still ? 0 : frame.seconds;
  const { h, start, flag, surface } = trailGeometry(w, compact);
  ctx.clearRect(0, 0, w, h);

  if (kind === "event") {
    // flat ground, a mast in the middle with waves stepping out twice a second
    const ground = h - 3;
    ctx.fillStyle = ink;
    for (let x = 1; x < w - 1; x += 2) ctx.fillRect(x, ground, 1, 1);
    const mx = Math.floor(w / 2);
    const top = compact ? 2 : 6;
    ctx.fillRect(mx, top, 1, ground - top);
    ctx.fillRect(mx - 2, ground - 1, 5, 1);
    ctx.fillStyle = met ? "#1F7A4C" : ROPE_RED;
    ctx.fillRect(mx - 1, top - 1, 3, 2);
    const ring = frame.still ? 2 : Math.floor(T * 2) % 3;
    ctx.fillStyle = ink;
    for (let r = 1; r <= ring + 1; r += 1) {
      const radius = 2 + r * (compact ? 2 : 3);
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.abs(dy) > radius * 0.7) continue;
        const dx = Math.round(Math.sqrt(radius * radius - dy * dy));
        ctx.fillRect(mx - dx, top + dy, 1, 1);
        ctx.fillRect(mx + dx, top + dy, 1, 1);
      }
    }
    if (!compact) drawGrid(ctx, sprites().watch, Math.max(1, mx - 30), ground - 17, 1);
    return;
  }

  // the slope, in Ridge altitude bands, with an ink edge
  const bands = LAYERS.Ridge;
  for (let x = start; x <= flag + 2 && x < w; x += 1) {
    const top = surface(Math.min(x, flag));
    for (let y = top + 1; y < h; y += 1) {
      const band = Math.min(bands.length - 1, Math.floor((y - top - 1) / (compact ? 2 : 3)));
      ctx.fillStyle = (y - top - 1) % (compact ? 2 : 3) === 0 && y > top + 1 ? shade(bands[4 - band]!, -0.2) : bands[4 - band]!;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
  }
  // quarter ticks
  ctx.fillStyle = ink;
  for (const at of [0.25, 0.5, 0.75]) {
    const x = Math.round(start + at * (flag - start));
    ctx.fillRect(x, surface(x) + 1, 1, compact ? 1 : 2);
  }

  const progress = trailProgress(met, gap);
  const cx = Math.round(start + progress * (flag - start));
  // the climbed stretch as rope (red and sun, two pixels each), the rest dotted
  if (gap !== null || met) {
    for (let x = start; x <= cx; x += 1) {
      ctx.fillStyle = (x >> 1) % 2 ? SUN : ROPE_RED;
      ctx.fillRect(x, surface(x) - 1, 1, 1);
    }
  }
  ctx.fillStyle = ink;
  for (let x = cx + 2; x < flag; x += 2) ctx.fillRect(x, surface(x) - 1, 1, 1);

  // the flag at your line, waving twice a second
  const fy = surface(flag);
  const pole = compact ? 8 : 14;
  ctx.fillStyle = ink;
  ctx.fillRect(flag, fy - pole, 1, pole);
  const wave = frame.still ? 0 : Math.floor(T * 2) % 2;
  ctx.fillStyle = met ? "#1F7A4C" : SUN;
  const rows = compact ? 3 : 5;
  for (let y = 0; y < rows; y += 1) ctx.fillRect(flag + 1, fy - pole + y, (compact ? 4 : 6) - (y === Math.floor(rows / 2) ? wave : 0) - (y === 0 || y === rows - 1 ? 1 : 0), 1);

  // Ely (or a marker on compact gauges) at the reading
  // no reading yet (no line set): Ely waits at the trailhead
  const sy = surface(Math.min(cx, flag));
  if (gap === null && !met && compact) return;
  if (compact) {
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 2, sy - 4, 5, 4);
    ctx.fillStyle = met ? "#1F7A4C" : SUN;
    ctx.fillRect(cx - 1, sy - 3, 3, 2);
    return;
  }
  const bob = frame.still || met ? 0 : Math.floor(T * 2) % 2;
  const sprite = met ? sprites().top : sprites().climb;
  const ex = Math.max(0, Math.min(w - 16, met ? flag - 16 : cx - 8));
  drawGrid(ctx, sprite, ex, sy - 17 - bob, 1);
}
