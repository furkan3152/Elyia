import React, { useCallback } from "react";

import type { BlockFeed } from "../lib/pulse/pulseHub";
import { cx } from "../ui/cx";
import { AQUA, INK } from "./ely";
import { PixelCanvas } from "./PixelCanvas";
import { useBlockTicks } from "./useBlockTicks";

export interface PixelBarographProps {
  /** Live per-block feed (usePulseFeed()). Without it, or while it is quiet, the strip runs a labelled sample. */
  readonly feed?: BlockFeed | null;
  /** Block cadence of the sample (default 114 ms, Elysium's). */
  readonly sampleCadenceMs?: number;
  /** CSS height (default 64). */
  readonly height?: number;
  /** Small print on the right ("114 ms · 0.10 gwei"). */
  readonly readout?: React.ReactNode;
  /** Accessible name. */
  readonly label?: string;
  readonly className?: string;
}

const PX = 2;
const CAPACITY = 480;

/**
 * The barograph: one pixel tick per block on an ink strip, newest at the
 * right, heights by transaction count. LIVE when the pulse feed delivers;
 * otherwise SAMPLE, never presented as data.
 */
export function PixelBarograph({ feed, sampleCadenceMs = 114, height = 64, readout, label = "Elysium barograph: one tick per block", className }: PixelBarographProps) {
  const { store, live, head } = useBlockTicks(feed, CAPACITY, sampleCadenceMs);
  const h = Math.max(12, Math.round(height / PX));
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly still: boolean }) => {
      if (!info.still) store.advance(performance.now());
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, info.w, info.h);
      // a faint baseline grid every 8 px
      ctx.fillStyle = "#1F2E27";
      for (let x = 0; x < info.w; x += 8) ctx.fillRect(x, info.h - 3, 1, 1);
      const scale = (info.h - 6) / 9;
      ctx.fillStyle = AQUA;
      const ticks = store.ticks;
      for (let x = info.w - 2, i = ticks.length - 1; x >= 0 && i >= 0; x -= 2, i -= 1) {
        const tick = Math.max(1, Math.round(ticks[i]! * scale));
        ctx.fillRect(x, info.h - 2 - tick, 1, tick);
      }
      // the newest tick in sun yellow: "you are here"
      const newest = ticks[ticks.length - 1];
      if (newest !== undefined) {
        ctx.fillStyle = "#F2C200";
        const tick = Math.max(1, Math.round(newest * scale));
        ctx.fillRect(info.w - 2, info.h - 2 - tick, 1, tick);
      }
    },
    [store],
  );
  return (
    <div className={cx("w-full min-w-0", className)}>
      <div className="px-frame-thin bg-[#16201B]">
        <PixelCanvas width={300} height={h} pixelSize={PX} draw={draw} animate fps={12} label={`${label}${live ? "" : " (sample)"}`} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 font-tag text-[11px] uppercase text-ink-2">
        <span className={cx("inline-flex items-center gap-1.5", live ? "text-up" : "text-ink-2")}>
          <span aria-hidden="true">{live ? "▲" : "◇"}</span>
          {live ? `Live${head !== null ? ` · #${head.toLocaleString("en-US")}` : ""}` : "Sample · waiting for blocks"}
        </span>
        {readout ? <span className="font-mono text-xs normal-case text-ink-2">{readout}</span> : null}
      </div>
    </div>
  );
}
