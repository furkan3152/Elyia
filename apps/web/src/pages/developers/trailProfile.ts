/**
 * The manual's index as a pixel elevation profile (pure): five camps on one
 * trail (base camp, the Floor, your range, the Summit, the Guide), each at
 * its altitude, the ground banded by height (Floor teal, Ridge ochre, Summit
 * aqua and snow). Ely walks the trail from camp to camp.
 */
import type { PixelSurface } from "../../pixel/draw";
import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, SUN, type PixelGrid } from "../../pixel/ely";
import { shade } from "../../pixel/topo";

export const PROFILE_H = 50;
/** Camp heights as fractions of the sheet (1 = top). Camps sit at the centres of five equal columns. */
export const CAMP_HEIGHTS: readonly number[] = [0.1, 0.36, 0.58, 1, 0.7];

export function campX(index: number, w: number, count = CAMP_HEIGHTS.length): number {
  return Math.round(((index + 0.5) / count) * w);
}

/** Ground line (pixels from the top) at x: cosine-eased between camps, level beyond the ends. */
export function profileTop(x: number, w: number): number {
  const n = CAMP_HEIGHTS.length;
  const y = (f: number) => Math.round(PROFILE_H - 4 - f * (PROFILE_H - 16));
  const first = campX(0, w);
  const last = campX(n - 1, w);
  if (x <= first) return y(CAMP_HEIGHTS[0]!);
  if (x >= last) return y(CAMP_HEIGHTS[n - 1]!);
  const span = w / n;
  const i = Math.min(n - 2, Math.floor((x - first) / span));
  const t = (x - campX(i, w)) / span;
  const k = (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2;
  const f = CAMP_HEIGHTS[i]! + (CAMP_HEIGHTS[i + 1]! - CAMP_HEIGHTS[i]!) * k;
  return y(f);
}

const BANDS: readonly string[] = [...LAYERS.Floor.slice(1, 4), ...LAYERS.Ridge.slice(1, 4), ...LAYERS.Summit.slice(1, 5)];

let walker: PixelGrid | null = null;

export function paintProfile(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, w: number, seconds: number, still: boolean, highlight: number, line: string = INK): void {
  ctx.clearRect(0, 0, w, PROFILE_H);
  for (let x = 0; x < w; x += 1) {
    const top = profileTop(x, w);
    for (let y = top; y < PROFILE_H; y += 1) {
      // colour by altitude: the lower the pixel, the deeper the band
      const alt = 1 - y / PROFILE_H;
      const k = Math.min(BANDS.length - 1, Math.max(0, Math.floor(alt * BANDS.length * 1.1)));
      let c = BANDS[k]!;
      if (y > top && (PROFILE_H - y) % 4 === 0) c = shade(c, -0.18);
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
  }
  // the trail: dotted along the ground
  ctx.fillStyle = line;
  for (let x = 1; x < w; x += 3) ctx.fillRect(x, profileTop(x, w) - 2, 1, 1);
  // camps: a flag each, the highlighted camp in sun yellow
  CAMP_HEIGHTS.forEach((_, index) => {
    const fx = campX(index, w);
    const top = profileTop(fx, w);
    ctx.fillStyle = line;
    ctx.fillRect(fx, top - 9, 1, 9);
    ctx.fillStyle = index === highlight ? SUN : ROPE_RED;
    const wave = still ? 0 : (Math.floor(seconds * 2) + index) % 2;
    ctx.fillRect(fx + 1, top - 9, 5, 1);
    ctx.fillRect(fx + 1, top - 8, 5 - wave, 1);
    ctx.fillRect(fx + 1, top - 7, 4 + wave, 1);
  });
  // Ely walks the trail, base camp to the Guide, in steps (end state: on the Summit)
  walker ??= mini(elySprite({ gear: "rope", eye: "happy" }));
  const first = campX(0, w);
  const last = campX(CAMP_HEIGHTS.length - 1, w);
  const cycle = 24;
  const p = still ? (campX(3, w) - first) / (last - first) : ((seconds % cycle) / cycle) * 1.15;
  const ex = Math.round(first + Math.min(1, p) * (last - first)) - 4;
  const bob = !still && p < 1 ? Math.floor(seconds * 4) % 2 : 0;
  drawGrid(ctx, walker, ex - 8, profileTop(ex, w) - 17 - bob, 1);
}
