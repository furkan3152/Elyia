import assert from "node:assert/strict";
import { test } from "node:test";

import { campReading, type CampInput } from "../camp";
import { paintCamp } from "../campScene";
import { radioEntries } from "../radio";
import { sampleHistory, sampleRopes } from "../../portfolio/range/sample";

const BASE: CampInput = { loading: false, sample: false, watching: false, netWorthUsd: 12_000, positions: 1, ropes: [{ coin: "ETH", distance: 0.3 }], equity: [10, 12, 11] };

test("Ely climbs while the range is read", () => {
  assert.deepEqual(campReading({ ...BASE, loading: true }), { mood: "loading", ely: "climb", rope: null });
});

test("Ely worries only under 10% to the crevasse, about the nearest rope", () => {
  const reading = campReading({ ...BASE, ropes: [{ coin: "ETH", distance: 0.3 }, { coin: "SOL", distance: 0.08 }, { coin: "BTC", distance: 0.06 }, { coin: "X", distance: null }] });
  assert.equal(reading.ely, "worry");
  assert.deepEqual(reading.rope, { coin: "BTC", distance: 0.06 });
  assert.equal(campReading({ ...BASE, ropes: [{ coin: "ETH", distance: 0.1 }] }).ely, "idle");
});

test("Ely sleeps only when nothing is on any layer", () => {
  assert.equal(campReading({ ...BASE, netWorthUsd: 0.2, positions: 0, ropes: [] }).ely, "sleep");
  assert.notEqual(campReading({ ...BASE, netWorthUsd: 0.2, positions: 1 }).ely, "sleep");
});

test("a new high plants the flag; watching someone keeps watch", () => {
  assert.equal(campReading({ ...BASE, equity: [10, 11, 12] }).mood, "summit");
  assert.equal(campReading({ ...BASE, watching: true }).ely, "watch");
  assert.equal(campReading(BASE).mood, "calm");
});

test("the sample is labelled and still worries about a fraying sample rope", () => {
  const reading = campReading({ ...BASE, sample: true, ropes: [{ coin: "FARTCOIN", distance: 0.06 }] });
  assert.equal(reading.mood, "sample");
  assert.equal(reading.ely, "worry");
});

test("the camp scene paints inside its sheet for every mood, day and night, phone and desk", () => {
  for (const [w, h] of [
    [300, 72],
    [114, 64],
  ] as const) {
    for (const mood of ["loading", "sample", "empty", "worry", "summit", "watch", "calm"] as const) {
      for (const night of [false, true]) {
        const painted = new Set<string>();
        let tx = 0;
        let ty = 0;
        const ctx = {
          fillStyle: "",
          font: "",
          textBaseline: "",
          fillRect(x: number, y: number, rw: number, rh: number) {
            for (let px = 0; px < rw; px += 1) for (let py = 0; py < rh; py += 1) painted.add(`${Math.round(x + tx + px)},${Math.round(y + ty + py)}`);
          },
          clearRect() {},
          fillText() {},
          save() {},
          restore() {
            tx = 0;
            ty = 0;
          },
          translate(x: number, y: number) {
            tx += x;
            ty += y;
          },
        } as unknown as CanvasRenderingContext2D;
        paintCamp(ctx, { w, h, seconds: 2.5, still: false, mood, ely: "idle", night, radio: true });
        // the sky and the floor cover the whole sheet
        assert.ok(painted.has("0,0") && painted.has(`${w - 1},${h - 1}`), `${mood} ${night} covers the sheet`);
      }
    }
  }
});

test("the radio calls fraying ropes first, then the register, never more than six lines", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const entries = radioEntries(sampleRopes(), sampleHistory(now), now);
  assert.ok(entries.length <= 6);
  assert.equal(entries[0]!.from, "ALERT");
  assert.equal(entries[0]!.live, true);
  const quiet = radioEntries([], null, now);
  assert.equal(quiet.length, 1);
  assert.equal(quiet[0]!.from, "GUIDE");
});
