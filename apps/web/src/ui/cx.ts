/** Joins class names, skipping falsy values. Variants come from props; `className` is for layout (margin, width, grid). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined | 0>): string {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}

/** Focus ring for custom controls (buttons already get it from the base layer). */
export const FOCUS_RING = "focus-visible:outline-none focus-visible:shadow-focus";
