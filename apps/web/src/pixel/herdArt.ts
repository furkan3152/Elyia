/**
 * The Herd art (pure): a 48 x 48 bust of Ely composed in layers, the same
 * ibex head as the app's mascot (`paintElyHead`) over a neck and chest, on a
 * seeded elevation map. One function, `paintHerd(look, seed)`, draws every
 * goat for the browser and for the PNG generator alike.
 *
 * Determinism: the art uses + - * /, sqrt and integer maths only (no exp,
 * hypot or trig at run time), so every JS engine paints the same pixels as
 * the generator's PNGs, bit for bit.
 */
import {
  AQUA,
  BLUSH,
  ELY_EYES,
  ELY_MOUTHS,
  GLACIER,
  INK,
  LASER,
  MUZZLE,
  ROPE_RED,
  SUN,
  WHITE,
  headHalfWidth,
  hornSpine,
  mirrored,
  outline,
  paintElyHead,
  paintElyNose,
  type EyeKind,
  type HornSpine,
  type MouthKind,
  type MutableGrid,
  type PixelGrid,
  type Plot,
} from "./ely";
import { NIGHT_HALO } from "./draw";
import { bandOf, fieldMax, isContour, rngOf, shade, type HeightField } from "./topo";

/** Art size in pixels (square). */
export const HERD_ART = 48;
/** The head frame (the 32 x 34 mascot's coordinates) sits at this offset in the art. */
export const HEAD_X = 8;
export const HEAD_Y = 6;

export type Triple = readonly [string, string, string];

// ---------------------------------------------------------------- the look

export type BackdropKind = "topo" | "night" | "aurora" | "blizzard" | "alpenglow";
export interface Backdrop {
  readonly kind: BackdropKind;
  /** Altitude palette, low to high. */
  readonly palette: readonly string[];
  /** How much darker the contour pixels are (default 0.28, as in the app). */
  readonly contour?: number;
}

export type HornShape = "curl" | "swept" | "kid" | "ram" | "spire" | "broken";
export type HornFinish = "plain" | "gold" | "crystal" | "ice";
export interface HornSpec {
  readonly shape: HornShape;
  readonly finish: HornFinish;
  /** [base, ring, top light] */
  readonly palette: Triple;
}

export type HerdEye = EyeKind | "wink" | "side" | "starry" | "glow";
export type HerdMouth = MouthKind | "tongue" | "grass" | "fang";
export type HerdBeard = "classic" | "long" | "braided" | "frosted" | "clean";
export type HeadwearKind = "none" | "headlamp" | "helmet" | "beanie" | "cap" | "crown" | "edelweiss" | "halo";
export type NeckKind = "none" | "rope" | "bandana" | "scarf" | "bell" | "carabiner" | "tag" | "pendant";
export type AccessoryKind = "none" | "goggles" | "iceaxe" | "map" | "earring" | "butterfly" | "flag";

export interface Worn<K extends string> {
  readonly kind: K;
  /** Cloth or metal colour, where the item has one. */
  readonly color?: string;
}

/** Hand-made extras for the 1/1 legendaries (all optional, all pure). */
export interface LookFx {
  /** Paints the whole backdrop instead of `backdrop`. */
  readonly backdrop?: (art: MutableGrid, seed: number) => void;
  /** Painted on the backdrop, behind the goat (moons, beams, rays). */
  readonly behind?: (art: MutableGrid) => void;
  /** Recolours every figure pixel (the goat and its gear) after outlining. */
  readonly recolor?: (hex: string) => string;
  /** The outline colour (default ink). */
  readonly ink?: string;
  /** Rim colour (null: none); overrides the backdrop's rim. */
  readonly rim?: string | null;
  /** Extra head-frame painting after the face (marks, speckles). */
  readonly head?: (plot: Plot, sym: Plot) => void;
  /** Painted last, over everything (snow, sparkles). */
  readonly over?: (art: MutableGrid, figure: PixelGrid) => void;
}

export interface HerdLook {
  readonly backdrop: Backdrop;
  /** [base, dark, light] */
  readonly fur: Triple;
  readonly muzzle?: string;
  readonly horn: HornSpec;
  readonly eye: HerdEye;
  readonly mouth: HerdMouth;
  readonly beard: HerdBeard;
  readonly headwear: Worn<HeadwearKind>;
  readonly neck: Worn<NeckKind>;
  readonly accessory: Worn<AccessoryKind>;
  readonly fx?: LookFx;
}

// ---------------------------------------------------------------- exact maths

const LN2 = 0.6931471805599453;

/** 2^-k for k = 0..64, by exact halving. */
const HALVES: readonly number[] = Array.from({ length: 65 }, (_, k) => {
  let v = 1;
  for (let i = 0; i < k; i += 1) v *= 0.5;
  return v;
});

/** e^x for x <= 0 from + - * / only (deterministic across engines; ample precision for pixel bands). Below -40 it is 0. */
export function dexp(x: number): number {
  if (x < -40) return 0;
  if (x > 0) return 1 / dexp(-x);
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 12; i += 1) {
    term = (term * r) / i;
    sum += term;
  }
  return sum * HALVES[-k]!;
}

/** A seeded 48 x 48 field of gaussian hills (the art's elevation map). */
export function herdField(seed: number, size = HERD_ART): HeightField {
  const r = rngOf(seed);
  const peaks = Array.from({ length: 5 }, () => [r() * size, r() * size, 0.4 + r() * 0.8, 6 + r() * 13] as const);
  const field: number[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) {
      let v = 0;
      for (const [px, py, a, s] of peaks) v += a * dexp(-((x - px) ** 2 + (y - py) ** 2) / (2 * s * s));
      row.push(v);
    }
    field.push(row);
  }
  return field;
}

// ---------------------------------------------------------------- grids

export function blankArt(size = HERD_ART): MutableGrid {
  return Array.from({ length: size }, () => Array<string | null>(size).fill(null));
}

/** A plot into `grid` with an offset, clipped to the grid. */
export function plotOn(grid: MutableGrid, ox = 0, oy = 0): Plot {
  return (x, y, c) => {
    const X = x + ox;
    const Y = y + oy;
    if (Y >= 0 && Y < grid.length && X >= 0 && X < (grid[Y]?.length ?? 0)) grid[Y]![X] = c;
  };
}

/** Copies every coloured cell of `src` over `dst`. */
export function stamp(dst: MutableGrid, src: PixelGrid): void {
  for (let y = 0; y < src.length; y += 1) for (let x = 0; x < src[y]!.length; x += 1) if (src[y]![x]) dst[y]![x] = src[y]![x]!;
}

const at = (g: PixelGrid, x: number, y: number) => g[y]?.[x] ?? null;

// ---------------------------------------------------------------- backdrop

/** Paints an elevation map: bands of the palette, contour pixels darker. */
export function paintTopo(art: MutableGrid, field: HeightField, palette: readonly string[], contour = 0.28): void {
  const levels = palette.length;
  const m = fieldMax(field);
  for (let y = 0; y < art.length; y += 1) {
    for (let x = 0; x < art[y]!.length; x += 1) {
      const c = palette[bandOf(field[y]![x]!, m, levels)]!;
      art[y]![x] = isContour(field, x, y, m, levels) ? shade(c, -contour) : c;
    }
  }
}

function sprinkle(art: MutableGrid, seed: number, count: number, colors: readonly string[], keep: (x: number, y: number) => boolean): void {
  const r = rngOf(seed);
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(r() * art.length);
    const y = Math.floor(r() * art.length);
    const c = colors[Math.floor(r() * colors.length)]!;
    if (keep(x, y)) art[y]![x] = c;
  }
}

/** A pixel disc (rows of runs), clipped. */
export function disc(art: MutableGrid, cx: number, cy: number, radius: number, color: string | ((x: number, y: number, d2: number) => string | null)): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const c = typeof color === "string" ? color : color(x, y, d2);
      if (c && y >= 0 && y < art.length && x >= 0 && x < art.length) art[y]![x] = c;
    }
  }
}

/** The four night-sky stars of a seed (bright ones get a plus). */
function stars(art: MutableGrid, seed: number, field: HeightField, palette: readonly string[]): void {
  const m = fieldMax(field);
  sprinkle(art, seed ^ 0x51a7, 26, ["#F2ECDD", "#A7D6D6", "#6FD3E3"], (x, y) => bandOf(field[y]![x]!, m, palette.length) <= 1);
  const r = rngOf(seed ^ 0x2bad);
  for (let i = 0; i < 2; i += 1) {
    const x = 2 + Math.floor(r() * 44);
    const y = 1 + Math.floor(r() * 14);
    if (bandOf(field[y]![x]!, m, palette.length) > 1) continue;
    art[y]![x] = "#FFFFFF";
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (art[y + dy]?.[x + dx] !== undefined) art[y + dy]![x + dx] = "#A7D6D6";
  }
}

/** A crescent moon at (cx, cy). */
export function moon(art: MutableGrid, cx: number, cy: number, radius: number): void {
  disc(art, cx, cy, radius + 1, (_x, _y, d2) => (d2 > radius * radius ? "#2A4458" : null));
  disc(art, cx, cy, radius, (x, y) => {
    const ox = x + 0.5 - (cx + radius * 0.45);
    const oy = y + 0.5 - (cy - radius * 0.35);
    if (ox * ox + oy * oy < radius * radius * 0.72) return null;
    return (x + y) % 5 === 0 ? "#E0D6BE" : "#F2ECDD";
  });
}

export function paintBackdrop(art: MutableGrid, backdrop: Backdrop, seed: number): void {
  const field = herdField(seed);
  const { palette } = backdrop;
  paintTopo(art, field, palette, backdrop.contour);
  switch (backdrop.kind) {
    case "night": {
      stars(art, seed, field, palette);
      const r = rngOf(seed ^ 0x3001);
      moon(art, r() < 0.5 ? 6 : 41, 6, 3.6);
      break;
    }
    case "aurora": {
      stars(art, seed, field, palette);
      const r = rngOf(seed ^ 0xa0a0);
      const phase = Math.floor(r() * 12);
      const curtain = ["#C8F7DE", "#7FE0B0", "#3FAF7A", "#1F7A4C"];
      for (let x = 0; x < HERD_ART; x += 1) {
        // a stepped triangle wave (no trig) for the curtain's foot, rays of uneven height above it
        const t = ((x + phase) % 24) / 12;
        const foot = 15 + Math.round((t < 1 ? t : 2 - t) * 6);
        const ray = 6 + ((x * 7 + phase) % 5) * 2;
        for (let k = 0; k < ray; k += 1) {
          const y = foot - k;
          if (y < 0) break;
          const band = k < 1 ? 0 : k < 3 ? 1 : k < ray - 3 ? 2 : 3;
          if (band === 3 && (x + y) % 2 === 1) continue;
          art[y]![x] = curtain[band]!;
        }
      }
      break;
    }
    case "blizzard": {
      sprinkle(art, seed ^ 0xb11e, 150, ["#FFFFFF", "#FFFFFF", "#E8F6F8"], () => true);
      break;
    }
    case "alpenglow": {
      // bands of sky, a sun behind the goat and a far ridge
      const sky = palette;
      for (let y = 0; y < HERD_ART; y += 1) {
        const band = Math.min(sky.length - 1, Math.floor((y / 40) * sky.length));
        for (let x = 0; x < HERD_ART; x += 1) {
          const edge = (y + 1) % Math.ceil(40 / sky.length) === 0 && (x + y) % 2 === 0;
          art[y]![x] = edge && band < sky.length - 1 ? sky[band + 1]! : sky[band]!;
        }
      }
      disc(art, 24, 24, 19, (_x, _y, d2) => (d2 > 17 * 17 ? "#FBE7A1" : d2 > 14.5 * 14.5 ? "#FFE27A" : "#FFF3C4"));
      const r = rngOf(seed ^ 0x5017);
      const peaks = [r() * 10, 14 + r() * 8, 30 + r() * 6, 40 + r() * 8];
      for (let x = 0; x < HERD_ART; x += 1) {
        let top = 48;
        for (const p of peaks) top = Math.min(top, 33 + Math.abs(x - p) * 0.9);
        for (let y = Math.round(top); y < HERD_ART; y += 1) art[y]![x] = y === Math.round(top) ? "#B5527A" : "#7A3352";
      }
      break;
    }
    default:
      break;
  }
}

/** The rim colour a backdrop gives the goat (the moonlit rim of the app's NIGHT sheet). */
export function backdropRim(backdrop: Backdrop): string | null {
  if (backdrop.kind === "night" || backdrop.kind === "aurora") return NIGHT_HALO;
  if (backdrop.kind === "alpenglow") return "#FFF3C4";
  return null;
}

// ---------------------------------------------------------------- horns

type Spines = { readonly left: HornSpine; readonly right: HornSpine; readonly root: number; readonly taper: number; readonly rings: number };

function joined(a: HornSpine, b: HornSpine, split = 0.5): HornSpine {
  return [...a.map(([x, y, t]) => [x, y, t * split] as const), ...b.slice(1).map(([x, y, t]) => [x, y, split + t * (1 - split)] as const)];
}

const CURL = hornSpine([12.6, 10.5], [10, 0.5], [3.5, 0.2], [1.4, 6.2]);
const SPINES: Readonly<Record<HornShape, Spines>> = {
  curl: { left: CURL, right: CURL, root: 2.3, taper: 1.4, rings: 8 },
  swept: (() => {
    const s = hornSpine([12.6, 10.5], [10.8, -1.6], [1.6, -3.2], [-3.4, 4.6]);
    return { left: s, right: s, root: 2.5, taper: 1.7, rings: 10 };
  })(),
  kid: (() => {
    const s = hornSpine([12.4, 10.2], [11.8, 6.5], [10.6, 4.6], [9.2, 4.4], 30);
    return { left: s, right: s, root: 1.9, taper: 0.9, rings: 3 };
  })(),
  ram: (() => {
    const s = joined(hornSpine([12.6, 10.5], [10.5, 1.0], [2.0, 0.5], [0.6, 7.5]), hornSpine([0.6, 7.5], [-0.4, 12.5], [4.0, 13.0], [4.6, 9.8], 30), 0.66);
    return { left: s, right: s, root: 2.4, taper: 1.3, rings: 9 };
  })(),
  spire: (() => {
    const s = hornSpine([12.9, 10.2], [12.2, 3.0], [10.6, -1.5], [9.6, -5.0]);
    return { left: s, right: s, root: 2.0, taper: 1.3, rings: 12 };
  })(),
  broken: { left: CURL.filter(([, , t]) => t <= 0.46), right: CURL, root: 2.3, taper: 1.4, rings: 8 },
};

/** Where a horn's tip ends (head frame, the right horn), for butterflies and sparkles. */
export function hornTip(shape: HornShape): readonly [number, number] {
  const tip = SPINES[shape].right[SPINES[shape].right.length - 1]!;
  return [31 - tip[0], tip[1]];
}

const hornCache = new Map<string, PixelGrid>();

/** The horn layer of a spec (memoised: horns depend on nothing else). */
function paintHorns(layer: MutableGrid, horn: HornSpec): void {
  const key = `${horn.shape}|${horn.finish}|${horn.palette.join(",")}`;
  let cached = hornCache.get(key);
  if (!cached) {
    const fresh = blankArt();
    drawHorns(fresh, horn);
    cached = fresh;
    hornCache.set(key, fresh);
  }
  stamp(layer, cached);
}

function drawHorns(layer: MutableGrid, horn: HornSpec): void {
  const spec = SPINES[horn.shape];
  const [H, HR, HL] = horn.palette;
  const hornLayer = blankArt();
  const plot = plotOn(hornLayer, HEAD_X, HEAD_Y);
  for (const side of ["left", "right"] as const) {
    const spine = spec[side];
    for (let y = -6; y < 22; y += 1) {
      for (let x = -8; x < 16; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        let best = 9;
        let bt = 0;
        for (const [hx, hy, ht] of spine) {
          const dx = px - hx;
          const dy = py - hy;
          const d = Math.sqrt(dx * dx + dy * dy) - (spec.root - spec.taper * ht);
          if (d < best) {
            best = d;
            bt = ht;
          }
        }
        if (best > 0) continue;
        let c = (bt * spec.rings) % 1 < 0.22 ? HR : H;
        if (horn.finish === "crystal") c = best > -0.55 ? HR : Math.floor(bt * 7) % 2 === 0 ? H : HL;
        plot(side === "left" ? x : 31 - x, y, c);
      }
    }
  }
  // the top light: horn pixels with open sky above
  for (let y = 1; y < HERD_ART; y += 1) {
    for (let x = 0; x < HERD_ART; x += 1) {
      const c = hornLayer[y]![x];
      if (c && !hornLayer[y - 1]![x]) hornLayer[y]![x] = horn.finish === "crystal" ? WHITE : HL;
    }
  }
  if (horn.shape === "broken") {
    // the snapped stub: a pale break face on the left horn's end
    const [bx, by] = spec.left[spec.left.length - 1]!;
    const plotH = plotOn(hornLayer, HEAD_X, HEAD_Y);
    plotH(Math.floor(bx) - 1, Math.floor(by), MUZZLE);
    plotH(Math.floor(bx) - 1, Math.floor(by) + 1, shade(H, -0.25));
    plotH(Math.floor(bx), Math.floor(by) - 1, MUZZLE);
  }
  if (horn.finish === "ice") {
    // icicles under the sweep
    for (let x = 1; x < HERD_ART - 1; x += 1) {
      for (let y = HERD_ART - 2; y > 0; y -= 1) {
        if (!hornLayer[y]![x] || hornLayer[y + 1]![x]) continue;
        if (y + HEAD_Y > 26 + HEAD_Y) continue;
        const cx = x < 24 ? x : 47 - x;
        if (cx % 3 === 0 && y < HEAD_Y + 12) {
          hornLayer[y + 1]![x] = "#FFFFFF";
          if (cx % 6 === 0) hornLayer[y + 2]![x] = "#C2F0F6";
        }
        break;
      }
    }
  }
  if (horn.finish === "gold" || horn.finish === "crystal") {
    const [tx, ty] = hornTip(horn.shape);
    const sx = Math.round(tx) + HEAD_X + 1;
    const sy = Math.round(ty) + HEAD_Y - 3;
    for (const [dx, dy, c] of [
      [0, 0, WHITE],
      [1, 0, horn.finish === "gold" ? "#FFE27A" : AQUA],
      [-1, 0, horn.finish === "gold" ? "#FFE27A" : AQUA],
      [0, 1, horn.finish === "gold" ? "#FFE27A" : AQUA],
      [0, -1, horn.finish === "gold" ? "#FFE27A" : AQUA],
    ] as const)
      if (sy + dy >= 0 && sx + dx < HERD_ART) hornLayer[sy + dy]![sx + dx] = c;
  }
  stamp(layer, hornLayer);
}

// ---------------------------------------------------------------- face

const PINK_TONGUE = "#E06C78";
const LEAF = "#5E9E3A";
const LEAF_DARK = "#3F7426";

function leftOnly(set: Plot): Plot {
  return (x, y, c) => {
    if (x < 16) set(x, y, c);
  };
}
function rightOnly(set: Plot): Plot {
  return (x, y, c) => {
    const mx = 31 - x;
    if (mx >= 16) set(mx, y, c);
  };
}

function paintEyes(set: Plot, sym: Plot, eye: HerdEye): void {
  switch (eye) {
    case "wink":
      ELY_EYES.open(leftOnly(set));
      ELY_EYES.happy(rightOnly(set));
      return;
    case "side":
      for (let y = 15; y <= 18; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, WHITE);
      for (const ox of [9, 20]) {
        set(ox, 16, INK);
        set(ox, 17, INK);
        set(ox + 1, 17, INK);
        set(ox, 18, INK);
        set(ox + 1, 18, INK);
      }
      sym(9, 14, INK);
      sym(10, 14, INK);
      sym(11, 14, INK);
      return;
    case "starry":
      for (let y = 15; y <= 18; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, INK);
      sym(10, 16, SUN);
      sym(10, 17, SUN);
      sym(11, 17, SUN);
      sym(10, 18, SUN);
      sym(9, 17, SUN);
      sym(9, 15, WHITE);
      return;
    case "glow":
      for (let y = 15; y <= 18; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, WHITE);
      sym(10, 16, AQUA);
      sym(11, 16, AQUA);
      sym(10, 17, GLACIER);
      sym(11, 17, INK);
      sym(10, 18, GLACIER);
      sym(11, 18, GLACIER);
      sym(10, 16, WHITE);
      return;
    default:
      (ELY_EYES[eye] ?? ELY_EYES.open)(sym);
  }
}

function paintMouth(set: Plot, sym: Plot, mouth: HerdMouth): void {
  switch (mouth) {
    case "tongue":
      ELY_MOUTHS.smile(sym);
      set(16, 26, PINK_TONGUE);
      set(17, 26, PINK_TONGUE);
      set(16, 27, shade(PINK_TONGUE, -0.2));
      return;
    case "grass":
      ELY_MOUTHS.flat(sym);
      for (const [x, y] of [
        [17, 25],
        [18, 25],
        [19, 24],
        [20, 24],
        [21, 23],
        [22, 23],
        [23, 22],
        [24, 21],
      ] as const)
        set(x, y, LEAF);
      set(21, 22, LEAF_DARK);
      set(20, 22, LEAF_DARK);
      set(25, 20, "#E8C95A");
      set(24, 20, "#E8C95A");
      set(25, 21, "#E8C95A");
      return;
    case "fang":
      ELY_MOUTHS.smile(sym);
      set(17, 26, WHITE);
      return;
    default:
      (ELY_MOUTHS[mouth] ?? ELY_MOUTHS.smile)(sym);
  }
}

function paintBeard(sym: Plot, beard: HerdBeard, fur: Triple): void {
  const [, FD, FL] = fur;
  switch (beard) {
    case "long":
      for (let y = 26; y <= 36; y += 1) {
        for (let x = 9; x < 16; x += 1) {
          const py = y + 0.5;
          const dx = 16 - (x + 0.5);
          const half = py < 29 ? 4.6 : 4.6 - (py - 29) * 0.55;
          if (dx <= half && (py > 27.6 || dx > 3.6)) sym(x, y, (x + 2 * y) % 5 === 0 && y > 28 ? shade(FD, -0.2) : x === 15 && y > 30 ? FL : FD);
        }
      }
      sym(15, 37, FD);
      return;
    case "braided":
      for (let y = 31; y <= 34; y += 1) {
        sym(15, y, y === 33 ? SUN : y % 2 ? FD : shade(FD, -0.2));
      }
      sym(14, 33, "#B38600");
      return;
    case "frosted":
      sym(15, 30, FL === "#FFFFFF" ? "#E8F6F8" : WHITE);
      sym(14, 29, WHITE);
      sym(13, 28, "#E8F6F8");
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- headwear

function paintHeadwear(plot: Plot, sym: Plot, worn: Worn<HeadwearKind>): void {
  const C = worn.color ?? GLACIER;
  const light = shade(C, 0.35);
  const dark = shade(C, -0.3);
  switch (worn.kind) {
    case "headlamp":
      for (let x = 7; x <= 15; x += 1) if (headHalfWidth(10.5) >= 16 - (x + 0.5)) sym(x, 10, C);
      for (let x = 14; x <= 15; x += 1) {
        sym(x, 8, INK);
        sym(x, 9, SUN);
      }
      sym(13, 9, INK);
      sym(13, 8, INK);
      plot(15, 9, "#FFF3C4");
      return;
    case "helmet": {
      const rows: ReadonlyArray<readonly [number, number]> = [
        [3, 3],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 8],
        [9, 8],
      ];
      for (const [y, half] of rows) for (let x = 16 - half; x < 16; x += 1) sym(x, y, x === 16 - half && y > 5 ? dark : C);
      for (let x = 6; x < 16; x += 1) sym(x, 10, dark);
      for (const [x, y] of [
        [12, 4],
        [11, 4],
        [10, 5],
        [9, 6],
        [9, 7],
      ] as const)
        sym(x, y, light);
      // vents and the lamp clip
      sym(13, 5, dark);
      sym(13, 6, dark);
      plot(15, 7, INK);
      plot(16, 7, INK);
      plot(15, 8, SUN);
      plot(16, 8, SUN);
      plot(15, 9, INK);
      plot(16, 9, INK);
      return;
    }
    case "beanie": {
      const rows: ReadonlyArray<readonly [number, number]> = [
        [3, 3],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 7],
      ];
      for (const [y, half] of rows) for (let x = 16 - half; x < 16; x += 1) sym(x, y, (x + y) % 4 === 0 ? light : (x - y) % 4 === 0 ? dark : C);
      for (let y = 8; y <= 10; y += 1) for (let x = 7; x < 16; x += 1) sym(x, y, x % 2 === 0 ? dark : y === 8 ? light : C);
      // pom-pom
      for (const [x, y] of [
        [15, 0],
        [14, 1],
        [15, 1],
        [13, 2],
        [14, 2],
        [15, 2],
      ] as const)
        sym(x, y, (x + y) % 2 ? WHITE : "#E0D6BE");
      return;
    }
    case "cap":
      for (let y = 6; y <= 10; y += 1) {
        for (let x = 9; x <= 15; x += 1) {
          if (y === 6 && x < 12) continue;
          if (y === 7 && x < 10) continue;
          sym(x, y, y === 10 ? dark : C);
        }
      }
      sym(12, 7, light);
      sym(11, 8, light);
      plot(15, 6, WHITE);
      plot(16, 6, WHITE);
      for (let x = 22; x <= 29; x += 1) plot(x, 10, dark);
      for (let x = 23; x <= 28; x += 1) plot(x, 11, dark);
      return;
    case "crown":
      for (let x = 11; x <= 15; x += 1) {
        sym(x, 7, "#B38600");
        sym(x, 6, SUN);
        sym(x, 5, SUN);
      }
      for (const [x, top] of [
        [11, 2],
        [13, 3],
        [15, 1],
      ] as const)
        for (let y = top; y < 5; y += 1) sym(x, y, y === top ? "#FFE27A" : SUN);
      sym(13, 6, LASER);
      sym(15, 6, AQUA);
      sym(11, 6, "#1F7A4C");
      sym(12, 5, "#FFE27A");
      return;
    case "edelweiss": {
      const cx = 26;
      const cy = 12;
      for (const [dx, dy] of [
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const)
        plot(cx + dx, cy + dy, Math.abs(dx) + Math.abs(dy) === 2 && dx !== 0 && dy !== 0 ? "#E0D6BE" : WHITE);
      plot(cx, cy, SUN);
      plot(cx + 2, cy + 2, LEAF);
      plot(cx + 3, cy + 3, LEAF_DARK);
      return;
    }
    case "halo":
      for (let x = 10; x <= 21; x += 1) {
        plot(x, -1, x === 10 || x === 21 ? "#B38600" : "#FFE27A");
        if (x > 10 && x < 21) plot(x, 0, SUN);
      }
      plot(9, 0, "#B38600");
      plot(22, 0, "#B38600");
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- neck and chest (art frame)

/** Neck and chest half-width at art row y (centre 24): a neck that eases into sloped shoulders. */
function bodyHalfWidth(y: number): number {
  if (y < 30) return -1;
  const neck = 5.4 + (y + 0.5 - 30) * 0.1;
  const t = Math.min(1, Math.max(0, (y + 0.5 - 37.5) / 10));
  return t > 0 ? Math.max(neck, 6.2 + 12.4 * (1 - (1 - t) * (1 - t))) : neck;
}

function paintBody(layer: MutableGrid, fur: Triple): void {
  const [F, FD, FL] = fur;
  const inside = (x: number, y: number) => y >= 30 && Math.abs(x + 0.5 - 24) <= bodyHalfWidth(y);
  for (let y = 30; y < HERD_ART; y += 1) {
    const hw = bodyHalfWidth(y);
    for (let x = 0; x < HERD_ART; x += 1) {
      const dx = Math.abs(x + 0.5 - 24);
      if (dx > hw) continue;
      let c = F;
      if (y < 33) c = FD;
      else if (dx > 6.5 && !inside(x, y - 1)) c = FL;
      else if (dx > hw - 1.4) c = FD;
      else if (y >= 39 && dx <= Math.min(3.4, (y - 38) * 0.7)) c = FL;
      layer[y]![x] = c;
    }
  }
}

const METAL: Triple = ["#C9D1D6", "#7C878F", "#F4F7F8"];
const LEATHER = "#6B4423";

function paintNeck(layer: MutableGrid, worn: Worn<NeckKind>): void {
  const C = worn.color ?? ROPE_RED;
  const set = plotOn(layer);
  const across = (y: number, color: (x: number) => string) => {
    const hw = bodyHalfWidth(y) + 0.6;
    for (let x = 0; x < HERD_ART; x += 1) if (Math.abs(x + 0.5 - 24) <= hw) set(x, y, color(x));
  };
  switch (worn.kind) {
    case "rope": {
      for (const y of [38, 39]) across(y, (x) => ((x + y) % 3 === 0 ? SUN : C));
      // slung across the chest, left shoulder to right hip
      for (let i = 0; i < 16; i += 1) {
        const x = 17 + i;
        const y = 40 + Math.floor(i * 0.5);
        set(x, y, (x + y) % 3 === 0 ? SUN : C);
        set(x, y + 1, (x + y + 1) % 3 === 0 ? SUN : shade(C, -0.2));
      }
      return;
    }
    case "bandana":
      for (let y = 37; y <= 44; y += 1) {
        const half = y === 37 ? bodyHalfWidth(y) + 0.6 : Math.max(0.5, 6.5 - (y - 38) * 1.1);
        for (let x = 0; x < HERD_ART; x += 1) if (Math.abs(x + 0.5 - 24) <= half) set(x, y, (x * 3 + y * 5) % 7 === 0 ? WHITE : y === 37 ? shade(C, -0.25) : C);
      }
      return;
    case "scarf": {
      const stripe = (y: number) => (Math.floor(y / 2) % 2 === 0 ? C : WHITE);
      for (const y of [37, 38, 39]) across(y, (x) => (x % 4 === 0 ? shade(stripe(y), -0.15) : stripe(y)));
      for (let y = 40; y <= 45; y += 1) for (let x = 27; x <= 30; x += 1) set(x, y, stripe(y));
      for (const x of [27, 29]) set(x, 46, C);
      return;
    }
    case "bell":
      across(38, (x) => (x % 3 === 0 ? SUN : LEATHER));
      across(39, () => shade(LEATHER, -0.25));
      for (const [y, from, to] of [
        [40, 23, 24],
        [41, 22, 25],
        [42, 22, 25],
        [43, 21, 26],
        [44, 21, 26],
      ] as ReadonlyArray<readonly [number, number, number]>)
        for (let x = from; x <= to; x += 1) set(x, y, x === from ? "#FFE27A" : x === to ? "#B38600" : SUN);
      set(23, 45, INK);
      set(24, 45, INK);
      return;
    case "carabiner":
      across(38, (x) => (x % 2 ? C : shade(C, -0.2)));
      across(39, () => shade(C, -0.35));
      for (let y = 40; y <= 46; y += 1) {
        for (let x = 21; x <= 26; x += 1) {
          const inner = x >= 23 && x <= 24 && y >= 42 && y <= 44;
          const corner = (y === 40 || y === 46) && (x === 21 || x === 26);
          if (inner || corner) continue;
          set(x, y, x === 26 ? "#B38600" : x === 21 ? "#FFE27A" : SUN);
        }
      }
      set(25, 42, INK);
      set(25, 43, INK);
      return;
    case "tag": {
      for (let y = 37; y <= 41; y += 1) {
        const dx = (41 - y) * 1.4 + 1;
        set(Math.round(23.5 - dx), y, y % 2 ? METAL[0] : METAL[1]);
        set(Math.round(23.5 + dx), y, y % 2 ? METAL[0] : METAL[1]);
      }
      for (let y = 42; y <= 47; y += 1) {
        for (let x = 21; x <= 26; x += 1) {
          if ((y === 42 || y === 47) && (x === 21 || x === 26)) continue;
          set(x, y, x === 21 || y === 42 ? METAL[2] : x === 26 || y === 47 ? METAL[1] : METAL[0]);
        }
      }
      for (const x of [22, 23, 25]) set(x, 44, "#5B6B73");
      for (const x of [22, 24, 25]) set(x, 45, "#5B6B73");
      set(23, 42, "#5B6B73");
      return;
    }
    case "pendant":
      for (let y = 37; y <= 41; y += 1) {
        const dx = (41 - y) * 1.4 + 1;
        set(Math.round(23.5 - dx), y, y % 2 ? SUN : "#B38600");
        set(Math.round(23.5 + dx), y, y % 2 ? SUN : "#B38600");
      }
      for (const [y, from, to] of [
        [42, 23, 24],
        [43, 22, 25],
        [44, 21, 26],
        [45, 20, 27],
      ] as const)
        for (let x = from; x <= to; x += 1) set(x, y, y === 42 ? WHITE : y === 43 && x > 22 && x < 25 ? "#FFF3C4" : x < 24 ? "#FFE27A" : SUN);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- accessories

function paintIceAxe(layer: MutableGrid): void {
  const set = plotOn(layer);
  // shaft: from the right hip up past the shoulder
  for (let i = 0; i <= 17; i += 1) {
    const x = 41 - Math.floor(i / 6);
    const y = 47 - i;
    set(x, y, i < 4 ? ROPE_RED : i < 5 ? INK : GLACIER);
    set(x + 1, y, i < 4 ? shade(ROPE_RED, -0.25) : i < 5 ? INK : shade(GLACIER, -0.3));
  }
  // head: pick to the left (curving down), adze to the right
  for (let x = 34; x <= 44; x += 1) set(x, 29, METAL[0]);
  for (let x = 35; x <= 43; x += 1) set(x, 28, METAL[2]);
  set(34, 30, METAL[1]);
  set(33, 31, METAL[1]);
  for (const y of [28, 29, 30]) set(45, y, METAL[1]);
  set(44, 30, METAL[1]);
  set(39, 30, INK);
}

function paintMap(layer: MutableGrid): void {
  const set = plotOn(layer);
  const x0 = 2;
  const y0 = 38;
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 13; x += 1) {
      const fold = x === 4 || x === 8;
      let c = fold ? "#E0D6BE" : "#F2ECDD";
      const ring = Math.abs(Math.sqrt((x - 7) * (x - 7) + (y - 4) * (y - 4) * 1.6) - 3) < 0.55 || Math.abs(Math.sqrt((x - 7) * (x - 7) + (y - 4) * (y - 4) * 1.6) - 5.5) < 0.55;
      if (ring) c = "#5FB0B8";
      set(x0 + x, y0 + y, c);
    }
  }
  for (const [x, y] of [
    [1, 8],
    [2, 7],
    [3, 7],
    [4, 6],
    [6, 5],
  ] as const)
    set(x0 + x, y0 + y, ROPE_RED);
  set(x0 + 7, y0 + 3, ROPE_RED);
  set(x0 + 8, y0 + 4, ROPE_RED);
  set(x0 + 7, y0 + 5, ROPE_RED);
  set(x0 + 6, y0 + 4, ROPE_RED);
  set(x0 + 7, y0 + 4, ROPE_RED);
}

function paintFlag(layer: MutableGrid): void {
  const set = plotOn(layer);
  for (let y = 2; y < HERD_ART; y += 1) set(6, y, y === 2 ? SUN : "#8A5A2B");
  for (let y = 3; y <= 9; y += 1) {
    const width = 6 - Math.floor(Math.abs(y - 6) / 2);
    for (let x = 0; x < width; x += 1) set(5 - x, y, y === 6 && x > 1 && x < 4 ? SUN : (x + y) % 5 === 0 ? shade(ROPE_RED, -0.2) : ROPE_RED);
  }
}

const BUTTERFLY = ["WW.WW", "WRBRW", ".WBW.", "W.B.W"] as const;

function paintButterfly(layer: MutableGrid, tip: readonly [number, number]): void {
  const set = plotOn(layer);
  const x0 = Math.round(tip[0]) + HEAD_X - 2;
  const y0 = Math.round(tip[1]) + HEAD_Y - 6;
  BUTTERFLY.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx += 1) {
      const k = row[dx];
      if (k === "W") set(x0 + dx, y0 + dy, dy === 0 ? "#C2F0F6" : dy === 3 ? GLACIER : AQUA);
      else if (k === "R") set(x0 + dx, y0 + dy, "#FFFFFF");
      else if (k === "B") set(x0 + dx, y0 + dy, INK);
    }
  });
}

// ---------------------------------------------------------------- composition

function rimOf(figure: PixelGrid, color: string): MutableGrid {
  const rim = blankArt();
  for (let y = 0; y < HERD_ART; y += 1) {
    for (let x = 0; x < HERD_ART; x += 1) {
      if (figure[y]![x]) continue;
      if (at(figure, x + 1, y) || at(figure, x - 1, y) || at(figure, x, y + 1) || at(figure, x, y - 1)) rim[y]![x] = color;
    }
  }
  return rim;
}

/** The goat without a backdrop: the outlined layers stacked (null = backdrop). */
export function paintFigure(look: HerdLook): MutableGrid {
  const ink = look.fx?.ink ?? INK;
  const figure = blankArt();

  // back: the planted flag
  if (look.accessory.kind === "flag") {
    const back = blankArt();
    paintFlag(back);
    stamp(figure, outline(back, ink));
  }

  // neck and chest
  const body = blankArt();
  paintBody(body, look.fur);
  stamp(figure, outline(body, ink));

  // neck item
  if (look.neck.kind !== "none") {
    const neck = blankArt();
    paintNeck(neck, look.neck);
    stamp(figure, outline(neck, ink));
  }

  // the head: horns, the mascot's head, the face, headwear
  const head = blankArt();
  paintHorns(head, look.horn);
  const plot = plotOn(head, HEAD_X, HEAD_Y);
  const sym = mirrored(plot);
  paintElyHead(plot, { fur: look.fur, horn: look.horn.palette, spine: [], blaze: true, beard: look.beard !== "clean", muzzle: look.muzzle ?? MUZZLE, blush: BLUSH });
  paintBeard(sym, look.beard, look.fur);
  paintEyes(plot, sym, look.eye);
  paintElyNose(sym);
  paintMouth(plot, sym, look.mouth);
  look.fx?.head?.(plot, sym);
  if (look.accessory.kind === "goggles") {
    for (let x = 7; x <= 15; x += 1) sym(x, 11, INK);
    for (let y = 10; y <= 12; y += 1) for (let x = 10; x <= 12; x += 1) sym(x, y, AQUA);
    sym(10, 10, WHITE);
    sym(12, 12, GLACIER);
  }
  if (look.accessory.kind === "earring") {
    plot(1, 17, SUN);
    plot(1, 18, "#B38600");
    plot(2, 19, SUN);
  }
  paintHeadwear(plot, sym, look.headwear);
  stamp(figure, outline(head, ink));

  // front: things held or perched
  if (look.accessory.kind === "iceaxe" || look.accessory.kind === "map" || look.accessory.kind === "butterfly") {
    const front = blankArt();
    if (look.accessory.kind === "iceaxe") paintIceAxe(front);
    if (look.accessory.kind === "map") paintMap(front);
    if (look.accessory.kind === "butterfly") paintButterfly(front, hornTip(look.horn.shape));
    stamp(figure, outline(front, ink));
  }

  const recolor = look.fx?.recolor;
  if (recolor) for (const row of figure) for (let x = 0; x < row.length; x += 1) if (row[x]) row[x] = recolor(row[x]!);
  return figure;
}

/** Paints one goat: a full 48 x 48 grid of hex colours (no transparent cells). */
export function paintHerd(look: HerdLook, seed: number): PixelGrid {
  const art = blankArt();
  if (look.fx?.backdrop) look.fx.backdrop(art, seed);
  else paintBackdrop(art, look.backdrop, seed);
  look.fx?.behind?.(art);
  const figure = paintFigure(look);
  const rim = look.fx?.rim !== undefined ? look.fx.rim : backdropRim(look.backdrop);
  if (rim) stamp(art, rimOf(figure, rim));
  stamp(art, figure);
  look.fx?.over?.(art, figure);
  return art;
}
