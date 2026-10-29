/**
 * Hyperliquid REST budget. HL limits REST traffic per IP to an aggregate
 * weight of 1200 per minute (docs: "Rate limits and user limits"), and Elyia's
 * server is a single IP for every user, so every info request spends from a
 * process-wide budget before it is sent.
 *
 * Info weights as documented: 2 for l2Book, allMids, clearinghouseState,
 * orderStatus, spotClearinghouseState and exchangeStatus; 60 for userRole;
 * 20 for every other request. Some requests add weight per items returned
 * (per 20 items, candleSnapshot per 60), charged after the response.
 */
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type { InfoRequestType } from "./types.js";

const LIGHT_TYPES: ReadonlySet<string> = new Set(["l2Book", "allMids", "clearinghouseState", "orderStatus", "spotClearinghouseState", "exchangeStatus"]);
const HEAVY_TYPES: Readonly<Record<string, number>> = { userRole: 60 };
const PER_20_ITEMS: ReadonlySet<string> = new Set([
  "recentTrades",
  "historicalOrders",
  "userFills",
  "userFillsByTime",
  "fundingHistory",
  "userFunding",
  "nonUserFundingUpdates",
  "twapHistory",
  "userTwapSliceFills",
  "userTwapSliceFillsByTime",
  "delegatorHistory",
  "delegatorRewards",
  "validatorStats",
]);

export const DEFAULT_INFO_WEIGHT = 20;

/** Weight charged before an info request is sent. */
export function infoWeight(type: InfoRequestType | string): number {
  if (LIGHT_TYPES.has(type)) return 2;
  return HEAVY_TYPES[type] ?? DEFAULT_INFO_WEIGHT;
}

/** Extra weight owed for the items a response returned. */
export function responseWeight(type: InfoRequestType | string, response: unknown): number {
  if (!Array.isArray(response)) return 0;
  if (type === "candleSnapshot") return Math.floor(response.length / 60);
  if (PER_20_ITEMS.has(type)) return Math.floor(response.length / 20);
  return 0;
}

/** How long a successful response is reused, per request type (ms). Shared market data is cached; user data briefly. */
export const INFO_CACHE_MS: Readonly<Partial<Record<InfoRequestType, number>>> = Object.freeze({
  meta: 60_000,
  spotMeta: 60_000,
  perpDexs: 60_000,
  metaAndAssetCtxs: 2_000,
  spotMetaAndAssetCtxs: 2_000,
  allMids: 1_000,
  l2Book: 1_000,
  recentTrades: 1_000,
  candleSnapshot: 10_000,
  fundingHistory: 60_000,
  predictedFundings: 10_000,
  exchangeStatus: 5_000,
  clearinghouseState: 2_000,
  spotClearinghouseState: 2_000,
  openOrders: 2_000,
  frontendOpenOrders: 2_000,
  activeAssetData: 2_000,
  orderStatus: 1_000,
  historicalOrders: 5_000,
  userFills: 5_000,
  userFillsByTime: 5_000,
  userFunding: 5_000,
  userNonFundingLedgerUpdates: 5_000,
  extraAgents: 5_000,
  userRateLimit: 10_000,
  userVaultEquities: 10_000,
  portfolio: 30_000,
  subAccounts: 30_000,
  vaultDetails: 30_000,
  delegations: 30_000,
  delegatorSummary: 30_000,
  userFees: 60_000,
  userRole: 60_000,
});

/**
 * A sliding one-minute weight budget in one-second buckets. `tryTake` spends
 * the weight only when the whole request fits; otherwise it returns how many
 * seconds until it would. `charge` records weight that is owed regardless
 * (per-item extras), which may overdraw the budget and delay later requests.
 */
export class WeightBudget {
  private readonly buckets = new Map<number, number>();

  constructor(
    readonly limitPerMinute: number,
    private readonly clock: Clock = systemClock,
    private readonly windowMs = 60_000,
  ) {
    if (!Number.isInteger(limitPerMinute) || limitPerMinute <= 0) throw new TypeError("limitPerMinute must be a positive integer");
  }

  private second(now: number): number {
    return Math.floor(now / 1000);
  }

  /** A bucket leaves the window once its newest possible moment is older than the window (conservative). */
  private expiresAt(second: number): number {
    return (second + 1) * 1000 + this.windowMs;
  }

  private prune(now: number): void {
    for (const second of this.buckets.keys()) {
      if (this.expiresAt(second) <= now) this.buckets.delete(second);
    }
  }

  used(now = this.clock.now()): number {
    this.prune(now);
    let total = 0;
    for (const weight of this.buckets.values()) total += weight;
    return total;
  }

  remaining(now = this.clock.now()): number {
    return Math.max(0, this.limitPerMinute - this.used(now));
  }

  /** Spends `weight` and returns 0, or spends nothing and returns the seconds to wait. */
  tryTake(weight: number, now = this.clock.now()): number {
    const units = Math.max(1, Math.ceil(weight));
    if (units > this.limitPerMinute) return Math.ceil(this.windowMs / 1000);
    let used = this.used(now);
    if (used + units <= this.limitPerMinute) {
      this.add(units, now);
      return 0;
    }
    // Walk the buckets oldest first until enough weight would have expired.
    const seconds = [...this.buckets.keys()].sort((a, b) => a - b);
    for (const second of seconds) {
      used -= this.buckets.get(second) ?? 0;
      if (used + units <= this.limitPerMinute) {
        return Math.max(1, Math.ceil((this.expiresAt(second) - now) / 1000));
      }
    }
    return Math.ceil(this.windowMs / 1000);
  }

  charge(weight: number, now = this.clock.now()): void {
    if (weight > 0) this.add(Math.ceil(weight), now);
  }

  private add(units: number, now: number): void {
    const second = this.second(now);
    this.buckets.set(second, (this.buckets.get(second) ?? 0) + units);
  }

  reset(): void {
    this.buckets.clear();
  }
}
