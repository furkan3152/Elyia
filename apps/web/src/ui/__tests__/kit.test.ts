import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exceedsMax, fromScaled, percentOf, sanitizeDecimalInput, toScaled } from "../numberInput";
import { sparkBars, sparkGeometry } from "../sparkline";
import { compareSortValues, nextSort, sortRows } from "../table/sortRows";
import { signTone } from "../tones";
import { createToastRecord, DEFAULT_TOAST_DURATION, upsertToast } from "../toast";

describe("NumberInput rules", () => {
  it("sanitises typing and pasting without floats", () => {
    assert.equal(sanitizeDecimalInput("1,234.5678", 2), "1234.56");
    assert.equal(sanitizeDecimalInput("1,5"), "1.5");
    assert.equal(sanitizeDecimalInput("1,234"), "1234");
    assert.equal(sanitizeDecimalInput(" 0007.10 "), "7.10");
    assert.equal(sanitizeDecimalInput(".5"), "0.5");
    assert.equal(sanitizeDecimalInput("12."), "12.");
    assert.equal(sanitizeDecimalInput(""), "");
    assert.equal(sanitizeDecimalInput("-1"), null);
    assert.equal(sanitizeDecimalInput("1e5"), null);
    assert.equal(sanitizeDecimalInput("1.2.3"), null);
    assert.equal(sanitizeDecimalInput("5.123", 0), "5.");
  });

  it("computes presets exactly", () => {
    assert.equal(percentOf("1.5", 50, 6), "0.75");
    assert.equal(percentOf("0.000003", 33, 6), "0");
    assert.equal(percentOf("1250.5", 25, 6), "312.625");
    assert.equal(percentOf("100", 100, 6), "100");
    assert.equal(percentOf("100", 101, 6), null);
    assert.equal(percentOf("abc", 50, 6), null);
    assert.equal(toScaled("1.23", 6), 1_230_000n);
    assert.equal(fromScaled(1_230_000n, 6), "1.23");
    assert.equal(fromScaled(-5n, 2), "-0.05");
  });

  it("detects an amount above max", () => {
    assert.equal(exceedsMax("1.0000001", "1", 6), false, "compared at the field's decimals");
    assert.equal(exceedsMax("1.000001", "1", 6), true);
    assert.equal(exceedsMax("", "1", 6), false);
  });
});

describe("Sparkline geometry", () => {
  it("maps a series into the box and closes the area", () => {
    const g = sparkGeometry([0, 10], 100, 20, 0);
    assert.equal(g.line, "M0 20 L100 0");
    assert.equal(g.area, "M0 20 L100 0 L100 20 L0 20 Z");
    assert.equal(sparkGeometry([5, 5, 5], 100, 20, 0).points[0]!.y, 10, "a flat series is centred");
    assert.equal(sparkGeometry([1], 100, 20).line, "");
    assert.equal(sparkGeometry([1, Number.NaN, 3], 100, 20).points.length, 2);
  });

  it("scales bars to the max with gaps", () => {
    const bars = sparkBars([50, 100], 102, 40, { gap: 2 });
    assert.equal(bars.length, 2);
    assert.equal(bars[0]!.width, 50);
    assert.equal(bars[1]!.x, 52);
    assert.equal(bars[0]!.height, 20);
    assert.equal(bars[1]!.y, 0);
    assert.deepEqual(sparkBars([], 100, 40), []);
    const slotted = sparkBars([10, 20], 98, 40, { gap: 2, slots: 4 });
    assert.equal(slotted[0]!.width, 23);
    assert.equal(slotted[0]!.x, 50, "two of four slots: the bars sit on the right");
    assert.equal(sparkBars([1, 2, 3, 4, 5], 100, 40, { slots: 3 }).length, 3, "only the newest values that fit");
  });
});

describe("DataTable sorting", () => {
  const rows = [
    { id: "a", value: 3 as number | null },
    { id: "b", value: null },
    { id: "c", value: 10 },
    { id: "d", value: 3 },
  ];

  it("sorts stably and keeps unknown values last in both directions", () => {
    assert.deepEqual(sortRows(rows, (row) => row.value, "asc").map((row) => row.id), ["a", "d", "c", "b"]);
    assert.deepEqual(sortRows(rows, (row) => row.value, "desc").map((row) => row.id), ["c", "a", "d", "b"]);
  });

  it("compares strings with numeric collation and bigints exactly", () => {
    assert.ok(compareSortValues("ETH-2", "ETH-10") < 0);
    assert.ok(compareSortValues(2n ** 70n, 2n ** 69n) > 0);
  });

  it("starts a new column descending, then flips", () => {
    assert.deepEqual(nextSort(null, "size"), { columnId: "size", direction: "desc" });
    assert.deepEqual(nextSort({ columnId: "size", direction: "desc" }, "size"), { columnId: "size", direction: "asc" });
    assert.deepEqual(nextSort({ columnId: "size", direction: "asc" }, "pnl", "asc"), { columnId: "pnl", direction: "asc" });
  });
});

describe("tones and toasts", () => {
  it("colours signs", () => {
    assert.equal(signTone(1), "mint");
    assert.equal(signTone(-0.1), "rose");
    assert.equal(signTone(0), "neutral");
    assert.equal(signTone(null), "neutral");
  });

  it("builds and replaces toast records", () => {
    const record = createToastRecord({ title: "Copied", tone: "success" }, "t1");
    assert.equal(record.duration, DEFAULT_TOAST_DURATION.success);
    assert.equal(createToastRecord({ title: "x", duration: -5 }, "t2").duration, DEFAULT_TOAST_DURATION.info);
    const list = upsertToast([record], { ...record, title: "Copied again" });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.revision, 1);
  });
});
