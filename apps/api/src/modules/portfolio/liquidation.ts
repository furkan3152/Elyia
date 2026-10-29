/**
 * Liquidation math (HyperCore docs, trading/liquidations):
 *
 *   liq = price - side * margin_available / size / (1 - l * side),  l = maintenance rate
 *   maintenance margin = notional * rate - deduction, rate = 1 / (2 * tier max leverage)
 *
 * Rules (checked against live positions):
 * - Current state always uses HyperCore's own `liquidationPx` (authoritative).
 * - Isolated what-ifs use the exact formula below; on recorded testnet
 *   positions it reproduces the API to 1e-9 relative.
 * - Cross what-ifs use perp-only margin, a conservative estimate: under
 *   unified or portfolio margin the real price is further from mark.
 */
import type { MarginTierView } from "@elyia/core/api/markets";
import { round, roundPct } from "../markets/num.js";

export type PositionSide = 1 | -1;

/** "danger" below 5 %, "watch" below 15 % (the guard's amber and red bands). */
export const LIQUIDATION_WATCH_PCT = 15;
export const LIQUIDATION_DANGER_PCT = 5;

/** Signed percent from mark to a price (negative = below mark). */
export function signedDistancePct(mark: number, price: number): number | null {
  if (!(mark > 0) || !Number.isFinite(price)) return null;
  return roundPct(((price - mark) / mark) * 100);
}

/** Percent the mark must move against the position to reach `liquidationPx` (negative once past it). */
export function liquidationDistancePct(side: PositionSide, mark: number, liquidationPx: number | null): number | null {
  if (liquidationPx === null || !(mark > 0) || !(liquidationPx > 0)) return null;
  return roundPct(((side === 1 ? mark - liquidationPx : liquidationPx - mark) / mark) * 100);
}

export function liquidationRisk(distancePct: number | null): "safe" | "watch" | "danger" | "none" {
  if (distancePct === null) return "none";
  if (distancePct < LIQUIDATION_DANGER_PCT) return "danger";
  if (distancePct < LIQUIDATION_WATCH_PCT) return "watch";
  return "safe";
}

/** The tier that applies to a position value (tiers sorted by lower bound). */
export function tierFor(notional: number, tiers: readonly MarginTierView[]): MarginTierView | null {
  let chosen: MarginTierView | null = null;
  for (const tier of tiers) if (notional >= tier.lowerBoundUsd) chosen = tier;
  return chosen ?? tiers[0] ?? null;
}

export function maintenanceMargin(notional: number, tiers: readonly MarginTierView[]): number | null {
  const tier = tierFor(notional, tiers);
  return tier ? Math.max(0, notional * tier.maintenanceMarginRate - tier.maintenanceDeductionUsd) : null;
}

/**
 * Exact liquidation price of an isolated position from its signed size and
 * `leverage.rawUsd` (isolated equity at price P is `rawUsd + szi * P`). The
 * maintenance tier is the one at the liquidation notional, found by
 * iteration. Null when no positive price liquidates it.
 */
export function isolatedLiquidationPx(input: { readonly szi: number; readonly rawUsd: number; readonly tiers: readonly MarginTierView[] }): number | null {
  const { szi, rawUsd, tiers } = input;
  if (szi === 0 || tiers.length === 0) return null;
  const size = Math.abs(szi);
  // Start from the tier at the break-even notional and settle on the tier at the liquidation notional.
  let tier = tierFor(Math.abs(rawUsd), tiers);
  let price: number | null = null;
  for (let step = 0; step < 6 && tier; step += 1) {
    const denominator = szi - size * tier.maintenanceMarginRate;
    if (denominator === 0) return null;
    const candidate = -(rawUsd + tier.maintenanceDeductionUsd) / denominator;
    if (!(candidate > 0) || !Number.isFinite(candidate)) return null;
    price = candidate;
    const next = tierFor(size * candidate, tiers);
    if (!next || next === tier) break;
    tier = next;
  }
  return price === null ? null : round(price, 10);
}

/** The docs formula from margin available; null when the result is not a positive price. */
export function liquidationPxFromMargin(input: { readonly price: number; readonly side: PositionSide; readonly size: number; readonly marginAvailable: number; readonly maintenanceRate: number }): number | null {
  const { price, side, size, marginAvailable, maintenanceRate } = input;
  if (!(size > 0) || !(price > 0)) return null;
  const denominator = 1 - maintenanceRate * side;
  if (denominator <= 0) return null;
  const liq = price - (side * marginAvailable) / size / denominator;
  return liq > 0 && Number.isFinite(liq) ? round(liq, 10) : null;
}

/**
 * Conservative cross estimate for a what-if: margin available is the cross
 * account value minus cross maintenance margin, other positions frozen and
 * spot collateral ignored.
 */
export function estimateCrossLiquidationPx(input: {
  readonly mark: number;
  readonly szi: number;
  readonly crossAccountValue: number;
  readonly crossMaintenanceMarginUsed: number;
  readonly maintenanceRate: number;
}): number | null {
  if (input.szi === 0) return null;
  return liquidationPxFromMargin({
    price: input.mark,
    side: input.szi > 0 ? 1 : -1,
    size: Math.abs(input.szi),
    marginAvailable: input.crossAccountValue - input.crossMaintenanceMarginUsed,
    maintenanceRate: input.maintenanceRate,
  });
}
