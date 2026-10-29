import { ArrowLeftRight, Bell, Bot, ChartCandlestick, Compass, Map, Mountain, Radio, Route, Settings, Sprout, Waypoints, type LucideIcon } from "lucide-react";

import { routeHref, type RouteId } from "../routes/routeTable";

export interface NavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** One line for tooltips and the "More" menu. */
  readonly hint: string;
  /** Keyboard sequence shown in the shortcuts sheet ("g t"). */
  readonly keys?: string;
  /** In the header and the phone's signpost tabs (DECK · TRADE · PORTFOLIO · GUIDE). */
  readonly primary?: boolean;
  /** "prefix" (default) keeps the item active on sub-paths; the deck root is "exact". */
  readonly match?: "exact" | "prefix";
}

/** The deck's destinations: the four primary ones first, then the rest (the "More" menu). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "deck", label: "Deck", href: routeHref("deck"), icon: Mountain, hint: "Net worth, ropes, routes in progress", keys: "g d", primary: true, match: "exact" },
  { id: "trade", label: "Trade", href: routeHref("trade"), icon: ChartCandlestick, hint: "HyperCore perps and spot terminal", keys: "g t", primary: true },
  { id: "portfolio", label: "Portfolio", href: routeHref("portfolio"), icon: Map, hint: "Your range: the relief of three layers", keys: "g p", primary: true },
  { id: "agent", label: "Guide", href: routeHref("agent"), icon: Bot, hint: "The Guide, its licence and the kill switch", keys: "g a", primary: true },
  { id: "bridge", label: "Bridge", href: routeHref("bridge"), icon: Waypoints, hint: "Ascend and descend: Floor, Ridge, Summit", keys: "g b" },
  { id: "swap", label: "Swap", href: routeHref("swap"), icon: ArrowLeftRight, hint: "Swap on Elysium and HyperEVM", keys: "g s" },
  { id: "earn", label: "Earn", href: routeHref("earn"), icon: Sprout, hint: "Staking, lending, vaults", keys: "g e" },
  { id: "discover", label: "Discover", href: routeHref("discover"), icon: Compass, hint: "First ascents: new pools with route conditions", keys: "g x" },
  { id: "alerts", label: "Alerts", href: routeHref("alerts"), icon: Bell, hint: "Rules and the Telegram radio", keys: "g l" },
  { id: "track", label: "Track", href: routeHref("track"), icon: Route, hint: "Every step of every route, live", keys: "g k" },
];

export const SETTINGS_ITEM: NavItem = { id: "settings", label: "Settings", href: routeHref("settings"), icon: Settings, hint: "Theme, motion, network, Telegram", keys: "g ," };

/** Public pages listed in "More" after the deck destinations. */
export const SITE_ITEMS: readonly NavItem[] = [
  { id: "developers", label: "Developers", href: routeHref("developers"), icon: Compass, hint: "API, MCP and SDK" },
  { id: "elysium", label: "Elysium", href: routeHref("elysium"), icon: Radio, hint: "The barograph: ~114 ms blocks, live" },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary);
export const MORE_NAV: readonly NavItem[] = [...NAV_ITEMS.filter((item) => !item.primary), ...SITE_ITEMS];
