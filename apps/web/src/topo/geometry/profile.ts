/**
 * Elevation profile (pure): an equity curve drawn as a ridgeline. Finds the
 * all-time high (summit flag) and the maximum drawdown (valley marker),
 * places camps (key events) on the line, and lays the value axis in its own
 * gutter so labels never sit on the path.
 */
import type { Point } from "./contours";

export interface ProfilePoint {
  /** Time (ms) or any increasing x. */
  readonly t: number;
  readonly value: number;
}

export interface ProfileCamp {
  readonly t: number;
  readonly label: string;
}

export interface ProfileOptions {
  readonly width: number;
  readonly height: number;
  /** Left gutter for the value axis. */
  readonly gutter?: number;
  readonly padTop?: number;
  readonly padBottom?: number;
  /** Value axis ticks. */
  readonly ticks?: number;
  readonly formatValue?: (value: number) => string;
}

export interface Drawdown {
  readonly peakIndex: number;
  readonly troughIndex: number;
  /** Fraction lost from the peak (0.12 = -12%). 0 when the curve never falls. */
  readonly fraction: number;
}

export interface PlacedMark {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly index: number;
}

export interface PlacedCamp extends PlacedMark {
  readonly label: string;
  /** Label above the line, or below when there is no room. */
  readonly labelAbove: boolean;
}

export interface ProfileModel {
  readonly line: string;
  readonly area: string;
  readonly points: readonly Point[];
  readonly summit: PlacedMark | null;
  readonly valley: (PlacedMark & { readonly fraction: number; readonly peak: PlacedMark }) | null;
  readonly camps: readonly PlacedCamp[];
  readonly yTicks: ReadonlyArray<{ readonly y: number; readonly value: number; readonly label: string }>;
  readonly plot: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
  readonly min: number;
  readonly max: number;
}

/** The largest peak-to-trough fall of a series. */
export function maxDrawdown(values: readonly number[]): Drawdown {
  let peakIndex = 0;
  let best: Drawdown = { peakIndex: 0, troughIndex: 0, fraction: 0 };
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! > values[peakIndex]!) peakIndex = index;
    const peak = values[peakIndex]!;
    if (peak > 0) {
      const fall = (peak - values[index]!) / peak;
      if (fall > best.fraction) best = { peakIndex, troughIndex: index, fraction: fall };
    }
  }
  return best;
}

/** Index of the all-time high (the last one when tied, so the flag sits on the newest summit). */
export function athIndex(values: readonly number[]): number {
  let best = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (best < 0 || values[index]! >= values[best]!) best = index;
  }
  return best;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= raw) ?? raw;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step * 1e-9; value += step) out.push(Math.round(value * 1e6) / 1e6);
  return out;
}

export function profileModel(series: readonly ProfilePoint[], camps: readonly ProfileCamp[], options: ProfileOptions): ProfileModel {
  const gutter = options.gutter ?? 56;
  const padTop = options.padTop ?? 34;
  const padBottom = options.padBottom ?? 22;
  const plot = { x0: gutter, x1: options.width - 6, y0: padTop, y1: options.height - padBottom };
  const format = options.formatValue ?? ((value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const empty: ProfileModel = { line: "", area: "", points: [], summit: null, valley: null, camps: [], yTicks: [], plot, min: 0, max: 0 };
  if (series.length < 2) return empty;

  const values = series.map((point) => point.value);
  const t0 = series[0]!.t;
  const t1 = series[series.length - 1]!.t;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.06;
  const x = (t: number) => plot.x0 + ((t - t0) / (t1 - t0 || 1)) * (plot.x1 - plot.x0);
  const y = (value: number) => plot.y1 - ((value - min) / (max - min)) * (plot.y1 - plot.y0);
  const points: Point[] = series.map((point) => [x(point.t), y(point.value)]);

  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const line = `M${points.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join("L")}`;
  const area = `${line}L${fmt(plot.x1)},${fmt(plot.y1)}L${fmt(plot.x0)},${fmt(plot.y1)}Z`;

  const mark = (index: number): PlacedMark => ({ x: points[index]![0], y: points[index]![1], value: values[index]!, index });
  const summit = mark(athIndex(values));
  const drawdown = maxDrawdown(values);
  const valley = drawdown.fraction > 0 ? { ...mark(drawdown.troughIndex), fraction: drawdown.fraction, peak: mark(drawdown.peakIndex) } : null;

  const placedCamps: PlacedCamp[] = camps
    .filter((camp) => camp.t >= t0 && camp.t <= t1)
    .map((camp) => {
      let index = 0;
      for (let k = 0; k < series.length; k += 1) if (series[k]!.t <= camp.t) index = k;
      const placed = mark(index);
      return { ...placed, label: camp.label, labelAbove: placed.y - plot.y0 > 26 };
    });

  const yTicks = niceTicks(min, max, options.ticks ?? 3)
    .filter((value) => y(value) >= plot.y0 - 1 && y(value) <= plot.y1 + 1)
    .map((value) => ({ y: y(value), value, label: format(value) }));

  return { line, area, points, summit, valley, camps: placedCamps, yTicks, plot, min, max };
}
