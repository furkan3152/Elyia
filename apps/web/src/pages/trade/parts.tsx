/**
 * Small Survey pieces the terminal repeats: ruled panel frames, mono
 * captions, up/down chevrons (never colour alone), hatched depth fills and
 * the leverage-to-grade mapping the blazes read.
 */
import React, { type ReactNode } from "react";

import { cx } from "../../ui/cx";


/** "A · B · C" in mono micro-caps. */
export function Caption({ parts, className, tone = "ink-2" }: { readonly parts: readonly ReactNode[]; readonly className?: string; readonly tone?: "ink" | "ink-2" | "ink-3" }) {
  return (
    <span className={cx("caption whitespace-nowrap", tone === "ink" ? "!text-ink" : tone === "ink-3" ? "!text-ink-3" : "", className)}>
      {parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "").map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * A ruled panel on the sheet: card stock, 2 px ink border, a mono caps
 * header row ruled underneath. Dense terminal panels stay flat; the ticket
 * is the one raised card.
 */
export function Frame({
  title,
  aside,
  children,
  className,
  bodyClassName,
  label,
  raised = false,
  as = "section",
}: {
  readonly title?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  /** Accessible name of the region. */
  readonly label?: string;
  readonly raised?: boolean;
  readonly as?: "section" | "aside" | "div";
}) {
  const Element = as;
  return (
    <Element aria-label={label} className={cx("relative flex min-h-0 min-w-0 flex-col border-2 border-rule bg-card", raised && "shadow-hard-lg", className)}>
      {title !== undefined ? (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b-1.5 border-rule px-3">
          <h2 className="min-w-0 truncate">{title}</h2>
          {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div className={cx("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </Element>
  );
}

/** ▲ / ▼ by sign (stacked twice for a strong move). Decorative; the number next to it carries the sign. */
export function Chevron({ value, strong = 0.05, className }: { readonly value: number | null | undefined; readonly strong?: number; readonly className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return <span aria-hidden="true" className={cx("text-ink-3", className)}>·</span>;
  const up = value > 0;
  const glyph = up ? "▲" : "▼";
  return (
    <span aria-hidden="true" className={cx("inline-block leading-none", up ? "text-up" : "text-down", className)}>
      {Math.abs(value) >= strong ? glyph + glyph : glyph}
    </span>
  );
}

/** "▲ LONG" / "▼ SHORT" (or BUY / SELL on spot). */
export function SideMark({ long, spot = false, className }: { readonly long: boolean; readonly spot?: boolean; readonly className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 font-mono text-[11px] font-semibold tracking-[0.08em]", long ? "text-up" : "text-down", className)}>
      <span aria-hidden="true">{long ? "▲" : "▼"}</span>
      {spot ? (long ? "BUY" : "SELL") : long ? "LONG" : "SHORT"}
    </span>
  );
}

/** Mono "key · label" pair used in the hotkey legend and button hints. */
export function KeyHint({ k, className }: { readonly k: string; readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center border-1.5 border-current px-1 font-mono text-[10px] font-semibold leading-none opacity-80", className)}>
      {k}
    </span>
  );
}
