import { Sparkles } from "lucide-react";
import React from "react";

import { openOracle } from "../oracle/oracleStore";
import { Chip } from "./Badge";
import { cx } from "./cx";

export interface EmptyStateProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  /** An example intent that teaches what to do; clicking it opens the Oracle with the sentence. */
  readonly example?: string;
  /** Primary action (a Button or ButtonLink). */
  readonly action?: React.ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

/** Empty states teach: say what is missing, show an example intent, offer the next step. */
export function EmptyState({ title, description, icon, example, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 px-4 py-12", className)}>
      {icon ? (
        <span aria-hidden="true" className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-line-strong bg-bg-2/70 text-violet-soft">
          {icon}
        </span>
      ) : null}
      <p className={cx("font-display text-text-0", compact ? "text-xl" : "text-2xl")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-text-1 text-pretty">{description}</p> : null}
      {example ? (
        <Chip tone="gold" mono className="mt-1" onClick={() => openOracle(example)} aria-label={`Try: ${example}`}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {example}
        </Chip>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
