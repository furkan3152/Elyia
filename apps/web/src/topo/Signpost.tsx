import React from "react";

import { Link } from "../app/routes/Link";
import { cssVars, staggerDelay } from "../motion/tokens";
import { cx, FOCUS_RING } from "../ui/cx";
import { Blaze } from "./Blaze";
import type { Grade } from "./geometry/conditions";

export interface SignpostProps {
  /** Where the blade points: "ELYSIUM · BRIDGE". */
  readonly destination: React.ReactNode;
  /** "5 s", "~3 min". */
  readonly eta?: React.ReactNode;
  readonly grade?: Grade;
  readonly direction?: "right" | "left";
  /** Clickable blades are buttons (onClick) or links (to). */
  readonly onClick?: () => void;
  readonly to?: string;
  /** "you are here" / best route: drawn in signal yellow; others are card stock. */
  readonly highlight?: boolean;
  /** A tick in front of the destination (the chosen route). */
  readonly chosen?: boolean;
  /** Small print under the destination ("4 min · $5.29 · 4 signatures"). */
  readonly detail?: React.ReactNode;
  /** Position in a cluster, for the staggered swing-in. */
  readonly index?: number;
  /** Swing in when mounted (skipped under reduced motion by CSS). */
  readonly swing?: boolean;
  readonly className?: string;
}

/**
 * One trail-sign blade: destination, ETA and the grade blaze on a pointed
 * blade. Blades swing in from the pole on a spring. A blade with `onClick`
 * or `to` is a real button or link with a visible focus ring.
 */
export function Signpost({ destination, eta, grade, direction = "right", onClick, to, highlight = true, chosen, detail, index = 0, swing = true, className }: SignpostProps) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 font-display text-[16px] font-bold leading-tight">
          {chosen ? <span aria-hidden="true">✓</span> : null}
          <span className="truncate">{destination}</span>
          {eta ? <span className="tnum shrink-0 font-mono text-xs font-medium normal-case tracking-normal opacity-80">{eta}</span> : null}
        </span>
        {detail ? <span className="mt-0.5 truncate font-mono text-[11px] font-normal normal-case tracking-normal opacity-80">{detail}</span> : null}
      </span>
      {grade ? <Blaze grade={grade} size={13} className="ml-auto shrink-0" /> : null}
      <span aria-hidden="true" className={cx("shrink-0 font-tag text-sm", !grade && "ml-auto", direction === "left" && "order-first")}>
        {direction === "left" ? "◀" : "▶"}
      </span>
    </>
  );
  const blade = cx(
    "relative flex min-h-[42px] w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left text-ink px-frame-thin px-drop",
    highlight ? "bg-signal text-signal-ink" : "bg-card",
    (onClick || to) && "px-press",
    swing && "el-swing",
    FOCUS_RING,
    className,
  );
  const style = swing ? cssVars({ "--el-delay": `${120 + staggerDelay(index, 110)}ms` }) : undefined;
  if (to) {
    return (
      <Link to={to} className={blade} style={style}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={blade} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div className={blade} style={style}>
      {body}
    </div>
  );
}

export interface SignpostClusterProps {
  /** Blades, top to bottom. Pass `Signpost` props without `index`. */
  readonly blades: ReadonlyArray<Omit<SignpostProps, "index" | "swing">>;
  /** Small caption on the pole's foot ("THE JUNCTION · 3 ROUTES SURVEYED"). */
  readonly caption?: React.ReactNode;
  readonly swing?: boolean;
  /** Accessible name for the group. */
  readonly label?: string;
  readonly className?: string;
}

/** Several blades on one wooden pole, staggered as they swing in. */
export function SignpostCluster({ blades, caption, swing = true, label = "Routes", className }: SignpostClusterProps) {
  return (
    <div className={cx("relative", className)} role="group" aria-label={label}>
      {caption ? <p className="caption mb-2">{caption}</p> : null}
      <div className="relative pl-3">
        <span aria-hidden="true" className="absolute bottom-[-10px] left-0 top-[-6px] w-[8px] bg-ridge px-frame-thin" />
        <ul className="flex flex-col gap-3 pl-2">
          {blades.map((blade, index) => (
            <li key={index} className="relative">
              <Signpost {...blade} index={index} swing={swing} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
