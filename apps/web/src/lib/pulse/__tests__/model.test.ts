import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PulseBlock } from "@elyia/core/pulse";

import { appendBlock, computePulse, isStale, parsePulse, parsePulseBlock, rollingIntervals, STALE_AFTER_MS } from "../model";
import { hexToSafeNumber, isRateLimited, missingBlockNumbers, rpcBlockToPulseBlock, weiHexToGwei } from "../rpcBlock";

const HASH = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function block(number: number, seenAt: number, extra: Partial<PulseBlock> = {}): PulseBlock {
  return { network: "elysium-testnet", number, hash: HASH(number), timestamp: 1_793_283_554, txCount: 2, gasUsed: "58095", baseFeeGwei: 0.1, l1BlockNumber: 68_204_077, seenAt, ...extra };
}

describe("wire validation", () => {
  it("accepts the API's block and pulse shapes", () => {
    const wire = {
      network: "elysium-testnet",
      number: 18474656,
      hash: "0xde0d5530fbd46b231873abdee7a12660128b94e3e15440dc111c1d6b145dd812",
      timestamp: 1793283554,
      txCount: 2,
      gasUsed: "58095",
      baseFeeGwei: 0.10003,
      l1BlockNumber: 68204077,
      seenAt: 1793283554515,
    };
    assert.deepEqual(parsePulseBlock(wire), wire);
    const pulse = { network: "elysium-testnet", chainId: 99801, head: 18474648, blockTimeMs: 117.7, tps: 14.57, gasPriceGwei: 0.10007, gasPerSecond: 2946117, l1BlockNumber: 68204077, sampleBlocks: 14, updatedAt: 1793283554158, healthy: true };
    assert.deepEqual(parsePulse(pulse), pulse);
  });

  it("drops malformed events instead of passing them on", () => {
    assert.equal(parsePulseBlock(null), null);
    assert.equal(parsePulseBlock({ ...block(1, 1), network: "base" }), null);
    assert.equal(parsePulseBlock({ ...block(1, 1), hash: "0x12" }), null);
    assert.equal(parsePulseBlock({ ...block(1, 1), gasUsed: 58095 }), null);
    assert.equal(parsePulseBlock({ ...block(1, 1), number: -4 }), null);
    assert.equal(parsePulse({ network: "elysium-testnet", head: 1 }), null);
  });
});

describe("block buffer", () => {
  it("appends in order, ignores duplicates and caps the length", () => {
    let recent: readonly PulseBlock[] = [];
    for (let n = 1; n <= 5; n += 1) recent = appendBlock(recent, block(n, n * 100), 3).recent;
    assert.deepEqual(recent.map((b) => b.number), [3, 4, 5]);
    const duplicate = appendBlock(recent, block(5, 999), 3);
    assert.equal(duplicate.added, false);
    assert.equal(duplicate.recent, recent);
  });

  it("replaces a reorged height and drops what was above it", () => {
    const recent = [block(1, 1), block(2, 2), block(3, 3)];
    const result = appendBlock(recent, block(2, 9, { hash: HASH(0xbeef) }));
    assert.equal(result.added, true);
    assert.deepEqual(result.recent.map((b) => b.hash), [HASH(1), HASH(0xbeef)]);
  });

  it("inserts a late gap block in order and ignores blocks older than the window", () => {
    const recent = [block(10, 1), block(12, 3)];
    assert.deepEqual(appendBlock(recent, block(11, 2)).recent.map((b) => b.number), [10, 11, 12]);
    assert.equal(appendBlock(recent, block(3, 0)).added, false);
  });
});

describe("browser statistics", () => {
  it("computes the pulse on the wall clock like the API", () => {
    // 41 blocks, 115 ms apart, 2 txs each.
    const recent = Array.from({ length: 41 }, (_, index) => block(1_000 + index, 10_000 + index * 115));
    const pulse = computePulse(recent, { network: "elysium-testnet", chainId: 99801, now: 10_000 + 40 * 115 + 50 });
    assert.ok(pulse);
    assert.equal(pulse.head, 1_040);
    assert.equal(pulse.blockTimeMs, 115);
    assert.equal(pulse.sampleBlocks, 40);
    // 39 blocks after the first of the 40-block window, 2 txs each, over 39 * 115 ms.
    assert.ok(Math.abs(pulse.tps - (39 * 2) / ((39 * 115) / 1000)) < 0.01);
    assert.equal(pulse.healthy, true);
  });

  it("returns null without enough blocks or time", () => {
    assert.equal(computePulse([block(1, 1), block(2, 2)], { network: "elysium-testnet", chainId: 99801, now: 3 }), null);
    assert.equal(computePulse([block(1, 5), block(2, 5), block(3, 5)], { network: "elysium-testnet", chainId: 99801, now: 6 }), null);
    const short = [block(1, 0), block(2, 115), block(3, 230)];
    assert.ok(computePulse(short, { network: "elysium-testnet", chainId: 99801, now: 300 }));
    assert.equal(computePulse(short, { network: "elysium-testnet", chainId: 99801, now: 300 }, 40, 4_000), null, "browser stats wait for a long enough span");
  });

  it("smooths bursty arrivals into a rolling interval series", () => {
    // Blocks arrive in pairs that share a seenAt, 230 ms apart: 115 ms per block on average.
    const recent = Array.from({ length: 20 }, (_, index) => block(index, Math.floor(index / 2) * 230));
    const series = rollingIntervals(recent, 8);
    assert.equal(series.length, 12);
    for (const value of series) assert.equal(value, 115);
  });

  it("skips windows that arrived in a single burst", () => {
    const burst = Array.from({ length: 12 }, (_, index) => block(index, index < 10 ? 5_000 : 5_000 + (index - 9) * 115));
    const series = rollingIntervals(burst, 8);
    assert.ok(series.every((value) => value > 0));
    assert.equal(series.length, 2);
  });

  it("flags stale data", () => {
    assert.equal(isStale(null, 0), true);
    assert.equal(isStale(1_000, 1_000 + STALE_AFTER_MS - 1), false);
    assert.equal(isStale(1_000, 1_000 + STALE_AFTER_MS + 1), true);
  });
});

describe("rpc conversion", () => {
  const raw = {
    number: "0x119f25d",
    hash: "0xc41e4aec621d44fce890787c559b963365c7256fbec3219b0f1267897155852f",
    timestamp: "0x6a2c1f30",
    transactions: ["0xa", "0xb", "0xc"],
    gasUsed: "0x9006",
    baseFeePerGas: "0x5f65630",
    l1BlockNumber: "0x410b7a5",
  };

  it("matches the API's block definition (Nitro's internal tx excluded)", () => {
    const converted = rpcBlockToPulseBlock(raw, "elysium-testnet", 42);
    assert.ok(converted);
    assert.equal(converted.number, 0x119f25d);
    assert.equal(converted.txCount, 2);
    assert.equal(converted.gasUsed, String(0x9006));
    assert.equal(converted.baseFeeGwei, 0.10003);
    assert.equal(converted.l1BlockNumber, 0x410b7a5);
    assert.equal(converted.seenAt, 42);
  });

  it("rejects malformed headers", () => {
    assert.equal(rpcBlockToPulseBlock({ ...raw, hash: "0x1" }, "elysium-testnet", 0), null);
    assert.equal(rpcBlockToPulseBlock({ ...raw, number: "12" }, "elysium-testnet", 0), null);
    assert.equal(rpcBlockToPulseBlock(null, "elysium-testnet", 0), null);
    assert.equal(hexToSafeNumber("0x"), null);
    assert.equal(weiHexToGwei("0x3b9aca00"), 1);
  });

  it("plans gap fills newest-first within a cap", () => {
    assert.deepEqual(missingBlockNumbers(null, 100, 8), [100]);
    assert.deepEqual(missingBlockNumbers(97, 100, 8), [98, 99, 100]);
    assert.deepEqual(missingBlockNumbers(10, 100, 3), [98, 99, 100]);
    assert.deepEqual(missingBlockNumbers(100, 100, 8), []);
  });

  it("recognises rate limits from Conduit, Kinetiq and generic providers", () => {
    assert.equal(isRateLimited({ code: -32017, message: "Rate Limit Exceeded" }), true);
    assert.equal(isRateLimited({ code: -32005 }), true);
    assert.equal(isRateLimited({ code: -32000, message: "too many requests" }), true);
    assert.equal(isRateLimited({ code: -32601, message: "method not found" }), false);
  });
});
