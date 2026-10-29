import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { digitDiff, rolledDigits } from "../geometry/altimeter";
import { cadenceMs, shouldRebase, stripOffset, tickAmplitude, tickX, tracePath, visibleTicks } from "../geometry/barograph";
import {
  avalancheLevel,
  blazeFor,
  conditionFromScore,
  gradeFor,
  percentileRank,
  weatherFromPercentile,
  weatherFromVolatility,
  windsock,
} from "../geometry/conditions";
import { fieldAt, isolines, polygonArea, ringContains, sampleField, simplify, smoothPath } from "../geometry/contours";
import { athIndex, maxDrawdown, profileModel } from "../geometry/profile";
import { buildRelief, contourInterval, hillSigma, layoutHills, reliefKey, type ReliefHolding } from "../geometry/relief";
import { ropeDistance, ropeGeometry, ropeState } from "../geometry/rope";
import { bladePath, routeProfile } from "../geometry/route";
import { applyShock, clampShock } from "../geometry/shock";
import { seededRandom } from "../../motion/tokens";

const gaussian = (cx: number, cy: number, sigma: number, height: number) => (x: number, y: number) =>
  height * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));

describe("contouring", () => {
  it("traces a single hill as one closed ring per level, around the peak", () => {
    const field = sampleField(200, 200, 5, gaussian(100, 100, 30, 100));
    for (const level of [20, 50, 80]) {
      const lines = isolines(field, level);
      assert.equal(lines.length, 1, `one line at ${level}`);
      assert.equal(lines[0]!.closed, true, `closed at ${level}`);
      assert.ok(ringContains(lines[0]!.points, [100, 100]), "ring contains the peak");
      // the radius of a Gaussian contour is sigma * sqrt(2 ln(h / level))
      const expected = 30 * Math.sqrt(2 * Math.log(100 / level));
      const radius = Math.hypot(lines[0]!.points[0]![0] - 100, lines[0]!.points[0]![1] - 100);
      assert.ok(Math.abs(radius - expected) < 2, `radius ${radius.toFixed(2)} ~ ${expected.toFixed(2)}`);
    }
  });

  it("gives a basin (negative hill) rings whose inside is below the level", () => {
    const field = sampleField(200, 200, 5, (x, y) => -gaussian(100, 100, 25, 60)(x, y));
    const lines = isolines(field, -30);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.closed);
    assert.ok(fieldAt(field, 100, 100) < -30, "the centre is deeper than the ring");
    assert.ok(fieldAt(field, 5, 5) > -30, "outside is higher");
  });

  it("returns open lines that touch the border and nothing outside the range", () => {
    const field = sampleField(100, 100, 5, (x) => x); // a ramp
    const lines = isolines(field, 42.5);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.closed, false);
    for (const [x] of lines[0]!.points) assert.ok(Math.abs(x - 42.5) < 1e-9);
    assert.deepEqual(isolines(field, 500), []);
    assert.deepEqual(isolines(field, -1), []);
  });

  it("separates two hills at a level below their saddle and merges them above it", () => {
    const fn = (x: number, y: number) => gaussian(70, 100, 20, 100)(x, y) + gaussian(130, 100, 20, 100)(x, y);
    const field = sampleField(200, 200, 2, fn);
    const saddle = fn(100, 100);
    assert.equal(isolines(field, saddle + 10).length, 2, "two peaks above the saddle");
    assert.equal(isolines(field, saddle - 10).length, 1, "one ring around both below the saddle");
  });

  it("computes signed areas, simplifies and smooths", () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    assert.equal(Math.abs(polygonArea(square)), 100);
    const straight = Array.from({ length: 20 }, (_, i) => [i, 0] as [number, number]);
    assert.equal(simplify(straight, 0.1).length, 2);
    const path = smoothPath(square, true);
    assert.ok(path.startsWith("M0,0C") && path.endsWith("Z"));
    assert.equal((path.match(/C/g) ?? []).length, 4);
  });
});

const SAMPLE: ReliefHolding[] = [
  { id: "hype", symbol: "HYPE", usd: 12400, layer: "floor", side: "long", leverage: 3 },
  { id: "eth", symbol: "ETH", usd: 8960, layer: "floor", side: "long", leverage: 5 },
  { id: "fart", symbol: "FARTCOIN", usd: 1950, layer: "floor", side: "short", leverage: 3 },
  { id: "khype", symbol: "kHYPE", usd: 6040, layer: "ridge" },
  { id: "usdc", symbol: "USDC", usd: 4180, layer: "summit" },
];

describe("relief", () => {
  it("sizes hills by the square root of value and picks round intervals", () => {
    assert.equal(hillSigma(0), 20);
    assert.ok(Math.abs(hillSigma(10_000) - 66) < 1e-9);
    assert.equal(contourInterval(12_400), 800);
    assert.equal(contourInterval(1_000), 70);
    assert.equal(contourInterval(0), 100);
  });

  it("places hills inside their layer region without overlapping", () => {
    const hills = layoutHills(SAMPLE, 900, 620, 7);
    assert.equal(hills.length, SAMPLE.length);
    const ridge = hills.find((hill) => hill.holding.id === "khype")!;
    const summit = hills.find((hill) => hill.holding.id === "usdc")!;
    assert.ok(ridge.x > 900 * 0.6, "ridge holdings sit on the right");
    assert.ok(summit.y > 620 * 0.7, "summit holdings sit at the bottom");
    for (let a = 0; a < hills.length; a += 1) {
      for (let b = a + 1; b < hills.length; b += 1) {
        const gap = Math.hypot(hills[a]!.x - hills[b]!.x, hills[a]!.y - hills[b]!.y);
        assert.ok(gap > 0.7 * (hills[a]!.sigma + hills[b]!.sigma), `${hills[a]!.holding.id}/${hills[b]!.holding.id} apart`);
      }
    }
    assert.equal(hills.find((hill) => hill.holding.id === "fart")!.sign, -1, "a short is a basin");
  });

  it("is deterministic and draws basins only for shorts", () => {
    const a = buildRelief(SAMPLE);
    const b = buildRelief(SAMPLE);
    assert.deepEqual(
      a.contours.map((c) => c.d),
      b.contours.map((c) => c.d),
    );
    assert.ok(a.contours.some((c) => c.basin), "the short draws basin rings");
    assert.ok(a.contours.some((c) => c.index), "index contours exist");
    assert.ok(a.hachures.length > 0, "leveraged hills get cliffs");
    assert.equal(a.regions.length, 3);
    const longsOnly = buildRelief(SAMPLE.filter((h) => h.side !== "short"));
    assert.equal(longsOnly.contours.filter((c) => c.basin).length, 0);
    assert.notEqual(reliefKey(SAMPLE), reliefKey(SAMPLE.slice(1)));
  });

  it("stays fast for thirty holdings", () => {
    const random = seededRandom(3);
    const many: ReliefHolding[] = Array.from({ length: 30 }, (_, i) => ({
      id: `h${i}`,
      symbol: `T${i}`,
      usd: 200 + random() * 9000,
      layer: (["floor", "ridge", "summit"] as const)[i % 3]!,
      side: i % 7 === 0 ? "short" : "long",
      leverage: 1 + (i % 4),
    }));
    const started = performance.now();
    const model = buildRelief(many);
    const elapsed = performance.now() - started;
    assert.ok(model.contours.length > 20);
    assert.ok(elapsed < 600, `built in ${elapsed.toFixed(0)} ms`);
  });
});

describe("elevation profile", () => {
  const series = [100, 120, 110, 90, 130, 125].map((value, index) => ({ t: index * 1000, value }));

  it("finds the all-time high and the maximum drawdown", () => {
    assert.equal(athIndex(series.map((p) => p.value)), 4);
    const dd = maxDrawdown(series.map((p) => p.value));
    assert.equal(dd.peakIndex, 1);
    assert.equal(dd.troughIndex, 3);
    assert.ok(Math.abs(dd.fraction - 0.25) < 1e-12);
    assert.equal(maxDrawdown([1, 2, 3]).fraction, 0);
  });

  it("maps the summit flag and valley marker onto the line and keeps the axis in its gutter", () => {
    const model = profileModel(series, [{ t: 2000, label: "CAMP I" }], { width: 400, height: 160, gutter: 50 });
    assert.equal(model.summit!.index, 4);
    assert.equal(model.valley!.index, 3);
    assert.equal(model.valley!.peak.index, 1);
    assert.equal(model.camps.length, 1);
    assert.equal(model.camps[0]!.index, 2);
    assert.ok(model.points.every(([x]) => x >= 50), "the line starts right of the axis gutter");
    assert.ok(model.yTicks.length >= 2);
    const highest = Math.min(...model.points.map(([, y]) => y));
    assert.equal(model.summit!.y, highest, "the summit is the highest point drawn");
  });
});

describe("rope", () => {
  it("orders a long from crevasse to flag with price rising", () => {
    const rope = ropeGeometry({ side: "long", entry: 100, mark: 110, liquidation: 80, stop: 95, takeProfit: 140 });
    assert.deepEqual(
      rope.markers.map((m) => m.kind),
      ["crevasse", "anchor", "entry", "climber", "flag"],
    );
    assert.ok(Math.abs(rope.distance! - 30 / 110) < 1e-12);
    assert.equal(rope.state, "safe");
    assert.equal(rope.openEnd, false);
  });

  it("orders a short the other way and measures its distance upward", () => {
    const rope = ropeGeometry({ side: "short", entry: 1.0, mark: 1.06, liquidation: 1.124, takeProfit: 0.8 });
    assert.deepEqual(
      rope.markers.map((m) => m.kind),
      ["crevasse", "climber", "entry", "flag"],
    );
    assert.ok(Math.abs(rope.distance! - 0.064 / 1.06) < 1e-12);
    assert.equal(rope.state, "fraying");
    assert.ok(rope.frays && !rope.pulses);
    assert.ok(rope.ends[0] > rope.ends[1], "short ropes run high price to low price");
  });

  it("handles missing TP and SL and an unroped spot holding", () => {
    const noTp = ropeGeometry({ side: "long", entry: 10, mark: 10, liquidation: 9.7 });
    assert.equal(noTp.openEnd, true);
    assert.equal(noTp.state, "critical");
    assert.ok(noTp.pulses);
    assert.ok(!noTp.markers.some((m) => m.kind === "flag" || m.kind === "anchor"));
    const spot = ropeGeometry({ side: "long", entry: 10, mark: 12 });
    assert.equal(spot.distance, null);
    assert.equal(spot.state, "unroped");
    assert.ok(!spot.markers.some((m) => m.kind === "crevasse"));
    assert.equal(ropeDistance("long", 10, 11), 0, "already past liquidation");
    assert.equal(ropeState(0.049), "critical");
    assert.equal(ropeState(0.099), "fraying");
  });
});

describe("shock", () => {
  const positions = [
    { id: "hype", symbol: "HYPE", side: "long" as const, size: 100, mark: 40, liquidation: 28, beta: 1 },
    { id: "eth", symbol: "ETH", side: "long" as const, size: 2, mark: 4000, liquidation: 3300, beta: 0.7 },
    { id: "fart", symbol: "FARTCOIN", side: "short" as const, size: 1000, mark: 1.06, liquidation: 1.124, beta: 1.5 },
  ];

  it("moves every position by beta x shock and sums PnL into net worth", () => {
    const result = applyShock(positions, 10_000, -0.2);
    const hype = result.positions[0]!;
    assert.ok(Math.abs(hype.mark - 32) < 1e-9);
    assert.ok(Math.abs(hype.pnl - -800) < 1e-9);
    const eth = result.positions[1]!;
    assert.ok(Math.abs(eth.mark - 4000 * 0.86) < 1e-9);
    const fart = result.positions[2]!;
    assert.ok(fart.pnl > 0, "a short gains when price falls");
    assert.ok(Math.abs(result.netWorth - (10_000 + result.pnl)) < 1e-9);
    assert.equal(result.snapped, 0);
  });

  it("snaps ropes that cross their liquidation price and raises the bulletin to 5", () => {
    const result = applyShock(positions, 10_000, 0.1);
    const fart = result.positions[2]!;
    assert.equal(fart.snapped, true, "a +15% move breaks the short");
    assert.equal(fart.after, 0);
    assert.equal(result.level, 5);
    assert.equal(clampShock(0.9), 0.3);
    assert.equal(clampShock(Number.NaN), 0);
  });

  it("returns the inputs unchanged with no shock", () => {
    const result = applyShock(positions, 5_000, 0);
    assert.equal(result.pnl, 0);
    assert.equal(result.netWorth, 5_000);
  });
});

describe("conditions", () => {
  it("maps funding to windsock stripes and the paid side", () => {
    assert.deepEqual(windsock(0), { stripes: 0, pays: "none", strength: 0, aprPct: 0 });
    assert.equal(windsock(0.11).stripes, 2);
    assert.equal(windsock(0.11).pays, "short", "positive funding: longs pay shorts");
    assert.equal(windsock(-0.05).pays, "long");
    assert.equal(windsock(-0.05).stripes, 1);
    assert.equal(windsock(2).stripes, 5);
    assert.equal(windsock(0.5).strength, 1);
    assert.equal(windsock(Number.NaN).stripes, 0);
  });

  it("maps volatility percentiles to weather", () => {
    assert.equal(weatherFromPercentile(10), "clear");
    assert.equal(weatherFromPercentile(50), "few");
    assert.equal(weatherFromPercentile(80), "overcast");
    assert.equal(weatherFromPercentile(95), "storm");
    assert.equal(percentileRank(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 45);
    assert.equal(weatherFromVolatility(100, [1, 2, 3]), "storm");
    assert.equal(weatherFromVolatility(0.5, [1, 2, 3]), "clear");
  });

  it("maps ropes to avalanche levels", () => {
    assert.equal(avalancheLevel({ minDistance: null }), 1);
    assert.equal(avalancheLevel({ minDistance: 0.6 }), 1);
    assert.equal(avalancheLevel({ minDistance: 0.33 }), 2);
    assert.equal(avalancheLevel({ minDistance: 0.06 }), 4);
    assert.equal(avalancheLevel({ minDistance: 0.19 }), 3);
    assert.equal(avalancheLevel({ minDistance: 0.19, concentration: 0.8 }), 4);
    assert.equal(avalancheLevel({ minDistance: 0.02 }), 5);
    assert.equal(avalancheLevel({ minDistance: 0.9, snapped: 1 }), 5);
  });

  it("grades moves and picks the blaze", () => {
    assert.equal(gradeFor({ kind: "swap" }), 2);
    assert.equal(gradeFor({ kind: "stake" }), 1);
    assert.equal(gradeFor({ kind: "perp", leverage: 3 }), 3);
    assert.equal(gradeFor({ kind: "perp", leverage: 8 }), 4);
    assert.equal(gradeFor({ kind: "perp", leverage: 20 }), 5);
    assert.equal(gradeFor({ kind: "perp", leverage: 40 }), 6);
    assert.equal(gradeFor({ kind: "swap", unverified: true }), 5);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((g) => blazeFor(g as 1)), ["yellow", "yellow", "red", "red", "blue", "blue"]);
    assert.equal(conditionFromScore(90), "open");
    assert.equal(conditionFromScore(50), "caution");
    assert.equal(conditionFromScore(10), "closed");
    assert.equal(conditionFromScore(null), "caution");
  });
});

describe("altimeter", () => {
  it("rolls only the digits that changed, aligned from the right", () => {
    const cells = digitDiff("$48,213", "$48,219");
    assert.deepEqual(
      cells.filter((c) => c.changed).map((c) => c.char),
      ["9"],
    );
    assert.equal(cells.find((c) => c.changed)!.direction, "up");
    assert.equal(rolledDigits("18,514,484", "18,514,491"), 2);
    assert.equal(rolledDigits(null, "123"), 0, "the first value never rolls");
    assert.equal(rolledDigits("999", "1,000"), 4, "a longer number rolls every digit that moved");
    assert.equal(digitDiff("5.00", "4.99").find((c) => c.changed)!.direction, "down");
    assert.deepEqual(
      digitDiff("12", "13").map((c) => c.key),
      ["r2", "r1"],
    );
  });
});

describe("barograph scheduler", () => {
  const options = { pxPerMs: 0.05, width: 400 };

  it("places one tick per block at its arrival time and grows with transactions", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({ number: 100 + i, at: 1000 + i * 114, txCount: i }));
    const ticks = visibleTicks(blocks, 1000 + 9 * 114, 1000, options);
    assert.equal(ticks.length, 10);
    assert.ok(Math.abs(ticks[1]!.x - ticks[0]!.x - 114 * 0.05) < 1e-9, "spacing follows the real cadence");
    assert.ok(tickAmplitude(0) > 0 && tickAmplitude(10) > tickAmplitude(1) && tickAmplitude(1e9) === 1);
    assert.ok(Math.abs(cadenceMs(blocks)! - 114) < 1e-9);
    assert.equal(cadenceMs(blocks.slice(0, 2)), null);
  });

  it("keeps now at the right edge and drops ticks that left the window", () => {
    const now = 20_000;
    assert.equal(stripOffset(now, 0, options) + tickX(now, 0, options.pxPerMs), options.width);
    const blocks = [
      { number: 1, at: 0, txCount: 1 },
      { number: 2, at: 19_900, txCount: 1 },
    ];
    assert.deepEqual(
      visibleTicks(blocks, now, 0, options).map((t) => t.number),
      [2],
    );
    assert.equal(shouldRebase(now, 0, options.pxPerMs, 500), true);
    assert.equal(shouldRebase(now, 19_000, options.pxPerMs, 500), false);
    assert.ok(tracePath([{ number: 1, x: 10, amplitude: 0.5 }], 30, 20).startsWith("M4,30"));
    assert.equal(tracePath([], 30, 20), "");
  });
});

describe("route card", () => {
  it("climbs from the floor to the summit across steps", () => {
    const profile = routeProfile(
      [
        { layer: "floor", toLayer: "ridge" },
        { layer: "ridge" },
        { layer: "ridge", toLayer: "summit" },
      ],
      300,
      120,
    );
    assert.equal(profile.waypoints.length, 3);
    assert.ok(profile.bands.summit < profile.bands.ridge && profile.bands.ridge < profile.bands.floor, "summit is drawn highest");
    assert.ok(profile.waypoints[2]!.y < profile.waypoints[0]!.y, "the last waypoint is higher than the first");
    assert.ok(profile.d.startsWith("M14,"));
    assert.equal(bladePath(100, 20), "M0,0H90L100,10L90,20H0Z");
  });
});
