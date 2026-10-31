import { PixelProfile } from "../pixel/PixelProfile";
import type { ProfileCamp, ProfilePoint } from "./geometry/profile";

export interface ElevationProfileProps {
  readonly series: readonly ProfilePoint[];
  /** Key events as camps ("CAMP II · HYPE 3× opened"). */
  readonly camps?: readonly ProfileCamp[];
  /** Kept for compatibility (the profile fills its container). */
  readonly width?: number;
  /** CSS height of the ridge (default 192). */
  readonly height?: number;
  readonly formatValue?: (value: number) => string;
  readonly startLabel?: string;
  readonly endLabel?: string;
  /** Accessible summary. */
  readonly label: string;
  readonly caption?: string;
  readonly className?: string;
}

/** The elevation profile (wraps PixelProfile): equity as a stepped pixel ridge, summit flag at the ATH, the worst drawdown as a valley lake. */
export function ElevationProfile({ series, camps, height = 192, formatValue, startLabel, endLabel, label, caption, className }: ElevationProfileProps) {
  return (
    <PixelProfile
      series={series}
      camps={camps}
      height={Math.max(32, Math.round(height / 3))}
      formatValue={formatValue}
      startLabel={startLabel}
      endLabel={endLabel}
      label={label}
      caption={caption}
      className={className}
    />
  );
}
