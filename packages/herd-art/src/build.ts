/**
 * The Herd build (Node): renders goats to PNG, hashes them and assembles the
 * collection files. Every pixel comes from the app's own engine
 * (apps/web/src/pixel/herd.ts), so the PNGs and the browser always agree.
 */
import { createHash } from "node:crypto";

import { HERD_ART, HERD_DESCRIPTION, HERD_LEGENDS, HERD_NAME, HERD_SEED, HERD_SIZE, RARITY_RANKS, herdMember, herdPlaceholderArt, herdTraits } from "../../../apps/web/src/pixel/herd.ts";
import type { PixelGrid } from "../../../apps/web/src/pixel/ely.ts";
import { encodeGridPng } from "./png.ts";

/** Default upscale: 48 px art x 20 = 960 px. */
export const DEFAULT_SCALE = 20;

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function gridPng(grid: PixelGrid, scale = DEFAULT_SCALE): Buffer {
  return encodeGridPng(grid, scale);
}

/** Goat `id` as a PNG at `scale`. */
export function herdPng(id: number, scale = DEFAULT_SCALE): Buffer {
  return gridPng(herdMember(id).grid, scale);
}

export function placeholderPng(scale = DEFAULT_SCALE): Buffer {
  return gridPng(herdPlaceholderArt(), scale);
}

/** The provenance hash: sha256 of the image sha256s (lower-case hex) concatenated in id order. */
export function provenanceHash(imageHashes: readonly string[]): string {
  return sha256(imageHashes.join(""));
}

/** A square mosaic of goats (the collection image). */
export function mosaic(ids: readonly number[], cols: number, gap = 0, paper = "#F2ECDD"): PixelGrid {
  const rows = Math.ceil(ids.length / cols);
  const size = (n: number) => n * HERD_ART + (n + 1) * gap;
  const out: string[][] = Array.from({ length: size(rows) }, () => Array<string>(size(cols)).fill(paper));
  ids.forEach((id, i) => {
    const art = herdMember(id).grid;
    const ox = gap + (i % cols) * (HERD_ART + gap);
    const oy = gap + Math.floor(i / cols) * (HERD_ART + gap);
    for (let y = 0; y < HERD_ART; y += 1) for (let x = 0; x < HERD_ART; x += 1) out[oy + y]![ox + x] = art[y]![x]!;
  });
  return out;
}

export interface CollectionOptions {
  readonly imageBase: string;
  readonly collectionImage: string;
  readonly externalLink: string;
  readonly feeRecipient: string;
  readonly royaltyBps: number;
}

export const DEFAULT_COLLECTION: CollectionOptions = {
  imageBase: "ipfs://IMAGES_CID/",
  collectionImage: "ipfs://COLLECTION_CID/collection.png",
  externalLink: "OWNER_INPUT_EXTERNAL_LINK",
  feeRecipient: "OWNER_INPUT_TREASURY_ADDRESS",
  royaltyBps: 500,
};

/** contractURI JSON (OpenSea-style collection metadata, read by marketplaces). */
export function collectionJson(options: CollectionOptions = DEFAULT_COLLECTION) {
  return {
    name: HERD_NAME,
    description: HERD_DESCRIPTION,
    image: options.collectionImage,
    external_link: options.externalLink,
    seller_fee_basis_points: options.royaltyBps,
    fee_recipient: options.feeRecipient,
    total_supply: HERD_SIZE,
  };
}

/** rarity.json: the method, the tiers, every goat's rank and score, and the trait catalogue. */
export function rarityJson() {
  const members = Array.from({ length: HERD_SIZE }, (_, i) => herdMember(i + 1));
  members.sort((a, b) => a.rank - b.rank);
  return {
    method: "score = sum over the 9 categories of 3333 / (goats sharing that option); the 15 legendaries (1/1) rank first. Tiers by rank.",
    tiers: { legendary: HERD_LEGENDS.length, ...RARITY_RANKS },
    legendaries: members.filter((m) => m.legend).map((m) => ({ id: m.id, name: m.legend!.name, story: m.legend!.story })),
    ranks: members.map((m) => ({ id: m.id, rank: m.rank, score: Math.round(m.score * 100) / 100, tier: m.rarity })),
    traits: herdTraits().map((category) => ({ trait_type: category.label, options: category.options.map((o) => ({ value: o.name, count: o.count, percent: Math.round(o.share * 10000) / 100, tier: o.tier })) })),
  };
}

export const BUILD_INFO = { seed: HERD_SEED, size: HERD_SIZE, art: HERD_ART } as const;
