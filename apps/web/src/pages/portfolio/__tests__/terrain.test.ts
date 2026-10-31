import assert from "node:assert/strict";
import { test } from "node:test";

import { terrainModel } from "../../../pixel/terrain";
import { certificateNumber, paintCertificate, CERT_H, CERT_W } from "../parts/certificate";
import { paintJobGlyph, GLYPH_H, GLYPH_W } from "../parts/jobGlyphs";
import { DAY_SHEET } from "../parts/sheetColors";
import { exposureFold, MAP_UNITS, reliefPlan, sortRopes, summitFacts, equitySeries } from "../range/model";
import { frayingRope } from "../range/ropes";
import { sampleHistory, sampleRopes, sampleSnapshot } from "../range/sample";
import { peakDollars, peakLabel, regionLayout, shockDrivers, terrainHoldings } from "../range/terrainPlan";

const NOW = Date.UTC(2026, 9, 31, 12);

/** A canvas stand-in that records the pixels painted and fails on anything off the sheet. */
function recorder(w: number, h: number) {
  const painted = new Set<string>();
  let tx = 0;
  let ty = 0;
  const stack: [number, number][] = [];
  const ctx = {
    fillStyle: "",
    font: "",
    textBaseline: "alphabetic",
    imageSmoothingEnabled: false,
    fillRect(x: number, y: number, rw: number, rh: number) {
      for (let px = 0; px < rw; px += 1) for (let py = 0; py < rh; py += 1) painted.add(`${x + tx + px},${y + ty + py}`);
    },
    clearRect() {},
    fillText() {},
    drawImage() {},
    save() {
      stack.push([tx, ty]);
    },
    restore() {
      [tx, ty] = stack.pop() ?? [0, 0];
    },
    translate(x: number, y: number) {
      tx += x;
      ty += y;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted, w, h };
}

test("peak labels stay short and keep the leverage", () => {
  assert.equal(peakLabel("HYPERLIQUIDITY PROVIDER"), "HYPERLIQUIDIT…");
  assert.equal(peakLabel("SOL", 3), "SOL 3×");
  assert.equal(peakLabel("USDC margin · VNTLS"), "USDC margin");
  assert.equal(peakLabel("ETH", 1), "ETH");
});

test("region layout keeps every hill inside its layer's third", () => {
  const layers = ["floor", "floor", "floor", "floor", "ridge", "summit", "summit", "floor", "ridge"] as const;
  regionLayout(layers).forEach(([x, y], index) => {
    const column = ["floor", "ridge", "summit"].indexOf(layers[index]!);
    assert.ok(x > column / 3 && x < (column + 1) / 3, `${layers[index]} at x ${x}`);
    assert.ok(y >= 0.2 && y <= 0.9);
  });
  // the largest hill of a layer stands in the middle of its third
  assert.deepEqual(regionLayout(["ridge"])[0], [0.5, 0.56]);
});

test("terrain holdings: square-root heights, exact dollars, and the shock moves only its market", () => {
  const snapshot = sampleSnapshot(NOW);
  const ropes = sampleRopes();
  const plan = reliefPlan(snapshot, { ropes, cap: 14 });
  const whole = terrainHoldings(plan, ropes, null);
  assert.ok(whole.length > 0 && whole.length <= 12);
  assert.equal(Math.max(...whole.map((holding) => holding.usd)), MAP_UNITS);
  for (const holding of whole) {
    const exact = plan.exactUsd.get(holding.id)!;
    assert.equal(holding.exactUsd, exact);
    // a hill a quarter the value of the largest stands half as tall
    assert.ok(holding.usd >= Math.round(Math.sqrt(holding.usd / MAP_UNITS) ** 2 * MAP_UNITS) - 1);
  }
  const usdc = whole.find((holding) => holding.label.startsWith("USDC"));
  assert.equal(usdc?.stable, true, "cash never moves");
  const eth = whole.find((holding) => holding.label.startsWith("ETH"))!;
  assert.equal(eth.stable, false);
  assert.ok(typeof eth.rope === "number" && eth.rope > 0);
  // shock only HYPE: ETH becomes stable and loses its rope
  const hypeOnly = terrainHoldings(plan, ropes, "HYPE");
  const ethAfter = hypeOnly.find((holding) => holding.id === eth.id)!;
  assert.equal(ethAfter.stable, true);
  assert.equal(ethAfter.rope, null);
  assert.ok(hypeOnly.some((holding) => holding.underlying === "HYPE" && !holding.stable));
  // cap
  assert.equal(terrainHoldings(plan, ropes, null, 3).length, 3);
});

test("peak dollars follow the shock and print 0 once a rope snaps", () => {
  const snapshot = sampleSnapshot(NOW);
  const ropes = sampleRopes();
  const holdings = terrainHoldings(reliefPlan(snapshot, { ropes }), ropes, null);
  const eth = holdings.find((holding) => holding.label.startsWith("ETH"))!;
  assert.equal(peakDollars(eth, 0), eth.exactUsd);
  assert.ok(Math.abs(peakDollars(eth, -10) - eth.exactUsd * 0.9) < 1e-6);
  assert.equal(peakDollars(eth, -(eth.rope as number) - 1), 0);
  const usdc = holdings.find((holding) => holding.stable)!;
  assert.equal(peakDollars(usdc, -30), usdc.exactUsd);
});

test("dry ground never floods: every lake is a short or a snapped rope", () => {
  const snapshot = sampleSnapshot(NOW);
  const ropes = sampleRopes();
  const holdings = terrainHoldings(reliefPlan(snapshot, { ropes }), ropes, null).filter((holding) => holding.side !== "short");
  const dry = terrainModel(holdings, 80, 40, 0, { ground: "dry" });
  assert.ok(dry.field.every((row) => row.every((v) => v >= 0)));
  // a stable short is a still lake: the shock does not deepen it
  const short = [{ id: "s", label: "S", usd: 100, side: "short" as const, stable: true, x: 0.5, y: 0.5 }];
  const a = terrainModel(short, 20, 10, 0, { ground: "dry" });
  const b = terrainModel(short, 20, 10, 20, { ground: "dry" });
  assert.equal(a.field[5]![10], b.field[5]![10]);
});

test("shock drivers: largest exposures first, then roped coins, at most five", () => {
  const snapshot = sampleSnapshot(NOW);
  const drivers = shockDrivers(exposureFold(snapshot).rows, sortRopes(sampleRopes()));
  assert.ok(drivers.length <= 5);
  assert.equal(drivers[0], "HYPE");
  assert.equal(new Set(drivers).size, drivers.length);
});

test("the fraying rope is the nearest one under 10%", () => {
  const ropes = sampleRopes();
  const fraying = frayingRope(ropes);
  assert.equal(fraying?.coin, "FARTCOIN");
  assert.equal(frayingRope(ropes.filter((rope) => rope.coin !== "FARTCOIN")), null);
});

test("certificate: a stable number and every pixel on the card", () => {
  assert.equal(certificateNumber("0xabc"), certificateNumber("0xabc"));
  assert.notEqual(certificateNumber("0xabc"), certificateNumber("0xabd"));
  assert.match(certificateNumber("0xdc0054d9962fb4adf760f669dc3e02c07aa5af95"), /^[0-9A-Z]{6}$/u);
  const series = equitySeries(sampleHistory(NOW), "month");
  const surface = recorder(CERT_W, CERT_H);
  paintCertificate(surface.ctx, { number: "ABC123", address: "0xdc0054d9962fb4adf760f669dc3e02c07aa5af95", facts: summitFacts(series), values: series.map((p) => p.value), rangeWord: "30-day", ropes: 2, mode: "testnet", sample: true }, DAY_SHEET, 1, false);
  for (const key of surface.painted) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    assert.ok(x >= 0 && x < CERT_W && y >= 0 && y < CERT_H, `pixel ${key} off the card`);
  }
  // the card is filled edge to edge except the stepped corner pixels
  assert.ok(surface.painted.has(`${CERT_W - 2},0`));
  assert.ok(!surface.painted.has("0,0"));
});

test("job glyphs draw inside their 48 x 24 sheet in every state", () => {
  const inputs = [
    { kind: "rebalance" as const, shares: [{ layer: "floor" as const, share: 0.6, target: 1 / 3 }, { layer: "ridge" as const, share: 0.1, target: 1 / 3 }, { layer: "summit" as const, share: 0.3, target: 1 / 3 }] },
    { kind: "dust" as const, specks: 0 },
    { kind: "dust" as const, specks: 20 },
    { kind: "gas" as const, tanks: [{ layer: "floor" as const, level: null }, { layer: "ridge" as const, level: 0.1 }, { layer: "summit" as const, level: 1 }] },
    { kind: "descent" as const, walkers: 0 },
    { kind: "descent" as const, walkers: 7 },
  ];
  for (const input of inputs) {
    for (const still of [true, false]) {
      const surface = recorder(GLYPH_W, GLYPH_H);
      paintJobGlyph(surface.ctx, input, DAY_SHEET, 3.3, still);
      assert.ok(surface.painted.size > 10, `${input.kind} paints`);
      for (const key of surface.painted) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        assert.ok(x >= 0 && x < GLYPH_W && y >= 0 && y < GLYPH_H, `${input.kind} pixel ${key}`);
      }
    }
  }
});
