import type { PulseBlock } from "@elyia/core/pulse";
import { useMemo } from "react";

import { rollingIntervals } from "../../lib/pulse/model";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { cx } from "../../ui/cx";
import { intervalHistogram } from "./model";

const NOMINAL_MS = 114;
const FROM = 60;
const TO = 220;
const H = 180;
const PAD_L = 8;
const PAD_B = 26;

/**
 * Block time as a histogram of rolling intervals: how often a stretch of
 * blocks ran at each cadence. The fullest bin is highlighted (signal, the
 * "you are here" ink) and the 114 ms nominal cadence is a dashed rule.
 * Polled blocks arrive in bursts, so each sample is a rolling mean over
 * `span` blocks (12 from the API stream, 24 from the browser's RPC poll).
 */
export function BlockTimeHistogram({ recent, source }: { readonly recent: readonly PulseBlock[]; readonly source: "api" | "rpc" | null }) {
  const [ref, measured] = useMeasuredWidth<HTMLElement>(560);
  // Laid out in real pixels so the axis labels keep their size on a phone.
  const W = Math.max(280, measured);
  const span = source === "rpc" ? 24 : 12;
  const histogram = useMemo(() => intervalHistogram(rollingIntervals(recent, span), { from: FROM, to: TO, binMs: 10 }), [recent, span]);
  const peak = Math.max(1, ...histogram.bins.map((bin) => bin.count));
  const binW = (W - PAD_L * 2) / histogram.bins.length;
  const x = (ms: number) => PAD_L + ((ms - FROM) / (TO - FROM)) * (W - PAD_L * 2);
  const summary =
    histogram.total > 0
      ? `Block time histogram over ${histogram.total} rolling windows: ${Math.round(histogram.min!)} to ${Math.round(histogram.max!)} ms, mean ${histogram.mean} ms`
      : "Block time histogram: measuring";
  return (
    <figure ref={ref} className="m-0 flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={summary}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <path key={f} d={`M${PAD_L},${(H - PAD_B) * (1 - f) + 6}H${W - PAD_L}`} stroke="rgb(var(--contour))" strokeOpacity="0.45" strokeWidth="0.8" />
        ))}
        {histogram.bins.map((bin, index) => {
          const h = (bin.count / peak) * (H - PAD_B - 12);
          const top = H - PAD_B - h;
          return (
            <rect
              key={bin.from}
              x={PAD_L + index * binW + 2}
              y={top}
              width={Math.max(1, binW - 4)}
              height={Math.max(0, h)}
              fill={index === histogram.mode ? "rgb(var(--signal))" : "rgb(var(--summit))"}
              fillOpacity={index === histogram.mode ? 1 : 0.8}
              stroke="rgb(var(--ink))"
              strokeWidth={bin.count > 0 ? 1.2 : 0}
              className="transition-[y,height] duration-base"
            />
          );
        })}
        <path d={`M${PAD_L},${H - PAD_B}H${W - PAD_L}`} stroke="rgb(var(--ink))" strokeWidth="1.5" />
        <path d={`M${x(NOMINAL_MS)},8V${H - PAD_B}`} stroke="rgb(var(--ink))" strokeWidth="1.2" strokeDasharray="4 3" />
        <text x={x(NOMINAL_MS) + 5} y="18" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink))" paintOrder="stroke" stroke="rgb(var(--card))" strokeWidth="4" strokeLinejoin="round">
          114 ms nominal
        </text>
        {(W < 420 ? [60, 140, 220] : [60, 100, 140, 180, 220]).map((ms) => (
          <text key={ms} x={x(ms)} y={H - 8} textAnchor={ms === FROM ? "start" : ms === TO ? "end" : "middle"} fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="rgb(var(--ink-2))">
            {ms === TO ? "220+ ms" : ms}
          </text>
        ))}
      </svg>
      <figcaption className={cx("flex flex-wrap justify-between gap-2 font-mono text-[12px] text-ink-2")}>
        <span className="tnum">
          {histogram.total > 0 ? (
            <>
              min <b className="text-ink">{Math.round(histogram.min!)}</b> · mean <b className="text-ink">{histogram.mean}</b> · max <b className="text-ink">{Math.round(histogram.max!)}</b> ms
            </>
          ) : (
            "measuring…"
          )}
        </span>
        <span>{span}-block rolling mean · wall clock · yellow = most common</span>
      </figcaption>
    </figure>
  );
}
