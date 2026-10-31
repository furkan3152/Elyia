import { useCallback, useId, type ReactNode } from "react";

import { drawGrid } from "../../pixel/draw";
import { AQUA, elySprite, INK, LAYERS, mini, ROPE_RED, SUN, type ElyTraits, type PixelGrid } from "../../pixel/ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { Blaze } from "../../topo/Blaze";
import type { Grade } from "../../topo/geometry/conditions";
import { cx, FOCUS_RING } from "../../ui/cx";
import { ridgeMood, trackFraction, type RidgeMood } from "./pixelTerminal";
import { useBoxSize } from "./useBoxSize";

/** Canvas height in pixels: the ridge rises 18, Ely stands 17 on top. */
const H = 36;
const RISE = 18;
/** Half the native thumb (CSS px): the thumb's centre runs from THUMB to width - THUMB, like the input's. */
const THUMB = 16;

const MOOD_TRAITS: Readonly<Record<RidgeMood, ElyTraits>> = {
  calm: { gear: "rope", eye: "happy", mouth: "smile" },
  steady: { gear: "rope", eye: "open", mouth: "smile" },
  tense: { gear: "rope", eye: "open", mouth: "flat" },
  worried: { gear: "rope", eye: "worried", mouth: "o" },
};

const MOOD_WORD: Readonly<Record<RidgeMood, string>> = {
  calm: "calm",
  steady: "steady",
  tense: "tense",
  worried: "holding on",
};

const sprites = new Map<RidgeMood, PixelGrid>();
function spriteOf(mood: RidgeMood): PixelGrid {
  let sprite = sprites.get(mood);
  if (!sprite) {
    sprite = mini(elySprite(MOOD_TRAITS[mood]));
    sprites.set(mood, sprite);
  }
  return sprite;
}

/** Altitude of the ridge (0..RISE) at a track fraction: a stepped climb that steepens towards the summit. */
function altitude(t: number): number {
  return Math.round(2 + Math.pow(Math.min(1, Math.max(0, t)), 1.25) * (RISE - 2));
}

/** Land colour of an altitude band: Floor teal low, Ridge ochre, Summit glacier, snow on top; contour pixels every 4. */
function landAt(alt: number, top: number): string {
  if (top >= RISE - 2 && alt >= top - 1) return "#FFFFFF";
  const band = alt < 5 ? LAYERS.Floor : alt < 10 ? LAYERS.Ridge : LAYERS.Summit;
  return alt % 4 === 0 ? band[1] : band[3];
}

/** CSS x of a track fraction, matching the native thumb's centre. */
function thumbX(fraction: number, width: number): number {
  return THUMB + fraction * Math.max(0, width - THUMB * 2);
}

export interface LeverageRidgeProps {
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** Leverage at which this market is high risk: the red flag on the ridge. */
  readonly danger: number;
  readonly ticks: readonly number[];
  readonly gradeOf: (value: number) => Grade;
  readonly label: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Leverage is altitude. The slider is a pixel ridge climbing from the Floor
 * (1x) to the Summit (the market's max); Ely is the thumb, standing on the
 * ridge at your leverage, calm low down, tense on the mountain grades, and
 * holding on with a sweat drop past the red flag. The native range input
 * sits on top (keyboard, screen readers, touch).
 */
export function LeverageRidge({ value, min = 1, max, onChange, danger, ticks, gradeOf, label, disabled, className }: LeverageRidgeProps) {
  const id = useId();
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const grade = gradeOf(value);
  const mood = ridgeMood(grade, value, danger);
  const t = trackFraction(value, min, max);
  const tDanger = trackFraction(danger, min, max);
  const cssW = box.width;
  const xOf = (fraction: number) => thumbX(fraction, cssW);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const { w } = info;
      ctx.clearRect(0, 0, w, H);
      if (cssW <= 0) return;
      const cpp = cssW / w;
      const fracAt = (x: number) => (x * cpp - THUMB) / Math.max(1, cssW - THUMB * 2);
      const ex = Math.round(thumbX(t, cssW) / cpp);
      const dangerX = Math.round(thumbX(tDanger, cssW) / cpp);
      // the ridge, in 2-pixel steps; ahead of Ely it is dithered (not climbed yet)
      for (let x = 0; x < w; x += 2) {
        const top = altitude(fracAt(x + 1));
        const ahead = x > ex + 1;
        for (let alt = 0; alt < top; alt += 1) {
          const y = H - 1 - alt;
          for (let dx = 0; dx < 2; dx += 1) {
            if (ahead && (x + dx + y) % 2 === 1) continue;
            ctx.fillStyle = landAt(alt, top);
            ctx.fillRect(x + dx, y, 1, 1);
          }
        }
        // the skyline: one ink pixel on top of every column
        ctx.fillStyle = INK;
        ctx.fillRect(x, H - 1 - top, 2, 1);
      }
      // the danger flag: a rope-red pennant where the market turns high risk
      if (tDanger < 1) {
        const top = H - 1 - altitude(fracAt(dangerX));
        ctx.fillStyle = INK;
        ctx.fillRect(dangerX, top - 9, 1, 9);
        ctx.fillStyle = ROPE_RED;
        ctx.fillRect(dangerX + 1, top - 9, 4, 1);
        ctx.fillRect(dangerX + 1, top - 8, 3, 1);
        ctx.fillRect(dangerX + 1, top - 7, 2, 1);
      }
      // Ely on the ridge at your leverage
      const ground = H - 1 - altitude(fracAt(ex));
      const shake = mood === "worried" && !info.still ? (Math.floor(info.seconds * 2) % 2 === 0 ? 1 : 0) : 0;
      drawGrid(ctx, spriteOf(mood), ex - 8 + shake, ground - 16, 1);
      // sweat: one drop when tense, a falling drop and a spare when holding on
      if (mood === "tense" || mood === "worried") {
        const fall = mood === "worried" && !info.still ? Math.floor(info.seconds * 3) % 4 : 1;
        ctx.fillStyle = AQUA;
        ctx.fillRect(ex + 7, ground - 13 + fall, 1, 2);
        ctx.fillRect(ex + 8, ground - 12 + fall, 1, 1);
        if (mood === "worried") {
          ctx.fillRect(ex - 9, ground - 12, 1, 2);
          ctx.fillStyle = SUN;
          ctx.fillRect(ex - 1, ground - 19, 2, 1);
        }
      }
    },
    [cssW, t, tDanger, mood],
  );

  const risky = value >= danger;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-tag text-[12px] uppercase text-ink-2">
          {label}
        </label>
        <span className={cx("tnum inline-flex items-center gap-1.5 font-display text-[18px] font-bold leading-none", risky ? "text-down" : "text-ink")}>
          <Blaze grade={grade} size={13} />
          {value}× · T{grade}
        </span>
      </div>
      <div ref={boxRef} className="tx-focus-within relative">
        <PixelCanvas width={140} height={H} pixelSize={2} draw={draw} animate={mood === "worried"} fps={6} decorative redrawKey={`${cssW}|${value}|${max}|${danger}|${mood}`} />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-valuetext={`${value}×, grade T${grade}, Ely ${MOOD_WORD[mood]}${risky ? ", high for this market" : ""}`}
          onChange={(event) => onChange(Number(event.target.value))}
          className="tx-ridge-range"
        />
      </div>
      <div className="relative h-5" aria-hidden="true">
        {ticks.map((tick, index) => {
          const left = xOf(trackFraction(tick, min, max));
          const previous = index > 0 ? xOf(trackFraction(ticks[index - 1]!, min, max)) : -Infinity;
          if (left - previous < 26 && index !== ticks.length - 1) return null;
          return (
            <button
              key={tick}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => onChange(tick)}
              className={cx("absolute top-0 -translate-x-1/2 whitespace-nowrap px-0.5 font-tag text-[10px]", value >= tick ? "text-ink" : "text-ink-3", tick >= danger ? "!text-down" : "", FOCUS_RING)}
              style={{ left }}
            >
              {tick}×
            </button>
          );
        })}
      </div>
    </div>
  );
}
