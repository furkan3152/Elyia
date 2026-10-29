import React from "react";

import { Blaze } from "../topo/Blaze";
import type { Grade } from "../topo/geometry/conditions";
import type { Layer } from "../topo/geometry/relief";
import { cx, FOCUS_RING } from "./cx";
import { DOT_TONE, OUTLINE_TONE, SOFT_TONE, SOLID_TONE, type Tone } from "./tones";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  readonly variant?: "soft" | "outline" | "solid";
  readonly size?: "sm" | "md";
  /** Leading status dot. `pulse` breathes slowly (one breath per 4 s), never flashes. */
  readonly dot?: boolean | "pulse";
  readonly mono?: boolean;
}

const VARIANT = { soft: SOFT_TONE, outline: OUTLINE_TONE, solid: SOLID_TONE } as const;

/** Static label: status, network, "sample", "live". Square, bordered, mono caps. */
export function Badge({ tone = "neutral", variant = "soft", size = "sm", dot = false, mono = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-1.5",
        size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
        mono && "font-mono uppercase tracking-[0.08em]",
        VARIANT[variant][tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className={cx("h-1.5 w-1.5", DOT_TONE[tone], dot === "pulse" && "el-loop animate-breathe")} /> : null}
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
 * Interactive token: example intents, filters and presets. With `selected`
 * it is a toggle button (aria-pressed) and turns into an ink block.
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
        "inline-flex min-h-8 items-center gap-1.5 border-1.5 px-2.5 py-1 text-left text-[13px] transition-[background-color,border-color,color,transform] duration-fast ease-standard active:translate-y-px",
        mono && "font-mono text-xs",
        selected ? "border-rule bg-ink text-paper" : cx(SOFT_TONE[tone], "hover:border-rule hover:text-ink"),
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface TagProps {
  readonly children: React.ReactNode;
  /** Leading glyph (a Blaze, a LayerMark). */
  readonly icon?: React.ReactNode;
  readonly className?: string;
  readonly as?: "span" | "p" | "div";
}

/**
 * The label tab above a headline (Kletia lineage): a bordered mono caps box
 * with a hard shadow. Separate parts with " · ".
 */
export function Tag({ children, icon, className, as = "span" }: TagProps) {
  const Element = as;
  return (
    <Element className={cx("label-tab", className)}>
      {icon}
      <span className="min-w-0">{children}</span>
    </Element>
  );
}

const LAYER_TONE_CLASS: Readonly<Record<Layer, string>> = {
  floor: "text-floor",
  ridge: "text-ridge",
  summit: "text-summit-ink",
};
const LAYER_FILL: Readonly<Record<Layer, string>> = { floor: "bg-floor", ridge: "bg-ridge", summit: "bg-summit-ink" };
const LAYER_LABEL: Readonly<Record<Layer, string>> = { floor: "FLOOR", ridge: "RIDGE", summit: "SUMMIT" };
const LAYER_NETWORK: Readonly<Record<Layer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };

export interface LayerChipProps {
  readonly layer: Layer;
  /** Show the network name after the altitude ("FLOOR · HyperCore"). */
  readonly network?: boolean;
  /** "solid" fills with the altitude colour (badges on maps); "plain" is coloured caps. */
  readonly variant?: "plain" | "solid";
  readonly className?: string;
}

/** Altitude chip: FLOOR (HyperCore), RIDGE (HyperEVM), SUMMIT (Elysium), coloured by layer. */
export function LayerChip({ layer, network = false, variant = "plain", className }: LayerChipProps) {
  if (variant === "solid") {
    return (
      <span className={cx("inline-flex h-6 items-center gap-1.5 border-1.5 border-rule px-2 font-mono text-[11px] font-semibold tracking-[0.1em] text-card", LAYER_FILL[layer], className)}>
        {LAYER_LABEL[layer]}
        {network ? <span className="font-normal tracking-normal opacity-90">· {LAYER_NETWORK[layer]}</span> : null}
      </span>
    );
  }
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap font-sans text-[13px] font-bold tracking-[0.04em]", LAYER_TONE_CLASS[layer], className)}>
      <span aria-hidden="true" className={cx("h-2 w-2 rotate-45", LAYER_FILL[layer])} />
      {LAYER_LABEL[layer]}
      {network ? <span className="font-medium text-ink-2">· {LAYER_NETWORK[layer]}</span> : null}
    </span>
  );
}

export interface GradeChipProps {
  readonly grade: Grade;
  readonly className?: string;
}

/** Route grade chip: the blaze and "GRADE T3". */
export function GradeChip({ grade, className }: GradeChipProps) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 border-1.5 border-rule bg-card px-2 font-mono text-[11px] font-semibold tracking-[0.1em] text-ink", className)}>
      <Blaze grade={grade} size={12} label={null} />
      GRADE T{grade}
    </span>
  );
}
