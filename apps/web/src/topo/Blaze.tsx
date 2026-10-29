import { cx } from "../ui/cx";
import { blazeFor, GRADE_NAME, type Grade } from "./geometry/conditions";

export interface BlazeProps {
  readonly grade: Grade;
  /** px height. */
  readonly size?: number;
  /** Show "T3" after the mark. */
  readonly showGrade?: boolean;
  /** Accessible name; by default "Grade T3, mountain trail". Pass null when adjacent text says it. */
  readonly label?: string | null;
  readonly className?: string;
}

/*
 * Painted trail blazes, slightly uneven as if brushed on rock: a yellow
 * diamond for T1-T2 (hiking), white-red-white for T3-T4 (mountain),
 * white-blue-white for T5-T6 (alpine). The white bands keep a thin ink edge
 * so they read on paper. Paint colours are fixed: a blaze is painted on rock, not printed in the sheet's ink.
 */
export function Blaze({ grade, size = 16, showGrade = false, label, className }: BlazeProps) {
  const kind = blazeFor(grade);
  const name = label === undefined ? `Grade T${grade}, ${GRADE_NAME[kind].toLowerCase()}` : label;
  const width = kind === "yellow" ? size : Math.round(size * 1.5);
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 align-middle", className)} {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true })}>
      <svg width={width} height={size} viewBox={kind === "yellow" ? "0 0 16 16" : "0 0 24 16"} aria-hidden="true" className="block overflow-visible">
        {kind === "yellow" ? (
          <path d="M8 1.1 14.8 8.1 7.9 14.9 1.2 7.9Z" fill="#F2C200" stroke="#16201B" strokeWidth="1.4" strokeLinejoin="round" />
        ) : (
          <g stroke="#16201B" strokeWidth="1.2" strokeLinejoin="round">
            <path d="M1.4 1.6 22.6 1.2 22.8 15 1.2 14.8Z" fill="#FBFAF5" />
            <path d="M1.3 6.1 22.7 5.8 22.7 10.4 1.3 10.5Z" fill={kind === "red" ? "#D7261E" : "#1E5AA8"} strokeWidth="0" />
          </g>
        )}
      </svg>
      {showGrade ? <span className="tnum font-mono text-[11px] font-semibold tracking-[0.06em]">T{grade}</span> : null}
    </span>
  );
}
