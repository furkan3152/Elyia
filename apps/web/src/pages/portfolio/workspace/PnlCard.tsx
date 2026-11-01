import { useCallback, useMemo, useState } from "react";

import { paletteOf } from "../../../features/ely/draw";
import { Glyph } from "../../../features/ely/ui";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { sharedTicker } from "../../../pixel/useTicker";
import { cx } from "../../../ui/cx";
import { usdShort, usdSigned } from "../range/format";
import { drawWaterfall, WATERFALL_END_S } from "../v2/draw";
import { pnlSteps, waterfall } from "../v2/model";

export interface PnlCardProps {
  readonly figures: Readonly<Record<string, string | number | null>>;
  readonly sample: boolean;
}

/**
 * The PnL waterfall as an inline artifact under Ely's answer: realized,
 * funding, fees and unrealized, rising in steps and reconciling to the net.
 * The caption states where the axis starts. Mounting starts the rise;
 * reduced motion shows the end state.
 */
export function PnlCard({ figures, sample }: PnlCardProps) {
  const steps = useMemo(() => pnlSteps(figures), [figures]);
  const fall = useMemo(() => waterfall(null, steps, "Net"), [steps]);
  const days = typeof figures.days === "number" ? figures.days : 30;
  const [riseFrom] = useState(() => sharedTicker().seconds());
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const local = info.still ? WATERFALL_END_S : info.seconds - riseFrom;
      drawWaterfall(ctx, fall, info.w, info.h, local, paletteOf(ctx.canvas));
    },
    [fall, riseFrom],
  );
  const label = `Waterfall over ${days} days: ${fall.bars.map((bar) => `${bar.label} ${usdSigned(bar.value)}`).join(", ")}.`;
  return (
    <figure className="rcard fr stepin m-0" aria-label={`PnL waterfall, last ${days} days`}>
      <div className="rc-h">
        <b className="flex items-center gap-2">
          <Glyph name="rebalance" scale={2} /> PnL · last {days} days
        </b>
        <span className={cx("pill", fall.total >= 0 ? "up" : "dn")}>{`${fall.total >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(fall.total))}`}</span>
      </div>
      <div className="px-3.5 pt-3">
        <PixelCanvas width={132} height={56} pixelSize={3} aspect={56 / 132} draw={draw} animate fps={12} endTime={WATERFALL_END_S} redrawKey={JSON.stringify(steps)} label={label} />
      </div>
      <div className="pnl-leg px-2" style={{ gridTemplateColumns: `repeat(${fall.bars.length}, minmax(0, 1fr))` }}>
        {fall.bars.map((bar) => (
          <span key={bar.label}>
            {bar.label}
            <b className={cx("num !text-[12px]", bar.kind === "up" && "t-up", bar.kind === "down" && "t-down")}>{usdSigned(bar.value, true)}</b>
          </span>
        ))}
      </div>
      <figcaption className="t-tag t-faint px-3.5 pb-3 pt-2 text-center !text-[9px]">
        Axis starts at {usdShort(fall.min)} · {sample ? "labelled sample" : "reference USD"} · bars reconcile to the net
      </figcaption>
    </figure>
  );
}
