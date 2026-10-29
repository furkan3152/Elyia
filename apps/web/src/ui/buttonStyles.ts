import { cx, FOCUS_RING } from "./cx";

export type ButtonVariant = "primary" | "violet" | "soft" | "gold" | "ghost" | "outline" | "danger" | "long" | "short";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,border-color,color,box-shadow,transform,filter] duration-fast ease-pluck active:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-violet-fill text-ink-violet shadow-[0_10px_28px_-12px_rgb(var(--violet)/0.75)] hover:brightness-110",
  violet: "bg-violet-fill text-ink-violet shadow-[0_10px_28px_-12px_rgb(var(--violet)/0.75)] hover:brightness-110",
  soft: "border border-violet-glow/40 bg-violet/15 text-text-0 hover:bg-violet/25",
  gold: "bg-gold-fill text-ink-gold shadow-[0_10px_28px_-14px_rgb(var(--gold)/0.8)] hover:brightness-105",
  ghost: "bg-transparent text-text-1 hover:bg-text-0/[0.06] hover:text-text-0",
  outline: "border border-line-strong bg-bg-1/50 text-text-0 hover:border-violet-glow/40 hover:bg-bg-2",
  danger: "border border-rose/40 bg-rose/10 text-rose hover:bg-rose/[0.18]",
  long: "bg-mint-fill text-ink-mint hover:brightness-105",
  short: "bg-rose-fill text-ink-rose hover:brightness-105",
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 rounded-md px-2.5 text-xs",
  sm: "h-8 rounded-md px-3 text-[13px]",
  md: "h-10 rounded-lg px-4 text-sm",
  lg: "h-12 rounded-xl px-5 text-[15px]",
  xl: "h-14 rounded-xl px-6 text-base",
};

const ICON_SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 w-7 rounded-md",
  sm: "h-8 w-8 rounded-md",
  md: "h-10 w-10 rounded-lg",
  lg: "h-12 w-12 rounded-xl",
  xl: "h-14 w-14 rounded-xl",
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
  return cx(BASE, FOCUS_RING, VARIANTS[variant], iconOnly ? ICON_SIZES[size] : SIZES[size], fullWidth && "w-full", className);
}
