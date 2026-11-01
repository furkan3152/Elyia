import { useCallback, useRef } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import { steppedBarHeight } from "./devModel";
import { SUN, tokenReader } from "./portal/canvasKit";

/** Daily bars that rise in 4 steps, the newest (today) in sun. */
export function UsageBars({ values, label, height = 24 }: { readonly values: readonly number[]; readonly label: string; readonly height?: number }) {
  const start = useRef<number | null>(null);
  const key = values.join(",");
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const token = tokenReader(ctx.canvas);
      if (start.current === null) start.current = info.seconds;
      const t = info.still ? 99 : info.seconds - start.current;
      ctx.clearRect(0, 0, info.w, info.h);
      const n = values.length;
      if (n === 0) return;
      const max = Math.max(...values, 1);
      const gap = 2;
      const bw = Math.max(1, Math.floor((info.w - gap * (n - 1)) / n));
      values.forEach((value, index) => {
        const progress = (t - index * 0.06) / 0.4;
        const h = steppedBarHeight(value, max, info.h - 2, progress);
        if (h <= 0) return;
        const x = Math.round((index * (info.w - bw)) / Math.max(1, n - 1));
        ctx.fillStyle = index === n - 1 ? SUN : token("--accent");
        ctx.fillRect(x, info.h - h, bw, h);
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(x, info.h - h, bw, 1);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `values`
    [key],
  );
  return <PixelCanvas width={120} height={height} pixelSize={4} draw={draw} animate fps={12} endTime={99} redrawKey={key} label={label} />;
}
