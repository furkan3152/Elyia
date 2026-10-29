import { useEffect, useRef } from "react";

import type { BlockFeed, PulseStatus } from "../../lib/pulse/pulseHub";
import { prefersReducedMotion } from "../../motion/useReducedMotion";
import { cx } from "../../ui/cx";

export interface MiniSunProps {
  readonly feed?: BlockFeed;
  readonly status: PulseStatus;
  /** Dot diameter in px. */
  readonly size?: number;
  /** Beat once every N blocks (default 10, about once per second on Elysium). */
  readonly every?: number;
  readonly className?: string;
}

const TONE: Readonly<Record<PulseStatus, string>> = {
  live: "bg-gold",
  fallback: "bg-gold",
  connecting: "bg-text-2",
  stale: "bg-text-2",
  offline: "bg-rose",
};

/**
 * The top bar's heartbeat: a small sun that beats about once per second
 * (every 10th block), never at block rate (photosensitivity rule). The beat
 * uses the Web Animations API on the element, so blocks never re-render React.
 */
export function MiniSun({ feed, status, size = 9, every = 10, className }: MiniSunProps) {
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!feed) return undefined;
    let count = 0;
    return feed.subscribe(() => {
      count += 1;
      if (count % every !== 0) return;
      const dot = dotRef.current;
      if (!dot || prefersReducedMotion() || typeof dot.animate !== "function" || document.visibilityState === "hidden") return;
      dot.animate(
        [
          { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(var(--gold) / 0.55)" },
          { transform: "scale(1.35)", boxShadow: "0 0 0 5px rgb(var(--gold) / 0)", offset: 0.35 },
          { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(var(--gold) / 0)" },
        ],
        { duration: 820, easing: "cubic-bezier(.2,.9,.1,1)" },
      );
    });
  }, [feed, every]);

  return (
    <span aria-hidden="true" className={cx("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span ref={dotRef} className={cx("absolute inset-0 rounded-full", TONE[status])} />
      {status === "live" || status === "fallback" ? <span className="absolute -inset-[3px] rounded-full border border-gold/40" /> : null}
    </span>
  );
}
