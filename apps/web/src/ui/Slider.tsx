import React, { useId } from "react";

import { cx, FOCUS_RING } from "./cx";

export interface SliderProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Tick values shown under the track (and clickable), e.g. leverage [1, 2, 5, 10, 20, 40]. */
  readonly ticks?: readonly number[];
  /** Formats the value and the ticks ("5x"). */
  readonly format?: (value: number) => string;
  readonly label?: React.ReactNode;
  /** Right side of the label row; defaults to the formatted value. */
  readonly aside?: React.ReactNode;
  /** Values at or above this render the value in rose (risky leverage). */
  readonly dangerFrom?: number;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Leverage-style slider: a native range input (keyboard, screen readers and
 * touch for free) with Elyia's skin, tick marks and clickable tick labels.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  ticks,
  format = (v) => String(v),
  label,
  aside,
  dangerFrom,
  disabled,
  id,
  className,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? `sl-${autoId}`;
  const span = max - min || 1;
  const fill = ((clamp(value, min, max) - min) / span) * 100;
  const risky = dangerFrom !== undefined && value >= dangerFrom;
  const labelledAt: number[] = [];
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={inputId} className="text-[13px] font-medium text-text-1">
              {label}
            </label>
          ) : (
            <span />
          )}
          <span className={cx("tnum font-mono text-sm", risky ? "text-rose" : "text-text-0")}>{aside ?? format(value)}</span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="el-range"
        style={{ "--el-range-fill": `${fill}%` } as React.CSSProperties}
      />
      {ticks && ticks.length > 0 ? (
        <div className="relative h-6" aria-hidden="true">
          {ticks.map((tick, index) => {
            const left = ((clamp(tick, min, max) - min) / span) * 100;
            const active = value >= tick;
            // Ticks too close to the previous labelled one keep their mark but drop the label.
            const labelled = index === 0 || left - labelledAt[index - 1]! >= 6;
            labelledAt[index] = labelled ? left : labelledAt[index - 1]!;
            return (
              <button
                key={tick}
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => onChange(tick)}
                className={cx(
                  "absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1 font-mono text-xs transition-colors duration-fast",
                  active ? "text-text-1" : "text-text-2",
                  FOCUS_RING,
                )}
                style={{ left: `calc(${left}% + ${(0.5 - left / 100) * 18}px)` }}
              >
                <span className={cx("h-1.5 w-px", active ? "bg-violet-glow" : "bg-text-2/50")} />
                {labelled ? format(tick) : <span className="sr-only">{format(tick)}</span>}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
