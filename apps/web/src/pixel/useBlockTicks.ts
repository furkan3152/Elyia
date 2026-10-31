import { useEffect, useMemo, useState } from "react";

import type { BlockFeed } from "../lib/pulse/pulseHub";
import { TickStore } from "./blockTicks";

/**
 * A tick store fed by the live pulse (when given). `live` flips (rarely) so
 * the label can say LIVE or SAMPLE; drawing reads the store directly.
 */
export function useBlockTicks(feed: BlockFeed | null | undefined, capacity: number, cadenceMs = 114): { readonly store: TickStore; readonly live: boolean; readonly head: number | null } {
  const store = useMemo(() => new TickStore({ capacity, cadenceMs }), [capacity, cadenceMs]);
  const [live, setLive] = useState(false);
  const [head, setHead] = useState<number | null>(null);

  useEffect(() => {
    if (!feed) return undefined;
    let lastHeadPaint = 0;
    const off = feed.subscribe((block) => {
      const now = performance.now();
      store.live(block, now);
      setLive(true);
      // the printed head updates at most twice a second
      if (now - lastHeadPaint > 500) {
        lastHeadPaint = now;
        setHead(block.number);
      }
    });
    const timer = window.setInterval(() => setLive(store.isLive(performance.now())), 1_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [feed, store]);

  return { store, live, head };
}
