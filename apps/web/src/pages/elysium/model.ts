/** Pure helpers of the /elysium weather station (node:test loads this file). */

export interface HistogramBin {
  /** Lower edge in ms (inclusive). */
  readonly from: number;
  /** Upper edge in ms (exclusive; the last bin also takes everything above). */
  readonly to: number;
  readonly count: number;
}

export interface Histogram {
  readonly bins: readonly HistogramBin[];
  readonly total: number;
  /** Index of the fullest bin, or -1 when empty. */
  readonly mode: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

/**
 * Block intervals as a histogram with `binMs` wide bins from `from` to `to`;
 * values below `from` land in the first bin, values at or above `to` in the
 * last (so nothing is dropped from the count).
 */
export function intervalHistogram(values: readonly number[], options: { readonly from?: number; readonly to?: number; readonly binMs?: number } = {}): Histogram {
  const from = options.from ?? 60;
  const to = options.to ?? 220;
  const binMs = options.binMs ?? 10;
  const count = Math.max(1, Math.ceil((to - from) / binMs));
  const counts = new Array<number>(count).fill(0);
  let total = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) continue;
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - from) / binMs)));
    counts[index]! += 1;
    total += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  let mode = -1;
  counts.forEach((c, index) => {
    if (c > 0 && (mode < 0 || c > counts[mode]!)) mode = index;
  });
  return {
    bins: counts.map((c, index) => ({ from: from + index * binMs, to: from + (index + 1) * binMs, count: c })),
    total,
    mode,
    min: total > 0 ? min : null,
    max: total > 0 ? max : null,
    mean: total > 0 ? Math.round((sum / total) * 10) / 10 : null,
  };
}

/** "0.4 s ago" style ages for the register (never negative). */
export function ageLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const safe = Math.max(0, ms);
  if (safe < 1_000) return `${Math.round(safe)} ms ago`;
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)} s ago`;
  return `${Math.round(safe / 60_000)} min ago`;
}
