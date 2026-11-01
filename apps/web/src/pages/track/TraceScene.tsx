import React, { useCallback } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { TextSurface } from "../../pixel/scene";
import { cx } from "../../ui/cx";
import { PixelFigure } from "./flow/FlowPixel";
import { useCompact, useNight } from "./flow/pixelHooks";
import { INK, STRATA, type MiniMood } from "./flow/pixelArt";
import { hashFingerprint, paintTrace, TRACE_GUTTER, type Station } from "./traceTrail";

const STATE_WORD: Readonly<Record<Station["state"], string>> = { done: "settled", now: "in flight", alert: "needs you", todo: "ahead" };
const STATE_CLASS: Readonly<Record<Station["state"], string>> = { done: "text-ink", now: "bg-signal text-signal-ink", alert: "bg-down text-card", todo: "text-ink-3" };
const STATE_MARK: Readonly<Record<Station["state"], string>> = { done: "✓ ", now: "● ", alert: "! ", todo: "○ " };

export interface TraceSceneProps {
  readonly stations: readonly Station[];
  /** Plate text when there is nothing to draw ("PASTE A HASH"). */
  readonly idleText: string;
  readonly idleMood?: MiniMood;
  readonly caption: readonly [React.ReactNode, React.ReactNode, React.ReactNode];
  readonly label: string;
  readonly className?: string;
}

/**
 * The pixel trace of a hash: the three layers as bands, each stage a
 * station on its layer, the trail stepping between them, Ely at the live
 * station. Station names sit under the frame in the same equal slots.
 */
export function TraceScene({ stations, idleText, idleMood, caption, label, className }: TraceSceneProps) {
  const compact = useCompact();
  const night = useNight();
  const key = stations.map((s) => `${s.label}:${s.layer}:${s.state}`).join("|");
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => paintTrace(ctx as unknown as TextSurface, info.w, info.h, { stations, idleText, idleMood, night, seconds: info.seconds, still: info.still || reduced, compact }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `stations`
    [key, idleText, idleMood, night, compact, reduced],
  );
  const gutter = `${TRACE_GUTTER * 100}%`;
  return (
    <PixelFigure className={className} caption={caption}>
      <PixelCanvas width={compact ? 200 : 400} height={compact ? 108 : 120} draw={draw} animate fps={12} redrawKey={`${key}|${idleText}|${night}|${compact}`} label={label} />
      {stations.length > 0 ? (
        <ol className="grid border-t-2 border-rule" style={{ gridTemplateColumns: `repeat(${stations.length}, minmax(0, 1fr))`, paddingLeft: gutter, paddingRight: gutter }} aria-label="Stages">
          {stations.map((station, index) => (
            <li key={station.label} className={cx("flex min-w-0 flex-col items-center gap-1 px-1 py-3 text-center", STATE_CLASS[station.state])}>
              <span className="tnum font-tag text-[10px] uppercase opacity-80">
                {index + 1} · {station.layer}
              </span>
              <span className="w-full font-display text-[13px] font-bold leading-tight sm:text-[15px]">{station.label}</span>
              <span className="font-tag text-[10px] uppercase opacity-80">
                {STATE_MARK[station.state]}
                {STATE_WORD[station.state]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </PixelFigure>
  );
}

/** A 7 x 7 mirrored pixel fingerprint of a hash: the same hash always draws the same mark. */
export function HashMark({ hash, className }: { readonly hash: string; readonly className?: string }) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const cells = hashFingerprint(hash);
      const palette = [STRATA.floor[2], STRATA.ridge[2], STRATA.summit[3], STRATA.gold[1]] as const;
      const fill = palette[parseInt(hash.slice(-1), 16) % palette.length]!;
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, 9, 9);
      ctx.fillStyle = "#FFF9EC";
      ctx.fillRect(1, 1, 7, 7);
      cells.forEach((row, y) =>
        row.forEach((on, x) => {
          if (!on) return;
          ctx.fillStyle = fill;
          ctx.fillRect(x + 1, y + 1, 1, 1);
        }),
      );
    },
    [hash],
  );
  return <PixelCanvas width={9} height={9} scale={6} draw={draw} redrawKey={hash} label={`Fingerprint of ${hash.slice(0, 10)}…`} className={className} />;
}
