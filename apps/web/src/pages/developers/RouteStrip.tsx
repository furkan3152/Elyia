import { useCallback, useRef } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import { drawFlag, drawLand, drawTrail, smooth, tokenReader, type Zone } from "./portal/canvasKit";

function profile(u: number): number {
  return 0.28 + 0.5 * smooth(0.05, 0.9, u) + 0.025 * Math.sin(u * 37);
}

/**
 * The single-camp elevation strip of a route card (v2 mockup "single"):
 * Ridge rising into Summit, a dotted trail walked in accent, a camp flag that
 * turns rope red when the step settles. `layers` picks the zones.
 */
export function RouteStrip({ label, layers = ["ridge", "summit"], walkSeconds = 1.6, playKey }: { readonly label: string; readonly layers?: readonly Zone[]; readonly walkSeconds?: number; readonly playKey?: unknown }) {
  const start = useRef<number | null>(null);
  const lastKey = useRef<unknown>(playKey);
  const zones = layers.join(",");
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const token = tokenReader(ctx.canvas);
      if (start.current === null || lastKey.current !== playKey) {
        start.current = info.seconds;
        lastKey.current = playKey;
      }
      const t = info.still ? 99 : info.seconds - start.current;
      const list = zones.split(",") as Zone[];
      ctx.clearRect(0, 0, info.w, info.h);
      const tops = drawLand(ctx, info.w, info.h, profile, (u) => list[Math.min(list.length - 1, Math.floor(u * list.length))]!, Math.max(3, Math.round(info.h / 7)), 4);
      const a = Math.round(0.05 * (info.w - 1));
      const b = Math.round(0.92 * (info.w - 1));
      const p = Math.max(0, Math.min(1, (t - 0.4) / walkSeconds));
      const head = Math.round(a + (b - a) * p);
      drawTrail(ctx, tops, a, b, p > 0 ? head : null, token);
      drawFlag(ctx, b, (tops[b] ?? 0) - 2, p >= 1 ? "done" : "next", info.seconds, token, info.still);
      // base camp tent
      ctx.fillStyle = token("--ink-2");
      const y0 = (tops[a] ?? 0) - 2;
      ctx.fillRect(a - 2, y0 - 2, 5, 1);
      ctx.fillRect(a - 1, y0 - 3, 3, 1);
      ctx.fillRect(a, y0 - 4, 1, 1);
      // the walker
      ctx.fillStyle = token("--ink");
      ctx.fillRect(head - 1, (tops[head] ?? 0) - 5, 2, 3);
      ctx.fillStyle = "#F2C200";
      ctx.fillRect(head - 1, (tops[head] ?? 0) - 6, 2, 1);
    },
    [zones, walkSeconds, playKey],
  );
  return <PixelCanvas width={110} height={22} pixelSize={4} draw={draw} animate fps={15} endTime={99} redrawKey={`${zones}|${String(playKey)}`} label={label} />;
}
