import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAMP_HEIGHTS, campX, profileTop, PROFILE_H } from "../trailProfile";

describe("manual trail profile", () => {
  it("puts five camps at the centres of five equal columns, the Summit highest", () => {
    const w = 200;
    assert.deepEqual(CAMP_HEIGHTS.map((_, i) => campX(i, w)), [20, 60, 100, 140, 180]);
    const tops = CAMP_HEIGHTS.map((_, i) => profileTop(campX(i, w), w));
    assert.equal(Math.min(...tops), tops[3]);
    assert.ok(tops.every((t) => t > 0 && t < PROFILE_H));
  });
});
