/**
 * Liquidation estimates (pure), from HyperCore's documented formula
 * (trading/liquidations):
 *
 *   liq_price = price - side * margin_available / position_size / (1 - l * side)
 *   l = 1 / MAINTENANCE_LEVERAGE, maintenance margin = half the initial margin at max leverage
 *
 * side = +1 long, -1 short; position_size in base units (positive);
 * margin_available = margin backing the position minus its maintenance
 * requirement at `price`. For isolated positions this is exact (checked
 * against the API within 0.01%); for cross it uses the account's value
 * and other positions' maintenance, which the API refines (unified and
 * portfolio-margin accounts differ more), so the terminal labels it an
 * estimate and prefers the API's `liquidationPx` for open positions.
 */

/** l: the maintenance margin fraction (1 / (2 x max leverage)). */
export function maintenanceFraction(maxLeverage: number): number {
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) throw new RangeError("maxLeverage must be positive.");
  return 1 / (2 * maxLeverage);
}

export interface LiquidationInput {
  readonly side: 1 | -1;
  /** Price the margin figure refers to (entry, or the current mark). */
  readonly price: number;
  /** Base units, positive. */
  readonly size: number;
  /** Margin left above maintenance at `price` (quote units). */
  readonly marginAvailable: number;
  readonly maxLeverage: number;
}

/** The documented formula; null when the position cannot be liquidated (a long whose liquidation price would be at or below 0). */
export function liquidationPrice(input: LiquidationInput): number | null {
  const { side, price, size, marginAvailable, maxLeverage } = input;
  if (!(price > 0) || !(size > 0) || !Number.isFinite(marginAvailable)) return null;
  const l = maintenanceFraction(maxLeverage);
  const liq = price - (side * marginAvailable) / size / (1 - l * side);
  return Number.isFinite(liq) && liq > 0 ? liq : null;
}

export interface NewPositionInput {
  readonly side: 1 | -1;
  readonly entryPx: number;
  readonly size: number;
  readonly leverage: number;
  readonly maxLeverage: number;
  readonly marginMode: "cross" | "isolated";
  /** Cross only: the account's value and the maintenance its other positions already need. */
  readonly accountValue?: number | null;
  readonly otherMaintenance?: number | null;
}

/**
 * Estimated liquidation price of a position opened now. Isolated: margin =
 * notional / leverage. Cross with a known account: the whole account backs
 * it. Cross without account data falls back to the isolated figure (the
 * conservative side: cross can only be further away).
 */
export function estimateLiquidation(input: NewPositionInput): number | null {
  const { side, entryPx, size, leverage, maxLeverage } = input;
  if (!(entryPx > 0) || !(size > 0) || !(leverage > 0)) return null;
  const notional = entryPx * size;
  const l = maintenanceFraction(maxLeverage);
  const maintenance = notional * l;
  const crossKnown = input.marginMode === "cross" && typeof input.accountValue === "number" && Number.isFinite(input.accountValue);
  const margin = crossKnown ? (input.accountValue as number) - (input.otherMaintenance ?? 0) : notional / leverage;
  return liquidationPrice({ side, price: entryPx, size, marginAvailable: margin - maintenance, maxLeverage });
}

/** Distance from mark to liquidation as a fraction of the mark (0.19 = 19%); null when unknown. */
export function liquidationDistance(markPx: number | null | undefined, liqPx: number | null | undefined): number | null {
  if (markPx === null || markPx === undefined || liqPx === null || liqPx === undefined || !(markPx > 0) || !(liqPx > 0)) return null;
  return Math.abs(markPx - liqPx) / markPx;
}

export type DistanceTone = "rose" | "gold" | "mint";

/** Rose under 10%, gold under 25%, mint beyond. */
export function distanceTone(distance: number | null): DistanceTone {
  if (distance === null) return "mint";
  if (distance < 0.1) return "rose";
  if (distance < 0.25) return "gold";
  return "mint";
}

/** Bar fill for a distance: saturating, so 6% reads short, 19% most of the way, 33% almost full. */
export function distanceBar(distance: number | null): number {
  if (distance === null) return 1;
  return Math.max(0.03, Math.min(1, 1 - Math.exp(-distance / 0.12)));
}
