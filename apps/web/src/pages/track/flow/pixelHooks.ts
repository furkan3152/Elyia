import { useSyncExternalStore } from "react";

import { mediaMatches, subscribeMedia } from "../../../app/state/media";
import { useResolvedTheme } from "../../../app/state/useTheme";

/* Shared hooks and helpers of the five flow pages. */

const PHONE = "(max-width: 639px)";

/** True on phones (under 640 px): canvases draw fewer, larger pixels and skip overlays. */
export function useCompact(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(PHONE, onChange),
    () => mediaMatches(PHONE) ?? false,
    () => false,
  );
}

/** True on the NIGHT sheet (canvases swap palettes). */
export function useNight(): boolean {
  return useResolvedTheme() === "dark";
}

/** The sheet tag for a flow page: "Sheet 04 · Ascent and descent · practice wall". */
export function sheetTag(sheet: string, title: string, mode: "testnet" | "mainnet"): string {
  return `Sheet ${sheet} · ${title} · ${mode === "testnet" ? "practice wall" : "mainnet"}`;
}
