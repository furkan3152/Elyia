import { useCallback, useMemo } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { ElyLoader } from "../../pixel/ElyLoader";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { TextSurface } from "../../pixel/scene";
import { cx } from "../../ui/cx";
import { PixelFigure } from "../track/flow/FlowPixel";
import { useCompact, useNight } from "../track/flow/pixelHooks";
import { altitudeLayout, gutterFraction, paintAltitude } from "./altitudeBars";
import { distortion, type AltitudeMark } from "./swapModel";

export interface PriceAltitudeProps {
  readonly marks: readonly AltitudeMark[];
  /** Reference price (HyperCore mainnet HYPE mid), for the distortion. */
  readonly reference: number | null;
  readonly loading?: boolean;
  readonly className?: string;
}

function priceText(price: number): string {
  return price >= 1000 ? Math.round(price).toLocaleString("en-US") : price >= 10 ? price.toFixed(2) : price.toFixed(3);
}

const KIND_ORDER: Readonly<Record<AltitudeMark["kind"], number>> = { pool: 0, none: 0, reference: 1, book: 2 };

/**
 * The price altitude: one HYPE priced by every place that quotes it, as
 * pixel towers on a log altitude ($1 to $100k), the scale post mirrored on
 * both sides. The reference (HyperCore mainnet mid) wears the sun cap and
 * Ely stands on it; practice-wall pools tower far above it because test USDC
 * is unbacked, and the gap is hatched and labelled. The names sit under
 * their towers in the same equal slots.
 */
export function PriceAltitude({ marks, reference, loading = false, className }: PriceAltitudeProps) {
  const compact = useCompact();
  const night = useNight();
  // the reference stands on the axis: pools to its left, the book to its right
  // Phones keep the towers that have a price; venues with no pool are named under the chart instead.
  const stakes = useMemo(() => marks.filter((mark) => mark.kind === "none"), [marks]);
  const ordered = useMemo(() => {
    const pools = marks.filter((mark) => mark.kind === "pool" || (!compact && mark.kind === "none"));
    const rest = [...marks.filter((mark) => mark.kind !== "pool" && mark.kind !== "none")].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const left = pools.slice(0, Math.ceil(pools.length / 2));
    const right = pools.slice(Math.ceil(pools.length / 2));
    return [...left, ...rest.slice(0, 1), ...right, ...rest.slice(1)];
  }, [marks, compact]);
  const key = ordered.map((mark) => `${mark.id}:${mark.price.toPrecision(5)}`).join("|");
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      paintAltitude(ctx as unknown as TextSurface, altitudeLayout(ordered, info.w, info.h), { marks: ordered, reference, night, seconds: info.seconds, still: info.still || reduced });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `ordered`
    [key, reference, night, reduced],
  );
  const worst = ordered.filter((mark) => mark.kind === "pool").reduce<number | null>((max, mark) => {
    const factor = reference ? distortion(mark.price, reference) : null;
    return factor !== null && (max === null || factor > max) ? factor : max;
  }, null);
  const gutter = `${gutterFraction(compact ? 200 : 400) * 100}%`;
  return (
    <PixelFigure
      className={className}
      caption={["◆ 1 HYPE in USD · log altitude", "reference = HyperCore mainnet mid", worst && worst > 1.5 ? `pools ×${Math.round(worst).toLocaleString("en-US")} the market` : "pools at the market"]}
    >
      <div className="relative">
        <PixelCanvas
          width={compact ? 200 : 400}
          height={compact ? 130 : 150}
          draw={draw}
          animate={ordered.some((mark) => mark.kind === "reference")}
          fps={12}
          redrawKey={`${key}|${night}|${compact}`}
          label={ordered.length ? `Implied price of 1 HYPE by venue, log scale: ${ordered.map((mark) => (mark.kind === "none" ? `${mark.label} ${mark.none ?? "no pool"} for HYPE/USDC` : `${mark.label} ${priceText(mark.price)} USDC`)).join("; ")}` : "Price altitude: waiting for quotes"}
        />
        {ordered.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/70">
            <ElyLoader label={loading ? "Reading the reference and the pools…" : "No price yet"} />
          </div>
        ) : null}
      </div>
      <ol className="grid border-t-2 border-rule" style={{ gridTemplateColumns: `repeat(${Math.max(1, ordered.length)}, minmax(0, 1fr))`, paddingLeft: gutter, paddingRight: gutter }} aria-label="Prices by venue">
        {ordered.map((mark, index) => (
          <li key={mark.id} className={cx("flex min-w-0 flex-col items-center gap-1 px-1 py-3 text-center", mark.kind === "reference" && "bg-signal text-signal-ink")}>
            {compact ? (
              // Phone: slots are too narrow for whole names, so names stagger on
              // two rows and may use the neighbouring slot's width (never cut).
              <span className="relative block h-[44px] w-full">
                <span
                  className={cx(
                    "absolute left-1/2 w-max max-w-[190%] -translate-x-1/2 break-words font-tag text-[9px] uppercase leading-[11px]",
                    index % 2 === 0 ? "top-0" : "top-[22px]",
                    mark.kind === "reference" && "bg-signal px-1",
                  )}
                >
                  {mark.label}
                </span>
              </span>
            ) : (
              <span className="w-full truncate font-tag text-[10px] uppercase sm:text-[11px]">{mark.label}</span>
            )}
            <span className={cx("tnum font-display font-bold leading-none", mark.kind === "none" ? "text-[12px] text-ink-3 sm:text-[14px]" : "text-[15px] sm:text-[20px]")}>{mark.kind === "none" ? (mark.none ?? "no pool") : priceText(mark.price)}</span>
            <span className={cx("hidden w-full truncate font-mono text-[11px] sm:block", mark.kind === "reference" ? "opacity-80" : "text-ink-3")}>{mark.detail}</span>
          </li>
        ))}
      </ol>
      {compact && stakes.length > 0 ? (
        <p className="border-t-2 border-dashed border-rule px-3 py-2 text-center font-mono text-[11px] text-ink-2">
          <span className="font-tag text-[10px] uppercase text-down">no HYPE/USDC liquidity · </span>
          {stakes.map((mark) => `${mark.label}${mark.none ? ` (${mark.none})` : ""}`).join(" · ")}
        </p>
      ) : null}
    </PixelFigure>
  );
}
