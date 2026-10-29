import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { useAnimationFrame } from "../../motion/useAnimationFrame";
import { useInView } from "../../motion/useInView";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { cx, FOCUS_RING } from "../../ui/cx";
import { paletteFor, prepareCanvas, useElementSize, type TokenName } from "../canvas";
import { BASE_Y, fitLyre, labelLayout, stringLines, stringSpacing, toCanvas, YOKE } from "./geometry";
import { INITIAL_STRING, isSettled, pluckString, stepString, stringOffset, stringParams, type StringState } from "./physics";

export type LyreTint = "mint" | "rose" | "violet" | "gold";

export interface LyreString {
  readonly id: string;
  /** Market or asset ("HYPE", "ETH-PERP"). */
  readonly label: string;
  /** Second line under the label ("+4.2%", "staked"). */
  readonly sublabel?: string;
  /** 0..1 hum amplitude: short-term realized volatility. */
  readonly amplitude: number;
  /** mint up, rose down, violet staked/neutral, gold for Elysium. */
  readonly tint: LyreTint;
  /** 0..1 string thickness: position size. */
  readonly thickness: number;
}

export interface LyreHandle {
  /** Plucks a string (a trade print, a fill). Strength 0..1, default 0.8. */
  pluck(id: string, strength?: number): void;
}

export interface LyreProps {
  readonly strings: readonly LyreString[];
  /** Called when a string is clicked or activated by keyboard (open Trade for it). */
  readonly onSelect?: (id: string) => void;
  /** Accessible name of the whole instrument. */
  readonly label: string;
  /** Canvas height in CSS px (labels add ~40 px below). */
  readonly height?: number;
  readonly showLabels?: boolean;
  readonly className?: string;
}

const TINT_TOKEN: Readonly<Record<LyreTint, TokenName>> = { mint: "mint", rose: "rose", violet: "violet-soft", gold: "gold" };
const TINT_TEXT: Readonly<Record<LyreTint, string>> = { mint: "text-mint", rose: "text-rose", violet: "text-violet-soft", gold: "text-gold" };
const SEGMENTS = 28;

/**
 * The Lyre — seven strings for seven markets or positions. Each string hums
 * with its volatility (amplitude), rings when plucked (`ref.pluck(id)` on a
 * trade print), is tinted mint/rose/violet/gold and as thick as the position.
 * Hover or focus reveals the market; click selects it.
 *
 * Canvas at 60 fps while on screen and visible; static (straight strings) with
 * reduced motion, where a pluck only brightens the string. Crisp on HiDPI.
 * Strings are real buttons for keyboard and screen-reader users.
 */
export const Lyre = forwardRef<LyreHandle, LyreProps>(function Lyre({ strings, onSelect, label, height = 300, showLabels = true, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const reduced = useReducedMotion();
  const onScreen = useInView(wrapRef);
  const theme = useResolvedTheme();
  const [hovered, setHovered] = useState<number | null>(null);
  const statesRef = useRef<Map<string, StringState>>(new Map());
  const flashRef = useRef<{ id: string; until: number } | null>(null);
  const [ringing, setRinging] = useState(false);
  const ringingRef = useRef(false);

  const lines = useMemo(() => stringLines(strings.length), [strings.length]);
  const params = useMemo(() => strings.map((string, index) => stringParams(index, strings.length, string.amplitude)), [strings]);
  // Re-read the palette when the theme flips (canvas cannot use CSS variables).
  const color = useMemo(() => paletteFor(theme), [theme]);
  const width = size.width;
  const canvasHeight = height;
  const transform = useMemo(() => fitLyre(width, canvasHeight), [width, canvasHeight]);
  const labels = labelLayout(stringSpacing(transform, strings.length));

  const draw = useCallback(
    (deltaMs: number, animate: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || width <= 0) return;
      const context = prepareCanvas(canvas, width, canvasHeight);
      if (!context) return;
      const s = transform.scale;
      context.clearRect(0, 0, width, canvasHeight);
      context.lineCap = "round";
      context.lineJoin = "round";

      // Frame: arms, yoke, base. A wide faint stroke under each line gives the gold its glow.
      const framePaths: Array<{ path: Path2D; width: number; tone: TokenName }> = [];
      const arm = (sign: 1 | -1) => {
        const path = new Path2D();
        const at = (x: number, y: number) => toCanvas(transform, 320 + sign * (x - 320), y);
        const a = at(118, 372);
        const c1 = at(70, 270);
        const c2 = at(72, 140);
        const b = at(128, 64);
        path.moveTo(a.x, a.y);
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
        return path;
      };
      const yoke = new Path2D();
      const y0 = toCanvas(transform, YOKE.p0.x, YOKE.p0.y);
      const y1 = toCanvas(transform, YOKE.p1.x, YOKE.p1.y);
      const y2 = toCanvas(transform, YOKE.p2.x, YOKE.p2.y);
      yoke.moveTo(y0.x, y0.y);
      yoke.quadraticCurveTo(y1.x, y1.y, y2.x, y2.y);
      const base = new Path2D();
      const b0 = toCanvas(transform, 150, BASE_Y);
      const b1 = toCanvas(transform, 490, BASE_Y);
      base.moveTo(b0.x, b0.y);
      base.lineTo(b1.x, b1.y);
      framePaths.push({ path: arm(-1), width: 5, tone: "lyre-frame" }, { path: arm(1), width: 5, tone: "lyre-frame" }, { path: yoke, width: 5, tone: "lyre-frame" }, { path: base, width: 7, tone: "lyre-base" });
      for (const { path, width: w, tone } of framePaths) {
        context.strokeStyle = color(tone, 0.16);
        context.lineWidth = w * s * 3;
        context.stroke(path);
        context.strokeStyle = color(tone, 1);
        context.lineWidth = w * s;
        context.stroke(path);
      }

      const now = typeof performance !== "undefined" ? performance.now() : 0;
      strings.forEach((string, index) => {
        const line = lines[index];
        const p = params[index];
        if (!line || !p) return;
        const previous = statesRef.current.get(string.id) ?? INITIAL_STRING;
        const state = animate ? stepString(previous, deltaMs, p) : { ...INITIAL_STRING };
        if (animate) statesRef.current.set(string.id, state);
        const top = toCanvas(transform, line.x, line.top);
        const bottom = toCanvas(transform, line.x, line.bottom);
        const length = bottom.y - top.y;
        const thickness = Math.max(1, (1.1 + 2.6 * Math.min(1, Math.max(0, string.thickness))) * Math.max(0.7, s));
        const amplitudePx = 15 * Math.max(0.6, s);
        const isHovered = hovered === index;
        const flashing = flashRef.current?.id === string.id && flashRef.current.until > now;
        const tint = TINT_TOKEN[string.tint];

        // Humming envelope: a soft glow along the middle of the string, breathing with the hum.
        const hum = animate ? 0.5 + 0.5 * Math.sin(state.humPhase) : 0.5;
        context.strokeStyle = color(tint, (0.12 + 0.28 * p.amplitude) * (isHovered ? 1.5 : 1));
        context.lineWidth = thickness * (1.6 + 3.2 * p.amplitude * hum);
        context.beginPath();
        context.moveTo(top.x, top.y + length * 0.2);
        context.lineTo(top.x, top.y + length * 0.8);
        context.stroke();

        // Vibration blur band: what the eye sees of a fast string.
        if (state.energy > 0.02) {
          context.fillStyle = color(tint, Math.min(0.28, 0.22 * state.energy));
          context.beginPath();
          for (let k = 0; k <= SEGMENTS; k += 1) {
            const t = k / SEGMENTS;
            context.lineTo(top.x + state.energy * amplitudePx * Math.sin(Math.PI * t), top.y + length * t);
          }
          for (let k = SEGMENTS; k >= 0; k -= 1) {
            const t = k / SEGMENTS;
            context.lineTo(top.x - state.energy * amplitudePx * Math.sin(Math.PI * t), top.y + length * t);
          }
          context.closePath();
          context.fill();
        }

        // The string itself.
        context.strokeStyle = color(tint, isHovered || flashing ? 1 : 0.92);
        context.lineWidth = thickness;
        if (isHovered || flashing) {
          context.shadowColor = color(tint, 0.8);
          context.shadowBlur = 12 * Math.max(0.6, s);
        }
        context.beginPath();
        for (let k = 0; k <= SEGMENTS; k += 1) {
          const t = k / SEGMENTS;
          const x = top.x + (animate ? stringOffset(state, p, t) * amplitudePx : 0);
          const y = top.y + length * t;
          if (k === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.shadowBlur = 0;
      });
    },
    [width, canvasHeight, transform, strings, lines, params, color, hovered],
  );

  const humming = params.some((p) => p.amplitude > 0.001);
  const ring = useCallback(() => {
    if (ringingRef.current) return;
    ringingRef.current = true;
    setRinging(true);
  }, []);
  const running = useAnimationFrame(
    ({ delta }) => {
      draw(delta, true);
      if (ringingRef.current && isSettled([...statesRef.current.values()])) {
        ringingRef.current = false;
        setRinging(false);
      }
    },
    { enabled: onScreen && width > 0 && (humming || ringing) },
  );

  useLayoutEffect(() => {
    if (!running) draw(0, !reduced);
  }, [running, reduced, draw]);

  useImperativeHandle(
    ref,
    () => ({
      pluck(id: string, strength = 0.8) {
        if (!strings.some((string) => string.id === id)) return;
        if (reduced) {
          flashRef.current = { id, until: performance.now() + 180 };
          draw(0, false);
          window.setTimeout(() => draw(0, false), 200);
          return;
        }
        statesRef.current.set(id, pluckString(statesRef.current.get(id) ?? INITIAL_STRING, strength));
        ring();
      },
    }),
    [strings, reduced, draw, ring],
  );

  const select = (index: number) => {
    const string = strings[index];
    if (!string) return;
    if (!reduced) {
      statesRef.current.set(string.id, pluckString(statesRef.current.get(string.id) ?? INITIAL_STRING, 0.9));
      ring();
    } else {
      flashRef.current = { id: string.id, until: performance.now() + 180 };
      draw(0, false);
    }
    onSelect?.(string.id);
  };

  const hoveredString = hovered !== null ? strings[hovered] : undefined;
  const hoveredLine = hovered !== null ? lines[hovered] : undefined;

  return (
    <div className={cx("relative w-full", className)} role="group" aria-label={label}>
      <div ref={wrapRef} className="relative w-full" style={{ height: canvasHeight }}>
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
        {width > 0
          ? strings.map((string, index) => {
              const line = lines[index];
              if (!line) return null;
              const top = toCanvas(transform, line.x, line.top);
              const bottom = toCanvas(transform, line.x, line.bottom);
              return (
                <button
                  key={string.id}
                  type="button"
                  aria-label={`${string.label}${string.sublabel ? `, ${string.sublabel}` : ""}`}
                  onClick={() => select(index)}
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered((current) => (current === index ? null : current))}
                  className={cx("absolute -translate-x-1/2 cursor-pointer rounded-full", FOCUS_RING)}
                  style={{ left: top.x, top: top.y, height: Math.max(24, bottom.y - top.y), width: 26 }}
                />
              );
            })
          : null}
        {hoveredString && hoveredLine && width > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 animate-fade-in whitespace-nowrap rounded-lg border border-line-strong bg-bg-1/95 px-2.5 py-1.5 text-center shadow-raised backdrop-blur"
            style={{ left: toCanvas(transform, hoveredLine.x, 0).x, top: Math.max(0, toCanvas(transform, hoveredLine.x, hoveredLine.top).y + 34) }}
          >
            <div className="font-mono text-xs font-semibold text-text-0">{hoveredString.label}</div>
            {hoveredString.sublabel ? <div className={cx("tnum font-mono text-xs", TINT_TEXT[hoveredString.tint])}>{hoveredString.sublabel}</div> : null}
          </div>
        ) : null}
      </div>
      {showLabels && width > 0 ? (
        <div className="relative w-full" style={{ height: labels.rowHeight }} aria-hidden="true">
          {strings.map((string, index) => {
            const line = lines[index];
            if (!line) return null;
            const x = toCanvas(transform, line.x, 0).x;
            const lower = labels.staggered && index % 2 === 1;
            return (
              <div key={string.id} className="absolute -translate-x-1/2 text-center font-mono text-xs leading-tight" style={{ left: x, top: lower ? 36 : 4 }}>
                <div className={cx("whitespace-nowrap transition-colors", hovered === index ? "text-text-0" : "text-text-1")}>{string.label.slice(0, labels.maxChars)}</div>
                {string.sublabel ? <div className={cx("tnum whitespace-nowrap", TINT_TEXT[string.tint])}>{string.sublabel}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
