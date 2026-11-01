/**
 * Drawing helpers for the portal canvases, ported from the v2 mockup
 * (elyia-design/v2/src/app.js): layer zones, the land strip, camp flags and
 * cached half-size Ely sprites. Pure apart from the canvas they paint.
 */
import { elySprite, mini, type ElyTraits, type PixelGrid } from "../../../pixel/ely";
import { drawGrid } from "../../../pixel/draw";
import { shade } from "../../../pixel/topo";

export const ZONES = {
  floor: ["#5FB0B8", "#2D8796", "#1E6B7D", "#0F4C5C"],
  ridge: ["#E2BD86", "#C08D55", "#8A5A2B", "#6B4423"],
  summit: ["#FFFFFF", "#C3EAF0", "#85CCD8", "#4FA7BA"],
} as const;
export type Zone = keyof typeof ZONES;

export const SUN = "#F2C200";
export const SUN_SHADE = "#B89100";
export const ROPE_RED = "#C62D1F";

/** Avatar trait sets of the mockup (AV). */
export const AVATAR: Readonly<Record<"idle" | "blink" | "talk" | "talkOpen" | "climb" | "summit" | "worry", ElyTraits>> = {
  idle: { gear: "lamp" },
  blink: { gear: "lamp", eye: "blink" },
  talk: { gear: "lamp", mouth: "smile" },
  talkOpen: { gear: "lamp", mouth: "o" },
  climb: { gear: "rope", eye: "happy" },
  summit: { gear: "crown", eye: "happy", mouth: "grin" },
  worry: { gear: "rope", eye: "worried", mouth: "o" },
};

const minis = new Map<string, PixelGrid>();
/** Half-size (16 x 17) Ely, memoised per trait set. */
export function elyMini(traits: ElyTraits): PixelGrid {
  const key = JSON.stringify(traits);
  let grid = minis.get(key);
  if (!grid) {
    grid = mini(elySprite(traits));
    minis.set(key, grid);
  }
  return grid;
}

export function drawMini(ctx: CanvasRenderingContext2D, traits: ElyTraits, x: number, y: number) {
  drawGrid(ctx, elyMini(traits), x, y, 1);
}

/** Reads sheet tokens ("--ink" -> "rgb(22,32,27)") for one frame. */
export function tokenReader(element: Element): (name: string) => string {
  const styles = getComputedStyle(element);
  const cache = new Map<string, string>();
  return (name) => {
    let value = cache.get(name);
    if (value === undefined) {
      const raw = styles.getPropertyValue(name).trim();
      value = /^\d/u.test(raw) ? `rgb(${raw.split(/\s+/u).join(",")})` : raw || "#888";
      cache.set(name, value);
    }
    return value;
  };
}

/** Smoothstep between a and b. */
export function smooth(a: number, b: number, u: number): number {
  const k = Math.max(0, Math.min(1, (u - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Layer-zoned land under a profile (0..1 heights). Returns the top row of each column. */
export function drawLand(ctx: CanvasRenderingContext2D, w: number, h: number, profile: (u: number) => number, zoneOf: (u: number) => Zone, band = 3, lift = 4): number[] {
  const tops: number[] = [];
  for (let i = 0; i < w; i += 1) {
    const u = i / Math.max(1, w - 1);
    const top = Math.round(h - 2 - profile(u) * (h - lift));
    tops.push(top);
    const zone = ZONES[zoneOf(u)];
    for (let y = top; y < h; y += 1) {
      const k = Math.min(zone.length - 1, Math.floor((y - top) / band));
      const seam = (y - top) % band === 0 && y > top;
      ctx.fillStyle = seam ? shade(zone[k]!, -0.2) : zone[k]!;
      ctx.fillRect(i, y, 1, 1);
    }
    ctx.fillStyle = shade(zone[0], -0.38);
    ctx.fillRect(i, top, 1, 1);
  }
  return tops;
}

export type FlagState = "done" | "next" | "todo";

/** A camp flag: done is rope red and waves at 1 Hz, next is sun, todo the strong rule. */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, state: FlagState, seconds: number, token: (name: string) => string, still = false) {
  ctx.fillStyle = token("--ink-2");
  ctx.fillRect(x, y - 7, 1, 7);
  ctx.fillStyle = state === "done" ? ROPE_RED : state === "next" ? SUN : token("--rule-strong");
  const wave = state === "done" && !still ? Math.floor(seconds * 2) % 2 : 0;
  ctx.fillRect(x + 1, y - 7, 4 - wave, 2);
  ctx.fillRect(x + 1, y - 5, 3 + wave, 1);
}

/** Draws a dotted path between camps: accent dots where walked, rule dots where pending. */
export function drawTrail(ctx: CanvasRenderingContext2D, tops: readonly number[], from: number, to: number, walkedTo: number | null, token: (name: string) => string) {
  for (let i = from; i <= to; i += 1) {
    const walked = walkedTo !== null && i <= walkedTo;
    if (walked ? i % 2 === 0 : i % 3 === 0) {
      ctx.fillStyle = walked ? token("--accent") : token("--rule-strong");
      ctx.fillRect(i, (tops[i] ?? 0) - 2, 1, 1);
    }
  }
}
