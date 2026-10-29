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

const STYLE: Readonly<Record<Condition, { readonly word: string; readonly plate: string }>> = {
  open: { word: "OPEN", plate: "bg-up text-card" },
  caution: { word: "CAUTION", plate: "bg-warn text-warn-on" },
  closed: { word: "CLOSED", plate: "bg-down text-card" },
};

/** Route condition for a token or pool (from Shield): an enamel trail sign, OPEN / CAUTION / CLOSED. */
export function ConditionSign({ condition, reason, score, size = "md", className }: ConditionSignProps) {
  const style = STYLE[condition];
  return (
    <span className={cx("inline-flex max-w-full items-stretch", className)}>
      <span
        className={cx(
          "relative inline-flex items-center border-2 border-rule font-sans font-bold tracking-[0.08em] shadow-hard-sm",
          size === "sm" ? "h-6 px-2 text-[11px]" : "h-8 px-3 text-sm",
          style.plate,
        )}
      >
        <span aria-hidden="true" className="absolute left-[3px] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-current opacity-60" />
        <span aria-hidden="true" className="absolute right-[3px] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-current opacity-60" />
        <span className="sr-only">Route condition: </span>
        {style.word}
        {score !== undefined ? <span className="tnum ml-1.5 font-mono text-[10px] font-semibold opacity-90">{Math.round(score)}</span> : null}
      </span>
      {reason ? <span className="ml-2 self-center text-[13px] leading-tight text-ink-2">{reason}</span> : null}
    </span>
  );
}
