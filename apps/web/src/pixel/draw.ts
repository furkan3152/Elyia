/**
 * Drawing helpers (pure): paint colour grids onto anything with `fillRect`,
 * and integer-scale maths so every canvas lands on whole device pixels.
 */
import type { PixelGrid } from "./ely";

/** The slice of CanvasRenderingContext2D the pixel engine paints with (easy to fake in tests). */
export interface PixelSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Paints a colour grid at (ox, oy) with `s` px per cell; null cells stay transparent. */
export function drawGrid(ctx: PixelSurface, grid: PixelGrid, ox: number, oy: number, s = 1): void {
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const c = row[x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
}

/** Paints a grid with every coloured cell replaced by one colour (shadows, silhouettes). */
export function drawSilhouette(ctx: PixelSurface, grid: PixelGrid, ox: number, oy: number, color: string, s = 1): void {
  ctx.fillStyle = color;
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) if (row[x]) ctx.fillRect(ox + x * s, oy + y * s, s, s);
  }
}

/** A filled pixel disc (sun, moon), drawn as horizontal runs. */
export function drawDisc(ctx: PixelSurface, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y += 1) {
    const w = Math.round(Math.sqrt(r * r - y * y));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
  }
}

export interface FixedScale {
  /** Device pixels per logical pixel (a whole number, at least 1). */
  readonly devicePerPixel: number;
  /** CSS px per logical pixel (devicePerPixel / dpr). */
  readonly cssPerPixel: number;
}

/**
 * The integer scale for a sprite asked to be `scale` CSS px per pixel: rounded
 * so that one logical pixel is a whole number of device pixels at this DPR.
 */
export function fixedScale(scale: number, dpr: number): FixedScale {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const devicePerPixel = Math.max(1, Math.round(scale * ratio));
  return { devicePerPixel, cssPerPixel: devicePerPixel / ratio };
}

export interface FitScale extends FixedScale {
  /** Logical width that fills the container at this scale (may overhang by less than one pixel). */
  readonly width: number;
}

/**
 * The integer scale for a canvas that fills `containerCss` px and wants about
 * `targetPixels` logical pixels across: whole device pixels per pixel, and a
 * logical width that covers the container.
 */
export function fitScale(containerCss: number, targetPixels: number, dpr: number, maxScale = 12): FitScale {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const device = Math.max(1, containerCss * ratio);
  const devicePerPixel = Math.max(1, Math.min(maxScale, Math.round(device / Math.max(1, targetPixels))));
  return { devicePerPixel, cssPerPixel: devicePerPixel / ratio, width: Math.max(1, Math.ceil(device / devicePerPixel)) };
}
