/**
 * Funding across venues, normalized to one hour. HyperCore pays funding
 * hourly; Binance and Bybit quote per 1, 4 or 8 h (`fundingIntervalHours`).
 * A prediction without an interval is shown raw with `hourly: null`: an
 * interval is never assumed.
 */
import type { FundingRow, MarketRow, VenueFunding } from "@elyia/core/api/markets";
import type { PredictedFundings } from "../../hyperliquid/types.js";
import { hourlyToAprPct, median, medianAbsoluteDeviation, round, roundPct, toNumber } from "./num.js";

const VENUE_NAMES: Readonly<Record<string, string>> = Object.freeze({ HlPerp: "hyperliquid", BinPerp: "binance", BybitPerp: "bybit" });
/** A row is an outlier when its APR is more than this many MADs from the median. */
export const OUTLIER_MADS = 5;
/**
 * Floor of the MAD in APR points: most mainnet perps sit at the same baseline
 * rate, which makes the MAD 0; the floor keeps "outlier" meaning at least
 * OUTLIER_MADS x 2 = 10 APR points away from the median.
 */
export const MIN_MAD_APR_PCT = 2;
export const OUTLIER_LIST = 10;

export function venueName(raw: string): string {
  return VENUE_NAMES[raw] ?? raw;
}

export function normalizeVenue(raw: string, prediction: { readonly fundingRate: string; readonly nextFundingTime: number; readonly fundingIntervalHours?: number } | null): VenueFunding | null {
  if (!prediction) return null;
  const rate = toNumber(prediction.fundingRate);
  const interval = typeof prediction.fundingIntervalHours === "number" && prediction.fundingIntervalHours > 0 ? prediction.fundingIntervalHours : null;
  const hourly = rate === null || interval === null ? null : round(rate / interval, 12);
  return {
    venue: venueName(raw),
    rate: prediction.fundingRate,
    intervalHours: interval,
    hourly,
    aprPct: hourlyToAprPct(hourly),
    nextFundingTime: Number.isFinite(prediction.nextFundingTime) ? prediction.nextFundingTime : null,
  };
}

/** One row per live perp of the first dex, joined with the cross-venue predictions. */
export function buildFundingRows(perps: readonly MarketRow[], predicted: PredictedFundings): FundingRow[] {
  const predictions = new Map(predicted.map(([coin, venues]) => [coin, venues]));
  const rows = perps
    .filter((row) => row.type === "perp" && !row.isDelisted)
    .map((row) => {
      const venues = (predictions.get(row.coin) ?? []).map(([venue, prediction]) => normalizeVenue(venue, prediction)).filter((venue): venue is VenueFunding => venue !== null);
      const aprs = venues.map((venue) => venue.aprPct).filter((apr): apr is number => apr !== null);
      const current = toNumber(row.fundingHourly);
      return {
        coin: row.coin,
        markPx: row.markPx,
        openInterestUsd: row.openInterestUsd,
        currentHourly: current,
        currentAprPct: hourlyToAprPct(current),
        venues,
        spreadAprPct: aprs.length >= 2 ? roundPct(Math.max(...aprs) - Math.min(...aprs)) : null,
        outlier: false,
      };
    });
  return flagOutliers(rows);
}

/** Robust outlier flag on the current APR (median and median absolute deviation, floored). */
export function flagOutliers(rows: readonly FundingRow[]): FundingRow[] {
  const aprs = rows.map((row) => row.currentAprPct).filter((apr): apr is number => apr !== null);
  const center = median(aprs);
  const mad = medianAbsoluteDeviation(aprs);
  if (center === null || mad === null) return [...rows];
  const scale = Math.max(mad, MIN_MAD_APR_PCT);
  return rows.map((row) => ({ ...row, outlier: row.currentAprPct !== null && Math.abs(row.currentAprPct - center) > OUTLIER_MADS * scale }));
}

export function fundingStats(rows: readonly FundingRow[]): { readonly medianAprPct: number | null; readonly madAprPct: number | null } {
  const aprs = rows.map((row) => row.currentAprPct).filter((apr): apr is number => apr !== null);
  const center = median(aprs);
  const mad = medianAbsoluteDeviation(aprs);
  return { medianAprPct: center === null ? null : roundPct(center), madAprPct: mad === null ? null : roundPct(mad) };
}

export function fundingOutliers(rows: readonly FundingRow[], size = OUTLIER_LIST): { highestApr: string[]; lowestApr: string[]; widestSpread: string[] } {
  const withApr = rows.filter((row) => row.currentAprPct !== null);
  const byApr = [...withApr].sort((a, b) => (b.currentAprPct as number) - (a.currentAprPct as number));
  const bySpread = rows.filter((row) => row.spreadAprPct !== null).sort((a, b) => (b.spreadAprPct as number) - (a.spreadAprPct as number));
  return {
    highestApr: byApr.slice(0, size).map((row) => row.coin),
    lowestApr: byApr.slice(-size).reverse().map((row) => row.coin),
    widestSpread: bySpread.slice(0, size).map((row) => row.coin),
  };
}
