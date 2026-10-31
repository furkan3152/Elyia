import { useCallback, useMemo } from "react";

import type { ProfileCamp, ProfilePoint } from "../topo/geometry/profile";
import { cx } from "../ui/cx";
import { PixelCanvas } from "./PixelCanvas";
import { paintProfile, profileColumns } from "./profile";

export interface PixelProfileProps {
  /** Equity over time, oldest first. */
  readonly series: readonly ProfilePoint[];
  /** Key events as camps along the ridge. */
  readonly camps?: readonly ProfileCamp[];
  /** Accessible summary ("Net worth, 35 days, +22%"). */
  readonly label: string;
  /** Logical height in pixels (default 64; one pixel is about 3 CSS px). */
  readonly height?: number;
  readonly formatValue?: (value: number) => string;
  readonly startLabel?: string;
  readonly endLabel?: string;
  /** A line printed under the ridge ("a 35-day climb · +$8,764"). */
  readonly caption?: string;
  readonly className?: string;
}

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/**
 * Equity as a stepped pixel ridgeline in altitude bands: a summit flag on the
 * all-time high, the worst drawdown flooded as a valley lake, camps along
 * the way. The flag waves once a second while motion is on.
 */
export function PixelProfile({ series, camps = [], label, height = 64, formatValue = usd, startLabel, endLabel, caption, className }: PixelProfileProps) {
  const values = useMemo(() => series.map((point) => point.value), [series]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const model = profileColumns(values, info.w, info.h);
      paintProfile(ctx, model, { wave: !info.still && Math.floor(info.seconds) % 2 === 1 });
    },
    [values],
  );
  const first = series[0];
  const last = series[series.length - 1];
  const t0 = first?.t ?? 0;
  const t1 = last?.t ?? 1;
  const at = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * 100 : 0);
  const max = values.length ? Math.max(...values) : 0;
  const athIndex = values.lastIndexOf(max);
  const athAt = series[athIndex] ? at(series[athIndex]!.t) : 100;
  const model = useMemo(() => profileColumns(values, 100, height), [values, height]);
  return (
    <figure className={cx("m-0 w-full min-w-0", className)}>
      <div className="relative">
        <PixelCanvas width={200} height={height} pixelSize={3} draw={draw} animate fps={2} label={label} redrawKey={values} />
        {camps.map((camp, index) => (
          <span
            key={`${camp.t}-${camp.label}`}
            aria-hidden="true"
            title={camp.label}
            className="absolute bottom-2 -translate-x-1/2 bg-ink px-1 font-tag text-[11px] leading-4 text-paper"
            style={{ left: `${Math.max(3, Math.min(97, at(camp.t)))}%` }}
          >
            {ROMAN[index] ?? index + 1}
          </span>
        ))}
        {values.length ? (
          <span
            className={cx("absolute top-0 whitespace-nowrap bg-card px-1.5 font-mono text-xs font-semibold text-ink px-frame-thin tnum", athAt > 70 ? "-translate-x-[calc(100%+14px)]" : "translate-x-[14px]")}
            style={{ left: `${athAt}%` }}
          >
            ▲ ATH {formatValue(max)}
          </span>
        ) : null}
      </div>
      <figcaption className="mt-2 grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 font-tag text-[11px] uppercase text-ink-2">
        <span>{startLabel ?? ""}</span>
        <span className="text-center normal-case">
          {caption ? <span className="font-mono text-xs text-ink">{caption}</span> : null}
          {model.valley ? <span className="ml-2 font-mono text-xs text-water">▼ worst drop {(model.valley.fraction * 100).toFixed(1)}%</span> : null}
        </span>
        <span>{endLabel ?? ""}</span>
      </figcaption>
      {camps.length ? (
        <ol className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs text-ink-2">
          {camps.map((camp, index) => (
            <li key={`${camp.t}-${camp.label}`}>
              <span className="font-tag text-ink">{ROMAN[index] ?? index + 1}</span> · {camp.label}
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  );
}
