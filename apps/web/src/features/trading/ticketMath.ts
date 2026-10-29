/**
 * Ticket arithmetic (pure): sizes from a USD amount or a percentage, TP/SL
 * prices from a target return on equity, margin, fees. Results that feed an
 * order are decimal strings rounded down to the market's lot; display-only
 * figures are numbers.
 */
import { numberToPlainString, roundSize } from "@elyia/core/hypercore/wire";

export type SizeUnit = "base" | "usd";

/** Base size for what the user typed: a base amount, or a USD notional at `px`. Rounded down to lots; null when not computable. */
export function baseSize(input: { readonly amount: string; readonly unit: SizeUnit; readonly px: number | null; readonly szDecimals: number }): string | null {
  const amount = Number(input.amount);
  if (!input.amount || !Number.isFinite(amount) || amount <= 0) return null;
  const base = input.unit === "base" ? amount : input.px && input.px > 0 ? amount / input.px : null;
  if (base === null || !Number.isFinite(base)) return null;
  const rounded = roundSize(numberToPlainString(Number(base.toPrecision(15))), input.szDecimals, "down");
  return Number(rounded) > 0 ? rounded : null;
}

/** The largest base size the account can open on one side (HyperCore's own `maxTradeSzs` when known). */
export function maxSizeFor(input: { readonly side: "buy" | "sell"; readonly maxTradeSzs?: readonly [string, string] | readonly string[] | null; readonly availableUsd?: number | null; readonly leverage: number; readonly px: number | null }): number | null {
  const fromApi = input.maxTradeSzs ? Number(input.maxTradeSzs[input.side === "buy" ? 0 : 1]) : NaN;
  if (Number.isFinite(fromApi) && fromApi >= 0) return fromApi;
  if (input.availableUsd === null || input.availableUsd === undefined || !input.px || input.px <= 0) return null;
  return Math.max(0, (input.availableUsd * input.leverage) / input.px);
}

/** A percentage preset of the max size, in the unit the ticket shows. */
export function presetAmount(input: { readonly percent: number; readonly maxBase: number; readonly unit: SizeUnit; readonly px: number | null; readonly szDecimals: number }): string | null {
  if (!(input.maxBase > 0) || !(input.percent > 0)) return null;
  const base = (input.maxBase * Math.min(100, input.percent)) / 100;
  const lots = roundSize(numberToPlainString(Number(base.toPrecision(15))), input.szDecimals, "down");
  if (Number(lots) <= 0) return null;
  if (input.unit === "base") return lots;
  if (!input.px) return null;
  return (Number(lots) * input.px).toFixed(2);
}

/**
 * Trigger price for a target ROE (return on margin): a long's +10% ROE at
 * 5x is a 2% move up. `roePct` is in percent and positive for the TP, a
 * positive loss for the SL.
 */
export function priceForRoe(input: { readonly entryPx: number; readonly isLong: boolean; readonly roePct: number; readonly leverage: number; readonly kind: "tp" | "sl" }): number | null {
  if (!(input.entryPx > 0) || !(input.leverage > 0) || !Number.isFinite(input.roePct) || input.roePct <= 0) return null;
  const move = input.roePct / 100 / input.leverage;
  const up = (input.kind === "tp") === input.isLong;
  const px = input.entryPx * (up ? 1 + move : 1 - move);
  return px > 0 ? px : null;
}

/** ROE (fraction) of a move from entry to `px` at `leverage`. */
export function roeAt(input: { readonly entryPx: number; readonly px: number; readonly isLong: boolean; readonly leverage: number }): number | null {
  if (!(input.entryPx > 0) || !(input.px > 0) || !(input.leverage > 0)) return null;
  const move = (input.px - input.entryPx) / input.entryPx;
  return (input.isLong ? move : -move) * input.leverage;
}

/** Initial margin of a perp order. */
export function marginRequired(notional: number, leverage: number): number | null {
  if (!(notional > 0) || !(leverage > 0)) return null;
  return notional / leverage;
}

export interface FeeRates {
  /** Taker (crossing) rate, fraction. */
  readonly taker: number;
  /** Maker (resting) rate, fraction (may be negative: a rebate). */
  readonly maker: number;
}

/** Base tier: perps 0.045% taker / 0.015% maker, spot 0.07% / 0.04% (HyperCore userFees). */
export const BASE_FEES: Readonly<Record<"perp" | "spot", FeeRates>> = Object.freeze({
  perp: { taker: 0.00045, maker: 0.00015 },
  spot: { taker: 0.0007, maker: 0.0004 },
});

/** The account's own rates from `userFees` (falls back to the base tier). */
export function feeRatesFrom(userFees: unknown, isSpot: boolean): FeeRates {
  const fees = userFees as { userCrossRate?: string; userAddRate?: string; userSpotCrossRate?: string; userSpotAddRate?: string } | null;
  const base = BASE_FEES[isSpot ? "spot" : "perp"];
  const taker = Number(isSpot ? fees?.userSpotCrossRate : fees?.userCrossRate);
  const maker = Number(isSpot ? fees?.userSpotAddRate : fees?.userAddRate);
  return { taker: Number.isFinite(taker) && taker >= 0 ? taker : base.taker, maker: Number.isFinite(maker) ? maker : base.maker };
}

/** Fee of an order: takers pay the cross rate; a resting (post-only) order pays the maker rate. */
export function feeFor(notional: number, rates: FeeRates, takes: boolean): number {
  return notional * (takes ? rates.taker : rates.maker);
}

/** "0.045%" for a fraction rate. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")}%`;
}

/** Leverage ticks for a slider up to `max` (1x, a few round steps, max). */
export function leverageTicks(max: number): number[] {
  const candidates = [1, 2, 3, 5, 10, 15, 20, 25, 40, 50];
  const ticks = candidates.filter((value) => value < max);
  const spaced = ticks.length > 5 ? ticks.filter((value, index) => index === 0 || value % 5 === 0) : ticks;
  return [...spaced, max];
}

/** Leverage at or above this reads as the danger zone (rose). */
export function dangerLeverage(max: number): number {
  return Math.max(2, Math.min(20, Math.ceil(max * 0.5)));
}
