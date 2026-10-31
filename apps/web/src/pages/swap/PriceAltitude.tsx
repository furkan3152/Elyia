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

const KIND_ORDER: Readonly<Record<AltitudeMark["kind"], number>> = { pool: 0, reference: 1, book: 2 };

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
  const ordered = useMemo(() => {
    const pools = marks.filter((mark) => mark.kind === "pool");
    const rest = [...marks.filter((mark) => mark.kind !== "pool")].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const left = pools.slice(0, Math.ceil(pools.length / 2));
    const right = pools.slice(Math.ceil(pools.length / 2));
    return [...left, ...rest.slice(0, 1), ...right, ...rest.slice(1)];
  }, [marks]);
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
      caption={["◆ 1 HYPE · log altitude", "reference = HyperCore mainnet mid", worst && worst > 1.5 ? `pools ×${Math.round(worst).toLocaleString("en-US")} the market` : "pools at the market"]}
    >
      <div className="relative">
        <PixelCanvas
          width={compact ? 200 : 400}
          height={compact ? 130 : 150}
          draw={draw}
          animate={ordered.some((mark) => mark.kind === "reference")}
          fps={12}
          redrawKey={`${key}|${night}|${compact}`}
          label={ordered.length ? `Implied price of 1 HYPE by venue, log scale: ${ordered.map((mark) => `${mark.label} ${priceText(mark.price)} USDC`).join("; ")}` : "Price altitude: waiting for quotes"}
        />
        {ordered.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/70">
            <ElyLoader label={loading ? "Reading the reference and the pools…" : "No price yet"} />
          </div>
        ) : null}
      </div>
      <ol className="grid border-t-4 border-rule" style={{ gridTemplateColumns: `repeat(${Math.max(1, ordered.length)}, minmax(0, 1fr))`, paddingLeft: gutter, paddingRight: gutter }} aria-label="Prices by venue">
        {ordered.map((mark) => (
          <li key={mark.id} className={cx("flex min-w-0 flex-col items-center gap-1 px-1 py-3 text-center", mark.kind === "reference" && "bg-signal text-signal-ink")}>
            <span className="w-full truncate font-tag text-[10px] uppercase sm:text-[11px]">{mark.label}</span>
            <span className="tnum font-display text-[15px] font-bold leading-none sm:text-[20px]">{priceText(mark.price)}</span>
            <span className={cx("hidden w-full truncate font-mono text-[11px] sm:block", mark.kind === "reference" ? "opacity-80" : "text-ink-3")}>{mark.detail}</span>
          </li>
        ))}
      </ol>
    </PixelFigure>
  );
}
