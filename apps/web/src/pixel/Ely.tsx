import { useCallback } from "react";

import type { ElyTraits } from "./ely";
import { PixelCanvas } from "./PixelCanvas";
import { drawElyState, STATE_H, STATE_MEANING, STATE_W, type ElyState } from "./states";

export interface ElyProps {
  /** What Ely is saying (default idle). */
  readonly state?: ElyState;
  /** Trait overrides on top of the state's outfit (a Herd member's fur and horns). */
  readonly traits?: ElyTraits;
  /** Height in CSS px (default 88: 2 px per pixel). Rounded to whole device pixels. */
  readonly size?: number;
  /** Accessible name; default "Ely: <state>". Pass null when the text beside it says it. */
  readonly label?: string | null;
  /** Freeze on the end pose even with motion on. */
  readonly still?: boolean;
  readonly className?: string;
}

/** Ely, the pixel ibex, in one of its states. Animated on the shared ticker; reduced motion shows the end pose. */
export function Ely({ state = "idle", traits, size = 88, label, still = false, className }: ElyProps) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawElyState(ctx, { state, traits, seconds: info.seconds, still: info.still }),
    [state, traits],
  );
  return (
    <PixelCanvas
      width={STATE_W}
      height={STATE_H}
      scale={size / STATE_H}
      draw={draw}
      animate={!still}
      fps={20}
      label={label === null ? undefined : (label ?? `Ely: ${STATE_MEANING[state].title.toLowerCase()}`)}
      decorative={label === null}
      redrawKey={`${state}|${JSON.stringify(traits ?? {})}`}
      className={className}
    />
  );
}
