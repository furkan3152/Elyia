import assert from "node:assert/strict";
import { test } from "node:test";

import { inlineStates, sameStates, useCardStates } from "../cardStates";

test("the inline card follows the panel's leg states", () => {
  assert.deepEqual(inlineStates(["settled", "next"], 2), ["settled", "next"]);
  assert.equal(inlineStates(undefined, 2), undefined, "no panel yet: the card's own defaults");
  assert.equal(inlineStates(["next"], 2), undefined, "a plan with another leg count does not line up");
});

test("a settled send shows settled inline, never Sign next", () => {
  // The panel's fresh plan may count legs differently from the dry-run card: settled is settled.
  assert.deepEqual(inlineStates(["settled"], 2), ["settled", "settled"]);
  assert.deepEqual(inlineStates(undefined, 1, "executed"), ["settled"]);
  assert.equal(inlineStates(undefined, 1, "approved"), undefined);
});

test("the panel publishes states under the turn id, once per change", () => {
  const { publish } = useCardStates.getState();
  publish("turn_a", ["next"]);
  const first = useCardStates.getState().byKey;
  publish("turn_a", ["next"]);
  assert.equal(useCardStates.getState().byKey, first, "same states: no store update");
  publish("turn_a", ["settled"]);
  assert.deepEqual(useCardStates.getState().byKey.turn_a, ["settled"]);
  assert.ok(sameStates(["next", "waiting"], ["next", "waiting"]));
  assert.ok(!sameStates(["next"], undefined));
});
