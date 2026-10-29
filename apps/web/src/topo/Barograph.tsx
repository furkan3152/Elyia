import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { BlockFeed } from "../lib/pulse/pulseHub";
import { useAutoPause } from "../motion/useAutoPause";
import { useReducedMotion } from "../motion/useReducedMotion";
import { cx } from "../ui/cx";
import { cadenceMs, shouldRebase, stripOffset, tracePath, visibleTicks, type BaroBlock } from "./geometry/barograph";

export interface BarographProps {
  /** Live per-block feed (usePulseFeed()). Without it the strip runs a labelled sample at `sampleCadenceMs`. */
  readonly feed?: BlockFeed | null;
  /** Block cadence (default 114 ms, Elysium's): the sample's tick rate and the spacing of polled bursts. */
  readonly sampleCadenceMs?: number;
  /** Strip speed in px per second (default 60). */
  readonly speed?: number;
  readonly height?: number;
  /** Small print on the right ("114 ms · 0.10 gwei · #18,514,484"). */
  readonly readout?: ReactNode;
  /** Accessible name. */
  readonly label?: string;
  readonly className?: string;
}

const WIDTH = 720;

/**
 * The barograph: a thin paper drum strip where the ink needle kicks once per
 * Elysium block (height grows with the block's transactions) and the strip
 * scrolls left at real cadence. One group moves by transform each frame; the
 * trace path is rebuilt only when a block arrives. It is a moving line, not a
 * flash. Pauses off screen and in hidden tabs; reduced motion shows a still
 * strip of the latest blocks.
 */
export function Barograph({ feed, sampleCadenceMs = 114, speed = 60, height = 64, readout, label = "Elysium barograph: one ink tick per block", className }: BarographProps) {
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const reduced = useReducedMotion();
  const { ref, active } = useAutoPause<SVGSVGElement>();
  const stripRef = useRef<SVGGElement>(null);
  const traceRef = useRef<SVGPathElement>(null);
  const needleRef = useRef<SVGPathElement>(null);
  const blocksRef = useRef<BaroBlock[]>([]);
  const realRef = useRef<BaroBlock[]>([]);
  const epochRef = useRef<number>(0);
  const [stillTrace, setStillTrace] = useState("");
  const [measured, setMeasured] = useState<number | null>(null);
  const pxPerMs = speed / 1000;
  const baseline = height - 14;
  const amplitude = height - 26;
  const sample = !feed;

  // Block intake: live feed or a labelled sample generator.
  useEffect(() => {
    const push = (number: number, txCount: number) => {
      const now = performance.now();
      const list = blocksRef.current;
      const previous = list[list.length - 1];
      const real = realRef.current;
      real.push({ number, at: now, txCount });
      if (real.length > 60) real.shift();
      // Polled blocks arrive in bursts: lay a burst out at the chain's cadence so
      // each block keeps its own tick and the trace stays even (never ahead by > 1.5 s).
      // Space by the cadence actually observed (polling delivers slower than the chain), so the trace stays continuous.
      const observed = cadenceMs(realRef.current) ?? sampleCadenceMs;
      const spacing = Math.min(1000, Math.max(60, observed));
      const spaced = previous ? Math.max(now - 150, previous.at + spacing) : now;
      const at = spaced - now > 1500 ? now : spaced;

      if (epochRef.current === 0) epochRef.current = at;
      list.push({ number, at, txCount });
      const keepAfter = at - (WIDTH / pxPerMs) * 1.2;
      while (list.length > 0 && list[0]!.at < keepAfter) list.shift();
      const ticks = visibleTicks(list, at, epochRef.current, { pxPerMs, width: WIDTH });
      const d = tracePath(ticks, baseline, amplitude);
      if (traceRef.current) traceRef.current.setAttribute("d", d);
      const last = ticks[ticks.length - 1];
      if (needleRef.current && last) needleRef.current.setAttribute("transform", `translate(0,${(-last.amplitude * amplitude * 0.5).toFixed(1)})`);
    };
    if (feed) {
      return feed.subscribe((block) => push(block.number, block.txCount ?? 0));
    }
    let number = 18_514_000;
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const timer = window.setInterval(() => {
      number += 1;
      push(number, random() < 0.35 ? 0 : Math.floor(random() * random() * 40));
    }, sampleCadenceMs);
    return () => window.clearInterval(timer);
  }, [feed, sampleCadenceMs, pxPerMs, baseline, amplitude]);

  // Scroll: one transform per frame while allowed.
  useEffect(() => {
    if (reduced || !active) return undefined;
    let handle = 0;
    const tick = () => {
      const now = performance.now();
      if (epochRef.current !== 0 && shouldRebase(now, epochRef.current, pxPerMs)) {
        // re-base: shift strip space so coordinates stay small (invisible)
        const shift = now - (WIDTH * 2) / pxPerMs - epochRef.current;
        epochRef.current += shift;
        const ticks = visibleTicks(blocksRef.current, now, epochRef.current, { pxPerMs, width: WIDTH });
        traceRef.current?.setAttribute("d", tracePath(ticks, baseline, amplitude));
      }
      if (stripRef.current && epochRef.current !== 0) {
        stripRef.current.setAttribute("transform", `translate(${stripOffset(now, epochRef.current, { pxPerMs, width: WIDTH }).toFixed(2)},0)`);
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [reduced, active, pxPerMs, baseline, amplitude]);

  // Reduced motion: a still strip, refreshed every 2 s. Also the measured cadence readout.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setMeasured(cadenceMs(realRef.current));
      if (!reduced) return;
      const now = performance.now();
      const ticks = visibleTicks(blocksRef.current, now, epochRef.current, { pxPerMs, width: WIDTH });
      const offset = stripOffset(now, epochRef.current, { pxPerMs, width: WIDTH });
      setStillTrace(tracePath(ticks.map((t) => ({ ...t, x: t.x + offset })), baseline, amplitude));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [reduced, pxPerMs, baseline, amplitude]);

  const seconds = Math.ceil(WIDTH / speed);
  return (
    <div className={cx("relative border-2 border-rule bg-card", className)}>
      <svg ref={ref} viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={`${label}${sample ? " (sample)" : ""}`} className="block">
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={WIDTH - 10} height={height} />
          </clipPath>
        </defs>
        {/* drum paper: hour lines every second, finer every 200 ms */}
        <g stroke="rgb(var(--contour))" vectorEffect="non-scaling-stroke">
          {Array.from({ length: seconds * 5 + 1 }, (_, i) => (
            <path key={i} d={`M${WIDTH - 10 - i * (speed / 5)},6V${height - 6}`} strokeWidth={i % 5 === 0 ? 0.9 : 0.4} strokeOpacity={i % 5 === 0 ? 0.55 : 0.3} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <path key={f} d={`M0,${6 + f * (height - 12)}H${WIDTH - 10}`} strokeWidth="0.4" strokeOpacity="0.3" />
          ))}
        </g>
        <path d={`M0,${baseline}H${WIDTH - 10}`} stroke="rgb(var(--ink))" strokeOpacity="0.35" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${clipId})`}>
          {reduced ? (
            <path d={stillTrace} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ) : (
            <g ref={stripRef}>
              <path ref={traceRef} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </g>
        {/* the needle arm on the right */}
        <path d={`M${WIDTH - 10},${baseline}H${WIDTH}`} stroke="rgb(var(--ink))" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        <path ref={needleRef} d={`M${WIDTH - 12},${baseline - 4}L${WIDTH - 4},${baseline}L${WIDTH - 12},${baseline + 4}Z`} fill="rgb(var(--down))" className="transition-transform duration-instant" />
      </svg>
      <div className="flex items-center justify-between gap-3 border-t-1.5 border-rule px-2.5 py-1 font-mono text-[11px] text-ink-2">
        <span className="uppercase tracking-[0.12em]">
          Barograph · {seconds} s drum{sample ? " · sample" : ""}
        </span>
        <span className="tnum">{readout ?? (measured !== null ? `${Math.round(measured)} ms per block` : "listening…")}</span>
      </div>
    </div>
  );
}
