import { useState } from "react";

import { useReducedMotion } from "../motion/useReducedMotion";
import { cssVars } from "../motion/tokens";
import { cx } from "../ui/cx";
import { digitDiff, type AltimeterCell } from "./geometry/altimeter";

export interface AltimeterProps {
  /** The formatted figure ("$48,213", "18,514,484"). Format exactly; it is never tweened. */
  readonly value: string;
  /** Accessible name ("Net worth"); the value is read with it. */
  readonly label: string;
  /** "boxed": each digit on its own odometer wheel (hero figures); "inline": a figure in running text. */
  readonly variant?: "boxed" | "inline";
  readonly size?: "sm" | "md" | "lg";
  /** Highlight the last digit that rolled in signal yellow ("you are here"). */
  readonly markLatest?: boolean;
  readonly className?: string;
}

const BOX = {
  sm: "h-8 min-w-[1.35rem] text-lg",
  md: "h-12 min-w-[2rem] text-[28px]",
  lg: "h-[64px] min-w-[2.6rem] text-[40px]",
} as const;
const INLINE = { sm: "text-sm", md: "text-xl", lg: "text-[32px]" } as const;

interface RollState {
  readonly value: string;
  readonly previous: string | null;
  readonly change: number;
}

/**
 * The altimeter: an odometer for live figures (net worth, block heads).
 * Only the digits that changed roll, in the direction the value moved;
 * money is never animated through invented in-between values.
 */
export function Altimeter({ value, label, variant = "boxed", size = "md", markLatest = false, className }: AltimeterProps) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<RollState>({ value, previous: null, change: 0 });
  let current = state;
  if (state.value !== value) {
    current = { value, previous: state.value, change: state.change + 1 };
    setState(current);
  }
  const cells: AltimeterCell[] = digitDiff(current.previous, value);
  const delays: number[] = [];
  let lastChanged = -1;
  let rolled = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (cell.changed && cell.digit) {
      lastChanged = index;
      rolled += 1;
    }
    delays.push(rolled * 40);
  }
  return (
    <span className={cx("inline-flex items-stretch font-mono font-semibold text-ink", variant === "boxed" ? "gap-1" : "gap-0", className)}>
      <span className="sr-only">
        {label}: {value}
      </span>
      {cells.map((cell, index) => {
        const rolling = !reduced && cell.changed && cell.digit && cell.direction !== null;
        const delay = delays[index] ?? 0;
        const highlight = markLatest && index === lastChanged;
        if (variant === "boxed") {
          const separator = !cell.digit && cell.char !== "$";
          return (
            <span
              key={cell.key}
              aria-hidden="true"
              className={cx(
                "el-digit tnum flex items-center justify-center leading-none",
                separator ? cx(BOX[size], "min-w-0 px-0.5") : cx(BOX[size], "border-2 border-rule px-1", cell.char === "$" ? "bg-ink text-paper" : highlight ? "bg-signal text-signal-ink" : "bg-card"),
              )}
            >
              <span key={rolling ? `${cell.key}-${current.change}` : cell.key} className={cx("inline-block", rolling && (cell.direction === "up" ? "el-roll-up" : "el-roll-down"))} style={rolling ? cssVars({ "--el-delay": `${delay}ms` }) : undefined}>
                {cell.char}
              </span>
            </span>
          );
        }
        return (
          <span key={cell.key} aria-hidden="true" className={cx("el-digit tnum leading-none", INLINE[size], highlight && "bg-signal text-signal-ink")}>
            <span key={rolling ? `${cell.key}-${current.change}` : cell.key} className={cx("inline-block", rolling && (cell.direction === "up" ? "el-roll-up" : "el-roll-down"))} style={rolling ? cssVars({ "--el-delay": `${delay}ms` }) : undefined}>
              {cell.char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
