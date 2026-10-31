/**
 * The grade cards' little side views (pure): a meadow trail, a rocky
 * mountain ridge and an alpine ice wall, each with its painted blaze and Ely
 * on the slope (strolling, roped up, holding on).
 */
import type { PixelSurface } from "../../pixel/draw";
import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, SUN, WHITE, type PixelGrid } from "../../pixel/ely";
import { shade } from "../../pixel/topo";

export const SLOPE_W = 72;
export const SLOPE_H = 40;

export type GradeBand = "trail" | "mountain" | "alpine";

const PALETTE: Readonly<Record<GradeBand, readonly string[]>> = {
  trail: ["#5E8F5A", "#7FB08A", "#A9D3B4", "#C9DDA0", "#E2EDC0"],
  mountain: LAYERS.Ridge,
  alpine: LAYERS.Summit,
};
const STEEP: Readonly<Record<GradeBand, number>> = { trail: 0.2, mountain: 0.48, alpine: 0.3 };
/** The alpine ice wall: where it stands and how high its top is. */
const WALL_X = 38;
const WALL_TOP = 8;
const BLAZE: Readonly<Record<GradeBand, readonly string[]>> = { trail: [SUN, SUN, SUN], mountain: [WHITE, ROPE_RED, WHITE], alpine: [WHITE, "#1E5AA8", WHITE] };

const sprites = new Map<GradeBand, PixelGrid>();
function spriteOf(band: GradeBand): PixelGrid {
  let sprite = sprites.get(band);
  if (!sprite) {
    sprite = mini(elySprite(band === "trail" ? { gear: "lamp" } : band === "mountain" ? { gear: "rope", eye: "happy" } : { gear: "rope", eye: "worried", mouth: "o" }));
    sprites.set(band, sprite);
  }
  return sprite;
}

/** Ground line of the slope at x (rises left to right). */
export function slopeTop(band: GradeBand, x: number): number {
  const base = band === "alpine" && x >= WALL_X ? WALL_TOP - 0.15 * (x - WALL_X) : SLOPE_H - 5 - STEEP[band] * (x - 6);
  const rock = band === "trail" ? 0 : (x * 7) % 5 === 0 ? -1 : (x * 3) % 7 === 0 ? 1 : 0;
  return Math.round(Math.max(3, Math.min(SLOPE_H - 3, base + rock)));
}

export function paintSlope(ctx: PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void }, band: GradeBand, seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, SLOPE_W, SLOPE_H);
  const pal = PALETTE[band];
  for (let x = 0; x < SLOPE_W; x += 1) {
    const top = slopeTop(band, x);
    for (let y = top; y < SLOPE_H; y += 1) {
      const depth = y - top;
      const k = Math.min(pal.length - 1, Math.floor(depth / 3));
      let c = pal[pal.length - 1 - k]!;
      if (depth > 0 && depth % 3 === 0) c = shade(c, -0.2);
      if (band === "alpine" && depth < 2) c = WHITE;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
  }
  if (band === "alpine") {
    // the wall's face, inked
    ctx.fillStyle = INK;
    const a = slopeTop(band, WALL_X);
    const b = slopeTop(band, WALL_X - 1);
    ctx.fillRect(WALL_X, a, 1, b - a + 1);
  }
  // the trail: dotted path along the ground
  if (band === "trail") {
    ctx.fillStyle = "#8A5A2B";
    for (let x = 2; x < SLOPE_W; x += 3) ctx.fillRect(x, slopeTop(band, x) + 2, 2, 1);
  }
  // the fixed rope up the face
  if (band !== "trail") {
    for (let x = 4; x < SLOPE_W - 4; x += 1) {
      if (band === "alpine" && x < WALL_X - 1) continue;
      ctx.fillStyle = (x >> 1) % 2 ? SUN : ROPE_RED;
      ctx.fillRect(x, slopeTop(band, x) - 2, 1, 1);
    }
    if (band === "alpine") {
      // the fixed line down the face of the wall
      for (let y = WALL_TOP - 2; y < slopeTop(band, WALL_X - 1); y += 1) {
        ctx.fillStyle = (y >> 1) % 2 ? SUN : ROPE_RED;
        ctx.fillRect(WALL_X - 2, y, 1, 1);
      }
    }
  }
  // the blaze on a rock, near the top
  const bx = SLOPE_W - 14;
  const by = slopeTop(band, bx) + 5;
  ctx.fillStyle = INK;
  ctx.fillRect(bx - 1, by - 1, 8, 5);
  BLAZE[band].forEach((colour, row) => {
    ctx.fillStyle = colour;
    ctx.fillRect(bx, by + row, 6, 1);
  });
  // Ely on the slope
  const T = still ? 0 : seconds;
  const step = Math.floor(T * 2) % 2;
  const shake = band === "alpine" && !still && Math.floor(T * 6) % 4 === 0 ? 1 : 0;
  let ex: number;
  let ey: number;
  if (band === "alpine") {
    // hanging on the face of the wall, beside the fixed line
    ex = WALL_X - 18;
    ey = 12;
  } else {
    const pace = still ? 0 : Math.floor(T * 2) % 14;
    ex = band === "trail" ? 16 + (pace < 7 ? pace : 14 - pace) : 28;
    ey = slopeTop(band, ex + 8) - 16 - (band === "trail" ? step : 0);
  }
  drawGrid(ctx, spriteOf(band), ex + shake, ey, 1);
  if (band === "alpine") {
    // a sweat drop
    const d = still ? 2 : Math.floor((T * 6) % 6);
    ctx.fillStyle = "#6FD3E3";
    ctx.fillRect(ex - 2, ey + 3 + d, 1, 2);
  }
}
