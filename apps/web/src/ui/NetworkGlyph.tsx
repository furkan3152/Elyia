import type { NetworkFamily } from "@elyia/core/networks";

export interface NetworkGlyphProps {
  readonly family: NetworkFamily;
  readonly size?: number;
  readonly className?: string;
}

/**
 * Altitude glyphs (never the networks' logos): the Summit a peak with a
 * glacier cap (Elysium), the Ridge a rock ridge line (HyperEVM), the Floor
 * lake water lines (HyperCore). Colour comes from `currentColor`.
 */
export function NetworkGlyph({ family, size = 14, className }: NetworkGlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="square">
      {family === "elysium" ? (
        <>
          <path d="M1.5 14 8 2.5 14.5 14Z" />
          <path d="M5.6 6.8 8 2.5l2.4 4.3-1.2-.7L8 7.2l-1.2-1.1Z" fill="currentColor" />
        </>
      ) : family === "hyperevm" ? (
        <path d="M1 13 5 6.5 7.6 9.6 10.6 4 15 13Z" />
      ) : (
        <>
          <path d="M1.5 6.2c1.7-1.3 3.3-1.3 5 0s3.3 1.3 5 0 2.2-1 3 0" />
          <path d="M1.5 10.4c1.7-1.3 3.3-1.3 5 0s3.3 1.3 5 0 2.2-1 3 0" />
          <path d="M1.5 14h13" />
        </>
      )}
    </svg>
  );
}
