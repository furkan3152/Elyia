import assert from "node:assert/strict";
import { test } from "node:test";

import type { Insight } from "@elyia/core/api/agent";

import { altimeterDigits, insightViews, pnlSteps, rankedCauses, signedPct, waterfall, whatIfPresets } from "../v2/model";

test("what-if presets: largest −10, whole range −30, HYPE +20, reset", () => {
  const presets = whatIfPresets(["BTC", "HYPE", "SOL"]);
  assert.deepEqual(
    presets.map((preset) => [preset.label, preset.driver, preset.pct]),
    [
      ["BTC −10%", "BTC", -10],
      ["All −30%", null, -30],
      ["HYPE +20%", "HYPE", 20],
      ["Reset", "BTC", 0],
    ],
  );
  assert.equal(whatIfPresets([])[0].label, "All −10%");
  assert.equal(signedPct(-30), "−30%");
  assert.equal(signedPct(20), "+20%");
  assert.equal(signedPct(0), "0%");
});

test("waterfall: bars chain and reconcile (start + steps = end); axis covers every bar", () => {
  const fall = waterfall({ label: "Start", value: 46_929 }, [
    { label: "Price", value: 1_318 },
    { label: "Funding", value: -51 },
    { label: "Fees", value: -21 },
    { label: "Yield", value: 38 },
  ], "End");
  assert.equal(fall.total, 48_213);
  assert.equal(fall.bars.at(-1)!.to, 48_213);
  for (let i = 2; i < fall.bars.length - 1; i += 1) assert.equal(fall.bars[i]!.from, fall.bars[i - 1]!.to);
  assert.deepEqual(fall.bars.map((bar) => bar.kind), ["start", "up", "down", "down", "up", "total"]);
  assert.ok(fall.min > 0 && fall.min < 46_929, "axis starts above zero, below the start");
  assert.ok(fall.max > 48_247);
});

test("waterfall without a start includes zero and handles a net loss", () => {
  const steps = pnlSteps({ realizedPnlUsd: -23_137.36, feesUsd: 732.32, fundingUsd: -98_695.11, unrealizedPnlUsd: 2_259.86 });
  assert.equal(steps[2]!.value, -732.32);
  const fall = waterfall(null, steps, "Net");
  assert.ok(Math.abs(fall.total - (-23_137.36 - 732.32 - 98_695.11 + 2_259.86)) < 1e-6);
  assert.ok(fall.min < fall.total && fall.max >= 0);
  assert.deepEqual(rankedCauses(steps).map((step) => step.label), ["Funding", "Realized", "Unrealized", "Fees"]);
});

test("insight views: act first, buttons only when there is something to sign, paper is labelled", () => {
  const base = { title: { en: "t", tr: "t" }, explanation: { en: "e", tr: "e" }, figures: { coin: "SOL", liquidationDistancePct: 3.0371 } } as const;
  const insights: Insight[] = [
    { ...base, id: "a", kind: "funding-harvest", severity: "info", actions: [], paper: true },
    { ...base, id: "b", kind: "liquidation-guard", severity: "act", actions: [{ kind: "order", network: "hypercore-testnet", market: "SOL" }], paper: false },
    { ...base, id: "c", kind: "what-if", severity: "info", actions: [], paper: false },
  ];
  const views = insightViews(insights);
  assert.deepEqual(views.map((view) => view.id), ["b", "a"]);
  assert.equal(views[0]!.action, "Ease the rope");
  assert.equal(views[0]!.layer, "HyperCore");
  assert.equal(views[1]!.action, null);
  assert.equal(views[1]!.paper, true);
  assert.deepEqual(views[0]!.figures[1], { key: "liquidation distance pct", value: "3.0371" });
});

test("altimeter digits: only changed digits roll", () => {
  assert.deepEqual(altimeterDigits(48_213, null).changed, [false, false, false, false, false, false]);
  const next = altimeterDigits(48_236, 48_213);
  assert.deepEqual(next.chars, ["4", "8", ",", "2", "3", "6"]);
  assert.deepEqual(next.changed, [false, false, false, false, true, true]);
  assert.deepEqual(altimeterDigits(100_000, 99_999).changed, [true, true, true, false, true, true, true]);
});

test("explain-PnL waterfall (sample): five bars, Unrealized and Net included, reconciling to $1,284", async () => {
  const { SAMPLE_PNL } = await import("../v2/sample");
  const { barProgress, drawWaterfall, WATERFALL_END_S } = await import("../v2/draw");
  const steps = pnlSteps(SAMPLE_PNL);
  const fall = waterfall(null, steps, "Net");
  assert.deepEqual(
    fall.bars.map((bar) => [bar.label, bar.kind, bar.from, bar.to]),
    [
      ["Realized", "up", 0, 1318],
      ["Funding", "down", 1318, 1267],
      ["Fees", "down", 1267, 1246],
      ["Unrealized", "up", 1246, 1284],
      ["Net", "total", 0, 1284],
    ],
  );
  assert.equal(fall.total, 1318 - 51 - 21 + 38);
  assert.equal(fall.min, 0, "the axis starts at $0 (the caption says so)");
  assert.ok(fall.max >= 1318);
  // Every bar has finished rising by the end time; none before its slot.
  for (let index = 0; index < fall.bars.length; index += 1) assert.equal(barProgress(index, WATERFALL_END_S), 1, `bar ${index}`);
  assert.equal(barProgress(4, 0.5), 0);
  // Drawn at the end state on a fake surface: five bar rects, one per slot.
  const rects: Array<{ x: number; w: number; h: number; c: string }> = [];
  const surface = { fillStyle: "", clearRect() {}, fillRect(x: number, _y: number, w: number, h: number) { rects.push({ x, w, h, c: String(this.fillStyle) }); } };
  const pal = { rule: "rule", ink3: "ink3", up: "up", down: "down", accent: "accent" };
  drawWaterfall(surface as never, fall, 132, 66, WATERFALL_END_S, pal as never);
  const bars = rects.filter((rect) => ["up", "down", "accent"].includes(rect.c) && rect.w > 4);
  assert.deepEqual(bars.map((bar) => bar.c), ["up", "down", "down", "up", "accent"]);
  assert.ok(bars.every((bar) => bar.h >= 2), "even a small step is visible");
  const slot = Math.floor(132 / 5);
  assert.deepEqual(bars.map((bar) => Math.floor(bar.x / slot)), [0, 1, 2, 3, 4]);
  // Net runs from $0 like Realized: about as tall (1,284 vs 1,318), far taller than the steps between.
  assert.ok(bars[4]!.h > 40 && Math.abs(bars[4]!.h - bars[0]!.h) <= 3, JSON.stringify(bars));
});

test("explain-PnL waterfall (live figures): the net is the server's closed net plus unrealized, axis below the loss", () => {
  // Figures as /v1/agent/insights returned them for 0xdc00…af95 on 2026-11-01 (testnet).
  const figures = { realizedPnlUsd: -23137.36, feesUsd: 730.81, fundingUsd: -100683.76, netUsd: -124551.94, unrealizedPnlUsd: 2051.5, days: 30 };
  const fall = waterfall(null, pnlSteps(figures), "Net");
  assert.equal(fall.bars.length, 5);
  // Each figure is rounded to cents on the server, so the sums agree to a cent or two.
  assert.ok(Math.abs(fall.total - (figures.netUsd + figures.unrealizedPnlUsd)) <= 0.02);
  assert.ok(fall.min < fall.total && fall.min < -124551.94, "the axis never cuts a bar");
  assert.ok(fall.max >= 0, "zero is on the axis");
  assert.deepEqual(fall.bars.map((bar) => bar.kind), ["down", "down", "down", "up", "total"]);
});
