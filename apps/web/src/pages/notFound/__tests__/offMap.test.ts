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

describe("off the map, in pixels", () => {
  it("puts the pin on the blank paper and walks the trail from it to base camp", async () => {
    const { CAMP, EDGE, elyPhase, pinFor, tearAt, trailPoints, SHEET_H } = await import("../offMapArt");
    const pin = pinFor(offMapReading("/nowhere").y);
    assert.ok(pin.x > EDGE + 10 && pin.y > 20 && pin.y < SHEET_H - 20);
    const trail = trailPoints(pin);
    assert.deepEqual([trail[0]!.x, trail[0]!.y], [pin.x, pin.y]);
    assert.deepEqual([trail[trail.length - 1]!.x, trail[trail.length - 1]!.y], [...CAMP]);
    assert.ok(Math.abs(tearAt(10) - EDGE) <= 6);
    assert.deepEqual(elyPhase(0, true), { phase: "home", t: 1 });
    assert.equal(elyPhase(1, false).phase, "lost");
    assert.equal(elyPhase(8, false).phase, "walk");
    assert.equal(elyPhase(13, false).phase, "home");
  });
});
