import { useCallback } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { ElyState } from "../../pixel/states";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { cx } from "../../ui/cx";
import type { CampMood } from "./camp";
import { paintCamp } from "./campScene";

export interface BaseCampProps {
  readonly mood: CampMood;
  readonly ely: ElyState;
  /** Accessible description of the scene ("Ely is worried: SOL rope at 7%"). */
  readonly label: string;
  readonly radio?: boolean;
  readonly sample?: boolean;
  readonly className?: string;
}

/** The deck's base-camp scene: a wide pixel panorama on the axis with Ely saying the account's state. */
export function BaseCamp({ mood, ely, label, radio = false, sample = false, className }: BaseCampProps) {
  const night = useResolvedTheme() === "dark";
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(1200);
  const phone = width < 600;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) =>
      paintCamp(ctx, { w: info.w, h: info.h, seconds: info.seconds, still: info.still, mood, ely, night, radio }),
    [mood, ely, night, radio],
  );
  return (
    <div ref={measure} className={cx("relative bg-card px-frame px-drop-lg", className)}>
      <PixelCanvas width={phone ? 120 : 300} height={70} pixelSize={phone ? 3 : 4} aspect={phone ? 0.56 : 0.24} draw={draw} animate fps={12} label={label} redrawKey={`${mood}|${ely}|${night}|${radio}`} />
      {sample ? (
        <>
          <span className="pointer-events-none absolute left-4 top-4 bg-signal px-2 py-0.5 font-tag text-[11px] uppercase text-signal-ink px-frame-thin">Sample</span>
          <span aria-hidden="true" className="pointer-events-none absolute right-4 top-4 bg-signal px-2 py-0.5 font-tag text-[11px] uppercase text-signal-ink px-frame-thin">
            Sample
          </span>
        </>
      ) : null}
    </div>
  );
}
