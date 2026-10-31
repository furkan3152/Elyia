/**
 * Reference USD prices for policy, fees and display. Testnet pool prices are
 * fake (Kalos prices HYPE at about 20,850 test-USDC), so USD values always
 * come from HyperCore MAINNET mids (`allMids`, one request prices every
 * coin), labelled "reference". Stablecoins of a USD group are floored at $1.
 * Anything else is unpriced (null), never zero: the Rule Book then fails
 * closed instead of guessing.
 */
import { getToken, parseAssetId, toBaseUnitsBig, type NetworkKey } from "@elyia/core";
import type { Clock } from "../clock.js";
import type { HyperCorePort } from "./ports/hypercore.js";

export const PRICE_SOURCE = "reference:hypercore-mainnet-mids" as const;
export const REFERENCE_NETWORK: NetworkKey = "hypercore-mainnet";
const PRICE_TTL_MS = 15_000;
const USD_MICROS = 1_000_000n;

export interface PriceSnapshot {
  readonly mids: Readonly<Record<string, string>>;
  readonly at: number;
}

/** Coins whose mainnet mid prices a token group or HyperCore token name. */
const COIN_FOR: Readonly<Record<string, string>> = Object.freeze({
  HYPE: "HYPE",
  WHYPE: "HYPE",
  KHYPE: "HYPE",
  KMHYPE: "HYPE",
  BTC: "BTC",
  UBTC: "BTC",
  ETH: "ETH",
  UETH: "ETH",
  PURR: "PURR",
});

const STABLE_SYMBOLS: ReadonlySet<string> = new Set(["USDC", "USDT", "USDT0", "USDH"]);

function midMicros(mid: string | undefined): bigint | null {
  if (mid === undefined || !/^\d+(?:\.\d+)?$/u.test(mid)) return null;
  try {
    const value = toBaseUnitsBig(mid.length > 24 ? mid.slice(0, 24) : mid.replace(/(\.\d{6})\d+$/u, "$1"), 6);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export class ReferencePrices {
  private cached: PriceSnapshot | null = null;
  private inflight: Promise<PriceSnapshot | null> | null = null;

  constructor(
    private readonly core: HyperCorePort,
    private readonly clock: Clock,
  ) {}

  /** The current mainnet mids, or null when Hyperliquid cannot be read (everything is then unpriced). */
  async snapshot(): Promise<PriceSnapshot | null> {
    const now = this.clock.now();
    if (this.cached && now - this.cached.at < PRICE_TTL_MS) return this.cached;
    this.inflight ??= this.core
      .allMids(REFERENCE_NETWORK)
      .then((mids) => {
        this.cached = { mids, at: this.clock.now() };
        return this.cached;
      })
      .catch(() => (this.cached && this.clock.now() - this.cached.at < 4 * PRICE_TTL_MS ? this.cached : null))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Micro-USD per whole unit of a symbol (token name or group), null when unpriced. */
  static symbolMicros(snapshot: PriceSnapshot | null, symbol: string): bigint | null {
    const upper = symbol.toUpperCase();
    if (STABLE_SYMBOLS.has(upper)) return USD_MICROS;
    if (!snapshot) return null;
    const coin = COIN_FOR[upper];
    return coin ? midMicros(snapshot.mids[coin]) : null;
  }

  /** Micro-USD per whole unit of a CAIP-19 asset (registry tokens by group, HyperCore spot by name). */
  static assetMicros(snapshot: PriceSnapshot | null, asset: string, symbol?: string): bigint | null {
    const parsed = parseAssetId(asset);
    if (!parsed) return null;
    if (parsed.namespace === "margin") return USD_MICROS;
    if (parsed.network.vm === "hypercore") return symbol ? ReferencePrices.symbolMicros(snapshot, symbol) : null;
    const token = getToken(asset);
    if (!token) return null;
    // App-specific test stables call themselves USDC but are not; they are never priced as USD.
    if ((token.tags as readonly string[]).includes("non-canonical")) return null;
    if (token.group === "USDC" || token.group === "USDT" || token.group === "USDH") return USD_MICROS;
    const key = token.group ?? token.symbol;
    return ReferencePrices.symbolMicros(snapshot, key);
  }

  /** USD (2 decimals) of `units` base units at `micros` per whole unit; null when unpriced. */
  static usdText(units: bigint, decimals: number, micros: bigint | null): string | null {
    if (micros === null) return null;
    const value = (units * micros + 10n ** BigInt(decimals) - 1n) / 10n ** BigInt(decimals);
    const cents = (value + 9_999n) / 10_000n;
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  }
}
