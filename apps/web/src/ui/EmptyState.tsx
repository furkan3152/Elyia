import React from "react";

import { openOracle } from "../oracle/oracleStore";
import { Chip } from "./Badge";
import { cx } from "./cx";

export interface EmptyStateProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Replaces the drawn scene with your own small glyph. */
  readonly icon?: React.ReactNode;
  /** The drawn scene: an empty summit with its flag (default), a quiet trail, or a blank map. */
  readonly scene?: "summit" | "trail" | "map";
  /** An example sentence that teaches what to do; clicking it opens "Where to?" with it. */
  readonly example?: string;
  /** The one action (a Button or ButtonLink). */
  readonly action?: React.ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

/** A small hand-drawn scene in contour ink: nothing on the map yet. */
function Scene({ scene, compact }: { readonly scene: NonNullable<EmptyStateProps["scene"]>; readonly compact: boolean }) {
  const width = compact ? 96 : 132;
  return (
    <svg width={width} height={width * 0.56} viewBox="0 0 132 74" aria-hidden="true" className="overflow-visible text-contour">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {scene === "map" ? (
          <>
            <path d="M8 14 44 6l44 8 36-8v54l-36 8-44-8-36 8Z" strokeWidth="1.6" className="text-ink" stroke="currentColor" />
            <path d="M44 6v54M88 14v54" strokeWidth="1" strokeDasharray="2 3" />
            <path d="M22 40c6-10 18-12 24-4s14 10 22 2" strokeWidth="1.2" opacity="0.7" />
            <path d="M28 44c4-5 10-6 14-2" strokeWidth="1.2" opacity="0.5" />
          </>
        ) : (
          <>
            <path d="M4 66c14-2 22-14 34-26s22-26 30-26 18 14 28 24 18 22 32 26" strokeWidth="1.6" opacity="0.9" />
            <path d="M22 66c10-4 16-12 24-20s16-18 22-18 12 9 20 16 14 16 22 20" strokeWidth="1.1" opacity="0.6" />
            <path d="M42 66c6-4 10-8 15-13s8-10 11-10 7 5 11 9 9 10 13 14" strokeWidth="1" opacity="0.45" />
          </>
        )}
        {scene === "summit" ? (
          <g className="text-ink" stroke="currentColor">
            <path d="M68 14V-1" strokeWidth="1.6" />
            <path d="M68 -1h13l-4 4 4 4H68" fill="rgb(var(--signal))" strokeWidth="1.4" />
          </g>
        ) : null}
        {scene === "trail" ? <path d="M10 70c18-6 28-10 40-22s22-18 34-18" strokeWidth="1.6" strokeDasharray="3 4" className="text-down" stroke="currentColor" /> : null}
      </g>
    </svg>
  );
}

/** Empty states teach: say what is missing in plain words, show an example, offer one next step. */
export function EmptyState({ title, description, icon, scene = "summit", example, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 px-4 py-10", className)}>
      {icon ? (
        <span aria-hidden="true" className="mb-1 flex h-11 w-11 items-center justify-center border-2 border-rule bg-card text-ink shadow-hard-sm">
          {icon}
        </span>
      ) : (
        <span className="mb-1 overflow-visible">
          <Scene scene={scene} compact={compact} />
        </span>
      )}
      <p className={cx("font-bold tracking-[-0.01em] text-ink", compact ? "text-lg" : "text-xl")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-2 text-pretty">{description}</p> : null}
      {example ? (
        <Chip mono className="mt-1" onClick={() => openOracle(example)} aria-label={`Try: ${example}`}>
          <span aria-hidden="true" className="font-semibold text-summit-ink">
            →
          </span>
          “{example}”
        </Chip>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2.5">{action}</div> : null}
    </div>
  );
}
