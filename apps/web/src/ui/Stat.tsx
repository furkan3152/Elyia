import React from "react";

import { cx } from "./cx";
import { TEXT_TONE, type Tone } from "./tones";

export interface StatProps {
  readonly label: React.ReactNode;
  /** The figure. Pass formatted text or a NumberTicker; it renders tabular. */
  readonly value: React.ReactNode;
  readonly hint?: React.ReactNode;
  /** Colours the value (gold for "Nov 9", mint/rose for signed figures). */
  readonly tone?: Tone;
  readonly size?: "sm" | "md" | "lg";
  /** Card chrome (border + panel background) or bare. */
  readonly framed?: boolean;
  readonly className?: string;
}

const VALUE_SIZE = { sm: "text-lg", md: "text-2xl", lg: "text-[2rem] leading-none" } as const;

/** Label + figure + hint: the unit of every stat strip. */
export function Stat({ label, value, hint, tone = "neutral", size = "md", framed = true, className }: StatProps) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", framed && "border-2 border-rule bg-card p-4 shadow-hard sm:p-5", className)}>
      <span className="caption truncate">{label}</span>
      <span className={cx("tnum truncate font-mono font-semibold", VALUE_SIZE[size], tone === "neutral" ? "text-ink" : TEXT_TONE[tone])}>{value}</span>
      {hint ? <span className="text-[13px] leading-snug text-ink-3">{hint}</span> : null}
    </div>
  );
}
