/**
 * Assets and markets a sentence can name: registry tokens of the running
 * environment (core assets.ts), HyperCore markets (live from the facts, or a
 * static list of well-known main-dex perps for reading only), a few
 * Elysium ecosystem tickers that are not in the verified registry yet
 * (read, never routed without a warning), and look-alike names that must
 * never be read as the canonical asset.
 */
import { FLAGGED_TOKENS, NETWORKS, TOKENS, foldTokenName, layersFor, type NetworkEnvironment, type NetworkKey, type TokenDescriptor } from "@elyia/core";

export interface MarketFact {
  /** Base name as HyperCore lists it ("BTC", "TSLA", "HYPE"). */
  readonly coin: string;
  readonly kind: "perp" | "spot";
  /** HIP-3 dex name; absent for the first dex and spot. */
  readonly dex?: string;
  readonly maxLeverage?: number;
  readonly onlyIsolated?: boolean;
  /** Reference (mainnet) mid price in USD, when known. */
  readonly px?: string;
}

/** Well-known first-dex perps, for reading without live facts (no leverage caps, no prices). */
export const STATIC_PERPS: readonly string[] = Object.freeze([
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB", "ARB", "OP", "LTC", "ADA", "DOT", "NEAR", "APT", "TIA", "SEI", "INJ",
  "WIF", "kPEPE", "kBONK", "TRUMP", "FARTCOIN", "ENA", "AAVE", "PENDLE", "ONDO", "JUP", "TAO", "WLD", "PUMP", "ZEC", "BERA", "PURR", "TON", "TRX",
]);
/** HyperCore spot bases Elyia reads without live facts. */
export const STATIC_SPOT: readonly string[] = Object.freeze(["HYPE", "PURR", "UBTC", "UETH", "USDH", "KNTQ"]);

export function staticMarkets(): MarketFact[] {
  return [...STATIC_PERPS.map((coin) => ({ coin, kind: "perp" as const })), ...STATIC_SPOT.map((coin) => ({ coin, kind: "spot" as const }))];
}

/** Ecosystem tickers people trade on Elysium venues that are not verified registry tokens (no address is assumed). */
export const ECOSYSTEM_SYMBOLS: readonly string[] = Object.freeze(["KALOS", "stKALOS", "PERPME"]);

export interface AssetWord {
  readonly symbol: string;
  /** In the verified registry of the environment. */
  readonly listed: boolean;
  /** Canonical symbol this word imitates (a test or mock token); never read as that asset. */
  readonly lookalike?: string;
}

/** Look-alike names (research/elysium-protocols.md, suspicious list): read as themselves, flagged. */
const LOOKALIKE_WORDS: Readonly<Record<string, AssetWord>> = Object.freeze({
  "mock usdc": { symbol: "mock USDC", listed: false, lookalike: "USDC" },
  "test usdc": { symbol: "test USDC", listed: false, lookalike: "USDC" },
  musdc: { symbol: "mUSDC", listed: false, lookalike: "USDC" },
  "usdc.e": { symbol: "USDC.e", listed: false, lookalike: "USDC" },
  "mock usdt": { symbol: "mock USDT", listed: false, lookalike: "USDT0" },
  "wrapped ether": { symbol: "Wrapped Ether", listed: false, lookalike: "WHYPE" },
  weth: { symbol: "WETH", listed: false, lookalike: "WHYPE" },
  "elara khype": { symbol: "Elara kHYPE", listed: false, lookalike: "kHYPE" },
  elys: { symbol: "ELYS", listed: false, lookalike: "HYPE" },
});

export const STABLE_CLASS_WORDS: readonly string[] = Object.freeze(["stables", "stablecoins", "stablecoin", "my stables", "stable", "stabil", "stabil coin", "stabil coinler", "stabil coinlerimi", "stabillerimi", "stabiller"]);

/** Folded word -> asset, for one environment. */
export function assetVocabulary(environment: NetworkEnvironment): ReadonlyMap<string, AssetWord> {
  const map = new Map<string, AssetWord>();
  const networks = new Set(Object.values(layersFor(environment)).map((network) => network.key));
  const tokens = TOKENS.filter((token) => networks.has(token.network));
  for (const token of tokens) {
    const nonCanonical = token.tags.includes("non-canonical");
    const word: AssetWord = nonCanonical ? { symbol: token.symbol, listed: true, lookalike: canonicalOf(token) } : { symbol: token.symbol, listed: true };
    for (const name of [token.symbol, ...(token.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, word);
    }
  }
  for (const symbol of ECOSYSTEM_SYMBOLS) if (!map.has(symbol.toLowerCase())) map.set(symbol.toLowerCase(), { symbol, listed: false });
  // Registry-flagged look-alikes (core FLAGGED_TOKENS): their symbols and names read as themselves, never as what they imitate.
  for (const row of FLAGGED_TOKENS) {
    if (!networks.has(row.network) || row.standard !== "erc20") continue;
    const imitates = row.imitatesSymbol ?? row.imitates;
    for (const name of [row.symbol, row.name]) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (key.split(/\s+/u).length > 5 || map.has(key)) continue;
      map.set(key, { symbol: name, listed: false, lookalike: imitates });
    }
  }
  for (const [phrase, word] of Object.entries(LOOKALIKE_WORDS)) map.set(phrase, word);
  return map;
}

function canonicalOf(token: TokenDescriptor): string {
  const folded = foldTokenName(token.symbol);
  if (folded.includes("USDC") || folded.includes("USD")) return "USDC";
  return token.symbol;
}

/** The registry token of a symbol on one network (case-insensitive, aliases included). */
export function tokenOn(network: NetworkKey, symbol: string): TokenDescriptor | null {
  const upper = symbol.toUpperCase();
  const candidates = TOKENS.filter((token) => token.network === network);
  return candidates.find((token) => token.symbol.toUpperCase() === upper) ?? candidates.find((token) => (token.aliases ?? []).some((alias) => alias.toUpperCase() === upper)) ?? null;
}

/** Networks of the environment where the symbol is a registry token. */
export function networksOf(environment: NetworkEnvironment, symbol: string): NetworkKey[] {
  return Object.values(layersFor(environment))
    .map((network) => network.key)
    .filter((key) => NETWORKS[key].vm === "evm" && tokenOn(key, symbol) !== null);
}

/** Markets matching a base name (case-insensitive), first dex first. */
export function marketsFor(markets: readonly MarketFact[], coin: string, kind?: "perp" | "spot"): MarketFact[] {
  const upper = coin.toUpperCase();
  return markets.filter((market) => market.coin.toUpperCase() === upper && (kind === undefined || market.kind === kind)).sort((a, b) => (a.dex ? 1 : 0) - (b.dex ? 1 : 0));
}
