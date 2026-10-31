/**
 * The hero range (pure drawing): a side view of three altitude-banded ridges
 * (Summit, Ridge, Floor), the sun rising behind the summit, a drifting cloud
 * sea, survey pins, a dotted trail that Ely climbs to plant the flag, and a
 * barograph strip with one tick per block along the bottom.
 */
import { drawDisc, drawGrid, type PixelSurface } from "./draw";
import { elySprite, INK, mini, ROPE_RED, SUN, AQUA, WHITE, type PixelGrid } from "./ely";
import { rngOf, shade } from "./topo";

export interface TextSurface extends PixelSurface {
  font: string;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
}

export interface SceneLabels {
  readonly summit: string;
  readonly ridge: string;
  readonly floor: string;
}

export const DEFAULT_SCENE_LABELS: SceneLabels = { summit: "SUMMIT · ELYSIUM", ridge: "RIDGE · HYPEREVM", floor: "FLOOR · HYPERCORE" };

/** Logical height of the scene; the width follows the container. */
export const SCENE_H = 200;
/** Reference width the shapes were designed on. */
const REF_W = 400;
const STRIP = 14;

type Curve = (x: number) => number;

function smoothNoise(seed: number, w: number): Curve {
  const random = rngOf(seed);
  const pts = Array.from({ length: 12 }, () => random());
  return (x) => {
    const t = (x / w) * 11;
    const i = Math.floor(t);
    const f = t - i;
    const a = pts[Math.max(0, Math.min(11, i))]!;
    const b = pts[Math.max(0, Math.min(11, i + 1))] ?? a;
    const k = f * f * (3 - 2 * f);
    return a + (b - a) * k;
  };
}

export interface SceneModel {
  readonly w: number;
  readonly h: number;
  readonly summitX: number;
  readonly far: Curve;
  readonly mid: Curve;
  readonly near: Curve;
  /** The trail Ely walks, foot positions from the ridge to the summit. */
  readonly trail: ReadonlyArray<readonly [number, number]>;
}

/** Ridge curves and the trail for a scene `w` pixels wide. */
export function sceneModel(w: number, h = SCENE_H): SceneModel {
  const u = (x: number) => (x / w) * REF_W;
  const nA = smoothNoise(3, REF_W);
  const nB = smoothNoise(9, REF_W);
  const nC = smoothNoise(17, REF_W);
  const summitU = 250;
  const far: Curve = (x) => {
    const q = u(x);
    return 46 + 60 * Math.abs((q - summitU) / REF_W) ** 1.1 * 1.6 + nA(q) * 14 - Math.max(0, 22 - Math.abs(q - summitU) * 0.35);
  };
  const mid: Curve = (x) => {
    const q = u(x);
    return 98 + nB(q) * 30 + Math.abs(q - 120) * 0.06;
  };
  const near: Curve = (x) => 148 + nC(u(x)) * 22;
  const summitX = (summitU / REF_W) * w;
  const trail: Array<readonly [number, number]> = [];
  const startX = (40 / REF_W) * w;
  for (let i = 0; i <= 160; i += 1) {
    const t = i / 160;
    const x = startX + t * (summitX - startX) + Math.sin(t * Math.PI * 5) * 10 * (1 - t) * (w / REF_W);
    trail.push([x, Math.min(mid(x) - 1, far(x)) - 1]);
  }
  return { w, h, summitX, far, mid, near, trail };
}

export interface ScenePalette {
  readonly sky: readonly string[];
  readonly far: readonly string[];
  readonly mid: readonly string[];
  readonly near: readonly string[];
  readonly cloud: string;
  readonly cloudShadow: string;
  readonly night: boolean;
}

export const DAY_SCENE: ScenePalette = {
  sky: ["#F7D9A5", "#F6E3BE", "#EEEADB", "#D9ECEC", "#BFE3EA"],
  far: ["#FFFFFF", "#DDF2F6", "#A9DCE6", "#6FBFCE", "#4FA7BA"],
  mid: ["#E9CC9C", "#D3A66E", "#B07A44", "#8A5A2B"],
  near: ["#7DBFC4", "#4FA0A9", "#2D8796", "#1E6B7D"],
  cloud: "#FFFFFF",
  cloudShadow: "#D9E6E6",
  night: false,
};

export const NIGHT_SCENE: ScenePalette = {
  sky: ["#0B1424", "#0F1C30", "#14253B", "#1A2F47", "#213A55"],
  far: ["#E6EEF2", "#B9CFD8", "#7FA2B2", "#56798C", "#3D5E70"],
  mid: ["#B89A70", "#97764E", "#765635", "#573E25"],
  near: ["#3E7C84", "#2D6670", "#1F515C", "#163F49"],
  cloud: "#4A5B66",
  cloudShadow: "#33424C",
  night: true,
};

export interface SceneProgress {
  /** 0..1 through the cycle. */
  readonly p: number;
  /** 0..1 along the trail. */
  readonly climb: number;
  readonly arrived: boolean;
}

/** Where the cycle is: Ely climbs for the first 75%, then stands on the summit. */
export function sceneProgress(seconds: number, cycle: number): SceneProgress {
  const p = cycle > 0 ? (((seconds % cycle) + cycle) % cycle) / cycle : 1;
  return { p, climb: Math.min(1, p / 0.75), arrived: p >= 0.75 };
}

/** The altitude readout for a climb fraction (Elysium's summit at 4,810 m, like Mont Blanc). */
export function sceneAltitude(climb: number): number {
  return Math.round(Math.max(0, Math.min(1, climb)) * 4810);
}

const SPRITES: { walk?: PixelGrid; blink?: PixelGrid; summit?: PixelGrid; night?: PixelGrid } = {};
function sprites() {
  SPRITES.walk ??= mini(elySprite({ gear: "lamp" }));
  SPRITES.blink ??= mini(elySprite({ gear: "lamp", eye: "blink" }));
  SPRITES.summit ??= mini(elySprite({ gear: "crown", eye: "happy", mouth: "grin" }));
  SPRITES.night ??= mini(elySprite({ gear: "goggles", fur: "Night", horn: "Obsidian" }));
  return SPRITES as Required<typeof SPRITES>;
}

function ridge(ctx: PixelSurface, w: number, h: number, fn: Curve, colors: readonly string[], band: number) {
  for (let x = 0; x < w; x += 1) {
    const top = Math.round(fn(x));
    for (let y = top; y < h; y += 1) {
      const k = Math.min(colors.length - 1, Math.floor((y - top) / band));
      const edge = (y - top) % band === 0 && y > top;
      ctx.fillStyle = edge ? shade(colors[k]!, -0.22) : colors[k]!;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x, top, 1, 1);
  }
}

function cloud(ctx: PixelSurface, cx: number, cy: number, w: number, palette: ScenePalette) {
  ctx.fillStyle = palette.cloud;
  for (let i = 0; i < w; i += 1) {
    const height = 3 + Math.round(3 * Math.sin((i / w) * Math.PI)) + ((i * 7) % 3 === 0 ? 1 : 0);
    ctx.fillRect(Math.round(cx + i), Math.round(cy - height), 1, height);
  }
  ctx.fillStyle = palette.cloudShadow;
  ctx.fillRect(Math.round(cx), Math.round(cy), w, 1);
}

function pin(ctx: TextSurface, w: number, x: number, y: number, text: string, toLeft = false, ground = y + 8) {
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, 1, Math.max(8, ground - y));
  const boxW = Math.ceil(ctx.measureText(text).width) + 6;
  const left = toLeft || x + boxW > w - 2 ? Math.max(1, x - boxW + 1) : x;
  ctx.fillRect(left, y - 10, boxW, 10);
  ctx.fillStyle = "#FFF9EC";
  ctx.fillText(text, left + 3, y - 9);
}

export interface SceneFrame {
  readonly seconds: number;
  /** Seconds per climb (default 18). */
  readonly cycle?: number;
  readonly labels?: SceneLabels;
  readonly palette?: ScenePalette;
  /** Barograph ticks (heights 1..7), newest last; one per block. */
  readonly baro?: readonly number[];
  /** Draw the end state: Ely on the summit, the flag planted, the sun up. */
  readonly still?: boolean;
}

/** Paints one frame of the hero range. */
export function drawScene(ctx: TextSurface, model: SceneModel, frame: SceneFrame): SceneProgress {
  const { w, h, summitX, far, mid, near, trail } = model;
  const palette = frame.palette ?? DAY_SCENE;
  const labels = frame.labels ?? DEFAULT_SCENE_LABELS;
  const T = frame.seconds;
  const progress = frame.still ? { p: 0.8, climb: 1, arrived: true } : sceneProgress(T, frame.cycle ?? 18);
  const skyH = 120;
  const band = skyH / palette.sky.length;

  // sky bands with dithered seams
  for (let y = 0; y < skyH; y += 1) {
    const k = Math.min(palette.sky.length - 1, Math.floor(y / band));
    ctx.fillStyle = palette.sky[k]!;
    ctx.fillRect(0, y, w, 1);
    if (y % band === band - 1) {
      ctx.fillStyle = palette.sky[Math.min(palette.sky.length - 1, k + 1)]!;
      for (let x = y % 2; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (palette.night) {
    // stars: fixed seeded points; a few twinkle slowly (one change per 1.5 s at most)
    const random = rngOf(77);
    for (let i = 0; i < Math.round(w / 6); i += 1) {
      const x = Math.floor(random() * w);
      const y = Math.floor(random() * 90);
      const on = frame.still || (i % 5 !== 0) || Math.floor(T / 1.5 + i) % 3 !== 0;
      if (!on) continue;
      ctx.fillStyle = i % 9 === 0 ? SUN : "#EEE7D8";
      ctx.fillRect(x, y, 1, 1);
    }
    const my = 34;
    drawDisc(ctx, summitX + 44, my, 10, "#EEE7D8");
    drawDisc(ctx, summitX + 48, my - 3, 8, palette.sky[1]!);
  } else {
    const sy = 70 - Math.min(1, progress.p * 1.6) * 34;
    drawDisc(ctx, summitX + 40, sy, 12, SUN);
    ctx.fillStyle = "#FFE27A";
    for (let y = -8; y <= 4; y += 1) {
      const half = Math.round(Math.sqrt(64 - y * y) * 0.6);
      ctx.fillRect(summitX + 34 - half, Math.round(sy + y), half, 1);
    }
  }

  ridge(ctx, w, h, far, palette.far, 7);
  for (let i = 0; i < 6 + Math.round(w / 200); i += 1) {
    const cw = 26 + (i % 3) * 8;
    cloud(ctx, ((i * 83 + T * (6 + i)) % (w + 60)) - 60, 92 + (i % 3) * 5, cw, palette);
  }
  ridge(ctx, w, h, mid, palette.mid, 8);
  ridge(ctx, w, h, near, palette.near, 7);

  ctx.font = "8px Silkscreen";
  ctx.textBaseline = "top";
  const ridgeX = Math.round((70 / REF_W) * w);
  const floorX = Math.round((300 / REF_W) * w);
  // the summit pin flies to the left, clear of Ely and the flag
  const summitPinX = Math.round(summitX) - 14;
  pin(ctx, w, summitPinX, Math.max(13, Math.round(far(summitX)) - 26), labels.summit, true, Math.round(far(summitPinX)));
  pin(ctx, w, ridgeX, Math.round(mid(ridgeX)) - 4, labels.ridge);
  pin(ctx, w, floorX, Math.round(near(floorX)) - 4, labels.floor);

  // the dotted trail
  ctx.fillStyle = INK;
  for (let i = 0; i < trail.length; i += 4) {
    const [x, y] = trail[i]!;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }

  // the flag: planted when Ely arrives, waving at 2 Hz
  const [lastX, lastY] = trail[trail.length - 1]!;
  const fx = Math.round(lastX) + 4;
  const fy = Math.round(lastY) - 16;
  ctx.fillStyle = INK;
  ctx.fillRect(fx, fy, 1, 16);
  if (progress.arrived) {
    const wave = frame.still ? 0 : Math.floor(T * 4) % 2;
    ctx.fillStyle = ROPE_RED;
    for (let y = 0; y < 6; y += 1) ctx.fillRect(fx + 1, fy + y, 8 - (y === 2 || y === 3 ? wave : 0), 1);
    ctx.fillStyle = SUN;
    ctx.fillRect(fx + 3, fy + 2, 2, 2);
  }

  // Ely
  const s = sprites();
  const idx = Math.floor(progress.climb * (trail.length - 1));
  const [ex, ey] = trail[idx]!;
  const bob = frame.still ? 0 : progress.arrived ? Math.round(Math.abs(Math.sin(T * 6)) * 2) : Math.floor(T * 6) % 2;
  const sprite = progress.arrived ? s.summit : palette.night ? s.night : Math.floor(T * 10) % 37 === 0 ? s.blink : s.walk;
  ctx.fillStyle = INK;
  const lx = Math.round(ex) - 3;
  const ly = Math.round(ey) - 3 - bob;
  ctx.fillRect(lx, ly, 2, 3);
  ctx.fillRect(lx + 5, ly + (bob ? 0 : 1), 2, 3 - (bob ? 0 : 1));
  drawGrid(ctx, sprite, Math.round(ex) - 8, Math.round(ey) - 19 - bob, 1);
  if (palette.night && !progress.arrived) {
    // headlamp beam ahead on the trail
    ctx.fillStyle = "rgba(242,194,0,0.35)";
    for (let i = 1; i < 12; i += 1) ctx.fillRect(Math.round(ex) + 6 + i, Math.round(ey) - 14 - bob - Math.floor(i / 3), 1, 1 + Math.floor(i / 2));
  }

  // confetti pixels over the summit
  if (progress.arrived) {
    const colors = [SUN, ROPE_RED, AQUA, WHITE];
    const t = frame.still ? 1.3 : T;
    for (let i = 0; i < 16; i += 1) {
      const cx = Math.round(ex + ((i * 13) % 34) - 17);
      const cy = Math.round(ey - 26 + ((t * 14 + i * 7) % 26));
      ctx.fillStyle = colors[i % colors.length]!;
      ctx.fillRect(cx, cy, 1, 1);
    }
  }

  // barograph strip
  ctx.fillStyle = INK;
  ctx.fillRect(0, h - STRIP, w, STRIP);
  const baro = frame.baro ?? [];
  ctx.fillStyle = AQUA;
  for (let x = w - 1, i = baro.length - 1; x >= 0 && i >= 0; x -= 3, i -= 1) {
    const tick = Math.max(1, Math.min(10, baro[i]!));
    ctx.fillRect(x, h - 2 - tick, 1, tick);
  }
  return progress;
}
