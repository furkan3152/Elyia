/**
 * The Herd's legendaries (pure): fifteen hand-made 1/1 goats. Each is a full
 * look built from the same parts as the herd, plus its own backdrop, light or
 * palette. Their numbers are drawn by the seeded roster in `herd.ts`.
 */
import { AQUA, GLACIER, INK, LAYERS, ROPE_RED, SUN, WHITE, type MutableGrid } from "./ely";
import { NIGHT_HALO } from "./draw";
import { HERD_ART, disc, herdField, moon, paintBackdrop, paintTopo, type HerdLook, type LookFx } from "./herdArt";
import { FUR_PALETTES, HERD_TRAIT_TABLE, HORN_PALETTES } from "./herdTraits";
import { rngOf, shade } from "./topo";

export interface HerdLegend {
  /** The 1/1's name (its "Legendary" attribute). */
  readonly name: string;
  /** One line for the metadata description. */
  readonly story: string;
  readonly look: HerdLook;
}

const bg = (name: string) => HERD_TRAIT_TABLE.background.find((option) => option.name === name)!.value;
const NIGHT = bg("Night");

/** Pseudo-angle of (dx, dy) in [0, 4), from + - * / only (the "diamond angle"). */
function diamondAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

function rays(art: MutableGrid, cx: number, cy: number, sectors: number, paint: (x: number, y: number, on: boolean) => string | null): void {
  for (let y = 0; y < HERD_ART; y += 1) {
    for (let x = 0; x < HERD_ART; x += 1) {
      const a = diamondAngle(x + 0.5 - cx, y + 0.5 - cy);
      const c = paint(x, y, Math.floor((a / 4) * sectors) % 2 === 0);
      if (c) art[y]![x] = c;
    }
  }
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 255000;
}

function tones(dark: string, mid: string, light: string, ink: string, keep: readonly string[] = []): (hex: string) => string {
  return (hex) => {
    if (hex === INK) return ink;
    if (keep.includes(hex)) return hex;
    const l = luminance(hex);
    return l > 0.72 ? light : l > 0.42 ? mid : dark;
  };
}

function snowfall(seed: number, count: number): LookFx["over"] {
  return (art) => {
    const r = rngOf(seed);
    for (let i = 0; i < count; i += 1) {
      const x = Math.floor(r() * HERD_ART);
      const y = Math.floor(r() * HERD_ART);
      art[y]![x] = i % 3 === 0 ? "#E8F6F8" : WHITE;
    }
  };
}

const base = {
  eye: "open",
  mouth: "smile",
  beard: "classic",
  headwear: { kind: "none" },
  neck: { kind: "none" },
  accessory: { kind: "none" },
} as const;

export const HERD_LEGENDS: readonly HerdLegend[] = [
  {
    name: "Summit King",
    story: "First to every summit, crowned by the sun itself.",
    look: {
      ...base,
      backdrop: { kind: "topo", palette: LAYERS.Gold },
      fur: FUR_PALETTES.Gold,
      horn: { shape: "swept", finish: "gold", palette: HORN_PALETTES.Gold },
      eye: "starry",
      mouth: "grin",
      beard: "braided",
      headwear: { kind: "crown" },
      neck: { kind: "pendant" },
      fx: { behind: (art) => rays(art, 24, 22, 24, (_x, _y, on) => (on ? "#F6DA72" : "#E0B52E")), rim: "#FFF3C4" },
    },
  },
  {
    name: "Moonwalker",
    story: "Climbs only by moonlight; the moon climbs with it.",
    look: {
      ...base,
      backdrop: NIGHT,
      fur: FUR_PALETTES.Ash,
      horn: { shape: "swept", finish: "crystal", palette: HORN_PALETTES.Crystal },
      eye: "sleep",
      mouth: "flat",
      fx: {
        behind: (art) => {
          disc(art, 24, 21, 19, (x, y, d2) => (d2 > 18 * 18 ? "#2A4458" : (x * 3 + y * 5) % 23 === 0 ? "#D5C8AE" : (x + y) % 9 === 0 && d2 < 140 ? "#E5DCC6" : "#F2ECDD"));
          disc(art, 15, 12, 2.5, "#E0D6BE");
          disc(art, 33, 30, 3, "#E0D6BE");
        },
        rim: NIGHT_HALO,
      },
    },
  },
  {
    name: "Glacier Spirit",
    story: "Made of the ice that remembers every route.",
    look: {
      ...base,
      backdrop: bg("Aurora"),
      fur: FUR_PALETTES.Glacier,
      muzzle: "#E8F6F8",
      horn: { shape: "spire", finish: "crystal", palette: HORN_PALETTES.Crystal },
      eye: "glow",
      beard: "frosted",
      headwear: { kind: "halo" },
      fx: { rim: "#C2F0F6" },
    },
  },
  {
    name: "Ember Peak",
    story: "Born in a vent on the ridge; its rings still glow.",
    look: {
      ...base,
      backdrop: { kind: "topo", palette: ["#2A0E0A", "#5C1A0E", "#91401E", "#C9643C", "#F2A271"], contour: 0.35 },
      fur: FUR_PALETTES.Onyx,
      horn: { shape: "curl", finish: "plain", palette: ["#3A3F44", "#F2A271", "#E8906A"] },
      eye: "laser",
      mouth: "fang",
      fx: {
        rim: "#E8906A",
        over: (art, figure) => {
          const r = rngOf(0xe3be);
          for (let i = 0; i < 40; i += 1) {
            const x = Math.floor(r() * HERD_ART);
            const y = Math.floor(r() * 30);
            if (!figure[y]![x]) art[y]![x] = i % 2 ? "#F2C200" : "#F2A271";
          }
        },
      },
    },
  },
  {
    name: "The Keeper",
    story: "Keeps the lamp lit while the herd sleeps.",
    look: {
      ...base,
      backdrop: NIGHT,
      fur: FUR_PALETTES.Ash,
      horn: { shape: "curl", finish: "plain", palette: HORN_PALETTES.Ivory },
      headwear: { kind: "helmet", color: SUN },
      neck: { kind: "carabiner", color: GLACIER },
      fx: {
        behind: (art) => {
          for (let y = 0; y < 15; y += 1) {
            const spread = (15 - y) * 0.75;
            for (let x = 0; x < HERD_ART; x += 1) {
              const dx = Math.abs(x + 0.5 - 24);
              if (dx <= spread + 1) art[y]![x] = dx > spread - 0.5 ? "#4E7387" : (x + y) % 2 ? "#8FB0BC" : "#C3D9DE";
            }
          }
        },
        rim: NIGHT_HALO,
      },
    },
  },
  {
    name: "Avalanche",
    story: "Rode the slide down and walked back up.",
    look: {
      ...base,
      backdrop: bg("Blizzard"),
      fur: FUR_PALETTES.Slate,
      horn: { shape: "curl", finish: "ice", palette: HORN_PALETTES.Ice },
      eye: "worried",
      mouth: "o",
      neck: { kind: "scarf", color: ROPE_RED },
      accessory: { kind: "goggles" },
      fx: { over: snowfall(0xa7a1, 90) },
    },
  },
  {
    name: "The Cartographer",
    story: "Drew the first map of the three layers.",
    look: {
      ...base,
      backdrop: bg("Survey paper"),
      fur: FUR_PALETTES.Sand,
      horn: { shape: "ram", finish: "plain", palette: HORN_PALETTES.Bronze },
      eye: "side",
      headwear: { kind: "cap", color: "#B07A44" },
      neck: { kind: "tag" },
      accessory: { kind: "map" },
      fx: {
        backdrop: (art, seed) => {
          paintTopo(art, herdField(seed), ["#F2ECDD", "#ECE4D1", "#E5DCC6", "#DDD2BA", "#D5C8AE", "#CBBFA0", "#C2B490"], 0.3);
          for (let i = 0; i < 48; i += 1) {
            const y = 44 - Math.floor(i * 0.9) + (i % 7 < 3 ? 1 : 0);
            if (i % 3 !== 2 && y >= 0) art[y]![i] = ROPE_RED;
          }
          for (const [cx, cy] of [
            [5, 39],
            [42, 6],
          ] as const) {
            art[cy]![cx] = ROPE_RED;
            art[cy - 1]![cx] = ROPE_RED;
            art[cy]![cx - 1] = ROPE_RED;
            art[cy]![cx + 1] = ROPE_RED;
          }
        },
      },
    },
  },
  {
    name: "Rope Master",
    story: "Has tied every knot there is, twice.",
    look: {
      ...base,
      backdrop: bg("Ridge"),
      fur: FUR_PALETTES.Rock,
      horn: { shape: "swept", finish: "plain", palette: HORN_PALETTES.Ivory },
      eye: "happy",
      mouth: "grin",
      headwear: { kind: "helmet", color: ROPE_RED },
      neck: { kind: "rope", color: ROPE_RED },
      accessory: { kind: "iceaxe" },
      fx: {
        behind: (art) => {
          for (let x = 0; x < HERD_ART; x += 1) {
            const y = 4 + Math.floor((x * x) / 110);
            art[y]![x] = (x + y) % 3 === 0 ? SUN : ROPE_RED;
            art[y + 1]![x] = (x + y + 1) % 3 === 0 ? SUN : shade(ROPE_RED, -0.2);
          }
        },
      },
    },
  },
  {
    name: "Floor Warden",
    story: "Guards the floor where every route begins.",
    look: {
      ...base,
      backdrop: bg("Floor"),
      fur: FUR_PALETTES.Slate,
      horn: { shape: "spire", finish: "crystal", palette: HORN_PALETTES.Crystal },
      eye: "laser",
      mouth: "flat",
      headwear: { kind: "headlamp", color: GLACIER },
      neck: { kind: "carabiner", color: SUN },
      fx: {
        behind: (art) => {
          for (let y = 0; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) if (x % 6 === 2 || y % 6 === 2) art[y]![x] = shade(art[y]![x]!, 0.18);
        },
        rim: AQUA,
      },
    },
  },
  {
    name: "Elysium Dawn",
    story: "Planted the first flag as the sun came up.",
    look: {
      ...base,
      backdrop: bg("Alpenglow"),
      fur: FUR_PALETTES.Sand,
      horn: { shape: "curl", finish: "gold", palette: HORN_PALETTES.Gold },
      eye: "happy",
      neck: { kind: "scarf", color: SUN },
      accessory: { kind: "flag" },
    },
  },
  {
    name: "Ridge Ghost",
    story: "Seen in the fog on the ridge, never at the hut.",
    look: {
      ...base,
      backdrop: bg("Survey paper"),
      fur: FUR_PALETTES.Snow,
      horn: { shape: "swept", finish: "plain", palette: HORN_PALETTES.Ice },
      eye: "glow",
      mouth: "o",
      beard: "long",
      fx: {
        backdrop: (art, seed) => {
          paintTopo(art, herdField(seed), ["#DDE3E0", "#E3E8E5", "#E9EDEA", "#EFF2F0", "#F5F7F6"], 0.08);
          for (let y = 0; y < HERD_ART; y += 1) if (y % 7 < 2) for (let x = 0; x < HERD_ART; x += 1) if ((x + y) % 2 === 0) art[y]![x] = "#FFFFFF";
        },
        recolor: tones("#B9C4C0", "#D5DDDA", "#F4F7F6", "#8E9AA3", [AQUA, GLACIER]),
        over: (art, figure) => {
          for (let y = 36; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) if ((x + y) % (y > 41 ? 2 : 3) === 0 && figure[y]![x]) art[y]![x] = "#F5F7F6";
        },
      },
    },
  },
  {
    name: "Old Guide",
    story: "Lost half a horn on the north face; kept the guide's cap.",
    look: {
      ...base,
      backdrop: bg("Ridge"),
      fur: ["#9AA3A0", "#6E7774", "#C7CDCA"],
      horn: { shape: "broken", finish: "plain", palette: HORN_PALETTES.Ivory },
      eye: "sleep",
      mouth: "grass",
      beard: "long",
      headwear: { kind: "cap", color: "#1F7A4C" },
      neck: { kind: "tag" },
      fx: {
        head: (_plot, sym) => {
          for (let y = 28; y <= 36; y += 1) for (let x = 12; x < 16; x += 1) if (16 - (x + 0.5) <= 4.6 - Math.max(0, y + 0.5 - 29) * 0.55) sym(x, y, (x + y) % 3 === 0 ? "#E5DCC6" : WHITE);
        },
      },
    },
  },
  {
    name: "Blueprint",
    story: "The plan every Ely was drawn from.",
    look: {
      ...base,
      backdrop: bg("Floor"),
      fur: FUR_PALETTES.Rock,
      horn: { shape: "curl", finish: "plain", palette: HORN_PALETTES.Ivory },
      fx: {
        backdrop: (art) => {
          for (let y = 0; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) art[y]![x] = x % 8 === 3 || y % 8 === 3 ? "#1E5A85" : (x + y) % 2 === 0 && (x % 8 === 7 || y % 8 === 7) ? "#174B70" : "#123A5C";
        },
        recolor: tones("#163F63", "#1B4E78", "#2F7FB0", "#C2F0F6"),
        rim: null,
      },
    },
  },
  {
    name: "Paper Sketch",
    story: "Ely before the colour: ink on the survey sheet.",
    look: {
      ...base,
      backdrop: bg("Survey paper"),
      fur: FUR_PALETTES.Rock,
      horn: { shape: "curl", finish: "plain", palette: HORN_PALETTES.Ivory },
      eye: "happy",
      fx: {
        backdrop: (art) => {
          for (let y = 0; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) art[y]![x] = y % 6 === 5 ? "#E5DCC6" : "#F2ECDD";
          art[44]![3] = ROPE_RED;
          art[44]![4] = ROPE_RED;
          art[43]![4] = ROPE_RED;
        },
        recolor: tones("#CBBFA0", "#E5DCC6", "#FFF9EC", INK),
      },
    },
  },
  {
    name: "Starborn",
    story: "Fell from the sky above the summit and stayed.",
    look: {
      ...base,
      backdrop: NIGHT,
      fur: FUR_PALETTES.Onyx,
      horn: { shape: "swept", finish: "crystal", palette: HORN_PALETTES.Crystal },
      eye: "starry",
      mouth: "smile",
      headwear: { kind: "halo" },
      fx: {
        backdrop: (art, seed) => {
          paintBackdrop(art, { kind: "night", palette: ["#070D14", "#0B1620", "#10202C", "#152A38", "#1B3445"], contour: 0.3 }, seed);
          const r = rngOf(seed ^ 0x57a2);
          for (let i = 0; i < 60; i += 1) art[Math.floor(r() * HERD_ART)]![Math.floor(r() * HERD_ART)] = i % 4 === 0 ? AQUA : "#F2ECDD";
          moon(art, 41, 7, 3.6);
        },
        head: (plot) => {
          for (const [x, y] of [
            [9, 13],
            [21, 12],
            [12, 20],
            [20, 19],
            [7, 15],
            [24, 15],
          ] as const)
            plot(x, y, y % 2 ? AQUA : WHITE);
        },
        rim: NIGHT_HALO,
      },
    },
  },
];
