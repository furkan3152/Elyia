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
  return <div className={cx("mx-auto w-full px-4 pt-5 sm:px-6 sm:pt-8 lg:px-8", WIDTH[width], className)}>{children}</div>;
}

export interface PageHeaderProps {
  readonly title: React.ReactNode;
  /** The label tab above the title ("ROUTE CARD · 3 WAYPOINTS"). */
  readonly eyebrow?: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Right side: primary actions. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

/** Page header (Survey): label tab, big Space Grotesk title, one line of description, actions. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cx("mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="label-tab mb-4">{eyebrow}</p> : null}
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[40px]">{title}</h1>
        {description ? <p className="mt-2.5 max-w-2xl text-[17px] leading-relaxed text-ink-2 text-pretty">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
