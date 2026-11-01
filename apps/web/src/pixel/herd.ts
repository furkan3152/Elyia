/**
 * The Herd (pure): the 3333-goat collection. One seeded roll of the whole
 * herd (no two goats share a trait combination, fifteen hand-made 1/1s at
 * seeded numbers), rarity scores and ranks, the art, the ERC-721 metadata and
 * the pre-reveal placeholder. The browser and the PNG generator
 * (`packages/herd-art`) both draw from here: the same number always gives
 * the same goat, pixel for pixel.
 */
import type { PixelGrid } from "./ely";
import { drawGrid, type PixelSurface } from "./draw";
import { HERD_ART, blankArt, paintFigure, paintHerd, paintTopo, herdField, type HerdLook } from "./herdArt";
import { HERD_LEGENDS, type HerdLegend } from "./herdLegends";
import { HERD_TRAIT_TABLE, TRAIT_KEYS, TRAIT_LABELS, conflicts, type TraitKey, type TraitOption } from "./herdTraits";
import { rngOf } from "./topo";

export { TRAIT_KEYS, TRAIT_LABELS, HERD_TRAIT_TABLE, HERD_CONFLICTS, conflicts, type TraitKey, type TraitOption } from "./herdTraits";
export { HERD_LEGENDS, type HerdLegend } from "./herdLegends";
export { HERD_ART } from "./herdArt";

/** Collection size. */
export const HERD_SIZE = 3333;
/** The roll's seed. Changing it re-rolls the whole herd (and the provenance hash). */
export const HERD_SEED = 0x48455244;
export const HERD_NAME = "The Herd";

export type Rarity = "legendary" | "epic" | "rare" | "uncommon" | "common";
export const RARITIES: readonly Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
export const RARITY_LABEL: Readonly<Record<Rarity, string>> = { legendary: "Legendary", epic: "Epic", rare: "Rare", uncommon: "Uncommon", common: "Common" };
/** Badge fill per rarity (null: no fill). */
export const RARITY_FILL: Readonly<Record<Rarity, string | null>> = { legendary: "#F2C200", epic: "#6FD3E3", rare: "#E8906A", uncommon: "#A7D6D6", common: null };
/** The last rank of each tier (ranks are 1..3333; the 1/1s hold the first ranks). */
export const RARITY_RANKS: Readonly<Record<Exclude<Rarity, "legendary">, number>> = { epic: HERD_LEGENDS.length + 100, rare: HERD_LEGENDS.length + 433, uncommon: HERD_LEGENDS.length + 1333, common: HERD_SIZE };

/** The option chosen per category, by index into `HERD_TRAIT_TABLE`. */
export type TraitPicks = Readonly<Record<TraitKey, number>>;

interface RosterEntry {
  readonly id: number;
  readonly picks: TraitPicks | null;
  readonly legend: number | null;
}

function weightedPick(random: () => number, options: ReadonlyArray<{ readonly weight: number }>, allowed: readonly number[]): number {
  const total = allowed.reduce((sum, index) => sum + options[index]!.weight, 0);
  let v = random() * total;
  for (const index of allowed) {
    v -= options[index]!.weight;
    if (v < 0) return index;
  }
  return allowed[allowed.length - 1]!;
}

/** For each category and option: the [earlier category index, option index] pairs it may not join. */
const BLOCKERS: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = TRAIT_KEYS.map((key, k) =>
  (HERD_TRAIT_TABLE[key] as ReadonlyArray<TraitOption<unknown>>).map((option) =>
    TRAIT_KEYS.slice(0, k).flatMap((earlier, e) =>
      (HERD_TRAIT_TABLE[earlier] as ReadonlyArray<TraitOption<unknown>>).flatMap((other, j) => (conflicts(earlier, other.name, key, option.name) ? [[e, j] as const] : [])),
    ),
  ),
);

/** Rolls one trait set: categories in layer order, each skipping options that conflict with earlier picks. */
export function rollTraits(random: () => number): TraitPicks {
  const chosen: number[] = [];
  TRAIT_KEYS.forEach((key, k) => {
    const options = HERD_TRAIT_TABLE[key] as ReadonlyArray<TraitOption<unknown>>;
    const allowed: number[] = [];
    for (let index = 0; index < options.length; index += 1) if (!BLOCKERS[k]![index]!.some(([e, j]) => chosen[e] === j)) allowed.push(index);
    chosen.push(weightedPick(random, options, allowed));
  });
  return Object.fromEntries(TRAIT_KEYS.map((key, k) => [key, chosen[k]!])) as unknown as TraitPicks;
}

export function traitName(key: TraitKey, index: number): string {
  return (HERD_TRAIT_TABLE[key] as ReadonlyArray<TraitOption<unknown>>)[index]!.name;
}

/** The combination key that must be unique across the herd. */
export function comboKey(picks: TraitPicks): string {
  return TRAIT_KEYS.map((key) => picks[key]).join(".");
}

let roster: readonly RosterEntry[] | null = null;

/** The whole herd's roll (memoised): ids 1..HERD_SIZE, unique combinations, legendaries at seeded ids. */
export function herdRoster(): readonly RosterEntry[] {
  if (roster) return roster;
  const random = rngOf(HERD_SEED);
  const legendAt = new Map<number, number>();
  while (legendAt.size < HERD_LEGENDS.length) {
    const id = 1 + Math.floor(random() * HERD_SIZE);
    if (!legendAt.has(id)) legendAt.set(id, legendAt.size);
  }
  const seen = new Set<string>();
  const entries: RosterEntry[] = [];
  for (let id = 1; id <= HERD_SIZE; id += 1) {
    const legend = legendAt.get(id);
    if (legend !== undefined) {
      entries.push({ id, picks: null, legend });
      continue;
    }
    let picks = rollTraits(random);
    while (seen.has(comboKey(picks))) picks = rollTraits(random);
    seen.add(comboKey(picks));
    entries.push({ id, picks, legend: null });
  }
  roster = entries;
  return entries;
}

// ---------------------------------------------------------------- rarity

export interface HerdOptionStats {
  readonly name: string;
  readonly weight: number;
  /** Goats with this option (1/1s excluded: they carry only their Legendary trait). */
  readonly count: number;
  /** count / HERD_SIZE */
  readonly share: number;
  /** Rarity tier of the option itself, by its share. */
  readonly tier: Rarity;
}

export interface HerdCategoryStats {
  readonly key: TraitKey;
  readonly label: string;
  readonly options: readonly HerdOptionStats[];
}

function optionTier(share: number): Rarity {
  if (share < 0.015) return "epic";
  if (share < 0.04) return "rare";
  if (share < 0.1) return "uncommon";
  return "common";
}

let stats: { readonly categories: readonly HerdCategoryStats[]; readonly counts: ReadonlyMap<string, number> } | null = null;

function herdStats() {
  if (stats) return stats;
  const counts = new Map<string, number>();
  for (const entry of herdRoster()) {
    if (!entry.picks) continue;
    for (const key of TRAIT_KEYS) {
      const k = `${key}:${entry.picks[key]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const categories = TRAIT_KEYS.map((key) => ({
    key,
    label: TRAIT_LABELS[key],
    options: (HERD_TRAIT_TABLE[key] as ReadonlyArray<TraitOption<unknown>>).map((option, index) => {
      const count = counts.get(`${key}:${index}`) ?? 0;
      return { name: option.name, weight: option.weight, count, share: count / HERD_SIZE, tier: optionTier(count / HERD_SIZE) };
    }),
  }));
  stats = { categories, counts };
  return stats;
}

/**
 * The trait catalogue with live counts: every category, every option, how
 * many goats carry it, its share and tier. For the /herd traits table.
 */
export function herdTraits(): readonly HerdCategoryStats[] {
  return herdStats().categories;
}

/** Rarity score: the sum over categories of HERD_SIZE / (goats with that option). The 1/1s score HERD_SIZE per category. */
export function rarityScore(picks: TraitPicks | null): number {
  if (!picks) return HERD_SIZE * TRAIT_KEYS.length;
  const { counts } = herdStats();
  return TRAIT_KEYS.reduce((sum, key) => sum + HERD_SIZE / (counts.get(`${key}:${picks[key]}`) ?? 1), 0);
}

let ranks: { readonly rank: ReadonlyMap<number, number>; readonly score: ReadonlyMap<number, number> } | null = null;

function herdRanks() {
  if (ranks) return ranks;
  const scored = herdRoster().map((entry) => ({ id: entry.id, score: rarityScore(entry.picks), legend: entry.legend }));
  scored.sort((a, b) => (a.legend !== null && b.legend !== null ? a.legend - b.legend : b.score - a.score || a.id - b.id));
  ranks = { rank: new Map(scored.map((s, index) => [s.id, index + 1])), score: new Map(scored.map((s) => [s.id, s.score])) };
  return ranks;
}

export function rarityOfRank(rank: number): Rarity {
  if (rank <= HERD_LEGENDS.length) return "legendary";
  if (rank <= RARITY_RANKS.epic) return "epic";
  if (rank <= RARITY_RANKS.rare) return "rare";
  if (rank <= RARITY_RANKS.uncommon) return "uncommon";
  return "common";
}

// ---------------------------------------------------------------- members

export interface HerdTrait {
  readonly key: TraitKey | "legendary";
  readonly label: string;
  readonly name: string;
  /** Share of the herd with this trait (0..1). */
  readonly share: number;
}

export interface HerdMember {
  readonly id: number;
  /** "Ely #N" */
  readonly name: string;
  readonly traits: readonly HerdTrait[];
  /** The 1/1, when this goat is one. */
  readonly legend: HerdLegend | null;
  /** Product of the trait shares (the chance of this exact combination). */
  readonly odds: number;
  readonly score: number;
  /** 1 = rarest. */
  readonly rank: number;
  readonly rarity: Rarity;
  /** The finished 48 x 48 art (every cell coloured). */
  readonly grid: PixelGrid;
  /** A flat colour that matches the art's backdrop (frames and letterboxing). */
  readonly backdrop: string;
}

/** Clamps any integer onto 1..HERD_SIZE (callers may hash addresses into ids). */
export function herdId(id: number): number {
  const n = Math.floor(Math.abs(id));
  return ((((n - 1) % HERD_SIZE) + HERD_SIZE) % HERD_SIZE) + 1;
}

/** The look a goat is drawn from. */
export function herdLook(id: number): HerdLook {
  const entry = herdRoster()[herdId(id) - 1]!;
  if (entry.legend !== null) return HERD_LEGENDS[entry.legend]!.look;
  const p = entry.picks!;
  const t = HERD_TRAIT_TABLE;
  return {
    backdrop: t.background[p.background]!.value,
    fur: t.fur[p.fur]!.value,
    horn: t.horns[p.horns]!.value,
    eye: t.eyes[p.eyes]!.value,
    mouth: t.mouth[p.mouth]!.value,
    beard: t.beard[p.beard]!.value,
    headwear: t.headwear[p.headwear]!.value,
    neck: t.neck[p.neck]!.value,
    accessory: t.accessory[p.accessory]!.value,
  };
}

/** The art's seed (its own elevation map). */
export function herdArtSeed(id: number): number {
  return herdId(id) * 7919 + 31;
}

const members = new Map<number, HerdMember>();

/** Herd goat `id` (1..3333; other integers wrap). Deterministic and memoised. */
export function herdMember(id: number): HerdMember {
  const n = herdId(id);
  const hit = members.get(n);
  if (hit) return hit;
  const entry = herdRoster()[n - 1]!;
  const { rank, score } = herdRanks();
  const legend = entry.legend !== null ? HERD_LEGENDS[entry.legend]! : null;
  const { counts } = herdStats();
  const traits: HerdTrait[] = legend
    ? [{ key: "legendary", label: "Legendary", name: legend.name, share: 1 / HERD_SIZE }]
    : TRAIT_KEYS.map((key) => ({ key, label: TRAIT_LABELS[key], name: traitName(key, entry.picks![key]), share: (counts.get(`${key}:${entry.picks![key]}`) ?? 0) / HERD_SIZE }));
  const r = rank.get(n)!;
  let grid: PixelGrid | null = null;
  const member: HerdMember = {
    id: n,
    name: `Ely #${n}`,
    traits,
    legend,
    odds: traits.reduce((product, trait) => product * trait.share, 1),
    score: score.get(n)!,
    rank: r,
    rarity: rarityOfRank(r),
    // painted on first use, so ranks and traits stay cheap
    get grid() {
      grid ??= paintHerd(herdLook(n), herdArtSeed(n));
      return grid;
    },
    get backdrop() {
      return this.grid[0]![0]!;
    },
  };
  members.set(n, member);
  return member;
}

/** "#0777" */
export function herdLabel(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

/** The next number for "draw another Ely" (a fixed walk through the herd). */
export function nextHerdId(id: number): number {
  return ((herdId(id) * 37 + 101) % HERD_SIZE) + 1;
}

// ---------------------------------------------------------------- placeholder and drawing

let placeholder: PixelGrid | null = null;

/** The pre-reveal art: an Ely silhouette in valley fog. */
export function herdPlaceholderArt(): PixelGrid {
  if (placeholder) return placeholder;
  const art = blankArt();
  paintTopo(art, herdField(HERD_SEED), ["#C9D3D0", "#D3DBD8", "#DCE3E0", "#E5EAE8", "#EEF2F0"], 0.08);
  const figure = paintFigure({
    backdrop: { kind: "topo", palette: ["#000000"] },
    fur: ["#7C8C8A", "#6A7A78", "#8E9C9A"],
    muzzle: "#7C8C8A",
    horn: { shape: "curl", finish: "plain", palette: ["#7C8C8A", "#7C8C8A", "#8E9C9A"] },
    eye: "blink",
    mouth: "flat",
    beard: "classic",
    headwear: { kind: "none" },
    neck: { kind: "none" },
    accessory: { kind: "none" },
    fx: { ink: "#5B6B6A", recolor: () => "#5B6B6A" },
  });
  for (let y = 0; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) if (figure[y]![x]) art[y]![x] = figure[y]![x]!;
  // fog banks drifting over the lower half
  for (let y = 26; y < HERD_ART; y += 1) {
    const density = y < 32 ? 4 : y < 38 ? 3 : 2;
    for (let x = 0; x < HERD_ART; x += 1) if ((x + (y % 2) * 2 + (y >> 2)) % density === 0) art[y]![x] = y % 3 === 0 ? "#F5F7F6" : "#E5EAE8";
  }
  // a question mark over the head
  const q = ["0110", "1001", "0010", "0100", "0000", "0100"];
  q.forEach((row, dy) => {
    for (let dx = 0; dx < 4; dx += 1) if (row[dx] === "1") art[1 + dy]![22 + dx] = "#FFFFFF";
  });
  placeholder = art;
  return art;
}

/** The slice of a canvas `drawHerd` needs (any HTMLCanvasElement or OffscreenCanvas). */
export interface HerdCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): (PixelSurface & { imageSmoothingEnabled?: boolean }) | null;
}

/**
 * Draws goat `id` (or the placeholder, id 0) onto a canvas at `scale` device
 * pixels per art pixel (default 1: 48 x 48). Sizes the canvas to fit.
 */
export function drawHerd(canvas: HerdCanvas, id: number, scale = 1): void {
  const s = Math.max(1, Math.floor(scale));
  canvas.width = HERD_ART * s;
  canvas.height = HERD_ART * s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = false;
  drawGrid(ctx, id === 0 ? herdPlaceholderArt() : herdMember(id).grid, 0, 0, s);
}

// ---------------------------------------------------------------- metadata

export interface HerdAttribute {
  readonly trait_type: string;
  readonly value: string;
}

/** ERC-721 metadata JSON for one goat. `image` is `${imageBase}${id}.png`. */
export interface HerdMetadata {
  readonly name: string;
  readonly description: string;
  readonly image: string;
  readonly external_url?: string;
  readonly attributes: readonly HerdAttribute[];
}

export const HERD_DESCRIPTION = "The Herd: 3333 pixel ibexes from Elyia, each drawn in code on the elevation map of the layer it lives on. Holding one makes it your Ely across the Elyia platform.";

export function herdMetadata(id: number, imageBase = "ipfs://IMAGES_CID/", externalBase?: string): HerdMetadata {
  const member = herdMember(id);
  const description = member.legend ? `${member.legend.name}, one of fifteen 1/1 legendaries. ${member.legend.story} ${HERD_DESCRIPTION}` : HERD_DESCRIPTION;
  return {
    name: member.name,
    description,
    image: `${imageBase}${member.id}.png`,
    ...(externalBase ? { external_url: `${externalBase}${member.id}` } : {}),
    attributes: member.traits.map((trait) => ({ trait_type: trait.label, value: trait.name })),
  };
}

/** Placeholder metadata served before the reveal. */
export function herdPlaceholderMetadata(image = "ipfs://PLACEHOLDER_CID/placeholder.png"): HerdMetadata {
  return { name: "Ely (unrevealed)", description: `An Ely still in the valley fog. ${HERD_DESCRIPTION}`, image, attributes: [{ trait_type: "Status", value: "Unrevealed" }] };
}
