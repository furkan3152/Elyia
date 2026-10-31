import assert from "node:assert/strict";
import { test } from "node:test";

import { drawKillSwitch, KILL_H, KILL_W } from "../guide/killSwitch";
import { elyMood, WIN_MS } from "../guide/mood";
import type { GuideRope } from "../guide/planner";
import { axisDistance, cairnOffset, drawStage, farTop, STAGE_H, stageCentre, type StageSurface } from "../guide/stage";

/** A fake canvas that records the last colour painted at every pixel. */
function raster(w: number, h: number) {
  const grid: Array<Array<string | null>> = Array.from({ length: h }, () => Array<string | null>(w).fill(null));
  const surface: StageSurface = {
    fillStyle: "#000000",
    font: "8px Silkscreen",
    textBaseline: "alphabetic",
    fillRect(x, y, rw, rh) {
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(h, Math.round(y + rh)); yy += 1) for (let xx = Math.max(0, Math.round(x)); xx < Math.min(w, Math.round(x + rw)); xx += 1) grid[yy]![xx] = String(this.fillStyle);
    },
    fillText() {},
    measureText: (text) => ({ width: text.length * 4 }),
    clearRect(x, y, rw, rh) {
      for (let yy = y; yy < y + rh; yy += 1) for (let xx = x; xx < x + rw; xx += 1) if (grid[yy]) grid[yy]![xx] = null;
    },
  };
  return { grid, surface };
}

function rope(coin: string, distance: number | null): GuideRope {
  return { coin, dex: "", side: "long", size: 1, entryPx: 100, markPx: 100, liquidationPx: 90, distance, leverage: 3, positionValue: 100, unrealizedPnl: 0, sl: null, tp: null };
}

const base = { surveying: false, speaking: false, killSwitch: false, ropes: [rope("SOL", 0.3)], lastWin: null, now: 1_000_000, sample: false } as const;

test("Ely's mood follows the conversation and the range, in order of weight", () => {
  assert.equal(elyMood({ ...base, surveying: true }).state, "climb");
  assert.equal(elyMood({ ...base, killSwitch: true, ropes: [rope("SOL", 0.05)] }).state, "watch");
  assert.equal(elyMood({ ...base, lastWin: base.now - 1_000 }).state, "summit");
  assert.equal(elyMood({ ...base, lastWin: base.now + 3_000 }).state, "summit", "a clock a little behind the win still crowns");
  assert.equal(elyMood({ ...base, lastWin: base.now - WIN_MS - 1 }).state, "idle");
  assert.equal(elyMood({ ...base, speaking: true }).state, "talk");
  const worried = elyMood({ ...base, ropes: [rope("SOL", 0.3), rope("ETH", 0.07)] });
  assert.equal(worried.state, "worry");
  assert.match(worried.line, /ETH 3× long is 7\.0% from the crevasse/u);
  assert.equal(elyMood({ ...base, ropes: [] }).state, "sleep");
  assert.match(elyMood({ ...base, ropes: [], sample: true }).line, /sample range/u);
});

test("the stage's range is mirrored about the centre axis", () => {
  for (const w of [90, 240, 300]) {
    for (let x = 0; x < w; x += 1) assert.equal(axisDistance(x, w), axisDistance(w - 1 - x, w));
    for (let x = 0; x < w; x += 1) assert.equal(farTop(axisDistance(x, w)), farTop(axisDistance(w - 1 - x, w)));
  }
  assert.ok(cairnOffset(90) >= 34, "cairns stand clear of Ely on phones");
});

test("a still stage frame is symmetric pixel for pixel (Ely, table, cairns, sky)", () => {
  for (const night of [false, true]) {
    const w = 240;
    const { grid, surface } = raster(w, STAGE_H);
    drawStage(surface, { w, seconds: 0, state: "idle", night, still: true });
    const cx = stageCentre(w);
    let mismatches = 0;
    let painted = 0;
    for (let y = 0; y < STAGE_H; y += 1) {
      for (let d = 0; d < cx; d += 1) {
        const left = grid[y]![cx - 1 - d];
        const right = grid[y]![cx + d];
        if (left) painted += 1;
        if (left !== right) mismatches += 1;
      }
    }
    assert.ok(painted > w * STAGE_H * 0.45, "the stage fills its canvas");
    // the night sky's craters and Ely's own off-axis details are allowed a few pixels
    assert.ok(mismatches / painted < 0.02, `${night ? "night" : "day"}: ${mismatches} of ${painted} pixels break the mirror`);
  }
});

test("every mood draws without leaving the canvas blank", () => {
  for (const state of ["idle", "climb", "summit", "worry", "sleep", "watch", "talk"] as const) {
    const { grid, surface } = raster(120, STAGE_H);
    drawStage(surface, { w: 120, seconds: 3.3, state, night: false, still: false });
    assert.ok(grid.every((row) => row.every((cell) => cell !== null)), `${state} covers every pixel`);
  }
});

test("the kill switch is symmetric, and its beacons only light when pressed", () => {
  for (const on of [false, true]) {
    const { grid, surface } = raster(KILL_W, KILL_H);
    drawKillSwitch(surface, { on, seconds: 0, still: true });
    let mismatches = 0;
    // the word plate ("STOP" / "HELD") is lettering, not mirrored: skip rows 3-10
    for (let y = 12; y < KILL_H; y += 1) for (let x = 0; x < KILL_W / 2; x += 1) if (grid[y]![x] !== grid[y]![KILL_W - 1 - x] && !(y >= 23 && y <= 30)) mismatches += 1;
    // only the four screw highlights differ: the light comes from the top left
    assert.ok(mismatches <= 4, `housing and dome mirror (${on ? "pressed" : "armed"}): ${mismatches}`);
    const lit = grid.flat().some((cell) => cell === "#FF6B5E");
    assert.equal(lit, on);
  }
});
