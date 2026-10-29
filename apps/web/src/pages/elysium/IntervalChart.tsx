import type { PulseBlock } from "@elyia/core/pulse";
import { useMemo } from "react";

import { rollingIntervals } from "../../lib/pulse/model";
import { Skeleton } from "../../ui/Skeleton";
import { Sparkline } from "../../ui/Sparkline";

/** A window this much slower than the mean turns gold. */
export const SLOW_FACTOR = 1.1;
const NOMINAL_MS = 115;
const POINTS = 60;

/**
 * The last 60 rolling block intervals as bars: violet on time, gold when a
 * window runs 10% slower than the mean of the chart (a slow stretch). The
 * API's poller sees blocks in small bursts, so a 12-block mean shows cadence;
 * the browser fallback polls less often and needs a 24-block mean.
 */
export function IntervalChart({ recent, source }: { readonly recent: readonly PulseBlock[]; readonly source: "api" | "rpc" | null }) {
  const span = source === "rpc" ? 24 : 12;
  const series = useMemo(() => rollingIntervals(recent, span).slice(-POINTS), [recent, span]);
  const stats = useMemo(() => {
    if (series.length === 0) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
    return { min: Math.round(min), max: Math.round(max), mean: Math.round(mean), slowFrom: Math.round(mean * SLOW_FACTOR) };
  }, [series]);
  return (
    <div className="flex flex-col gap-3">
      {series.length < 4 ? (
        <Skeleton className="h-[150px] w-full rounded-xl" />
      ) : (
        <Sparkline
          values={series}
          variant="bars"
          tone="violet"
          highlightFrom={stats?.slowFrom}
          highlightTone="gold"
          reference={NOMINAL_MS}
          slots={POINTS}
          domainMax={stats ? Math.max(stats.max, NOMINAL_MS) * 1.08 : undefined}
          width={600}
          height={150}
          fluid
          label={stats ? `Block interval, last ${series.length} blocks: ${stats.min} to ${stats.max} ms, mean ${stats.mean} ms` : "Block interval"}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-2">
        <span>
          {stats ? (
            <>
              min <span className="tnum text-text-1">{stats.min} ms</span> · mean <span className="tnum text-text-1">{stats.mean} ms</span> · max{" "}
              <span className="tnum text-text-1">{stats.max} ms</span>
            </>
          ) : (
            "measuring…"
          )}
        </span>
        <span>
          {span}-block rolling mean · wall clock · dashed = {NOMINAL_MS} ms nominal{stats ? ` · gold ≥ ${stats.slowFrom} ms` : ""}
        </span>
      </div>
    </div>
  );
}
