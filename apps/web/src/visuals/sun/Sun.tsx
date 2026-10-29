import type { PulseBlock } from "@elyia/core/pulse";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BlockFeed } from "../../lib/pulse/pulseHub";
import type { PulseStatus } from "../../lib/pulse/pulseHub";
import { formatBlockNumber, formatGwei, formatTps } from "../../lib/format";
import { useAnimationFrame } from "../../motion/useAnimationFrame";
import { useInView } from "../../motion/useInView";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { cx } from "../../ui/cx";
import { SerifFigure } from "../../ui/SerifFigure";
import { useResolvedTheme } from "../../app/state/useTheme";
import { paletteFor, prepareCanvas, useElementSize } from "../canvas";
import { BeatScheduler, IDLE_RAY_ALPHA, RAY_COUNT, RAY_FADE_MS, idleRayLength, rayAngle, rayIntensity, raySlot, rayStrength } from "./sunModel";

export interface SunReadout {
  readonly head: number | null;
  readonly blockTimeMs: number | null;
  readonly gasGwei: number | null;
  readonly tps: number | null;
  readonly status: PulseStatus;
  /** "api" or "rpc" (shown as a quiet source line). */
  readonly source?: "api" | "rpc" | null;
}

export interface SunProps {
  /** Per-block feed: one ray per block. Without it the rim stays idle. */
  readonly feed?: BlockFeed;
  readonly readout: SunReadout;
  /** CSS px; omit to fill the container width (square). */
  readonly size?: number;
  /** "full": block height + figures; "compact": block time only (deck card). */
  readonly variant?: "full" | "compact";
  readonly className?: string;
}

interface ActiveRay {
  bornAt: number;
  strength: number;
}

/* The disc keeps its own light in both themes: it is the sun, not a surface. */
const DISC_GRADIENT = "radial-gradient(circle at 50% 42%, #FFEBC0 0%, #F7CF7E 34%, #F0B962 52%, #C58AD9 78%, #8B5CF6 100%)";
const INK = "#1C1730";

function statusLine(readout: SunReadout): string {
  switch (readout.status) {
    case "connecting":
      return "reaching Elysium…";
    case "stale":
      return "stale · waiting for blocks";
    case "offline":
      return "offline · no endpoint answers";
    default:
      return readout.source === "rpc" ? "rays via public rpc" : "one ray per block";
  }
}

/**
 * The Sun — Elysium's pulse. A luminous disc whose rim throws one ray per
 * real block, advancing one slot per block so the ~115 ms cadence travels
 * around the rim (bursts are spread at the measured block time). The centre
 * shows block height, measured block time, gas and transactions per second.
 *
 * Canvas rays at 60 fps only while rays are lit, the page is visible, the Sun
 * is on screen and motion is allowed; with reduced motion the rim is a static
 * frame redrawn about once a second. Stale data greys the disc instead of
 * pretending to be live.
 */
export function Sun({ feed, readout, size, variant = "full", className }: SunProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measured = useElementSize(wrapRef);
  const width = size ?? measured.width;
  const reduced = useReducedMotion();
  const onScreen = useInView(wrapRef);
  const scheduler = useMemo(() => new BeatScheduler<PulseBlock>(), []);
  const raysRef = useRef<Array<ActiveRay | null>>(Array.from({ length: RAY_COUNT }, () => null));
  const lastSlotRef = useRef<number | null>(null);
  const [awake, setAwake] = useState(false);
  const awakeRef = useRef(false);
  const dim = readout.status === "stale" || readout.status === "offline";
  const theme = useResolvedTheme();
  // Rays read their colour from the theme (deeper gold on Dawn); the disc keeps its own light.
  const color = useMemo(() => paletteFor(theme), [theme]);
  const baseIdle = theme === "light" ? IDLE_RAY_ALPHA * 1.7 : IDLE_RAY_ALPHA;

  useEffect(() => {
    if (readout.blockTimeMs) scheduler.setCadence(readout.blockTimeMs);
  }, [readout.blockTimeMs, scheduler]);

  const wake = useCallback(() => {
    if (awakeRef.current) return;
    awakeRef.current = true;
    setAwake(true);
  }, []);

  useEffect(() => {
    if (!feed) return undefined;
    return feed.subscribe((block) => {
      scheduler.push(block);
      wake();
    });
  }, [feed, scheduler, wake]);

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas || width <= 0) return false;
      const context = prepareCanvas(canvas, width, width);
      if (!context) return false;
      const rays = raysRef.current;
      for (const block of scheduler.drain(now)) {
        const slot = raySlot(block.number);
        rays[slot] = { bornAt: now, strength: rayStrength(block.gasUsed) };
        lastSlotRef.current = slot;
      }
      context.clearRect(0, 0, width, width);
      const center = width / 2;
      const inner = width * (variant === "compact" ? 0.36 : 0.352);
      const maxLength = width * (variant === "compact" ? 0.1 : 0.108);
      const lineWidth = Math.max(1.25, width * 0.0058);
      const idleAlpha = dim ? baseIdle * 0.6 : baseIdle;
      let lit = false;
      context.lineCap = "round";
      for (let slot = 0; slot < RAY_COUNT; slot += 1) {
        const ray = rays[slot];
        const intensity = ray ? rayIntensity(now - ray.bornAt) : 0;
        if (ray && intensity === 0 && now - ray.bornAt >= RAY_FADE_MS) rays[slot] = null;
        if (intensity > 0) lit = true;
        const angle = rayAngle(slot);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const length = maxLength * (0.6 * idleRayLength(slot) + (ray ? 0.42 * ray.strength * intensity : 0));
        const x0 = center + cos * inner;
        const y0 = center + sin * inner;
        const x1 = center + cos * (inner + length);
        const y1 = center + sin * (inner + length);
        const alpha = idleAlpha + (1 - idleAlpha) * intensity;
        if (intensity > 0.02) {
          context.strokeStyle = color("ray", 0.22 * intensity);
          context.lineWidth = lineWidth * 3.4;
          context.beginPath();
          context.moveTo(x0, y0);
          context.lineTo(x1, y1);
          context.stroke();
        }
        context.strokeStyle = color("ray", alpha);
        context.lineWidth = lineWidth;
        context.beginPath();
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.stroke();
        if (slot === lastSlotRef.current && intensity > 0.05) {
          context.fillStyle = theme === "light" ? color("gold-deep", intensity) : `rgba(255, 236, 196, ${intensity})`;
          context.beginPath();
          context.arc(x1 + cos * lineWidth * 1.6, y1 + sin * lineWidth * 1.6, lineWidth * 1.15, 0, Math.PI * 2);
          context.fill();
        }
      }
      return lit || scheduler.pending > 0;
    },
    [width, variant, dim, scheduler, color, baseIdle, theme],
  );

  const running = useAnimationFrame(
    ({ time }) => {
      const busy = draw(time);
      if (!busy && awakeRef.current) {
        awakeRef.current = false;
        setAwake(false);
      }
    },
    { enabled: awake && onScreen },
  );

  // Static frame: reduced motion, off screen or idle. With reduced motion the
  // rim is frozen on the newest blocks (no fade) and moves on about once a second.
  const frozenHead = reduced && readout.head !== null ? readout.head - (readout.head % 9) : null;
  const liveHead = reduced ? null : readout.head;
  useLayoutEffect(() => {
    if (running) return;
    if (frozenHead !== null) {
      scheduler.clear();
      const rays = raysRef.current;
      for (let back = 0; back < RAY_COUNT; back += 1) {
        rays[raySlot(frozenHead - back)] = back < 6 ? { bornAt: -RAY_FADE_MS * 0.12 * (back + 1), strength: 0.7 } : null;
      }
      lastSlotRef.current = raySlot(frozenHead);
      draw(0);
      return;
    }
    draw(typeof performance !== "undefined" ? performance.now() : 0);
  }, [running, frozenHead, liveHead, draw, scheduler]);

  const discSize = width * (variant === "compact" ? 0.6 : 0.63);
  const headText = formatBlockNumber(readout.head);

  return (
    <div
      ref={wrapRef}
      className={cx("relative isolate aspect-square select-none", size === undefined && "w-full", className)}
      style={size !== undefined ? { width: size, height: size } : undefined}
    >
      <div
        aria-hidden="true"
        className={cx("el-loop absolute inset-0 rounded-full", !dim && "animate-breathe")}
        style={{ background: "radial-gradient(closest-side, rgba(139, 92, 246, 0.55), rgba(139, 92, 246, 0.12) 62%, transparent 100%)", opacity: dim ? 0.35 : undefined }}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      {width > 0 ? (
        <div
          className={cx("absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center transition-[filter] duration-slow", dim && "grayscale-[0.65]")}
          style={{
            width: discSize,
            height: discSize,
            background: DISC_GRADIENT,
            boxShadow: `inset 0 0 0 1px rgba(255, 231, 176, 0.55), inset 0 -${discSize * 0.08}px ${discSize * 0.2}px rgba(91, 47, 208, 0.35), 0 0 ${width * 0.12}px rgba(245, 198, 107, 0.28)`,
            color: INK,
          }}
          role="group"
          aria-label="Elysium pulse"
        >
          {variant === "full" ? (
            <>
              <span className="font-mono uppercase" style={{ fontSize: Math.max(9, width * 0.024), letterSpacing: "0.18em", opacity: 0.72 }}>
                Elysium block
              </span>
              <span className="leading-none" style={{ fontSize: width * 0.1, marginTop: width * 0.012 }}>
                {readout.head === null ? <span className="font-display opacity-60">— — —</span> : <SerifFigure text={headText} digitWidth={0.47} />}
              </span>
              <span className="tnum font-mono" style={{ fontSize: Math.max(10, width * 0.028), marginTop: width * 0.028, opacity: 0.86 }}>
                {readout.blockTimeMs === null ? "— ms" : `${Math.round(readout.blockTimeMs)} ms`} · {formatGwei(readout.gasGwei)} · {formatTps(readout.tps)} tx/s
              </span>
              <span className="font-mono uppercase" style={{ fontSize: Math.max(9, width * 0.02), letterSpacing: "0.14em", marginTop: width * 0.03, opacity: 0.62 }}>
                {statusLine(readout)}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono uppercase" style={{ fontSize: Math.max(9, width * 0.055), letterSpacing: "0.14em", opacity: 0.72 }}>
                Block time
              </span>
              <span className="font-display leading-none" style={{ fontSize: width * 0.2 }}>
                {readout.blockTimeMs === null ? "—" : <SerifFigure text={String(Math.round(readout.blockTimeMs))} digitWidth={0.47} />}
                <span style={{ fontSize: width * 0.1 }}>ms</span>
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
