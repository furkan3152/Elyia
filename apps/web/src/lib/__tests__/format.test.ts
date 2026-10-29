import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAgeMs, formatBlockNumber, formatChangeCompact, formatGas, formatGwei, formatMs, formatSignedChange, formatTps, formatUsd, shortAddress } from "../format";

describe("web format helpers", () => {
  it("formats block heights with grouping and rejects non-heights", () => {
    assert.equal(formatBlockNumber(18_431_206), "18,431,206");
    assert.equal(formatBlockNumber(0), "0");
    assert.equal(formatBlockNumber(null), "—");
    assert.equal(formatBlockNumber(-1), "—");
    assert.equal(formatBlockNumber(1.5), "—");
  });

  it("formats gas in gwei", () => {
    assert.equal(formatGwei(0.10007), "0.10 gwei");
    assert.equal(formatGwei(0.004), "0.0040 gwei");
    assert.equal(formatGwei(12.3, { unit: false }), "12.30");
    assert.equal(formatGwei(null), "—");
    assert.equal(formatGwei(Number.NaN), "—");
  });

  it("formats tx/s", () => {
    assert.equal(formatTps(9.14), "9.1");
    assert.equal(formatTps(140.6), "141");
    assert.equal(formatTps(undefined), "—");
  });

  it("formats ages in ms, then seconds, then minutes", () => {
    assert.equal(formatAgeMs(114.6), "115 ms");
    assert.equal(formatAgeMs(1_450), "1,450 ms");
    assert.equal(formatAgeMs(12_340), "12.3 s");
    assert.equal(formatAgeMs(125_000), "2m 5s");
    assert.equal(formatAgeMs(-20), "0 ms");
    assert.equal(formatAgeMs(null), "—");
  });

  it("formats gas used compactly", () => {
    assert.equal(formatGas("312000"), "312k");
    assert.equal(formatGas("58095"), "58k");
    assert.equal(formatGas("0"), "0");
    assert.equal(formatGas("1250000"), "1.3M");
    assert.equal(formatGas("abc"), "—");
  });

  it("formats signed changes with an arrow", () => {
    assert.equal(formatSignedChange(0.042), "▲ 4.20%");
    assert.equal(formatSignedChange(-0.023, 1), "▼ 2.3%");
    assert.equal(formatSignedChange(0), "0.00%");
    assert.equal(formatSignedChange(null), "—");
  });

  it("formats compact signed changes for tight labels", () => {
    assert.equal(formatChangeCompact(0.042), "+4.2%");
    assert.equal(formatChangeCompact(-0.023), "−2.3%");
    assert.equal(formatChangeCompact(0.0001), "0.0%");
    assert.equal(formatChangeCompact(undefined), "—");
  });

  it("re-exports the shared core helpers", () => {
    assert.equal(formatUsd("1234.567"), "$1,234.56");
    assert.equal(formatMs(114.6), "115 ms");
    assert.equal(shortAddress("0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234"), "0xCD57…F234");
  });
});
