/**
 * Reference USD prices: HyperCore **mainnet** mids, whatever mode Elyia runs
 * in. Testnet assets have no market price of their own (testnet pools price
 * HYPE at ~20,850 test USDC), so every USD figure in the ledger comes from
 * here and is labelled "reference" on testnet.
 *
 * Resolution of a symbol, in order:
 *   USDC                      -> 1 (HyperCore's quote currency)
 *   kHYPE                     -> Kinetiq StakingAccountant rate x HYPE
 *   a mainnet spot token      -> mid of its USDC pair (canonical pair preferred)
 *   a mainnet perp coin       -> perp mid (UBTC/UETH/USOL fall back to BTC/ETH/SOL)
 *   anything else             -> unknown (never zero)
 */
import { deploymentOn, getProtocol } from "@elyia/core";
import type { PriceBasis, ReferencePrice } from "@elyia/core/api/markets";
import type { AllMids, SpotMeta } from "@elyia/core/hypercore/info";
import { parseAbi, type Address } from "viem";
import type { EvmChains } from "../../chains/evm.js";
import type { Clock } from "../../clock.js";
import type { HyperliquidInfoClient } from "../../hyperliquid/info.js";
import type { Logger } from "../../log.js";
import { RefreshingCache, type CachedValue } from "./cache.js";
import { round, toNumber } from "./num.js";

export const REFERENCE_SOURCE = "hypercore-mainnet-reference" as const;
export const REFERENCE_TTL_MS = 5_000;
export const KHYPE_RATE_TTL_MS = 10 * 60_000;
const USDC_INDEX = 0;

/** Spellings that name the same mainnet asset. */
const SYMBOL_ALIASES: Readonly<Record<string, string>> = Object.freeze({ WHYPE: "HYPE", "USD₮0": "USDT0", USDT: "USDT0" });
/** Wrapped spot tokens whose perp is the same underlying. */
const PERP_FALLBACK: Readonly<Record<string, string>> = Object.freeze({ UBTC: "BTC", UETH: "ETH", USOL: "SOL", HYPE: "HYPE" });
/** Economic underlying of a token for exposure (stablecoins are cash). */
const UNDERLYING: Readonly<Record<string, string>> = Object.freeze({
  HYPE: "HYPE",
  WHYPE: "HYPE",
  KHYPE: "HYPE",
  UBTC: "BTC",
  UETH: "ETH",
  USOL: "SOL",
  USDC: "USD",
  USDT0: "USD",
  USDT: "USD",
  "USD₮0": "USD",
  USDH: "USD",
  USDE: "USD",
});

export interface ReferenceTable {
  /** When the mids were read (ms). */
  readonly time: number;
  readonly mids: AllMids;
  /** Upper-case mainnet spot token name -> token index. */
  readonly tokenByName: ReadonlyMap<string, number>;
  readonly tokenName: ReadonlyMap<number, string>;
  /** Token index -> book coin of its USDC pair (canonical first). */
  readonly usdcPair: ReadonlyMap<number, string>;
  /** HYPE per kHYPE, or null when the StakingAccountant could not be read. */
  readonly khypeToHype: number | null;
}

export function buildReferenceTable(input: { readonly mids: AllMids; readonly spotMeta: SpotMeta; readonly khypeToHype: number | null; readonly time: number }): ReferenceTable {
  const tokenByName = new Map<string, number>();
  const tokenName = new Map<number, string>();
  for (const token of input.spotMeta.tokens) {
    tokenName.set(token.index, token.name);
    const upper = token.name.toUpperCase();
    // Canonical tokens win name clashes.
    if (!tokenByName.has(upper) || token.isCanonical) tokenByName.set(upper, token.index);
  }
  const usdcPair = new Map<number, string>();
  const pairs = [...input.spotMeta.universe].sort((a, b) => Number(b.isCanonical) - Number(a.isCanonical));
  for (const pair of pairs) {
    const [base, quote] = pair.tokens;
    if (quote !== USDC_INDEX || usdcPair.has(base)) continue;
    usdcPair.set(base, pair.name);
  }
  return { time: input.time, mids: input.mids, tokenByName, tokenName, usdcPair, khypeToHype: input.khypeToHype };
}

function normalize(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  return SYMBOL_ALIASES[upper] ?? upper;
}

function positiveMid(table: ReferenceTable, coin: string): number | null {
  const mid = toNumber(table.mids[coin]);
  return mid !== null && mid > 0 ? mid : null;
}

function quote(symbol: string, usd: number, basis: PriceBasis, coin: string | null, detail: string | null = null): ReferencePrice {
  return { symbol, usd: round(usd, 10), basis, coin, detail };
}

function spotPairPrice(table: ReferenceTable, symbol: string, index: number): ReferencePrice | null {
  const coin = table.usdcPair.get(index);
  if (!coin) return null;
  const mid = positiveMid(table, coin);
  return mid === null ? null : quote(symbol, mid, "spot-pair", coin);
}

function perpPrice(table: ReferenceTable, symbol: string, coin: string): ReferencePrice | null {
  const mid = positiveMid(table, coin);
  return mid === null ? null : quote(symbol, mid, "perp-mid", coin);
}

function khypePrice(table: ReferenceTable, symbol: string): ReferencePrice | null {
  if (table.khypeToHype === null) return null;
  const hype = priceSymbol(table, "HYPE");
  if (!hype) return null;
  return quote(symbol, hype.usd * table.khypeToHype, "lst-rate", hype.coin, `1 kHYPE = ${round(table.khypeToHype, 6)} HYPE (Kinetiq StakingAccountant)`);
}

/** Reference price of a symbol (token or perp coin), or null when HyperCore mainnet has none. */
export function priceSymbol(table: ReferenceTable, symbol: string): ReferencePrice | null {
  const asked = symbol.trim();
  const upper = normalize(asked);
  if (upper === "USDC") return quote(asked, 1, "unit", null);
  if (upper === "KHYPE") {
    const lst = khypePrice(table, asked);
    if (lst) return lst;
  }
  const index = table.tokenByName.get(upper);
  if (index !== undefined) {
    const spot = spotPairPrice(table, asked, index);
    if (spot) return spot;
  }
  return perpPrice(table, asked, asked) ?? perpPrice(table, asked, PERP_FALLBACK[upper] ?? upper);
}

/** Reference price of a HyperCore **mainnet** spot token by index. */
export function priceMainnetToken(table: ReferenceTable, index: number): ReferencePrice | null {
  const name = table.tokenName.get(index);
  if (index === USDC_INDEX) return quote(name ?? "USDC", 1, "unit", null);
  if (!name) return null;
  if (name.toUpperCase() === "KHYPE") return khypePrice(table, name) ?? spotPairPrice(table, name, index);
  return spotPairPrice(table, name, index) ?? (PERP_FALLBACK[name.toUpperCase()] ? perpPrice(table, name, PERP_FALLBACK[name.toUpperCase()] as string) : null);
}

/** Economic underlying of a token or coin for exposure: `kHYPE` -> HYPE, `UBTC` -> BTC, stables -> USD. */
export function underlyingOf(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  return UNDERLYING[upper] ?? symbol.trim();
}

export function isCashUnderlying(underlying: string): boolean {
  return underlying === "USD";
}

/* ------------------------------------------------------------- service */

const ACCOUNTANT_ABI = parseAbi(["function kHYPEToHYPE(uint256 kHYPEAmount) view returns (uint256)"]);

/** The Kinetiq StakingAccountant on HyperEVM mainnet, from the core protocol registry. */
export function khypeAccountantAddress(): Address | null {
  const kinetiq = getProtocol("kinetiq");
  const address = kinetiq ? deploymentOn(kinetiq, "hyperevm-mainnet")?.contracts.stakingAccountant : undefined;
  return typeof address === "string" ? (address as Address) : null;
}

/** HYPE per kHYPE read from the StakingAccountant (`kHYPEToHYPE(1e18) / 1e18`). */
export async function readKhypeToHype(chains: EvmChains): Promise<number | null> {
  const accountant = khypeAccountantAddress();
  if (!accountant || !chains.isAvailable("hyperevm-mainnet")) return null;
  const units = await chains.client("hyperevm-mainnet").readContract({ address: accountant, abi: ACCOUNTANT_ABI, functionName: "kHYPEToHYPE", args: [10n ** 18n] });
  const rate = Number(units) / 1e18;
  // A redemption rate far from 1 is a misread, not a price.
  return Number.isFinite(rate) && rate > 0.5 && rate < 5 ? rate : null;
}

export interface ReferencePriceServiceDeps {
  /** The HyperCore **mainnet** info client. */
  readonly info: () => HyperliquidInfoClient;
  readonly khypeRate: () => Promise<number | null>;
  readonly clock: Clock;
  readonly log?: Logger;
  readonly ttlMs?: number;
}

export class ReferencePriceService {
  private readonly tableCache: RefreshingCache<ReferenceTable>;
  private readonly rateCache: RefreshingCache<number | null>;

  constructor(private readonly deps: ReferencePriceServiceDeps) {
    const ttlMs = deps.ttlMs ?? REFERENCE_TTL_MS;
    this.rateCache = new RefreshingCache(() => deps.khypeRate(), { ttlMs: KHYPE_RATE_TTL_MS, maxStaleMs: 6 * 60 * 60_000, clock: deps.clock, errorBackoffMs: 60_000 });
    this.tableCache = new RefreshingCache(() => this.load(), { ttlMs, maxStaleMs: 5 * 60_000, clock: deps.clock, errorBackoffMs: 2_000 });
  }

  /** The current table; `stale` when mainnet mids could not be refreshed and an older table is served. */
  table(): Promise<CachedValue<ReferenceTable>> {
    return this.tableCache.get();
  }

  private async khypeToHype(): Promise<number | null> {
    try {
      return (await this.rateCache.get()).value;
    } catch (error) {
      this.deps.log?.warn("kHYPE rate unavailable", { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async load(): Promise<ReferenceTable> {
    const info = this.deps.info();
    const [mids, spotMeta, khypeToHype] = await Promise.all([info.allMids(undefined), info.spotMeta(), this.khypeToHype()]);
    return buildReferenceTable({ mids, spotMeta, khypeToHype, time: this.deps.clock.now() });
  }
}
