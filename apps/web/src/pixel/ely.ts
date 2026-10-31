/**
 * Ely, the pixel ibex (pure). Ported from the Pixel Survey reference: a
 * 32 x 34 sprite built from shapes on the left half, mirrored for symmetry,
 * then outlined in ink. Every function here is deterministic and DOM free.
 */

/** A colour grid: `grid[y][x]` is a CSS hex colour or null (transparent). */
export type PixelGrid = ReadonlyArray<ReadonlyArray<string | null>>;
type MutableGrid = Array<Array<string | null>>;

export const ELY_W = 32;
export const ELY_H = 34;
export const INK = "#16201B";
export const WHITE = "#FFFFFF";
export const SUN = "#F2C200";
export const ROPE_RED = "#C62D1F";
export const GLACIER = "#17788C";
export const AQUA = "#6FD3E3";
const BLUSH = "#E59A84";
const MUZZLE = "#F1DFC0";
const LASER = "#FF4D4D";

/** Fur: [base, dark, light]. */
export const FURS = {
  Rock: ["#B98552", "#8A5A2B", "#DCAA78"],
  Snow: ["#ECE6DA", "#BDB3A2", "#FFFFFF"],
  Night: ["#5B6B73", "#3B474D", "#80919A"],
  Ember: ["#C9643C", "#91401E", "#E8906A"],
  Gold: ["#D8A93A", "#A0730F", "#F4D274"],
  Glacier: ["#7FD3E0", "#3C9FB0", "#C2F0F6"],
} as const satisfies Record<string, readonly [string, string, string]>;

/** Horns: [base, ring, top light]. */
export const HORNS = {
  Ivory: ["#EAD5A9", "#B0915E", "#FFF1D2"],
  Ice: ["#DDEFF3", "#8FB9C4", "#FFFFFF"],
  Obsidian: ["#3A3F44", "#6B757C", "#59626A"],
  Gold: ["#F2C200", "#B38600", "#FFE27A"],
} as const satisfies Record<string, readonly [string, string, string]>;

export type FurName = keyof typeof FURS;
export type HornName = keyof typeof HORNS;

export const EYES = ["open", "happy", "sleep", "worried", "laser", "blink"] as const;
export const MOUTHS = ["smile", "grin", "flat", "o"] as const;
export const GEAR = ["none", "lamp", "crown", "cap", "bandana", "rope", "goggles"] as const;
export type EyeKind = (typeof EYES)[number];
export type MouthKind = (typeof MOUTHS)[number];
export type GearKind = (typeof GEAR)[number];

/** Altitude palettes, low band to high band. Floor = HyperCore, Ridge = HyperEVM, Summit = Elysium, Gold = the rare one. */
export const LAYERS = {
  Floor: ["#0F4C5C", "#1E6B7D", "#2D8796", "#5FB0B8", "#A7D6D6"],
  Ridge: ["#6B4423", "#8A5A2B", "#B07A44", "#D3A66E", "#EED6AE"],
  Summit: ["#2E7F94", "#4FA7BA", "#85CCD8", "#C3EAF0", "#FFFFFF"],
  Gold: ["#8A6100", "#B98A10", "#E0B52E", "#F6DA72", "#FFF3C4"],
} as const satisfies Record<string, readonly string[]>;
export type LayerName = keyof typeof LAYERS;

export interface ElyTraits {
  readonly fur?: FurName;
  readonly horn?: HornName;
  readonly eye?: EyeKind;
  readonly mouth?: MouthKind;
  readonly gear?: GearKind;
  /** Colour of cloth gear (cap, bandana, lamp strap). */
  readonly gearColor?: string;
  /** The white chevrons on the forehead (default on). */
  readonly blaze?: boolean;
}

export const DEFAULT_TRAITS: Required<ElyTraits> = { fur: "Rock", horn: "Ivory", eye: "open", mouth: "smile", gear: "none", gearColor: GLACIER, blaze: true };

function bez(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** The horn's centre line: a cubic sweep from the crown out and down, with its taper parameter. */
const HORN_SPINE: ReadonlyArray<readonly [number, number, number]> = Array.from({ length: 61 }, (_, i) => {
  const t = i / 60;
  return [bez(t, 12.6, 10, 3.5, 1.4), bez(t, 10.5, 0.5, 0.2, 6.2), t] as const;
});

/** Head half-width at row y (an ellipse cap over a tapering muzzle). */
function headHalfWidth(y: number): number {
  if (y < 8.6) return -1;
  if (y <= 18.5) return 8.7 * Math.sqrt(Math.max(0, 1 - ((y - 17) / 8.6) ** 2));
  return 8.5 + (1.4 - 8.5) * ((y - 18.5) / 9.6);
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Adds a one pixel ink outline around every coloured shape (4-neighbourhood). */
export function outline(grid: PixelGrid, ink = INK): PixelGrid {
  const out: MutableGrid = grid.map((row) => row.slice());
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) continue;
      if (NEIGHBOURS.some(([dx, dy]) => Boolean(grid[y + dy]?.[x + dx]))) out[y]![x] = ink;
    }
  }
  return out;
}

/** Builds Ely from traits: a 32 x 34 colour grid (row 0 is a spare row for crowns). */
export function makeEly(traits: ElyTraits = {}): PixelGrid {
  const t = { ...DEFAULT_TRAITS, ...traits };
  const [F, FD, FL] = FURS[t.fur] ?? FURS.Rock;
  const [H, HR, HL] = HORNS[t.horn] ?? HORNS.Ivory;
  const g: MutableGrid = Array.from({ length: ELY_H }, () => Array<string | null>(ELY_W).fill(null));
  const set = (x: number, y: number, c: string) => {
    const yy = y + 1;
    if (x >= 0 && yy >= 0 && x < ELY_W && yy < ELY_H) g[yy]![x] = c;
  };
  const sym = (x: number, y: number, c: string) => {
    set(x, y, c);
    set(31 - x, y, c);
  };

  for (let y = 0; y < ELY_W; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = 16 - px;
      // horns: distance to the tapered spine, with growth rings
      let best = 9;
      let bt = 0;
      for (const [hx, hy, ht] of HORN_SPINE) {
        const d = Math.hypot(px - hx, py - hy) - (2.3 - 1.4 * ht);
        if (d < best) {
          best = d;
          bt = ht;
        }
      }
      if (best <= 0) sym(x, y, (bt * 8) % 1 < 0.22 ? HR : H);
      // ears: a tilted ellipse with a pink inner ear
      const ex = px - 5.6;
      const ey = py - 15.2;
      const ca = Math.cos(-0.35);
      const sa = Math.sin(-0.35);
      const rx = ex * ca - ey * sa;
      const ry = ex * sa + ey * ca;
      if ((rx / 3.4) ** 2 + (ry / 1.5) ** 2 <= 1) sym(x, y, (rx / 2.2) ** 2 + (ry / 0.7) ** 2 <= 1 ? BLUSH : F);
      // head
      const w = headHalfWidth(py);
      if (w > 0 && dx <= w) sym(x, y, dx > w - 1.3 && py > 15 ? FD : py < 11.5 && dx < 5 ? FL : F);
      // beard
      if (py >= 27.5 && py <= 30.6 && dx <= (31 - py) * 0.45 + 0.4) sym(x, y, FD);
      // muzzle
      if ((dx / 4.4) ** 2 + ((py - 23.4) / 4.1) ** 2 <= 1) sym(x, y, MUZZLE);
    }
  }
  // horn top light
  for (let y = 1; y < ELY_H; y += 1) for (let x = 0; x < ELY_W; x += 1) if (g[y]![x] === H && g[y - 1]![x] === null) g[y]![x] = HL;
  // blaze chevrons
  if (t.blaze) {
    for (const off of [0, 2]) {
      sym(15, 11 + off, FL);
      sym(14, 12 + off, FL);
      sym(13, 13 + off, FL);
    }
  }
  sym(8, 20, BLUSH);

  const eyes: Record<EyeKind, () => void> = {
    open: () => {
      for (let y = 15; y <= 18; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, WHITE);
      sym(11, 16, INK);
      sym(10, 17, INK);
      sym(11, 17, INK);
      sym(10, 16, WHITE);
      sym(11, 18, INK);
      sym(10, 18, INK);
    },
    happy: () => {
      sym(9, 17, INK);
      sym(10, 16, INK);
      sym(11, 16, INK);
      sym(12, 17, INK);
    },
    sleep: () => {
      sym(9, 17, INK);
      sym(10, 18, INK);
      sym(11, 18, INK);
      sym(12, 17, INK);
    },
    worried: () => {
      for (let y = 16; y <= 18; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, WHITE);
      sym(10, 17, INK);
      sym(10, 18, INK);
      sym(8, 14, INK);
      sym(9, 14, INK);
      sym(10, 15, INK);
    },
    laser: () => {
      for (let x = 7; x <= 15; x += 1) {
        sym(x, 16, INK);
        sym(x, 17, INK);
      }
      sym(15, 15, INK);
      sym(9, 16, LASER);
      sym(10, 16, LASER);
      sym(9, 17, "#FF9A8A");
    },
    blink: () => {
      sym(9, 17, INK);
      sym(10, 17, INK);
      sym(11, 17, INK);
    },
  };
  (eyes[t.eye] ?? eyes.open)();

  // nose
  sym(14, 21, INK);
  sym(15, 21, INK);
  sym(15, 22, INK);
  const mouths: Record<MouthKind, () => void> = {
    smile: () => {
      sym(13, 24, INK);
      sym(14, 25, INK);
      sym(15, 25, INK);
    },
    grin: () => {
      sym(13, 24, INK);
      sym(14, 25, INK);
      sym(15, 25, INK);
      sym(14, 24, WHITE);
      sym(15, 24, WHITE);
    },
    flat: () => {
      sym(14, 25, INK);
      sym(15, 25, INK);
    },
    o: () => {
      sym(15, 24, INK);
      sym(15, 25, INK);
      sym(14, 24, INK);
      sym(14, 25, INK);
    },
  };
  (mouths[t.mouth] ?? mouths.smile)();

  const C = t.gearColor;
  switch (t.gear) {
    case "lamp":
      for (let x = 7; x <= 15; x += 1) if (g[11]![x]) sym(x, 10, C);
      for (let x = 14; x <= 15; x += 1) {
        sym(x, 8, INK);
        sym(x, 9, SUN);
      }
      sym(13, 9, INK);
      sym(13, 8, INK);
      break;
    case "crown":
      for (let x = 12; x <= 15; x += 1) {
        sym(x, 7, SUN);
        sym(x, 6, SUN);
      }
      sym(12, 5, SUN);
      sym(12, 4, SUN);
      sym(15, 5, SUN);
      sym(15, 4, SUN);
      sym(15, 3, SUN);
      sym(13, 6, LASER);
      break;
    case "cap":
      for (let y = 7; y <= 10; y += 1) {
        for (let x = 8; x <= 15; x += 1) {
          if (y > 7 || x > 10) {
            set(x, y, C);
            set(31 - x, y, C);
          }
        }
      }
      for (let x = 23; x <= 28; x += 1) set(x, 10, C);
      break;
    case "bandana":
      for (let y = 26; y <= 28; y += 1) for (let x = 9 + (y - 26) * 2; x <= 15; x += 1) sym(x, y, C);
      sym(12, 27, WHITE);
      break;
    case "rope":
      for (let x = 9; x <= 15; x += 1) sym(x, 27, x % 2 ? SUN : ROPE_RED);
      set(23, 27, INK);
      set(24, 26, INK);
      set(25, 27, INK);
      set(24, 28, INK);
      break;
    case "goggles":
      for (let x = 7; x <= 15; x += 1) sym(x, 11, INK);
      for (let y = 10; y <= 12; y += 1) for (let x = 10; x <= 12; x += 1) sym(x, y, AQUA);
      sym(10, 10, WHITE);
      break;
    default:
      break;
  }
  return outline(g);
}

/** The half-size sprite (16 x 17) for scenes and maps: each 2 x 2 block keeps its first coloured pixel. */
export function mini(grid: PixelGrid): PixelGrid {
  const out: Array<Array<string | null>> = [];
  for (let y = 0; y < grid.length; y += 2) {
    const row: Array<string | null> = [];
    const width = grid[y]?.length ?? 0;
    for (let x = 0; x < width; x += 2) row.push(grid[y]?.[x] ?? grid[y + 1]?.[x] ?? grid[y]?.[x + 1] ?? null);
    out.push(row);
  }
  return out;
}

/** Mirrors a grid left to right (Ely facing the other way). */
export function mirror(grid: PixelGrid): PixelGrid {
  return grid.map((row) => row.slice().reverse());
}

const cache = new Map<string, PixelGrid>();

/** Memoised `makeEly`: sprites are pure, so a trait set is built once per page. */
export function elySprite(traits: ElyTraits = {}): PixelGrid {
  const t = { ...DEFAULT_TRAITS, ...traits };
  const key = `${t.fur}|${t.horn}|${t.eye}|${t.mouth}|${t.gear}|${t.gearColor}|${t.blaze}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grid = makeEly(t);
  cache.set(key, grid);
  return grid;
}
