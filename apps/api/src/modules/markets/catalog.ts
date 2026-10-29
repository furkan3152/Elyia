/**
 * Pure builders for market rows: HyperCore meta + asset contexts in, wire
 * rows (`MarketRow`) out. No I/O; the catalog service feeds them.
 */
import type { MarginTierView, MarketRow, SpotTokenView } from "@elyia/core/api/markets";
import type { PerpAssetCtx, PerpMeta, SpotAssetCtx, SpotMeta, SpotToken } from "@elyia/core/hypercore/info";
import { builderPerpAssetIndex, spotAssetIndex } from "@elyia/core/hypercore/wire";
import { changePct, hourlyToAprPct, roundUsd, toNumber } from "./num.js";

export interface PerpSource {
  /** `""` for the first dex. */
  readonly dex: string;
  /** Index in `perpDexs` (0 for the first dex). */
  readonly dexIndex: number;
  readonly meta: PerpMeta;
  readonly ctxs: readonly PerpAssetCtx[];
  /** Collateral token name (`USDC`, `USDH`). */
  readonly collateral: string;
  /** USD per collateral unit, or null when unknown. */
  readonly quoteUsd: number | null;
}

export interface SpotSource {
  readonly meta: SpotMeta;
  readonly ctxs: readonly SpotAssetCtx[];
  /** USD per unit of a quote token index, or null when unknown. */
  readonly quoteUsd: (tokenIndex: number) => number | null;
}

function usd(amount: number | null, rate: number | null): number | null {
  return amount === null || rate === null ? null : roundUsd(amount * rate);
}

/** Base name of a perp coin: `xyz:TSLA` -> `TSLA`. */
export function perpBase(coin: string): string {
  const colon = coin.indexOf(":");
  return colon === -1 ? coin : coin.slice(colon + 1);
}

/** The HIP-3 dex of a perp coin (`xyz:TSLA` -> `xyz`), or `""` for the first dex. */
export function perpDexOf(coin: string): string {
  const colon = coin.indexOf(":");
  return colon === -1 ? "" : coin.slice(0, colon);
}

export function perpAssetId(dexIndex: number, universeIndex: number): number {
  return dexIndex === 0 ? universeIndex : builderPerpAssetIndex(dexIndex, universeIndex);
}

export function buildPerpRows(source: PerpSource): MarketRow[] {
  return source.meta.universe.map((asset, index): MarketRow => {
    const ctx = source.ctxs[index];
    const mark = toNumber(ctx?.markPx);
    const hourly = toNumber(ctx?.funding);
    const openInterest = toNumber(ctx?.openInterest);
    const volume = toNumber(ctx?.dayNtlVlm);
    const impact = ctx?.impactPxs;
    return {
      coin: asset.name,
      displayName: asset.name,
      type: "perp",
      dex: source.dex,
      assetId: perpAssetId(source.dexIndex, index),
      base: perpBase(asset.name),
      quote: source.collateral,
      szDecimals: asset.szDecimals,
      maxLeverage: asset.maxLeverage,
      onlyIsolated: asset.onlyIsolated === true,
      isDelisted: asset.isDelisted === true,
      markPx: ctx?.markPx ?? null,
      midPx: ctx?.midPx ?? null,
      oraclePx: ctx?.oraclePx ?? null,
      prevDayPx: ctx?.prevDayPx ?? null,
      change24hPct: changePct(mark, toNumber(ctx?.prevDayPx)),
      fundingHourly: ctx?.funding ?? null,
      fundingAprPct: hourlyToAprPct(hourly),
      openInterest: ctx?.openInterest ?? null,
      openInterestUsd: openInterest === null || mark === null ? null : usd(openInterest * mark, source.quoteUsd),
      volume24hQuote: ctx?.dayNtlVlm ?? null,
      volume24hUsd: usd(volume, source.quoteUsd),
      quoteUsd: source.quoteUsd,
      impactPxs: impact && impact.length === 2 ? [impact[0], impact[1]] : null,
      premium: ctx?.premium ?? null,
    };
  });
}

export function buildSpotRows(source: SpotSource): MarketRow[] {
  const tokens = new Map(source.meta.tokens.map((token) => [token.index, token]));
  const ctxByCoin = new Map(source.ctxs.map((ctx) => [ctx.coin, ctx]));
  const rows: MarketRow[] = [];
  for (const pair of source.meta.universe) {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    if (!base || !quote) continue;
    const ctx = ctxByCoin.get(pair.name);
    const mark = toNumber(ctx?.markPx);
    const rate = source.quoteUsd(quote.index);
    rows.push({
      coin: pair.name,
      displayName: `${base.name}/${quote.name}`,
      type: "spot",
      dex: null,
      assetId: spotAssetIndex(pair.index),
      base: base.name,
      quote: quote.name,
      szDecimals: base.szDecimals,
      maxLeverage: null,
      onlyIsolated: false,
      isDelisted: false,
      markPx: ctx?.markPx ?? null,
      midPx: ctx?.midPx ?? null,
      oraclePx: null,
      prevDayPx: ctx?.prevDayPx ?? null,
      change24hPct: changePct(mark, toNumber(ctx?.prevDayPx)),
      fundingHourly: null,
      fundingAprPct: null,
      openInterest: null,
      openInterestUsd: null,
      volume24hQuote: ctx?.dayNtlVlm ?? null,
      volume24hUsd: usd(toNumber(ctx?.dayNtlVlm), rate),
      quoteUsd: rate,
      impactPxs: null,
      premium: null,
    });
  }
  return rows;
}

/** Largest 24 h USD volume first; unknown volume last; then open interest, then name. */
export function sortByVolume(rows: readonly MarketRow[]): MarketRow[] {
  return [...rows].sort((a, b) => {
    const va = a.volume24hUsd ?? -1;
    const vb = b.volume24hUsd ?? -1;
    if (vb !== va) return vb - va;
    const oa = a.openInterestUsd ?? -1;
    const ob = b.openInterestUsd ?? -1;
    if (ob !== oa) return ob - oa;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Case-insensitive match on coin, display name or base. */
export function matchesQuery(row: MarketRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return row.coin.toLowerCase().includes(needle) || row.displayName.toLowerCase().includes(needle) || row.base.toLowerCase().includes(needle);
}

/**
 * Margin tiers of one perp asset with maintenance rates and deductions
 * (HyperCore docs: maintenance margin is half the initial margin at max
 * leverage; `deduction_i = deduction_{i-1} + lowerBound_i * (mmr_i - mmr_{i-1})`).
 * Assets whose `marginTableId` is not listed use one flat tier at `maxLeverage`.
 */
export function marginTiersFor(meta: PerpMeta, universeIndex: number): MarginTierView[] | null {
  const asset = meta.universe[universeIndex];
  if (!asset) return null;
  const table = meta.marginTables?.find(([id]) => id === asset.marginTableId)?.[1];
  const tiers = table && table.marginTiers.length > 0 ? table.marginTiers : [{ lowerBound: "0.0", maxLeverage: asset.maxLeverage }];
  const out: MarginTierView[] = [];
  let deduction = 0;
  let previousRate: number | null = null;
  for (const tier of tiers) {
    const lowerBound = toNumber(tier.lowerBound) ?? 0;
    const rate = 1 / (2 * tier.maxLeverage);
    if (previousRate !== null) deduction += lowerBound * (rate - previousRate);
    previousRate = rate;
    out.push({ lowerBoundUsd: lowerBound, maxLeverage: tier.maxLeverage, maintenanceMarginRate: rate, maintenanceDeductionUsd: roundUsd(deduction) });
  }
  return out;
}

export function spotTokenView(token: SpotToken): SpotTokenView {
  return {
    name: token.name,
    index: token.index,
    tokenId: token.tokenId,
    szDecimals: token.szDecimals,
    weiDecimals: token.weiDecimals,
    fullName: token.fullName ?? null,
    evmContract: token.evmContract?.address ?? null,
    isCanonical: token.isCanonical,
  };
}
