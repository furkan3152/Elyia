/**
 * Lyre geometry (pure). Design coordinates come from the approved mockup's
 * 640 x 400 drawing: two arms, a curved yoke (quadratic Bézier from (120,74)
 * via (320,30) to (520,74)) and a base bar at y = 352; strings hang from the
 * yoke to the base. `LYRE_BOX` is the part of that drawing actually shown
 * (the frame plus a small margin), fitted to the canvas.
 */

export const LYRE_BOX = { x: 56, y: 22, width: 528, height: 362 } as const;

export const YOKE = { p0: { x: 120, y: 74 }, p1: { x: 320, y: 30 }, p2: { x: 520, y: 74 } } as const;
export const BASE_Y = 352;
export const STRING_SPAN = { left: 176, right: 464 } as const;

export interface LyreTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Fits the design box into `width` x `height`, centred. Offsets map the box's own origin. */
export function fitLyre(width: number, height: number): LyreTransform {
  const scale = Math.max(0, Math.min(width / LYRE_BOX.width, height / LYRE_BOX.height));
  return {
    scale,
    offsetX: (width - LYRE_BOX.width * scale) / 2 - LYRE_BOX.x * scale,
    offsetY: (height - LYRE_BOX.height * scale) / 2 - LYRE_BOX.y * scale,
  };
}

/** Horizontal distance between neighbouring strings on the canvas (CSS px); Infinity for one string. */
export function stringSpacing(transform: LyreTransform, count: number): number {
  if (count < 2) return Number.POSITIVE_INFINITY;
  return ((STRING_SPAN.right - STRING_SPAN.left) / (count - 1)) * transform.scale;
}

export interface LabelLayout {
  /** Labels alternate between two rows when neighbours would collide. */
  readonly staggered: boolean;
  /** Characters kept per label (long tickers are cut when space is very tight). */
  readonly maxChars: number;
  /** Height of the label area below the strings (CSS px). */
  readonly rowHeight: number;
}

/** How to lay out string labels for a given spacing: one row, two staggered rows, or two rows of short labels. */
export function labelLayout(spacing: number): LabelLayout {
  if (spacing >= 58) return { staggered: false, maxChars: 8, rowHeight: 44 };
  if (spacing >= 30) return { staggered: true, maxChars: 6, rowHeight: 76 };
  return { staggered: true, maxChars: 4, rowHeight: 76 };
}

/** y of the yoke at design x (the Bézier's x is linear in t because the control point is centred). */
export function yokeY(x: number): number {
  const t = Math.min(1, Math.max(0, (x - YOKE.p0.x) / (YOKE.p2.x - YOKE.p0.x)));
  const u = 1 - t;
  return u * u * YOKE.p0.y + 2 * u * t * YOKE.p1.y + t * t * YOKE.p2.y;
}

export interface StringLine {
  /** Design x. */
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

/** Evenly spaced strings between the span edges; one string sits in the middle. */
export function stringLines(count: number): StringLine[] {
  if (count <= 0) return [];
  const { left, right } = STRING_SPAN;
  return Array.from({ length: count }, (_, index) => {
    const x = count === 1 ? (left + right) / 2 : left + ((right - left) * index) / (count - 1);
    return { x, top: yokeY(x) + 5, bottom: BASE_Y };
  });
}

/** Design point -> canvas CSS px. */
export function toCanvas(transform: LyreTransform, x: number, y: number): { x: number; y: number } {
  return { x: transform.offsetX + x * transform.scale, y: transform.offsetY + y * transform.scale };
}

/** Index of the string nearest to a canvas x within `tolerance` CSS px, or -1. */
export function hitString(transform: LyreTransform, lines: readonly StringLine[], canvasX: number, tolerance = 14): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  lines.forEach((line, index) => {
    const distance = Math.abs(toCanvas(transform, line.x, 0).x - canvasX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return bestDistance <= tolerance ? best : -1;
}
