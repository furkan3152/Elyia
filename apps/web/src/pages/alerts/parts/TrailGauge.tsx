import { useCallback } from "react";

import { useResolvedTheme } from "../../../app/state/useTheme";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx } from "../../../ui/cx";
import type { AlertRule, RuleStatus } from "../model/rules";
import { drawTrail, TRAIL_H, TRAIL_H_COMPACT } from "../model/trail";

/**
 * The reading against your line as a pixel trail: Ely stands where the
 * value is now, the flag is your level, the dotted stretch is what is left
 * to climb (full scale = 25% away). Crossed: Ely wears the crown at the
 * flag. Event rules (fills, bridges) show a radio mast listening.
 */
export function TrailGauge({ status, rule, compact = false, className }: { readonly status: RuleStatus; readonly rule: Pick<AlertRule, "kind" | "threshold">; readonly compact?: boolean; readonly className?: string }) {
  const event = rule.kind === "fill" || rule.kind === "bridge";
  const ink = useResolvedTheme() === "dark" ? "#EEE7D8" : "#16201B";
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) =>
      drawTrail(ctx, { w: info.w, compact, kind: event ? "event" : "level", met: status.met, gap: status.gap, seconds: info.seconds, still: info.still, ink }),
    [compact, event, status.met, status.gap, ink],
  );
  return (
    <figure className={cx("m-0 min-w-0", className)}>
      <PixelCanvas
        width={compact ? 60 : 120}
        height={compact ? TRAIL_H_COMPACT : TRAIL_H}
        pixelSize={compact ? 2 : 3}
        draw={draw}
        animate={!compact}
        fps={6}
        redrawKey={`${status.met}|${status.gap}|${ink}`}
        label={`Live reading: ${status.reading}`}
      />
      {!compact ? (
        <figcaption className="mt-2 flex flex-col gap-1">
          <span className="flex justify-between gap-3 font-tag text-[10px] uppercase text-ink-3">
            <span>{event ? "listening" : "25% away"}</span>
            <span>{event ? "any time" : "your line"}</span>
          </span>
          <span className={cx("text-center font-mono text-[12px]", status.met ? "font-semibold text-up" : "text-ink-2")}>
            {status.met ? "▲ " : ""}
            {status.reading}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
