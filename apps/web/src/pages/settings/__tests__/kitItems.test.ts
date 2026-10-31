import assert from "node:assert/strict";
import { test } from "node:test";

import { ITEM } from "../parts/kitItems";

test("every locker item is an 11 x 11 glyph of kit palette keys", () => {
  for (const [name, rows] of Object.entries(ITEM)) {
    assert.equal(rows.length, 11, name);
    for (const row of rows) {
      assert.equal(row.length, 11, `${name}: ${row}`);
      assert.match(row, /^[.kywrbo]+$/u, name);
    }
  }
});
