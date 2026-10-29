import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCompact,
  formatDuration,
  formatFixed,
  formatLeverage,
  formatMs,
  formatPercent,
  formatRelativeTime,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
  shortAddress,
  shortHash,
} from "../dist/index.js";

test("USD: grouped, two decimals, truncated, never negative zero", () => {
  assert.equal(formatUsd("1234.567"), "$1,234.56");
  assert.equal(formatUsd(1234.5), "$1,234.50");
  assert.equal(formatUsd("-12.349"), "-$12.34");
  assert.equal(formatUsd("0.004"), "<$0.01");
  assert.equal(formatUsd("-0.004"), "-<$0.01");
  assert.equal(formatUsd("0"), "$0.00");
  assert.equal(formatUsd("-0.00"), "$0.00");
  assert.equal(formatUsd("1234567.89", { cents: false }), "$1,234,567");
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd("abc"), "—");
  assert.equal(formatUsd(Number.NaN), "—");
});

test("compact numbers and compact USD", () => {
  assert.equal(formatCompact("1234567"), "1.23M");
  assert.equal(formatCompact("999.5"), "999.5");
  assert.equal(formatCompact(1500), "1.5K");
  assert.equal(formatCompact("1000000000"), "1B");
  assert.equal(formatCompact("-2500000"), "-2.5M");
  assert.equal(formatCompact(12345678901234n), "12.34T");
  assert.equal(formatUsdCompact("116982885.15"), "$116.98M");
  assert.equal(formatUsdCompact("-950"), "-$950");
  assert.equal(formatUsdCompact(undefined), "—");
});

test("percent with sign, from fractions or percents", () => {
  assert.equal(formatPercent("0.0123"), "+1.23%");
  assert.equal(formatPercent(-0.0562182), "-5.62%");
  assert.equal(formatPercent("0.049"), "+4.90%");
  assert.equal(formatPercent("0"), "0.00%");
  assert.equal(formatPercent("1.5", { from: "percent" }), "+1.50%");
  assert.equal(formatPercent("0.0000125", { digits: 4 }), "+0.0012%");
  assert.equal(formatPercent("0.0045490562", { digits: 4 }), "+0.4549%", "a funding rate");
  assert.equal(formatPercent("0.25", { sign: false }), "25.00%");
  assert.equal(formatPercent(null), "—");
});

test("token amounts keep significant digits for small values", () => {
  assert.equal(formatTokenAmount("1234.56789"), "1,234");
  assert.equal(formatTokenAmount("1234.56789", { significant: 6 }), "1,234.56");
  assert.equal(formatTokenAmount("0.000012345"), "0.00001234");
  assert.equal(formatTokenAmount("0.5", { symbol: "HYPE" }), "0.5 HYPE");
  assert.equal(formatTokenAmount("0.000000000001"), "<0.00000001");
  assert.equal(formatTokenAmount("-2.5"), "-2.5");
  assert.equal(formatTokenAmount("0"), "0");
  assert.equal(formatFixed("1234.5678", 2), "1,234.56");
  assert.equal(formatFixed("-0.001", 2), "0.00");
  assert.equal(formatFixed("1234.5", 3, { grouping: false }), "1234.500");
});

test("addresses, hashes, durations, latency and leverage", () => {
  assert.equal(shortAddress("0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234"), "0xCD57…F234");
  assert.equal(shortAddress("not an address"), "not an address");
  assert.equal(shortHash(`0x${"ab".repeat(32)}`), "0xababab…abab");
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(125), "2m 5s");
  assert.equal(formatDuration(3720), "1h 2m");
  assert.equal(formatDuration(475200), "5d 12h");
  assert.equal(formatDuration(-1), "—");
  assert.equal(formatMs(114.6), "115 ms");
  assert.equal(formatMs(1450), "1.45 s");
  assert.equal(formatRelativeTime(Date.parse("2026-10-29T12:05:00Z"), Date.parse("2026-10-29T12:00:00Z")), "in 5m");
  assert.equal(formatRelativeTime(Date.parse("2026-10-29T09:00:00Z"), Date.parse("2026-10-29T12:00:00Z")), "3h ago");
  assert.equal(formatRelativeTime(1000, 2000), "now");
  assert.equal(formatLeverage(5), "5x");
  assert.equal(formatLeverage(2.5), "2.5x");
});
