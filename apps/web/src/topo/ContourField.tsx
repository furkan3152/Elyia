import { TILE, useContourTile } from "../pixel/useContourTile";
import { cx } from "../ui/cx";

export interface ContourFieldProps {
  /** Seed for the terrain (each page can have its own ground). */
  readonly seed?: number;
  /** Opacity multiplier (default 1 = very faint). */
  readonly strength?: number;
  readonly className?: string;
}

/**
 * The quiet ground under a panel: faint pixel contour lines from a seeded
 * height map, 4 px per pixel, static (nothing moves behind reading).
 * Decorative and aria-hidden; fills its positioned parent.
 */
export function ContourField({ seed = 3, strength = 1, className }: ContourFieldProps) {
  const url = useContourTile(seed, "--contour", Math.min(1, 0.22 * strength));
  return (
    <div
      aria-hidden="true"
      className={cx("pixelated pointer-events-none absolute inset-0", className)}
      style={url ? { backgroundImage: `url(${url})`, backgroundSize: `${TILE * 4}px ${TILE * 4}px` } : undefined}
    />
  );
}

export interface GrainProps {
  readonly className?: string;
}

/** Riso stipple overlay for drawn art (uses #el-grain from TopoDefs). */
export function Grain({ className }: GrainProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={cx("el-grain pointer-events-none absolute inset-0 h-full w-full", className)} style={{ opacity: "var(--grain-opacity)" }}>
      <rect width="100%" height="100%" filter="url(#el-grain)" />
    </svg>
  );
}
