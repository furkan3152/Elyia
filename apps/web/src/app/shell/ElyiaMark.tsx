import { useId } from "react";

import { cx } from "../../ui/cx";

export interface ElyiaMarkProps {
  readonly size?: number;
  /** Single-colour version (currentColor) for tiny sizes and monochrome contexts. */
  readonly mono?: boolean;
  /** Accessible name; omit when a visible wordmark sits next to it. */
  readonly title?: string;
  readonly className?: string;
}

/*
 * Seven strings whose tops trace a rising sun's disc (x, top y), standing on a
 * horizon bar. Spacing 7/3 around the centre string.
 */
const STRINGS: ReadonlyArray<readonly [number, number]> = [
  [13, 22.9],
  [15.33, 20],
  [17.67, 18.5],
  [20, 18],
  [22.33, 18.5],
  [24.67, 20],
  [27, 22.9],
];

/**
 * The Elyia mark (original): a lyre whose two curved arms rise into an arc
 * like a rising sun, seven strings standing on the horizon, and a small star
 * in the gap at the top. Never Elysium's, Kinetiq's or Hyperliquid's marks.
 */
export function ElyiaMark({ size = 32, mono = false, title, className }: ElyiaMarkProps) {
  const id = useId();
  const arm = mono ? "currentColor" : `url(#${id}-arm)`;
  const string = mono ? "currentColor" : "rgb(var(--violet-glow))";
  const center = mono ? "currentColor" : "rgb(var(--text-0))";
  const gold = mono ? "currentColor" : "rgb(var(--gold))";
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={cx("shrink-0", className)}>
      {mono ? null : (
        <defs>
          <linearGradient id={`${id}-arm`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE7B0" />
            <stop offset="45%" stopColor="#F5C66B" />
            <stop offset="100%" stopColor="#E0A93B" />
          </linearGradient>
        </defs>
      )}
      <path d="M10.6 34.6C5.4 27 6.3 15.6 16.9 11.9" fill="none" stroke={arm} strokeWidth="2.3" strokeLinecap="round" />
      <path d="M29.4 34.6C34.6 27 33.7 15.6 23.1 11.9" fill="none" stroke={arm} strokeWidth="2.3" strokeLinecap="round" />
      <path d="M9.2 35H30.8" stroke={mono ? "currentColor" : "rgb(var(--gold-deep))"} strokeWidth="2.4" strokeLinecap="round" />
      {STRINGS.map(([x, top]) => (
        <line key={x} x1={x} y1={top} x2={x} y2="33.6" stroke={x === 20 ? center : string} strokeWidth={x === 20 ? 1.35 : 1.1} strokeLinecap="round" />
      ))}
      <path d="M20 4.9 20.85 7.65 23.6 8.5 20.85 9.35 20 12.1 19.15 9.35 16.4 8.5 19.15 7.65Z" fill={gold} />
    </svg>
  );
}

export interface ElyiaLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

/** Mark + "Elyia" wordmark in Instrument Serif. */
export function ElyiaLogo({ size = "md", className }: ElyiaLogoProps) {
  const mark = size === "sm" ? 26 : size === "lg" ? 40 : 32;
  const text = size === "sm" ? "text-[24px]" : size === "lg" ? "text-[34px]" : "text-[29px]";
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-text-0", className)}>
      <ElyiaMark size={mark} />
      <span className={cx("font-display leading-none tracking-[0.01em]", text)}>Elyia</span>
    </span>
  );
}
