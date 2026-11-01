import { ArrowLeftRight, Bell, Bot, ChartCandlestick, Compass, Map, Mountain, Radio, Route, Settings, ShieldCheck, Sprout, Waypoints, type LucideIcon } from "lucide-react";

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
  /** In the header (ASK ELY · PORTFOLIO · TRADE · DISCOVER · DEVELOPERS); the phone's tabs take the first four (PHONE_NAV). */
  readonly primary?: boolean;
  /** "prefix" (default) keeps the item active on sub-paths; the deck root is "exact". */
  readonly match?: "exact" | "prefix";
}

/** The deck's destinations: the four primary ones first, then the rest (the "More" menu). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "deck", label: "Ask Ely", href: routeHref("deck"), icon: Mountain, hint: "One sentence: Ely drafts the route, you sign", keys: "g d", primary: true, match: "exact" },
  { id: "portfolio", label: "Portfolio", href: routeHref("portfolio"), icon: Map, hint: "Your range × Ely: insights, what-if, automations", keys: "g p", primary: true },
  { id: "trade", label: "Trade", href: routeHref("trade"), icon: ChartCandlestick, hint: "HyperCore perps and spot terminal", keys: "g t", primary: true },
  { id: "discover", label: "Discover", href: routeHref("discover"), icon: Compass, hint: "First ascents: new pools with route conditions", keys: "g x", primary: true },
  { id: "developers", label: "Developers", href: routeHref("developers"), icon: Compass, hint: "Keys, playground, MCP, webhooks, your fee", primary: true },
  { id: "basecamp", label: "Base camp", href: routeHref("basecamp"), icon: Mountain, hint: "Net worth, ropes, routes in progress", keys: "g c" },
  { id: "agent", label: "Guide", href: routeHref("agent"), icon: Bot, hint: "The Guide, its licence and the kill switch", keys: "g a" },
  { id: "bridge", label: "Bridge", href: routeHref("bridge"), icon: Waypoints, hint: "Ascend and descend: Floor, Ridge, Summit", keys: "g b" },
  { id: "swap", label: "Swap", href: routeHref("swap"), icon: ArrowLeftRight, hint: "Swap on Elysium and HyperEVM", keys: "g s" },
  { id: "earn", label: "Earn", href: routeHref("earn"), icon: Sprout, hint: "Staking, lending, vaults", keys: "g e" },
  { id: "alerts", label: "Alerts", href: routeHref("alerts"), icon: Bell, hint: "Rules and the Telegram radio", keys: "g l" },
  { id: "track", label: "Track", href: routeHref("track"), icon: Route, hint: "Every step of every route, live", keys: "g k" },
];

export const SETTINGS_ITEM: NavItem = { id: "settings", label: "Settings", href: routeHref("settings"), icon: Settings, hint: "Theme, motion, network, Telegram", keys: "g ," };

/** Public pages listed in "More" after the deck destinations. */
export const SITE_ITEMS: readonly NavItem[] = [
  { id: "elysium", label: "Elysium", href: routeHref("elysium"), icon: Radio, hint: "The barograph: ~114 ms blocks, live" },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary);
/** The phone's signpost tabs (four plus MORE): the top bar's first four destinations. */
export const PHONE_NAV: readonly NavItem[] = PRIMARY_NAV.slice(0, 4);
export const MORE_NAV: readonly NavItem[] = [...NAV_ITEMS.filter((item) => !item.primary), ...SITE_ITEMS];
/** Phones: everything not in a tab goes behind MORE (Developers included). */
export const PHONE_MORE_NAV: readonly NavItem[] = [...PRIMARY_NAV.slice(4), ...MORE_NAV];

/** The owner console: never in the public nav; pages show it only to admin sessions. */
export const ADMIN_ITEM: NavItem = { id: "admin", label: "Owner console", href: routeHref("admin"), icon: ShieldCheck, hint: "Owner only: contracts, router, flags" };
