import React from "react";

import { cx } from "../ui/cx";

/* Map furniture: north arrow, scale bar, key. ---------------------------- */

export interface NorthArrowProps {
  readonly size?: number;
  readonly className?: string;
}

/** A surveyor's north arrow: a split needle, the dark half pointing north, and "N". */
export function NorthArrow({ size = 34, className }: NorthArrowProps) {
  return (
    <svg width={size * 0.6} height={size} viewBox="0 0 20 34" role="img" aria-label="North" className={cx("shrink-0 text-ink", className)}>
      <path d="M10 1 16 22 10 18Z" fill="currentColor" />
      <path d="M10 1 4 22 10 18Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <text x="10" y="32" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" fontWeight="600" fill="currentColor">
        N
      </text>
    </svg>
  );
}

export interface ScaleBarProps {
  /** Labels under the ticks, left to right ("0", "$5k", "$10k"). */
  readonly labels: readonly string[];
  /** px */
  readonly width?: number;
  readonly className?: string;
  /** Accessible description ("Scale: 160 px is $10,000"). */
  readonly label?: string;
}

/** Alternating ink and paper blocks with tick labels, like the bar on a survey sheet. */
export function ScaleBar({ labels, width = 140, className, label }: ScaleBarProps) {
  const segments = Math.max(1, labels.length - 1);
  const segment = width / segments;
  return (
    <svg width={width + 24} height="30" viewBox={`-12 0 ${width + 24} 30`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx("shrink-0 overflow-visible text-ink", className)}>
      {Array.from({ length: segments }, (_, index) => (
        <rect key={index} x={index * segment} y="4" width={segment} height="5" fill={index % 2 === 0 ? "currentColor" : "rgb(var(--card))"} stroke="currentColor" strokeWidth="1.2" />
      ))}
      {labels.map((text, index) => (
        <text key={text} x={index * segment} y="22" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="currentColor">
          {text}
        </text>
      ))}
    </svg>
  );
}

export interface MapKeyItem {
  /** A small SVG swatch (16 x 10 viewBox) or any node. */
  readonly swatch: React.ReactNode;
  readonly label: React.ReactNode;
}

export interface MapKeyProps {
  readonly items: readonly MapKeyItem[];
  readonly title?: string;
  readonly className?: string;
}

/** The legend box every visual encoding gets. */
export function MapKey({ items, title = "KEY", className }: MapKeyProps) {
  return (
    <div className={cx("inline-flex flex-col gap-1 bg-card px-2.5 py-2 font-mono text-[11px] text-ink-2 px-frame-thin", className)}>
      <span className="font-tag text-ink">{title}</span>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-flex w-6 shrink-0 items-center justify-center">
              {item.swatch}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* The sheet frame. -------------------------------------------------------- */

export interface TitleBlock {
  readonly name: string;
  /** Default "1 : 25 000". */
  readonly scale?: string;
  readonly date?: string;
  /** Default "Elyia". */
  readonly surveyor?: string;
  readonly mode?: string;
}

export interface MapSheetProps {
  /** Top-left sheet label, e.g. "SHEET 03 · YOUR RANGE". */
  readonly label: React.ReactNode;
  /** Top-right live elevation slot (the current Elysium block, net worth...). */
  readonly elevation?: React.ReactNode;
  /** Cartographic title block, bottom right. */
  readonly titleBlock?: TitleBlock;
  /** Bottom-left furniture (scale bar, key). */
  readonly furniture?: React.ReactNode;
  /** Coordinate ticks on the neat-line (default true). */
  readonly ticks?: boolean;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly children: React.ReactNode;
  /** Element (section for landmarks). */
  readonly as?: "div" | "section" | "figure";
  readonly "aria-label"?: string;
}

/**
 * A map sheet: the frame every Survey surface sits in. Ink neat-line with
 * coordinate tick marks, the sheet label, a live elevation slot, and a
 * cartographic title block. Furniture (scale bar, key, north arrow) goes in
 * `furniture`.
 */
export function MapSheet({ label, elevation, titleBlock, furniture, ticks = true, className, bodyClassName, children, as = "section", ...rest }: MapSheetProps) {
  const Element = as;
  return (
    <Element className={cx("relative bg-card px-frame px-drop", className)} aria-label={rest["aria-label"]}>
      {ticks ? <span aria-hidden="true" className="el-neat-ticks pointer-events-none absolute inset-[5px]" /> : null}
      <div className="relative flex min-h-[34px] flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-2 border-rule px-4 py-1.5 font-tag text-[11px] uppercase text-ink-2">
        <span className="text-ink">{label}</span>
        {elevation ? <span className="tnum normal-case tracking-normal">{elevation}</span> : null}
      </div>
      <div className={cx("relative", bodyClassName)}>{children}</div>
      {furniture || titleBlock ? (
        <div className="relative flex flex-wrap items-end justify-between gap-3 border-t-2 border-rule px-4 py-2.5">
          <div className="flex flex-wrap items-end gap-4">{furniture}</div>
          {titleBlock ? <TitleBlockBox block={titleBlock} /> : null}
        </div>
      ) : null}
    </Element>
  );
}

export function TitleBlockBox({ block, className }: { readonly block: TitleBlock; readonly className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[auto_auto] bg-card font-mono text-[11px] leading-tight text-ink-2 px-frame-thin", className)}>
      <dt className="col-span-2 bg-ink px-2 py-1 font-tag uppercase text-paper">{block.name}</dt>
      <dt className="border-b border-r border-rule px-2 py-0.5 uppercase tracking-[0.1em]">Scale</dt>
      <dd className="tnum border-b border-rule px-2 py-0.5 text-ink">{block.scale ?? "1 : 25 000"}</dd>
      {block.date ? (
        <>
          <dt className="border-b border-r border-rule px-2 py-0.5 uppercase tracking-[0.1em]">Date</dt>
          <dd className="tnum border-b border-rule px-2 py-0.5 text-ink">{block.date}</dd>
        </>
      ) : null}
      <dt className="border-r border-rule px-2 py-0.5 uppercase tracking-[0.1em]">Survey</dt>
      <dd className="px-2 py-0.5 text-ink">
        {block.surveyor ?? "Elyia"}
        {block.mode ? ` · ${block.mode}` : ""}
      </dd>
    </dl>
  );
}
