import { useEffect, useLayoutEffect, useRef } from "react";

import { subscribeMedia } from "../app/state/media";
import { useUiStore } from "../app/state/uiStore";
import { REDUCED_MOTION_QUERY } from "../motion/preference";
import { prefersReducedMotion, useReducedMotion } from "../motion/useReducedMotion";
import { createTicker, type Ticker, type TickerSubscription } from "./ticker";

let shared: Ticker | null = null;
let observer: IntersectionObserver | null = null;
const watched = new Map<Element, TickerSubscription>();

/** The page's one animation clock (created on first use). */
export function sharedTicker(): Ticker {
  if (shared) return shared;
  const ticker = createTicker({
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    hidden: () => document.visibilityState === "hidden",
    reduced: () => prefersReducedMotion(),
  });
  document.addEventListener("visibilitychange", () => ticker.refresh());
  useUiStore.subscribe(() => ticker.refresh());
  subscribeMedia(REDUCED_MOTION_QUERY, () => ticker.refresh());
  shared = ticker;
  return ticker;
}

function watch(element: Element, subscription: TickerSubscription): () => void {
  if (typeof IntersectionObserver === "undefined") return () => undefined;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) watched.get(entry.target)?.setVisible(entry.isIntersecting);
    },
    { rootMargin: "120px" },
  );
  watched.set(element, subscription);
  observer.observe(element);
  return () => {
    watched.delete(element);
    observer?.unobserve(element);
  };
}

export interface PixelLoopOptions {
  /** Frame cap (default 24 fps: pixel art steps). */
  readonly fps?: number;
  /** The clock value drawn when motion is reduced: the end state. */
  readonly endTime?: number;
  /** Extra gate; false draws the end state. */
  readonly enabled?: boolean;
}

/**
 * Drives `draw(seconds)` from the shared ticker while `element` is on screen,
 * the tab is visible and motion is allowed. Otherwise it draws once at
 * `endTime` (the end state). Returns whether the loop is live.
 */
export function usePixelLoop(element: Element | null, draw: (seconds: number) => void, options: PixelLoopOptions = {}): boolean {
  const { fps = 24, endTime = 0, enabled = true } = options;
  const reduced = useReducedMotion();
  const live = enabled && !reduced;
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    if (!element || !live) return undefined;
    const ticker = sharedTicker();
    drawRef.current(ticker.seconds());
    const subscription = ticker.subscribe((seconds) => drawRef.current(seconds), { fps });
    const unwatch = watch(element, subscription);
    return () => {
      unwatch();
      subscription.remove();
    };
  }, [element, live, fps]);

  // Still: repaint the end state whenever the inputs change.
  useEffect(() => {
    if (element && !live) drawRef.current(endTime);
  });

  return live;
}
