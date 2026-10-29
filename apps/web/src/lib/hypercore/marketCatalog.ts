/**
 * The terminal's market catalogue (pure): perps of the first dex, HIP-3
 * builder dexes and spot pairs, each with what an order needs (asset id,
 * size decimals, leverage limits) and its live context (mark, 24 h change and
 * volume, funding, open interest). Built from `metaAndAssetCtxs`,
 * `spotMetaAndAssetCtxs`, `allPerpMetas` + `perpDexs` and the
 * `allDexsAssetCtxs` feed.
 *
 * Asset ids follow the docs: perp = index in the first dex's universe, spot =
 * 10000 + pair index, HIP-3 = 100000 + dexIndex * 10000 + index.
 */
import type { MetaAndAssetCtxs, PerpAssetCtx, PerpAssetMeta, PerpMeta, SpotAssetCtx, SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import { builderPerpAssetIndex, maxPriceDecimals, spotAssetIndex, type MarketInfo } from "@elyia/core/hypercore/wire";

export type MarketKind = "perp" | "hip3" | "spot";

export interface MarketCtx {
  readonly markPx: number | null;
  readonly midPx: number | null;
  readonly oraclePx: number | null;
  readonly prevDayPx: number | null;
  /** 24 h notional volume (quote units, USD for USDC markets). */
  readonly dayNtlVlm: number;
  /** Hourly funding rate as a fraction; null on spot. */
  readonly funding: number | null;
  /** Open interest in base units; null on spot. */
  readonly openInterest: number | null;
  readonly premium: number | null;
}

export interface TradeMarket extends MarketInfo {
  readonly kind: MarketKind;
  /** "" for the first perp dex, the HIP-3 dex name, or "spot". */
  readonly dex: string;
  readonly base: string;
  readonly quote: string;
  /** URL parameter: "ETH", "xyz:TSLA", "HYPE-USDC". */
  readonly slug: string;
  /** "strictIsolated" / "noCross" when cross margin is not allowed. */
  readonly marginMode: string | null;
  readonly isCanonical: boolean;
  readonly ctx: MarketCtx | null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function perpCtx(ctx: Partial<PerpAssetCtx> | undefined | null): MarketCtx | null {
  if (!ctx) return null;
  return {
    markPx: num(ctx.markPx),
    midPx: num(ctx.midPx),
    oraclePx: num(ctx.oraclePx),
    prevDayPx: num(ctx.prevDayPx),
    dayNtlVlm: num(ctx.dayNtlVlm) ?? 0,
    funding: num(ctx.funding),
    openInterest: num(ctx.openInterest),
    premium: num(ctx.premium),
  };
}

export function spotCtx(ctx: Partial<SpotAssetCtx> | undefined | null): MarketCtx | null {
  if (!ctx) return null;
  return {
    markPx: num(ctx.markPx),
    midPx: num(ctx.midPx),
    oraclePx: null,
    prevDayPx: num(ctx.prevDayPx),
    dayNtlVlm: num(ctx.dayNtlVlm) ?? 0,
    funding: null,
    openInterest: null,
    premium: null,
  };
}

function isolatedOnly(asset: PerpAssetMeta): boolean {
  return asset.onlyIsolated === true || asset.marginMode === "strictIsolated" || asset.marginMode === "noCross";
}

/** Markets of one perp dex: index 0 (dexName "") is the first dex; HIP-3 dexes have names and indexes >= 1. */
export function perpMarkets(meta: PerpMeta, ctxs: readonly (Partial<PerpAssetCtx> | null | undefined)[], dexIndex = 0, dexName = ""): TradeMarket[] {
  const out: TradeMarket[] = [];
  meta.universe.forEach((asset, index) => {
    if (!asset || typeof asset.name !== "string") return;
    const hip3 = dexIndex > 0;
    let assetId: number;
    try {
      assetId = hip3 ? builderPerpAssetIndex(dexIndex, index) : index;
    } catch {
      return;
    }
    const base = hip3 && asset.name.includes(":") ? asset.name.slice(asset.name.indexOf(":") + 1) : asset.name;
    out.push({
      coin: asset.name,
      displayName: asset.name,
      asset: assetId,
      szDecimals: asset.szDecimals,
      isSpot: false,
      maxLeverage: asset.maxLeverage,
      onlyIsolated: isolatedOnly(asset),
      isDelisted: asset.isDelisted === true,
      kind: hip3 ? "hip3" : "perp",
      dex: dexName,
      base,
      quote: "USD",
      slug: asset.name,
      marginMode: asset.marginMode ?? (asset.onlyIsolated ? "strictIsolated" : null),
      isCanonical: true,
      ctx: perpCtx(ctxs[index] ?? null),
    });
  });
  return out;
}

export function perpMarketsFrom(data: MetaAndAssetCtxs | null | undefined): TradeMarket[] {
  if (!data || !Array.isArray(data) || data.length < 2) return [];
  return perpMarkets(data[0], data[1]);
}

/** Spot pairs with readable names ("HYPE/USDC"); canonical pairs win name clashes for the slug. */
export function spotMarketsFrom(data: SpotMetaAndAssetCtxs | null | undefined): TradeMarket[] {
  if (!data || !Array.isArray(data) || data.length < 2) return [];
  const [meta, ctxs] = data;
  const tokens = new Map(meta.tokens.map((token) => [token.index, token]));
  const ctxByCoin = new Map(ctxs.map((ctx) => [ctx.coin, ctx]));
  const usedSlugs = new Set<string>();
  const pairs = [...meta.universe].sort((a, b) => Number(b.isCanonical) - Number(a.isCanonical) || a.index - b.index);
  const out: TradeMarket[] = [];
  for (const pair of pairs) {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    if (!base || !quote) continue;
    let asset: number;
    try {
      asset = spotAssetIndex(pair.index);
    } catch {
      continue;
    }
    const pretty = `${base.name}-${quote.name}`;
    // A non-canonical pair whose readable name is taken keeps its book coin ("@1035") as the slug.
    const slug = usedSlugs.has(pretty.toUpperCase()) ? pair.name : pretty;
    usedSlugs.add(slug.toUpperCase());
    out.push({
      coin: pair.name,
      displayName: `${base.name}/${quote.name}`,
      asset,
      szDecimals: base.szDecimals,
      isSpot: true,
      maxLeverage: null,
      onlyIsolated: false,
      isDelisted: false,
      kind: "spot",
      dex: "spot",
      base: base.name,
      quote: quote.name,
      slug,
      marginMode: null,
      isCanonical: pair.isCanonical,
      ctx: spotCtx(ctxByCoin.get(pair.name) ?? null),
    });
  }
  return out;
}

/** HIP-3 markets from `allPerpMetas` (index-aligned with `perpDexs`) plus the `allDexsAssetCtxs` contexts. */
export function hip3MarketsFrom(
  metas: readonly (PerpMeta | null)[] | null | undefined,
  dexs: readonly ({ readonly name: string } | null)[] | null | undefined,
  ctxsByDex: ReadonlyMap<string, readonly (Partial<PerpAssetCtx> | null)[]>,
): TradeMarket[] {
  if (!metas || !dexs) return [];
  const out: TradeMarket[] = [];
  for (let index = 1; index < metas.length; index += 1) {
    const meta = metas[index];
    const dex = dexs[index];
    if (!meta || !dex || typeof dex.name !== "string") continue;
    out.push(...perpMarkets(meta, ctxsByDex.get(dex.name) ?? [], index, dex.name));
  }
  return out;
}

/** `allDexsAssetCtxs` data -> contexts per dex name. */
export function ctxsByDexFrom(data: unknown): Map<string, readonly (Partial<PerpAssetCtx> | null)[]> {
  const map = new Map<string, readonly (Partial<PerpAssetCtx> | null)[]>();
  const ctxs = (data as { ctxs?: unknown } | null)?.ctxs;
  if (!Array.isArray(ctxs)) return map;
  for (const entry of ctxs) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
    map.set(entry[0], entry[1] as (Partial<PerpAssetCtx> | null)[]);
  }
  return map;
}

/** Finds a market by slug, book coin or display name (case-insensitive; "HYPE-USDC" and "HYPE/USDC" both work). */
export function findMarket(markets: readonly TradeMarket[], query: string | null | undefined): TradeMarket | null {
  if (!query) return null;
  const wanted = query.trim().toUpperCase();
  const slashed = wanted.replace("-", "/");
  return (
    markets.find((market) => market.slug.toUpperCase() === wanted) ??
    markets.find((market) => market.coin.toUpperCase() === wanted) ??
    markets.find((market) => market.displayName.toUpperCase() === slashed && market.isCanonical) ??
    markets.find((market) => market.displayName.toUpperCase() === slashed) ??
    null
  );
}

export type MarketTab = "perp" | "hip3" | "spot" | "favorites";

/**
 * Picker rows: delisted markets dropped, the query matched against name,
 * base and dex, sorted by 24 h volume (favorites first within a tab).
 */
export function filterMarkets(markets: readonly TradeMarket[], options: { readonly tab: MarketTab; readonly query?: string; readonly favorites?: ReadonlySet<string>; readonly limit?: number }): TradeMarket[] {
  const query = (options.query ?? "").trim().toUpperCase();
  const favorites = options.favorites ?? new Set<string>();
  const rows = markets.filter((market) => {
    if (market.isDelisted) return false;
    if (options.tab === "favorites") {
      if (!favorites.has(market.coin)) return false;
    } else if (market.kind !== options.tab) return false;
    if (!query) return true;
    return market.displayName.toUpperCase().includes(query) || market.base.toUpperCase().startsWith(query) || market.slug.toUpperCase().includes(query) || market.dex.toUpperCase() === query;
  });
  const exact = (market: TradeMarket) => (query && (market.base.toUpperCase() === query || market.coin.toUpperCase() === query) ? 1 : 0);
  rows.sort((a, b) => exact(b) - exact(a) || Number(favorites.has(b.coin)) - Number(favorites.has(a.coin)) || (b.ctx?.dayNtlVlm ?? 0) - (a.ctx?.dayNtlVlm ?? 0));
  return options.limit ? rows.slice(0, options.limit) : rows;
}

/* --------------------------------------------------------------- figures */

/** 24 h change as a fraction, or null. */
export function change24h(ctx: MarketCtx | null | undefined): number | null {
  if (!ctx || ctx.markPx === null || ctx.prevDayPx === null || ctx.prevDayPx <= 0) return null;
  return ctx.markPx / ctx.prevDayPx - 1;
}

/** HyperCore funding is paid every hour; APR = hourly x 24 x 365. */
export function fundingApr(hourly: number | null | undefined): number | null {
  return hourly === null || hourly === undefined || !Number.isFinite(hourly) ? null : hourly * 24 * 365;
}

/** Milliseconds until the next funding payment (top of the next UTC hour). */
export function msToNextFunding(now: number): number {
  const hour = 3_600_000;
  return hour - (now % hour);
}

/** "41:12" style countdown (mm:ss, or h:mm:ss beyond an hour). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Open interest in quote units (base OI x mark). */
export function openInterestUsd(ctx: MarketCtx | null | undefined): number | null {
  if (!ctx || ctx.openInterest === null || ctx.markPx === null) return null;
  return ctx.openInterest * ctx.markPx;
}

/** Decimals a price of this size shows (5 significant figures, capped by the market's tick rule). */
export function priceDecimals(px: number, szDecimals: number, isSpot: boolean): number {
  const cap = maxPriceDecimals(szDecimals, isSpot);
  if (!Number.isFinite(px) || px <= 0) return Math.min(cap, 2);
  const integerDigits = px >= 1 ? Math.floor(Math.log10(px)) + 1 : 0;
  const leadingZeros = px < 1 ? Math.max(0, -Math.floor(Math.log10(px)) - 1) : 0;
  const sig = integerDigits > 0 ? Math.max(0, 5 - integerDigits) : 5 + leadingZeros;
  return Math.max(0, Math.min(cap, sig));
}

/** A price for display: grouped, at the market's precision ("3,342.7"). */
export function formatPx(px: number | string | null | undefined, market: Pick<MarketInfo, "szDecimals" | "isSpot"> | null, fallbackDecimals = 2): string {
  const value = typeof px === "string" ? Number(px) : px;
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const decimals = market ? priceDecimals(Math.abs(value), market.szDecimals, market.isSpot) : fallbackDecimals;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A size for display at the market's lot precision. */
export function formatSz(sz: number | string | null | undefined, szDecimals: number): string {
  const value = typeof sz === "string" ? Number(sz) : sz;
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: Math.min(szDecimals, 4), maximumFractionDigits: szDecimals });
}

/* ------------------------------------------------------------ book grouping */

export interface BookGrouping {
  /** Price step of one level. */
  readonly step: number;
  readonly label: string;
  readonly nSigFigs: 2 | 3 | 4 | 5 | null;
  readonly mantissa: 2 | 5 | null;
}

/**
 * Book aggregation choices for a price: the native tick (5 significant
 * figures), then x2 and x5 (nSigFigs 5 with mantissa), x10, x100, x1000
 * (nSigFigs 4, 3, 2). Steps finer than the market's decimal cap collapse.
 */
export function bookGroupings(px: number, szDecimals: number, isSpot: boolean): BookGrouping[] {
  if (!Number.isFinite(px) || px <= 0) return [{ step: 1, label: "1", nSigFigs: null, mantissa: null }];
  const magnitude = Math.floor(Math.log10(px));
  const decimalsCap = maxPriceDecimals(szDecimals, isSpot);
  const tickExp = Math.max(magnitude - 4, -decimalsCap);
  const make = (exp: number, factor: number, nSigFigs: BookGrouping["nSigFigs"], mantissa: BookGrouping["mantissa"]): BookGrouping => {
    const step = factor * 10 ** exp;
    const decimals = Math.max(0, -exp);
    return { step: Number(step.toFixed(decimals)), label: step.toFixed(decimals), nSigFigs, mantissa };
  };
  const options: BookGrouping[] = [make(tickExp, 1, null, null)];
  // Server-side aggregation is expressed in significant figures of the price itself.
  const sigExp = magnitude - 4;
  if (sigExp >= tickExp) {
    options.push(make(sigExp, 2, 5, 2), make(sigExp, 5, 5, 5));
  }
  options.push(make(magnitude - 3, 1, 4, null), make(magnitude - 2, 1, 3, null), make(magnitude - 1, 1, 2, null));
  const seen = new Set<number>();
  return options.filter((option) => {
    if (option.step <= 0 || seen.has(option.step)) return false;
    seen.add(option.step);
    return option.step >= options[0]!.step;
  });
}
