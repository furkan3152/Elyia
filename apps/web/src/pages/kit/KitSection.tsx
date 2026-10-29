import React from "react";

import { cx } from "../../ui/cx";

export interface KitSectionProps {
  readonly id: string;
  readonly title: string;
  readonly description: React.ReactNode;
  /** Import line and a minimal usage example. */
  readonly code?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** One documented block of the kit page: what it is, how to use it, a live example. */
export function KitSection({ id, title, description, code, className, children }: KitSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scroll-mt-24 border-t border-line py-10", className)}>
      <div className="mb-5 flex flex-col gap-2">
        <h2 id={`${id}-title`} className="font-display text-3xl text-text-0">
          {title}
        </h2>
        <div className="max-w-3xl text-sm leading-relaxed text-text-1">{description}</div>
      </div>
      {code ? (
        <pre className="mb-5 overflow-x-auto rounded-xl border border-line bg-bg-0/70 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-1">
          <code>{code}</code>
        </pre>
      ) : null}
      <div>{children}</div>
    </section>
  );
}

export function Swatch({ name, className, note }: { readonly name: string; readonly className: string; readonly note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-bg-1/60 p-2.5">
      <span aria-hidden="true" className={cx("h-10 w-10 shrink-0 rounded-lg border border-line", className)} />
      <span className="min-w-0">
        <span className="block font-mono text-xs text-text-0">{name}</span>
        {note ? <span className="block truncate text-xs text-text-2">{note}</span> : null}
      </span>
    </div>
  );
}
