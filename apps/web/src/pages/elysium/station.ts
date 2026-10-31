/**
 * The weather station on the summit (pure drawing). A symmetric range: the
 * Elysium peak on the centre axis with the station on top (hut, mast,
 * anemometer, antenna light), two mirrored shoulders, a cloud sea between.
 * By NIGHT Ely keeps watch with a lamp whose beam sweeps the sky under the
 * stars; by DAY Ely reads the drum in the sun. The anemometer turns with the
 * chain's throughput; the antenna light blinks once a second (never above
 * 3 Hz).
 */
import type { PixelSurface } from "../../pixel/draw";
import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, mini, ROPE_RED, SUN, WHITE, type PixelGrid } from "../../pixel/ely";
import { DAY_SCENE, NIGHT_SCENE, type ScenePalette } from "../../pixel/scene";
import { rngOf, shade } from "../../pixel/topo";

export const STATION_ASPECT = 0.36;

export interface StationFrame {
  readonly seconds: number;
  readonly still: boolean;
  readonly night: boolean;
  /** Transactions per second right now (null: unknown, the cups idle). */
  readonly tps: number | null;
}

interface Clearable extends PixelSurface {
  clearRect(x: number, y: number, w: number, h: number): void;
}

const STAR_SEED = 99801;
/** Half-width of the flat summit the station stands on. */
const PLATEAU = 17;

let watcher: PixelGrid | null = null;
let reader: PixelGrid | null = null;
let reading: PixelGrid | null = null;

/** Height of the centre peak's ridge line at x (symmetric about the axis). */
export function peakTop(x: number, w: number, h: number): number {
  const c = w / 2;
  const off = Math.max(0, Math.abs(x - c) - PLATEAU);
  const top = Math.round(h * 0.31);
  const cone = top + off * 1.15 + ((Math.abs(x - c) * 5) % 9 === 0 && off > 0 ? 1 : 0);
  const shoulder = h * 0.74 + (Math.abs(x - c) / (w / 2)) * h * 0.08;
  return Math.round(Math.min(cone, shoulder));
}

function farTop(x: number, w: number, h: number): number {
  const c = w / 2;
  const d = Math.abs(x - c) / (w / 2);
  // two mirrored far peaks at a third of the way out
  const p = Math.abs(d - 0.62);
  return Math.round(h * 0.5 + p * h * 0.7 + ((Math.abs(x - c) * 7) % 5 === 0 ? 1 : 0));
}

function band(ctx: PixelSurface, x: number, top: number, h: number, colors: readonly string[], step: number): void {
  for (let y = top; y < h; y += 1) {
    const k = Math.min(colors.length - 1, Math.floor((y - top) / step));
    const edge = (y - top) % step === 0 && y > top;
    ctx.fillStyle = edge ? shade(colors[k]!, -0.22) : colors[k]!;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(x, top, 1, 1);
}

function cloud(ctx: PixelSurface, cx: number, cy: number, w: number, palette: ScenePalette): void {
  ctx.fillStyle = palette.cloud;
  for (let i = 0; i < w; i += 1) {
    const height = 2 + Math.round(3 * Math.sin((i / w) * Math.PI)) + ((i * 7) % 3 === 0 ? 1 : 0);
    ctx.fillRect(Math.round(cx + i), Math.round(cy - height), 1, height);
  }
  ctx.fillStyle = palette.cloudShadow;
  ctx.fillRect(Math.round(cx), Math.round(cy), w, 1);
}

/** The four frames of the cup anemometer, seen from the side. */
const CUPS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [-4, 0],
    [-3, 0],
    [3, 0],
    [4, 0],
  ],
  [
    [-3, -1],
    [3, 1],
  ],
  [
    [-1, 0],
    [1, 0],
  ],
  [
    [-3, 1],
    [3, -1],
  ],
];

export function paintStation(ctx: Clearable, w: number, h: number, frame: StationFrame): void {
  const palette = frame.night ? NIGHT_SCENE : DAY_SCENE;
  const T = frame.still ? 0 : frame.seconds;
  const c = Math.round(w / 2);
  ctx.clearRect(0, 0, w, h);

  // sky in bands with dithered seams
  const sky = palette.sky;
  const skyH = Math.round(h * 0.75);
  const bandH = Math.max(2, Math.floor(skyH / sky.length));
  for (let y = 0; y < h; y += 1) {
    const k = Math.min(sky.length - 1, Math.floor(y / bandH));
    ctx.fillStyle = sky[k]!;
    ctx.fillRect(0, y, w, 1);
    if (y % bandH === bandH - 1 && k + 1 < sky.length) {
      ctx.fillStyle = sky[k + 1]!;
      for (let x = y % 2; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }

  if (frame.night) {
    // stars: fixed field, a few twinkle once a second or slower
    const r = rngOf(STAR_SEED);
    const count = Math.round(w * 0.35);
    const tick = Math.floor(T);
    for (let i = 0; i < count; i += 1) {
      const sx = Math.floor(r() * w);
      const sy = Math.floor(r() * h * 0.55);
      const bright = r() > 0.8;
      const twinkle = !frame.still && (i + tick) % 9 === 0;
      ctx.fillStyle = twinkle ? "#6FD3E3" : bright ? WHITE : "#9FB4C2";
      ctx.fillRect(sx, sy, 1, 1);
      if (bright && !twinkle) {
        ctx.fillStyle = "#5C7186";
        ctx.fillRect(sx - 1, sy, 1, 1);
        ctx.fillRect(sx + 1, sy, 1, 1);
      }
    }
    // the moon, mirrored by nothing: kept small, high, left of the axis by a quarter
    const mx = Math.round(w * 0.22);
    const my = Math.round(h * 0.18);
    for (let y = -5; y <= 5; y += 1) {
      const half = Math.round(Math.sqrt(25 - y * y));
      ctx.fillStyle = "#F4EBD0";
      ctx.fillRect(mx - half, my + y, half * 2, 1);
    }
    ctx.fillStyle = sky[0]!;
    for (let y = -5; y <= 5; y += 1) {
      const half = Math.round(Math.sqrt(25 - y * y));
      ctx.fillRect(mx - half + 3, my + y - 1, half * 2, 1);
    }
  } else {
    // the sun, a quarter left of the axis
    const sx = Math.round(w * 0.22);
    const sy = Math.round(h * 0.2);
    ctx.fillStyle = SUN;
    for (let y = -6; y <= 6; y += 1) {
      const half = Math.round(Math.sqrt(36 - y * y));
      ctx.fillRect(sx - half, sy + y, half * 2, 1);
    }
    ctx.fillStyle = "#FFE27A";
    ctx.fillRect(sx - 3, sy - 3, 2, 2);
  }

  // far range: two mirrored peaks
  for (let x = 0; x < w; x += 1) band(ctx, x, farTop(x, w, h), h, palette.far, 4);

  // cloud sea drifting behind the summit
  for (let i = 0; i < 6; i += 1) {
    const span = w + 50;
    const cx = ((i * (w / 5.3) + T * (2 + (i % 3))) % span) - 40;
    cloud(ctx, cx, h * 0.6 + (i % 3) * 3, 18 + (i % 3) * 7, palette);
  }

  // the summit: Elysium's aqua and snow, on the axis
  const summit = frame.night ? NIGHT_SCENE.far : ["#FFFFFF", "#C3EAF0", "#85CCD8", "#4FA7BA", "#2E7F94"];
  const shadowSide = summit.map((colour) => shade(colour, -0.14));
  for (let x = 0; x < w; x += 1) {
    const top = peakTop(x, w, h);
    band(ctx, x, top, h, x > c + PLATEAU ? shadowSide : summit, 4);
  }
  // foreground shoulders, mirrored: the Ridge's ochre
  for (let x = 0; x < w; x += 1) {
    const d = Math.abs(x - c) / (w / 2);
    if (d < 0.5) continue;
    const top = Math.round(h * 0.94 - (d - 0.5) * h * 0.42 + ((x * 3) % 7 === 0 ? 1 : 0));
    band(ctx, x, top, h, palette.mid, 3);
  }

  // the station, on the axis
  const ground = peakTop(c, w, h);
  // hut: 11 wide, roof stepped, door
  const hx = c - 5;
  const hy = ground - 6;
  ctx.fillStyle = frame.night ? "#97764E" : "#B07A44";
  ctx.fillRect(hx, hy, 11, 6);
  ctx.fillStyle = INK;
  ctx.fillRect(hx - 1, hy - 1, 13, 1);
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = ROPE_RED;
    ctx.fillRect(hx - 1 + i, hy - 2 - i, 13 - i * 2, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(hx - 1, hy, 1, 6);
  ctx.fillRect(hx + 11, hy, 1, 6);
  ctx.fillRect(c - 1, hy + 2, 3, 4);
  ctx.fillStyle = frame.night ? SUN : "#FFE27A";
  ctx.fillRect(c, hy + 3, 1, 3);

  // a cairn on the left, balancing Ely on the right
  const cx0 = c - 16;
  const stones: readonly (readonly [number, number, number])[] = [
    [0, -2, 7],
    [1, -4, 5],
    [2, -6, 3],
  ];
  for (const [dx, dy, sw] of stones) {
    ctx.fillStyle = INK;
    ctx.fillRect(cx0 + dx - 1, ground + dy - 1, sw + 2, 3);
    ctx.fillStyle = frame.night ? "#7FA2B2" : "#BDB3A2";
    ctx.fillRect(cx0 + dx, ground + dy, sw, 1);
  }
  // mast with the anemometer on top and the antenna light
  const mastTop = hy - 16;
  ctx.fillStyle = INK;
  ctx.fillRect(c, mastTop, 1, hy - 5 - mastTop);
  ctx.fillRect(c - 1, mastTop + 6, 3, 1);
  const tps = frame.tps ?? 0;
  const turn = frame.still ? 0 : Math.floor(T * Math.min(8, 1.5 + tps / 6)) % CUPS.length;
  ctx.fillStyle = INK;
  ctx.fillRect(c - 3, mastTop, 7, 1);
  ctx.fillStyle = frame.night ? WHITE : INK;
  for (const [dx, dy] of CUPS[turn]!) ctx.fillRect(c + dx, mastTop - 1 + dy, 1, 2);
  // antenna light: on half of every second
  const lit = frame.still || Math.floor(T) % 2 === 0;
  ctx.fillStyle = lit ? ROPE_RED : "#5B2620";
  ctx.fillRect(c, mastTop - 3, 1, 2);
  // wind vane on the cross arm
  ctx.fillStyle = INK;
  ctx.fillRect(c + 2, mastTop + 5, 4, 1);
  ctx.fillRect(c + 5, mastTop + 4, 1, 3);

  // Ely on the plateau, right of the hut, looking out
  watcher ??= mini(elySprite({ gear: "lamp", eye: "open" }));
  reader ??= mini(elySprite({ gear: "lamp" }));
  reading ??= mini(elySprite({ gear: "lamp", eye: "blink" }));
  const ex = c + 7;
  const eg = peakTop(c, w, h);
  if (frame.night) {
    // the lamp beam sweeps the sky, slowly, from the headlamp
    const a = frame.still ? -0.5 : Math.sin(T * 0.6) * 0.9 - 0.4;
    const ox = ex + 8;
    const oy = eg - 15;
    for (let i = 4; i < 70; i += 1) {
      const spread = Math.round(i * 0.18);
      const bx = ox + Math.round(Math.cos(a - Math.PI / 2 + 0.6) * i);
      const by = oy + Math.round(Math.sin(a - Math.PI / 2 + 0.6) * i * 0.7);
      for (let s = -spread; s <= spread; s += 1) {
        if ((bx + by + s) % 2 !== 0) continue;
        const px = bx + s;
        if (px < 0 || px >= w || by < 0) continue;
        ctx.fillStyle = "rgba(242,194,0,0.35)";
        ctx.fillRect(px, by, 1, 1);
      }
    }
  }
  const blink = !frame.still && Math.floor(T * 10) % 37 === 0;
  const sprite = frame.night ? watcher : blink ? reading : reader;
  const bob = !frame.still && Math.floor(T * 2) % 2 === 1 ? 1 : 0;
  drawGrid(ctx, sprite, ex, eg - 16 - bob, 1);
}
