import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOLS } from "@elyia/core/protocols";

import { bestStatus, ecosystemChips } from "../../../pages/landing/ecosystem";
import { hashString, layoutConstellation, seededRandom, starRadius, type StarNode } from "../layout";

const GROUPS = [
  { id: "hypercore", label: "HyperCore" },
  { id: "hyperevm", label: "HyperEVM" },
  { id: "elysium", label: "Elysium" },
];

const NODES: StarNode[] = [
  { id: "hype", label: "HYPE", group: "hypercore", value: 12_000 },
  { id: "eth", label: "ETH", group: "hypercore", value: 9_000 },
  { id: "usdc", label: "USDC", group: "hyperevm", value: 7_000 },
  { id: "khype", label: "kHYPE", group: "elysium", value: 5_000 },
  { id: "dust", label: "DUST", group: "elysium", value: 1 },
  { id: "lost", label: "LOST", group: "nowhere", value: 10 },
];

describe("constellation layout", () => {
  it("is deterministic", () => {
    assert.deepEqual(layoutConstellation(NODES, GROUPS, 900, 320), layoutConstellation(NODES, GROUPS, 900, 320));
    assert.equal(hashString("a"), hashString("a"));
    assert.notEqual(hashString("a"), hashString("b"));
    const random = seededRandom(7);
    const first = random();
    assert.ok(first >= 0 && first < 1);
    assert.equal(seededRandom(7)(), first);
  });

  it("keeps every star inside its sky and drops unknown groups", () => {
    const layout = layoutConstellation(NODES, GROUPS, 900, 320);
    assert.equal(layout.stars.length, 5);
    const skies = new Map(layout.skies.map((sky) => [sky.group.id, sky]));
    for (const star of layout.stars) {
      const sky = skies.get(star.node.group)!;
      const nx = (star.x - sky.cx) / sky.rx;
      const ny = (star.y - sky.cy) / sky.ry;
      assert.ok(Math.hypot(nx, ny) <= 1.001, `${star.node.id} inside its sky`);
    }
  });

  it("sizes by the square root of value", () => {
    assert.equal(starRadius(100, 100, 3, 13), 13);
    assert.equal(starRadius(25, 100, 3, 13), 8);
    assert.equal(starRadius(0, 100, 3, 13), 3);
    assert.equal(starRadius(Number.NaN, 100, 3, 13), 3);
  });

  it("returns nothing for an empty canvas", () => {
    assert.deepEqual(layoutConstellation(NODES, GROUPS, 0, 320), { stars: [], skies: [] });
  });
});

describe("landing ecosystem chips", () => {
  it("lists user-facing protocols with their most real status first", () => {
    const chips = ecosystemChips(PROTOCOLS);
    assert.ok(chips.length > 5);
    assert.ok(chips.every((chip) => !["Conduit", "Alchemy", "Multicall3", "Permit2"].includes(chip.name)));
    const order = ["live", "testnet-live", "coming", "announced", "unverified", "listed"];
    const ranks = chips.map((chip) => order.indexOf(chip.status));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    const canonical = PROTOCOLS.find((protocol) => protocol.id === "elysium-canonical-bridge");
    assert.ok(canonical);
    assert.equal(bestStatus(canonical), "testnet-live");
  });
});
