/**
 * The first-ascents radar as a pixel sweep (pure). The scope is a height
 * map seen from above: the freshest launches sit nearest the centre, so the
 * centre is the summit (snow), then the Summit ice, the Ridge ochre and the
 * Floor teal at the rim, each ring edged with contour pixels. A sweep turns
 * once every 8 s in 64 steps; each blip lights up as the beam passes and
 * dims over two seconds (once per turn, never a flash). The picked launch
 * carries Ely and the first-ascent flag.
 */
import { rngOf, shade } from "../../pixel/topo";
import { CARD, INK, NIGHT_CARD, paintCached, paintEly, paintFlag, paintLabel, strataFor, SUN } from "../track/flow/pixelArt";
import type { LayerSurface } from "../track/flow/pixelArt";
import type { Blip } from "./radar";

export const SWEEP_SECONDS = 8;
const STEPS = 64;

/** The sweep's angle (radians, stepped) at `seconds`. */
export function sweepAngle(seconds: number): number {
  const turn = (((seconds % SWEEP_SECONDS) + SWEEP_SECONDS) % SWEEP_SECONDS) / SWEEP_SECONDS;
  return (Math.floor(turn * STEPS) / STEPS) * Math.PI * 2;
}

/** 0..1 glow of a blip at `angle` given the sweep angle: 1 just after the beam passes, fading over a quarter turn. */
export function blipGlow(angle: number, sweep: number): number {
  const tau = Math.PI * 2;
  const behind = (((sweep - angle) % tau) + tau) % tau;
  return behind < tau / 4 ? 1 - behind / (tau / 4) : 0;
}

/** Ring index (0 centre .. 3 rim) of a point at distance d from the centre in a scope of radius r, wobbling like a contour. */
function ringOf(d: number, r: number, theta: number, wobble: readonly number[]): number {
  const k = d / r + Math.sin(theta * 3 + wobble[0]!) * 0.025 + Math.sin(theta * 5 + wobble[1]!) * 0.015;
  return k < 0.22 ? 0 : k < 0.48 ? 1 : k < 0.74 ? 2 : 3;
}

export interface RadarFrame {
  readonly blips: readonly Blip[];
  readonly picked: string | null;
  readonly hover: string | null;
  readonly night: boolean;
  readonly seconds: number;
  readonly still: boolean;
}

interface ScopeCell {
  readonly color: string;
  readonly theta: number;
  readonly inside: boolean;
  readonly even: boolean;
}

const scopeCache = new Map<string, ReadonlyArray<ScopeCell | null>>();

/** The still scope (rings, contours, rim) per pixel, built once per size and sheet. */
function scopeBase(size: number, night: boolean): ReadonlyArray<ScopeCell | null> {
  const key = `${size}|${night}`;
  const hit = scopeCache.get(key);
  if (hit) return hit;
  const strata = strataFor(night);
  const c = (size - 1) / 2;
  const r = c - 6;
  const random = rngOf(31);
  const wobble = [random() * 6, random() * 6];
  const rings = [
    [strata.summit[0]!, strata.summit[1]!],
    [strata.summit[2]!, strata.summit[3]!],
    [strata.ridge[1]!, strata.ridge[2]!],
    [strata.floor[1]!, strata.floor[2]!],
  ] as const;
  const out: Array<ScopeCell | null> = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > r + 1) {
        out.push(null);
        continue;
      }
      if (d > r) {
        out.push({ color: INK, theta: 0, inside: false, even: false });
        continue;
      }
      const theta = Math.atan2(dy, dx);
      const ring = ringOf(d, r, theta, wobble);
      const right = ringOf(Math.hypot(dx + 1, dy), r, Math.atan2(dy, dx + 1), wobble);
      const down = ringOf(Math.hypot(dx, dy + 1), r, Math.atan2(dy + 1, dx), wobble);
      let color: string = (x + y) % 2 === 0 ? rings[ring]![0] : rings[ring]![1];
      if (ring !== right || ring !== down) color = shade(rings[ring]![1], -0.3);
      out.push({ color, theta: (theta + Math.PI * 2) % (Math.PI * 2), inside: true, even: (x + y) % 2 === 0 });
    }
  }
  if (scopeCache.size > 6) scopeCache.clear();
  scopeCache.set(key, out);
  return out;
}

export function paintRadar(ctx: LayerSurface, size: number, frame: RadarFrame): void {
  const { night, seconds: T, still } = frame;
  const sheet = night ? NIGHT_CARD : CARD;
  const c = (size - 1) / 2;
  const r = c - 6;
  const sweep = still ? -1 : sweepAngle(T);
  ctx.fillStyle = sheet;
  ctx.fillRect(0, 0, size, size);
  const base = scopeBase(size, night);
  paintCached(ctx, `radar|${size}|${night}`, size, size, (layer) => {
    for (let i = 0; i < base.length; i += 1) {
      const cell = base[i];
      if (!cell) continue;
      layer.fillStyle = cell.color;
      layer.fillRect(i % size, Math.floor(i / size), 1, 1);
    }
  });
  // the sweep: a dithered sun wedge trailing the beam, painted over the still scope
  if (sweep >= 0) {
    for (let i = 0; i < base.length; i += 1) {
      const cell = base[i];
      if (!cell?.inside) continue;
      const glow = blipGlow(cell.theta, sweep);
      if (glow <= 0.55) continue;
      if (glow > 0.97) ctx.fillStyle = SUN;
      else if (cell.even) ctx.fillStyle = shade(cell.color, night ? 0.25 : 0.35);
      else continue;
      ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
    }
  }
  // crosshair and compass ticks
  ctx.fillStyle = INK;
  for (let i = -r; i <= r; i += 1) {
    if (i % 3 === 0) {
      ctx.fillRect(Math.round(c + i), Math.round(c), 1, 1);
      ctx.fillRect(Math.round(c), Math.round(c + i), 1, 1);
    }
  }
  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";
  const mark = night ? "#EEE7D8" : INK;
  paintLabel(ctx, "N", c + 1, -1, mark, "center");
  paintLabel(ctx, "S", c + 1, size - 8, mark, "center");
  paintLabel(ctx, "W", 0, c - 4, mark, "left");
  paintLabel(ctx, "E", size, c - 4, mark, "right");

  // blips: pixel diamonds, lit as the beam passes; hollow when no trades
  let pickedAt: { x: number; y: number; name: string } | null = null;
  for (const blip of frame.blips) {
    const x = Math.round(c + Math.cos(blip.angle) * blip.r * r);
    const y = Math.round(c + Math.sin(blip.angle) * blip.r * r);
    const on = frame.picked === blip.ascent.name || frame.hover === blip.ascent.name;
    const glow = still ? 0 : blipGlow(blip.angle, sweep);
    const s = Math.max(2, Math.round(blip.size * 90));
    const closed = blip.ascent.condition === "closed";
    for (let dy = -s; dy <= s; dy += 1) {
      const half = s - Math.abs(dy);
      for (let dx = -half; dx <= half; dx += 1) {
        const rim = Math.abs(dx) === half;
        ctx.fillStyle = rim ? INK : on ? SUN : closed ? sheet : glow > 0.3 ? "#FFE27A" : "#D9822B";
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
    if (glow > 0.6) {
      // a pixel ring echoes once as the beam passes
      ctx.fillStyle = SUN;
      for (const [ex, ey] of [[0, -s - 2], [0, s + 2], [-s - 2, 0], [s + 2, 0]] as const) ctx.fillRect(x + ex, y + ey, 1, 1);
    }
    if (on) pickedAt = { x, y, name: blip.ascent.name };
  }
  if (pickedAt) {
    paintFlag(ctx, pickedAt.x + 4, pickedAt.y - 2, T, still);
    paintEly(ctx, "summit", pickedAt.x - 4, pickedAt.y - 1, { seconds: T, still });
    const below = pickedAt.y < c;
    paintLabel(ctx, pickedAt.name, pickedAt.x, below ? pickedAt.y + 5 : pickedAt.y - 32, INK, "center", SUN);
  }
}
