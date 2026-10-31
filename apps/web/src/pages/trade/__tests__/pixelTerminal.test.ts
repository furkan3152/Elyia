import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubmitResult } from "../../../features/trading/executor";
import { onPane, paintChartRopes, snapToUnit } from "../chartRopes";
import { ascentClimbing, ascentOf, balanceBlocks, ridgeMood, ropeAlarms, trackFraction, unitWidth } from "../pixelTerminal";

test("depth bars grow in whole 4 px units, never vanish while there is size", () => {
  assert.equal(unitWidth(0, 300), 0);
  assert.equal(unitWidth(1, 300), 300);
  assert.equal(unitWidth(0.5, 302), 152);
  assert.equal(unitWidth(0.001, 300), 4, "a sliver of size is still one unit");
  assert.equal(unitWidth(2, 100), 100, "capped at the panel");
  assert.equal(unitWidth(0.5, 0), 0);
  for (const fraction of [0.13, 0.37, 0.71]) assert.equal(unitWidth(fraction, 288) % 4, 0);
});

test("the balance meter keeps both sides visible while both hold size", () => {
  assert.equal(balanceBlocks(0.5), 10);
  assert.equal(balanceBlocks(0.001), 1);
  assert.equal(balanceBlocks(0.999), 19);
  assert.equal(balanceBlocks(0), 0);
  assert.equal(balanceBlocks(1), 20);
  assert.equal(balanceBlocks(Number.NaN), 10);
});

test("Ely's mood climbs with the grade and holds on past the market's danger line", () => {
  assert.equal(ridgeMood(2, 1, 20), "calm");
  assert.equal(ridgeMood(3, 5, 20), "steady");
  assert.equal(ridgeMood(4, 10, 20), "tense");
  assert.equal(ridgeMood(5, 15, 20), "worried");
  assert.equal(ridgeMood(3, 5, 5), "worried", "a 5x danger line on a small market");
  assert.equal(trackFraction(1, 1, 1), 0);
  assert.equal(trackFraction(25, 1, 49), 0.5);
  assert.equal(trackFraction(99, 1, 49), 1);
});

test("the ascent: climbing while in flight, then summit, camp or turned back", () => {
  const plan = { label: "Long 0.1 ETH at market" };
  assert.equal(ascentClimbing(1, plan).state, "climb");
  const filled: SubmitResult = { ok: true, outcomes: [{ kind: "filled", oid: 7, totalSz: "0.1", avgPx: "3201.4" }] };
  const summit = ascentOf(2, plan, filled);
  assert.equal(summit?.state, "summit");
  assert.match(summit?.detail ?? "", /0\.1 filled at 3201\.4/u);
  const resting: SubmitResult = { ok: true, outcomes: [{ kind: "resting", oid: 8 }, { kind: "resting", oid: 9 }] };
  assert.equal(ascentOf(3, plan, resting)?.state, "rest");
  assert.match(ascentOf(3, plan, resting)?.detail ?? "", /2 orders resting/u);
  const twap: SubmitResult = { ok: true, outcomes: [{ kind: "running", twapId: 4 }] };
  assert.equal(ascentOf(4, plan, twap)?.stamp, "ON THE TRAIL");
  const blocked: SubmitResult = { ok: false, kind: "blocked", message: "Max leverage 20x", evaluation: null };
  assert.deepEqual([ascentOf(5, plan, blocked)?.state, ascentOf(5, plan, blocked)?.stamp], ["refused", "RULE BOOK"]);
  const error: SubmitResult = { ok: false, kind: "error", title: "Rejected", message: "Insufficient margin" };
  assert.equal(ascentOf(6, plan, error)?.stamp, "REFUSED");
  const confirm = { ok: false, kind: "confirm", message: "Confirm", evaluation: {} } as unknown as SubmitResult;
  assert.equal(ascentOf(7, plan, confirm), null, "a confirm hands over to the review dialog");
});

test("the rope alarm rings once per slip under 10%, with a 12% hysteresis", () => {
  let under: ReadonlySet<string> = new Set();
  let step = ropeAlarms([{ coin: "SOL", distance: 0.15 }, { coin: "ETH", distance: null }], under);
  assert.equal(step.fresh.length, 0);
  under = step.under;
  step = ropeAlarms([{ coin: "SOL", distance: 0.09 }], under);
  assert.deepEqual(step.fresh.map((r) => r.coin), ["SOL"]);
  under = step.under;
  step = ropeAlarms([{ coin: "SOL", distance: 0.08 }], under);
  assert.equal(step.fresh.length, 0, "still under: no second alarm");
  under = step.under;
  step = ropeAlarms([{ coin: "SOL", distance: 0.11 }], under);
  assert.equal(step.fresh.length, 0);
  assert.ok(step.under.has("SOL"), "hovering at 11% stays armed down");
  under = step.under;
  step = ropeAlarms([{ coin: "SOL", distance: 0.095 }], under);
  assert.equal(step.fresh.length, 0, "no chatter around the line");
  under = ropeAlarms([{ coin: "SOL", distance: 0.2 }], step.under).under;
  assert.equal(under.size, 0);
  assert.equal(ropeAlarms([{ coin: "SOL", distance: 0.05 }], under).fresh.length, 1, "climbed back out, slipped again: rings again");
});

test("chart ropes snap to the art grid and paint the crevasse ground on the far side", () => {
  assert.equal(snapToUnit(100.6, 2), 100);
  assert.equal(snapToUnit(103.2, 4), 104);
  assert.ok(onPane(10, 100, 2));
  assert.ok(!onPane(200, 100, 2));
  const rects: Array<{ x: number; y: number; w: number; h: number; c: string }> = [];
  const surface = {
    fillStyle: "" as string,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, c: this.fillStyle });
    },
  };
  paintChartRopes(surface, {
    w: 200,
    h: 100,
    unit: 2,
    ropes: [
      { kind: "crevasse", y: 40, long: true, frays: false },
      { kind: "anchor", y: 400 },
    ],
    palette: { ink: "ink", up: "up", accent: "accent", danger: "danger" },
  });
  const ground = rects.filter((rect) => rect.c === "danger");
  assert.ok(ground.length > 0);
  assert.ok(ground.every((rect) => rect.y > 40), "a long's crevasse ground is below the rope");
  assert.ok(rects.every((rect) => rect.x % 2 === 0 && rect.y % 2 === 0), "every pixel lands on the art grid");
  assert.ok(!rects.some((rect) => rect.y > 100 && rect.c === "ink" && rect.w === 2 && rect.h === 18), "off-pane anchors are skipped");
});
