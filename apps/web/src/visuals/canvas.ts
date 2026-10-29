import { useEffect, useState, type RefObject } from "react";

/** Device pixel ratio for canvases, capped at 2 (sharper is invisible and costs fill rate). */
export function canvasDpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Sizes a canvas backing store for crisp HiDPI drawing and returns a context
 * whose units are CSS pixels. Only touches the backing store when the size or
 * ratio changed (resizing clears the canvas and is not free).
 */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = canvasDpr();
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/** Live CSS size of an element (ResizeObserver); 0x0 until measured. */
export function useElementSize(ref: RefObject<Element | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) => (Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5 ? previous : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export type TokenName =
  | "violet"
  | "violet-glow"
  | "violet-soft"
  | "gold"
  | "gold-deep"
  | "mint"
  | "rose"
  | "sky"
  | "text-0"
  | "text-1"
  | "text-2"
  | "bg-0"
  | "bg-1"
  | "bg-2"
  | "ray"
  | "lyre-frame"
  | "lyre-base";

/**
 * Canvas cannot read CSS variables, so visuals resolve the palette channels
 * ("139 92 246") from the document once per theme and build rgba() strings.
 */
export function readTokens(element: Element | null = typeof document === "undefined" ? null : document.documentElement): (name: TokenName, alpha?: number) => string {
  const style = element ? getComputedStyle(element) : null;
  const cache = new Map<TokenName, string>();
  return (name, alpha = 1) => {
    let channels = cache.get(name);
    if (channels === undefined) {
      channels = style?.getPropertyValue(`--${name}`).trim() || "255 255 255";
      cache.set(name, channels);
    }
    const [r = "255", g = "255", b = "255"] = channels.split(/\s+/u);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
}

/** The palette reader for a theme; memoise on the theme so a flip re-reads the variables. */
export function paletteFor(_theme: string): (name: TokenName, alpha?: number) => string {
  return readTokens();
}
