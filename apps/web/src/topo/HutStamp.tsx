import { useId } from "react";

import { useAutoPause } from "../motion/useAutoPause";
import { cssVars } from "../motion/tokens";
import { cx } from "../ui/cx";
import type { Layer } from "./geometry/relief";

export type HutStampState = "settled" | "signed" | "refused";

export interface HutStampProps {
  readonly state?: HutStampState;
  /** The hut: the layer where the step settled. */
  readonly layer: Layer;
  /** Block or nonce the evidence was read at. */
  readonly block?: string | number;
  /** "14:02:11". */
  readonly time?: string;
  /** px (the stamp is round). */
  readonly size?: number;
  /** Thump down once when it scrolls into view (set it only on a real transition; see useChangeKey). */
  readonly animate?: boolean;
  readonly delayMs?: number;
  /** Rotation in degrees (default varies by state). */
  readonly rotate?: number;
  /** Accessible name; by default the stamp describes itself. Pass null when nearby text says it. */
  readonly label?: string | null;
  readonly className?: string;
}

const WORD: Readonly<Record<HutStampState, string>> = { settled: "SETTLED", signed: "SIGNED", refused: "REFUSED" };
const HUT: Readonly<Record<Layer, string>> = { floor: "FLOOR HUT", ridge: "RIDGE HUT", summit: "SUMMIT HUT" };
const INK: Readonly<Record<HutStampState, string>> = {
  settled: "rgb(var(--down))",
  signed: "rgb(var(--summit-ink))",
  refused: "rgb(var(--ink))",
};
const ROTATION: Readonly<Record<HutStampState, number>> = { settled: -8, signed: 6, refused: -4 };

/**
 * The hut stamp: a rough rubber stamp pressed on a step that settled (the
 * Survey's SETTLED stamp). Ring text: hut · block · time · word; the word
 * across a band in the middle. Ink texture from TopoDefs' #el-ink filter.
 */
export function HutStamp({ state = "settled", layer, block, time, size = 92, animate = false, delayMs = 0, rotate, label, className }: HutStampProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const { ref, seen } = useAutoPause<SVGSVGElement>();
  const ring = [HUT[layer], block !== undefined ? `#${typeof block === "number" ? block.toLocaleString("en-US") : block}` : null, time ?? null, WORD[state]]
    .filter(Boolean)
    .join(" · ");
  const name = label === undefined ? `${WORD[state].toLowerCase()} on the ${layer}${block !== undefined ? `, block ${block}` : ""}${time ? ` at ${time}` : ""}` : label;
  const ink = INK[state];
  return (
    <svg
      ref={ref}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cx("el-stamp shrink-0 overflow-visible", animate && "el-armed", animate && seen && "el-go", className)}
      style={{ ...cssVars({ "--el-rot": `${rotate ?? ROTATION[state]}deg`, "--el-delay": `${delayMs}ms` }), color: ink }}
      {...(name ? { role: "img", "aria-label": `Stamp: ${name}` } : { "aria-hidden": true })}
    >
      <circle className="el-bleed" cx="60" cy="60" r="58" fill="currentColor" />
      <g filter="url(#el-ink)">
        <circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" strokeWidth="3.6" />
        <circle cx="60" cy="60" r="41" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path id={`${id}-ring`} d="M60 60m-47.5 0a47.5 47.5 0 1 1 95 0a47.5 47.5 0 1 1 -95 0" fill="none" />
        <text fontFamily="IBM Plex Mono, monospace" fontSize="7.6" fontWeight="600" letterSpacing="0.9" fill="currentColor">
          <textPath href={`#${id}-ring`} startOffset="0" textLength="292" lengthAdjust="spacing">
            {`${ring} ✶ `}
          </textPath>
        </text>
        {state === "refused" ? (
          <>
            <rect x="19" y="48" width="82" height="24" fill="currentColor" />
            <text x="60" y="66" textAnchor="middle" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="17" fontWeight="700" letterSpacing="1" fill="rgb(var(--card))">
              {WORD[state]}
            </text>
          </>
        ) : (
          <>
            <path d="M22 49H98M22 72H98" stroke="currentColor" strokeWidth="1.6" />
            <text x="60" y="67.5" textAnchor="middle" fontFamily="Space Grotesk Variable, Space Grotesk, sans-serif" fontSize="18" fontWeight="700" letterSpacing="0.8" fill="currentColor">
              {WORD[state]}
            </text>
          </>
        )}
        <text x="60" y="42" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="7" fontWeight="600" letterSpacing="1" fill="currentColor">
          {layer.toUpperCase()}
        </text>
        <path d="M52 86 60 79 68 86" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M47 90h26" stroke="currentColor" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
