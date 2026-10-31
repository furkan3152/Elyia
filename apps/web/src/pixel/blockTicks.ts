/**
 * Barograph ticks (pure): one tick per block, newest last. Live blocks come
 * from the pulse feed; when none arrived for a while the store fills itself
 * with a labelled sample at the block cadence so the strip never lies still
 * and never pretends to be live.
 */
import { rngOf } from "./topo";

export interface TickStoreOptions {
  readonly capacity: number;
  /** Sample cadence (ms per block; Elysium's is about 114). */
  readonly cadenceMs?: number;
  /** After this long without a live block the store says "sample" (ms). */
  readonly staleAfterMs?: number;
  readonly seed?: number;
}

export class TickStore {
  readonly ticks: number[] = [];
  /** Newest live block number (null before the first). */
  lastBlock: number | null = null;
  private lastLiveAt = -Infinity;
  private nextSampleAt: number | null = null;
  private readonly random: () => number;
  private capacity: number;
  private readonly cadence: number;
  private readonly staleAfter: number;
  /** Bumps on every new tick (cheap change detection). */
  version = 0;

  constructor(options: TickStoreOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.cadence = options.cadenceMs ?? 114;
    this.staleAfter = options.staleAfterMs ?? 3_000;
    this.random = rngOf(options.seed ?? 18742108);
    for (let i = 0; i < this.capacity; i += 1) this.ticks.push(this.sampleHeight());
  }

  private sampleHeight(): number {
    return 2 + Math.round(this.random() * 5);
  }

  private push(height: number) {
    this.ticks.push(height);
    if (this.ticks.length > this.capacity) this.ticks.splice(0, this.ticks.length - this.capacity);
    this.version += 1;
  }

  /** A live block arrived: its height follows its transaction count (2..9). */
  live(block: { readonly number: number; readonly txCount: number }, now: number): void {
    this.lastLiveAt = now;
    this.lastBlock = block.number;
    this.nextSampleAt = null;
    this.push(Math.max(2, Math.min(9, 2 + Math.round(Math.log2(1 + Math.max(0, block.txCount)) * 1.6))));
  }

  /** True while live blocks keep arriving. */
  isLive(now: number): boolean {
    return now - this.lastLiveAt < this.staleAfter;
  }

  /** Without live blocks, adds sample ticks up to `now` (at most a strip's worth). */
  advance(now: number): void {
    if (this.isLive(now)) return;
    if (this.nextSampleAt === null || now - this.nextSampleAt > this.cadence * this.capacity) this.nextSampleAt = now;
    while (this.nextSampleAt <= now) {
      this.push(this.sampleHeight());
      this.nextSampleAt += this.cadence;
    }
  }

  resize(capacity: number): void {
    const next = Math.max(1, capacity);
    while (this.ticks.length < next) this.ticks.unshift(this.sampleHeight());
    if (this.ticks.length > next) this.ticks.splice(0, this.ticks.length - next);
    this.capacity = next;
  }
}
