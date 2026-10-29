import { useId, useMemo } from "react";

import { useAutoPause } from "../motion/useAutoPause";
import { cssVars } from "../motion/tokens";
import { cx } from "../ui/cx";
import { buildRelief, type Layer, type ReliefHolding, type ReliefModel } from "./geometry/relief";

export interface ReliefProps {
  readonly holdings: readonly ReliefHolding[];
  /** Map size in map units (the SVG scales to its container). */
  readonly width?: number;
  readonly height?: number;
  /** Contour interval in USD (default: a round number for ~16 lines on the tallest hill). */
  readonly interval?: number;
  readonly seed?: number;
  readonly formatUsd?: (usd: number) => string;
  /** Draw the contours on when the map first scrolls into view (default true). */
  readonly drawOn?: boolean;
  /** Region names in Instrument Serif (default true). */
  readonly regionLabels?: boolean;
  /** Key, scale bar and north arrow drawn on the map (default true). */
  readonly furniture?: boolean;
  /** Clicking a peak label selects the holding. */
  readonly onSelect?: (holding: ReliefHolding) => void;
  readonly selectedId?: string | null;
  /** Accessible name of the map. */
  readonly label?: string;
  /** Below this width (px) the map keeps its size and pans sideways instead of shrinking its labels (default 640). */
  readonly minWidth?: number;
  readonly className?: string;
}

const REGION_NAME: Readonly<Record<Layer, string>> = { floor: "The Floor", ridge: "The Ridge", summit: "The Summit" };
const REGION_NET: Readonly<Record<Layer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };
const REGION_COLOR: Readonly<Record<Layer, string>> = { floor: "rgb(var(--floor))", ridge: "rgb(var(--ridge))", summit: "rgb(var(--summit-ink))" };

function defaultUsd(usd: number): string {
  if (usd >= 100_000) return `$${(usd / 1000).toFixed(0)}k`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/**
 * The Relief: your portfolio as terrain. Each holding a hill (height = USD),
 * shorts dashed red basins, leveraged hills ringed with hatched cliffs, the
 * three layers as regions of the sheet with their cartographic names, a key,
 * a scale bar and a north arrow. Contours draw on (index lines first) when
 * the map scrolls into view; reduced motion shows the finished map.
 */
export function Relief({
  holdings,
  width = 900,
  height = 620,
  interval,
  seed,
  formatUsd = defaultUsd,
  drawOn = true,
  regionLabels = true,
  furniture = true,
  onSelect,
  selectedId,
  label,
  minWidth = 640,
  className,
}: ReliefProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const { ref, seen } = useAutoPause<SVGSVGElement>({ rootMargin: "0px" });
  const key = holdings.map((h) => `${h.id}:${Math.round(h.usd)}:${h.layer}:${h.side ?? ""}:${h.leverage ?? 1}:${h.note ?? ""}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the holdings' content, not their identity
  const model: ReliefModel = useMemo(() => buildRelief(holdings, { width, height, interval, seed }), [key, width, height, interval, seed]);
  const levels = [...new Set(model.contours.map((c) => c.level))].sort((a, b) => Math.abs(a) - Math.abs(b));
  const order = new Map(levels.map((level, index) => [level, index]));
  const summary =
    label ??
    `Portfolio relief: ${holdings.length} holdings, ${formatUsd(model.totalUsd)} in total, contour every ${formatUsd(model.interval)}. ` +
      [...model.hills]
        .sort((a, b) => b.holding.usd - a.holding.usd)
        .slice(0, 6)
        .map((hill) => `${hill.holding.symbol}${hill.holding.side === "short" ? " short" : ""} ${formatUsd(hill.holding.usd)} on the ${hill.holding.layer}`)
        .join(", ");

  return (
    <div className={cx("overflow-x-auto overscroll-x-contain", className)}>
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth }} className="block select-none" role="img" aria-label={summary} data-el-hold={drawOn && !seen ? "" : undefined}>
      <defs>
        <clipPath id={`${id}-sheet`}>
          <rect width={width} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-sheet)`}>
        {/* hypsometric tint by layer and the region boundaries */}
        {model.regions.map((region) => (
          <path key={region.layer} d={region.d} fill={REGION_COLOR[region.layer]} fillOpacity="0.055" />
        ))}
        {model.boundaries.map((d, index) => (
          <path key={index} d={d} fill="none" stroke="rgb(var(--ink))" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="1 4" strokeLinecap="round" />
        ))}
        {/* graticule ticks */}
        <g stroke="rgb(var(--ink))" strokeOpacity="0.28" strokeWidth="0.8">
          {Array.from({ length: Math.floor(width / 90) }, (_, i) =>
            Array.from({ length: Math.floor(height / 90) }, (_, j) => (
              <path key={`${i}-${j}`} d={`M${(i + 0.5) * 90 - 4},${(j + 0.5) * 90}h8M${(i + 0.5) * 90},${(j + 0.5) * 90 - 4}v8`} />
            )),
          )}
        </g>
        {/* contours */}
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          {model.contours.map((contour, index) => {
            const delay = drawOn ? 120 + (order.get(contour.level) ?? 0) * 70 : 0;
            if (contour.basin) {
              return (
                <path
                  key={index}
                  d={contour.d}
                  stroke="rgb(var(--down))"
                  strokeWidth={contour.index ? 1.4 : 0.9}
                  strokeOpacity="0.85"
                  strokeDasharray="3 3"
                  className={drawOn ? "el-draw-fade" : undefined}
                  style={drawOn ? cssVars({ "--el-delay": `${delay}ms` }) : undefined}
                />
              );
            }
            return (
              <path
                key={index}
                d={contour.d}
                pathLength={1}
                stroke="rgb(var(--contour))"
                strokeWidth={contour.index ? 1.7 : 0.85}
                strokeOpacity={contour.index ? 0.92 : 0.6}
                className={drawOn ? "el-draw" : undefined}
                style={drawOn ? cssVars({ "--el-delay": `${delay}ms`, "--el-draw-dur": "1400ms" }) : undefined}
              />
            );
          })}
        </g>
        {/* hatched cliffs on leveraged hills */}
        <g stroke="rgb(var(--contour))" strokeWidth="0.9" strokeOpacity="0.85" className={drawOn ? "el-draw-fade" : undefined} style={drawOn ? cssVars({ "--el-delay": "900ms" }) : undefined}>
          {model.hachures.map((h, index) => (
            <path key={index} d={`M${h.x1.toFixed(1)},${h.y1.toFixed(1)}L${h.x2.toFixed(1)},${h.y2.toFixed(1)}`} />
          ))}
        </g>
        {/* region names: cartographic labels */}
        {regionLabels
          ? model.regions.map((region) => (
              <text
                key={region.layer}
                x={region.label[0]}
                y={region.label[1]}
                textAnchor={region.layer === "ridge" ? "end" : "start"}
                fontFamily="Instrument Serif, Georgia, serif"
                fontStyle="italic"
                fontSize="27"
                fill={REGION_COLOR[region.layer]}
              >
                {REGION_NAME[region.layer]}
                <tspan fontSize="17" dx="6" opacity="0.85">
                  · {REGION_NET[region.layer]}
                </tspan>
              </text>
            ))
          : null}
        {/* peaks: spot height, label, value */}
        <g className={drawOn ? "el-draw-fade" : undefined} style={drawOn ? cssVars({ "--el-delay": "700ms" }) : undefined}>
          {model.hills.map((hill) => {
            const short = hill.sign < 0;
            const flip = hill.x > width - 190;
            const selected = selectedId === hill.holding.id;
            const lev = hill.holding.leverage && hill.holding.leverage > 1 ? ` ${short ? "▼" : "▲"}${hill.holding.leverage}×` : "";
            const color = short ? "rgb(var(--down))" : "rgb(var(--ink))";
            const content = (
              <>
                {short ? (
                  <path d="M-6,-6 l12,12 M6,-6 l-12,12" stroke={color} strokeWidth="2.4" />
                ) : hill.holding.usd >= model.interval ? (
                  <path d="M0,-9 l7.5,12 h-15z" fill={color} />
                ) : (
                  <circle r="3.6" fill={color} />
                )}
                {selected ? <circle r="14" fill="none" stroke="rgb(var(--signal))" strokeWidth="3" /> : null}
                <g transform={`translate(${flip ? -12 : 12},0)`} textAnchor={flip ? "end" : "start"}>
                  <text y="-1" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="14" fontWeight="700" fill={color} paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="4" strokeLinejoin="round">
                    {hill.holding.symbol}
                    {lev}
                    {short ? " BASIN" : ""}
                  </text>
                  <text y="14" fontFamily="IBM Plex Mono, monospace" fontSize="11.5" fill={short ? color : "rgb(var(--ink-2))"} paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="4" strokeLinejoin="round">
                    {short ? "−" : ""}
                    {formatUsd(hill.holding.usd)}
                    {hill.holding.note ? ` · ${hill.holding.note}` : ""}
                  </text>
                </g>
              </>
            );
            return onSelect ? (
              <g
                key={hill.holding.id}
                transform={`translate(${hill.x.toFixed(1)},${hill.y.toFixed(1)})`}
                role="button"
                tabIndex={0}
                aria-label={`${hill.holding.symbol} ${formatUsd(hill.holding.usd)}`}
                className="cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-accent-line"
                onClick={() => onSelect(hill.holding)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(hill.holding);
                  }
                }}
              >
                <circle r="22" fill="transparent" />
                {content}
              </g>
            ) : (
              <g key={hill.holding.id} transform={`translate(${hill.x.toFixed(1)},${hill.y.toFixed(1)})`}>
                {content}
              </g>
            );
          })}
        </g>
        {furniture ? (
          <g transform={`translate(${width - 196},${height - 72})`} fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="rgb(var(--ink))">
            <rect x="-8" y="-12" width="200" height="74" fill="rgb(var(--card))" fillOpacity="0.92" stroke="rgb(var(--rule))" strokeWidth="1.2" />
            <text x="0" y="2" fontWeight="600" letterSpacing="1.2">
              KEY
            </text>
            <path d="M0,16h22" stroke="rgb(var(--contour))" strokeWidth="1.6" />
            <text x="30" y="19">
              holding · {formatUsd(model.interval)} contours
            </text>
            <path d="M0,32h22" stroke="rgb(var(--down))" strokeWidth="1.2" strokeDasharray="3 3" />
            <text x="30" y="35">
              short basin ({formatUsd(model.interval / 2)})
            </text>
            <g stroke="rgb(var(--contour))" strokeWidth="1">
              <path d="M2,44v6M7,44v6M12,44v6M17,44v6" />
            </g>
            <text x="30" y="51">
              cliffs: leverage
            </text>
            <g transform="translate(176,6)">
              <path d="M0,-12 5,6 0,3Z" fill="rgb(var(--ink))" />
              <path d="M0,-12 -5,6 0,3Z" fill="none" stroke="rgb(var(--ink))" strokeWidth="1" />
              <text x="0" y="18" textAnchor="middle" fontWeight="600">
                N
              </text>
            </g>
          </g>
        ) : null}
      </g>
    </svg>
    </div>
  );
}
