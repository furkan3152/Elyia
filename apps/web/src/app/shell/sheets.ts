import type { RouteId } from "../routes/routeTable";

/**
 * Every page is a map sheet: number and name per route, printed in the
 * header strip ("SHEET 02 · TRADE") and the footer title block.
 */
export interface SheetInfo {
  readonly number: string;
  readonly name: string;
}

const SHEETS: Partial<Record<RouteId, SheetInfo>> = {
  landing: { number: "01", name: "The range" },
  deck: { number: "01", name: "Deck" },
  trade: { number: "02", name: "Trade" },
  portfolio: { number: "03", name: "Your range" },
  bridge: { number: "04", name: "Ascent and descent" },
  swap: { number: "04", name: "Swap" },
  track: { number: "04", name: "Route card" },
  agent: { number: "05", name: "The Guide" },
  earn: { number: "06", name: "Earn" },
  discover: { number: "07", name: "First ascents" },
  alerts: { number: "08", name: "Radio" },
  settings: { number: "09", name: "Settings" },
  elysium: { number: "10", name: "Barograph" },
  developers: { number: "11", name: "Developers" },
  system: { number: "K", name: "Map key" },
  kit: { number: "K", name: "Map key" },
};

export function sheetFor(id: RouteId): SheetInfo {
  return SHEETS[id] ?? { number: "00", name: "Off the map" };
}

/** "SHEET 02 · TRADE" */
export function sheetLabel(id: RouteId): string {
  const sheet = sheetFor(id);
  return `Sheet ${sheet.number} · ${sheet.name}`.toUpperCase();
}
