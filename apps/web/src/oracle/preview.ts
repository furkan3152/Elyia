/**
 * The Oracle's as-you-type preview (pure). It colours the words of a sentence
 * (verb, amount, asset, leverage, network, trigger) so the user sees what
 * Elyia heard. It is a visual aid only: the plan itself always comes from the
 * intent API's deterministic parser, never from this tokenizer.
 *
 * It also resolves plain navigation commands ("go trade ETH", "open
 * portfolio of 0x…", "track 0x…") to routes, which need no planning.
 */
import { routeHref } from "../app/routes/routeTable";

export type ChipKind = "verb" | "amount" | "asset" | "leverage" | "network" | "trigger" | "schedule" | "connector" | "word";

export interface PreviewToken {
  readonly text: string;
  readonly kind: ChipKind;
}

const VERBS = new Set([
  "swap", "bridge", "move", "send", "stake", "unstake", "lend", "withdraw", "long", "short", "buy", "sell", "close", "reduce", "flatten",
  "limit", "tp", "sl", "twap", "cancel", "alert", "automate", "set", "deposit", "claim",
]);
const NETWORKS = new Set(["elysium", "hyperevm", "hypercore", "core", "perps", "spot", "testnet"]);
const CONNECTORS = new Set(["to", "from", "with", "on", "into", "then", "and", "at", "over", "for", "of", "my", "me"]);
const TRIGGERS = new Set(["stop", "if", "when", "above", "below"]);
const SCHEDULES = new Set(["every", "daily", "weekly", "hourly", "day", "days", "hour", "hours", "week", "weeks", "minute", "minutes"]);
const QUANTITY_WORDS = new Set(["half", "all", "max", "quarter"]);
/** Upper-case tickers ("ETH", "ETH-PERP") or well-known assets typed in lower case. */
const ASSET = /^[A-Z][A-Z0-9]{1,9}(?:-PERP)?$/u;
const KNOWN_ASSETS = new Set(["hype", "khype", "whype", "eth", "btc", "sol", "usdc", "usdh", "usdt", "purr", "tkntq", "fartcoin"]);
const AMOUNT = /^[$]?\d+(?:[.,]\d+)?(?:[kKmM])?%?$/u;
const LEVERAGE = /^\d+(?:\.\d+)?[xX×]$/u;
const PERCENT_MOVE = /^[-+−]\d+(?:\.\d+)?%$/u;

export function previewTokens(sentence: string): PreviewToken[] {
  const words = sentence.split(/(\s+)/u).filter((part) => part.length > 0);
  return words.map((raw): PreviewToken => {
    if (/^\s+$/u.test(raw)) return { text: raw, kind: "word" };
    const word = raw.replace(/[,.;!?]+$/u, "");
    const lower = word.toLowerCase();
    if (VERBS.has(lower)) return { text: raw, kind: "verb" };
    if (LEVERAGE.test(word)) return { text: raw, kind: "leverage" };
    if (PERCENT_MOVE.test(word)) return { text: raw, kind: "trigger" };
    if (AMOUNT.test(word) || QUANTITY_WORDS.has(lower)) return { text: raw, kind: "amount" };
    if (NETWORKS.has(lower)) return { text: raw, kind: "network" };
    if (TRIGGERS.has(lower)) return { text: raw, kind: "trigger" };
    if (SCHEDULES.has(lower)) return { text: raw, kind: "schedule" };
    if (CONNECTORS.has(lower)) return { text: raw, kind: "connector" };
    if (ASSET.test(word) || KNOWN_ASSETS.has(lower)) return { text: raw, kind: "asset" };
    return { text: raw, kind: "word" };
  });
}

/** Only the meaningful tokens, merged for the chip row ("200 USDC" stays two chips; spaces dropped). */
export function previewChips(sentence: string): PreviewToken[] {
  return previewTokens(sentence).filter((token) => token.kind !== "word" && token.kind !== "connector");
}

const PAGES: Readonly<Record<string, string>> = {
  deck: routeHref("deck"),
  home: routeHref("deck"),
  trade: routeHref("trade"),
  terminal: routeHref("trade"),
  swap: routeHref("swap"),
  earn: routeHref("earn"),
  bridge: routeHref("bridge"),
  portfolio: routeHref("portfolio"),
  stars: routeHref("portfolio"),
  track: routeHref("track"),
  tracker: routeHref("track"),
  agent: routeHref("agent"),
  discover: routeHref("discover"),
  ecosystem: routeHref("discover"),
  alerts: routeHref("alerts"),
  settings: routeHref("settings"),
  pulse: routeHref("elysium"),
  elysium: routeHref("elysium"),
  developers: routeHref("developers"),
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/u;
const MARKET = /^[A-Za-z0-9]{2,12}(?:[-/][A-Za-z0-9]{2,8})?$/u;

export interface CommandMatch {
  readonly href: string;
  readonly label: string;
}

/**
 * Navigation commands, resolved without planning:
 *   "go trade", "go trade ETH", "open portfolio", "open portfolio of 0x…",
 *   "portfolio 0x…", "track 0x<tx hash>", "go to alerts".
 * Returns null for anything that is an intent (it goes to the planner).
 */
export function matchCommand(sentence: string): CommandMatch | null {
  const words = sentence.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return null;
  let index = 0;
  const lead = words[0]!.toLowerCase();
  if (lead === "go" || lead === "open" || lead === "show") index = 1;
  if (words[index]?.toLowerCase() === "to") index += 1;
  const page = words[index]?.toLowerCase();
  if (!page) return null;
  const rest = words.slice(index + 1).filter((word) => word.toLowerCase() !== "of" && word.toLowerCase() !== "for");
  if ((page === "trade" || page === "terminal") && rest.length === 1 && MARKET.test(rest[0]!)) {
    const market = rest[0]!.toUpperCase();
    return { href: routeHref("trade", { market }), label: `Open the ${market} terminal` };
  }
  if ((page === "portfolio" || page === "stars") && rest.length === 1 && ADDRESS.test(rest[0]!)) {
    return { href: routeHref("portfolio", { address: rest[0]! }), label: "Open this portfolio" };
  }
  if ((page === "track" || page === "tracker") && rest.length === 1 && TX_HASH.test(rest[0]!)) {
    return { href: routeHref("track", { id: rest[0]! }), label: "Track this transaction" };
  }
  if (rest.length > 0) return null;
  const href = PAGES[page];
  if (!href) return null;
  // A bare verb that is also a page ("swap", "bridge") is ambiguous; only "go swap" navigates.
  if (index === 0 && VERBS.has(page)) return null;
  return { href, label: `Go to ${page}` };
}

/** Where a planned intent goes: the deck receives it as ?intent= (the planner reads it there). */
export function intentHref(sentence: string): string {
  const text = sentence.trim().slice(0, 500);
  return `${routeHref("deck")}?intent=${encodeURIComponent(text)}`;
}

/** Example intents shown in empty states, the landing page and the Oracle. */
export const EXAMPLE_INTENTS: readonly string[] = [
  "long ETH 5x with 200 USDC, stop at -3%",
  "bridge 20 HYPE to Elysium and swap half to USDC",
  "every day buy 10 HYPE",
  "twap buy 40 HYPE over 30 minutes",
  "move all my HyperEVM USDC to perps",
  "alert me if ETH funding goes above 0.05%",
];
