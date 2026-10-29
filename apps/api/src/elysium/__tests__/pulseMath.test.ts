import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PulseBlock } from "@elyia/core";
import { FakeChain } from "../../__tests__/support.js";
import { computePulse, isRawBlockHeader, PulseWindow, refreshPulse, toPulseBlock, weiToGwei, type RawBlockHeader } from "../pulseMath.js";

function block(number: number, seenAt: number, extra: Partial<PulseBlock> = {}): PulseBlock {
  return {
    network: "elysium-testnet",
    number,
    hash: `0x${number.toString(16).padStart(64, "0")}`,
    timestamp: 1_800_000_000,
    txCount: 2,
    gasUsed: "100000",
    baseFeeGwei: 0.1,
    l1BlockNumber: 68_000_000,
    seenAt,
    ...extra,
  };
}

describe("toPulseBlock", () => {
  it("converts a Nitro header, excluding the ArbOS internal transaction", () => {
    const chain = new FakeChain(18_453_000);
    chain.userTxs = 3;
    const raw = chain.header(18_453_000) as unknown as RawBlockHeader;
    assert.ok(isRawBlockHeader(raw));
    const pulseBlock = toPulseBlock("elysium-testnet", raw, 1234, { nitro: true });
    assert.deepEqual(pulseBlock, {
      network: "elysium-testnet",
      number: 18_453_000,
      hash: `0x${(18_453_000).toString(16).padStart(64, "0")}`,
      timestamp: 1_800_000_000 + Math.floor(18_453_000 / 8),
      txCount: 3,
      gasUsed: "100000",
      baseFeeGwei: 0.1,
      l1BlockNumber: 68_000_000,
      seenAt: 1234,
    });
    assert.equal(toPulseBlock("hyperevm-testnet", raw, 0, { nitro: false }).txCount, 4);
  });

  it("handles missing optional fields and rejects malformed headers", () => {
    const raw = { number: "0x10", hash: "0xAB", timestamp: "0x1", gasUsed: "0x0", transactions: [] } as RawBlockHeader;
    const converted = toPulseBlock("elysium-testnet", raw, 0, { nitro: true });
    assert.equal(converted.txCount, 0);
    assert.equal(converted.baseFeeGwei, 0);
    assert.equal(converted.l1BlockNumber, null);
    assert.equal(converted.hash, "0xab");
    assert.equal(isRawBlockHeader(null), false);
    assert.equal(isRawBlockHeader({ ...raw, number: "16" }), false);
    assert.equal(isRawBlockHeader({ ...raw, transactions: undefined }), false);
  });

  it("converts wei to gwei exactly", () => {
    assert.equal(weiToGwei(100_000_000n), 0.1);
    assert.equal(weiToGwei(100_030_000n), 0.10003);
    assert.equal(weiToGwei(25_000_000_000n), 25);
  });
});

describe("computePulse", () => {
  const base = { network: "elysium-testnet" as const, chainId: 99_801, staleAfterMs: 5_000 };

  it("measures block time on the wall clock and derives rates per block", () => {
    // 61 blocks, one every 115 ms.
    const blocks = Array.from({ length: 61 }, (_, index) => block(1_000 + index, 10_000 + index * 115, { txCount: index % 2 === 0 ? 1 : 3 }));
    const last = blocks[60] as PulseBlock;
    const pulse = computePulse({ ...base, blocks, now: last.seenAt + 50, lastBlockAt: last.seenAt });
    assert.ok(pulse);
    assert.equal(pulse.blockTimeMs, 115);
    assert.equal(pulse.head, 1_060);
    assert.equal(pulse.sampleBlocks, 61);
    // Mean 2 user txs per block (31 x 1 + 30 x 3 = 121 over 61 blocks) at 8.6957 blocks/s.
    assert.equal(pulse.tps, Math.round((121 / 61) * (1000 / 115) * 100) / 100);
    assert.equal(pulse.gasPerSecond, Math.round(100_000 * (1000 / 115)));
    assert.equal(pulse.gasPriceGwei, 0.1);
    assert.equal(pulse.l1BlockNumber, 68_000_000);
    assert.equal(pulse.healthy, true);
    assert.equal(pulse.chainId, 99_801);
  });

  it("stays correct when the poller skipped blocks", () => {
    // Saw 1000 at t=0 and 1087 at t=10 s (87 blocks produced, 2 observed).
    const pulse = computePulse({ ...base, blocks: [block(1_000, 0), block(1_087, 10_005)], now: 10_005, lastBlockAt: 10_005 });
    assert.equal(pulse?.blockTimeMs, 115);
  });

  it("averages batch arrivals that share a seenAt", () => {
    // Blocks arrive two at a time every 230 ms.
    const blocks: PulseBlock[] = [];
    for (let index = 0; index < 20; index += 1) blocks.push(block(500 + index, Math.floor(index / 2) * 230));
    const last = blocks.at(-1) as PulseBlock;
    const pulse = computePulse({ ...base, blocks, now: last.seenAt, lastBlockAt: last.seenAt });
    // (9 * 230) ms over 19 heights: the error is bounded by one poll interval over the window.
    assert.equal(pulse?.blockTimeMs, Math.round(((9 * 230) / 19) * 10) / 10);
  });

  it("is not measurable with fewer than two blocks or no elapsed time", () => {
    assert.equal(computePulse({ ...base, blocks: [], now: 0, lastBlockAt: null }), null);
    assert.equal(computePulse({ ...base, blocks: [block(1, 0)], now: 0, lastBlockAt: 0 }), null);
    assert.equal(computePulse({ ...base, blocks: [block(1, 5), block(2, 5)], now: 5, lastBlockAt: 5 }), null);
  });

  it("reports unhealthy when no block arrived recently", () => {
    const blocks = [block(1, 0), block(2, 115)];
    assert.equal(computePulse({ ...base, blocks, now: 5_114, lastBlockAt: 115 })?.healthy, true);
    const stale = computePulse({ ...base, blocks, now: 5_115, lastBlockAt: 115 });
    assert.equal(stale?.healthy, false);
    assert.equal(refreshPulse(stale as NonNullable<typeof stale>, 1, 0, 5_000).healthy, true);
  });
});

describe("PulseWindow", () => {
  it("keeps the last N heights and drops old samples, always keeping the newest", () => {
    const window = new PulseWindow(3, 1_000);
    for (let n = 1; n <= 5; n += 1) assert.equal(window.add(block(n, n * 100)), "added");
    assert.deepEqual(
      window.snapshot().map((entry) => entry.number),
      [3, 4, 5],
    );
    window.trim(5_000);
    assert.deepEqual(
      window.snapshot().map((entry) => entry.number),
      [5],
    );
    assert.equal(window.head?.number, 5);
  });

  it("drops heights outside the number range after a jump", () => {
    const window = new PulseWindow(60, 30_000);
    window.add(block(100, 0));
    window.add(block(101, 100));
    window.add(block(1_000, 200));
    assert.deepEqual(
      window.snapshot().map((entry) => entry.number),
      [1_000],
    );
  });

  it("replaces a re-delivered height with a different hash, keeping its first seenAt", () => {
    const window = new PulseWindow();
    window.add(block(10, 0));
    window.add(block(11, 100));
    assert.equal(window.add(block(11, 900)), "ignored");
    assert.equal(window.add(block(10, 900, { hash: "0xreorg" })), "replaced");
    assert.equal(window.snapshot()[0]?.hash, "0xreorg");
    assert.equal(window.snapshot()[0]?.seenAt, 0);
    assert.equal(window.add(block(11, 900, { hash: "0xother" })), "replaced");
    assert.equal(window.head?.seenAt, 100);
    assert.equal(window.add(block(5, 900)), "ignored");
  });
});
