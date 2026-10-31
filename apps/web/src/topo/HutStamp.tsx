import { PixelStamp } from "../pixel/PixelStamp";
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
  /** px: 64 and under is the small stamp, 120 and over the large one. */
  readonly size?: number;
  /** Thump down once (set it only on a real transition; see useChangeKey). */
  readonly animate?: boolean;
  readonly delayMs?: number;
  readonly rotate?: number;
  /** Accessible name; by default the stamp describes itself. Pass null when nearby text says it. */
  readonly label?: string | null;
  readonly className?: string;
}

const HUT: Readonly<Record<Layer, string>> = { floor: "FLOOR", ridge: "RIDGE", summit: "SUMMIT" };

/** The hut stamp (wraps PixelStamp): SETTLED / SIGNED / REFUSED with the hut, block and time. */
export function HutStamp({ state = "settled", layer, block, time, size = 92, animate = false, delayMs = 0, rotate, label, className }: HutStampProps) {
  const blockText = block !== undefined ? `#${typeof block === "number" ? block.toLocaleString("en-US") : block}` : null;
  const detail = [HUT[layer], blockText, time].filter(Boolean).join(" · ");
  const name = label === undefined ? `${state} on the ${layer}${block !== undefined ? `, block ${block}` : ""}${time ? ` at ${time}` : ""}` : label;
  return (
    <PixelStamp
      state={state}
      detail={detail}
      size={size <= 64 ? "sm" : size >= 120 ? "lg" : "md"}
      animate={animate}
      delayMs={delayMs}
      rotate={rotate}
      label={name === null ? null : `Stamp: ${name}`}
      className={className}
    />
  );
}
