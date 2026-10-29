import React from "react";

import { cx } from "../../ui/cx";

export interface KeySectionProps {
  readonly id: string;
  /** "05". */
  readonly number: string;
  readonly title: string;
  readonly description?: React.ReactNode;
  /** The import line feature code uses. */
  readonly importLine?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/** One entry of the map key: number · title, a line of what it is for, the import, then the specimens. */
export function KeySection({ id, number, title, description, importLine, children, className }: KeySectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scroll-mt-28 border-t-2 border-rule pt-8", className)}>
      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
        <h2 id={`${id}-title`} className="text-[28px] font-bold uppercase leading-none tracking-[0.01em] text-ink sm:text-[32px]">
          <span className="tnum font-mono text-[15px] font-semibold tracking-[0.1em] text-ink-3">{number} · </span>
          {title}
        </h2>
        <div className="flex min-w-0 flex-col gap-2 lg:items-end lg:text-right">
          {description ? <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">{description}</p> : null}
          {importLine ? <code className="max-w-full truncate border-1.5 border-rule/40 bg-card px-2 py-1 font-mono text-[11px] text-ink-2">{importLine}</code> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A labelled specimen cell. */
export function Specimen({ label, children, className }: { readonly label: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-3", className)}>
      <p className="caption">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
