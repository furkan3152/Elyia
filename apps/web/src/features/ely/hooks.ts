import { useEffect, useState, useSyncExternalStore } from "react";

import { mediaMatches, subscribeMedia } from "../../app/state/media";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { sharedTicker } from "../../pixel/useTicker";

/**
 * The clock a turn's pacing reads: Date.now() on the shared ticker (20 fps)
 * until `endAt` has passed (null: still streaming), then it stops. Reduced
 * motion returns Infinity: the end state at once.
 */
export function useTurnClock(endAt: number | null): number {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const active = !reduced && (endAt === null || now <= endAt);
  useEffect(() => {
    if (!active) return undefined;
    const subscription = sharedTicker().subscribe(() => setNow(Date.now()), { fps: 20 });
    // The ticker stops in hidden tabs; a slow interval keeps the pacing honest when it comes back.
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => {
      subscription.remove();
      window.clearInterval(timer);
    };
  }, [active]);
  return reduced ? Number.POSITIVE_INFINITY : now;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(query, onChange),
    () => mediaMatches(query) ?? fallback,
    () => fallback,
  );
}
