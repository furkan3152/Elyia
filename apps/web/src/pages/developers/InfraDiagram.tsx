import { useCallback } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { INFRA_H as H, INFRA_W as W, paintInfra } from "./infraPaint";

const LABEL = "pointer-events-none absolute whitespace-nowrap bg-card/90 px-1.5 py-[2px] font-tag text-[9px] uppercase tracking-[0.06em] text-ink-2 px-frame-thin";

/** Your app → Ely station → three layer bands; request packets out, signed receipts back as webhooks. */
export function InfraDiagram() {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(980);
  const scale = Math.max(1, Math.min(4, Math.floor((width - 8) / W)));
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintInfra(ctx, info.seconds, info.still), []);
  const px = (n: number) => n * scale;
  const labels = scale >= 3;
  return (
    <div ref={ref} className="w-full">
      <div className="relative mx-auto" style={{ width: px(W), height: px(H) }}>
        <PixelCanvas width={W} height={H} scale={scale} draw={draw} animate fps={20} endTime={1.35} label="Your app asks Ely; Ely routes across HyperCore, HyperEVM and Elysium; signed receipts come back to your server as webhooks." />
        {labels ? (
          <>
            <span className={LABEL} style={{ left: px(8), top: px(4) }}>
              Your app
            </span>
            <span className={LABEL} style={{ left: px(120), top: px(4), transform: "translateX(-50%)" }}>
              Ely · planner + router
            </span>
            <span className={LABEL} style={{ right: px(4), top: px(1) }}>
              Summit · Elysium
            </span>
            <span className={LABEL} style={{ right: px(4), top: px(19) }}>
              Ridge · HyperEVM
            </span>
            <span className={LABEL} style={{ right: px(4), top: px(37) }}>
              Floor · HyperCore
            </span>
            <span className={`${LABEL} text-warn-ink`} style={{ left: px(36), top: px(56) }}>
              ◂ webhook · signed receipt
            </span>
          </>
        ) : null}
      </div>
      {labels ? null : <p className="mt-3 text-center font-tag text-[10px] uppercase leading-relaxed text-ink-2">Your app → Ely (planner + router) → Elysium · HyperEVM · HyperCore ◂ signed webhook receipts</p>}
    </div>
  );
}
