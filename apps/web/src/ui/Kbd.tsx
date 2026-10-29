import type { ReactNode } from "react";

import { cx } from "./cx";
import { isApplePlatform } from "./platform";

export interface KbdProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** One key cap. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong bg-bg-2/80 px-1.5 font-mono text-xs leading-none text-text-1 shadow-[0_1px_0_0_var(--line-strong)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface KbdComboProps {
  /** Keys in order; "mod" renders ⌘ on Apple platforms and Ctrl elsewhere. */
  readonly keys: readonly string[];
  /** "then" for sequences ("g" then "t"), "plus" for chords (⌘ + K). */
  readonly joiner?: "plus" | "then";
  readonly className?: string;
}

export function KbdCombo({ keys, joiner = "plus", className }: KbdComboProps) {
  const apple = isApplePlatform();
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && joiner === "then" ? <span className="text-xs text-text-2">then</span> : null}
          <Kbd>{key === "mod" ? (apple ? "⌘" : "Ctrl") : key}</Kbd>
        </span>
      ))}
    </span>
  );
}
