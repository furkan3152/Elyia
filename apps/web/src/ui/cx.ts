/** Joins class names, skipping falsy values. Variants come from props; `className` is for layout (margin, width, grid). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined | 0>): string {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}

/** Focus ring for custom controls: a square glacier outline, offset from the ink border. */
export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line";
