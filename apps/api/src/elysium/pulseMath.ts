/**
 * Pure pulse math: header -> PulseBlock, and a rolling window of blocks ->
 * Pulse.
 *
 * Nitro block timestamps have 1 s resolution, far coarser than Elysium's
 * ~115 ms blocks, so block time is measured on the server's wall clock
 * (`seenAt`): (last.seenAt - first.seenAt) / (last.number - first.number).
 * Dividing by the block-number span (not the sample count) keeps the figure
 * right when the poller skipped blocks. Rates are per observed block times
 * that cadence for the same reason: tps = mean user txs per block / block
 * time.
 */
import type { NetworkKey, Pulse, PulseBlock } from "@elyia/core";

/** The `eth_getBlockByNumber(n, false)` fields the pulse needs. */
export interface RawBlockHeader {
  readonly number: string;
  readonly hash: string;
  readonly parentHash?: string;
  readonly timestamp: string;
  readonly gasUsed: string;
  readonly baseFeePerGas?: string | null;
  readonly transactions: readonly unknown[];
  /** Arbitrum Nitro: parent-chain block number. */
  readonly l1BlockNumber?: string | null;
}

const HEX_QUANTITY = /^0x[0-9a-f]{1,64}$/iu;

export function isRawBlockHeader(value: unknown): value is RawBlockHeader {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.number === "string" &&
    HEX_QUANTITY.test(record.number) &&
    typeof record.hash === "string" &&
    typeof record.timestamp === "string" &&
    HEX_QUANTITY.test(record.timestamp) &&
    typeof record.gasUsed === "string" &&
    HEX_QUANTITY.test(record.gasUsed) &&
    Array.isArray(record.transactions)
  );
}

function hexToNumber(hex: string): number {
  return Number.parseInt(hex, 16);
}

/**
 * Every Nitro block starts with one ArbOS internal transaction (type 0x6a,
 * from 0x…a4b05); `txCount` counts user transactions only.
 */
export function toPulseBlock(network: NetworkKey, raw: RawBlockHeader, seenAt: number, options: { readonly nitro: boolean }): PulseBlock {
  const total = raw.transactions.length;
  const baseFee = raw.baseFeePerGas && HEX_QUANTITY.test(raw.baseFeePerGas) ? BigInt(raw.baseFeePerGas) : 0n;
  const l1 = raw.l1BlockNumber && HEX_QUANTITY.test(raw.l1BlockNumber) ? hexToNumber(raw.l1BlockNumber) : null;
  return {
    network,
    number: hexToNumber(raw.number),
    hash: raw.hash.toLowerCase(),
    timestamp: hexToNumber(raw.timestamp),
    txCount: options.nitro ? Math.max(0, total - 1) : total,
    gasUsed: BigInt(raw.gasUsed).toString(),
    baseFeeGwei: weiToGwei(baseFee),
    l1BlockNumber: l1,
    seenAt,
  };
}

/** wei -> gwei with up to 9 decimals (exact for any realistic fee). */
export function weiToGwei(wei: bigint): number {
  const whole = wei / 1_000_000_000n;
  const fraction = wei % 1_000_000_000n;
  return Number(whole) + Number(fraction) / 1e9;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface PulseInput {
  readonly network: NetworkKey;
  readonly chainId: number;
  /** Ascending by number, distinct numbers. */
  readonly blocks: readonly PulseBlock[];
  readonly now: number;
  /** Wall clock of the newest block's arrival. */
  readonly lastBlockAt: number | null;
  /** Without a new block for this long the pulse reports `healthy: false`. */
  readonly staleAfterMs: number;
}

/** The pulse over the window, or null when it cannot be measured yet (fewer than 2 blocks or no elapsed time). */
export function computePulse(input: PulseInput): Pulse | null {
  const { blocks } = input;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last || blocks.length < 2) return null;
  const elapsedMs = last.seenAt - first.seenAt;
  const numberSpan = last.number - first.number;
  if (elapsedMs <= 0 || numberSpan <= 0) return null;
  const blockTimeMs = elapsedMs / numberSpan;
  let txs = 0;
  let gas = 0;
  for (const block of blocks) {
    txs += block.txCount;
    gas += Number(block.gasUsed);
  }
  const blocksPerSecond = 1_000 / blockTimeMs;
  return {
    network: input.network,
    chainId: input.chainId,
    head: last.number,
    blockTimeMs: round(blockTimeMs, 1),
    tps: round((txs / blocks.length) * blocksPerSecond, 2),
    gasPriceGwei: round(last.baseFeeGwei, 6),
    gasPerSecond: Math.round((gas / blocks.length) * blocksPerSecond),
    l1BlockNumber: last.l1BlockNumber,
    sampleBlocks: blocks.length,
    updatedAt: input.now,
    healthy: input.lastBlockAt !== null && input.now - input.lastBlockAt < input.staleAfterMs,
  };
}

/** `healthy` and `updatedAt` re-evaluated now (a pulse kept after the poller stopped, or while the chain is quiet). */
export function refreshPulse(pulse: Pulse, now: number, lastBlockAt: number | null, staleAfterMs: number): Pulse {
  return { ...pulse, updatedAt: now, healthy: lastBlockAt !== null && now - lastBlockAt < staleAfterMs };
}

/**
 * Blocks of the last `maxBlocks` numbers seen within `maxAgeMs`, ascending.
 * A re-delivered number replaces the earlier entry (a reorg or a corrected
 * answer from another endpoint); older numbers are ignored.
 */
export class PulseWindow {
  private readonly blocks: PulseBlock[] = [];

  constructor(
    readonly maxBlocks = 60,
    readonly maxAgeMs = 30_000,
  ) {}

  get head(): PulseBlock | null {
    return this.blocks[this.blocks.length - 1] ?? null;
  }

  get size(): number {
    return this.blocks.length;
  }

  /** Returns "added", "replaced" or "ignored". */
  add(block: PulseBlock): "added" | "replaced" | "ignored" {
    const head = this.head;
    if (head && block.number < head.number) {
      const index = this.blocks.findIndex((entry) => entry.number === block.number);
      const existing = index === -1 ? undefined : this.blocks[index];
      if (existing && existing.hash !== block.hash) {
        // Keep the original seenAt: timing describes when that height first appeared.
        this.blocks[index] = { ...block, seenAt: existing.seenAt };
        return "replaced";
      }
      return "ignored";
    }
    if (head && block.number === head.number) {
      if (head.hash === block.hash) return "ignored";
      this.blocks[this.blocks.length - 1] = { ...block, seenAt: head.seenAt };
      return "replaced";
    }
    this.blocks.push(block);
    this.trim(block.seenAt);
    return "added";
  }

  /** Drops blocks outside the number and age bounds (always keeps the newest). */
  trim(now: number): void {
    const head = this.head;
    if (!head) return;
    const minNumber = head.number - this.maxBlocks + 1;
    while (this.blocks.length > 1) {
      const oldest = this.blocks[0];
      if (!oldest || (oldest.number >= minNumber && now - oldest.seenAt <= this.maxAgeMs)) break;
      this.blocks.shift();
    }
  }

  snapshot(): readonly PulseBlock[] {
    return [...this.blocks];
  }

  clear(): void {
    this.blocks.length = 0;
  }
}
