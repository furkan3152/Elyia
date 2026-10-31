/**
 * Crisp text on a pixel canvas. `fillText` antialiases its edges, which the
 * integer upscale would turn into grey blocks; this draws the words once on
 * a scratch canvas, keeps only the pixels at least half covered (alpha
 * threshold) in one flat colour, and blits the result. Pixel fonts
 * (Silkscreen at 8 px, Pixelify Sans) come out on the pixel grid.
 */

export interface PixelTextOptions {
  /** CSS font shorthand ("8px Silkscreen", "700 22px 'Pixelify Sans'"). */
  readonly font: string;
  /** Hex colour (#RRGGBB). */
  readonly color: string;
  readonly align?: "left" | "center" | "right";
  /** Alpha at or above this (0..255) becomes a solid pixel (default 120). */
  readonly threshold?: number;
}

interface Stamp {
  readonly canvas: HTMLCanvasElement;
  /** Width of the inked glyphs (logical pixels). */
  readonly width: number;
  readonly height: number;
}

const cache = new Map<string, Stamp>();
const MAX_CACHE = 400;

function rgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/u.exec(font);
  return match ? Number(match[1]) : 8;
}

function stampOf(text: string, options: PixelTextOptions): Stamp | null {
  const key = `${options.font}|${options.color}|${options.threshold ?? 120}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const size = fontPx(options.font);
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = options.font;
  const width = Math.max(1, Math.ceil(measure.measureText(text).width) + 2);
  const height = Math.ceil(size * 1.4) + 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = options.font;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000";
  ctx.fillText(text, 1, 1);
  const image = ctx.getImageData(0, 0, width, height);
  const [r, g, b] = rgb(options.color);
  const threshold = options.threshold ?? 120;
  for (let i = 0; i < image.data.length; i += 4) {
    const on = image.data[i + 3]! >= threshold;
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
    image.data[i + 3] = on ? 255 : 0;
  }
  ctx.putImageData(image, 0, 0);
  const stamp = { canvas, width, height };
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(key, stamp);
  return stamp;
}

/** Width in pixels the text will take (0 before fonts or outside a browser). */
export function pixelTextWidth(text: string, font: string): number {
  return stampOf(text, { font, color: "#000000" })?.width ?? 0;
}

/** Draws `text` with its top-left (or top-centre / top-right) at (x, y), snapped to whole pixels. Returns the width. */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options: PixelTextOptions): number {
  const stamp = stampOf(text, options);
  if (!stamp) return 0;
  const align = options.align ?? "left";
  const left = align === "center" ? x - stamp.width / 2 : align === "right" ? x - stamp.width : x;
  ctx.drawImage(stamp.canvas, Math.round(left) - 1, Math.round(y) - 1);
  return stamp.width;
}
