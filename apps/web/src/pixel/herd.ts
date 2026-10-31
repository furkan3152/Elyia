/**
 * The Herd (pure): Ely NFT trait tables with weights, seeded generation and
 * rarity. The same number always gives the same Ely on the same map.
 */
import { elySprite, type EyeKind, type FurName, type GearKind, type HornName, type LayerName, type MouthKind, type PixelGrid } from "./ely";
import { rngOf, topoField, type HeightField } from "./topo";

/** One weighted option: [display name, weight, sprite value]. */
export type TraitOption<V> = readonly [name: string, weight: number, value: V];

export const HERD_TRAITS = {
  layer: [
    ["Floor", 40, "Floor"],
    ["Ridge", 35, "Ridge"],
    ["Summit", 20, "Summit"],
    ["Gold summit", 5, "Gold"],
  ] as ReadonlyArray<TraitOption<LayerName>>,
  fur: [
    ["Rock", 36, "Rock"],
    ["Snow", 20, "Snow"],
    ["Night", 18, "Night"],
    ["Ember", 14, "Ember"],
    ["Glacier", 8, "Glacier"],
    ["Gold", 4, "Gold"],
  ] as ReadonlyArray<TraitOption<FurName>>,
  horn: [
    ["Ivory", 50, "Ivory"],
    ["Ice", 28, "Ice"],
    ["Obsidian", 16, "Obsidian"],
    ["Gold", 6, "Gold"],
  ] as ReadonlyArray<TraitOption<HornName>>,
  gear: [
    ["None", 28, "none"],
    ["Headlamp", 20, "lamp"],
    ["Rope", 18, "rope"],
    ["Cap", 12, "cap"],
    ["Goggles", 10, "goggles"],
    ["Bandana", 8, "bandana"],
    ["Crown", 4, "crown"],
  ] as ReadonlyArray<TraitOption<GearKind>>,
  eye: [
    ["Curious", 55, "open"],
    ["Happy", 25, "happy"],
    ["Sleepy", 12, "sleep"],
    ["Laser", 8, "laser"],
  ] as ReadonlyArray<TraitOption<EyeKind>>,
  mouth: [
    ["Smile", 50, "smile"],
    ["Grin", 25, "grin"],
    ["Flat", 15, "flat"],
    ["Gasp", 10, "o"],
  ] as ReadonlyArray<TraitOption<MouthKind>>,
} as const;

export type TraitKey = keyof typeof HERD_TRAITS;
export const TRAIT_KEYS: readonly TraitKey[] = ["layer", "fur", "horn", "gear", "eye", "mouth"];
export const TRAIT_LABELS: Readonly<Record<TraitKey, string>> = { layer: "Layer", fur: "Fur", horn: "Horns", gear: "Gear", eye: "Eyes", mouth: "Mouth" };

/** Cloth colours for caps and bandanas. */
export const GEAR_COLORS = ["#17788C", "#C62D1F", "#16201B", "#2F6FD6"] as const;

export type Rarity = "legendary" | "rare" | "uncommon" | "common";
export const RARITY_LABEL: Readonly<Record<Rarity, string>> = { legendary: "Legendary", rare: "Rare", uncommon: "Uncommon", common: "Common" };
/** Badge fill per rarity (null: no fill). */
export const RARITY_FILL: Readonly<Record<Rarity, string | null>> = { legendary: "#F2C200", rare: "#E8906A", uncommon: "#A7D6D6", common: null };

export const HERD_SIZE = 9999;

export interface HerdTrait {
  readonly key: TraitKey;
  readonly name: string;
  /** Share of the herd with this trait (0..1). */
  readonly share: number;
}

export interface HerdMember {
  readonly id: number;
  readonly traits: readonly HerdTrait[];
  readonly layer: LayerName;
  /** Product of the trait shares: the chance of this exact combination. */
  readonly odds: number;
  readonly rarity: Rarity;
  readonly grid: PixelGrid;
  /** The member's own 32 x 34 elevation map, painted with its layer's palette. */
  readonly field: HeightField;
}

function total(list: ReadonlyArray<TraitOption<unknown>>): number {
  return list.reduce((sum, option) => sum + option[1], 0);
}

function pick<V>(random: () => number, list: ReadonlyArray<TraitOption<V>>): TraitOption<V> {
  let v = random() * total(list);
  for (const option of list) {
    v -= option[1];
    if (v < 0) return option;
  }
  return list[0]!;
}

export function rarityOf(odds: number): Rarity {
  if (odds < 0.00002) return "legendary";
  if (odds < 0.00012) return "rare";
  if (odds < 0.0008) return "uncommon";
  return "common";
}

/** "#0777" */
export function herdLabel(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

/** Generates herd member `id` (1..9999). Deterministic. */
export function herdMember(id: number): HerdMember {
  const random = rngOf(id * 7919 + 13);
  const layer = pick(random, HERD_TRAITS.layer);
  const fur = pick(random, HERD_TRAITS.fur);
  const horn = pick(random, HERD_TRAITS.horn);
  const gear = pick(random, HERD_TRAITS.gear);
  const eye = pick(random, HERD_TRAITS.eye);
  const mouth = pick(random, HERD_TRAITS.mouth);
  const gearColor = GEAR_COLORS[Math.floor(random() * GEAR_COLORS.length)] ?? GEAR_COLORS[0];
  const chosen: ReadonlyArray<readonly [TraitKey, TraitOption<unknown>]> = [
    ["layer", layer],
    ["fur", fur],
    ["horn", horn],
    ["gear", gear],
    ["eye", eye],
    ["mouth", mouth],
  ];
  const traits = chosen.map(([key, option]) => ({ key, name: option[0], share: option[1] / total(HERD_TRAITS[key] as ReadonlyArray<TraitOption<unknown>>) }));
  const odds = traits.reduce((product, trait) => product * trait.share, 1);
  return {
    id,
    traits,
    layer: layer[2],
    odds,
    rarity: rarityOf(odds),
    grid: elySprite({ fur: fur[2], horn: horn[2], gear: gear[2], eye: eye[2], mouth: mouth[2], gearColor }),
    field: topoField(32, 34, id * 31 + 5),
  };
}

/** The next number for "draw another Ely" (a fixed walk through the herd). */
export function nextHerdId(id: number): number {
  return (id * 37 + 101) % HERD_SIZE || 1;
}
