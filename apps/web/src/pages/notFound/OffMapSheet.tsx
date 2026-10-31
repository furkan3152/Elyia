import { useCallback, useMemo } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { cx } from "../../ui/cx";
import type { OffMapReading } from "./offMap";
import { CAMP, paintSheet, pinFor, SHEET_H, SHEET_W } from "./offMapArt";

export interface OffMapSheetProps {
  readonly reading: OffMapReading;
  /** The lost path, printed by the pin. */
  readonly path: string;
  readonly className?: string;
}

function token(styles: CSSStyleDeclaration, name: string, alpha = 1): string {
  const value = styles.getPropertyValue(name).trim().split(/\s+/u).join(",");
  return value ? (alpha < 1 ? `rgba(${value},${alpha})` : `rgb(${value})`) : "#888888";
}

/**
 * The 404 artifact: a pixel survey sheet torn at the right edge, the YOU ARE
 * HERE pin out on the blank paper, and Ely, lost at the pin, walking the
 * dotted trail back to base camp. The page states the same facts in text.
 */
export function OffMapSheet({ reading, path, className }: OffMapSheetProps) {
  const theme = useResolvedTheme();
  const pin = useMemo(() => pinFor(reading.y), [reading.y]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
      const styles = getComputedStyle(ctx.canvas);
      paintSheet(ctx, pin, info.seconds, info.still, { paper: token(styles, "--card"), faint: token(styles, "--ink", 0.22), line: token(styles, "--ink") });
    },
    [pin],
  );
  const shown = path.length > 24 ? `${path.slice(0, 23)}…` : path;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const [measure, measured] = useMeasuredWidth<HTMLDivElement>(960);
  const width = Math.max(0, measured - 16);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.min(4 * dpr, Math.floor((width / SHEET_W) * dpr))) / dpr;
  return (
    <div ref={measure} className={cx("w-full", className)}>
      <div className="relative mx-auto bg-card px-frame px-drop-lg" style={{ width: SHEET_W * scale }}>
        <PixelCanvas
          width={SHEET_W}
          height={SHEET_H}
          scale={scale}
          draw={draw}
          animate
          fps={10}
          redrawKey={`${theme}|${pin.y}`}
          label={`Survey sheet torn at the edge. The pin out on the blank paper is ${path}; Ely walks the trail from it back to base camp.`}
        />
        {/* labels in the page's own type, pinned to the art */}
        <span aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap bg-ink px-1 py-px font-tag text-[8px] uppercase text-paper sm:px-1.5 sm:py-0.5 sm:text-[11px]" style={{ left: pct(CAMP[0], SHEET_W), top: pct(CAMP[1] + 6, SHEET_H) }}>
          Base camp
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute flex -translate-x-[78%] flex-col items-center whitespace-nowrap bg-signal sm:-translate-x-1/2 px-1 py-px text-center font-tag text-[8px] uppercase leading-tight text-[#16201B] px-frame-thin sm:px-1.5 sm:py-0.5 sm:text-[11px]" style={{ left: pct(pin.x, SHEET_W), top: pct(pin.y + 12, SHEET_H) }}>
          You are here
          <span className="hidden font-mono normal-case sm:inline">{shown}</span>
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute hidden font-tag text-[11px] uppercase text-ink-3 sm:block" style={{ right: "2%", bottom: "4%" }}>
          Unsurveyed
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute hidden font-tag text-[11px] uppercase text-[#16201B] sm:block" style={{ left: "2%", top: "4%" }}>
          Surveyed · 1 : 25 000
        </span>
      </div>
    </div>
  );
}
