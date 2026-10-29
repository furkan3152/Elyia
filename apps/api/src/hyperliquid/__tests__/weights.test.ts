import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManualClock } from "../../clock.js";
import { infoWeight, responseWeight, WeightBudget } from "../weights.js";

describe("Hyperliquid weights", () => {
  it("uses the documented info weights", () => {
    for (const type of ["l2Book", "allMids", "clearinghouseState", "orderStatus", "spotClearinghouseState", "exchangeStatus"]) {
      assert.equal(infoWeight(type), 2, type);
    }
    assert.equal(infoWeight("userRole"), 60);
    assert.equal(infoWeight("metaAndAssetCtxs"), 20);
    assert.equal(infoWeight("somethingNew"), 20);
  });

  it("adds per-item weight for list responses", () => {
    assert.equal(responseWeight("userFills", new Array(45)), 2);
    assert.equal(responseWeight("candleSnapshot", new Array(150)), 2);
    assert.equal(responseWeight("meta", new Array(500)), 0);
    assert.equal(responseWeight("userFills", { not: "a list" }), 0);
  });
});

describe("WeightBudget", () => {
  it("spends whole requests only and reports the wait", () => {
    const clock = new ManualClock(0);
    const budget = new WeightBudget(100, clock);
    assert.equal(budget.tryTake(60), 0);
    clock.advance(10_000);
    assert.equal(budget.tryTake(30), 0);
    assert.equal(budget.remaining(), 10);
    const wait = budget.tryTake(20);
    assert.ok(wait > 0, "does not fit");
    assert.equal(budget.used(), 90, "a refused request spends nothing");
    // The first 60 (spent at t=0) leave the window at 61 s, their bucket's last moment plus a minute: 51 s from now.
    assert.equal(wait, 51);
    clock.advance(51_000);
    assert.equal(budget.tryTake(20), 0);
    assert.equal(budget.used(), 50);
  });

  it("lets charges overdraw and delays later requests", () => {
    const clock = new ManualClock(0);
    const budget = new WeightBudget(100, clock);
    budget.charge(150);
    assert.ok(budget.tryTake(1) > 0);
    assert.equal(budget.remaining(), 0);
    clock.advance(61_000);
    assert.equal(budget.tryTake(1), 0);
  });

  it("refuses a request larger than the whole budget", () => {
    const budget = new WeightBudget(10, new ManualClock(0));
    assert.equal(budget.tryTake(11), 60);
    assert.throws(() => new WeightBudget(0));
  });
});
