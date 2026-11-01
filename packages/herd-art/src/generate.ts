/**
 * Generates The Herd: 3333 PNGs, ERC-721 metadata, collection.json,
 * rarity.json, the placeholder and the provenance hash.
 *
 *   node --import tsx packages/herd-art/src/generate.ts [--out DIR] [--scale 20] [--limit N]
 *        [--image-base ipfs://CID/] [--sample packages/herd-art/sample]
 *
 * Default output: /home/user/elyia-design/herd/out (outside git). Deterministic:
 * the same engine and seed always write the same bytes and the same hash.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HERD_SIZE, herdMember, herdMetadata, herdPlaceholderMetadata } from "../../../apps/web/src/pixel/herd.ts";
import { BUILD_INFO, DEFAULT_COLLECTION, DEFAULT_SCALE, collectionJson, gridPng, herdPng, mosaic, placeholderPng, provenanceHash, rarityJson, sha256 } from "./build.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const out = arg("out", "/home/user/elyia-design/herd/out");
const scale = Number(arg("scale", String(DEFAULT_SCALE)));
const limit = Math.min(HERD_SIZE, Number(arg("limit", String(HERD_SIZE))));
const imageBase = arg("image-base", DEFAULT_COLLECTION.imageBase);
const sample = arg("sample", "");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

mkdirSync(join(out, "images"), { recursive: true });
mkdirSync(join(out, "metadata"), { recursive: true });

const started = Date.now();
const hashes: string[] = [];
for (let id = 1; id <= limit; id += 1) {
  const png = herdPng(id, scale);
  hashes.push(sha256(png));
  writeFileSync(join(out, "images", `${id}.png`), png);
  const meta = json(herdMetadata(id, imageBase));
  writeFileSync(join(out, "metadata", String(id)), meta);
  writeFileSync(join(out, "metadata", `${id}.json`), meta);
  if (id % 500 === 0) console.log(`  ${id} / ${limit}  (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

const provenance = provenanceHash(hashes);
writeFileSync(join(out, "placeholder.png"), placeholderPng(scale));
writeFileSync(join(out, "placeholder.json"), json(herdPlaceholderMetadata()));
writeFileSync(join(out, "collection.png"), gridPng(mosaic([777, 42, 1024, 333, 7, 2048, 512, 88, 3000], 3), Math.max(1, Math.round(scale / 3))));
writeFileSync(join(out, "collection.json"), json(collectionJson()));
writeFileSync(join(out, "rarity.json"), json(rarityJson()));
writeFileSync(
  join(out, "provenance.json"),
  json({
    provenance,
    method: "sha256 of the concatenated lower-case hex sha256 of every image file, ids 1..N in order",
    count: hashes.length,
    complete: hashes.length === HERD_SIZE,
    scale,
    ...BUILD_INFO,
    images: hashes.map((hash, i) => ({ id: i + 1, sha256: hash })),
  }),
);

if (sample) {
  mkdirSync(join(sample, "images"), { recursive: true });
  mkdirSync(join(sample, "metadata"), { recursive: true });
  const ids = [1, 2, 3, 777];
  const legend = Array.from({ length: HERD_SIZE }, (_, i) => i + 1).find((id) => herdMember(id).legend);
  for (const id of legend ? [...ids, legend] : ids) {
    writeFileSync(join(sample, "images", `${id}.png`), herdPng(id, 10));
    writeFileSync(join(sample, "metadata", `${id}.json`), json(herdMetadata(id, imageBase)));
  }
  writeFileSync(join(sample, "placeholder.png"), placeholderPng(10));
  writeFileSync(join(sample, "collection.json"), json(collectionJson()));
  if (hashes.length === HERD_SIZE) writeFileSync(join(sample, "PROVENANCE.txt"), `${provenance}\n`);
}

console.log(`The Herd: ${hashes.length} goats at ${48 * scale} px in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`provenance ${provenance}${hashes.length === HERD_SIZE ? "" : " (partial: --limit)"}`);
console.log(`out ${out}`);
