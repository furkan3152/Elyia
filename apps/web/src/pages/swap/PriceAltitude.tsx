import { useId } from "react";

import { cx } from "../../ui/cx";
import { ALTITUDE_DECADES, decadeLabel, distortion, placeMarks, type AltitudeMark } from "./swapModel";

export interface PriceAltitudeProps {
  readonly marks: readonly AltitudeMark[];
  /** Reference price (HyperCore mainnet HYPE mid), for the distortion line. */
  readonly reference: number | null;
  readonly className?: string;
}

const H = 360;
const W = 560;
const TOP = 24;
const AXIS = 86;

function priceText(price: number): string {
  return price >= 1000 ? Math.round(price).toLocaleString("en-US") : price >= 10 ? price.toFixed(2) : price.toFixed(3);
}

/**
 * The price altitude: one HYPE priced by every place that quotes it, on a
 * log scale from $1 to $100k like an altitude post. The reference (the
 * HyperCore mainnet mid) is the yellow "you are here" band; practice-wall
 * pools float far above it because test USDC is unbacked. The gap is
 * labelled, so nobody reads a testnet pool price as a market price.
 */
export function PriceAltitude({ marks, reference, className }: PriceAltitudeProps) {
  const id = useId();
  const placed = placeMarks(marks, H, 30);
  const top = Math.max(...ALTITUDE_DECADES);
  const ref = placed.find((mark) => mark.kind === "reference");
  const worst = marks.filter((mark) => mark.kind === "pool").map((mark) => ({ mark, factor: reference ? distortion(mark.price, reference) : null })).sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0))[0];
  const worstPlaced = worst ? placed.find((mark) => mark.id === worst.mark.id) : undefined;
  return (
    <figure className={cx("border-2 border-rule bg-card shadow-hard-lg", className)} aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-rule px-4 py-2.5">
        <p id={`${id}-title`} className="caption">
          Price altitude · 1 HYPE · log scale
        </p>
        <p className="caption !text-ink-3">practice-wall prices are not market prices</p>
      </header>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + TOP * 2}`} width="100%" className="block min-w-[420px]" role="img" aria-label={`Implied HYPE price by venue: ${marks.map((mark) => `${mark.label} ${priceText(mark.price)} USDC`).join("; ")}`}>
          <defs>
            <pattern id={`${id}-air`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0,0V6" stroke="rgb(var(--down))" strokeOpacity="0.28" strokeWidth="1.2" />
            </pattern>
          </defs>
          <g transform={`translate(0,${TOP})`}>
            {/* the post */}
            <rect x={AXIS - 10} y="0" width="10" height={H} fill="rgb(var(--paper-2))" stroke="rgb(var(--ink))" strokeWidth="2" />
            {ALTITUDE_DECADES.map((decade) => {
              const y = H - (decade / top) * H;
              return (
                <g key={decade}>
                  <path d={`M${AXIS - 16},${y}H${AXIS}`} stroke="rgb(var(--ink))" strokeWidth="2" />
                  <path d={`M${AXIS},${y}H${W - 12}`} stroke="rgb(var(--ink))" strokeOpacity="0.12" strokeDasharray="1 5" />
                  <text x={AXIS - 22} y={y + 4} textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="12" fill="rgb(var(--ink-2))">
                    {decadeLabel(decade)}
                  </text>
                </g>
              );
            })}
            {/* the distortion: hatched air between the reference and the worst pool */}
            {ref && worstPlaced && worst?.factor && worst.factor > 1.5 ? (
              <g>
                <rect x={AXIS + 2} y={worstPlaced.y} width="26" height={ref.y - worstPlaced.y} fill={`url(#${id}-air)`} stroke="rgb(var(--down))" strokeOpacity="0.5" strokeDasharray="3 3" />
                <text x={AXIS + 15} y={(worstPlaced.y + ref.y) / 2} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="700" fill="rgb(var(--down))" transform={`rotate(-90 ${AXIS + 15} ${(worstPlaced.y + ref.y) / 2})`} paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="4">
                  {`×${Math.round(worst.factor).toLocaleString("en-US")} ABOVE`}
                </text>
              </g>
            ) : null}
            {placed.map((mark) => {
              const isRef = mark.kind === "reference";
              const x0 = AXIS + 34;
              return (
                <g key={mark.id}>
                  {isRef ? <rect x={AXIS} y={mark.y - 7} width={W - AXIS - 12} height="14" fill="rgb(var(--signal))" fillOpacity="0.38" /> : null}
                  <path d={`M${AXIS - 10},${mark.y}H${x0} L${x0 + 14},${mark.labelY}H${x0 + 22}`} fill="none" stroke="rgb(var(--ink))" strokeWidth={isRef ? 2.4 : 1.6} />
                  <circle cx={AXIS - 5} cy={mark.y} r={isRef ? 5.5 : 4.5} fill={isRef ? "rgb(var(--signal))" : mark.kind === "book" ? "rgb(var(--floor))" : "rgb(var(--card))"} stroke="rgb(var(--ink))" strokeWidth="2" />
                  <text x={x0 + 28} y={mark.labelY + 4.5} fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="14" fontWeight="700" fill="rgb(var(--ink))">
                    {mark.label.toUpperCase()}
                    <tspan fontFamily="IBM Plex Mono, monospace" fontWeight="600" dx="10">
                      {priceText(mark.price)}
                    </tspan>
                    <tspan fontFamily="IBM Plex Mono, monospace" fontSize="11" fontWeight="400" fill="rgb(var(--ink-2))" dx="8">
                      {mark.detail}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <figcaption className="border-t-1.5 border-rule/40 px-4 py-2.5 text-[13px] leading-snug text-ink-2">
        <span className="font-semibold text-ink">Reference</span> = the HyperCore mainnet mid, the only price Elyia shows as USD. Test USDC is unbacked, so practice-wall pools price HYPE in fantasy dollars; the route card still quotes the real pool and writes its minimum out into the transaction.
      </figcaption>
    </figure>
  );
}
