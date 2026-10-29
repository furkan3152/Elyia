import { cx, FOCUS_RING } from "./cx";

/**
 * Survey button variants:
 * - primary: THE action of a view. Filled glacier, 2 px ink border, hard shadow.
 * - signpost: a pointed wayfinding blade (yellow highlight): "go there" links, suggestions.
 * - ink: outline on card stock with a hard shadow (the secondary action).
 * - solid-ink: ink block with paper text (strong neutral, selected states).
 * - danger: red outline; destructive or risky.
 * - ghost: text only (toolbars, dense rows).
 * - long / short: trade sides (up / down fills).
 * Legacy names map onto these: violet/gold -> primary, soft/outline -> ink.
 */
export type ButtonVariant =
  | "primary"
  | "signpost"
  | "ink"
  | "solid-ink"
  | "danger"
  | "ghost"
  | "long"
  | "short"
  // legacy aliases
  | "violet"
  | "gold"
  | "soft"
  | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-sans font-bold uppercase tracking-[0.06em] transition-[background-color,border-color,color,box-shadow,transform] duration-instant ease-standard disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

/* Pressing pushes the sheet into its shadow: translate by the shadow, drop the shadow. */
const PRESS = "shadow-hard hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";

const PRIMARY = cx("border-2 border-rule bg-accent text-accent-ink", PRESS);
const INK = cx("border-2 border-rule bg-card text-ink hover:bg-paper-2", PRESS);

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: PRIMARY,
  violet: PRIMARY,
  gold: PRIMARY,
  signpost: "el-blade border-0 bg-signal pr-7 text-signal-ink hover:brightness-[1.04] active:translate-x-px",
  ink: INK,
  soft: INK,
  outline: INK,
  "solid-ink": cx("border-2 border-rule bg-ink text-paper", PRESS),
  danger: cx("border-2 border-down bg-card text-down hover:bg-down hover:text-card", PRESS),
  ghost: "border-2 border-transparent bg-transparent text-ink-2 hover:border-rule/25 hover:text-ink",
  long: cx("border-2 border-rule bg-up text-card", PRESS),
  short: cx("border-2 border-rule bg-down text-card", PRESS),
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 px-2.5 text-[11px]",
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-5 text-sm",
  xl: "h-14 px-6 text-[15px]",
};

const ICON_SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 w-7",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-14 w-14",
};

export interface ButtonStyleOptions {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly iconOnly?: boolean;
  readonly className?: string;
}

/** Class recipe shared by Button, ButtonLink and anything that must look like a button. */
export function buttonClasses({ variant = "primary", size = "md", fullWidth, iconOnly, className }: ButtonStyleOptions = {}): string {
  return cx(BASE, FOCUS_RING, VARIANTS[variant], iconOnly ? cx(ICON_SIZES[size], "px-0") : SIZES[size], fullWidth && "w-full", className);
}
