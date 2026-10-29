import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitLyre, hitString, labelLayout, LYRE_BOX, stringLines, stringSpacing, toCanvas, yokeY } from "../geometry";
import { HUM_SCALE, INITIAL_STRING, isMoving, isSettled, MAX_ENERGY, pluckString, stepString, stringOffset, stringParams } from "../physics";

describe("lyre physics step", () => {
  const params = stringParams(0, 7, 0.5);

  it("decays a pluck exponentially at the damping rate", () => {
    const plucked = pluckString(INITIAL_STRING, 1);
    assert.equal(plucked.energy, 1);
    const after = stepString(plucked, 1000, params);
    assert.ok(Math.abs(after.energy - Math.exp(-params.damping)) < 1e-9);
    // Two half steps equal one full step (time-step independent).
    const halves = stepString(stepString(plucked, 500, params), 500, params);
    assert.ok(Math.abs(halves.energy - after.energy) < 1e-9);
  });

  it("settles to exactly zero and reports it", () => {
    let state = pluckString(INITIAL_STRING, 1);
    for (let i = 0; i < 400; i += 1) state = stepString(state, 16, params);
    assert.equal(state.energy, 0);
    assert.equal(isSettled([state]), true);
    assert.equal(isMoving([state], [stringParams(0, 7, 0)]), false);
    assert.equal(isMoving([state], [params]), true, "a humming string still moves");
  });

  it("caps energy on repeated plucks and restarts the phase", () => {
    let state = INITIAL_STRING;
    for (let i = 0; i < 10; i += 1) state = pluckString(stepString(state, 37, params), 1);
    assert.ok(state.energy <= MAX_ENERGY);
    assert.equal(state.phase, 0);
  });

  it("keeps the fixed ends still and bounds the hum", () => {
    const state = { energy: 1, phase: Math.PI / 2, humPhase: Math.PI / 2 };
    assert.equal(stringOffset(state, params, 0), 0);
    assert.ok(Math.abs(stringOffset(state, params, 1)) < 1e-12);
    assert.ok(Math.abs(stringOffset(state, params, 0.5) - (1 + HUM_SCALE * 0.5)) < 1e-12);
    const humOnly = { energy: 0, phase: 0, humPhase: Math.PI / 2 };
    assert.ok(Math.abs(stringOffset(humOnly, stringParams(0, 7, 1), 0.5)) <= HUM_SCALE + 1e-12);
  });

  it("gives neighbours different frequencies and volatile strings slower damping", () => {
    const frequencies = Array.from({ length: 7 }, (_, index) => stringParams(index, 7, 0.3).frequency);
    assert.equal(new Set(frequencies).size, 7);
    assert.ok(stringParams(0, 7, 1).damping < stringParams(0, 7, 0).damping);
    assert.equal(stringParams(0, 7, 4).amplitude, 1, "amplitude is clamped");
  });

  it("is deterministic and ignores negative time", () => {
    const plucked = pluckString(INITIAL_STRING, 0.8);
    assert.deepEqual(stepString(plucked, -50, params), { ...plucked, energy: plucked.energy });
  });
});

describe("lyre geometry", () => {
  it("spreads strings evenly under the yoke", () => {
    const lines = stringLines(7);
    assert.equal(lines.length, 7);
    assert.equal(lines[0]!.x, 176);
    assert.equal(lines[6]!.x, 464);
    assert.ok(lines[3]!.top < lines[0]!.top, "the middle string starts higher (the yoke arcs up)");
    assert.equal(stringLines(1)[0]!.x, 320);
    assert.deepEqual(stringLines(0), []);
  });

  it("follows the yoke curve and fits the visible box", () => {
    assert.equal(yokeY(120), 74);
    assert.equal(yokeY(320), 52);
    const fit = fitLyre(LYRE_BOX.width * 2 + 100, LYRE_BOX.height * 2);
    assert.equal(fit.scale, 2);
    assert.deepEqual(toCanvas(fit, LYRE_BOX.x, LYRE_BOX.y), { x: 50, y: 0 }, "the box origin lands at the centring offset");
    assert.equal(fitLyre(0, 300).scale, 0);
  });

  it("hit-tests the nearest string within tolerance", () => {
    const fit = fitLyre(LYRE_BOX.width, LYRE_BOX.height);
    const lines = stringLines(7);
    const first = toCanvas(fit, lines[0]!.x, 0).x;
    assert.equal(hitString(fit, lines, first + 2), 0);
    assert.equal(hitString(fit, lines, toCanvas(fit, 320, 0).x), 3);
    assert.equal(hitString(fit, lines, 2), -1);
  });

  it("staggers labels when strings are close", () => {
    const narrow = fitLyre(340, 250);
    assert.ok(stringSpacing(narrow, 7) < 58);
    assert.equal(labelLayout(stringSpacing(narrow, 7)).staggered, true);
    assert.equal(labelLayout(80).staggered, false);
    assert.equal(labelLayout(20).maxChars, 4);
    assert.equal(stringSpacing(narrow, 1), Number.POSITIVE_INFINITY);
  });
});
