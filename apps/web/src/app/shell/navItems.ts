import { ArrowLeftRight, Bell, Bot, ChartCandlestick, Compass, Route, Settings, Sprout, Star, Sun, Waypoints, type LucideIcon } from "lucide-react";

import { routeHref, type RouteId } from "../routes/routeTable";

export interface NavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** One line for tooltips and the "More" sheet. */
  readonly hint: string;
  /** Keyboard sequence shown in the shortcuts sheet ("g t"). */
  readonly keys?: string;
  /** Shown in the phone bottom bar (the rest live under "More"). */
  readonly primaryOnMobile?: boolean;
  /** "prefix" (default) keeps the item active on sub-paths; the deck root is "exact". */
  readonly match?: "exact" | "prefix";
}

/** The deck's navigation, in rail order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "deck", label: "Deck", href: routeHref("deck"), icon: Sun, hint: "Net worth, the Lyre, quick intents", keys: "g d", primaryOnMobile: true, match: "exact" },
  { id: "trade", label: "Trade", href: routeHref("trade"), icon: ChartCandlestick, hint: "HyperCore perps and spot terminal", keys: "g t", primaryOnMobile: true },
  { id: "swap", label: "Swap", href: routeHref("swap"), icon: ArrowLeftRight, hint: "Swap on Elysium and HyperEVM", keys: "g s", primaryOnMobile: true },
  { id: "earn", label: "Earn", href: routeHref("earn"), icon: Sprout, hint: "Staking, lending, vaults", keys: "g e" },
  { id: "bridge", label: "Bridge", href: routeHref("bridge"), icon: Waypoints, hint: "HyperEVM, Elysium and HyperCore", keys: "g b" },
  { id: "portfolio", label: "Portfolio", href: routeHref("portfolio"), icon: Star, hint: "Your own stars across three layers", keys: "g p", primaryOnMobile: true },
  { id: "track", label: "Track", href: routeHref("track"), icon: Route, hint: "Journeys, watchlists, whales", keys: "g k" },
  { id: "agent", label: "Agent", href: routeHref("agent"), icon: Bot, hint: "The Elysium Agent and its guardrails", keys: "g a" },
  { id: "discover", label: "Discover", href: routeHref("discover"), icon: Compass, hint: "Ecosystem, new pools, safety scores", keys: "g x" },
  { id: "alerts", label: "Alerts", href: routeHref("alerts"), icon: Bell, hint: "Rules and Telegram", keys: "g l" },
];

export const SETTINGS_ITEM: NavItem = { id: "settings", label: "Settings", href: routeHref("settings"), icon: Settings, hint: "Theme, motion, network, Telegram", keys: "g ," };
