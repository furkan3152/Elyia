import { useCallback } from "react";

import { drawGrid } from "../../pixel/draw";
import { elySprite, ELY_H, ELY_W } from "../../pixel/ely";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { cx } from "../../ui/cx";

export interface ElyiaMarkProps {
  /** Height in CSS px (rounded to whole device pixels per sprite pixel). */
  readonly size?: number;
  /** Kept for compatibility: the mark is always the pixel Ely. */
  readonly mono?: boolean;
  /** Accessible name; omit when a visible wordmark sits next to it. */
  readonly title?: string;
  readonly className?: string;
}

/** The Elyia mark (Pixel Survey): Ely, the pixel ibex, with the headlamp on. */
export function ElyiaMark({ size = 34, title, className }: ElyiaMarkProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, ELY_W, ELY_H);
    drawGrid(ctx, elySprite({ gear: "lamp" }), 0, 0, 1);
  }, []);
  return <PixelCanvas width={ELY_W} height={ELY_H} scale={size / ELY_H} draw={draw} label={title} decorative={!title} className={cx("shrink-0", className)} />;
}

export interface ElyiaLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

/** Pixel Ely + the ELYIA wordmark in Pixelify Sans. */
export function ElyiaLogo({ size = "md", className }: ElyiaLogoProps) {
  const mark = size === "sm" ? 34 : size === "lg" ? 51 : 42;
  const text = size === "sm" ? "text-[22px]" : size === "lg" ? "text-[32px]" : "text-[26px]";
  return (
    <span className={cx("inline-flex items-center gap-3 text-ink", className)}>
      <ElyiaMark size={mark} />
      <span className={cx("font-display font-bold leading-none tracking-[0.04em]", text)}>ELYIA</span>
    </span>
  );
}
