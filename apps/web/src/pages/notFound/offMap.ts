/**
 * "Off the map" (pure): where a lost path most likely meant to go, and the
 * survey coordinates printed next to the YOU ARE HERE marker. Nothing here
 * touches the DOM, so node:test covers it.
 */

export interface KnownTrail {
  /** Canonical path ("/app/trade"). */
  readonly path: string;
  /** Sign text ("Trade · HyperCore"). */
  readonly name: string;
  /** Extra words that should lead here ("perps", "terminal"). */
  readonly words?: readonly string[];
}

export const KNOWN_TRAILS: readonly KnownTrail[] = [
  { path: "/", name: "The landing", words: ["home", "index", "start"] },
  { path: "/elysium", name: "Elysium weather station", words: ["pulse", "blocks", "chain", "status"] },
  { path: "/developers", name: "Developers", words: ["api", "docs", "mcp", "sdk", "dev", "builders"] },
  { path: "/app", name: "Deck · base camp", words: ["deck", "dashboard", "home", "app"] },
  { path: "/app/trade", name: "Trade · HyperCore", words: ["trade", "terminal", "perps", "perp", "spot", "markets", "market", "order"] },
  { path: "/app/portfolio", name: "Portfolio · your range", words: ["portfolio", "positions", "balances", "range", "pnl"] },
  { path: "/app/swap", name: "Swap", words: ["swap", "exchange", "dex"] },
  { path: "/app/bridge", name: "Bridge", words: ["bridge", "deposit", "withdraw", "ascend", "descend"] },
  { path: "/app/earn", name: "Earn", words: ["earn", "stake", "staking", "khype", "vault", "vaults", "hlp", "yield"] },
  { path: "/app/track", name: "Track", words: ["track", "journey", "journeys", "watch", "tx"] },
  { path: "/app/agent", name: "The Guide", words: ["agent", "guide", "keeper", "automations", "bot"] },
  { path: "/app/discover", name: "Discover", words: ["discover", "ecosystem", "protocols", "shield", "launches", "tokens", "new"] },
  { path: "/app/alerts", name: "Alerts", words: ["alerts", "alert", "notifications", "telegram"] },
  { path: "/app/settings", name: "Settings", words: ["settings", "preferences", "config", "theme"] },
  { path: "/tg", name: "Telegram mini app", words: ["tg", "telegram", "miniapp"] },
];

/** Edit distance with adjacent transpositions (optimal string alignment): "trdae" is one slip from "trade". */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i]);
  for (let j = 1; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

function segments(pathname: string): string[] {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // keep the raw path
  }
  return decoded
    .toLowerCase()
    .split(/[/\-_.\s]+/u)
    .map((part) => part.replace(/[^a-z0-9]/gu, ""))
    .filter((part) => part.length > 0);
}

/** How close one word is to a trail's words: 1 exact, down to 0 (a typo of 1 in 5 letters still scores well). */
function wordScore(word: string, trail: KnownTrail): number {
  const own = [...(trail.words ?? []), ...segments(trail.path)];
  let best = 0;
  for (const candidate of own) {
    if (candidate === word) return 1;
    const distance = editDistance(word, candidate);
    const longest = Math.max(word.length, candidate.length);
    // A typo budget of about one letter in four; anything worse does not count.
    if (distance <= Math.max(1, Math.floor(longest / 4))) best = Math.max(best, 1 - distance / (longest + 1));
    else if (candidate.length >= 4 && word.startsWith(candidate)) best = Math.max(best, 0.6);
  }
  return best;
}

export interface TrailGuess {
  readonly trail: KnownTrail;
  /** 0..1 */
  readonly score: number;
}

/**
 * The known trails a lost path most likely meant, best first, at most `max`.
 * `inDeck` breaks ties toward /app pages (a lost /app/... path meant the deck).
 */
export function nearestTrails(pathname: string, options: { readonly max?: number; readonly inDeck?: boolean } = {}): TrailGuess[] {
  const max = options.max ?? 3;
  const all = segments(pathname);
  // "/app/…" only says "the deck"; the words after it say where in the deck.
  const words = all.length > 1 ? all.filter((word) => word !== "app") : all;
  if (words.length === 0) return [];
  const guesses: TrailGuess[] = [];
  for (const trail of KNOWN_TRAILS) {
    let score = 0;
    for (const word of words) score = Math.max(score, wordScore(word, trail));
    if (score > 0) {
      const deckBias = options.inDeck && trail.path.startsWith("/app") ? 0.01 : 0;
      guesses.push({ trail, score: Math.min(1, score + deckBias) });
    }
  }
  return guesses.sort((a, b) => b.score - a.score || a.trail.path.length - b.trail.path.length).slice(0, max);
}

/** FNV-1a, 32 bit: a stable number per path (same lost path, same coordinates). */
export function pathHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface OffMapReading {
  /** "46°33′N" */
  readonly lat: string;
  /** "8°02′E" */
  readonly lon: string;
  /** Metres, a plausible alpine altitude. */
  readonly elevation: number;
  /** Distance to the edge of the surveyed sheet, kilometres with one decimal. */
  readonly offEdgeKm: string;
  /** 0..1 where the marker sits vertically beside the sheet. */
  readonly y: number;
}

function dms(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = Math.floor((abs - degrees) * 60);
  return `${degrees}°${String(minutes).padStart(2, "0")}′${value >= 0 ? positive : negative}`;
}

/** Survey coordinates for a lost path: stable, Alpine-looking and clearly off the sheet. */
export function offMapReading(pathname: string): OffMapReading {
  const hash = pathHash(pathname);
  const lat = 45.8 + ((hash & 0xffff) / 0xffff) * 1.4;
  const lon = 6.9 + (((hash >>> 16) & 0xffff) / 0xffff) * 3.2;
  const elevation = 2_400 + (hash % 2_200);
  const off = 0.4 + ((hash >>> 8) % 90) / 10;
  return { lat: dms(lat, "N", "S"), lon: dms(lon, "E", "W"), elevation, offEdgeKm: off.toFixed(1), y: 0.25 + ((hash >>> 4) % 50) / 100 };
}
