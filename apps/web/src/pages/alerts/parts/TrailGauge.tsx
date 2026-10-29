import { cx } from "../../../ui/cx";
import type { AlertRule, RuleStatus } from "../model/rules";

const FLAG_X = 300;
const START_X = 24;
const SPAN = 0.25;

/**
 * The reading against your line, drawn as a short trail: the climber is
 * the value now, the flag is your level, the dashed stretch is what is
 * left to travel (full scale = 25% away). Crossed: the climber stands at
 * the flag. Event rules (fills, bridges) show a listening mast instead.
 */
export function TrailGauge({ status, rule, compact = false, className }: { readonly status: RuleStatus; readonly rule: Pick<AlertRule, "kind" | "threshold">; readonly compact?: boolean; readonly className?: string }) {
  const event = rule.kind === "fill" || rule.kind === "bridge";
  const height = compact ? 30 : 56;
  const ground = compact ? 20 : 38;
  const gap = status.gap;
  const climber = status.met ? FLAG_X : gap === null ? START_X : FLAG_X - (Math.min(gap, SPAN) / SPAN) * (FLAG_X - START_X);
  const label = status.reading;
  return (
    <figure className={cx("min-w-0", className)}>
      <svg viewBox={`0 0 340 ${height}`} className="block w-full max-w-[460px]" role="img" aria-label={`Live reading: ${label}`} preserveAspectRatio="xMinYMid meet">
        {event ? (
          <g>
            <line x1={START_X} x2={FLAG_X + 20} y1={ground} y2={ground} stroke="rgb(var(--ink) / 0.35)" strokeWidth="1.5" strokeDasharray="2 5" />
            <g transform={`translate(${START_X + 8} 0)`}>
              <line x1="0" x2="0" y1={ground} y2={ground - (compact ? 14 : 26)} stroke="rgb(var(--ink))" strokeWidth="2" />
              <circle cx="0" cy={ground - (compact ? 14 : 26)} r="3" fill={status.met ? "rgb(var(--up))" : "rgb(var(--ink))"} />
              {!compact ? (
                <g className="el-pulse-slow el-loop" fill="none" stroke="rgb(var(--summit-ink))" strokeWidth="1.5">
                  <path d={`M 9 ${ground - 34} a 10 10 0 0 1 0 16`} />
                  <path d={`M 15 ${ground - 39} a 16 16 0 0 1 0 26`} />
                </g>
              ) : null}
            </g>
          </g>
        ) : (
          <g>
            <line x1={START_X} x2={FLAG_X} y1={ground} y2={ground} stroke="rgb(var(--ink) / 0.2)" strokeWidth="1.5" />
            {gap !== null ? <line x1={climber} x2={FLAG_X} y1={ground} y2={ground} stroke={status.met ? "rgb(var(--up))" : "rgb(var(--ink))"} strokeWidth="2.5" strokeDasharray="5 4" /> : null}
            {[0.25, 0.5, 0.75].map((at) => (
              <line key={at} x1={START_X + at * (FLAG_X - START_X)} x2={START_X + at * (FLAG_X - START_X)} y1={ground - 3} y2={ground + 3} stroke="rgb(var(--ink) / 0.35)" strokeWidth="1" />
            ))}
            <g transform={`translate(${FLAG_X} 0)`}>
              <line x1="0" x2="0" y1={ground} y2={ground - (compact ? 16 : 28)} stroke="rgb(var(--ink))" strokeWidth="2" />
              <path d={`M 0 ${ground - (compact ? 16 : 28)} l 14 4 l -14 4 z`} fill={status.met ? "rgb(var(--up))" : "rgb(var(--signal))"} stroke="rgb(var(--ink))" strokeWidth="1.2" />
            </g>
            {gap !== null ? (
              <g className="el-climber" style={{ transform: `translateX(${climber}px)` }}>
                <circle cx="0" cy={ground} r={compact ? 4.5 : 6} fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="2.2" />
              </g>
            ) : null}
            {!compact ? (
              <>
                <text x={START_X} y={ground + 15} fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="rgb(var(--ink-3))">
                  25% away
                </text>
                <text x={FLAG_X} y={ground + 15} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="rgb(var(--ink-2))">
                  your line
                </text>
              </>
            ) : null}
          </g>
        )}
      </svg>
      {!compact ? <figcaption className={cx("mt-1 font-mono text-[12px]", status.met ? "font-semibold text-up" : "text-ink-2")}>{status.met ? "▲ " : ""}{status.reading}</figcaption> : null}
    </figure>
  );
}
