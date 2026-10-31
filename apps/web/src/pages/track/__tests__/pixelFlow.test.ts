import assert from "node:assert/strict";
import { test } from "node:test";

import { paintSideView, sideGeometry } from "../../bridge/sideView";
import { blipGlow, paintRadar, sweepAngle, SWEEP_SECONDS } from "../../discover/radarScope";
import { radarBlips } from "../../discover/radar";
import { mountainHeight, paintSkyline, skylineLayout } from "../../earn/skyline";
import type { YieldRow } from "../../earn/yields";
import { altitudeLayout, mix, paintAltitude, priceY } from "../../swap/altitudeBars";
import type { AltitudeMark } from "../../swap/swapModel";
import { bandLine, hashFingerprint, journeyMood, legPoints, paintTrace, stationsOf, stationX } from "../traceTrail";

/** A canvas stand-in that counts paints and checks every rectangle lands on whole pixels. */
function fakeCtx() {
  const ctx = {
    fillStyle: "" as unknown,
    font: "",
    textBaseline: "top",
    rects: 0,
    texts: [] as string[],
    fillRect(x: number, y: number, w: number, h: number) {
      assert.ok([x, y, w, h].every(Number.isFinite), "finite rectangle");
      this.rects += 1;
    },
    clearRect() {},
    fillText(text: string) {
      this.texts.push(text);
    },
    measureText(text: string) {
      return { width: text.length * 5 };
    },
  };
  return ctx;
}

const MARKS: AltitudeMark[] = [
  { id: "kalos", label: "Kalos V3", price: 20_850, kind: "pool", detail: "test-USDC pool" },
  { id: "reference", label: "Reference", price: 48, kind: "reference", detail: "HyperCore mainnet" },
  { id: "book", label: "Floor book", price: 31, kind: "book", detail: "HyperCore testnet" },
];

test("price altitude: mirrored gutters, equal slots, higher price = higher tower", () => {
  const layout = altitudeLayout(MARKS, 400, 150);
  assert.equal(layout.bars.length, 3);
  const centres = layout.bars.map((bar) => bar.x + bar.w / 2);
  assert.ok(Math.abs(centres[0]! - layout.gutter - (layout.w - layout.gutter - centres[2]!)) <= 1, "outer towers mirror about the axis");
  assert.ok(Math.abs(centres[1]! - 200) <= 1, "the middle tower stands on the axis");
  assert.ok(layout.bars[0]!.top < layout.bars[1]!.top, "the pool towers above the reference");
  assert.equal(layout.referenceY, priceY(48, layout.ground, layout.ceiling));
  assert.ok(priceY(1, 150, 10) > priceY(100, 150, 10));
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
  const ctx = fakeCtx();
  paintAltitude(ctx as never, layout, { marks: MARKS, reference: 48, night: false, seconds: 1, still: false });
  assert.ok(ctx.texts.some((text) => text.startsWith("×434")), "the gap is labelled with the distortion");
});

const ROWS: YieldRow[] = [
  { id: "hlp", name: "HLP", kind: "vault", layer: "floor", aprPct: 6, tvlUsd: 117e6, asset: "USDC", entry: "external", note: "" },
  { id: "stake", name: "Staking", kind: "staking", layer: "floor", aprPct: 2.7, tvlUsd: 2.8e9, asset: "HYPE", entry: "external", note: "" },
  { id: "loss", name: "Losing", kind: "vault", layer: "floor", aprPct: -50, tvlUsd: 1e4, asset: "USDC", entry: "external", note: "" },
];

test("yield skyline: height = APR, width = TVL, losses are lakes, peaks are symmetric", () => {
  const layout = skylineLayout(ROWS, 400, 140);
  const [hlp, stake, loss] = layout.mountains;
  assert.ok(hlp!.rise > stake!.rise, "the higher APR is the taller mountain");
  assert.ok(stake!.half > hlp!.half, "the bigger TVL is the wider mountain");
  assert.equal(loss!.lake, true);
  assert.ok(loss!.rise < 0);
  for (let d = 0; d < hlp!.half; d += 1) assert.equal(mountainHeight(hlp!, hlp!.cx - d), mountainHeight(hlp!, hlp!.cx + d), "mirror flanks");
  assert.equal(mountainHeight(loss!, loss!.cx), 0);
  const ctx = fakeCtx();
  paintSkyline(ctx as never, layout, { rows: ROWS, selectedId: "loss", night: true, seconds: 2, still: false });
  assert.ok(ctx.rects > 1000);
});

test("trace: stations by layer, stepped legs, Ely's mood and the fingerprint", () => {
  const stations = stationsOf(
    [
      { label: "Delayed inbox", state: "done" },
      { label: "Ticket", state: "done" },
      { label: "Auto-redeem", state: "alert" },
      { label: "On the Summit", state: "todo" },
    ],
    "ridge",
  );
  assert.deepEqual(
    stations.map((s) => s.layer),
    ["ridge", "summit", "summit", "summit"],
  );
  assert.deepEqual(journeyMood(stations), { mood: "worry", at: 2 });
  assert.deepEqual(journeyMood([]), { mood: "sleep", at: -1 });
  assert.equal(journeyMood(stations.map((s) => ({ ...s, state: "done" as const }))).mood, "summit");
  assert.ok(bandLine("summit", 120) < bandLine("ridge", 120) && bandLine("ridge", 120) < bandLine("floor", 120));
  const a = { x: stationX(0, 4, 400, 24), y: bandLine("ridge", 120) };
  const b = { x: stationX(1, 4, 400, 24), y: bandLine("summit", 120) };
  const leg = legPoints(a, b);
  assert.deepEqual(leg[0], a);
  assert.deepEqual(leg[leg.length - 1], b);
  const print = hashFingerprint("0x264dafab0cb68df8fc676e74a1e75fe7b2dbeae3e08cd8e1d2664f05ae74a40c");
  assert.equal(print.length, 7);
  for (const row of print) assert.deepEqual(row, [...row].reverse(), "mirrored");
  const ctx = fakeCtx();
  paintTrace(ctx as never, 400, 120, { stations, idleText: "", night: false, seconds: 1, still: true, compact: false });
  assert.ok(ctx.texts.includes("SUMMIT · ELYSIUM"));
});

test("radar: the sweep steps once per 1/64 turn and lights a blip once per turn", () => {
  assert.equal(sweepAngle(0), 0);
  assert.equal(sweepAngle(SWEEP_SECONDS), 0);
  assert.equal(sweepAngle(SWEEP_SECONDS / 128), 0, "stepped, not continuous");
  assert.equal(blipGlow(1, 1), 1);
  assert.equal(blipGlow(1, 1 + Math.PI), 0);
  assert.ok(blipGlow(1, 1.5) > 0 && blipGlow(1, 1.5) < 1);
  const blips = radarBlips([{ name: "PURR", fullName: null, index: 1, book: "PURR/USDC", markPx: 1, dayVolumeUsd: 1e5, change: 0, evmLinked: false, condition: "caution", reason: "" }]);
  const ctx = fakeCtx();
  paintRadar(ctx as never, 60, { blips, picked: "PURR", hover: null, night: false, seconds: 3, still: false });
  assert.ok(ctx.texts.includes("PURR"));
});

test("bridge side view paints every lane, day and night", () => {
  const geo = sideGeometry(228, 128);
  for (const selected of ["up-summit", "down-ridge", "down-floor", "up-ridge", "to-perps", "to-spot"] as const) {
    const ctx = fakeCtx();
    paintSideView(ctx as never, geo, { seconds: 2, still: false, night: selected.length % 2 === 0, selected, tag: "TAG", compact: true });
    assert.ok(ctx.texts.includes("TAG"));
  }
});
