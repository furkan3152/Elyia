import React from "react";

import { cx } from "./cx";

export type PanelVariant = "flat" | "glass" | "raised" | "glow";
export type PanelPadding = "none" | "sm" | "md" | "lg";

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  readonly variant?: PanelVariant;
  readonly padding?: PanelPadding;
  /** Element to render (section for landmarks, article for feed items). */
  readonly as?: "div" | "section" | "article" | "aside" | "li";
  /** Adds a hover lift for clickable cards. */
  readonly interactive?: boolean;
}

const VARIANTS: Readonly<Record<PanelVariant, string>> = {
  flat: "bg-bg-1 border border-line",
  glass: "glass border border-line shadow-panel",
  raised: "border border-line bg-gradient-to-b from-bg-2/90 to-bg-1/90 shadow-raised",
  glow: "border border-violet-glow/25 bg-gradient-to-b from-bg-2/95 to-bg-1/95 shadow-glow-violet",
};

const PADDING: Readonly<Record<PanelPadding, string>> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6 sm:p-7",
};

/**
 * Surface for grouped content. `flat` for dense app panels, `glass` over the
 * aurora, `raised` for primary cards, `glow` for the one thing that matters
 * on a screen. `Card` is the same component.
 */
export const Panel = React.forwardRef<HTMLElement, PanelProps>(function Panel(
  { variant = "flat", padding = "md", as = "div", interactive = false, className, ...rest },
  ref,
) {
  const Element = as as React.ElementType;
  return (
    <Element
      ref={ref}
      className={cx(
        "relative rounded-2xl",
        VARIANTS[variant],
        PADDING[padding],
        interactive && "transition-[border-color,transform,background-color] duration-base ease-pluck hover:-translate-y-0.5 hover:border-violet-glow/30",
        className,
      )}
      {...rest}
    />
  );
});

export const Card = Panel;

export interface PanelHeaderProps {
  /** Eyebrow-style title ("NET WORTH · 3 LAYERS"). */
  readonly title: React.ReactNode;
  /** Right side: a status, a link, a small control. */
  readonly aside?: React.ReactNode;
  readonly id?: string;
  readonly className?: string;
}

/** The mono caps header row used by every app panel. */
export function PanelHeader({ title, aside, id, className }: PanelHeaderProps) {
  return (
    <div className={cx("mb-4 flex min-h-6 items-center justify-between gap-3", className)}>
      <h2 id={id} className="label-caps truncate">
        {title}
      </h2>
      {aside ? <div className="flex shrink-0 items-center gap-2 text-xs text-text-2">{aside}</div> : null}
    </div>
  );
}
