import { cssVars } from "../motion/tokens";
import { cx } from "../ui/cx";
import { windsock } from "./geometry/conditions";

export interface WindsockProps {
  /** Annualised funding as a fraction (0.11 = 11% APR); positive means longs pay shorts. */
  readonly fundingApr: number | null | undefined;
  /** px height of the glyph. */
  readonly size?: number;
  /** Show "shorts paid · 11% APR" after the sock. */
  readonly showLabel?: boolean;
  readonly className?: string;
}

/**
 * Funding as a windsock: five stripes, filled one per 10% APR; the sock
 * blows toward the side that gets paid (right = shorts paid, left = longs
 * paid) and flutters harder as funding strengthens. A small inline glyph.
 */
export function Windsock({ fundingApr, size = 22, showLabel = false, className }: WindsockProps) {
  const model = windsock(fundingApr);
  const toLeft = model.pays === "long";
  const limp = model.pays === "none";
  const words = limp ? "calm · no funding" : `${model.pays === "short" ? "shorts" : "longs"} paid · ${Math.abs(model.aprPct).toFixed(1)}% APR`;
  const width = size * 2.2;
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)} role="img" aria-label={`Funding windsock: ${words}, ${model.stripes} of 5 stripes`}>
      <svg width={width} height={size} viewBox="0 0 44 20" aria-hidden="true" className="shrink-0 overflow-visible" style={toLeft ? { transform: "scaleX(-1)" } : undefined}>
        <path d="M3 19V2" stroke="rgb(var(--ink))" strokeWidth="1.6" strokeLinecap="square" />
        <g
          className={cx(!limp && "el-loop el-flutter")}
          style={{
            ...cssVars({ "--el-flutter-amp": `${1.2 + model.strength * 4.2}deg`, "--el-flutter-dur": `${2.2 - model.strength * 1.1}s` }),
            transformOrigin: "3px 6px",
            transform: limp ? "rotate(62deg)" : undefined,
          }}
        >
          {[0, 1, 2, 3, 4].map((stripe) => {
            const x0 = 3 + stripe * 7.6;
            const taper = stripe * 0.75;
            const filled = stripe < model.stripes;
            return (
              <path
                key={stripe}
                d={`M${x0},${2.5 + taper} L${x0 + 7.6},${2.5 + taper + 0.75} L${x0 + 7.6},${11.5 - taper - 0.75} L${x0},${11.5 - taper}Z`}
                fill={filled ? (stripe % 2 === 0 ? "rgb(var(--warn))" : "rgb(var(--card))") : "transparent"}
                stroke="rgb(var(--ink))"
                strokeWidth="1"
                strokeDasharray={filled ? undefined : "1.5 1.5"}
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      </svg>
      {showLabel ? <span className="tnum font-mono text-[11px] text-ink-2">{words}</span> : null}
    </span>
  );
}
