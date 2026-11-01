import React from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { isApplePlatform } from "../../ui/platform";
import { Link } from "../routes/Link";
import { ElyiaLogo } from "./ElyiaMark";

/** Nav link: Silkscreen caps; the current page carries a 4 px glacier pixel underline. */
export const NAV_LINK =
  "relative inline-flex h-[76px] items-center font-tag text-[13px] uppercase tracking-[0.04em] text-ink-2 hover:text-ink aria-[current=page]:text-ink after:absolute after:inset-x-0 after:bottom-[20px] after:h-1 after:bg-accent after:opacity-0 aria-[current=page]:after:opacity-100";

/** "WHERE TO? ⌘K": opens the command dialog. */
export function WhereToTrigger({ className }: { readonly className?: string }) {
  const apple = isApplePlatform();
  return (
    <button
      type="button"
      onClick={() => useOracleStore.getState().openOracle()}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      className={cx("inline-flex h-9 min-w-0 items-stretch bg-card text-left px-frame-thin px-drop px-press", FOCUS_RING, className)}
    >
      <span className="flex items-center bg-ink px-2.5 font-tag text-[11px] uppercase text-paper">Where to?</span>
      <span className="flex items-center gap-1 px-2" aria-hidden="true">
        <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

export interface HeaderSplit {
  /** The page's rail or side-nav width (px): the brand column matches it. */
  readonly rail: number;
  /** The page frame's max width (px), when the rail sits inside a centred frame; full width otherwise. */
  readonly max?: number;
}

export interface HeaderGridProps {
  /** Where the logo goes ("/" on the site, the deck in the app). */
  readonly home: string;
  readonly homeLabel: string;
  /** The centred nav (hidden under lg). */
  readonly nav: React.ReactNode;
  readonly navLabel: string;
  /** Right side, right-aligned. */
  readonly actions: React.ReactNode;
  /** The thin strip under the header (layer heads), centred. */
  readonly strip?: React.ReactNode;
  readonly sticky?: boolean;
  /**
   * Pages with a rail or side nav (Ask Ely, developers, owner console): from
   * xl up (where the nav and the actions fit beside the rail) the brand column is the rail's width and the nav (and the strip's
   * layer heads) centre on the content axis, not the window (DESIGN.md §1).
   */
  readonly split?: HeaderSplit | null;
}

/**
 * The header on one centre axis: logo left, nav centred, actions right, in a
 * 1fr · auto · 1fr grid so the nav sits exactly on the page axis whatever the
 * two sides hold. With `split`, the axis is the content column's: a
 * rail-wide brand column, then 1fr · auto · 1fr over the content. Card stock
 * with a thin 2 px tone line under it (no ink rule), then the layer strip: a
 * subtle tinted band with the same line.
 */
export function HeaderGrid({ home, homeLabel, nav, navLabel, actions, strip, sticky = false, split = null }: HeaderGridProps) {
  const frame = split ? { maxWidth: split.max ? `${split.max}px` : undefined, ["--hdr-rail" as string]: `${split.rail}px` } : undefined;
  return (
    <header className={cx("relative z-40 bg-card", sticky && "sticky top-0")}>
      <div
        style={frame}
        className={cx(
          "mx-auto grid h-[76px] grid-cols-[1fr_auto] items-center gap-4 px-6",
          "max-w-[1248px] lg:grid-cols-[1fr_auto_1fr]",
          split && "xl:max-w-none xl:grid-cols-[var(--hdr-rail)_minmax(0,1fr)_auto_minmax(0,1fr)] xl:gap-0 xl:px-0",
        )}
      >
        <Link to={home} aria-label={homeLabel} className={cx("inline-flex justify-self-start", split && "xl:ml-6", FOCUS_RING)}>
          <ElyiaLogo size="sm" className="sm:hidden" />
          <ElyiaLogo className="hidden sm:inline-flex" />
        </Link>
        <nav aria-label={navLabel} className={cx("hidden items-center gap-7 lg:flex", split && "xl:col-start-3")}>
          {nav}
        </nav>
        <div className={cx("flex min-w-0 items-center justify-self-end gap-2 sm:gap-3", split && "xl:col-start-4 xl:mr-6 xl:pl-4")}>{actions}</div>
      </div>
      <div aria-hidden="true" className="h-[2px] bg-rule" />
      {strip ? (
        <div className="border-b-2 border-rule bg-paper-2/60">
          <div
            style={frame}
            className={cx(
              "hdr-strip mx-auto grid h-8 max-w-[1248px] grid-cols-[1fr_auto] items-center gap-3 px-6 font-tag text-[11px] uppercase sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
              split && "hdr-strip-split xl:max-w-none xl:grid-cols-[var(--hdr-rail)_minmax(0,1fr)_auto_minmax(0,1fr)] xl:gap-0 xl:px-0",
            )}
          >
            {strip}
          </div>
        </div>
      ) : null}
    </header>
  );
}
