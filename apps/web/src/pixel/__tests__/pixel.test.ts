import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ropeGeometry } from "../../topo/geometry/rope";
import { drawGrid, fitScale, fixedScale, type PixelSurface } from "../draw";
import { EYES, GEAR, INK, makeEly, mini, MOUTHS, outline, FURS, HORNS, ELY_W, ELY_H, type GearKind } from "../ely";
import { HERD_ART, HERD_SIZE, HERD_TRAIT_TABLE, herdMember, herdTraits, nextHerdId, rarityOfRank, TRAIT_KEYS } from "../herd";
import { paintProfile, profileColumns } from "../profile";
import { paintRope, ropeLayout } from "../rope";
import { drawScene, sceneAltitude, sceneModel, sceneProgress, type TextSurface } from "../scene";
import { drawElyState, ELY_STATES, STATE_H, STATE_W } from "../states";
import { landBand, LAND, layoutTerrain, SAMPLE_TERRAIN, snappedBy, terrainModel } from "../terrain";
import { createTicker, type TickerEnv } from "../ticker";
import { bandOf, contourMask, drawTopo, rngOf, shade, topoField } from "../topo";

/** A fake canvas that records pixels into a map (x,y -> colour). */
function surface(w: number, h: number) {
  const pixels = new Map<string, string>();
  const ctx: TextSurface & PixelSurface & { clearRect(x: number, y: number, w: number, h: number): void; pixels: Map<string, string> } = {
    fillStyle: "#000000",
    font: "",
    textBaseline: "top",
    pixels,
    fillRect(x, y, rw, rh) {
      for (let yy = Math.floor(y); yy < Math.floor(y + rh); yy += 1) {
        for (let xx = Math.floor(x); xx < Math.floor(x + rw); xx += 1) {
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) pixels.set(`${xx},${yy}`, String(ctx.fillStyle));
        }
      }
    },
    clearRect(x, y, rw, rh) {
      for (let yy = y; yy < y + rh; yy += 1) for (let xx = x; xx < x + rw; xx += 1) pixels.delete(`${xx},${yy}`);
    },
    fillText() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  return ctx;
}

const SYMMETRIC_GEAR: readonly GearKind[] = ["none", "lamp", "crown", "goggles", "bandana"];

describe("Ely sprite", () => {
  it("is 32 x 34", () => {
    const grid = makeEly();
    assert.equal(grid.length, ELY_H);
    for (const row of grid) assert.equal(row.length, ELY_W);
  });

  it("is mirror symmetric for every fur, horn, eye and mouth with symmetric gear", () => {
    for (const fur of Object.keys(FURS) as Array<keyof typeof FURS>) {
      for (const horn of Object.keys(HORNS) as Array<keyof typeof HORNS>) {
        for (const eye of EYES) {
          for (const mouth of MOUTHS) {
            for (const gear of SYMMETRIC_GEAR) {
              const grid = makeEly({ fur, horn, eye, mouth, gear });
              for (let y = 0; y < ELY_H; y += 1) {
                for (let x = 0; x < 16; x += 1) assert.equal(grid[y]![x], grid[y]![31 - x], `${fur}/${horn}/${eye}/${mouth}/${gear} at ${x},${y}`);
              }
            }
          }
        }
      }
    }
  });

  it("keeps the cap's brim and the rope knot on one side only (deliberate asymmetry)", () => {
    for (const gear of ["cap", "rope"] as const) {
      const grid = makeEly({ gear });
      let differences = 0;
      for (let y = 0; y < ELY_H; y += 1) for (let x = 0; x < 16; x += 1) if (grid[y]![x] !== grid[y]![31 - x]) differences += 1;
      assert.ok(differences > 0 && differences < 16, `${gear}: ${differences}`);
    }
  });

  it("is fully outlined: every colour pixel has coloured or ink neighbours inside the sheet", () => {
    for (const gear of GEAR) {
      const grid = makeEly({ gear });
      for (let y = 0; y < ELY_H; y += 1) {
        for (let x = 0; x < ELY_W; x += 1) {
          const c = grid[y]![x];
          if (!c || c === INK) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const n = grid[y + dy]?.[x + dx];
            if (n === undefined) continue;
            assert.notEqual(n, null, `${gear}: hole next to ${x},${y}`);
          }
        }
      }
    }
  });

  it("outline adds exactly the ink ring around a shape", () => {
    const grid = outline([
      [null, null, null],
      [null, "#FF0000", null],
      [null, null, null],
    ]);
    assert.deepEqual(grid, [
      [null, INK, null],
      [INK, "#FF0000", INK],
      [null, INK, null],
    ]);
  });

  it("mini halves the sprite", () => {
    const small = mini(makeEly());
    assert.equal(small.length, 17);
    assert.equal(small[0]!.length, 16);
  });

  it("drawGrid paints only coloured cells, scaled", () => {
    const ctx = surface(10, 10);
    drawGrid(ctx, [["#111111", null], [null, "#222222"]], 1, 1, 2);
    assert.equal(ctx.pixels.get("1,1"), "#111111");
    assert.equal(ctx.pixels.get("2,2"), "#111111");
    assert.equal(ctx.pixels.has("3,1"), false);
    assert.equal(ctx.pixels.get("4,4"), "#222222");
  });
});

describe("pixel scale", () => {
  it("lands on whole device pixels at any DPR", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const fixed = fixedScale(4, dpr);
      assert.equal(Number.isInteger(fixed.devicePerPixel), true);
      assert.ok(Math.abs(fixed.cssPerPixel * dpr - fixed.devicePerPixel) < 1e-9);
      const fit = fitScale(1152, 400, dpr);
      assert.equal(Number.isInteger(fit.devicePerPixel), true);
      assert.ok(fit.width * fit.devicePerPixel >= 1152 * dpr);
      assert.ok((fit.width - 1) * fit.devicePerPixel < 1152 * dpr);
    }
  });
});

describe("topo", () => {
  it("rngOf is deterministic and in [0, 1)", () => {
    const a = rngOf(42);
    const b = rngOf(42);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      assert.equal(v, b());
      assert.ok(v >= 0 && v < 1);
    }
  });

  it("shade darkens and lightens", () => {
    assert.equal(shade("#808080", -0.5), "#404040");
    assert.equal(shade("#000000", 0.5), "#808080");
  });

  it("bands a field into levels and marks contour pixels on band edges", () => {
    const field = topoField(40, 40, 7, [[20, 20, 1, 8]]);
    const levels = 5;
    assert.equal(bandOf(1, 1, levels), levels - 1);
    assert.equal(bandOf(0, 1, levels), 0);
    const mask = contourMask(field, levels);
    // a single hill: contour rings, centre is not an edge, corners are flat
    assert.equal(mask[20]![20], false);
    assert.ok(mask.flat().filter(Boolean).length > 20);
    const ctx = surface(40, 40);
    drawTopo(ctx, field, ["#000001", "#000002", "#000003", "#000004", "#000005"]);
    assert.equal(ctx.pixels.size, 1600);
    assert.equal(ctx.pixels.get("20,20"), "#000005");
  });
});

describe("terrain (height field from holdings)", () => {
  it("raises hills by value and sinks shorts into lakes", () => {
    const model = terrainModel(SAMPLE_TERRAIN, 200, 110, 0);
    const hype = model.peaks.find((peak) => peak.holding.id === "hype")!;
    const fart = model.peaks.find((peak) => peak.holding.id === "fart")!;
    assert.ok(model.field[hype.y]![hype.x]! > 0);
    assert.ok(model.field[fart.y]![fart.x]! < 0);
    assert.equal(fart.lake, true);
    assert.equal(model.tallest?.holding.id, "hype");
    assert.equal(model.snaps, 0);
  });

  it("bands land from shore to snow, with water below zero", () => {
    assert.equal(landBand(-1, 100), -1);
    assert.equal(landBand(0, 100), 0);
    assert.equal(landBand(99.9, 100), LAND.length - 1);
    assert.equal(landBand(1000, 100), LAND.length - 1);
  });

  it("snaps a long's rope when the shock exceeds it, a short's when the market rises", () => {
    const eth = SAMPLE_TERRAIN.find((holding) => holding.id === "eth")!;
    const fart = SAMPLE_TERRAIN.find((holding) => holding.id === "fart")!;
    assert.equal(snappedBy(eth, -18), false);
    assert.equal(snappedBy(eth, -19), true);
    assert.equal(snappedBy(fart, -30), false);
    assert.equal(snappedBy(fart, 6), true);
    const crash = terrainModel(SAMPLE_TERRAIN, 200, 110, -20);
    const peak = crash.peaks.find((p) => p.holding.id === "eth")!;
    assert.equal(peak.snapped, true);
    assert.ok(crash.field[peak.y]![peak.x]! < terrainModel(SAMPLE_TERRAIN, 200, 110, 0).field[peak.y]![peak.x]!);
    assert.ok(crash.netWorth < terrainModel(SAMPLE_TERRAIN, 200, 110, 0).netWorth);
  });

  it("lays out unplaced holdings inside the sheet, largest in the middle", () => {
    const holdings = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, label: `H${i}`, usd: 1000 * (12 - i) }));
    const positions = layoutTerrain(holdings);
    assert.deepEqual(positions[0], [0.5, 0.54]);
    for (const [x, y] of positions) assert.ok(x > 0.05 && x < 0.95 && y > 0.1 && y < 0.95, `${x},${y}`);
  });
});

describe("the herd", () => {
  it("is deterministic per number", () => {
    const a = herdMember(777);
    assert.deepEqual(a.traits, herdMember(777).traits);
    assert.equal(a.grid.length, HERD_ART);
    assert.ok(a.grid.every((row) => row.length === HERD_ART && row.every((cell) => typeof cell === "string")));
    assert.notDeepEqual(herdMember(778).traits, a.traits);
  });

  it("follows the trait weights across the herd", () => {
    const rock = herdTraits()
      .find((category) => category.key === "fur")!
      .options.find((option) => option.name === "Rock")!;
    assert.ok(Math.abs(rock.share - 0.22) < 0.03, `rock ${rock.share}`);
  });

  it("ranks by the rarity score, the 1/1s first", () => {
    const ranks = new Set<number>();
    for (let id = 1; id <= HERD_SIZE; id += 1) ranks.add(herdMember(id).rank);
    assert.equal(ranks.size, HERD_SIZE);
    assert.equal(rarityOfRank(1), "legendary");
    assert.equal(rarityOfRank(HERD_SIZE), "common");
    const member = herdMember(42);
    assert.equal(member.odds, member.traits.reduce((p, t) => p * t.share, 1));
    for (const key of TRAIT_KEYS) assert.ok(HERD_TRAIT_TABLE[key].length > 1);
  });

  it("walks the herd without leaving 1..3333", () => {
    let id = 777;
    for (let i = 0; i < 500; i += 1) {
      id = nextHerdId(id);
      assert.ok(id >= 1 && id <= HERD_SIZE);
    }
  });
});

describe("shared ticker", () => {
  function env(overrides: Partial<{ hidden: boolean; reduced: boolean }> = {}) {
    const state = { hidden: false, reduced: false, time: 0, queue: new Map<number, (time: number) => void>(), next: 1, ...overrides };
    const e: TickerEnv = {
      now: () => state.time,
      requestFrame: (callback) => {
        const id = state.next++;
        state.queue.set(id, callback);
        return id;
      },
      cancelFrame: (id) => {
        state.queue.delete(id);
      },
      hidden: () => state.hidden,
      reduced: () => state.reduced,
    };
    const flush = (ms = 50) => {
      state.time += ms;
      const callbacks = [...state.queue.values()];
      state.queue.clear();
      for (const callback of callbacks) callback(state.time);
    };
    return { state, env: e, flush };
  }

  it("runs one loop for many subscribers", () => {
    const { env: e, state, flush } = env();
    const ticker = createTicker(e);
    let a = 0;
    let b = 0;
    ticker.subscribe(() => (a += 1));
    ticker.subscribe(() => (b += 1));
    assert.equal(state.queue.size, 1);
    flush();
    flush();
    assert.equal(a, 2);
    assert.equal(b, 2);
    assert.equal(state.queue.size, 1);
  });

  it("pauses when the tab is hidden and resumes on refresh", () => {
    const { env: e, state, flush } = env();
    const ticker = createTicker(e);
    let calls = 0;
    ticker.subscribe(() => (calls += 1));
    state.hidden = true;
    ticker.refresh();
    assert.equal(ticker.running(), false);
    flush();
    assert.equal(calls, 0);
    state.hidden = false;
    ticker.refresh();
    flush();
    assert.equal(calls, 1);
  });

  it("stops under reduced motion", () => {
    const { env: e, state } = env({ reduced: true });
    const ticker = createTicker(e);
    ticker.subscribe(() => undefined);
    assert.equal(ticker.running(), false);
    assert.equal(state.queue.size, 0);
  });

  it("pauses subscribers that are off screen, and stops when none is on screen", () => {
    const { env: e, flush } = env();
    const ticker = createTicker(e);
    let on = 0;
    let off = 0;
    const visible = ticker.subscribe(() => (on += 1));
    const hidden = ticker.subscribe(() => (off += 1));
    hidden.setVisible(false);
    flush();
    assert.deepEqual([on, off], [1, 0]);
    visible.setVisible(false);
    assert.equal(ticker.running(), false);
    assert.equal(ticker.activeCount(), 0);
    visible.remove();
    hidden.remove();
  });

  it("caps each subscriber's frame rate", () => {
    const { env: e, flush } = env();
    const ticker = createTicker(e);
    let calls = 0;
    ticker.subscribe(() => (calls += 1), { fps: 10 });
    for (let i = 0; i < 10; i += 1) flush(16);
    assert.ok(calls >= 1 && calls <= 2, `${calls}`);
  });
});

describe("drawn pieces", () => {
  it("every Ely state paints inside its 40 x 44 canvas, still and live", () => {
    for (const state of ELY_STATES) {
      for (const still of [true, false]) {
        const ctx = surface(STATE_W, STATE_H);
        drawElyState(ctx, { state, seconds: 3.3, still });
        assert.ok(ctx.pixels.size > 300, `${state} ${still}`);
      }
    }
  });

  it("the scene climbs, arrives, and shows the end state when still", () => {
    assert.equal(sceneProgress(0, 18).arrived, false);
    assert.equal(sceneProgress(17, 18).arrived, true);
    assert.equal(sceneAltitude(1), 4810);
    const model = sceneModel(384);
    for (let i = 1; i < model.trail.length; i += 1) assert.ok(model.trail[i]![0] > model.trail[0]![0] - 20);
    const ctx = surface(384, 200);
    const progress = drawScene(ctx, model, { seconds: 0, still: true, baro: [3, 4, 5] });
    assert.equal(progress.arrived, true);
    assert.equal(ctx.pixels.size, 384 * 200);
  });

  it("the profile flags the all-time high and floods the worst drawdown", () => {
    const values = [10, 12, 15, 11, 9, 13, 18, 17];
    const model = profileColumns(values, 80, 40);
    assert.equal(model.tops.length, 80);
    assert.equal(model.athColumn, Math.round((6 / 7) * 79));
    assert.ok(model.valley);
    assert.equal(model.valley!.from, Math.round((2 / 7) * 79));
    assert.equal(model.valley!.to, Math.round((4 / 7) * 79));
    for (const top of model.tops) assert.equal(top % 2, 0);
    const ctx = surface(80, 40);
    paintProfile(ctx, model, { sky: "#FFFFFF" });
    assert.equal(ctx.pixels.size, 3200);
  });

  it("the rope frays under 10% and the climber sits on the mark", () => {
    const calm = ropeGeometry({ side: "long", entry: 3950, mark: 4072, liquidation: 3298, stop: 3600, takeProfit: 4600 });
    const fraying = ropeGeometry({ side: "long", entry: 100, mark: 100, liquidation: 93 });
    assert.equal(calm.frays, false);
    assert.equal(fraying.frays, true);
    const layout = ropeLayout(200, false);
    const ctx = surface(200, layout.h);
    paintRope(ctx, calm, layout);
    assert.ok(ctx.pixels.size > 100);
  });
});

describe("barograph ticks", () => {
  it("fills with a sample until live blocks arrive, then follows them", async () => {
    const { TickStore } = await import("../blockTicks");
    const store = new TickStore({ capacity: 10, cadenceMs: 100, staleAfterMs: 1000 });
    assert.equal(store.ticks.length, 10);
    assert.equal(store.isLive(0), false);
    const before = store.version;
    store.advance(0);
    store.advance(450);
    assert.ok(store.version - before >= 4);
    store.live({ number: 7, txCount: 31 }, 500);
    assert.equal(store.isLive(900), true);
    assert.equal(store.lastBlock, 7);
    const v = store.version;
    store.advance(900);
    assert.equal(store.version, v, "no sample ticks while live");
    assert.equal(store.isLive(1600), false);
    assert.equal(store.ticks.length, 10);
  });
});

describe("terrain labels", () => {
  it("never stacks two labels when there is room", async () => {
    const { placeLabels, labelBox } = await import("../terrain");
    const spots = [
      { x: 100, y: 100, w: 90, h: 24 },
      { x: 110, y: 104, w: 90, h: 24 },
      { x: 96, y: 110, w: 90, h: 24 },
    ];
    const placements = placeLabels(spots, 400, 300);
    const boxes = spots.map((spot, i) => labelBox(spot, placements[i]!));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${i} and ${j} overlap`);
      }
    }
    assert.equal(placements[0], "right-up");
  });
});

describe("final QA: NIGHT treatments and phone labels", () => {
  it("clamps labels onto a narrow map and still keeps them apart", async () => {
    const { placeLabels, labelBox, LABEL_MARGIN } = await import("../terrain");
    const width = 330;
    const spots = [
      { x: 300, y: 120, w: 130, h: 24 },
      { x: 250, y: 124, w: 70, h: 24 },
      { x: 20, y: 160, w: 120, h: 24 },
    ];
    const placements = placeLabels(spots, width, 200);
    const boxes = spots.map((spot, i) => {
      const raw = labelBox(spot, placements[i]!);
      const x0 = Math.max(LABEL_MARGIN, Math.min(width - spot.w - LABEL_MARGIN, raw.x0));
      return { ...raw, x0, x1: x0 + spot.w };
    });
    for (const box of boxes) assert.ok(box.x0 >= LABEL_MARGIN && box.x1 <= width - LABEL_MARGIN, "label stays on the map");
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${i} and ${j} overlap`);
      }
    }
  });

  it("rims sprites with the NIGHT halo only inside withSpriteHalo", async () => {
    const { NIGHT_HALO, withSpriteHalo } = await import("../draw");
    const grid = [
      [null, null, null],
      [null, INK, null],
      [null, null, null],
    ];
    const day = surface(3, 3);
    drawGrid(day, grid, 0, 0, 1);
    assert.equal(day.pixels.size, 1, "DAY: the sprite alone");
    const night = surface(3, 3);
    withSpriteHalo(NIGHT_HALO, () => drawGrid(night, grid, 0, 0, 1));
    assert.equal(night.pixels.get("1,1"), INK, "the outline stays ink");
    for (const key of ["0,1", "2,1", "1,0", "1,2"]) assert.equal(night.pixels.get(key), NIGHT_HALO, `rim at ${key}`);
    assert.equal(night.pixels.get("0,0"), undefined, "4-neighbour rim, corners clear");
    const after = surface(3, 3);
    drawGrid(after, grid, 0, 0, 1);
    assert.equal(after.pixels.size, 1, "the rim does not leak past the call");
  });

  it("paints NIGHT land from the NIGHT bands", async () => {
    const { NIGHT_TERRAIN, LAND_NIGHT, paintTerrain } = await import("../terrain");
    const model = terrainModel(SAMPLE_TERRAIN, 60, 33, 0);
    const ctx = surface(60, 33);
    paintTerrain(ctx, model, 0, NIGHT_TERRAIN);
    const used = new Set(ctx.pixels.values());
    for (const day of LAND) assert.ok(!used.has(day), `no DAY band ${day} on the NIGHT map`);
    assert.ok([...used].some((c) => (LAND_NIGHT as readonly string[]).includes(c)), "NIGHT bands drawn");
  });
});
