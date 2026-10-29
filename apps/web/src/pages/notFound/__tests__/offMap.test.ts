import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { editDistance, nearestTrails, offMapReading } from "../offMap";

describe("off the map", () => {
  it("counts a swapped pair of letters as one slip", () => {
    assert.equal(editDistance("trdae", "trade"), 1);
    assert.equal(editDistance("portfolo", "portfolio"), 1);
    assert.equal(editDistance("", "abc"), 3);
    assert.equal(editDistance("same", "same"), 0);
  });

  it("finds the trail a lost path meant", () => {
    assert.equal(nearestTrails("/app/trdae", { inDeck: true })[0]?.trail.path, "/app/trade");
    assert.equal(nearestTrails("/app/portfolo")[0]?.trail.path, "/app/portfolio");
    assert.equal(nearestTrails("/docs")[0]?.trail.path, "/developers");
    assert.equal(nearestTrails("/staking/khype")[0]?.trail.path, "/app/earn");
    assert.deepEqual(nearestTrails("/zzzzqqq"), []);
    assert.deepEqual(nearestTrails("/"), []);
  });

  it("prints stable, off-sheet coordinates per path", () => {
    const a = offMapReading("/nowhere");
    assert.deepEqual(a, offMapReading("/nowhere"));
    assert.notDeepEqual(a, offMapReading("/elsewhere"));
    assert.match(a.lat, /^\d+°\d{2}′N$/u);
    assert.ok(a.y >= 0.25 && a.y < 0.75);
    assert.ok(a.elevation >= 2400 && a.elevation < 4600);
  });
});
