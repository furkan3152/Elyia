import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BeatScheduler, RAY_COUNT, RAY_FADE_MS, idleRayLength, rayAngle, rayIntensity, raySlot, rayStrength } from "../sunModel";

describe("sun rays", () => {
  it("advances one slot per block around the rim", () => {
    assert.equal(raySlot(0), 0);
    assert.equal(raySlot(35), 35);
    assert.equal(raySlot(36), 0);
    assert.equal(raySlot(18_431_206), 18_431_206 % RAY_COUNT);
    assert.equal(raySlot(-1), RAY_COUNT - 1);
    assert.ok(Math.abs(rayAngle(0) + Math.PI / 2) < 1e-12, "slot 0 is at 12 o'clock");
    assert.ok(Math.abs(rayAngle(9) - 0) < 1e-12, "a quarter turn is 3 o'clock");
  });

  it("lights fast and fades over ~1.2 s", () => {
    assert.equal(rayIntensity(-1), 0);
    assert.ok(rayIntensity(30) > 0 && rayIntensity(30) < 1);
    assert.equal(rayIntensity(60), 1);
    assert.ok(rayIntensity(600) < rayIntensity(200));
    assert.equal(rayIntensity(RAY_FADE_MS), 0);
    assert.equal(rayIntensity(Number.NaN), 0);
  });

  it("throws longer rays for busier blocks, within bounds", () => {
    assert.equal(rayStrength("0"), 0.35);
    assert.ok(rayStrength("312000") > rayStrength("58095"));
    assert.ok(rayStrength("999999999") <= 1);
    assert.equal(rayStrength("nope"), 0.35);
    for (let slot = 0; slot < RAY_COUNT; slot += 1) assert.ok(idleRayLength(slot) > 0 && idleRayLength(slot) <= 1);
  });
});

describe("beat scheduler", () => {
  it("emits the first arrival at once and spreads a burst at the cadence", () => {
    const scheduler = new BeatScheduler<number>();
    scheduler.setCadence(115);
    for (const n of [1, 2, 3, 4]) scheduler.push(n);
    assert.deepEqual(scheduler.drain(1_000), [1]);
    assert.deepEqual(scheduler.drain(1_050), []);
    assert.deepEqual(scheduler.drain(1_115), [2]);
    assert.deepEqual(scheduler.drain(1_230), [3]);
    assert.deepEqual(scheduler.drain(1_345), [4]);
    assert.equal(scheduler.pending, 0);
  });

  it("keeps one beat per spacing after a late frame instead of bursting", () => {
    const scheduler = new BeatScheduler<number>();
    scheduler.setCadence(100);
    for (const n of [1, 2, 3]) scheduler.push(n);
    scheduler.drain(0);
    assert.deepEqual(scheduler.drain(250), [2], "a late frame shows one beat, not a burst");
    assert.deepEqual(scheduler.drain(349), []);
    assert.deepEqual(scheduler.drain(350), [3]);
  });

  it("compresses spacing so the queue never lags more than maxLag", () => {
    const scheduler = new BeatScheduler<number>({ maxLagMs: 1_000, minSpacingMs: 20 });
    scheduler.setCadence(115);
    for (let n = 0; n < 20; n += 1) scheduler.push(n);
    assert.equal(scheduler.spacing(), 50);
  });

  it("restarts the grid after an idle gap and drops old items beyond maxQueue", () => {
    const scheduler = new BeatScheduler<number>({ maxQueue: 3 });
    scheduler.push(1);
    scheduler.drain(0);
    scheduler.push(2);
    assert.deepEqual(scheduler.drain(10_000), [2], "an arrival after idle shows immediately");
    for (const n of [3, 4, 5, 6, 7]) scheduler.push(n);
    assert.equal(scheduler.pending, 3);
    assert.deepEqual(scheduler.drain(20_000), [5]);
    scheduler.clear();
    assert.equal(scheduler.pending, 0);
  });

  it("ignores an invalid cadence", () => {
    const scheduler = new BeatScheduler<number>();
    scheduler.setCadence(0);
    scheduler.setCadence(Number.NaN);
    assert.equal(scheduler.spacing(), 115);
  });
});
