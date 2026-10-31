import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { useCallback } from "react";

import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { shade } from "../../../pixel/topo";
import { cx } from "../../../ui/cx";
import { amount, usdShort } from "../range/format";
import { exposureFold } from "../range/model";
import { useSheetColors, type SheetColors } from "./sheetColors";

interface BarRow {
  readonly spotUsd: number;
  readonly perpUsd: number;
}

/**
 * One mirrored bar (pure painting): the axis in the middle, long to the
 * right and short to the left, held value solid and perps hatched, the two
 * stacked outward from the axis.
 */
function paintBar(ctx: CanvasRenderingContext2D, w: number, h: number, row: BarRow, scale: number, colors: SheetColors): void {
  ctx.clearRect(0, 0, w, h);
  const mid = Math.floor(w / 2);
  const half = mid - 1;
  // faint track ticks every 10% of the half
  ctx.fillStyle = colors.ink3;
  for (let k = 1; k < 10; k += 1) {
    const dx = Math.round((k / 10) * half);
    ctx.fillRect(mid + dx, h - 1, 1, 1);
    ctx.fillRect(mid - dx, h - 1, 1, 1);
  }
  const segment = (from: number, length: number, side: 1 | -1, color: string, hatched: boolean) => {
    for (let i = 0; i < length; i += 1) {
      const x = side > 0 ? mid + 1 + from + i : mid - 1 - from - i;
      for (let y = 1; y < h - 2; y += 1) {
        const stripe = (x + y) % 3 === 0;
        ctx.fillStyle = hatched ? (stripe ? color : shade(color, colors.night ? -0.55 : 0.6)) : y === 1 ? shade(color, colors.night ? -0.2 : 0.25) : color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };
  const width = (usd: number) => Math.max(usd !== 0 ? 1 : 0, Math.round((Math.abs(usd) / scale) * half));
  const spotSide: 1 | -1 = row.spotUsd < 0 ? -1 : 1;
  const perpSide: 1 | -1 = row.perpUsd < 0 ? -1 : 1;
  const spotW = width(row.spotUsd);
  const perpW = width(row.perpUsd);
  segment(0, spotW, spotSide, spotSide > 0 ? colors.up : colors.down, false);
  segment(perpSide === spotSide ? spotW : 0, perpW, perpSide, perpSide > 0 ? colors.up : colors.down, true);
  // the axis
  ctx.fillStyle = colors.ink;
  ctx.fillRect(mid, 0, 1, h);
}

function ExposureBar({ row, scale, label }: { readonly row: BarRow; readonly scale: number; readonly label: string }) {
  const colors = useSheetColors();
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number }) => paintBar(ctx, info.w, info.h, row, scale, colors), [row, scale, colors]);
  return <PixelCanvas width={100} height={7} pixelSize={3} draw={draw} label={label} redrawKey={`${row.spotUsd}|${row.perpUsd}|${scale}|${colors.night}`} />;
}

/**
 * Real exposure, folded across the layers and mirrored on the axis: one
 * pixel bar per underlying, long to the right of the centre line and short
 * to the left, held value solid and perps hatched; cash stands apart.
 * ▲/▼ and the words carry the side, never colour alone.
 */
export function ExposureFold({ snapshot, max = 6, className }: { readonly snapshot: PortfolioSnapshot; readonly max?: number; readonly className?: string }) {
  const fold = exposureFold(snapshot);
  const rows = fold.rows.slice(0, max);
  const scale = Math.max(1, ...rows.map((row) => Math.max(Math.abs(row.perpUsd) + Math.abs(row.spotUsd), Math.abs(row.netUsd ?? 0))));
  return (
    <section className={cx("flex flex-col", className)} aria-label="Real exposure across all layers">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 font-tag text-[11px] uppercase text-ink-2" aria-hidden="true">
        <span className="text-right">◀ short</span>
        <span className="text-ink">axis</span>
        <span>long ▶</span>
      </div>
      {rows.length === 0 ? (
        <p className="my-auto py-6 text-center text-sm text-ink-2">All cash: nothing here moves with a market.</p>
      ) : (
        <ul className="my-auto flex flex-col gap-4 py-4">
          {rows.map((row) => {
            const net = row.netUsd ?? 0;
            const long = net >= 0;
            const words = `${row.underlying}: net ${long ? "long" : "short"} ${amount(Math.abs(row.net))} (${usdShort(Math.abs(net))}); held ${usdShort(row.spotUsd)}, perps ${usdShort(row.perpUsd)}`;
            return (
              <li key={row.underlying} className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 font-mono text-xs">
                  <span className={cx("tnum truncate text-right", !long ? "text-down" : "text-ink-3")}>{!long ? `▼ ${usdShort(Math.abs(net))}` : ""}</span>
                  <span className="font-tag text-[13px] uppercase text-ink">{row.underlying}</span>
                  <span className={cx("tnum truncate", long ? "text-up" : "text-ink-3")}>{long ? `▲ ${usdShort(Math.abs(net))}` : ""}</span>
                </div>
                <ExposureBar row={row} scale={scale} label={words} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="pt-5">
        <p className="tnum text-center font-mono text-xs text-ink-2">
          net {fold.netUsd >= 0 ? "▲ long" : "▼ short"} <span className="text-ink">{usdShort(Math.abs(fold.netUsd))}</span> · gross <span className="text-ink">{fold.gross === null ? "—" : `${fold.gross.toFixed(2)}×`}</span> · cash <span className="text-ink">{usdShort(fold.cashUsd)}</span>
        </p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-tag text-[11px] uppercase text-ink-2" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 bg-up" /> held
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--up)) 0 2px, transparent 2px 6px)" }} /> perps
          </span>
        </p>
      </div>
    </section>
  );
}
