/**
 * HyperCore market data for order building: the market index (perps by
 * name, spot pairs by book coin and `BASE/QUOTE`), mids, and order sizing
 * that follows the tick and lot rules (core wire.ts) and the $10 minimum.
 */
import { compareDecimal, hypercore, type NetworkKey } from "@elyia/core";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { coreTokenInfo, type CoreTokenInfo } from "../assets.js";

const INDEX_TTL_MS = 60_000;
/** HyperCore minimum order value: $10 on perps, 10 quote units on spot. */
export const MIN_ORDER_NOTIONAL = "10";

export interface MarketView extends hypercore.MarketInfo {
  /** Spot pairs: base and quote tokens. */
  readonly base?: CoreTokenInfo;
  readonly quote?: CoreTokenInfo;
}

const indexes = new Map<NetworkKey, { readonly at: number; readonly markets: Map<string, MarketView> }>();

async function marketIndex(deps: EngineDeps, network: NetworkKey): Promise<Map<string, MarketView>> {
  const cached = indexes.get(network);
  if (cached && deps.clock.now() - cached.at < INDEX_TTL_MS) return cached.markets;
  const [meta, spot] = await Promise.all([deps.core.meta(network), deps.core.spotMeta(network)]);
  const base = hypercore.buildMarketIndex(meta.universe, { universe: spot.universe, tokens: spot.tokens });
  const markets = new Map<string, MarketView>();
  for (const [key, info] of base) {
    if (!info.isSpot) {
      markets.set(key, info);
      continue;
    }
    const pair = spot.universe.find((entry) => entry.name === info.coin);
    const baseToken = pair ? coreTokenInfo(spot, (token) => token.index === pair.tokens[0]) : null;
    const quoteToken = pair ? coreTokenInfo(spot, (token) => token.index === pair.tokens[1]) : null;
    markets.set(key, { ...info, ...(baseToken ? { base: baseToken } : {}), ...(quoteToken ? { quote: quoteToken } : {}) });
  }
  indexes.set(network, { at: deps.clock.now(), markets });
  return markets;
}

/**
 * A market by name. `kind: "spot"` with a bare coin ("HYPE") means
 * `HYPE/USDC`; perps are looked up by name only.
 */
export async function marketFor(deps: EngineDeps, network: NetworkKey, name: string, kind?: "perp" | "spot"): Promise<MarketView> {
  const markets = await marketIndex(deps, network);
  const text = name.trim();
  const upper = text.toUpperCase();
  const candidates = kind === "spot"
    ? [text, upper, `${upper}/USDC`]
    : kind === "perp"
      ? [text, upper]
      : [text, upper, `${upper}/USDC`];
  for (const candidate of candidates) {
    const market = markets.get(candidate);
    if (market && (kind === undefined || market.isSpot === (kind === "spot"))) {
      if (market.isDelisted) throw engineError("MARKET_DELISTED", `${market.displayName} is delisted on HyperCore; only closing positions works there.`);
      return market;
    }
  }
  throw engineError("MARKET_UNKNOWN", `HyperCore has no ${kind ?? ""} market ${name}.`.replace("  ", " "), { market: name });
}

/** The current mid of a market's book coin, or a 503 PRICE_UNAVAILABLE (never guessed). */
export async function midOf(deps: EngineDeps, network: NetworkKey, market: MarketView): Promise<string> {
  const mids = await deps.core.allMids(network);
  const mid = mids[market.coin];
  if (mid === undefined || !/^\d+(?:\.\d+)?$/u.test(mid) || compareDecimal(mid, "0") <= 0) {
    throw engineError("PRICE_UNAVAILABLE", `HyperCore has no mid for ${market.displayName} right now.`);
  }
  return mid;
}

/** x * y for decimal strings, exact. */
export function mulDecimal(a: string, b: string): string {
  const scale = (text: string) => (text.includes(".") ? (text.split(".")[1] ?? "").length : 0);
  const units = (text: string) => BigInt(text.replace(".", ""));
  const total = units(a) * units(b);
  const decimals = scale(a) + scale(b);
  if (decimals === 0) return total.toString();
  const digits = total.toString().padStart(decimals + 1, "0");
  const out = `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`.replace(/\.?0+$/u, "");
  return out === "" ? "0" : out;
}

/** a / b for decimal strings, truncated to `decimals` places. */
export function divDecimal(a: string, b: string, decimals: number): string {
  const scale = (text: string) => (text.includes(".") ? (text.split(".")[1] ?? "").length : 0);
  const units = (text: string) => BigInt(text.replace(".", ""));
  const numerator = units(a) * 10n ** BigInt(scale(b) + decimals);
  const denominator = units(b) * 10n ** BigInt(scale(a));
  if (denominator === 0n) throw engineError("PRICE_UNAVAILABLE", "Division by a zero price.");
  const quotient = numerator / denominator;
  if (decimals === 0) return quotient.toString();
  const digits = quotient.toString().padStart(decimals + 1, "0");
  const out = `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`.replace(/\.?0+$/u, "");
  return out === "" ? "0" : out;
}

/** Rounds a size down to the lot; refuses a size that rounds to zero. */
export function lotSize(size: string, market: MarketView): { readonly sz: string; readonly rounded: boolean } {
  const sz = hypercore.roundSize(size, market.szDecimals, "down");
  if (compareDecimal(sz, "0") <= 0) throw engineError("ORDER_SIZE_INVALID", `${size} ${market.displayName} is below the smallest lot (${market.szDecimals} decimals).`);
  return { sz, rounded: compareDecimal(sz, size) !== 0 };
}

/** Refuses an order worth less than the HyperCore minimum (sz x px in quote units). */
export function assertMinNotional(sz: string, px: string, market: MarketView): void {
  const notional = mulDecimal(sz, px);
  if (compareDecimal(notional, MIN_ORDER_NOTIONAL) < 0) {
    throw engineError("ORDER_MIN_NOTIONAL", `This order is worth ${notional} ${market.isSpot ? market.quote?.name ?? "quote units" : "USD"}; HyperCore needs at least ${MIN_ORDER_NOTIONAL}.`, { notional });
  }
}
