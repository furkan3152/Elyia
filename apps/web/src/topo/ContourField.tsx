import { useMemo } from "react";

import { seededRandom } from "../motion/tokens";
import { cx } from "../ui/cx";
import { isolines, sampleField, simplify, smoothPath } from "./geometry/contours";

export interface ContourFieldProps {
  /** Seed for the terrain (each page can have its own ground). */
  readonly seed?: number;
  /** Line opacity multiplier (default 1 = very faint). */
  readonly strength?: number;
  readonly className?: string;
}

const W = 1200;
const H = 800;

function terrain(seed: number): string[] {
  const random = seededRandom(seed);
  const bumps = Array.from({ length: 7 }, () => ({
    x: random() * W,
    y: random() * H,
    s: 120 + random() * 220,
    h: (random() > 0.25 ? 1 : -0.7) * (0.6 + random()),
  }));
  const field = sampleField(W, H, 16, (x, y) => {
    let sum = 0.25 * Math.sin(x / 260 + seed) * Math.cos(y / 210);
    for (const bump of bumps) sum += bump.h * Math.exp(-((x - bump.x) ** 2 + (y - bump.y) ** 2) / (2 * bump.s * bump.s));
    return sum;
  });
  const paths: string[] = [];
  for (let level = -1.4; level <= 2; level += 0.2) {
    for (const line of isolines(field, level)) {
      if (line.points.length < 5) continue;
      paths.push(smoothPath(simplify(line.points, 2), line.closed));
    }
  }
  return paths;
}

const cache = new Map<number, string[]>();

/**
 * The quiet ground under a page: very faint, static contour lines (no
 * animation, so nothing moves behind reading). Decorative and aria-hidden.
 */
export function ContourField({ seed = 3, strength = 1, className }: ContourFieldProps) {
  const paths = useMemo(() => {
    let cached = cache.get(seed);
    if (!cached) {
      cached = terrain(seed);
      cache.set(seed, cached);
    }
    return cached;
  }, [seed]);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className={cx("pointer-events-none absolute inset-0 h-full w-full text-contour", className)}
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.8" vectorEffect="non-scaling-stroke" style={{ opacity: 0.16 * strength }}>
        {paths.map((d, index) => (
          <path key={index} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
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
