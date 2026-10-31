import { useEffect, useState } from "react";

import { useResolvedTheme } from "../../../app/state/useTheme";

/** The sheet's tokens as hex, for canvases (they cannot read CSS variables). */
export interface SheetColors {
  readonly night: boolean;
  readonly paper: string;
  readonly paper2: string;
  readonly card: string;
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly up: string;
  readonly down: string;
  readonly accent: string;
  readonly signal: string;
  readonly floor: string;
  readonly ridge: string;
  readonly summit: string;
}

/** The DAY sheet (paper, ink, glacier): the certificate always prints on it, like a card from the hut. */
export const DAY_SHEET: SheetColors = {
  night: false,
  paper: "#F2ECDD",
  paper2: "#E9E1CD",
  card: "#FFF9EC",
  ink: "#16201B",
  ink2: "#4A554F",
  ink3: "#5C6760",
  up: "#1F7A4C",
  down: "#C62D1F",
  accent: "#17788C",
  signal: "#F2C200",
  floor: "#1E6B7D",
  ridge: "#8A5A2B",
  summit: "#17788C",
};

function hex(triplet: string, fallback: string): string {
  const parts = triplet.trim().split(/[\s,]+/u).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

/** Reads the painted sheet's colours (DAY values outside a browser). */
export function readSheetColors(night: boolean): SheetColors {
  if (typeof document === "undefined") return { ...DAY_SHEET, night };
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => hex(style.getPropertyValue(`--${name}`), fallback);
  return {
    night,
    paper: get("paper", DAY_SHEET.paper),
    paper2: get("paper-2", DAY_SHEET.paper2),
    card: get("card", DAY_SHEET.card),
    ink: get("ink", DAY_SHEET.ink),
    ink2: get("ink-2", DAY_SHEET.ink2),
    ink3: get("ink-3", DAY_SHEET.ink3),
    up: get("up", DAY_SHEET.up),
    down: get("down", DAY_SHEET.down),
    accent: get("accent", DAY_SHEET.accent),
    signal: get("signal", DAY_SHEET.signal),
    floor: get("floor", DAY_SHEET.floor),
    ridge: get("ridge", DAY_SHEET.ridge),
    summit: get("summit", DAY_SHEET.summit),
  };
}

/** The sheet's colours, re-read when DAY / NIGHT flips. */
export function useSheetColors(): SheetColors {
  const theme = useResolvedTheme();
  const [colors, setColors] = useState<SheetColors>(() => readSheetColors(theme === "dark"));
  // The toggle paints <html> right after the store commits: read the tokens once the new sheet is on.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setColors(readSheetColors(theme === "dark")));
    return () => window.cancelAnimationFrame(frame);
  }, [theme]);
  return colors;
}
