import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

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

/** Top of the viewport below the sticky app header (and the phone tab bar), so the conversation fills the screen. */
export function useShellHeight(phone: boolean): string {
  const [top, setTop] = useState(112);
  useLayoutEffect(() => {
    const header = document.querySelector("header");
    if (!header) return undefined;
    const measure = () => setTop(Math.round(header.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return `calc(100dvh - ${top + (phone ? 64 : 0)}px)`;
}

/**
 * A conversation scroller that sticks to the bottom while new content
 * arrives (unless the reader scrolled up), and jumps to the bottom when a
 * new turn is added (`count`). Ask Ely's thread and Portfolio's Ely panel.
 */
export function useStickToBottom(count: number, { topWhenEmpty = false }: { readonly topWhenEmpty?: boolean } = {}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // An empty conversation (topWhenEmpty) reads from the top: what sits above the first turn comes first.
  const stick = useRef(!(topWhenEmpty && count === 0));
  useLayoutEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!box || !inner) return undefined;
    const onScroll = () => {
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 96;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    if (stick.current) box.scrollTop = box.scrollHeight;
    if (typeof ResizeObserver === "undefined") return () => box.removeEventListener("scroll", onScroll);
    const observer = new ResizeObserver(() => {
      if (stick.current) box.scrollTop = box.scrollHeight;
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", onScroll);
    };
  }, []);
  useEffect(() => {
    if (topWhenEmpty && count === 0) return;
    stick.current = true;
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count, topWhenEmpty]);
  return { scroller, content };
}
