import assert from "node:assert/strict";
import { test } from "node:test";

import { altitudeOf, decadeLabel, distortion, impliedHypePrice, placeMarks, swapAction, swapSentence } from "../swapModel";

test("swap: actions and sentences per layer", () => {
  assert.deepEqual(swapAction({ layer: "summit", from: "HYPE", amount: "1", venue: "kalos-v3", mode: "testnet" }), { kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1", protocol: "kalos-v3" });
  assert.equal(swapAction({ layer: "ridge", from: "USDC", amount: "5", venue: null, mode: "testnet" }).network, "hyperevm-testnet");
  assert.equal(swapSentence("summit", "USDC", "100", "dex-da-costa"), "swap 100 USDC to HYPE on Elysium via Dex Da Costa");
});

test("swap: implied prices and the distortion against the reference", () => {
  assert.equal(impliedHypePrice("HYPE", 0.25, 5004), 20016);
  assert.equal(impliedHypePrice("USDC", 100, 0.004884), 100 / 0.004884);
  assert.equal(impliedHypePrice("HYPE", 0, 5), null);
  assert.equal(Math.round(distortion(19_660, 94.7)!), 208);
});

test("swap: the price altitude is a log scale and labels never collide", () => {
  assert.equal(altitudeOf(1), 0);
  assert.equal(altitudeOf(100_000), 1);
  assert.equal(altitudeOf(1000), 0.6);
  assert.equal(decadeLabel(4), "$10k");
  const placed = placeMarks(
    [
      { id: "a", label: "A", price: 94, kind: "reference", detail: "" },
      { id: "b", label: "B", price: 158, kind: "book", detail: "" },
      { id: "c", label: "C", price: 19_660, kind: "pool", detail: "" },
      { id: "d", label: "D", price: 19_257, kind: "pool", detail: "" },
    ],
    360,
    30,
  );
  for (let index = 1; index < placed.length; index += 1) assert.ok(placed[index]!.labelY - placed[index - 1]!.labelY >= 29.99);
  assert.ok(placed.every((mark) => mark.labelY <= 360));
});
