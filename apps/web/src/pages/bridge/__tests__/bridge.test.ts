import assert from "node:assert/strict";
import { test } from "node:test";

import { laneAction, laneAsset, laneBalance, laneById, LANES, laneSentence } from "../lanes";
import { GROUND, LANE_GEOMETRY, slopeTrail } from "../sectionGeometry";

const packs = { address: "0x1", summit: { HYPE: 2, USDC: 10 }, ridge: { HYPE: 1, USDC: null }, floor: { HYPE: 0, USDC: 7 }, perps: 3 } as const;

test("lanes: one planner action per lane, on the right networks", () => {
  assert.equal(LANES.length, 6);
  assert.deepEqual(laneAction(laneById("up-summit")!, "HYPE", "0.5", "testnet"), { kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.5" });
  assert.deepEqual(laneAction(laneById("down-ridge")!, "USDC", "3", "testnet"), { kind: "bridge", network: "elysium-testnet", toNetwork: "hyperevm-testnet", from: "USDC", amount: "3" });
  assert.equal(laneAction(laneById("down-floor")!, "USDC", "3", "testnet").kind, "link");
  assert.equal(laneAction(laneById("up-ridge")!, "USDC", "3", "testnet").network, "hypercore-testnet");
  assert.deepEqual(laneAction(laneById("to-spot")!, "USDC", "1", "testnet").params, { toPerp: false });
  assert.equal(laneById("nope"), null);
});

test("lanes: assets, sentences, balances and the descent clock", () => {
  assert.equal(laneAsset(laneById("to-perps")!, "HYPE"), "USDC");
  assert.equal(laneSentence(laneById("up-summit")!, "HYPE", "20"), "bridge 20 HYPE to Elysium");
  assert.equal(laneSentence(laneById("down-floor")!, "USDC", "5"), "move 5 USDC from HyperEVM to HyperCore");
  assert.equal(laneBalance(laneById("up-summit")!, "HYPE", packs as never), 0.99);
  assert.equal(laneBalance(laneById("up-summit")!, "USDC", packs as never), null);
  assert.equal(laneBalance(laneById("to-spot")!, "USDC", packs as never), 3);
  assert.equal(laneBalance(laneById("up-ridge")!, "USDC", packs as never), 7);
  const down = laneById("down-ridge")!;
  assert.equal(down.seconds("HYPE"), 1810);
  assert.equal(down.mainnetSeconds, 485_640);
});

test("section: the long trail stays above the ground and every lane has a path", () => {
  for (const point of slopeTrail(8, 16)) assert.ok(point.y <= GROUND.ridge && point.y >= GROUND.summit - 40, `trail point ${point.x},${point.y} in the air`);
  for (const lane of LANES) assert.match(LANE_GEOMETRY[lane.id].d, /^M[\d.]+,[\d.]+/u);
});
