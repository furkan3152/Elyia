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
