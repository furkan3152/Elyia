import assert from "node:assert/strict";
import { test } from "node:test";

import { gradeOfLeverage, hatch, restingLevels, signTone, ticketGrade } from "../survey";

test("leverage climbs the route grades: T2 at 1x, T3 to 5x, T4 to 10x, T5 to 20x, T6 beyond", () => {
  assert.equal(gradeOfLeverage(1), 2);
  assert.equal(gradeOfLeverage(null), 2);
  assert.equal(gradeOfLeverage(3), 3);
  assert.equal(gradeOfLeverage(5), 3);
  assert.equal(gradeOfLeverage(10), 4);
  assert.equal(gradeOfLeverage(20), 5);
  assert.equal(gradeOfLeverage(40), 6);
  assert.equal(ticketGrade(true, 40), 1, "spot is a trail grade whatever the slider says");
  assert.equal(ticketGrade(false, 25), 6);
});

test("sign tones never colour a zero or an unknown", () => {
  assert.equal(signTone(1), "text-up");
  assert.equal(signTone(-0.2), "text-down");
  assert.equal(signTone(0), "text-ink");
  assert.equal(signTone(null), "text-ink");
  assert.equal(signTone(Number.NaN), "text-ink");
});

test("hatching is a diagonal repeating gradient in the sign colour", () => {
  const style = hatch("down", 0.3, 4);
  assert.match(String(style.backgroundImage), /^repeating-linear-gradient\(135deg, rgb\(var\(--down\) \/ 0\.3\)/u);
});

test("resting orders fold by price and side, nearest the mark first, capped", () => {
  const orders = [
    { oid: 1, side: "B" as const, limitPx: "100.0", sz: "1", isTrigger: false },
    { oid: 2, side: "B" as const, limitPx: "100", sz: "2.5", isTrigger: false },
    { oid: 3, side: "A" as const, limitPx: "100", sz: "1", isTrigger: false },
    { oid: 4, side: "B" as const, limitPx: "90", sz: "1", isTrigger: false },
    { oid: 5, side: "A" as const, limitPx: "130", sz: "1", isTrigger: false },
    { oid: 6, side: "A" as const, limitPx: "101", sz: "9", isTrigger: true },
  ];
  const levels = restingLevels(orders, 101, 3);
  assert.deepEqual(
    levels.map((level) => [level.buy ? "B" : "A", level.px, level.count, level.sz]),
    [
      ["B", 100, 2, 3.5],
      ["A", 100, 1, 1],
      ["B", 90, 1, 1],
    ],
  );
  assert.equal(levels[0]?.oid, 1, "the first order keys the line");
  assert.equal(restingLevels(orders, null, 10).length, 4, "triggers never become resting lines");
});
