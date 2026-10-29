import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOLS } from "@elyia/core/protocols";

import { ageLabel, intervalHistogram } from "../model";
import { altitudeOf, bestStatus, conditionOf, trailSigns } from "../registry";

describe("elysium weather station", () => {
  it("bins block intervals, clamping the tails", () => {
    const h = intervalHistogram([10, 112, 115, 118, 300], { from: 60, to: 220, binMs: 10 });
    assert.equal(h.bins.length, 16);
    assert.equal(h.total, 5);
    assert.equal(h.bins[0]!.count, 1);
    assert.equal(h.bins[15]!.count, 1);
    assert.equal(h.bins[5]!.count, 3);
    assert.equal(h.mode, 5);
    assert.equal(h.min, 10);
    assert.equal(intervalHistogram([]).mode, -1);
  });

  it("labels ages without going negative", () => {
    assert.equal(ageLabel(-5), "0 ms ago");
    assert.equal(ageLabel(1_500), "1.5 s ago");
    assert.equal(ageLabel(null), "—");
  });

  it("files every protocol under one altitude, open only when seen working", () => {
    const signs = trailSigns(PROTOCOLS);
    const all = [...signs.summit, ...signs.ridge, ...signs.floor];
    assert.equal(all.length, PROTOCOLS.length);
    for (const sign of all) assert.equal(sign.condition === "open", sign.status === "live" || sign.status === "testnet-live");
    assert.equal(conditionOf("announced"), "caution");
    const perps = PROTOCOLS.find((p) => p.id === "hypercore-perps");
    if (perps) {
      assert.equal(altitudeOf(perps), "floor");
      assert.equal(bestStatus(perps), "live");
    }
  });
});
