import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { elyLayer, mix, paintStub, STUB_H, stubColumn, stubGround } from "../altitudeStub";
import { paintSlope, SLOPE_H, SLOPE_W, slopeTop } from "../gradeSlope";

/** A recording surface: which pixels were painted, last colour wins. */
function surface(w: number, h: number) {
  const px = new Map<string, string>();
  return {
    px,
    ctx: {
      fillStyle: "#000000" as string,
      fillRect(x: number, y: number, rw: number, rh: number) {
        for (let yy = y; yy < y + rh; yy += 1) for (let xx = x; xx < x + rw; xx += 1) if (xx >= 0 && yy >= 0 && xx < w && yy < h) px.set(`${xx},${yy}`, this.fillStyle);
      },
      clearRect() {
        px.clear();
      },
    },
  };
}

describe("route card stub", () => {
  it("stands Ely on the highest layer the sentence travels", () => {
    assert.equal(elyLayer(new Set()), "floor");
    assert.equal(elyLayer(new Set(["floor"] as const)), "floor");
    assert.equal(elyLayer(new Set(["floor", "ridge"] as const)), "ridge");
    assert.equal(elyLayer(new Set(["ridge", "summit"] as const)), "summit");
  });

  it("splits the stub into three equal steps that rise to the Summit", () => {
    const w = 210;
    assert.deepEqual(stubColumn("floor", w), [0, 70]);
    assert.deepEqual(stubColumn("summit", w), [140, 210]);
    const mean = (a: number, b: number) => {
      let sum = 0;
      for (let x = a; x < b; x += 1) sum += stubGround(x, w);
      return sum / (b - a);
    };
    assert.ok(mean(0, 70) > mean(70, 140) && mean(70, 140) > mean(140, 210));
  });

  it("mixes colours and paints inside its box", () => {
    assert.equal(mix("#000000", "#ffffff", 0.5), "rgb(128,128,128)");
    assert.equal(mix("rgb(10,20,30)", "#0a141e", 1), "rgb(10,20,30)");
    const { ctx, px } = surface(120, STUB_H);
    paintStub(ctx, 120, { touched: new Set(["ridge"] as const), seconds: 0, still: true, fog: "#FFF9EC", hop: { from: 0.5, to: 0.5, start: 0 } });
    assert.ok(px.size > 120 * 10);
  });
});

describe("grade slopes", () => {
  it("rise left to right, steeper with the grade", () => {
    assert.ok(slopeTop("trail", 60) > slopeTop("mountain", 60));
    for (const band of ["trail", "mountain", "alpine"] as const) {
      assert.ok(slopeTop(band, 2) >= slopeTop(band, SLOPE_W - 2));
      const { ctx, px } = surface(SLOPE_W, SLOPE_H);
      paintSlope(ctx, band, 1, false);
      assert.ok(px.size > 200, band);
    }
  });
});
