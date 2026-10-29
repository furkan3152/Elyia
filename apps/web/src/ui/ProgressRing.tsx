import React from "react";

import { cx } from "./cx";
import type { Tone } from "./tones";

export interface ProgressRingProps {
  /** 0..1 (clamped). */
  readonly value: number;
  readonly size?: number;
  readonly thickness?: number;
  readonly tone?: Tone;
  /** Accessible name ("TWAP 22 of 40 filled"). */
  readonly label: string;
  /** Centre content (a percentage, an icon). */
  readonly children?: React.ReactNode;
  readonly className?: string;
}

const COLOR: Readonly<Record<Tone, string>> = {
  violet: "rgb(var(--violet-glow))",
  gold: "rgb(var(--gold))",
  mint: "rgb(var(--mint))",
  rose: "rgb(var(--rose))",
  sky: "rgb(var(--sky))",
  neutral: "rgb(var(--text-1))",
};

/** Circular progress for fills, TWAP slices, confirm periods. */
export function ProgressRing({ value, size = 44, thickness = 4, tone = "violet", label, children, className }: ProgressRingProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cx("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--text-2) / 0.2)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={COLOR[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-slow ease-pluck"
        />
      </svg>
      {children ? <span className="tnum absolute inset-0 flex items-center justify-center font-mono text-xs text-text-0">{children}</span> : null}
    </span>
  );
}
