import { useCallback } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { TextSurface } from "../../pixel/scene";
import { cx, FOCUS_RING } from "../../ui/cx";
import { PixelFigure } from "../track/flow/FlowPixel";
import { useCompact, useNight } from "../track/flow/pixelHooks";
import { paintSkyline, SKYLINE_GUTTER, skylineLayout } from "./skyline";
import { formatApr, formatTvl, type YieldRow } from "./yields";

export interface YieldRangeProps {
  readonly rows: readonly YieldRow[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Caption under the figure (where the numbers came from). */
  readonly source?: string;
  readonly className?: string;
}

/**
 * The yield range as a pixel side-view skyline: every way to earn as a
 * mountain in rank order, height = APR, width = TVL, rock = layer; a losing
 * vault is a lake. Ely stands on the chosen summit. Under the frame, one
 * real button per mountain sits in the same equal slot, so the names line
 * up with their peaks.
 */
export function YieldRange({ rows, selectedId, onSelect, source, className }: YieldRangeProps) {
  const compact = useCompact();
  const night = useNight();
  const key = rows.map((row) => `${row.id}:${row.aprPct}:${row.tvlUsd}`).join("|");
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      paintSkyline(ctx as unknown as TextSurface, skylineLayout(rows, info.w, info.h), { rows, selectedId, night, seconds: info.seconds, still: info.still || reduced });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `rows`
    [key, selectedId, night, reduced],
  );
  const gutter = `${SKYLINE_GUTTER * 100}%`;
  const chosen = rows.find((row) => row.id === selectedId);
  return (
    <PixelFigure className={className} caption={["◆ height = APR · width = TVL", source ?? "ranked by one rule", chosen ? `${chosen.name} · ${formatApr(chosen.aprPct)}` : "tap a peak"]}>
      <PixelCanvas
        width={compact ? 200 : 400}
        height={compact ? 120 : 140}
        draw={draw}
        animate
        fps={12}
        redrawKey={`${key}|${selectedId}|${night}|${compact}`}
        label={`Yield skyline, ranked: ${rows.map((row, index) => `${index + 1}. ${row.name}, ${formatApr(row.aprPct)} APR, ${formatTvl(row.tvlUsd)} TVL`).join("; ")}`}
      />
      <ol className="grid border-t-4 border-rule" style={{ gridTemplateColumns: `repeat(${Math.max(1, rows.length)}, minmax(0, 1fr))`, paddingLeft: gutter, paddingRight: gutter }} aria-label="Yields, ranked">
        {rows.map((row, index) => {
          const on = row.id === selectedId;
          return (
            <li key={row.id} className="flex min-w-0">
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${index + 1}. ${row.name}: ${formatApr(row.aprPct)} APR, ${formatTvl(row.tvlUsd)} TVL`}
                onClick={() => onSelect(row.id)}
                className={cx("flex w-full min-w-0 flex-col items-center gap-1 px-1 py-3 text-center", on ? "bg-signal text-signal-ink" : "text-ink hover:bg-paper-2", FOCUS_RING)}
              >
                <span className="tnum font-tag text-[10px] uppercase opacity-70">{String(index + 1).padStart(2, "0")}</span>
                <span className="hidden w-full truncate font-display text-[14px] font-bold leading-tight sm:block">{row.name}</span>
                <span className="tnum hidden font-mono text-[11px] opacity-80 sm:block">{formatTvl(row.tvlUsd)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </PixelFigure>
  );
}
