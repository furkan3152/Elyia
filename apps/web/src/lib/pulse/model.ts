/**
 * Pure model of the live Elysium pulse: validation of the wire shapes from
 * @elyia/core/pulse, the rolling block buffer, statistics computed in the
 * browser when the API is unreachable, and the series the /elysium chart
 * draws. No I/O; node tests load this file.
 */
import { isNetworkKey, type NetworkKey } from "@elyia/core/networks";
import type { Pulse, PulseBlock } from "@elyia/core/pulse";

export type { Pulse, PulseBlock };

/** Blocks kept in memory (about 14 s of Elysium). */
export const RECENT_BLOCKS = 120;
/** Window for statistics computed from blocks (about 5 s). */
export const STATS_WINDOW = 40;
/** Minimum wall-clock span before the browser publishes its own pulse (polled arrivals are bursty). */
export const MIN_BROWSER_SPAN_MS = 4_000;
/** No new block for this long marks the pulse stale. */
export const STALE_AFTER_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A PulseBlock from untrusted JSON, or null when any field is malformed. */
export function parsePulseBlock(value: unknown): PulseBlock | null {
  if (!isRecord(value)) return null;
  const { network, number, hash, timestamp, txCount, gasUsed, baseFeeGwei, l1BlockNumber, seenAt } = value;
  if (!isNetworkKey(network)) return null;
  if (!nonNegativeInt(number) || !nonNegativeInt(timestamp) || !nonNegativeInt(txCount) || !nonNegativeInt(seenAt)) return null;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(hash)) return null;
  if (typeof gasUsed !== "string" || !/^\d{1,30}$/u.test(gasUsed)) return null;
  if (!finiteNonNegative(baseFeeGwei)) return null;
  if (l1BlockNumber !== null && !nonNegativeInt(l1BlockNumber)) return null;
  return { network, number, hash, timestamp, txCount, gasUsed, baseFeeGwei, l1BlockNumber: l1BlockNumber ?? null, seenAt };
}

/** A Pulse from untrusted JSON, or null when malformed. */
export function parsePulse(value: unknown): Pulse | null {
  if (!isRecord(value)) return null;
  const { network, chainId, head, blockTimeMs, tps, gasPriceGwei, gasPerSecond, l1BlockNumber, sampleBlocks, updatedAt, healthy } = value;
  if (!isNetworkKey(network) || !nonNegativeInt(chainId) || !nonNegativeInt(head)) return null;
  if (!finiteNonNegative(blockTimeMs) || !finiteNonNegative(tps) || !finiteNonNegative(gasPriceGwei) || !finiteNonNegative(gasPerSecond)) return null;
  if (l1BlockNumber !== null && !nonNegativeInt(l1BlockNumber)) return null;
  if (!nonNegativeInt(sampleBlocks) || !nonNegativeInt(updatedAt) || typeof healthy !== "boolean") return null;
  return { network, chainId, head, blockTimeMs, tps, gasPriceGwei, gasPerSecond, l1BlockNumber: l1BlockNumber ?? null, sampleBlocks, updatedAt, healthy };
}

export type AppendResult = { readonly recent: readonly PulseBlock[]; readonly added: boolean };

/**
 * Adds a block to the ascending buffer. Duplicates are ignored; a block at a
 * height already held with a different hash replaces it and drops everything
 * above (a reorg); an older block that fits in the window is inserted in
 * order. The buffer keeps the newest `cap` blocks.
 */
export function appendBlock(recent: readonly PulseBlock[], block: PulseBlock, cap = RECENT_BLOCKS): AppendResult {
  const last = recent[recent.length - 1];
  if (!last || block.number > last.number) {
    const next = recent.length >= cap ? [...recent.slice(recent.length - cap + 1), block] : [...recent, block];
    return { recent: next, added: true };
  }
  const index = recent.findIndex((candidate) => candidate.number === block.number);
  if (index >= 0) {
    if (recent[index]!.hash === block.hash) return { recent, added: false };
    return { recent: [...recent.slice(0, index), block], added: true };
  }
  const first = recent[0]!;
  if (block.number < first.number) return { recent, added: false };
  const insertAt = recent.findIndex((candidate) => candidate.number > block.number);
  const next = [...recent.slice(0, insertAt), block, ...recent.slice(insertAt)];
  return { recent: next, added: true };
}

/**
 * Pulse statistics from the newest `window` blocks, measured on the wall
 * clock (`seenAt`), the same definition the API uses. Null when fewer than
 * three blocks are known or the window spans no time.
 */
export function computePulse(
  recent: readonly PulseBlock[],
  input: { readonly network: NetworkKey; readonly chainId: number; readonly now: number },
  window = STATS_WINDOW,
  minSpanMs = 0,
): Pulse | null {
  if (recent.length < 3) return null;
  const sample = recent.slice(-window);
  const first = sample[0]!;
  const last = sample[sample.length - 1]!;
  const spanMs = last.seenAt - first.seenAt;
  const blocks = last.number - first.number;
  // A short window of bursty arrivals says more about the poll timing than the chain: wait for enough of it.
  if (spanMs <= 0 || blocks <= 0 || spanMs < minSpanMs) return null;
  const seconds = spanMs / 1000;
  // Transactions and gas of the blocks after the first one: they arrived within the span.
  let txs = 0;
  let gas = 0;
  for (const block of sample.slice(1)) {
    txs += block.txCount;
    gas += Number(block.gasUsed);
  }
  return {
    network: input.network,
    chainId: input.chainId,
    head: last.number,
    blockTimeMs: Math.round((spanMs / blocks) * 10) / 10,
    tps: Math.round((txs / seconds) * 100) / 100,
    gasPriceGwei: last.baseFeeGwei,
    gasPerSecond: Math.round(gas / seconds),
    l1BlockNumber: last.l1BlockNumber,
    sampleBlocks: sample.length,
    updatedAt: input.now,
    healthy: input.now - last.seenAt < STALE_AFTER_MS,
  };
}

/**
 * Block interval series for the chart. Blocks reach a poller in small bursts
 * that share one `seenAt`, so the per-block difference is mostly 0 or a whole
 * poll period: a true per-block interval does not exist in the browser.
 * Each point is instead the mean interval over the previous `span` blocks
 * (a rolling mean), which converges on the real cadence.
 */
export function rollingIntervals(recent: readonly PulseBlock[], span = 8): number[] {
  const out: number[] = [];
  for (let index = span; index < recent.length; index += 1) {
    const from = recent[index - span]!;
    const to = recent[index]!;
    const blocks = to.number - from.number;
    const ms = to.seenAt - from.seenAt;
    // A window that arrived in one burst carries no timing information: skip it rather than plot 0 ms.
    if (blocks > 0 && ms > 0) out.push(Math.round((ms / blocks) * 10) / 10);
  }
  return out;
}

/** True when the newest block is older than `STALE_AFTER_MS`. */
export function isStale(lastBlockSeenAt: number | null, now: number): boolean {
  return lastBlockSeenAt === null || now - lastBlockSeenAt > STALE_AFTER_MS;
}
