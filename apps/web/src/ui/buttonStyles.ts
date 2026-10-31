import { cx, FOCUS_RING } from "./cx";

/**
 * Pixel Survey button variants. Every framed button is a 4 px stepped pixel
 * frame (2 px at xs/sm) with one block drop; hover lifts it 2 px, pressing
 * pushes it 2 px. Labels are Pixelify Sans.
 * - primary: THE action of a view. Glacier fill.
 * - signpost: sun-yellow wayfinding ("go there" links, suggestions).
 * - ink: card stock (the secondary action).
 * - solid-ink: an ink block with paper text (strong neutral, selected).
 * - danger: rope-red frame and words; destructive or risky.
 * - ghost: no frame (toolbars, dense rows).
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
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-display font-bold tracking-[0.02em] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const FRAMED = "px-frame px-drop px-press";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: cx(FRAMED, "bg-accent text-accent-ink"),
  violet: cx(FRAMED, "bg-accent text-accent-ink"),
  gold: cx(FRAMED, "bg-accent text-accent-ink"),
  signpost: cx(FRAMED, "bg-signal text-signal-ink"),
  ink: cx(FRAMED, "bg-card text-ink hover:bg-paper-2"),
  soft: cx(FRAMED, "bg-card text-ink hover:bg-paper-2"),
  outline: cx(FRAMED, "bg-card text-ink hover:bg-paper-2"),
  "solid-ink": cx(FRAMED, "bg-ink text-paper"),
  danger: cx(FRAMED, "px-tone-down bg-card text-down hover:bg-down hover:text-card"),
  ghost: "bg-transparent text-ink-2 transition-colors duration-fast hover:bg-paper-2 hover:text-ink",
  long: cx(FRAMED, "bg-up text-card"),
  short: cx(FRAMED, "bg-down text-card"),
};

/** xs and sm use the 2 px frame so dense rows stay readable. */
const THIN: Readonly<Record<ButtonSize, boolean>> = { xs: true, sm: true, md: false, lg: false, xl: false };

const SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 px-2.5 text-[13px]",
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-[15px]",
  lg: "h-12 px-5 text-[17px]",
  xl: "h-14 px-6 text-lg",
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
  return cx(BASE, FOCUS_RING, VARIANTS[variant], THIN[size] && variant !== "ghost" && "px-frame-thin", iconOnly ? cx(ICON_SIZES[size], "px-0") : SIZES[size], fullWidth && "w-full", className);
}
