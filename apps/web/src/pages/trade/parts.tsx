/**
 * Small pixel pieces the terminal repeats: framed panels, Silkscreen
 * captions, up/down chevrons (never colour alone), side marks and key hints.
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
 * A terminal panel in pixel dress: card stock inside a 4 px stepped frame
 * (corners cut), a Silkscreen head ruled off by a dashed pixel seam. Dense
 * panels stay flat; the ticket is the one raised card (a block drop).
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
    <Element aria-label={label} className={cx("px-frame relative flex min-h-0 min-w-0 flex-col bg-card", raised && "px-drop-lg", className)}>
      {title !== undefined ? (
        <header className="tx-seam-b flex h-9 shrink-0 items-center justify-between gap-3 px-3">
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
    <span className={cx("inline-flex items-center gap-1 font-tag text-[11px] tracking-[0.04em]", long ? "text-up" : "text-down", className)}>
      <span aria-hidden="true">{long ? "▲" : "▼"}</span>
      {spot ? (long ? "BUY" : "SELL") : long ? "LONG" : "SHORT"}
    </span>
  );
}

/** Mono "key · label" pair used in the hotkey legend and button hints. */
export function KeyHint({ k, className }: { readonly k: string; readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center px-1 font-tag text-[10px] leading-none opacity-80 [box-shadow:inset_0_0_0_2px_currentColor]", className)}>
      {k}
    </span>
  );
}
