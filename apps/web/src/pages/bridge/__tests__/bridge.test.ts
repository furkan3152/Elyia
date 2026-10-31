import assert from "node:assert/strict";
import { test } from "node:test";

import { laneAction, laneAsset, laneBalance, laneById, LANES, laneSentence } from "../lanes";
import { laneMotion, resample, sideGeometry } from "../sideView";

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

test("side view: terraces climb Floor -> Ridge -> Summit and every lane joins its camps", () => {
  for (const [w, h] of [
    [400, 150],
    [228, 128],
  ] as const) {
    const geo = sideGeometry(w, h);
    assert.equal(geo.skyline.length, w);
    assert.ok(geo.ground.summit < geo.ground.ridge && geo.ground.ridge < geo.ground.floor, "summit above ridge above floor");
    assert.equal(geo.skyline[0], geo.ground.floor);
    assert.equal(geo.skyline[w - 1], geo.ground.summit);
    for (const lane of LANES) {
      const points = geo.lanes[lane.id];
      assert.ok(points.length > 10, `${lane.id} sampled`);
      for (const p of points) assert.ok(p.x >= 0 && p.x < w && p.y >= 0 && p.y <= h, `${lane.id} point inside the view`);
    }
    const up = geo.lanes["up-summit"];
    assert.ok(up[0]!.y > up[up.length - 1]!.y, "the cable car ends higher than it starts");
    const down = geo.lanes["down-ridge"];
    assert.ok(down[0]!.y < down[down.length - 1]!.y, "the long trail ends lower");
    // the trail stays on or above the ground
    for (const p of down) assert.ok(p.y <= geo.skyline[Math.max(0, Math.min(w - 1, Math.round(p.x)))]! + 1, "trail above ground");
  }
});

test("side view: Ely travels, then stands at the camp; reduced motion shows the arrival", () => {
  const line = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 10);
  assert.equal(line.length, 11);
  assert.deepEqual(line[5], { x: 5, y: 0 });
  const geo = sideGeometry(400, 150);
  const points = geo.lanes["to-spot"];
  assert.equal(laneMotion(points, 0, false).t, 0);
  assert.equal(laneMotion(points, 0, true).arrived, true);
  assert.equal(laneMotion(points, 1, false).facingLeft, true);
  assert.equal(laneMotion(geo.lanes["to-perps"], 1, false).facingLeft, false);
});
