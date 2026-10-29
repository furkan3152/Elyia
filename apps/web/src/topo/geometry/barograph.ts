/**
 * Barograph scheduler (pure). The drum strip scrolls left at a constant
 * speed; every block is one ink tick placed at its arrival time, its height
 * growing with the block's transaction count. Ticks live in "strip space"
 * (x = time * pxPerMs since the strip's epoch), so the component only moves
 * one group with a transform per frame: no per-frame React state, and the
 * strip loops seamlessly by re-basing the epoch when it gets long.
 */

export interface BaroBlock {
  readonly number: number;
  /** Local arrival time (ms, performance or wall clock, one clock throughout). */
  readonly at: number;
  readonly txCount: number;
}

export interface BaroTick {
  readonly number: number;
  readonly x: number;
  /** 0..1 amplitude. */
  readonly amplitude: number;
}

export interface BaroOptions {
  /** Strip speed. */
  readonly pxPerMs: number;
  /** Visible window width in px. */
  readonly width: number;
}

/** Tick height: log-scaled so one busy block does not flatten the rest; an empty block still leaves a mark. */
export function tickAmplitude(txCount: number): number {
  if (!Number.isFinite(txCount) || txCount <= 0) return 0.12;
  return Math.min(1, 0.12 + Math.log10(1 + txCount) * 0.38);
}

/** Strip-space x of a block. */
export function tickX(at: number, epoch: number, pxPerMs: number): number {
  return (at - epoch) * pxPerMs;
}

/** The translate that keeps "now" at the right edge of the window. */
export function stripOffset(now: number, epoch: number, options: BaroOptions): number {
  return options.width - tickX(now, epoch, options.pxPerMs);
}

/** Ticks still inside (or entering) the window at `now`. */
export function visibleTicks(blocks: readonly BaroBlock[], now: number, epoch: number, options: BaroOptions): BaroTick[] {
  const left = now - options.width / options.pxPerMs - 200;
  return blocks
    .filter((block) => block.at >= left && block.at <= now + 1000)
    .map((block) => ({ number: block.number, x: tickX(block.at, epoch, options.pxPerMs), amplitude: tickAmplitude(block.txCount) }));
}

/** Re-base the epoch when strip coordinates get large (keeps SVG numbers small; invisible to the reader). */
export function shouldRebase(now: number, epoch: number, pxPerMs: number, limitPx = 20_000): boolean {
  return tickX(now, epoch, pxPerMs) > limitPx;
}

/**
 * The ink trace for ticks: a baseline with a sharp spike per block (the
 * needle kicks up and settles), as one path string in strip space.
 */
export function tracePath(ticks: readonly BaroTick[], baseline: number, height: number): string {
  if (ticks.length === 0) return "";
  const sorted = [...ticks].sort((a, b) => a.x - b.x);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  let d = `M${fmt(sorted[0]!.x - 6)},${fmt(baseline)}`;
  for (const tick of sorted) {
    const peak = baseline - tick.amplitude * height;
    d += `L${fmt(tick.x - 1.2)},${fmt(baseline)}L${fmt(tick.x)},${fmt(peak)}L${fmt(tick.x + 1.6)},${fmt(baseline + tick.amplitude * 2)}L${fmt(tick.x + 3)},${fmt(baseline)}`;
  }
  return d;
}

/** Measured cadence (ms per block) from arrival times; null with fewer than 3 blocks. */
export function cadenceMs(blocks: readonly BaroBlock[]): number | null {
  if (blocks.length < 3) return null;
  const sorted = [...blocks].sort((a, b) => a.number - b.number);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const count = last.number - first.number;
  return count > 0 ? (last.at - first.at) / count : null;
}
