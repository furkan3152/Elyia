/**
 * Token metadata and images. Sources, in order:
 * 1. the art generator's output folder (HERD_ART_DIR, else the first of
 *    packages/herd-art/{out,output,dist/out} that exists): metadata/<n>.json
 *    and images/<n>.png;
 * 2. the shared generator, when it is importable server-side (drawn into a
 *    Raster, encoded as PNG here);
 * 3. the placeholder.
 * Before reveal every token is the placeholder. After reveal only minted
 * tokens resolve (no sniping of unminted art), at the contract's
 * metadataIndexOf(id) = (id - 1 + revealOffset) % MAX_SUPPLY (provenance order, 0-based).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NetworkKey } from "@elyia/core";
import type { HerdConfigResponse, HerdTokenMetadata } from "@elyia/core/api/herd";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { abiFunction, herdAbi } from "./abi.js";
import { collectionView, readHerd } from "./chain.js";
import { drawText, Raster, textWidth } from "./raster.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/api/{src,dist}/modules/herd -> repo root. */
const REPO = resolve(HERE, "..", "..", "..", "..", "..");

export const DESCRIPTION = "The Herd: Ely, the Elyia mascot, as a 3,333-goat pixel collection on Elysium. A holder's goat becomes their Ely across Elyia, with platform perks. No promise of financial return.";

let artDirCache: { dir: string | null } | null = null;

export function artDir(ctx: AppContext): string | null {
  if (ctx.config.herd.artDir) return existsSync(ctx.config.herd.artDir) ? ctx.config.herd.artDir : null;
  if (artDirCache) return artDirCache.dir;
  const candidates = ["out", "output", join("dist", "out"), "build"].map((sub) => join(REPO, "packages", "herd-art", sub));
  const dir = candidates.find((candidate) => existsSync(join(candidate, "metadata")) || existsSync(join(candidate, "images"))) ?? null;
  artDirCache = { dir };
  return dir;
}

export function forgetArtDir(): void {
  artDirCache = null;
}

/* ------------------------------------------------------- the generator */

export interface ArtGenerator {
  readonly attributes?: (id: number) => readonly { readonly trait_type: string; readonly value: string | number }[];
  readonly png?: (id: number) => Uint8Array | Buffer | Promise<Uint8Array | Buffer>;
  readonly draw?: (canvas: unknown, id: number, scale: number) => void;
  readonly size: number;
}

let generator: Promise<ArtGenerator | null> | null = null;

/**
 * The shared generator (apps/web/src/pixel/herd.ts, pure TypeScript): importable when the API runs from
 * source under tsx (development, tests); a compiled API relies on the art output folder instead.
 */
async function loadGenerator(): Promise<ArtGenerator | null> {
  if (HERE.split(/[\\/]/u).includes("dist")) return null;
  for (const specifier of [pathToFileURL(join(REPO, "apps", "web", "src", "pixel", "herd.ts")).href]) {
    try {
      const module = (await import(specifier)) as Record<string, unknown>;
      const draw = typeof module.drawHerd === "function" ? (module.drawHerd as ArtGenerator["draw"]) : undefined;
      const png = typeof module.renderHerdPng === "function" ? (module.renderHerdPng as ArtGenerator["png"]) : typeof module.herdPng === "function" ? (module.herdPng as ArtGenerator["png"]) : undefined;
      const metadataOf = typeof module.herdMetadata === "function" ? (module.herdMetadata as (id: number) => { attributes?: HerdTokenMetadata["attributes"] }) : null;
      const member = typeof module.herdMember === "function" ? (module.herdMember as (id: number) => { traits?: readonly { key?: string; label?: string; name?: string; value?: string }[] }) : null;
      const attributes = metadataOf
        ? (id: number) => metadataOf(id).attributes ?? []
        : member
          ? (id: number) => (member(id).traits ?? []).map((trait) => ({ trait_type: String(trait.label ?? trait.key ?? "Trait"), value: String(trait.name ?? trait.value ?? "") }))
          : undefined;
      if (draw || png || attributes) return { ...(draw ? { draw } : {}), ...(png ? { png } : {}), ...(attributes ? { attributes } : {}), size: typeof module.HERD_ART === "number" ? module.HERD_ART : 48 };
    } catch {
      // not importable here
    }
  }
  return null;
}

export function herdGenerator(): Promise<ArtGenerator | null> {
  generator ??= loadGenerator();
  return generator;
}

/** Tests: install a generator (or null for "none"). */
export function setHerdGenerator(value: ArtGenerator | null): void {
  generator = Promise.resolve(value);
}

/* ------------------------------------------------------------- reveal */

/**
 * The art number (1..3333, the generator's goat id and file name) a revealed token shows: provenance
 * index + 1, where the contract's metadataIndexOf(id) = (id - 1 + revealOffset) % MAX_SUPPLY.
 */
async function revealedArt(ctx: AppContext, network: NetworkKey, address: string, id: number, maxSupply: number): Promise<number> {
  const { abi } = await herdAbi();
  if (abiFunction(abi, "metadataIndexOf", 1)) return Number(await readHerd(ctx, network, address, "metadataIndexOf", [BigInt(id)])) + 1;
  const offset = abiFunction(abi, "revealOffset", 0) ? Number(await readHerd(ctx, network, address, "revealOffset")) : 0;
  return artIndexOf(id, offset, maxSupply) + 1;
}

/** Token id (1-based) -> provenance-order art index (0-based), as ElyHerd.metadataIndexOf. */
export function artIndexOf(id: number, offset: number, maxSupply: number): number {
  return (id - 1 + offset) % maxSupply;
}

export interface Resolved {
  readonly view: HerdConfigResponse;
  readonly revealed: boolean;
  /** The art number (1-based goat id of the generator), null before reveal. */
  readonly artIndex: number | null;
}

/** Which art a token shows now. Throws 404 for ids out of range, or unminted after reveal. */
export async function resolveToken(ctx: AppContext, network: NetworkKey, id: number): Promise<Resolved> {
  const view = await collectionView(ctx, network);
  if (!Number.isInteger(id) || id < 0 || id > view.maxSupply) throw new ElyiaHttpError("NOT_FOUND", 404, `Token ids run up to ${view.maxSupply}.`);
  const revealed = view.reveal.revealed === true;
  if (!revealed || !view.address) return { view, revealed: false, artIndex: null };
  if (id === 0 || (view.totalSupply !== null && id > view.totalSupply)) throw new ElyiaHttpError("NOT_MINTED", 404, `Token ${id} is not minted yet.`);
  return { view, revealed: true, artIndex: await revealedArt(ctx, network, view.address, id, view.maxSupply) };
}

export async function tokenMetadata(ctx: AppContext, network: NetworkKey, id: number, baseUrl: string): Promise<HerdTokenMetadata> {
  const resolved = await resolveToken(ctx, network, id);
  const name = `The Herd #${String(id).padStart(4, "0")}`;
  if (!resolved.revealed || resolved.artIndex === null) {
    return { name, description: `${DESCRIPTION} Not revealed yet.`, image: `${baseUrl}/v1/herd/images/placeholder.png`, attributes: [{ trait_type: "Status", value: "Unrevealed" }], revealed: false };
  }
  const art = resolved.artIndex;
  const dir = artDir(ctx);
  let attributes: HerdTokenMetadata["attributes"];
  if (dir && existsSync(join(dir, "metadata", `${art}.json`))) {
    try {
      const file = JSON.parse(await readFile(join(dir, "metadata", `${art}.json`), "utf8")) as { attributes?: HerdTokenMetadata["attributes"] };
      attributes = Array.isArray(file.attributes) ? file.attributes : [];
    } catch {
      attributes = [];
    }
  } else {
    const gen = await herdGenerator();
    attributes = gen?.attributes?.(art) ?? [];
  }
  return { name, description: DESCRIPTION, image: `${baseUrl}/v1/herd/images/${id}.png`, external_url: `${baseUrl.replace(/\/$/u, "")}/v1/herd/tokens/${id}`, attributes, revealed: true };
}

/* ------------------------------------------------------------- images */

const PLACEHOLDER_BANDS = ["#CFE3D6", "#B7D3C1", "#9CC2A8", "#83AF90", "#6C9B7A"];

/** The pre-reveal image: a contour backdrop, a goat silhouette and a question mark. */
export function placeholderRaster(size = 48): Raster {
  const raster = new Raster(size, size);
  for (let y = 0; y < size; y += 1) {
    raster.fillStyle = PLACEHOLDER_BANDS[Math.min(PLACEHOLDER_BANDS.length - 1, Math.floor(((size - y) / size) * PLACEHOLDER_BANDS.length))]!;
    raster.fillRect(0, y, size, 1);
  }
  // A silhouette bust: head, horns, neck.
  raster.fillStyle = "#16201B";
  const c = Math.floor(size / 2);
  raster.fillRect(c - 8, 16, 16, 14);
  raster.fillRect(c - 6, 30, 12, 6);
  raster.fillRect(c - 12, 36, 24, size - 36);
  raster.fillRect(c - 10, 8, 3, 8);
  raster.fillRect(c + 7, 8, 3, 8);
  raster.fillRect(c - 12, 6, 3, 3);
  raster.fillRect(c + 9, 6, 3, 3);
  drawText(raster, "?", c - 2, 19, "#F2C200");
  return raster;
}

export function placeholderPng(scale = 8): Buffer {
  return placeholderRaster().scaled(scale).png();
}

/** The art of index `art` as PNG (folder, else generator, else null). */
export async function artPng(ctx: AppContext, art: number, scale = 8): Promise<Buffer | null> {
  const dir = artDir(ctx);
  const file = dir ? join(dir, "images", `${art}.png`) : null;
  if (file && existsSync(file)) return readFile(file);
  const gen = await herdGenerator();
  if (gen?.png) return Buffer.from(await gen.png(art));
  if (gen?.draw) {
    const raster = new Raster(gen.size * scale, gen.size * scale);
    gen.draw(raster.canvas, art, scale);
    return raster.png();
  }
  return null;
}

/** A goat raster for the WL card (generator only; null without it). */
export async function goatRaster(art: number): Promise<Raster | null> {
  const gen = await herdGenerator();
  if (!gen?.draw) return null;
  const raster = new Raster(gen.size, gen.size);
  try {
    gen.draw(raster.canvas, art, 1);
    return raster;
  } catch {
    return null;
  }
}

export { textWidth };
