import { useCallback } from "react";

import { cx } from "../ui/cx";
import { drawGrid } from "./draw";
import { elySprite, INK, mini, ROPE_RED, SUN, type PixelGrid } from "./ely";
import { PixelCanvas } from "./PixelCanvas";

export interface ElyLoaderProps {
  /** What is loading, said to screen readers and printed under Ely ("Reading the order book"). */
  readonly label: string;
  /** "md" (default) for panels and pages, "sm" inline, "lg" for whole sheets. */
  readonly size?: "sm" | "md" | "lg";
  /** Hide the printed label (it stays the status text). */
  readonly hideLabel?: boolean;
  readonly className?: string;
}

const W = 28;
const H = 48;
const SCALE = { sm: 1, md: 2, lg: 3 } as const;
let climber: PixelGrid | null = null;

/**
 * Elyia's loading state: Ely climbing a rope, hand over hand. Replaces
 * spinners and skeleton loaders. It loops slowly on the shared ticker and
 * holds a still pose under reduced motion; the label is a polite status.
 */
export function ElyLoader({ label, size = "md", hideLabel = false, className }: ElyLoaderProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
    const T = info.seconds;
    ctx.clearRect(0, 0, W, H);
    // the rope scrolls down while Ely climbs: braided red and yellow
    const scroll = info.still ? 0 : Math.floor(T * 8);
    for (let y = 0; y < H; y += 2) {
      ctx.fillStyle = (y / 2 + scroll) % 2 ? SUN : ROPE_RED;
      ctx.fillRect(13, y, 2, 2);
    }
    // the anchor at the top
    ctx.fillStyle = INK;
    ctx.fillRect(10, 0, 8, 2);
    const climb = info.still ? 0 : Math.round(Math.sin(T * 4) * 2);
    climber ??= mini(elySprite({ gear: "rope", eye: "happy" }));
    drawGrid(ctx, climber, 6, 18 + climb, 1);
    // hands on the rope
    ctx.fillStyle = INK;
    ctx.fillRect(12, 24 + climb + (Math.floor(T * 4) % 2), 1, 2);
    ctx.fillRect(15, 24 + climb + ((Math.floor(T * 4) + 1) % 2), 1, 2);
  }, []);
  return (
    <div role="status" aria-live="polite" className={cx("inline-flex flex-col items-center gap-2", className)}>
      <PixelCanvas width={W} height={H} scale={SCALE[size]} draw={draw} animate fps={12} decorative />
      <span className={cx("font-tag text-[11px] uppercase tracking-[0.08em] text-ink-2", hideLabel && "sr-only")}>{label}</span>
    </div>
  );
}
