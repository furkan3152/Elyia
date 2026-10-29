/**
 * Scale (ladder) orders, pure: N limit orders between two prices, with the
 * total size split flat, front-loaded (more at the first price) or
 * back-loaded (more at the last). Sizes are split in whole lots with the
 * largest-remainder method, so the ladder adds up to exactly the requested
 * size (rounded down to the market's lot) and never more.
 */

export type ScaleSkew = "flat" | "front" | "back";

export const SCALE_MIN_ORDERS = 2;
export const SCALE_MAX_ORDERS = 50;

/** Integer weights per order (first price first). */
export function scaleWeights(count: number, skew: ScaleSkew): number[] {
  if (!Number.isInteger(count) || count < SCALE_MIN_ORDERS || count > SCALE_MAX_ORDERS) {
    throw new RangeError(`A scale order has ${SCALE_MIN_ORDERS} to ${SCALE_MAX_ORDERS} orders.`);
  }
  return Array.from({ length: count }, (_, index) => (skew === "flat" ? 1 : skew === "front" ? count - index : index + 1));
}

/** Weights as fractions of the total (sum 1). */
export function scaleDistribution(count: number, skew: ScaleSkew): number[] {
  const weights = scaleWeights(count, skew);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/**
 * Splits `totalLots` (whole lots, e.g. size x 10^szDecimals) by `weights`:
 * floors first, then one extra lot to the largest remainders (earlier orders
 * win ties). The result always sums to `totalLots`.
 */
export function splitLots(totalLots: bigint, weights: readonly number[]): bigint[] {
  if (totalLots < 0n) throw new RangeError("Lots must not be negative.");
  const integerWeights = weights.map((weight) => BigInt(Math.round(weight)));
  const sum = integerWeights.reduce((acc, weight) => acc + weight, 0n);
  if (sum <= 0n) throw new RangeError("Weights must add up to more than zero.");
  const shares = integerWeights.map((weight) => (totalLots * weight) / sum);
  const remainders = integerWeights.map((weight, index) => ({ index, rest: (totalLots * weight) % sum }));
  let left = totalLots - shares.reduce((acc, share) => acc + share, 0n);
  remainders.sort((a, b) => (b.rest === a.rest ? a.index - b.index : b.rest > a.rest ? 1 : -1));
  for (const { index } of remainders) {
    if (left <= 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares;
}

/** Evenly spaced prices from `from` to `to`, both included. */
export function ladderPrices(from: number, to: number, count: number): number[] {
  if (count < 2) return [from];
  return Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));
}

/** Size-weighted average price of a ladder. */
export function averagePrice(levels: readonly { readonly px: number; readonly sz: number }[]): number | null {
  const size = levels.reduce((sum, level) => sum + level.sz, 0);
  if (size <= 0) return null;
  return levels.reduce((sum, level) => sum + level.px * level.sz, 0) / size;
}
