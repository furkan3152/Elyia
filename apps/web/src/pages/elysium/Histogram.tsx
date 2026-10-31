import type { PulseBlock } from "@elyia/core/pulse";
import { useCallback, useMemo } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { rollingIntervals } from "../../lib/pulse/model";
import { INK, SUN } from "../../pixel/ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { intervalHistogram, type Histogram } from "./model";

const NOMINAL_MS = 114;
const FROM = 60;
const TO = 220;
const H = 80;
const AXIS = [60, 100, 140, 180, 220] as const;

/** Summit band colours, deep at the foot of each bar to snow at its top. */
const BAR = ["#2E7F94", "#4FA7BA", "#85CCD8", "#C3EAF0"] as const;

function paintHistogram(ctx: CanvasRenderingContext2D, w: number, histogram: Histogram, line: string): void {
  ctx.clearRect(0, 0, w, H);
  const n = histogram.bins.length;
  const gap = 2;
  const barW = Math.max(2, Math.floor((w - gap * (n + 1)) / n));
  const used = n * barW + (n + 1) * gap;
  const ox = Math.floor((w - used) / 2);
  const peak = Math.max(1, ...histogram.bins.map((bin) => bin.count));
  const floor = H - 2;
  // grid dots every quarter
  ctx.fillStyle = line;
  for (const f of [0.25, 0.5, 0.75]) {
    const y = Math.round(floor - (floor - 6) * f);
    for (let x = ox; x < ox + used; x += 4) {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
  histogram.bins.forEach((bin, index) => {
    const x = ox + gap + index * (barW + gap);
    const bh = bin.count > 0 ? Math.max(2, Math.round((bin.count / peak) * (floor - 6))) : 0;
    if (bh === 0) return;
    const top = floor - bh;
    const mode = index === histogram.mode;
    for (let y = top; y < floor; y += 1) {
      const k = Math.min(BAR.length - 1, Math.floor(((floor - y) / Math.max(1, bh)) * BAR.length));
      ctx.fillStyle = mode ? (y - top < 2 ? "#FFE27A" : SUN) : BAR[k]!;
      ctx.fillRect(x, y, barW, 1);
    }
    // ink outline on top and sides
    ctx.fillStyle = INK;
    ctx.fillRect(x, top - 1, barW, 1);
    ctx.fillRect(x - 1, top, 1, bh);
    ctx.fillRect(x + barW, top, 1, bh);
  });
  // baseline
  ctx.fillStyle = line;
  ctx.fillRect(ox, floor, used, 2);
  // the nominal 114 ms: a dotted line
  const nx = ox + Math.round(((NOMINAL_MS - FROM) / (TO - FROM)) * used);
  for (let y = 2; y < floor; y += 3) ctx.fillRect(nx, y, 1, 2);
}

/**
 * Block time as a pixel histogram of rolling intervals: how often a stretch
 * of blocks ran at each cadence. Bars are stacked in the Summit's bands; the
 * fullest bin is sun yellow ("most common"); the dotted line is the 114 ms
 * nominal cadence. Polled blocks arrive in bursts, so each sample is a
 * rolling mean over `span` blocks (12 from the API stream, 24 from the
 * browser's RPC poll).
 */
export function BlockTimeHistogram({ recent, source }: { readonly recent: readonly PulseBlock[]; readonly source: "api" | "rpc" | null }) {
  const theme = useResolvedTheme();
  const span = source === "rpc" ? 24 : 12;
  const histogram = useMemo(() => intervalHistogram(rollingIntervals(recent, span), { from: FROM, to: TO, binMs: 10 }), [recent, span]);
  const key = histogram.bins.map((bin) => bin.count).join(",");
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number }) => {
      const ink = getComputedStyle(ctx.canvas).getPropertyValue("--ink").trim().split(/\s+/u).join(",");
      paintHistogram(ctx, info.w, histogram, ink ? `rgb(${ink})` : INK);
    },
    [histogram],
  );
  const summary =
    histogram.total > 0
      ? `Block time histogram over ${histogram.total} rolling windows: ${Math.round(histogram.min!)} to ${Math.round(histogram.max!)} ms, mean ${histogram.mean} ms`
      : "Block time histogram: measuring";
  return (
    <figure className="m-0 flex h-full flex-col">
      <div className="relative">
        <PixelCanvas width={160} height={H} pixelSize={4} draw={draw} label={summary} redrawKey={`${key}|${theme}`} />
        <span className="pointer-events-none absolute top-1 bg-card px-1 font-tag text-[10px] uppercase text-ink" style={{ left: `calc(${((NOMINAL_MS - FROM) / (TO - FROM)) * 100}% + 8px)` }}>
          114 ms nominal
        </span>
      </div>
      <div aria-hidden="true" className="relative mt-2 h-4 font-tag text-[10px] uppercase text-ink-2">
        {AXIS.map((ms) => (
          <span key={ms} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${((ms - FROM) / (TO - FROM)) * 100}%`, transform: ms === FROM ? "none" : ms === TO ? "translateX(-100%)" : undefined }}>
            {ms === TO ? "220+" : ms}
          </span>
        ))}
      </div>
      <figcaption className="mt-auto flex flex-col items-center gap-1 pt-5 text-center font-mono text-[12px] text-ink-2">
        <span className="tnum">
          {histogram.total > 0 ? (
            <>
              min <b className="text-ink">{Math.round(histogram.min!)}</b> · mean <b className="text-ink">{histogram.mean}</b> · max <b className="text-ink">{Math.round(histogram.max!)}</b> ms
            </>
          ) : (
            "measuring…"
          )}
        </span>
        <span className="font-tag text-[10px] uppercase">{span}-block rolling mean · wall clock · yellow = most common</span>
      </figcaption>
    </figure>
  );
}
