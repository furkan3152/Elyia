/**
 * The Sun's pure model: one ray per Elysium block around the rim.
 *
 * - The ray slot advances one step per block (block number mod 36), so the
 *   cadence reads as rays travelling around the rim, never as a flashing
 *   disc (photosensitivity: nothing flashes as a whole above 3 Hz).
 * - Blocks reach the browser in bursts (the server polls and fans out), so a
 *   scheduler spreads each burst at the measured block time; when it falls
 *   behind it compresses the spacing so the Sun never lags more than ~1.2 s.
 * - A ray lights in 60 ms and fades over ~1.2 s.
 */

export const RAY_COUNT = 36;
export const RAY_FADE_MS = 1_200;
export const RAY_ATTACK_MS = 60;
/** Brightness of an idle ray (the dim rim). */
export const IDLE_RAY_ALPHA = 0.14;

/** Rim slot of a block: the angle advances by 360/count degrees per block. */
export function raySlot(blockNumber: number, count = RAY_COUNT): number {
  const slot = blockNumber % count;
  return slot < 0 ? slot + count : slot;
}

/** Angle in radians of a slot, starting at 12 o'clock and running clockwise. */
export function rayAngle(slot: number, count = RAY_COUNT): number {
  return -Math.PI / 2 + (slot / count) * Math.PI * 2;
}

/** 0..1 brightness of a ray `ageMs` after its block: fast attack, ease-out fade, 0 after `fadeMs`. */
export function rayIntensity(ageMs: number, fadeMs = RAY_FADE_MS, attackMs = RAY_ATTACK_MS): number {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= fadeMs) return 0;
  if (ageMs < attackMs) return ageMs / attackMs;
  const t = (ageMs - attackMs) / (fadeMs - attackMs);
  return (1 - t) * (1 - t);
}

/** 0.35..1 ray strength from the block's gas (log scale): busier blocks throw longer rays. */
export function rayStrength(gasUsed: string | number): number {
  const gas = typeof gasUsed === "number" ? gasUsed : Number(gasUsed);
  if (!Number.isFinite(gas) || gas <= 0) return 0.35;
  return 0.35 + 0.65 * Math.min(1, Math.log10(1 + gas) / Math.log10(1 + 2_000_000));
}

/** Idle ray length pattern (fraction of the maximum), so the rim reads like the mockup's staggered crown. */
const IDLE_PATTERN = [1, 0.78, 0.93, 0.7, 0.96, 0.74, 0.88, 0.66];

export function idleRayLength(slot: number): number {
  return IDLE_PATTERN[slot % IDLE_PATTERN.length]!;
}

export interface BeatSchedulerOptions {
  readonly minSpacingMs?: number;
  readonly maxSpacingMs?: number;
  /** The queue is compressed so the newest item is shown within this lag. */
  readonly maxLagMs?: number;
  /** Items beyond this are dropped oldest-first (a tab returning from the background). */
  readonly maxQueue?: number;
}

/**
 * Spreads bursty arrivals to a steady cadence. `push` when an item arrives,
 * `drain(now)` every frame to get the items due. Pure apart from its own
 * queue; time is always passed in.
 */
export class BeatScheduler<T> {
  private readonly queue: T[] = [];
  private nextAt = Number.NEGATIVE_INFINITY;
  private cadenceMs = 115;
  private readonly minSpacing: number;
  private readonly maxSpacing: number;
  private readonly maxLag: number;
  private readonly maxQueue: number;

  constructor(options: BeatSchedulerOptions = {}) {
    this.minSpacing = options.minSpacingMs ?? 30;
    this.maxSpacing = options.maxSpacingMs ?? 400;
    this.maxLag = options.maxLagMs ?? 1_200;
    this.maxQueue = options.maxQueue ?? 24;
  }

  /** The measured block time; used as the spacing between beats. */
  setCadence(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.cadenceMs = ms;
  }

  push(item: T): void {
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Current spacing: the cadence, compressed when the queue would lag more than `maxLag`. */
  spacing(): number {
    const base = Math.min(this.maxSpacing, Math.max(this.minSpacing, this.cadenceMs));
    if (this.queue.length * base <= this.maxLag) return base;
    return Math.max(this.minSpacing, this.maxLag / this.queue.length);
  }

  drain(now: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && now >= this.nextAt) {
      const spacing = this.spacing();
      out.push(this.queue.shift()!);
      // Keep the beat grid while on time; restart it from `now` after an idle gap.
      this.nextAt = (now - this.nextAt > spacing ? now : this.nextAt) + spacing;
    }
    return out;
  }

  clear(): void {
    this.queue.length = 0;
    this.nextAt = Number.NEGATIVE_INFINITY;
  }
}
