import { useEffect, useState } from "react";

export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Size of an element that may mount later (a callback ref, so a panel that
 * first renders a placeholder is still measured once its body appears).
 * ResizeObserver reports the first size on its own, after layout.
 */
export function useBoxSize<T extends Element>(): readonly [(node: T | null) => void, BoxSize] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 });
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((previous) => (Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5 ? previous : { width: rect.width, height: rect.height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size];
}
