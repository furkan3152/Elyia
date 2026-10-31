/**
 * Pixel art for the flow pages (pure drawing on anything with `fillRect`):
 * the sky of a side view, banded strata, survey pins, a small hut, the
 * walking mini Ely with its moods, the summit flag and confetti. Every
 * drawing of bridge, swap, earn, track and discover shares these, so the
 * five pages speak one dialect of the reference scene.
 */
import { drawDisc, drawGrid, type PixelSurface } from "../../../pixel/draw";
import { AQUA, elySprite, INK, mini, mirror, ROPE_RED, SUN, WHITE, type ElyTraits, type PixelGrid } from "../../../pixel/ely";
import { DAY_SCENE, NIGHT_SCENE, type TextSurface } from "../../../pixel/scene";
import { rngOf, shade } from "../../../pixel/topo";

export const CARD = "#FFF9EC";
export const NIGHT_CARD = "#16211B";
export const UP = "#1F7A4C";
export const WARN = "#D9822B";

/** Altitude palettes, deep band first: what each layer's ground is made of. */
export const STRATA = {
  floor: ["#7DBFC4", "#4FA0A9", "#2D8796", "#1E6B7D", "#0F4C5C"],
  ridge: ["#E9CC9C", "#D3A66E", "#B07A44", "#8A5A2B", "#6B4423"],
  summit: ["#FFFFFF", "#DDF2F6", "#A9DCE6", "#6FBFCE", "#4FA7BA"],
  gold: ["#FFF3C4", "#F6DA72", "#E0B52E", "#B98A10", "#8A6100"],
} as const;
export type StratumName = keyof typeof STRATA;

export const NIGHT_STRATA: Readonly<Record<StratumName, readonly string[]>> = {
  floor: ["#3E7C84", "#2D6670", "#1F515C", "#163F49", "#0F3038"],
  ridge: ["#B89A70", "#97764E", "#765635", "#573E25", "#3F2C1A"],
  summit: ["#E6EEF2", "#B9CFD8", "#7FA2B2", "#56798C", "#3D5E70"],
  gold: ["#F6DA72", "#E0B52E", "#B98A10", "#8A6100", "#5E4200"],
};

export function strataFor(night: boolean): Readonly<Record<StratumName, readonly string[]>> {
  return night ? NIGHT_STRATA : STRATA;
}

/** Sky bands with dithered seams, the sun (day) or the moon and stars (night). */
export function paintSky(ctx: PixelSurface, w: number, h: number, night: boolean, sun: { readonly x: number; readonly y: number } | null = null, seconds = 0, still = false): void {
  const sky = (night ? NIGHT_SCENE : DAY_SCENE).sky;
  const band = Math.max(2, Math.ceil(h / sky.length));
  for (let y = 0; y < h; y += 1) {
    const k = Math.min(sky.length - 1, Math.floor(y / band));
    ctx.fillStyle = sky[k]!;
    ctx.fillRect(0, y, w, 1);
    if (y % band === band - 1 && k < sky.length - 1) {
      ctx.fillStyle = sky[k + 1]!;
      for (let x = y % 2; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (night) {
    const random = rngOf(77);
    for (let i = 0; i < Math.round(w / 5); i += 1) {
      const x = Math.floor(random() * w);
      const y = Math.floor(random() * h * 0.8);
      // a few stars twinkle, one change per 1.5 s at most
      if (!still && i % 5 === 0 && Math.floor(seconds / 1.5 + i) % 3 === 0) continue;
      ctx.fillStyle = i % 9 === 0 ? SUN : "#EEE7D8";
      ctx.fillRect(x, y, 1, 1);
    }
    if (sun) {
      drawDisc(ctx, sun.x, sun.y, 7, "#EEE7D8");
      drawDisc(ctx, sun.x + 3, sun.y - 2, 6, sky[1]!);
    }
  } else if (sun) {
    drawDisc(ctx, sun.x, sun.y, 9, SUN);
    ctx.fillStyle = "#FFE27A";
    for (let y = -6; y <= 3; y += 1) {
      const half = Math.round(Math.sqrt(36 - y * y) * 0.6);
      ctx.fillRect(Math.round(sun.x - 5 - half), Math.round(sun.y + y), half, 1);
    }
  }
}

/** A drifting cloud (day white, night slate). */
export function paintCloud(ctx: PixelSurface, cx: number, cy: number, w: number, night: boolean): void {
  const palette = night ? NIGHT_SCENE : DAY_SCENE;
  ctx.fillStyle = palette.cloud;
  for (let i = 0; i < w; i += 1) {
    const height = 2 + Math.round(2 * Math.sin((i / w) * Math.PI)) + ((i * 7) % 3 === 0 ? 1 : 0);
    ctx.fillRect(Math.round(cx + i), Math.round(cy - height), 1, height);
  }
  ctx.fillStyle = palette.cloudShadow;
  ctx.fillRect(Math.round(cx), Math.round(cy), w, 1);
}

/**
 * One column of ground from `top` down to `bottom`, in altitude bands of
 * `band` pixels with a darker contour pixel at every band edge, and an ink
 * pixel on the skyline: the reference's ridge, one column at a time.
 */
export function paintColumn(ctx: PixelSurface, x: number, top: number, bottom: number, colors: readonly string[], band: number, outline = true): void {
  const t = Math.round(top);
  for (let y = t; y < bottom; y += 1) {
    const k = Math.min(colors.length - 1, Math.floor((y - t) / band));
    const edge = (y - t) % band === 0 && y > t;
    ctx.fillStyle = edge ? shade(colors[k]!, -0.22) : colors[k]!;
    ctx.fillRect(x, y, 1, 1);
  }
  if (outline) {
    ctx.fillStyle = INK;
    ctx.fillRect(x, t, 1, 1);
  }
}

/** A survey pin: an ink post and a Silkscreen label on an ink plate. Returns the plate box. */
export function paintPin(ctx: TextSurface, w: number, x: number, y: number, text: string, options: { readonly toLeft?: boolean; readonly post?: number; readonly plate?: string; readonly ink?: string } = {}): { x: number; y: number; w: number; h: number } {
  const post = options.post ?? 6;
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, 1, post);
  const boxW = Math.ceil(ctx.measureText(text).width) + 6;
  const left = options.toLeft || x + boxW > w - 2 ? Math.max(1, x - boxW + 1) : x;
  ctx.fillStyle = options.plate ?? INK;
  ctx.fillRect(left, y - 10, boxW, 10);
  ctx.fillStyle = options.ink ?? CARD;
  ctx.fillText(text, left + 3, y - 9);
  return { x: left, y: y - 10, w: boxW, h: 10 };
}

/** Plain Silkscreen text (8 px), centred or left, with an optional plate. */
export function paintLabel(ctx: TextSurface, text: string, x: number, y: number, color: string, align: "left" | "center" | "right" = "left", plate?: string): number {
  const width = Math.ceil(ctx.measureText(text).width);
  const left = align === "center" ? Math.round(x - width / 2) : align === "right" ? Math.round(x - width) : Math.round(x);
  if (plate) {
    ctx.fillStyle = plate;
    ctx.fillRect(left - 2, y - 1, width + 4, 10);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, left, y);
  return width;
}

/** A small hut on the ground line at (x, ground): 11 px wide, a red A-roof, a lit door when `lit`. */
export function paintHut(ctx: PixelSurface, x: number, ground: number, lit: boolean, snow = false): void {
  const left = Math.round(x) - 5;
  const g = Math.round(ground);
  ctx.fillStyle = "#B07A44";
  ctx.fillRect(left, g - 6, 11, 6);
  ctx.fillStyle = "#8A5A2B";
  ctx.fillRect(left, g - 3, 11, 1);
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = i < 2 && snow ? WHITE : ROPE_RED;
    ctx.fillRect(left + 5 - i, g - 12 + i, i * 2 + 1, 1);
    ctx.fillStyle = INK;
    ctx.fillRect(left + 4 - i, g - 12 + i, 1, 1);
    ctx.fillRect(left + 6 + i, g - 12 + i, 1, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(left - 1, g - 6, 13, 1);
  ctx.fillRect(left + 4, g - 4, 3, 4);
  ctx.fillStyle = lit ? SUN : "#3B474D";
  ctx.fillRect(left + 5, g - 3, 1, 3);
}

export type MiniMood = "walk" | "blink" | "summit" | "worry" | "sleep" | "night" | "climb";

const MINI: Partial<Record<MiniMood, PixelGrid>> = {};
const MINI_LEFT: Partial<Record<MiniMood, PixelGrid>> = {};

/** The half-size Ely for scenes, by mood (memoised). */
export function miniEly(mood: MiniMood, facingLeft = false): PixelGrid {
  const traits: ElyTraits =
    mood === "summit"
      ? { gear: "crown", eye: "happy", mouth: "grin" }
      : mood === "worry"
        ? { gear: "rope", eye: "worried", mouth: "o" }
        : mood === "sleep"
          ? { gear: "cap", eye: "sleep", mouth: "flat", fur: "Snow" }
          : mood === "night"
            ? { gear: "goggles", fur: "Night", horn: "Obsidian" }
            : mood === "climb"
              ? { gear: "rope", eye: "happy" }
              : mood === "blink"
                ? { gear: "lamp", eye: "blink" }
                : { gear: "lamp" };
  const grid = (MINI[mood] ??= mini(elySprite(traits)));
  if (!facingLeft) return grid;
  return (MINI_LEFT[mood] ??= mirror(grid));
}

/**
 * Mini Ely standing with its feet at (x, foot): 16 x 17 sprite plus two
 * pixel legs that step while walking. `bob` lifts it a pixel.
 */
export function paintEly(ctx: PixelSurface, mood: MiniMood, x: number, foot: number, options: { readonly seconds?: number; readonly walking?: boolean; readonly still?: boolean; readonly facingLeft?: boolean } = {}): void {
  const T = options.seconds ?? 0;
  const still = options.still ?? false;
  const walking = (options.walking ?? false) && !still;
  const bob = walking ? Math.floor(T * 6) % 2 : mood === "summit" && !still ? Math.round(Math.abs(Math.sin(T * 5)) * 1) : 0;
  const shake = mood === "worry" && !still && Math.floor(T * 6) % 4 === 0 ? 1 : 0;
  const ex = Math.round(x) + shake;
  const ey = Math.round(foot);
  ctx.fillStyle = INK;
  ctx.fillRect(ex - 3, ey - 3 - bob, 2, 3);
  ctx.fillRect(ex + 2, ey - 3 - bob + (walking && bob === 0 ? 1 : 0), 2, 3 - (walking && bob === 0 ? 1 : 0));
  const blink = mood === "walk" && !still && Math.floor(T * 10) % 37 === 0;
  drawGrid(ctx, miniEly(blink ? "blink" : mood, options.facingLeft), ex - 8, ey - 19 - bob, 1);
  if (mood === "worry") {
    // the sweat drop slides down, about 1 Hz
    const d = still ? 2 : Math.floor((T * 6) % 6);
    ctx.fillStyle = AQUA;
    ctx.fillRect(ex + 7, ey - 16 + d, 1, 2);
  }
  if (mood === "sleep") {
    ctx.fillStyle = INK;
    const k = still ? 3 : (T * 3) % 8;
    const zy = ey - 22 - Math.round(k);
    ctx.fillRect(ex + 7, zy, 3, 1);
    ctx.fillRect(ex + 8, zy + 1, 1, 1);
    ctx.fillRect(ex + 7, zy + 2, 3, 1);
  }
}

/** The summit flag on a 12 px pole at (x, ground), waving at 2 Hz. */
export function paintFlag(ctx: PixelSurface, x: number, ground: number, seconds: number, still: boolean, color = ROPE_RED): void {
  const fx = Math.round(x);
  const fy = Math.round(ground) - 12;
  ctx.fillStyle = INK;
  ctx.fillRect(fx, fy, 1, 12);
  const wave = still ? 0 : Math.floor(seconds * 4) % 2;
  ctx.fillStyle = color;
  for (let y = 0; y < 5; y += 1) ctx.fillRect(fx + 1, fy + y, 6 - (y === 2 ? wave : 0), 1);
  ctx.fillStyle = SUN;
  ctx.fillRect(fx + 3, fy + 2, 1, 1);
}

/** Confetti pixels falling around (x, y). */
export function paintConfetti(ctx: PixelSurface, x: number, y: number, seconds: number, still: boolean, spread = 30): void {
  const colors = [SUN, ROPE_RED, AQUA, WHITE];
  const t = still ? 1.3 : seconds;
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.fillRect(Math.round(x + ((i * 13) % spread) - spread / 2), Math.round(y - 20 + ((t * 12 + i * 7) % 22)), 1, 1);
  }
}

/** A dithered hatch (every other pixel) over a rectangle: the "air" between a reference and a price. */
export function paintHatch(ctx: PixelSurface, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  for (let yy = 0; yy < h; yy += 1) for (let xx = (yy % 2); xx < w; xx += 2) if ((xx + yy) % 4 === 0) ctx.fillRect(x + xx, y + yy, 1, 1);
}

export { INK, ROPE_RED, SUN, AQUA, WHITE };

/** A surface that may also blit a cached layer (a real canvas context can). */
export interface LayerSurface extends TextSurface {
  drawImage?(image: CanvasImageSource, x: number, y: number): void;
}

const layers = new Map<string, HTMLCanvasElement>();

/**
 * Paints a static layer once into an offscreen canvas and blits it on later
 * frames (the rock of a side view, a radar's rings): the shared ticker then
 * redraws only what moves. Without a DOM (tests) it paints directly.
 */
export function paintCached(ctx: LayerSurface, key: string, w: number, h: number, paint: (surface: TextSurface) => void): void {
  if (typeof document === "undefined" || typeof ctx.drawImage !== "function") {
    paint(ctx);
    return;
  }
  let canvas = layers.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const surface = canvas.getContext("2d");
    if (!surface) {
      paint(ctx);
      return;
    }
    surface.imageSmoothingEnabled = false;
    paint(surface);
    if (layers.size > 32) layers.clear();
    layers.set(key, canvas);
  }
  ctx.drawImage(canvas, 0, 0);
}
