/**
 * Number helpers for derived market metrics. HyperCore sends decimals as
 * strings; they stay strings on the wire, and are parsed here only to derive
 * percentages, APRs and USD values (display figures, never order amounts).
 */

export const HOURS_PER_YEAR = 24 * 365;

/** A finite number from a decimal string or number; null for anything else (never 0 by default). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rounds to `digits` decimals and normalizes -0 to 0. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** USD figures keep micro-dollar precision: enough for dust, stable for diffs. */
export function roundUsd(value: number): number {
  return round(value, 6);
}

export function roundPct(value: number): number {
  return round(value, 4);
}

/** Percent change from `before` to `now`; null when either is unknown or `before` is not positive. */
export function changePct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before <= 0) return null;
  return roundPct(((now - before) / before) * 100);
}

/** Annualized percent of an hourly rate (simple, not compounded). */
export function hourlyToAprPct(hourly: number | null): number | null {
  return hourly === null ? null : roundPct(hourly * HOURS_PER_YEAR * 100);
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Median absolute deviation from the median. */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const center = median(values);
  if (center === null) return null;
  return median(values.map((value) => Math.abs(value - center)));
}
