import React, { useCallback } from "react";

import { cx } from "../ui/cx";
import { drawGrid } from "./draw";
import { elySprite, INK, mini, ROPE_RED, SUN, type PixelGrid } from "./ely";
import { PixelCanvas } from "./PixelCanvas";

export interface ElyEmptyProps {
  /** What is missing, in plain words ("No positions yet"). */
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** The one next step (a Button or ButtonLink). */
  readonly action?: React.ReactNode;
  /** Smaller art and spacing for panels. */
  readonly compact?: boolean;
  readonly className?: string;
}

const W = 72;
const H = 48;
let sleeper: PixelGrid | null = null;

/** The hut scene (pure canvas painting): an A-frame hut in the snow, chimney smoke, Ely asleep at the door. */
function drawHut(ctx: CanvasRenderingContext2D, seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, W, H);
  const T = still ? 0 : seconds;
  // snow ground
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(2, 42, W - 4, 4);
  ctx.fillStyle = "#C3EAF0";
  for (let x = 3; x < W - 3; x += 3) ctx.fillRect(x, 45, 1, 1);
  ctx.fillStyle = INK;
  ctx.fillRect(2, 42, W - 4, 1);
  ctx.fillRect(2, 46, W - 4, 1);
  // hut walls
  ctx.fillStyle = "#B07A44";
  ctx.fillRect(10, 26, 30, 16);
  ctx.fillStyle = "#8A5A2B";
  for (let y = 29; y < 42; y += 4) ctx.fillRect(10, y, 30, 1);
  // roof: a stepped A-frame
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = INK;
    ctx.fillRect(25 - i - 2, 12 + i, 1, 1);
    ctx.fillRect(25 + i + 1, 12 + i, 1, 1);
    ctx.fillStyle = i < 3 ? "#FFFFFF" : ROPE_RED;
    ctx.fillRect(25 - i - 1, 12 + i, i * 2 + 2, 1);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(8, 26, 34, 1);
  ctx.fillRect(9, 26, 1, 16);
  ctx.fillRect(40, 26, 1, 16);
  // chimney and smoke
  ctx.fillStyle = INK;
  ctx.fillRect(31, 12, 5, 8);
  ctx.fillStyle = "#6B757C";
  ctx.fillRect(32, 13, 3, 7);
  ctx.fillStyle = "#BDB3A2";
  for (let i = 0; i < 4; i += 1) {
    const rise = still ? i * 3 : (T * 4 + i * 3) % 12;
    ctx.fillRect(33 + Math.round(Math.sin((rise + i) / 2) * 1.5), 10 - Math.round(rise), 2 - (rise > 8 ? 1 : 0), 1);
  }
  // door with a warm light
  ctx.fillStyle = INK;
  ctx.fillRect(20, 32, 10, 10);
  ctx.fillStyle = SUN;
  ctx.fillRect(21, 33, 8, 9);
  ctx.fillStyle = "#FFE27A";
  ctx.fillRect(22, 34, 3, 3);
  // window
  ctx.fillStyle = INK;
  ctx.fillRect(13, 29, 5, 5);
  ctx.fillStyle = "#A7D6D6";
  ctx.fillRect(14, 30, 3, 3);
  // Ely asleep at the door
  sleeper ??= mini(elySprite({ gear: "cap", eye: "sleep", mouth: "flat", fur: "Snow" }));
  const breathe = still ? 0 : Math.floor(T * 1.5) % 2;
  drawGrid(ctx, sleeper, 44, 26 + breathe, 1);
  // z's
  ctx.fillStyle = INK;
  const z = still ? 3 : (T * 3) % 10;
  for (const [ox, phase] of [
    [60, 0],
    [65, 5],
  ] as const) {
    const k = (z + phase) % 10;
    const zx = ox;
    const zy = 22 - Math.round(k);
    // a 3 x 3 pixel z
    ctx.fillRect(zx, zy, 3, 1);
    ctx.fillRect(zx + 1, zy + 1, 1, 1);
    ctx.fillRect(zx, zy + 2, 3, 1);
  }
}

/** Empty state: Ely asleep by a pixel hut, the title in Pixelify, a line of help and one action. */
export function ElyEmpty({ title, description, action, compact = false, className }: ElyEmptyProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawHut(ctx, info.seconds, info.still), []);
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 px-4 py-10", className)}>
      <PixelCanvas width={W} height={H} scale={compact ? 2 : 3} draw={draw} animate fps={10} decorative />
      <p className={cx("font-display font-bold text-ink", compact ? "text-xl" : "text-2xl")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-2 text-pretty">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
