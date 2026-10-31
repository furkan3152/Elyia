import React from "react";

import { Ely } from "../../../pixel/Ely";
import type { ElyState } from "../../../pixel/states";
import { cx } from "../../../ui/cx";

/*
 * Shared pieces of the five flow pages (bridge, swap, earn, track,
 * discover): the framed pixel figure with its three-part caption and the
 * route card's empty state. Hooks live in ./pixelHooks.
 */

export interface PixelFigureProps {
  /** The canvas (and any overlay), drawn inside the 4 px frame. */
  readonly children: React.ReactNode;
  /** Caption row under the frame: left, centre, right (centre hides on phones). */
  readonly caption?: readonly [React.ReactNode, React.ReactNode, React.ReactNode];
  readonly className?: string;
  readonly frameClassName?: string;
}

/** A pixel drawing in a stepped frame with the reference's caption row: three cells on one axis. */
export function PixelFigure({ children, caption, className, frameClassName }: PixelFigureProps) {
  return (
    <figure className={cx("m-0 w-full", className)}>
      <div className={cx("relative bg-card px-frame px-drop", frameClassName)}>{children}</div>
      {caption ? (
        <figcaption className="mt-4 grid grid-cols-2 items-start gap-3 px-1 font-tag text-[11px] uppercase leading-snug text-ink-2 sm:grid-cols-3">
          <span className="justify-self-start text-left">{caption[0]}</span>
          <span className="hidden justify-self-center text-center sm:block">{caption[1]}</span>
          <span className="tnum justify-self-end text-right">{caption[2]}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

export interface FlowEmptyProps {
  /** The sentence the route card will carry ("bridge … HYPE to Elysium"). */
  readonly sentence: string;
  readonly help: React.ReactNode;
  readonly state?: ElyState;
  readonly className?: string;
}

/** The route card before an amount: Ely waiting at the trailhead, the sentence in quotes, one line of help. Centred on the axis. */
export function FlowEmpty({ sentence, help, state = "idle", className }: FlowEmptyProps) {
  return (
    <div className={cx("mx-auto flex max-w-[720px] flex-col items-center gap-4 bg-card px-6 py-8 text-center px-frame px-drop", className)}>
      <Ely state={state} size={88} label={null} />
      <p className="font-mono text-[17px] leading-snug text-ink">“{sentence}”</p>
      <p className="max-w-[520px] text-[14px] leading-relaxed text-ink-2 text-pretty">{help}</p>
    </div>
  );
}
