import { INK, LAYERS, ROPE_RED, SUN, WHITE } from "../../pixel/ely";
import { drawElyState, type ElyState } from "../../pixel/states";
import { rngOf, shade } from "../../pixel/topo";
import type { CampMood } from "./camp";

const DAY_SKY = ["#BFE3EA", "#D9ECEC", "#EEEADB", "#F6E3BE", "#F7D9A5"] as const;
const NIGHT_SKY = ["#0B141A", "#0F1B22", "#13222A", "#182A33", "#1D313A"] as const;
const STORM_SKY = ["#9DAAB0", "#AEB8BC", "#BFC6C6", "#CFD3CC", "#DAD8C8"] as const;
const NIGHT_STORM_SKY = ["#161E22", "#1B2428", "#212A2E", "#273034", "#2D3638"] as const;

export interface CampFrame {
  readonly w: number;
  readonly h: number;
  readonly seconds: number;
  readonly still: boolean;
  readonly mood: CampMood;
  readonly ely: ElyState;
  readonly night: boolean;
  /** Radio lines waiting: the mast light blinks (once a second). */
  readonly radio: boolean;
}

const mirroredNoise = (seed: number, span: number) => {
  const random = rngOf(seed);
  const points = Array.from({ length: 14 }, () => random());
  return (d: number) => {
    const t = (Math.abs(d) / span) * 12;
    const i = Math.floor(t);
    const f = t - i;
    const a = points[Math.min(13, i)]!;
    const b = points[Math.min(13, i + 1)]!;
    return a + (b - a) * f * f * (3 - 2 * f);
  };
};

/**
 * Base camp (pure painting): a sky that follows the sheet and the account
 * (storm grey when a rope frays, night when the range is empty), a mirrored
 * range with the Summit on the axis, the Floor underfoot, the tent and the
 * radio mast mirrored either side, and Ely in the middle saying the state.
 */
export function paintCamp(ctx: CanvasRenderingContext2D, frame: CampFrame): void {
  const { w, h, seconds, still, mood, night } = frame;
  const T = still ? 0 : seconds;
  const mid = Math.floor(w / 2);
  const ground = h - 9;
  const sky = mood === "worry" ? (night ? NIGHT_STORM_SKY : STORM_SKY) : night || mood === "empty" ? NIGHT_SKY : DAY_SKY;
  const darkSky = sky === NIGHT_SKY;
  // sky bands with dithered seams
  const bandH = Math.max(3, Math.ceil(ground / sky.length));
  for (let y = 0; y < ground; y += 1) {
    const k = Math.min(sky.length - 1, Math.floor(y / bandH));
    ctx.fillStyle = sky[k]!;
    ctx.fillRect(0, y, w, 1);
    if (y % bandH === bandH - 1 && k + 1 < sky.length) {
      ctx.fillStyle = sky[k + 1]!;
      for (let x = y % 2; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (darkSky) {
    const random = rngOf(99);
    for (let i = 0; i < Math.floor(w / 6); i += 1) {
      const x = Math.floor(random() * w);
      const y = Math.floor(random() * ground * 0.55);
      const twinkle = !still && Math.floor(T + i) % 5 === 0;
      ctx.fillStyle = twinkle ? SUN : WHITE;
      ctx.fillRect(x, y, 1, 1);
    }
    // the moon, mirrored opposite the sun's place
    ctx.fillStyle = "#EEE7D8";
    for (let y = -4; y <= 4; y += 1) {
      const half = Math.round(Math.sqrt(16 - y * y));
      ctx.fillRect(mid + Math.floor(w * 0.3) - half, 8 + y, half * 2, 1);
    }
    ctx.fillStyle = sky[0]!;
    for (let y = -4; y <= 2; y += 1) {
      const half = Math.round(Math.sqrt(16 - y * y));
      ctx.fillRect(mid + Math.floor(w * 0.3) - half + 3, 7 + y, half * 2, 1);
    }
  } else if (mood !== "worry") {
    // the sun behind the summit
    ctx.fillStyle = SUN;
    for (let y = -6; y <= 6; y += 1) {
      const half = Math.round(Math.sqrt(36 - y * y));
      ctx.fillRect(mid - half, 12 + y, half * 2, 1);
    }
  }
  // clouds drift (storm clouds when a rope frays)
  const cloudColor = mood === "worry" ? (night ? "#3A464C" : "#7E8B91") : darkSky ? "#2A3B44" : WHITE;
  for (let i = 0; i < 4; i += 1) {
    const width = 14 + (i % 2) * 8;
    const x = Math.round(((i * 97 + T * (2 + i)) % (w + 40)) - 30);
    const y = 6 + (i % 3) * 5;
    ctx.fillStyle = cloudColor;
    for (let c = 0; c < width; c += 1) {
      const top = 2 + Math.round(2 * Math.sin((c / width) * Math.PI));
      ctx.fillRect(x + c, y - top, 1, top);
    }
  }
  // the range: mirrored on the axis, the Summit in the middle, the Ridge either side
  const span = w / 2;
  const n1 = mirroredNoise(5, span);
  const n2 = mirroredNoise(17, span);
  const peakH = ground - 10;
  const far = (d: number) => Math.round(ground - Math.max(6, peakH * (1 - Math.abs(d) / (span * 0.62))) + n1(d) * 6);
  const near = (d: number) => Math.round(ground - 6 - (Math.abs(d) / span) * peakH * 0.45 - n2(d) * 6);
  const paintRidge = (fn: (d: number) => number, palette: readonly string[], band: number) => {
    for (let x = 0; x < w; x += 1) {
      const top = Math.min(ground, fn(x + 0.5 - w / 2));
      for (let y = top; y < ground; y += 1) {
        const k = Math.min(palette.length - 1, Math.floor((y - top) / band));
        const edge = (y - top) % band === 0 && y > top;
        ctx.fillStyle = edge ? shade(palette[k]!, -0.22) : palette[k]!;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(x, top, 1, 1);
    }
  };
  paintRidge(far, [WHITE, ...LAYERS.Summit.slice(1, 4).reverse(), LAYERS.Summit[0]!], 4);
  paintRidge(near, [...LAYERS.Ridge].reverse(), 4);
  // the floor underfoot
  const floor = LAYERS.Floor;
  for (let y = ground; y < h; y += 1) {
    ctx.fillStyle = y === ground ? INK : floor[Math.min(floor.length - 1, 4 - Math.floor((y - ground) / 3))]!;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.fillStyle = shade(floor[3]!, -0.2);
  for (let x = 2; x < w; x += 5) ctx.fillRect(x, ground + 3 + (x % 2), 1, 1);

  const side = Math.max(30, Math.round(w * 0.2));
  // the tent, left of the axis
  const tx = mid - side;
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = INK;
    ctx.fillRect(tx - i - 1, ground - 10 + i, 1, 1);
    ctx.fillRect(tx + i + 1, ground - 10 + i, 1, 1);
    ctx.fillStyle = i < 2 ? SUN : ROPE_RED;
    ctx.fillRect(tx - i, ground - 10 + i, i * 2 + 1, 1);
  }
  ctx.fillStyle = darkSky || mood === "empty" ? SUN : INK;
  for (let i = 0; i < 5; i += 1) ctx.fillRect(tx - Math.floor(i / 2), ground - 5 + i, Math.floor(i / 2) * 2 + 1, 1);
  // the radio mast, right of the axis, mirrored
  const mx = mid + side;
  ctx.fillStyle = INK;
  ctx.fillRect(mx, ground - 16, 1, 16);
  ctx.fillRect(mx - 3, ground - 12, 7, 1);
  ctx.fillRect(mx - 2, ground - 8, 5, 1);
  ctx.fillRect(mx - 4, ground - 1, 9, 1);
  const blink = frame.radio && (still || Math.floor(T) % 2 === 0);
  ctx.fillStyle = blink ? ROPE_RED : shade(ROPE_RED, -0.5);
  ctx.fillRect(mx, ground - 18, 1, 2);
  // Ely on the axis
  ctx.save();
  ctx.translate(mid - 20, ground - 37);
  drawElyState(ctx, { state: frame.ely, seconds, still, clear: false });
  ctx.restore();
}

