import type { NetworkFamily } from "@elyia/core/networks";

export interface NetworkGlyphProps {
  readonly family: NetworkFamily;
  readonly size?: number;
  readonly className?: string;
}

/**
 * Elyia's own realm glyphs (never the networks' logos): Elysium a small sun,
 * HyperEVM a hexagon (a contract cell), HyperCore a cut diamond (the book).
 * Colour comes from `currentColor`.
 */
export function NetworkGlyph({ family, size = 14, className }: NetworkGlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {family === "elysium" ? (
        <>
          <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
        </>
      ) : family === "hyperevm" ? (
        <>
          <path d="M8 1.75 13.4 4.9v6.2L8 14.25 2.6 11.1V4.9Z" />
          <path d="M8 5.6 10.1 6.8v2.4L8 10.4 5.9 9.2V6.8Z" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path d="M8 1.75 14.25 8 8 14.25 1.75 8Z" />
          <path d="M8 5.2 10.8 8 8 10.8 5.2 8Z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
