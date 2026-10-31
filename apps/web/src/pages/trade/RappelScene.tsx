import { useCallback } from "react";

import { drawGrid } from "../../pixel/draw";
import { elySprite, INK, LAYERS, mini, ROPE_RED, SUN, type ElyTraits, type PixelGrid } from "../../pixel/ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { cx } from "../../ui/cx";

/** Where the descent is: waiting at the top, held (with progress), sending, down at base camp, or stuck. */
export type RappelPhase = "ready" | "holding" | "running" | "done" | "stuck";

const W = 120;
const H = 60;
const TOP = 8;
const FLOOR = H - 8;
const CLIFF = 46;
const ROPE_X = CLIFF + 3;

const LOOKS: Readonly<Record<"top" | "down" | "base" | "stuck", ElyTraits>> = {
  top: { gear: "rope", eye: "open", mouth: "smile" },
  down: { gear: "rope", eye: "happy", mouth: "grin" },
  base: { gear: "cap", eye: "happy", mouth: "smile" },
  stuck: { gear: "rope", eye: "worried", mouth: "o" },
};
const sprites = new Map<string, PixelGrid>();
function spriteOf(look: keyof typeof LOOKS): PixelGrid {
  let sprite = sprites.get(look);
  if (!sprite) {
    sprite = mini(elySprite(LOOKS[look]));
    sprites.set(look, sprite);
  }
  return sprite;
}

/** The cliff: altitude bands from the Summit at the top to the Floor at the bottom, contour pixels every 4 rows. */
function paintCliff(ctx: CanvasRenderingContext2D): void {
  for (let y = TOP; y < FLOOR; y += 1) {
    const depth = (y - TOP) / (FLOOR - TOP);
    const band = depth < 0.34 ? LAYERS.Summit : depth < 0.67 ? LAYERS.Ridge : LAYERS.Floor;
    // the face steps back a pixel every 6 rows, so the cliff reads as stairs of contour
    const edge = CLIFF - (Math.floor((y - TOP) / 6) % 2);
    for (let x = 0; x < edge; x += 1) {
      ctx.fillStyle = (y - TOP) % 4 === 0 && x % 2 === 0 ? band[1] : x > edge - 3 ? band[2] : band[3];
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(edge, y, 1, 1);
  }
  // snow on the summit, ink on top
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, TOP, CLIFF, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(0, TOP - 1, CLIFF + 1, 1);
  // the anchor bolt at the lip
  ctx.fillRect(ROPE_X - 1, TOP - 3, 3, 3);
  // ground of base camp
  ctx.fillStyle = INK;
  ctx.fillRect(0, FLOOR, W, 1);
  ctx.fillStyle = LAYERS.Floor[3];
  for (let x = 1; x < W; x += 3) ctx.fillRect(x, FLOOR + 2, 1, 1);
}

/** Base camp: an A-frame tent and its flag. */
function paintCamp(ctx: CanvasRenderingContext2D, flagUp: boolean): void {
  const cx = 98;
  for (let row = 0; row < 12; row += 1) {
    const half = Math.floor(row * 0.9);
    ctx.fillStyle = INK;
    ctx.fillRect(cx - half - 1, FLOOR - 12 + row, 1, 1);
    ctx.fillRect(cx + half + 1, FLOOR - 12 + row, 1, 1);
    ctx.fillStyle = row < 11 ? SUN : INK;
    ctx.fillRect(cx - half, FLOOR - 12 + row, half * 2 + 1, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(cx, FLOOR - 7, 1, 7);
  ctx.fillRect(cx, FLOOR - 20, 1, 8);
  ctx.fillStyle = flagUp ? "#1F7A4C" : ROPE_RED;
  ctx.fillRect(cx + 1, FLOOR - 20, 5, 3);
}

/**
 * Descend all, drawn: Ely rappels down the cliff from the summit (your open
 * ropes) to base camp (flat) as you hold the button, step by step; the
 * order goes when Ely touches down. Let go early and Ely climbs back up.
 */
export function RappelScene({ phase, progress, className }: { readonly phase: RappelPhase; readonly progress: number; readonly className?: string }) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
      ctx.clearRect(0, 0, W, H);
      paintCliff(ctx);
      paintCamp(ctx, phase === "done");
      const atBase = phase === "running" || phase === "done";
      const along = atBase ? 1 : Math.min(1, Math.max(0, progress));
      const sway = phase === "holding" && !info.still ? (Math.floor(info.seconds * 2) % 2 === 0 ? 1 : 0) : 0;
      // Ely's position: on the rope while descending, walking to the tent once down
      const walk = phase === "done" ? 1 : phase === "running" ? Math.min(1, ((info.still ? 1 : info.seconds) % 2) / 2) : 0;
      const ex = atBase ? Math.round(ROPE_X + 4 + walk * 26) : ROPE_X + 2 + sway;
      const ey = atBase ? FLOOR - 16 : Math.round(TOP + 2 + along * (FLOOR - TOP - 18));
      // the rope: braided from the anchor to Ely (to the ground once down)
      const ropeEnd = atBase ? FLOOR : ey + 6;
      for (let y = TOP; y < ropeEnd; y += 1) {
        ctx.fillStyle = (y >> 1) % 2 ? SUN : ROPE_RED;
        ctx.fillRect(ROPE_X, y, 1, 1);
      }
      if (atBase) {
        // the coiled rope at the foot of the cliff
        ctx.fillStyle = ROPE_RED;
        ctx.fillRect(ROPE_X - 2, FLOOR - 1, 5, 1);
        ctx.fillStyle = SUN;
        ctx.fillRect(ROPE_X - 1, FLOOR - 2, 3, 1);
      }
      const look = phase === "stuck" ? "stuck" : phase === "done" ? "base" : progress > 0 || atBase ? "down" : "top";
      drawGrid(ctx, spriteOf(look), ex - 8, ey, 1);
    },
    [phase, progress],
  );
  const step = Math.floor(progress * 20);
  return (
    <figure className={cx("px-frame-thin relative bg-paper-2", className)}>
      <PixelCanvas
        width={W}
        height={H}
        aspect={H / W}
        contain
        draw={draw}
        animate={phase === "holding" || phase === "running"}
        fps={8}
        endTime={1}
        redrawKey={`${phase}|${step}`}
        label={
          phase === "done"
            ? "Ely is down at base camp: every rope is closed."
            : phase === "running"
              ? "Ely touched down; the closing orders are being sent."
              : phase === "stuck"
                ? "Ely is stuck on the rope: some of the descent did not go through."
                : `Ely at the summit, ${Math.round(progress * 100)}% of the way down. Hold the button to descend.`
        }
      />
      <span aria-hidden="true" className="absolute left-2 top-1.5 font-tag text-[10px] uppercase text-ink-2">
        Summit · your ropes
      </span>
      <span aria-hidden="true" className="absolute right-2 top-1.5 font-tag text-[10px] uppercase text-ink-2">
        Base camp · flat ▼
      </span>
    </figure>
  );
}
