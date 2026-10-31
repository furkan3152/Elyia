import assert from "node:assert/strict";
import { test } from "node:test";

import { GLYPHS } from "../model/glyphs";
import { drawTrail, TRAIL_H, TRAIL_SPAN, trailGeometry, trailProgress } from "../model/trail";

test("the trail places Ely by the distance left to your line", () => {
  assert.equal(trailProgress(true, 0.2), 1, "crossed: at the flag");
  assert.equal(trailProgress(false, null), 0, "no reading: at the trailhead");
  assert.equal(trailProgress(false, TRAIL_SPAN * 2), 0, "further than full scale: at the trailhead");
  assert.equal(trailProgress(false, TRAIL_SPAN / 2), 0.5);
  assert.equal(trailProgress(false, 0), 1);
  assert.equal(trailProgress(false, Number.NaN), 0);
});

test("the trail climbs: the surface rises from the trailhead to the flag", () => {
  const { surface, start, flag } = trailGeometry(200, false);
  assert.ok(surface(flag) < surface(start));
  for (let x = start; x < flag; x += 1) assert.ok(surface(x + 1) <= surface(x));
});

test("level and event gauges draw inside the canvas", () => {
  for (const kind of ["level", "event"] as const) {
    const painted: Array<[number, number]> = [];
    const ctx = { fillStyle: "", fillRect: (x: number, y: number) => painted.push([x, y]), clearRect: () => undefined };
    drawTrail(ctx, { w: 160, compact: false, kind, met: false, gap: 0.1, seconds: 1, still: false, ink: "#16201B" });
    assert.ok(painted.length > 100);
    assert.ok(painted.every(([x, y]) => x >= 0 && x < 160 && y >= -1 && y < TRAIL_H), `${kind} stays in bounds`);
  }
});

test("the kind glyphs are 9 x 9", () => {
  for (const rows of Object.values(GLYPHS)) {
    assert.equal(rows.length, 9);
    assert.ok(rows.every((row) => row.length === 9));
  }
});
