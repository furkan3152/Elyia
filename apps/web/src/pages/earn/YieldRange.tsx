import React, { useId } from "react";

import { cx } from "../../ui/cx";
import { formatApr, formatTvl, yieldPeaks, type YieldRow } from "./yields";

export interface YieldRangeProps {
  readonly rows: readonly YieldRow[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly className?: string;
}

const W = 960;
const H = 320;
const GROUND = 236;
const LAYER_COLOR = { floor: "rgb(var(--floor))", ridge: "rgb(var(--ridge))", summit: "rgb(var(--summit-ink))" } as const;

function peakPath(x: number, base: number, ground: number, top: number, shrink = 1): string {
  const half = (base / 2) * shrink;
  const height = (top - ground) * shrink;
  const summit = ground + height;
  // Slightly convex flanks, a rounded shoulder: a survey peak, not a triangle.
  return `M${(x - half).toFixed(1)},${ground} C${(x - half * 0.55).toFixed(1)},${(ground + height * 0.35).toFixed(1)} ${(x - half * 0.18).toFixed(1)},${(summit + 2 * Math.sign(-height)).toFixed(1)} ${x.toFixed(1)},${summit.toFixed(1)} C${(x + half * 0.18).toFixed(1)},${(summit + 2 * Math.sign(-height)).toFixed(1)} ${(x + half * 0.55).toFixed(1)},${(ground + height * 0.35).toFixed(1)} ${(x + half).toFixed(1)},${ground}`;
}

/**
 * The yield range: every way to earn as a peak in rank order. Height is the
 * APR (square-root scale), the base is the TVL, the colour is the layer;
 * a losing vault is a dashed basin under the ground line. Contours inside
 * each peak are drawn on; the chosen peak carries the flag.
 */
export function YieldRange({ rows, selectedId, onSelect, className }: YieldRangeProps) {
  const id = useId();
  const peaks = yieldPeaks(rows, W - 40, H, GROUND).map((peak) => ({ ...peak, x: peak.x + 20 }));
  const slot = (W - 40) / Math.max(1, rows.length);
  const maxChars = Math.max(6, Math.floor(slot / 7.6));
  return (
    <figure className={cx("border-2 border-rule bg-card shadow-hard-lg", className)} aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-rule px-4 py-2.5">
        <p id={`${id}-title`} className="caption">
          Yield range · height = APR · base = TVL · ranked
        </p>
        <p className="caption !text-ink-3">tap a peak</p>
      </header>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block min-w-[640px]" role="group" aria-label={`Yields ranked: ${rows.map((row) => `${row.name} ${formatApr(row.aprPct)}`).join("; ")}`}>
          <defs>
            {(["floor", "ridge", "summit"] as const).map((layer) => (
              <pattern key={layer} id={`${id}-${layer}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <path d="M0,0V6" stroke={LAYER_COLOR[layer]} strokeOpacity="0.38" strokeWidth="1.3" />
              </pattern>
            ))}
          </defs>
          {/* sea level */}
          <path d={`M0,${GROUND}H${W}`} stroke="rgb(var(--ink))" strokeWidth="2" />
          <text x={W - 10} y={H - 10} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink-3))">
            ground = 0% APR · basins lose
          </text>
          {peaks.map((peak, index) => {
            const row = rows[index]!;
            const chosen = row.id === selectedId;
            const color = LAYER_COLOR[row.layer];
            const select = () => onSelect(row.id);
            return (
              <g
                key={peak.id}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                aria-label={`${index + 1}. ${row.name}: ${formatApr(row.aprPct)} APR, ${formatTvl(row.tvlUsd)} TVL`}
                onClick={select}
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select();
                  }
                }}
                className="group cursor-pointer outline-none [&:focus-visible_.el-peak-halo]:opacity-100"
              >
                <path d={peakPath(peak.x, peak.base, peak.ground, peak.top)} fill={chosen ? "rgb(var(--signal))" : `url(#${id}-${row.layer})`} fillOpacity={chosen ? 0.5 : 1} stroke="none" />
                <path d={peakPath(peak.x, peak.base + 10, peak.ground, peak.top + (peak.basin ? 5 : -5))} fill="none" stroke="rgb(var(--signal))" strokeWidth="6" className="el-peak-halo opacity-0 transition-opacity" />
                {[0.72, 0.46, 0.22].map((shrink, ring) => (
                  <path key={shrink} d={peakPath(peak.x, peak.base, peak.ground, peak.top, shrink)} pathLength={1} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth="1.1" className="el-draw" style={{ animationDelay: `${200 + index * 70 + ring * 90}ms` } as React.CSSProperties} />
                ))}
                <path
                  d={peakPath(peak.x, peak.base, peak.ground, peak.top)}
                  pathLength={peak.basin ? undefined : 1}
                  fill="none"
                  stroke="rgb(var(--ink))"
                  strokeWidth={chosen ? 2.6 : 1.8}
                  strokeDasharray={peak.basin ? "5 4" : undefined}
                  className={cx(peak.basin ? "el-draw-fade" : "el-draw", "transition-[stroke-width] group-hover:[stroke-width:2.6]")}
                  style={{ animationDelay: `${index * 70}ms` } as React.CSSProperties}
                />
                {chosen && !peak.basin ? (
                  <g aria-hidden="true">
                    <path d={`M${peak.x},${peak.top} V${peak.top - 26}`} stroke="rgb(var(--ink))" strokeWidth="2" />
                    <path d={`M${peak.x},${peak.top - 26} h16 l-5,5 l5,5 h-16 Z`} fill="rgb(var(--down))" stroke="rgb(var(--ink))" strokeWidth="1.4" />
                  </g>
                ) : null}
                <text x={peak.x} y={peak.basin ? GROUND - 10 : peak.top - (chosen ? 34 : 10)} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="700" fill="rgb(var(--ink))" paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="4">
                  {formatApr(row.aprPct)}
                </text>
                <text x={peak.x} y={GROUND + 20} textAnchor="middle" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="12.5" fontWeight={chosen ? 700 : 600} fill="rgb(var(--ink))">
                  {row.name.length > maxChars ? `${row.name.slice(0, maxChars - 1)}…` : row.name}
                </text>
                <text x={peak.x} y={GROUND + 36} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10.5" fill={color}>
                  {formatTvl(row.tvlUsd)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
