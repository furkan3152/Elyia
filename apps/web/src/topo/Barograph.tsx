import type { ReactNode } from "react";

import type { BlockFeed } from "../lib/pulse/pulseHub";
import { PixelBarograph } from "../pixel/PixelBarograph";

export interface BarographProps {
  /** Live per-block feed (usePulseFeed()). Without it the strip runs a labelled sample at `sampleCadenceMs`. */
  readonly feed?: BlockFeed | null;
  /** Block cadence (default 114 ms, Elysium's): the sample's tick rate. */
  readonly sampleCadenceMs?: number;
  /** Kept for compatibility (the pixel strip scrolls one tick per block). */
  readonly speed?: number;
  readonly height?: number;
  /** Small print on the right ("114 ms · 0.10 gwei · #18,514,484"). */
  readonly readout?: ReactNode;
  /** Accessible name. */
  readonly label?: string;
  readonly className?: string;
}

/** The Elysium barograph (wraps PixelBarograph): one pixel tick per block, LIVE or a labelled SAMPLE. */
export function Barograph({ feed, sampleCadenceMs, height, readout, label, className }: BarographProps) {
  return <PixelBarograph feed={feed} sampleCadenceMs={sampleCadenceMs} height={height} readout={readout} label={label} className={className} />;
}
