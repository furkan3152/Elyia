import { cx } from "../../ui/cx";

export interface ElyiaMarkProps {
  readonly size?: number;
  /** Single-colour version (currentColor) for monochrome contexts. */
  readonly mono?: boolean;
  /** Accessible name; omit when a visible wordmark sits next to it. */
  readonly title?: string;
  readonly className?: string;
}

/**
 * The Elyia mark (Survey): a map sheet with one ridgeline drawn on it and a
 * glacier line at its foot, the three layers in one stroke. Never Elysium's,
 * Kinetiq's or Hyperliquid's marks.
 */
export function ElyiaMark({ size = 30, mono = false, title, className }: ElyiaMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={cx("shrink-0", className)}>
      <rect x="1" y="1" width="28" height="28" fill={mono ? "none" : "rgb(var(--card))"} stroke="currentColor" strokeWidth="2" />
      <path d="M4 22 L11 12 L15 17 L20 8 L26 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />
      <path d="M4 26 h22" stroke={mono ? "currentColor" : "rgb(var(--accent-line))"} strokeWidth="2" />
    </svg>
  );
}

export interface ElyiaLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

/** Mark + "Elyia" wordmark in Space Grotesk. */
export function ElyiaLogo({ size = "md", className }: ElyiaLogoProps) {
  const mark = size === "sm" ? 26 : size === "lg" ? 36 : 30;
  const text = size === "sm" ? "text-[20px]" : size === "lg" ? "text-[28px]" : "text-[23px]";
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-ink", className)}>
      <ElyiaMark size={mark} />
      <span className={cx("font-bold leading-none tracking-[-0.01em]", text)}>Elyia</span>
    </span>
  );
}
