import { cx } from "../ui/cx";
import type { Condition } from "./geometry/conditions";

export interface ConditionSignProps {
  readonly condition: Condition;
  /** One line of why ("liquidity locked 12 months", "owner can mint"). */
  readonly reason?: string;
  /** Shield score 0-100, printed small. */
  readonly score?: number;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const STYLE: Readonly<Record<Condition, { readonly word: string; readonly plate: string; readonly mark: string }>> = {
  open: { word: "OPEN", plate: "bg-up text-card", mark: "▲" },
  caution: { word: "CAUTION", plate: "bg-warn text-warn-on", mark: "!" },
  closed: { word: "CLOSED", plate: "bg-down text-card", mark: "✕" },
};

/** Route condition for a token or pool (from Shield): an enamel trail sign in a pixel frame, OPEN / CAUTION / CLOSED. */
export function ConditionSign({ condition, reason, score, size = "md", className }: ConditionSignProps) {
  const style = STYLE[condition];
  return (
    <span className={cx("inline-flex max-w-full items-stretch", className)}>
      <span className={cx("relative inline-flex items-center gap-1.5 font-tag uppercase px-frame-thin px-drop", size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-7 px-2.5 text-[13px]", style.plate)}>
        <span aria-hidden="true">{style.mark}</span>
        <span className="sr-only">Route condition: </span>
        {style.word}
        {score !== undefined ? <span className="tnum ml-1 font-mono text-[11px] font-semibold opacity-90">{Math.round(score)}</span> : null}
      </span>
      {reason ? <span className="ml-3 self-center text-[13px] leading-tight text-ink-2">{reason}</span> : null}
    </span>
  );
}
