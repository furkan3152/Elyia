import assert from "node:assert/strict";
import { test } from "node:test";

import { altitudeOf, decadeLabel, distortion, impliedHypePrice, placeMarks, probeAction, probeIsUsd, probeOf, probeView, swapAction, swapSentence, VENUES } from "../swapModel";

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

test("swap: each venue is probed with a pair it holds, and only HYPE/USDC probes are prices", () => {
  const perpme = VENUES.summit.find((venue) => venue.id === "perpme")!;
  assert.deepEqual(probeAction(perpme, "summit", "testnet"), { kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0xd089ff84573e35626aae2cc92d1acfc4b3e225e1", amount: "0.01", protocol: "perpme" });
  assert.equal(probeIsUsd(probeOf(perpme)), false);
  const quoted = probeView(perpme, { kind: "quoted", out: 46_797.456, fake: false });
  assert.equal(quoted.result, "0.01 HYPE → 46,797 PERPME");
  assert.match(quoted.note, /PERPME is unverified and unpriced/u);
  const hexswap = VENUES.summit.find((venue) => venue.id === "hexswap")!;
  assert.equal(probeView(hexswap, { kind: "quoted", out: 0.2123579, fake: false }).result, "0.01 HYPE → 0.212 HEX");
  const hyperswap = VENUES.ridge[0]!;
  assert.equal(probeIsUsd(probeOf(hyperswap)), true);
  const empty = probeView(hyperswap, { kind: "refused", message: "HyperSwap V3 has no HYPE/USDC pool with liquidity." });
  assert.equal(empty.knownEmpty, true);
  assert.equal(empty.result, "no liquidity today");
  assert.equal(probeView(VENUES.summit[0]!, { kind: "pending" }).pending, true);
  // A catalog row without a probe falls back to 1 HYPE -> USDC.
  assert.equal(probeOf({ id: "x" }).pair, "HYPE/USDC");
});
