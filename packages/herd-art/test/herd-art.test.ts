import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HERD_CONFLICTS,
  HERD_LEGENDS,
  HERD_SIZE,
  HERD_TRAIT_TABLE,
  TRAIT_KEYS,
  comboKey,
  herdArtSeed,
  herdLook,
  herdMember,
  herdMetadata,
  herdRoster,
  herdTraits,
  rarityOfRank,
  traitName,
  type TraitKey,
} from "../../../apps/web/src/pixel/herd.ts";
import { blankArt, paintHerd } from "../../../apps/web/src/pixel/herdArt.ts";
import { collectionJson, herdPng, placeholderPng, provenanceHash, rarityJson, sha256 } from "../src/build.ts";
import { crc32, decodePng, encodeGridPng, encodePng, rasterize } from "../src/png.ts";

const names = (key: TraitKey) => HERD_TRAIT_TABLE[key].map((option) => option.name);

describe("trait tables", () => {
  it("weights every category to 1000, with unique option names", () => {
    for (const key of TRAIT_KEYS) {
      const options = HERD_TRAIT_TABLE[key];
      assert.equal(
        options.reduce((sum, option) => sum + option.weight, 0),
        1000,
        key,
      );
      assert.equal(new Set(names(key)).size, options.length, key);
    }
  });

  it("names only real options in the conflict rules", () => {
    for (const [k1, n1, k2, n2, why] of HERD_CONFLICTS) {
      assert.ok(names(k1).includes(n1), `${k1}:${n1}`);
      assert.ok(names(k2).includes(n2), `${k2}:${n2}`);
      assert.notEqual(k1, k2);
      assert.ok(why.length > 0);
    }
  });

  it("has 10 to 20 hand-made legendaries with unique names", () => {
    assert.ok(HERD_LEGENDS.length >= 10 && HERD_LEGENDS.length <= 20);
    assert.equal(new Set(HERD_LEGENDS.map((legend) => legend.name)).size, HERD_LEGENDS.length);
  });
});

describe("the roll", () => {
  const roster = herdRoster();

  it("numbers 1..3333 with every trait combination unique", () => {
    assert.equal(roster.length, HERD_SIZE);
    roster.forEach((entry, i) => assert.equal(entry.id, i + 1));
    const combos = roster.filter((entry) => entry.picks).map((entry) => comboKey(entry.picks!));
    assert.equal(new Set(combos).size, combos.length);
    assert.equal(roster.filter((entry) => entry.legend !== null).length, HERD_LEGENDS.length);
    assert.deepEqual(new Set(roster.filter((e) => e.legend !== null).map((e) => e.legend)).size, HERD_LEGENDS.length);
  });

  it("never breaks a conflict rule", () => {
    for (const entry of roster) {
      if (!entry.picks) continue;
      for (const [k1, n1, k2, n2] of HERD_CONFLICTS) assert.ok(!(traitName(k1, entry.picks[k1]) === n1 && traitName(k2, entry.picks[k2]) === n2), `#${entry.id} ${n1} + ${n2}`);
      assert.ok(!(traitName("headwear", entry.picks.headwear).startsWith("Helmet") && traitName("headwear", entry.picks.headwear) === "Crown"));
    }
  });

  it("is deterministic: traits and pixels", () => {
    for (const id of [1, 777, 2048, HERD_SIZE]) {
      const a = herdMember(id);
      assert.deepEqual(a.traits, herdMember(id).traits);
      assert.equal(sha256(JSON.stringify(a.grid)), sha256(JSON.stringify(paintHerd(herdLook(id), herdArtSeed(id)))));
    }
  });
});

describe("rarity", () => {
  it("counts add up to the supply in every category", () => {
    for (const category of herdTraits()) {
      const total = category.options.reduce((sum, option) => sum + option.count, 0);
      assert.equal(total, HERD_SIZE - HERD_LEGENDS.length, category.key);
      const shares = category.options.reduce((sum, option) => sum + option.share, 0);
      assert.ok(Math.abs(shares - (HERD_SIZE - HERD_LEGENDS.length) / HERD_SIZE) < 1e-9);
    }
  });

  it("ranks 1..3333 once each, tiers in rank order", () => {
    const rarity = rarityJson();
    assert.equal(rarity.ranks.length, HERD_SIZE);
    rarity.ranks.forEach((row, i) => {
      assert.equal(row.rank, i + 1);
      assert.equal(row.tier, rarityOfRank(row.rank));
      if (i > HERD_LEGENDS.length) assert.ok(row.score <= rarity.ranks[i - 1]!.score + 1e-9);
    });
    assert.ok(rarity.ranks.slice(0, HERD_LEGENDS.length).every((row) => herdMember(row.id).legend));
    const tiers = new Map<string, number>();
    for (const row of rarity.ranks) tiers.set(row.tier, (tiers.get(row.tier) ?? 0) + 1);
    assert.deepEqual(Object.fromEntries(tiers), { legendary: 15, epic: 100, rare: 333, uncommon: 900, common: 1985 });
  });
});

describe("metadata", () => {
  it("follows the ERC-721 metadata standard", () => {
    const meta = herdMetadata(777, "ipfs://CID/");
    assert.equal(meta.name, "Ely #777");
    assert.equal(meta.image, "ipfs://CID/777.png");
    assert.equal(meta.attributes.length, TRAIT_KEYS.length);
    for (const attribute of meta.attributes) assert.ok(attribute.trait_type && attribute.value);
    const legendId = herdRoster().find((entry) => entry.legend !== null)!.id;
    assert.deepEqual(herdMetadata(legendId).attributes.map((a) => a.trait_type), ["Legendary"]);
    assert.equal(collectionJson().seller_fee_basis_points, 500);
  });
});

describe("png codec", () => {
  it("round-trips: signature, IHDR dimensions, pixels", () => {
    const grid = [
      ["#FF0000", "#00FF00", null],
      ["#0000FF", "#FFFFFF", "#16201B"],
    ];
    const image = rasterize(grid, 3, { channels: 4 });
    const png = encodePng(image);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), 9);
    assert.equal(png.readUInt32BE(20), 6);
    const back = decodePng(png);
    assert.equal(back.width, 9);
    assert.equal(back.height, 6);
    assert.deepEqual(back.data, image.data);
    assert.equal(back.data[(0 * 9 + 8) * 4 + 3], 0, "null cells are transparent in RGBA");
    assert.equal(crc32(Buffer.from("IEND")), 0xae426082);
  });

  it("writes a 960 x 960 goat, identical to the full raster path", () => {
    const png = herdPng(777);
    const back = decodePng(png);
    assert.equal(back.width, 960);
    assert.equal(back.height, 960);
    assert.equal(back.channels, 3);
    const grid = herdMember(777).grid;
    assert.ok(png.equals(encodePng(rasterize(grid, 20))));
    assert.ok(encodeGridPng(blankArt(4).map((row) => row.map(() => "#123456")), 2).equals(encodePng(rasterize(blankArt(4).map((row) => row.map(() => "#123456")), 2))));
    const placeholder = decodePng(placeholderPng());
    assert.equal(placeholder.width, 960);
  });
});

describe("provenance", () => {
  it("is stable: same images, same hash; any change, a new hash", () => {
    const hashes = [1, 2, 3, 4, 5, 6].map((id) => sha256(herdPng(id, 2)));
    assert.deepEqual(hashes, [1, 2, 3, 4, 5, 6].map((id) => sha256(herdPng(id, 2))));
    const hash = provenanceHash(hashes);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, sha256(hashes.join("")));
    assert.notEqual(hash, provenanceHash([...hashes].reverse()));
  });

  it("pins the art: the pixels of a few goats never drift", () => {
    const pin = [1, 777, HERD_SIZE].map((id) => sha256(JSON.stringify(herdMember(id).grid)).slice(0, 16)).join(" ");
    assert.equal(pin, PINNED_ART);
  });
});

/** Update only on a deliberate art change (it changes the provenance hash too). */
const PINNED_ART = "838fa9b139f65832 64a0ecbf7d372a7d 1e108fa28e85b38d";
