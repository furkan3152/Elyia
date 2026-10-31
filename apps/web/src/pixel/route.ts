/**
 * The route card's elevation profile in pixels (pure drawing): three
 * altitude bands (Summit, Ridge, Floor) with dithered seams, a stepped trail
 * from the pack through every waypoint (solid where settled, dotted ahead),
 * and Ely on the waypoint that is climbing now.
 */
import { routeProfile, type RouteStepInput } from "../topo/geometry/route";
import { drawGrid, type PixelSurface } from "./draw";
import { elySprite, INK, LAYERS, mini, type PixelGrid } from "./ely";

export interface PixelRouteStep extends RouteStepInput {
  readonly state: "settled" | "climbing" | "next" | "waiting" | "failed";
}

const BANDS = [LAYERS.Summit[3], LAYERS.Ridge[4], LAYERS.Floor[4]] as const;
let climber: PixelGrid | null = null;

/** Paints the profile on a `w` x `h` canvas; `gutter` keeps the band names clear of the trail. */
export function paintRouteProfile(ctx: PixelSurface, steps: readonly PixelRouteStep[], w: number, h: number, gutter: number, seconds = 0, still = false): void {
  const band = h / 3;
  for (let i = 0; i < 3; i += 1) {
    const y0 = Math.round(i * band);
    const y1 = Math.round((i + 1) * band);
    ctx.fillStyle = BANDS[i]!;
    ctx.fillRect(0, y0, w, y1 - y0);
    if (i > 0) {
      ctx.fillStyle = BANDS[i - 1]!;
      for (let x = 0; x < w; x += 2) ctx.fillRect(x + (i % 2), y0, 1, 1);
      ctx.fillStyle = INK;
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, y0, 1, 1);
    }
  }
  // gutter rule
  ctx.fillStyle = INK;
  for (let y = 0; y < h; y += 3) ctx.fillRect(Math.round(gutter) - 4, y, 1, 1);

  const profile = routeProfile(steps, w, h, undefined, gutter);
  const pts = [profile.start, ...profile.waypoints].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const done = steps[i - 1]!.state === "settled";
    const live = steps[i - 1]!.state === "climbing";
    ctx.fillStyle = INK;
    // a staircase: walk right, step up or down every few pixels
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const n = Math.max(1, Math.abs(dx));
    let k = 0;
    for (let s = 0; s <= n; s += 1) {
      const x = a.x + Math.round((dx * s) / n);
      const y = a.y + Math.round((dy * Math.min(1, s / (n * 0.7))) / 2) * 2;
      const draw = done || (live ? k % 2 === 0 : k % 3 === 0);
      if (draw) ctx.fillRect(x, y, 1, done ? 2 : 1);
      k += 1;
    }
    if (dy !== 0) {
      // the vertical riser at the end of the climb
      const yEnd = a.y + Math.round(dy / 2) * 2;
      const step = yEnd < b.y ? 1 : -1;
      for (let y = yEnd; y !== b.y; y += step) if (done || y % 2 === 0) ctx.fillRect(b.x, y, 1, 1);
    }
  }
  // the pack
  ctx.fillStyle = INK;
  ctx.fillRect(pts[0]!.x - 2, pts[0]!.y - 2, 5, 5);
  ctx.fillStyle = "#B07A44";
  ctx.fillRect(pts[0]!.x - 1, pts[0]!.y - 1, 3, 3);
  // Ely on the live waypoint
  const liveIndex = steps.findIndex((step) => step.state === "climbing");
  if (liveIndex >= 0) {
    climber ??= mini(elySprite({ gear: "rope", eye: "happy" }));
    const p = pts[liveIndex + 1]!;
    const bob = still ? 0 : Math.floor(seconds * 3) % 2;
    drawGrid(ctx, climber, p.x - 8, p.y - 24 - bob, 1);
  }
}
