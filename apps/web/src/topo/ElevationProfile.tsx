import { useId, useMemo } from "react";

import { useAutoPause } from "../motion/useAutoPause";
import { cx } from "../ui/cx";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { profileModel, type ProfileCamp, type ProfilePoint } from "./geometry/profile";

export interface ElevationProfileProps {
  readonly series: readonly ProfilePoint[];
  /** Key events as camps ("CAMP II · HYPE 3× opened"). */
  readonly camps?: readonly ProfileCamp[];
  /** Fixed drawing width; by default the profile measures its container so labels keep their size. */
  readonly width?: number;
  readonly height?: number;
  readonly formatValue?: (value: number) => string;
  /** x-axis labels at the ends ("SEP 24", "TODAY"). */
  readonly startLabel?: string;
  readonly endLabel?: string;
  /** Accessible summary. */
  readonly label: string;
  /** Cartographic line on the slope ("a 35-day climb · +$8,764"). */
  readonly caption?: string;
  readonly className?: string;
}

/**
 * The equity curve as a ridgeline: hatched rock under the line, camps on it,
 * a summit flag at the all-time high and a valley marker at the deepest
 * drawdown. The value axis has its own gutter so labels never sit on the path.
 */
export function ElevationProfile({
  series,
  camps = [],
  width: fixedWidth,
  height = 200,
  formatValue = (value) => `$${Math.round(value).toLocaleString("en-US")}`,
  startLabel,
  endLabel,
  label,
  caption,
  className,
}: ElevationProfileProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const { ref, seen } = useAutoPause<SVGSVGElement>();
  const [measure, measured] = useMeasuredWidth<HTMLDivElement>(fixedWidth ?? 880);
  const width = fixedWidth ?? Math.max(260, measured);
  const model = useMemo(() => profileModel(series, camps, { width, height, formatValue, gutter: 58, padTop: 36, padBottom: startLabel || endLabel ? 22 : 8 }), [series, camps, width, height, formatValue, startLabel, endLabel]);
  const { plot, summit, valley } = model;
  return (
    <div ref={measure} className={cx("w-full min-w-0", className)}>
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-full overflow-visible" role="img" aria-label={label} data-el-hold={seen ? undefined : ""}>
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V6" stroke="rgb(var(--contour))" strokeWidth="1" opacity="0.55" />
        </pattern>
        <clipPath id={`${id}-clip`}>
          <path d={model.area} />
        </clipPath>
      </defs>
      {model.yTicks.map((tick) => (
        <g key={tick.value}>
          <path d={`M${plot.x0},${tick.y}H${plot.x1}`} stroke="rgb(var(--ink))" strokeWidth="0.6" strokeDasharray="1 4" opacity="0.45" />
          <text x={plot.x0 - 8} y={tick.y + 3.5} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fill="rgb(var(--ink-2))">
            {tick.label}
          </text>
        </g>
      ))}
      <path d={`M${plot.x0},${plot.y1}H${plot.x1}`} stroke="rgb(var(--ink))" strokeWidth="1.2" />
      {model.area ? <rect x={plot.x0} y={plot.y0 - 40} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0 + 40} fill={`url(#${id}-hatch)`} clipPath={`url(#${id}-clip)`} className="el-draw-fade" style={{ animationDelay: "500ms" }} /> : null}
      {model.line ? <path d={model.line} pathLength={1} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.8" strokeLinejoin="round" className="el-draw" /> : null}
      {valley ? (
        <g className="el-draw-fade" style={{ animationDelay: "900ms" }}>
          <path d={`M${valley.x},${valley.y + 6}V${plot.y1 - 2}`} stroke="rgb(var(--down))" strokeWidth="1.2" strokeDasharray="2 2" />
          <path d={`M${valley.x - 4},${valley.y + 10}l4,-5 4,5`} fill="none" stroke="rgb(var(--down))" strokeWidth="1.4" />
          <text x={valley.x + 6} y={Math.min(plot.y1 - 6, valley.y + 22)} fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fontWeight="600" fill="rgb(var(--down))">
            ▼ {(valley.fraction * 100).toFixed(1)}% DD
          </text>
        </g>
      ) : null}
      {model.camps.map((camp) => (
        <g key={`${camp.index}-${camp.label}`} className="el-draw-fade" style={{ animationDelay: "800ms" }}>
          <circle cx={camp.x} cy={camp.y} r="4.2" fill="rgb(var(--signal))" stroke="rgb(var(--ink))" strokeWidth="1.5" />
          <text
            x={camp.x}
            y={camp.labelAbove ? camp.y - 10 : camp.y + 18}
            textAnchor={camp.x > plot.x1 - 90 ? "end" : camp.x < plot.x0 + 60 ? "start" : "middle"}
            fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif"
            fontSize="11"
            fontWeight="700"
            fill="rgb(var(--ink))"
          >
            {camp.label}
          </text>
        </g>
      ))}
      {summit ? (
        <g className="el-draw-fade" style={{ animationDelay: "1100ms" }}>
          <path d={`M${summit.x},${summit.y - 1}V${summit.y - 26}`} stroke="rgb(var(--ink))" strokeWidth="1.6" />
          <path d={`M${summit.x},${summit.y - 26}h16l-4,5 4,5H${summit.x}Z`} fill="rgb(var(--down))" stroke="rgb(var(--ink))" strokeWidth="1.2" strokeLinejoin="round" />
          <text
            x={summit.x > plot.x1 - 140 ? summit.x - 6 : summit.x + 22}
            y={summit.y - 17}
            textAnchor={summit.x > plot.x1 - 140 ? "end" : "start"}
            fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif"
            fontSize="11"
            fontWeight="700"
            fill="rgb(var(--ink))"
          >
            SUMMIT · {formatValue(summit.value)}
          </text>
        </g>
      ) : null}
      {caption && model.points.length > 1 ? (
        <text x={(plot.x0 + plot.x1) / 2} y={plot.y1 - 8} textAnchor="middle" fontFamily="Instrument Serif, Georgia, serif" fontStyle="italic" fontSize="15" fill="rgb(var(--ridge))">
          {caption}
        </text>
      ) : null}
      {startLabel ? (
        <text x={plot.x0} y={height - 4} fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink-3))">
          {startLabel}
        </text>
      ) : null}
      {endLabel ? (
        <text x={plot.x1} y={height - 4} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink-3))">
          {endLabel}
        </text>
      ) : null}
    </svg>
    </div>
  );
}
