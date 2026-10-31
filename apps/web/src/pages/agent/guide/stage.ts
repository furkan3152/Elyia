/**
 * The Guide's table (pure drawing): a mirrored pixel range seen across a
 * survey table, Ely behind it, a sun (or the moon and stars) haloing the
 * horns, two cairns with pennants, two clouds drifting in mirror, and the
 * survey map hanging off the table's front edge. Everything is symmetric
 * about the centre axis, so the page's axis runs straight through Ely.
 * The mood adds its weather: storm clouds when a rope frays, confetti on
 * the summit, a lamp beam on watch.
 */
import { drawDisc, type PixelSurface } from "../../../pixel/draw";
import { INK, ROPE_RED, SUN, LAYERS } from "../../../pixel/ely";
import { DAY_SCENE, NIGHT_SCENE, type ScenePalette, type TextSurface } from "../../../pixel/scene";
import { drawElyState, STATE_H, STATE_W, type ElyState } from "../../../pixel/states";
import { rngOf, shade } from "../../../pixel/topo";

/** Logical height of the stage; the width follows the container. */
export const STAGE_H = 64;
/** The table's top edge (Ely's beard rests on it). */
export const TABLE_Y = 50;

export interface StageSurface extends TextSurface {
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface StageFrame {
  readonly w: number;
  readonly seconds: number;
  readonly state: ElyState;
  readonly night: boolean;
  /** End state (reduced motion): everything frozen at a readable pose. */
  readonly still: boolean;
}

interface Peak {
  readonly at: number;
  readonly height: number;
  readonly spread: number;
}

const FAR: readonly Peak[] = [
  { at: 30, height: 20, spread: 13 },
  { at: 54, height: 30, spread: 17 },
  { at: 86, height: 21, spread: 15 },
  { at: 120, height: 27, spread: 19 },
  { at: 160, height: 19, spread: 17 },
  { at: 200, height: 24, spread: 20 },
];
const MID: readonly Peak[] = [
  { at: 44, height: 9, spread: 18 },
  { at: 98, height: 12, spread: 24 },
  { at: 150, height: 8, spread: 20 },
  { at: 196, height: 10, spread: 22 },
];

/** Distance of column x from the centre axis, identical for x and w-1-x. */
export function axisDistance(x: number, w: number): number {
  return Math.abs(x + 0.5 - w / 2);
}

function rise(peaks: readonly Peak[], d: number): number {
  let best = 0;
  for (const peak of peaks) best = Math.max(best, peak.height * Math.max(0, 1 - Math.abs(d - peak.at) / peak.spread));
  return best;
}

/** A small deterministic jag per distance (so the ridge line steps like rock). */
function jag(d: number, seed: number): number {
  const k = Math.floor(d);
  return ((k * 73 + seed * 31) % 7) / 3 - 1;
}

/** Top row of the far range at distance d from the axis. */
export function farTop(d: number): number {
  return Math.round(44 - rise(FAR, d) + jag(d, 3));
}

/** Top row of the near ridge at distance d from the axis. */
export function midTop(d: number): number {
  return Math.round(TABLE_Y - 2 - rise(MID, d) - 2 * Math.abs(Math.sin(d / 9)));
}

function range(ctx: PixelSurface, w: number, top: (d: number) => number, colors: readonly string[], band: number, bottom: number) {
  for (let x = 0; x < w; x += 1) {
    const t = top(axisDistance(x, w));
    for (let y = t; y < bottom; y += 1) {
      const k = Math.min(colors.length - 1, Math.floor((y - t) / band));
      const edge = (y - t) % band === 0 && y > t;
      ctx.fillStyle = edge ? shade(colors[k]!, -0.22) : colors[k]!;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, t, 1, 1);
  }
}

function cloud(ctx: PixelSurface, left: number, base: number, width: number, fill: string, under: string) {
  // three puffs, the middle one tallest, on a flat underside
  const puffs: ReadonlyArray<readonly [number, number]> = [
    [0.22, 3],
    [0.5, 5],
    [0.78, 3],
  ];
  ctx.fillStyle = fill;
  for (let i = 0; i < width; i += 1) {
    let height = 1;
    for (const [at, tall] of puffs) {
      const d = Math.abs(i + 0.5 - at * width) / (width * 0.2);
      if (d < 1) height = Math.max(height, Math.round(tall * Math.sqrt(1 - d * d)) + 1);
    }
    ctx.fillRect(Math.round(left + i), base - height, 1, height);
  }
  ctx.fillStyle = under;
  ctx.fillRect(Math.round(left) + 1, base, width - 2, 1);
}

/** A cairn of four stones with a pennant flying outward (mirror = -1 flies left). */
function cairn(ctx: PixelSurface, x: number, mirror: 1 | -1, wave: number, flag: string) {
  const stones: ReadonlyArray<readonly [number, number, number]> = [
    [-3, 0, 7],
    [-2, -2, 5],
    [-2, -4, 4],
    [-1, -6, 3],
  ];
  stones.forEach(([dx, dy, width], index) => {
    const left = mirror === 1 ? x + dx : x - dx - width + 1;
    ctx.fillStyle = INK;
    ctx.fillRect(left - 1, TABLE_Y + dy - 2, width + 2, 3);
    ctx.fillStyle = index % 2 === 0 ? "#8F9A93" : "#B5BDB6";
    ctx.fillRect(left, TABLE_Y + dy - 1, width, 1);
    ctx.fillStyle = "#6E7A73";
    ctx.fillRect(left, TABLE_Y + dy, width, 1);
  });
  ctx.fillStyle = INK;
  ctx.fillRect(x, TABLE_Y - 18, 1, 11);
  ctx.fillStyle = flag;
  for (let row = 0; row < 5; row += 1) {
    const length = 6 - Math.abs(row - 2) * 2 - (row === 2 ? wave : 0);
    for (let i = 1; i <= length; i += 1) ctx.fillRect(x + mirror * i, TABLE_Y - 18 + row, 1, 1);
  }
}

/** Offsets every draw by (ox, oy) and drops pixels below `clipY` (Ely stands behind the table). */
function offset(ctx: StageSurface, ox: number, oy: number, clipY: number): StageSurface {
  return {
    get fillStyle() {
      return ctx.fillStyle;
    },
    set fillStyle(value) {
      ctx.fillStyle = value;
    },
    get font() {
      return ctx.font;
    },
    set font(value) {
      ctx.font = value;
    },
    get textBaseline() {
      return ctx.textBaseline;
    },
    set textBaseline(value) {
      ctx.textBaseline = value;
    },
    fillRect(x, y, w, h) {
      const top = y + oy;
      const bottom = Math.min(top + h, clipY);
      if (bottom > top) ctx.fillRect(x + ox, top, w, bottom - top);
    },
    fillText(text, x, y) {
      ctx.fillText(text, x + ox, y + oy);
    },
    measureText: (text) => ctx.measureText(text),
    clearRect: () => undefined,
  };
}

/** The x of the stage's centre column (Ely's axis): left of centre on even widths, so the sprite lands on whole pixels. */
export function stageCentre(w: number): number {
  return Math.floor(w / 2);
}

/** Where the cairns stand, mirrored about the axis. */
export function cairnOffset(w: number): number {
  return Math.max(34, Math.round(w * 0.3));
}

/** Paints one frame of the Guide's table. */
export function drawStage(ctx: StageSurface, frame: StageFrame): void {
  const { w, state, night, still } = frame;
  const T = still ? 0.6 : frame.seconds;
  const palette: ScenePalette = night ? NIGHT_SCENE : DAY_SCENE;
  const cx = stageCentre(w);
  const skyBand = 9;

  // sky: five bands with dithered seams
  for (let y = 0; y < TABLE_Y; y += 1) {
    const k = Math.min(palette.sky.length - 1, Math.floor(y / skyBand));
    ctx.fillStyle = palette.sky[k]!;
    ctx.fillRect(0, y, w, 1);
    if (y % skyBand === skyBand - 1) {
      ctx.fillStyle = palette.sky[Math.min(palette.sky.length - 1, k + 1)]!;
      // dithered seam, mirrored about the axis
      for (let d = y % 2; d < w / 2; d += 2) {
        ctx.fillRect(cx - 1 - d, y, 1, 1);
        ctx.fillRect(cx + d, y, 1, 1);
      }
    }
  }

  // the halo behind the horns: a sun with stepped rays by day, the moon and mirrored stars by night
  const hy = 24;
  if (night) {
    const random = rngOf(505);
    const half = Math.ceil(w / 2);
    for (let i = 0; i < Math.round(w / 9); i += 1) {
      const d = Math.floor(random() * half);
      const y = 1 + Math.floor(random() * 30);
      if (d < 24 && y > 2 && y < 46) continue;
      const on = still || i % 4 !== 0 || Math.floor(T / 1.6 + i) % 3 !== 0;
      if (!on) continue;
      ctx.fillStyle = i % 7 === 0 ? SUN : "#EEE7D8";
      ctx.fillRect(cx - d - 1, y, 1, 1);
      ctx.fillRect(cx + d, y, 1, 1);
    }
    drawDisc(ctx, cx, hy, 19, "#2A3D55");
    drawDisc(ctx, cx, hy, 16, "#DDE6EA");
    ctx.fillStyle = "#BFCBD1";
    for (const [dx, dy, r] of [[-7, -5, 2], [6, 3, 3], [-2, 8, 1], [8, -8, 1]] as const) drawDisc(ctx, cx + dx, hy + dy, r, "#BFCBD1");
  } else {
    const shimmer = still ? 0 : Math.floor(T) % 2;
    ctx.fillStyle = "#F6DA72";
    for (let i = 0; i < 16; i += 1) {
      if (i % 2 !== shimmer) continue;
      const a = (i / 16) * Math.PI * 2;
      for (let r = 22; r <= 25; r += 1) ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r * 0.9), 1, 1);
    }
    drawDisc(ctx, cx, hy, 19, "#FFE27A");
    drawDisc(ctx, cx, hy, 16, SUN);
  }

  // far range (the Summit's snow), then two clouds drifting in mirror, then the near ridge
  range(ctx, w, farTop, palette.far, 3, TABLE_Y);
  const storm = state === "worry";
  const drift = still ? 0.5 : (T / 26) % 1;
  const off = Math.round(30 + drift * Math.max(10, w / 2 - 40));
  const cw = 18;
  const fill = storm ? (night ? "#3A4650" : "#9AA3A6") : palette.cloud;
  const under = storm ? (night ? "#262F36" : "#727D80") : palette.cloudShadow;
  cloud(ctx, cx - off - cw, 34, cw, fill, under);
  cloud(ctx, cx + off, 34, cw, fill, under);
  if (storm && !still) {
    // a few rain pixels under each storm cloud, stepping down twice a second
    ctx.fillStyle = night ? "#6FD3E3" : "#4FA7BA";
    const step = Math.floor(T * 2) % 3;
    for (let i = 2; i < cw; i += 4) {
      ctx.fillRect(cx - off - cw + i, 36 + step * 2, 1, 1);
      ctx.fillRect(cx + off + cw - 1 - i, 36 + step * 2, 1, 1);
    }
  }
  range(ctx, w, midTop, palette.mid, 3, TABLE_Y);

  // the table: top edge, wood face with planks mirrored about the axis
  const wood = night ? ["#97764E", "#765635", "#573E25"] : ["#D3A66E", "#B07A44", "#8A5A2B"];
  ctx.fillStyle = INK;
  ctx.fillRect(0, TABLE_Y, w, 1);
  ctx.fillStyle = wood[0]!;
  ctx.fillRect(0, TABLE_Y + 1, w, 3);
  ctx.fillStyle = shade(wood[0]!, 0.25);
  ctx.fillRect(0, TABLE_Y + 1, w, 1);
  ctx.fillStyle = INK;
  ctx.fillRect(0, TABLE_Y + 4, w, 1);
  ctx.fillStyle = wood[1]!;
  ctx.fillRect(0, TABLE_Y + 5, w, STAGE_H - TABLE_Y - 5);
  ctx.fillStyle = wood[2]!;
  for (let d = 12; d < w / 2 + 12; d += 24) {
    ctx.fillRect(cx - d - 1, TABLE_Y + 5, 1, STAGE_H - TABLE_Y - 5);
    ctx.fillRect(cx + d, TABLE_Y + 5, 1, STAGE_H - TABLE_Y - 5);
  }
  for (let d = 3; d < w / 2; d += 6) {
    ctx.fillRect(cx - 1 - d, TABLE_Y + 9, 1, 1);
    ctx.fillRect(cx + d, TABLE_Y + 9, 1, 1);
  }

  // cairns with pennants, mirrored, waving twice a second
  const wave = still ? 0 : Math.floor(T * 2) % 2;
  const flag = state === "summit" ? ROPE_RED : state === "worry" ? ROPE_RED : SUN;
  const co = cairnOffset(w);
  cairn(ctx, cx - co - 1, -1, wave, flag);
  cairn(ctx, cx + co, 1, wave, flag);

  // Ely behind the table, in the mood's state; pixels below the table edge are hidden
  const ex = cx - Math.floor(STATE_W / 2);
  const ey = TABLE_Y - STATE_H + 10;
  drawElyState(offset(ctx, ex, ey, TABLE_Y), { state, seconds: frame.seconds, still, clear: false });

  // the survey map hanging off the front edge: a mirrored contour sheet
  const mw = 13;
  const top = TABLE_Y + 1;
  const bottom = STAGE_H - 2;
  ctx.fillStyle = INK;
  ctx.fillRect(cx - mw - 2, top, (mw + 1) * 2 + 2, bottom - top + 2);
  const sheet = LAYERS.Floor;
  for (let y = top; y < bottom + 1; y += 1) {
    for (let d = 0; d <= mw; d += 1) {
      const v = Math.sin(d / 3.2 + 0.4) + Math.cos((y - top) / 2.4 + d / 6) * 0.8;
      const bandIndex = Math.max(0, Math.min(4, Math.floor((v + 1.8) * 1.4)));
      const next = Math.max(0, Math.min(4, Math.floor((Math.sin((d + 1) / 3.2 + 0.4) + Math.cos((y - top) / 2.4 + (d + 1) / 6) * 0.8 + 1.8) * 1.4)));
      const c = bandIndex !== next ? shade(sheet[bandIndex]!, -0.28) : sheet[bandIndex]!;
      ctx.fillStyle = c;
      ctx.fillRect(cx - d - 1, y, 1, 1);
      ctx.fillRect(cx + d, y, 1, 1);
    }
  }
  // the pin on the map: you are here
  ctx.fillStyle = SUN;
  ctx.fillRect(cx - 1, top + 5, 2, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 1, top + 7, 2, 1);

  if (state === "watch") {
    // the lamp beam falls on the map
    ctx.fillStyle = "rgba(242,194,0,0.35)";
    const sway = still ? 0 : Math.round(Math.sin(T * 1.5) * 3);
    for (let y = top; y < bottom; y += 1) {
      const half = 3 + Math.floor((y - top) / 2);
      ctx.fillRect(cx - half + sway, y, half * 2, 1);
    }
  }
  if (state === "summit") {
    // confetti over the whole stage, mirrored
    const colours = [SUN, "#6FD3E3", ROPE_RED, "#FFFFFF"];
    const random = rngOf(9);
    for (let i = 0; i < Math.round(w / 6); i += 1) {
      const d = Math.floor(random() * (w / 2));
      const speed = 6 + random() * 8;
      const y = Math.floor((T * speed + random() * TABLE_Y) % TABLE_Y);
      ctx.fillStyle = colours[i % colours.length]!;
      ctx.fillRect(cx - d - 1, y, 1, 1);
      ctx.fillRect(cx + d, y, 1, 1);
    }
  }
}
