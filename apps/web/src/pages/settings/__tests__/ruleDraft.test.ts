import assert from "node:assert/strict";
import { test } from "node:test";

import { draftChanged, loosenedBy, toDraft, toOverrides } from "../ruleDraft";

test("the default book round-trips through the form", () => {
  const draft = toDraft({});
  assert.equal(draft.paused, false);
  assert.equal(draftChanged({}, draft), false);
  const overrides = toOverrides({ ...draft, maxLeverage: "5", markets: "eth, btc", paused: true });
  assert.equal(overrides.maxLeverage, 5);
  assert.deepEqual(overrides.markets, ["ETH", "BTC"]);
  assert.equal(overrides.paused, true);
  assert.equal(toDraft(overrides).maxLeverage, "5");
});

test("tightening never asks; loosening is named", () => {
  const tight = { maxLeverage: 5, paused: true } as const;
  assert.deepEqual(loosenedBy({}, toDraft(tight)), []);
  const looser = loosenedBy(tight, { ...toDraft(tight), maxLeverage: "10", paused: false });
  assert.ok(looser.includes("higher leverage"));
  assert.ok(looser.includes("kill switch off"));
});

test("junk numbers are dropped, not saved", () => {
  const overrides = toOverrides({ ...toDraft({}), maxNotionalUsd: "abc", dailyLossUsd: "" });
  assert.equal(overrides.maxNotionalUsd, undefined);
  assert.equal(overrides.dailyLossUsd, undefined);
});
