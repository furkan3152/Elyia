import React from "react";

import { cx, FOCUS_RING } from "./cx";
import { DOT_TONE, OUTLINE_TONE, SOFT_TONE, SOLID_TONE, type Tone } from "./tones";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  readonly variant?: "soft" | "outline" | "solid";
  readonly size?: "sm" | "md";
  /** Leading status dot. `pulse` breathes slowly (about once per 6 s), never flashes. */
  readonly dot?: boolean | "pulse";
  readonly mono?: boolean;
}

const VARIANT = { soft: SOFT_TONE, outline: OUTLINE_TONE, solid: SOLID_TONE } as const;

/** Static label: status, network, "demo", "live". */
export function Badge({ tone = "neutral", variant = "soft", size = "sm", dot = false, mono = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
        mono && "font-mono tracking-[0.02em]",
        VARIANT[variant][tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", DOT_TONE[tone], dot === "pulse" && "el-loop animate-breathe")} />
      ) : null}
      {children}
    </span>
  );
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: Tone;
  /** Toggle chips show their pressed state (filters, presets). */
  readonly selected?: boolean;
  readonly mono?: boolean;
}

/**
 * Interactive token: Oracle chips, example prompts, filters and presets.
 * With `selected` it is a toggle button (aria-pressed).
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { tone = "neutral", selected, mono = false, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cx(
        "inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-3 py-1 text-left text-[13px] transition-[background-color,border-color,color] duration-fast ease-pluck",
        mono && "font-mono text-xs",
        selected ? SOFT_TONE[tone === "neutral" ? "violet" : tone] : cx(SOFT_TONE[tone], "hover:border-violet-glow/40 hover:text-text-0"),
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
