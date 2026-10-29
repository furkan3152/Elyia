import React from "react";

import { cx } from "../../ui/cx";

export interface PageProps {
  /** "wide" (default, 1440 px), "full" (terminal), "narrow" (forms, settings). */
  readonly width?: "wide" | "full" | "narrow";
  readonly className?: string;
  readonly children: React.ReactNode;
}

const WIDTH = { wide: "max-w-[1440px]", full: "max-w-none", narrow: "max-w-3xl" } as const;

/** The page container inside the deck shell: consistent gutters and max width. */
export function Page({ width = "wide", className, children }: PageProps) {
  return <div className={cx("mx-auto w-full px-3 pt-4 sm:px-5 sm:pt-6 lg:px-7", WIDTH[width], className)}>{children}</div>;
}

export interface PageHeaderProps {
  readonly title: React.ReactNode;
  /** Gold mono caps line above the title. */
  readonly eyebrow?: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Right side: primary actions. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

/** Optional page header: eyebrow, serif title, one line of description, actions. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cx("mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-display-sm text-text-0">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-text-1 text-pretty">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
