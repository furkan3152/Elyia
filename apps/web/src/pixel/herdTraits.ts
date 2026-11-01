/**
 * The Herd's trait tables (pure data): nine layered categories, each option
 * with a weight (out of 1000 per category) and what it draws. Conflict rules
 * keep incompatible layers apart. `herd.ts` rolls the collection from these;
 * `herdArt.ts` draws them.
 */
import { LAYERS } from "./ely";
import type { AccessoryKind, Backdrop, HeadwearKind, HerdBeard, HerdEye, HerdMouth, HornSpec, NeckKind, Triple, Worn } from "./herdArt";

export interface TraitOption<V> {
  readonly name: string;
  /** Weight out of the category's total (each category sums to 1000). */
  readonly weight: number;
  readonly value: V;
}

/** Trait categories, in layer order (back to front), as they appear in metadata. */
export const TRAIT_KEYS = ["background", "fur", "horns", "eyes", "mouth", "beard", "headwear", "neck", "accessory"] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_LABELS: Readonly<Record<TraitKey, string>> = {
  background: "Background",
  fur: "Fur",
  horns: "Horns",
  eyes: "Eyes",
  mouth: "Mouth",
  beard: "Beard",
  headwear: "Headwear",
  neck: "Neck",
  accessory: "Accessory",
};

const NIGHT_MAP = ["#0B1620", "#10202C", "#152A38", "#1B3445", "#244257"] as const;

export const FUR_PALETTES = {
  Rock: ["#B98552", "#8A5A2B", "#DCAA78"],
  Cocoa: ["#7A4E2D", "#55331C", "#A3724A"],
  Sand: ["#D9BE8C", "#AE915F", "#F0DDB4"],
  Snow: ["#ECE6DA", "#BDB3A2", "#FFFFFF"],
  Ash: ["#5B6B73", "#3B474D", "#80919A"],
  Ember: ["#C9643C", "#91401E", "#E8906A"],
  Slate: ["#6F7F99", "#4C5970", "#97A6BF"],
  Glacier: ["#7FD3E0", "#3C9FB0", "#C2F0F6"],
  Gold: ["#D8A93A", "#A0730F", "#F4D274"],
  Onyx: ["#2E363B", "#1E2427", "#4D5961"],
} as const satisfies Record<string, Triple>;

export const HORN_PALETTES = {
  Ivory: ["#EAD5A9", "#B0915E", "#FFF1D2"],
  Obsidian: ["#3A3F44", "#6B757C", "#59626A"],
  Ice: ["#DDEFF3", "#8FB9C4", "#FFFFFF"],
  Bronze: ["#B07A44", "#7A4E2D", "#D3A66E"],
  Gold: ["#F2C200", "#B38600", "#FFE27A"],
  Crystal: ["#7FD3E0", "#3C9FB0", "#C2F0F6"],
} as const satisfies Record<string, Triple>;

export interface HerdTraitTable {
  readonly background: ReadonlyArray<TraitOption<Backdrop>>;
  readonly fur: ReadonlyArray<TraitOption<Triple>>;
  readonly horns: ReadonlyArray<TraitOption<HornSpec>>;
  readonly eyes: ReadonlyArray<TraitOption<HerdEye>>;
  readonly mouth: ReadonlyArray<TraitOption<HerdMouth>>;
  readonly beard: ReadonlyArray<TraitOption<HerdBeard>>;
  readonly headwear: ReadonlyArray<TraitOption<Worn<HeadwearKind>>>;
  readonly neck: ReadonlyArray<TraitOption<Worn<NeckKind>>>;
  readonly accessory: ReadonlyArray<TraitOption<Worn<AccessoryKind>>>;
}

export const HERD_TRAIT_TABLE: HerdTraitTable = {
  background: [
    { name: "Floor", weight: 205, value: { kind: "topo", palette: LAYERS.Floor } },
    { name: "Ridge", weight: 190, value: { kind: "topo", palette: LAYERS.Ridge } },
    { name: "Summit", weight: 170, value: { kind: "topo", palette: LAYERS.Summit } },
    { name: "Night", weight: 120, value: { kind: "night", palette: NIGHT_MAP, contour: 0.32 } },
    { name: "Sunrise", weight: 110, value: { kind: "topo", palette: ["#C4566F", "#E07A6B", "#F2A271", "#F7CB82", "#FFE9A8"] } },
    { name: "Survey paper", weight: 90, value: { kind: "topo", palette: ["#F2ECDD", "#ECE4D1", "#E5DCC6", "#DDD2BA", "#D5C8AE"], contour: 0.16 } },
    { name: "Gold summit", weight: 40, value: { kind: "topo", palette: LAYERS.Gold } },
    { name: "Aurora", weight: 30, value: { kind: "aurora", palette: NIGHT_MAP, contour: 0.32 } },
    { name: "Blizzard", weight: 30, value: { kind: "blizzard", palette: ["#85CCD8", "#A9DCE4", "#C3EAF0", "#DDF3F6", "#F4FBFC"], contour: 0.12 } },
    { name: "Alpenglow", weight: 15, value: { kind: "alpenglow", palette: ["#5B2A4A", "#8C3B5C", "#C4566F", "#E07A6B", "#F2A271"] } },
  ],
  fur: [
    { name: "Rock", weight: 220, value: FUR_PALETTES.Rock },
    { name: "Cocoa", weight: 150, value: FUR_PALETTES.Cocoa },
    { name: "Sand", weight: 140, value: FUR_PALETTES.Sand },
    { name: "Snow", weight: 120, value: FUR_PALETTES.Snow },
    { name: "Ash", weight: 110, value: FUR_PALETTES.Ash },
    { name: "Ember", weight: 90, value: FUR_PALETTES.Ember },
    { name: "Slate", weight: 70, value: FUR_PALETTES.Slate },
    { name: "Glacier", weight: 50, value: FUR_PALETTES.Glacier },
    { name: "Gold", weight: 30, value: FUR_PALETTES.Gold },
    { name: "Onyx", weight: 20, value: FUR_PALETTES.Onyx },
  ],
  horns: [
    { name: "Ivory curl", weight: 290, value: { shape: "curl", finish: "plain", palette: HORN_PALETTES.Ivory } },
    { name: "Ivory sweep", weight: 140, value: { shape: "swept", finish: "plain", palette: HORN_PALETTES.Ivory } },
    { name: "Obsidian curl", weight: 130, value: { shape: "curl", finish: "plain", palette: HORN_PALETTES.Obsidian } },
    { name: "Ice", weight: 110, value: { shape: "curl", finish: "ice", palette: HORN_PALETTES.Ice } },
    { name: "Kid", weight: 90, value: { shape: "kid", finish: "plain", palette: HORN_PALETTES.Ivory } },
    { name: "Broken", weight: 80, value: { shape: "broken", finish: "plain", palette: HORN_PALETTES.Ivory } },
    { name: "Ram", weight: 70, value: { shape: "ram", finish: "plain", palette: HORN_PALETTES.Bronze } },
    { name: "Spire", weight: 40, value: { shape: "spire", finish: "plain", palette: HORN_PALETTES.Obsidian } },
    { name: "Golden", weight: 30, value: { shape: "swept", finish: "gold", palette: HORN_PALETTES.Gold } },
    { name: "Crystal", weight: 20, value: { shape: "swept", finish: "crystal", palette: HORN_PALETTES.Crystal } },
  ],
  eyes: [
    { name: "Curious", weight: 360, value: "open" },
    { name: "Happy", weight: 160, value: "happy" },
    { name: "Sleepy", weight: 110, value: "sleep" },
    { name: "Wink", weight: 80, value: "wink" },
    { name: "Side-eye", weight: 80, value: "side" },
    { name: "Worried", weight: 70, value: "worried" },
    { name: "Glacier", weight: 60, value: "glow" },
    { name: "Starry", weight: 50, value: "starry" },
    { name: "Laser", weight: 30, value: "laser" },
  ],
  mouth: [
    { name: "Smile", weight: 340, value: "smile" },
    { name: "Grin", weight: 180, value: "grin" },
    { name: "Flat", weight: 120, value: "flat" },
    { name: "Tongue", weight: 100, value: "tongue" },
    { name: "Grass sprig", weight: 100, value: "grass" },
    { name: "Gasp", weight: 80, value: "o" },
    { name: "Fang", weight: 80, value: "fang" },
  ],
  beard: [
    { name: "Classic", weight: 520, value: "classic" },
    { name: "Long", weight: 200, value: "long" },
    { name: "Braided", weight: 120, value: "braided" },
    { name: "Frosted", weight: 100, value: "frosted" },
    { name: "Clean", weight: 60, value: "clean" },
  ],
  headwear: [
    { name: "None", weight: 470, value: { kind: "none" } },
    { name: "Headlamp", weight: 120, value: { kind: "headlamp", color: "#17788C" } },
    { name: "Cap", weight: 70, value: { kind: "cap", color: "#17788C" } },
    { name: "Edelweiss", weight: 60, value: { kind: "edelweiss" } },
    { name: "Helmet red", weight: 50, value: { kind: "helmet", color: "#C62D1F" } },
    { name: "Beanie red", weight: 45, value: { kind: "beanie", color: "#C62D1F" } },
    { name: "Beanie teal", weight: 45, value: { kind: "beanie", color: "#1E6B7D" } },
    { name: "Helmet sun", weight: 40, value: { kind: "helmet", color: "#F2C200" } },
    { name: "Helmet glacier", weight: 40, value: { kind: "helmet", color: "#4FA7BA" } },
    { name: "Beanie ochre", weight: 30, value: { kind: "beanie", color: "#B07A44" } },
    { name: "Crown", weight: 30, value: { kind: "crown" } },
  ],
  neck: [
    { name: "None", weight: 320, value: { kind: "none" } },
    { name: "Climbing rope", weight: 150, value: { kind: "rope", color: "#C62D1F" } },
    { name: "Scarf", weight: 120, value: { kind: "scarf", color: "#C62D1F" } },
    { name: "Bandana", weight: 110, value: { kind: "bandana", color: "#17788C" } },
    { name: "Bell", weight: 110, value: { kind: "bell" } },
    { name: "Carabiner", weight: 90, value: { kind: "carabiner", color: "#1E6B7D" } },
    { name: "Künye", weight: 70, value: { kind: "tag" } },
    { name: "Summit pendant", weight: 30, value: { kind: "pendant" } },
  ],
  accessory: [
    { name: "None", weight: 550, value: { kind: "none" } },
    { name: "Glacier goggles", weight: 130, value: { kind: "goggles" } },
    { name: "Ice axe", weight: 120, value: { kind: "iceaxe" } },
    { name: "Trail map", weight: 90, value: { kind: "map" } },
    { name: "Gold earring", weight: 50, value: { kind: "earring" } },
    { name: "Summit flag", weight: 30, value: { kind: "flag" } },
    { name: "Apollo butterfly", weight: 30, value: { kind: "butterfly" } },
  ],
};

/** A pair of options that never share a goat: [key, option name] x 2. The later category is re-rolled. */
export type TraitConflict = readonly [TraitKey, string, TraitKey, string, string];

const FOREHEAD = ["Headlamp", "Cap", "Helmet red", "Helmet sun", "Helmet glacier", "Beanie red", "Beanie teal", "Beanie ochre"] as const;
const HANGING = ["Bell", "Carabiner", "Künye", "Summit pendant"] as const;

/**
 * The conflict rules (each with its reason). One option per category already
 * keeps two headwears (helmet and crown) or two neck items apart; these keep
 * layers in different categories from fighting over the same pixels.
 */
export const HERD_CONFLICTS: readonly TraitConflict[] = [
  ...FOREHEAD.map((hat) => ["headwear", hat, "accessory", "Glacier goggles", "goggles sit on the forehead, under the brim"] as const),
  ...HANGING.map((item) => ["beard", "Long", "neck", item, "a long beard hides what hangs at the throat"] as const),
  ["headwear", "Crown", "accessory", "Glacier goggles", "a crown takes the forehead"],
  ["headwear", "Edelweiss", "accessory", "Apollo butterfly", "one flower-and-wing moment per goat"],
  ["eyes", "Laser", "accessory", "Glacier goggles", "lasers under goggles"],
  ["horns", "Kid", "accessory", "Apollo butterfly", "kid horns are too short to perch on"],
  ["horns", "Spire", "headwear", "Crown", "spire horns crowd the crown"],
  ["background", "Alpenglow", "accessory", "Summit flag", "the flag is already on the ridge"],
  ["fur", "Snow", "background", "Blizzard", "white on white"],
  ["fur", "Glacier", "background", "Summit", "aqua on aqua"],
  ["fur", "Glacier", "background", "Blizzard", "aqua on ice"],
  ["fur", "Gold", "background", "Gold summit", "gold on gold"],
  ["fur", "Onyx", "background", "Night", "black on the night"],
  ["fur", "Onyx", "background", "Aurora", "black on the night"],
  ["mouth", "Grass sprig", "accessory", "Trail map", "the map's corner meets the sprig"],
  ["mouth", "Grass sprig", "headwear", "Edelweiss", "too much garden"],
];

const CONFLICT_SET = new Set(HERD_CONFLICTS.flatMap(([k1, n1, k2, n2]) => [`${k1}:${n1}|${k2}:${n2}`, `${k2}:${n2}|${k1}:${n1}`]));

/** True when two chosen options may not share a goat. */
export function conflicts(a: TraitKey, aName: string, b: TraitKey, bName: string): boolean {
  return CONFLICT_SET.has(`${a}:${aName}|${b}:${bName}`);
}
