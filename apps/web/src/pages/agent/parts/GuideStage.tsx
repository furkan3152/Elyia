import { useCallback } from "react";

import { useResolvedTheme } from "../../../app/state/useTheme";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx } from "../../../ui/cx";
import type { Mood } from "../guide/mood";
import { drawStage, STAGE_H } from "../guide/stage";
import { useWide } from "../guide/useWide";

/**
 * Ely in person: the Guide's table across the top of the conversation. A
 * mirrored range with Ely behind the survey table on the centre axis, in
 * the state the conversation is in, and the name plate under it saying it
 * in words.
 */
export function GuideStage({ mood, pixelSize, className }: { readonly mood: Mood; /** CSS px per pixel; default 5 on wide screens, 4 below. */ readonly pixelSize?: number; readonly className?: string }) {
  const night = useResolvedTheme() === "dark";
  const wide = useWide();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) =>
      drawStage(ctx, { w: info.w, seconds: info.seconds, state: mood.state, night, still: info.still }),
    [mood.state, night],
  );
  return (
    <figure className={cx("m-0", className)}>
      <PixelCanvas
        width={300}
        height={STAGE_H}
        pixelSize={pixelSize ?? (wide ? 5 : 4)}
        draw={draw}
        animate
        fps={12}
        endTime={0.6}
        redrawKey={`${mood.state}|${night}|${wide}`}
        label={`Ely, the Guide, across the survey table: ${mood.word.toLowerCase()}. ${mood.line}`}
      />
      <figcaption className="flex flex-col items-center gap-1 border-y-2 border-rule bg-paper-2 px-4 py-2.5 text-center sm:flex-row sm:justify-center sm:gap-3">
        <span className="inline-flex items-center gap-2 font-tag text-[12px] uppercase text-ink">
          <span aria-hidden="true" className={cx("inline-block h-2 w-2", mood.state === "worry" ? "bg-down" : mood.state === "summit" ? "bg-up" : mood.state === "watch" ? "bg-signal" : "bg-accent")} />
          Ely · {mood.word}
        </span>
        <span aria-hidden="true" className="hidden font-tag text-[12px] text-ink-3 sm:inline">
          ·
        </span>
        <span className="font-mono text-[13px] text-ink-2" aria-live="polite">
          {mood.line}
        </span>
      </figcaption>
    </figure>
  );
}
