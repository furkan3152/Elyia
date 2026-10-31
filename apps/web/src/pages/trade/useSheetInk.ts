import { useEffect, useState } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";

function readInk(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const channels = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  return channels ? `rgb(${channels.split(/\s+/u).join(", ")})` : undefined;
}

/**
 * The sheet's ink as a canvas colour ("rgb(238, 231, 216)" on NIGHT):
 * canvases cannot read CSS variables, so pixel ropes get it resolved per
 * theme. Read a frame after the theme flips, once <html> carries the new sheet.
 */
export function useSheetInk(): string | undefined {
  const theme = useResolvedTheme();
  const [ink, setInk] = useState<string | undefined>(readInk);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInk(readInk()));
    return () => window.cancelAnimationFrame(frame);
  }, [theme]);
  return ink;
}
