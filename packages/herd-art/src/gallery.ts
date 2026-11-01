/**
 * The owner preview: one self-contained HTML page (images and fonts inlined)
 * with a seeded grid of goats, every trait's sample with its share, the
 * legendaries and the placeholder.
 *
 *   node --import tsx packages/herd-art/src/gallery.ts [--out /home/user/elyia-design/herd/gallery.html] [--count 120]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  HERD_LEGENDS,
  HERD_SIZE,
  HERD_TRAIT_TABLE,
  RARITY_FILL,
  RARITY_LABEL,
  TRAIT_KEYS,
  herdLabel,
  herdMember,
  herdPlaceholderArt,
  herdRoster,
  herdTraits,
  type Rarity,
  type TraitKey,
} from "../../../apps/web/src/pixel/herd.ts";
import { paintHerd, type HerdLook } from "../../../apps/web/src/pixel/herdArt.ts";
import { rngOf } from "../../../apps/web/src/pixel/topo.ts";
import type { PixelGrid } from "../../../apps/web/src/pixel/ely.ts";
import { gridPng } from "./build.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const out = arg("out", "/home/user/elyia-design/herd/gallery.html");
const count = Number(arg("count", "120"));
const provenancePath = arg("provenance", "/home/user/elyia-design/herd/out/provenance.json");

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`)).toString("base64");
const img = (grid: PixelGrid, scale = 4) => `data:image/png;base64,${gridPng(grid, scale).toString("base64")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (share: number) => (share * 100 < 1 ? (share * 100).toFixed(2) : (share * 100).toFixed(1));

function badge(rarity: Rarity): string {
  const fill = RARITY_FILL[rarity];
  return `<span class="badge${fill ? "" : " open"}"${fill ? ` style="background:${fill}"` : ""}>${RARITY_LABEL[rarity]}</span>`;
}

// a seeded, rank-blind pick of goats
const random = rngOf(0x6a11e7);
const picked = new Set<number>();
while (picked.size < count) picked.add(1 + Math.floor(random() * HERD_SIZE));
const ids = [...picked].sort((a, b) => a - b);

const grid = ids
  .map((id) => {
    const m = herdMember(id);
    return `<figure class="card"><img src="${img(m.grid, 4)}" width="192" height="192" alt="${esc(`${m.name}: ${m.traits.map((t) => t.name).join(", ")}`)}" title="${esc(m.traits.map((t) => `${t.label}: ${t.name}`).join("\n"))}"><figcaption><span>${herdLabel(id)}</span><span class="rank">rank ${m.rank}</span>${badge(m.rarity)}</figcaption></figure>`;
  })
  .join("\n");

const legendIds = herdRoster()
  .filter((entry) => entry.legend !== null)
  .sort((a, b) => a.legend! - b.legend!)
  .map((entry) => entry.id);
const legends = legendIds
  .map((id) => {
    const m = herdMember(id);
    return `<figure class="card legend"><img src="${img(m.grid, 5)}" width="240" height="240" alt="${esc(`${m.name}, ${m.legend!.name}`)}"><figcaption><b>${esc(m.legend!.name)}</b><span>${herdLabel(id)} · 1/1</span><i>${esc(m.legend!.story)}</i></figcaption></figure>`;
  })
  .join("\n");

// every option, drawn alone on one plain goat
const BASE: Record<TraitKey, unknown> = {
  background: HERD_TRAIT_TABLE.background[1]!.value,
  fur: HERD_TRAIT_TABLE.fur[0]!.value,
  horns: HERD_TRAIT_TABLE.horns[0]!.value,
  eyes: "open",
  mouth: "smile",
  beard: "classic",
  headwear: { kind: "none" },
  neck: { kind: "none" },
  accessory: { kind: "none" },
};
const lookOf = (v: Record<TraitKey, unknown>) => ({ backdrop: v.background, fur: v.fur, horn: v.horns, eye: v.eyes, mouth: v.mouth, beard: v.beard, headwear: v.headwear, neck: v.neck, accessory: v.accessory }) as HerdLook;
const traits = herdTraits()
  .map((category) => {
    const tiles = category.options
      .map((option, index) => {
        const value = (HERD_TRAIT_TABLE[category.key] as ReadonlyArray<{ value: unknown }>)[index]!.value;
        const art = paintHerd(lookOf({ ...BASE, [category.key]: value }), 777 * 31 + 5);
        return `<figure class="trait"><img src="${img(art, 2)}" width="96" height="96" alt="${esc(`${category.label}: ${option.name}`)}"><figcaption><b>${esc(option.name)}</b><span>${pct(option.share)}% · ${option.count}</span>${badge(option.tier)}</figcaption></figure>`;
      })
      .join("");
    return `<div class="cat"><h3>${category.label}</h3><div class="traits">${tiles}</div></div>`;
  })
  .join("\n");

const tierCounts = new Map<Rarity, number>();
for (let id = 1; id <= HERD_SIZE; id += 1) tierCounts.set(herdMember(id).rarity, (tierCounts.get(herdMember(id).rarity) ?? 0) + 1);
const tiers = (["legendary", "epic", "rare", "uncommon", "common"] as const).map((t) => `<li>${badge(t)}<span>${tierCounts.get(t) ?? 0}</span></li>`).join("");
const provenance = existsSync(provenancePath) ? (JSON.parse(readFileSync(provenancePath, "utf8")) as { provenance: string; complete: boolean }) : null;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Herd · owner preview</title>
<style>
@font-face{font-family:"Pixelify Sans";font-weight:400;src:url(data:font/woff2;base64,${font("pixelify-sans", "pixelify-sans-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"Pixelify Sans";font-weight:700;src:url(data:font/woff2;base64,${font("pixelify-sans", "pixelify-sans-latin-700-normal.woff2")}) format("woff2")}
@font-face{font-family:"Silkscreen";src:url(data:font/woff2;base64,${font("silkscreen", "silkscreen-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"IBM Plex Mono";src:url(data:font/woff2;base64,${font("ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2")}) format("woff2")}
:root{--paper:#F2ECDD;--card:#FFF9EC;--ink:#16201B;--ink2:#4A564F;--rule:#D8CFBA;--glacier:#17788C;--sun:#F2C200}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 "IBM Plex Mono",monospace}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
header,section{padding:56px 0;text-align:center}
section+section{box-shadow:inset 0 2px 0 0 var(--rule)}
.tag{display:inline-block;font:12px "Silkscreen";text-transform:uppercase;padding:4px 10px;background:var(--card);box-shadow:0 -2px 0 0 var(--ink),0 2px 0 0 var(--ink),-2px 0 0 0 var(--ink),2px 0 0 0 var(--ink)}
h1,h2,h3{font-family:"Pixelify Sans";font-weight:700;margin:16px 0 8px}
h1{font-size:56px;line-height:1}h2{font-size:36px}h3{font:13px "Silkscreen";text-transform:uppercase;margin:32px 0 12px;color:var(--ink2)}
.lede{max-width:640px;margin:0 auto;color:var(--ink2)}
img{image-rendering:pixelated;display:block}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:20px;margin-top:32px}
.card{margin:0;background:var(--card);box-shadow:0 -4px 0 0 var(--rule),0 4px 0 0 var(--rule),-4px 0 0 0 var(--rule),4px 0 0 0 var(--rule)}
.card img{width:100%;height:auto}
.card figcaption{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;font:11px "Silkscreen";text-transform:uppercase}
.card .rank{color:var(--ink2)}
.badge{font:10px "Silkscreen";text-transform:uppercase;padding:2px 6px;color:var(--ink)}
.badge.open{box-shadow:inset 0 0 0 2px var(--rule);color:var(--ink2)}
.legends{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:24px;margin-top:32px}
.legend figcaption{flex-direction:column;align-items:center;text-align:center;text-transform:none}
.legend b{font:700 18px "Pixelify Sans"}.legend span{font:10px "Silkscreen";color:var(--ink2);text-transform:uppercase}.legend i{font:12px "IBM Plex Mono";font-style:normal;color:var(--ink2)}
.traits{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}
.trait{margin:0;width:100px;background:var(--card);padding:12px 0 10px;box-shadow:0 -2px 0 0 var(--rule),0 2px 0 0 var(--rule),-2px 0 0 0 var(--rule),2px 0 0 0 var(--rule)}
.trait img{margin:0 auto}
.trait figcaption{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:8px}
.trait b{font:700 14px "Pixelify Sans"}.trait span{font-size:11px;color:var(--ink2)}
.stats{display:flex;justify-content:center;gap:24px;list-style:none;padding:0;margin:24px 0 0}
.stats li{display:flex;align-items:center;gap:8px;font:12px "Silkscreen"}
.solo{display:flex;justify-content:center;gap:48px;margin-top:32px;flex-wrap:wrap}
.solo figure{margin:0;width:288px}
.solo figcaption{text-align:center;justify-content:center}
code{font-size:12px;word-break:break-all}
@media (max-width:900px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.legends{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:40px}}
</style></head>
<body><div class="wrap">
<header><span class="tag">Elyia · NFT collection · owner preview</span>
<h1>The Herd</h1>
<p class="lede">${HERD_SIZE} pixel ibexes, nine layered traits, ${HERD_LEGENDS.length} hand-made 1/1s. Drawn by the same engine as the app's Ely: the same number always draws the same goat.</p>
<ul class="stats">${tiers}</ul>
<p class="lede" style="margin-top:20px">Provenance: <code>${provenance ? `${provenance.provenance}${provenance.complete ? "" : " (partial)"}` : "run generate.ts first"}</code></p>
</header>
<section><span class="tag">${count} goats, seeded pick</span><h2>The herd</h2><p class="lede">Hover a goat for its traits. Rank 1 is the rarest.</p><div class="grid">${grid}</div></section>
<section><span class="tag">1/1 · ${HERD_LEGENDS.length} legendaries</span><h2>The legendaries</h2><p class="lede">Each one hand made, at a number drawn by the seeded roll.</p><div class="legends">${legends}</div></section>
<section><span class="tag">${TRAIT_KEYS.length} categories</span><h2>Every trait</h2><p class="lede">Each option drawn alone on the same plain goat, with its share of the herd, its count and its tier.</p>${traits}</section>
<section><span class="tag">pre-reveal</span><h2>The placeholder</h2><p class="lede">What every token shows until the reveal: an Ely in the valley fog.</p><div class="solo"><figure class="card"><img src="${img(herdPlaceholderArt(), 6)}" width="288" height="288" alt="An unrevealed Ely in the fog"><figcaption>Unrevealed</figcaption></figure></div></section>
</div></body></html>
`;

writeFileSync(out, html);
console.log(`gallery ${out} (${(html.length / 1024).toFixed(0)} KB, ${ids.length} goats)`);
