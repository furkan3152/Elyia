import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BADGE_H, BADGE_W, paintLayerPeak } from "../pixelParts";
import { paintStation, peakTop } from "../station";

function surface() {
  let count = 0;
  return {
    count: () => count,
    ctx: {
      fillStyle: "#000000" as string,
      fillRect() {
        count += 1;
      },
      clearRect() {
        count = 0;
      },
    },
  };
}

describe("the weather station", () => {
  it("stands on a summit that is symmetric about the axis", () => {
    const w = 240;
    const h = 86;
    for (let d = 0; d < 120; d += 7) assert.equal(peakTop(120 - d, w, h), peakTop(120 + d, w, h), `offset ${d}`);
    assert.ok(peakTop(120, w, h) < peakTop(10, w, h));
  });

  it("paints by day and by night, still and moving", () => {
    for (const night of [false, true])
      for (const still of [false, true]) {
        const s = surface();
        paintStation(s.ctx, 240, 86, { seconds: 3.2, still, night, tps: 20 });
        assert.ok(s.count() > 240 * 86 * 0.5);
      }
  });

  it("draws each layer's peak taller the higher it lives", () => {
    const tops = (["floor", "ridge", "summit"] as const).map((layer) => {
      let top = BADGE_H;
      const ctx = {
        fillStyle: "",
        fillRect(_x: number, y: number) {
          top = Math.min(top, y);
        },
        clearRect() {},
      };
      paintLayerPeak(ctx, layer, 0, true);
      return top;
    });
    assert.ok(tops[0]! > tops[1]! && tops[1]! > tops[2]!);
    assert.ok(BADGE_W > 0);
  });
});
