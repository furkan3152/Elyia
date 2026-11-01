/**
 * The route table. Every page is a lazy chunk; `load` is shared by
 * the router and hover/focus prefetching, so a chunk is never fetched twice.
 *
 * Kinds:
 * - `site`: marketing and public pages in the site layout. They never pull the
 *   wallet stack (wagmi, RainbowKit, viem); keep it that way.
 * - `app`: the deck under /app, rendered inside the app shell, which loads the
 *   wallet providers lazily.
 * - `miniapp`: the Telegram Mini App at /tg, bare (its own compact chrome).
 *
 * This file imports nothing at run time, so node tests load it directly; its
 * page imports are lazy and never run there.
 */
import type { ComponentType } from "react";

import { buildPath, compilePattern, matchPattern, normalizePathname, type CompiledPattern, type RouteParams } from "./matchPath";

export type RouteId =
  | "landing"
  | "elysium"
  | "developers"
  | "admin"
  | "system"
  | "kit"
  | "deck"
  | "basecamp"
  | "trade"
  | "swap"
  | "earn"
  | "bridge"
  | "portfolio"
  | "track"
  | "agent"
  | "discover"
  | "alerts"
  | "settings"
  | "miniapp"
  | "appNotFound"
  | "notFound";

export type RouteKind = "site" | "app" | "miniapp";

type PageModule = { default: ComponentType };

export interface RouteDefinition {
  readonly id: RouteId;
  /** Pattern (see matchPath.ts); also the canonical path for routes without parameters. */
  readonly pattern: string;
  readonly kind: RouteKind;
  /** Page title without the brand suffix. */
  readonly title: string;
  readonly description: string;
  readonly robots?: string;
  /** Only served by the dev server (the kit reference page). */
  readonly devOnly?: boolean;
  readonly load: () => Promise<PageModule>;
}

const BRAND_TITLE = "Elyia — your money, surveyed like a mountain";
const BRAND_DESCRIPTION =
  "Elyia is the command deck for Elysium: say what you want in one sentence, trade HyperCore perps, swap, earn and bridge across Elysium and HyperEVM, and see one portfolio across all three layers. Non-custodial, testnet first.";
const PRIVATE_ROBOTS = "noindex,nofollow";

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = Object.freeze({
  landing: {
    id: "landing",
    pattern: "/",
    kind: "site",
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    load: () => import("../../pages/landing/LandingPage"),
  },
  elysium: {
    id: "elysium",
    pattern: "/elysium",
    kind: "site",
    title: "Elysium Pulse",
    description: "Elysium's ~115 ms blocks, live: head, measured block time, gas, transactions per second, the chain facts and the canonical bridge contracts.",
    load: () => import("../../pages/elysium/ElysiumPage"),
  },
  developers: {
    id: "developers",
    pattern: "/developers",
    kind: "site",
    title: "Developers",
    description: "The Elyia developer portal: API keys, usage, a live playground, MCP, webhooks, the widget and your integrator fee.",
    load: () => import("../../pages/developers/DevelopersPage"),
  },
  admin: {
    id: "admin",
    pattern: "/admin",
    kind: "app",
    title: "Owner console",
    description: "Owner only: deploy and configure Elyia's contracts from your own wallet; flags, health and usage.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/admin/AdminPage"),
  },
  system: {
    id: "system",
    pattern: "/system",
    kind: "site",
    title: "Map key",
    description: "The Elyia map key: the Survey system's tokens, primitives and every drawn artifact in its states, with sample data.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/kit/SystemPage"),
  },
  kit: {
    id: "kit",
    pattern: "/kit",
    kind: "site",
    title: "Kit",
    description: "The Elyia interface kit (dev alias of /system).",
    robots: PRIVATE_ROBOTS,
    devOnly: true,
    load: () => import("../../pages/kit/SystemPage"),
  },
  deck: {
    id: "deck",
    pattern: "/app",
    kind: "app",
    title: "Ask Ely",
    description: "Ask Ely in one sentence: it surveys HyperCore, HyperEVM and Elysium, drafts the route card, and your wallet signs every step.",
    load: () => import("../../pages/ask/AskPage"),
  },
  basecamp: {
    id: "basecamp",
    pattern: "/app/deck",
    kind: "app",
    title: "Base camp",
    description: "Your Elyia base camp: net worth across HyperCore, HyperEVM and Elysium, your ropes, recent routes and the agent feed.",
    load: () => import("../../pages/deck/DeckPage"),
  },
  trade: {
    id: "trade",
    pattern: "/app/trade/:market?",
    kind: "app",
    title: "Trade",
    description: "A keyboard-first HyperCore terminal: chart, book, trades, TP/SL, TWAP, scale orders and liquidation distance.",
    load: () => import("../../pages/trade/TradePage"),
  },
  swap: {
    id: "swap",
    pattern: "/app/swap",
    kind: "app",
    title: "Swap",
    description: "Swap tokens on Elysium and HyperEVM at the best quoted route.",
    load: () => import("../../pages/swap/SwapPage"),
  },
  earn: {
    id: "earn",
    pattern: "/app/earn",
    kind: "app",
    title: "Earn",
    description: "kHYPE and HyperCore staking, lending and vaults including HLP, ranked by yield.",
    load: () => import("../../pages/earn/EarnPage"),
  },
  bridge: {
    id: "bridge",
    pattern: "/app/bridge",
    kind: "app",
    title: "Bridge",
    description: "Move value between HyperEVM, Elysium and HyperCore: canonical and mirror bridges, spot and perp transfers.",
    load: () => import("../../pages/bridge/BridgePage"),
  },
  portfolio: {
    id: "portfolio",
    pattern: "/app/portfolio/:address?",
    kind: "app",
    title: "Portfolio",
    description: "Your own stars: one portfolio across HyperCore, HyperEVM and Elysium.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/portfolio/PortfolioPage"),
  },
  track: {
    id: "track",
    pattern: "/app/track/:id?",
    kind: "app",
    title: "Track",
    description: "Every step of every move, live: journeys, watchlists and whale tracking.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/track/TrackPage"),
  },
  agent: {
    id: "agent",
    pattern: "/app/agent",
    kind: "app",
    title: "Agent",
    description: "The Elysium Agent: chat, automations, guardrails, feed and the kill switch.",
    load: () => import("../../pages/agent/AgentPage"),
  },
  discover: {
    id: "discover",
    pattern: "/app/discover",
    kind: "app",
    title: "Discover",
    description: "The Elysium ecosystem directory, new pools and tokens with safety scores.",
    load: () => import("../../pages/discover/DiscoverPage"),
  },
  alerts: {
    id: "alerts",
    pattern: "/app/alerts",
    kind: "app",
    title: "Alerts",
    description: "Price, funding, liquidation distance, fills, whales and bridge settlement, on the web and in Telegram.",
    load: () => import("../../pages/alerts/AlertsPage"),
  },
  settings: {
    id: "settings",
    pattern: "/app/settings",
    kind: "app",
    title: "Settings",
    description: "Theme, motion, network mode, Telegram link and trading key.",
    load: () => import("../../pages/settings/SettingsPage"),
  },
  miniapp: {
    id: "miniapp",
    pattern: "/tg/*",
    kind: "miniapp",
    title: "Elyia for Telegram",
    description: "The compact Elyia deck inside Telegram.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/tg/MiniAppPage"),
  },
  appNotFound: {
    id: "appNotFound",
    pattern: "/app/*",
    kind: "app",
    title: "Page not found",
    description: BRAND_DESCRIPTION,
    robots: "noindex,follow",
    load: () => import("../../pages/notFound/NotFoundPage"),
  },
  notFound: {
    id: "notFound",
    pattern: "/*",
    kind: "site",
    title: "Page not found",
    description: BRAND_DESCRIPTION,
    robots: "noindex,follow",
    load: () => import("../../pages/notFound/NotFoundPage"),
  },
});

/** Matching order: specific routes first, the two catch-alls last. */
const ORDER: readonly RouteId[] = [
  "landing",
  "elysium",
  "developers",
  "admin",
  "system",
  "kit",
  "deck",
  "basecamp",
  "trade",
  "swap",
  "earn",
  "bridge",
  "portfolio",
  "track",
  "agent",
  "discover",
  "alerts",
  "settings",
  "miniapp",
  "appNotFound",
  "notFound",
];

let compiled: ReadonlyArray<readonly [RouteDefinition, CompiledPattern]> | null = null;

function table() {
  compiled ??= ORDER.map((id) => [ROUTES[id], compilePattern(ROUTES[id].pattern)] as const);
  return compiled;
}

export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: RouteParams;
}

export interface MatchOptions {
  /** Serve dev-only routes (the router passes import.meta.env.DEV). */
  readonly dev?: boolean;
}

export function matchRoute(pathname: string, options: MatchOptions = {}): RouteMatch {
  const path = normalizePathname(pathname);
  for (const [route, pattern] of table()) {
    if (route.devOnly && !options.dev) continue;
    const params = matchPattern(pattern, path);
    if (params) return { route, params };
  }
  return { route: ROUTES.notFound, params: {} };
}

/** Typed link builder: `routeHref("trade", { market: "ETH" })` -> "/app/trade/ETH". */
export function routeHref(id: RouteId, params: Readonly<Record<string, string | number | undefined>> = {}): string {
  return buildPath(ROUTES[id].pattern, params);
}

/** "Trade · Elyia"; the landing keeps the full brand title. */
export function documentTitle(route: RouteDefinition): string {
  return route.id === "landing" ? route.title : `${route.title} · Elyia`;
}

export function robotsFor(route: RouteDefinition): string {
  return route.robots ?? "index,follow";
}
