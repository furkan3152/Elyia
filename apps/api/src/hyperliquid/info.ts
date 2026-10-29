/**
 * Hyperliquid `/info` client for one HyperCore network.
 *
 * - POST JSON with a timeout; up to 2 retries on 5xx, 429 and network errors
 *   with backoff (a short Retry-After is honored). Timeouts are not retried:
 *   the caller would wait too long.
 * - Every attempt spends its weight from the shared WeightBudget first; when
 *   the budget is spent the request is refused before it is sent
 *   (503 PROVIDER_RATE_LIMITED with Retry-After).
 * - Successful responses are cached per request type (INFO_CACHE_MS), and
 *   concurrent identical requests share one upstream call.
 * - Cached values are shared between callers: treat them as read-only.
 *
 * Errors: 429 after retries -> PROVIDER_RATE_LIMITED (503); 5xx/network ->
 * HYPERLIQUID_UNAVAILABLE (502); timeout -> UPSTREAM_TIMEOUT (504); other
 * 4xx (HL could not parse the request) -> HYPERLIQUID_REJECTED (422).
 */
import type { HyperCoreNetwork } from "@elyia/core";
import type { Clock } from "../clock.js";
import { sleep, systemClock } from "../clock.js";
import { ElyiaHttpError, providerRateLimited, sanitizeUpstreamMessage, upstreamTimeout } from "../http/errors.js";
import type { Logger } from "../log.js";
import type {
  ActiveAssetData,
  AllMids,
  Candle,
  CandleInterval,
  ClearinghouseState,
  Cloid,
  Delegation,
  DelegatorSummary,
  ExchangeStatus,
  ExtraAgent,
  FrontendOpenOrder,
  FundingRecord,
  HistoricalOrder,
  InfoRequest,
  InfoRequestType,
  L2Book,
  LedgerUpdate,
  MetaAndAssetCtxs,
  OpenOrder,
  OrderStatusResponse,
  PerpDex,
  PerpMeta,
  Portfolio,
  PredictedFundings,
  RecentTrade,
  SpotClearinghouseState,
  SpotMeta,
  SpotMetaAndAssetCtxs,
  UserFill,
  UserFundingEntry,
  UserRateLimit,
  UserRole,
  UserVaultEquity,
  VaultDetails,
} from "./types.js";
import { INFO_CACHE_MS, infoWeight, responseWeight, WeightBudget } from "./weights.js";

export const INFO_TIMEOUT_MS = 5_000;
export const INFO_RETRIES = 2;
const RETRY_DELAYS_MS = [250, 750] as const;
const MAX_RETRY_AFTER_WAIT_MS = 2_000;
const MAX_CACHE_ENTRIES = 2_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface InfoClientOptions {
  readonly network: HyperCoreNetwork;
  readonly budget: WeightBudget;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly log?: Logger;
  readonly timeoutMs?: number;
  readonly retries?: number;
  /** Waits between retries (tests pass a no-op). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  /** Overrides the per-type cache TTL; 0 skips the cache (still deduplicated in flight). */
  readonly cacheMs?: number;
}

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/** Canonical JSON (sorted keys) so equal requests share a cache entry. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{1,6}$/u.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

class RetryableUpstream extends Error {
  constructor(
    readonly kind: "rate_limited" | "unavailable",
    readonly retryAfterMs: number | null,
  ) {
    super(kind);
  }
}

export class HyperliquidInfoClient {
  readonly network: HyperCoreNetwork;
  private readonly budget: WeightBudget;
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly log: Logger | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private upstreamCalls = 0;

  constructor(options: InfoClientOptions) {
    this.network = options.network;
    this.budget = options.budget;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.clock = options.clock ?? systemClock;
    this.log = options.log;
    this.timeoutMs = options.timeoutMs ?? INFO_TIMEOUT_MS;
    this.retries = options.retries ?? INFO_RETRIES;
    this.wait = options.sleep ?? ((ms) => sleep(ms));
  }

  /** Upstream HTTP attempts made so far (diagnostics, tests). */
  get calls(): number {
    return this.upstreamCalls;
  }

  get remainingWeight(): number {
    return this.budget.remaining();
  }

  /** Any info request: cached per type, deduplicated in flight, weight-budgeted. */
  async request<T>(body: InfoRequest, options: RequestOptions = {}): Promise<T> {
    const key = canonicalJson(body);
    const ttl = options.cacheMs ?? INFO_CACHE_MS[body.type] ?? 0;
    if (ttl > 0) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > this.clock.now()) return cached.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const promise = this.fetchWithRetry(body)
      .then((value) => {
        if (ttl > 0) this.remember(key, value, ttl);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise as Promise<T>;
  }

  private remember(key: string, value: unknown, ttl: number): void {
    const now = this.clock.now();
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: now + ttl });
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      for (const [entryKey, entry] of this.cache) {
        if (entry.expiresAt <= now) this.cache.delete(entryKey);
      }
      // Still too many live entries: evict the oldest insertions.
      while (this.cache.size > MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private spend(type: InfoRequestType): void {
    const waitSeconds = this.budget.tryTake(infoWeight(type));
    if (waitSeconds > 0) throw providerRateLimited("Hyperliquid", waitSeconds);
  }

  private async fetchWithRetry(body: InfoRequest): Promise<unknown> {
    let lastRetryable: RetryableUpstream | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) {
        const base = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 750;
        const asked = lastRetryable?.retryAfterMs ?? null;
        if (asked !== null && asked > MAX_RETRY_AFTER_WAIT_MS) break;
        await this.wait(Math.max(base, asked ?? 0));
      }
      this.spend(body.type);
      try {
        return await this.attempt(body);
      } catch (error) {
        if (!(error instanceof RetryableUpstream)) throw error;
        lastRetryable = error;
      }
    }
    if (lastRetryable?.kind === "rate_limited") {
      this.log?.warn("hyperliquid rate limited", { network: this.network.key, type: body.type });
      throw providerRateLimited("Hyperliquid", (lastRetryable.retryAfterMs ?? 2_000) / 1000);
    }
    this.log?.warn("hyperliquid unavailable", { network: this.network.key, type: body.type });
    throw new ElyiaHttpError("HYPERLIQUID_UNAVAILABLE", 502, "Hyperliquid is not answering right now. Try again shortly.", {
      network: this.network.key,
    });
  }

  private async attempt(body: InfoRequest): Promise<unknown> {
    this.upstreamCalls += 1;
    let response: Response;
    try {
      response = await this.fetchImpl(this.network.infoUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw upstreamTimeout("Hyperliquid");
      // DNS, reset, refused: transient transport failures.
      throw new RetryableUpstream("unavailable", null);
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      throw new RetryableUpstream("rate_limited", parseRetryAfterMs(response.headers.get("retry-after")));
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new RetryableUpstream("unavailable", null);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ElyiaHttpError("HYPERLIQUID_REJECTED", 422, `Hyperliquid rejected the request: ${sanitizeUpstreamMessage(text) || `HTTP ${response.status}`}`, {
        network: this.network.key,
        type: body.type,
      });
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw upstreamTimeout("Hyperliquid");
      throw new RetryableUpstream("unavailable", null);
    }
    this.budget.charge(responseWeight(body.type, value));
    return value;
  }

  /* ------------------------------------------------------ market data */

  meta(dex?: string): Promise<PerpMeta> {
    return this.request({ type: "meta", ...(dex ? { dex } : {}) });
  }

  metaAndAssetCtxs(dex?: string): Promise<MetaAndAssetCtxs> {
    return this.request({ type: "metaAndAssetCtxs", ...(dex ? { dex } : {}) });
  }

  spotMeta(): Promise<SpotMeta> {
    return this.request({ type: "spotMeta" });
  }

  spotMetaAndAssetCtxs(): Promise<SpotMetaAndAssetCtxs> {
    return this.request({ type: "spotMetaAndAssetCtxs" });
  }

  perpDexs(): Promise<ReadonlyArray<PerpDex | null>> {
    return this.request({ type: "perpDexs" });
  }

  allMids(dex?: string): Promise<AllMids> {
    return this.request({ type: "allMids", ...(dex ? { dex } : {}) });
  }

  l2Book(coin: string, options: { nSigFigs?: 2 | 3 | 4 | 5 | null; mantissa?: 1 | 2 | 5 | null } = {}): Promise<L2Book | null> {
    return this.request({ type: "l2Book", coin, ...options });
  }

  recentTrades(coin: string): Promise<readonly RecentTrade[]> {
    return this.request({ type: "recentTrades", coin });
  }

  candleSnapshot(coin: string, interval: CandleInterval, startTime: number, endTime?: number): Promise<readonly Candle[]> {
    return this.request({ type: "candleSnapshot", req: { coin, interval, startTime, ...(endTime !== undefined ? { endTime } : {}) } });
  }

  fundingHistory(coin: string, startTime: number, endTime?: number): Promise<readonly FundingRecord[]> {
    return this.request({ type: "fundingHistory", coin, startTime, ...(endTime !== undefined ? { endTime } : {}) });
  }

  predictedFundings(): Promise<PredictedFundings> {
    return this.request({ type: "predictedFundings" });
  }

  exchangeStatus(options?: RequestOptions): Promise<ExchangeStatus> {
    return this.request({ type: "exchangeStatus" }, options);
  }

  /* ---------------------------------------------------- user state */

  clearinghouseState(user: string, dex?: string): Promise<ClearinghouseState> {
    return this.request({ type: "clearinghouseState", user, ...(dex ? { dex } : {}) });
  }

  spotClearinghouseState(user: string): Promise<SpotClearinghouseState> {
    return this.request({ type: "spotClearinghouseState", user });
  }

  openOrders(user: string, dex?: string): Promise<readonly OpenOrder[]> {
    return this.request({ type: "openOrders", user, ...(dex ? { dex } : {}) });
  }

  frontendOpenOrders(user: string, dex?: string): Promise<readonly FrontendOpenOrder[]> {
    return this.request({ type: "frontendOpenOrders", user, ...(dex ? { dex } : {}) });
  }

  historicalOrders(user: string): Promise<readonly HistoricalOrder[]> {
    return this.request({ type: "historicalOrders", user });
  }

  userFills(user: string, aggregateByTime?: boolean): Promise<readonly UserFill[]> {
    return this.request({ type: "userFills", user, ...(aggregateByTime !== undefined ? { aggregateByTime } : {}) });
  }

  userFillsByTime(user: string, startTime: number, endTime?: number, aggregateByTime?: boolean): Promise<readonly UserFill[]> {
    return this.request({
      type: "userFillsByTime",
      user,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
      ...(aggregateByTime !== undefined ? { aggregateByTime } : {}),
    });
  }

  /** `oid` is an order id or a `0x…` client order id. */
  orderStatus(user: string, oid: number | Cloid): Promise<OrderStatusResponse> {
    return this.request({ type: "orderStatus", user, oid });
  }

  userFunding(user: string, startTime: number, endTime?: number): Promise<readonly UserFundingEntry[]> {
    return this.request({ type: "userFunding", user, startTime, ...(endTime !== undefined ? { endTime } : {}) });
  }

  userNonFundingLedgerUpdates(user: string, startTime: number, endTime?: number): Promise<readonly LedgerUpdate[]> {
    return this.request({ type: "userNonFundingLedgerUpdates", user, startTime, ...(endTime !== undefined ? { endTime } : {}) });
  }

  portfolio(user: string): Promise<Portfolio> {
    return this.request({ type: "portfolio", user });
  }

  userRateLimit(user: string): Promise<UserRateLimit> {
    return this.request({ type: "userRateLimit", user });
  }

  /** Fee schedule and volume tiers; the shape changes with HL fee programs, so it stays untyped. */
  userFees(user: string): Promise<Readonly<Record<string, unknown>>> {
    return this.request({ type: "userFees", user });
  }

  userRole(user: string): Promise<UserRole> {
    return this.request({ type: "userRole", user });
  }

  /** Approved API agents of a user (with expiry). */
  extraAgents(user: string): Promise<readonly ExtraAgent[]> {
    return this.request({ type: "extraAgents", user });
  }

  subAccounts(user: string): Promise<ReadonlyArray<Readonly<Record<string, unknown>>> | null> {
    return this.request({ type: "subAccounts", user });
  }

  userVaultEquities(user: string): Promise<readonly UserVaultEquity[]> {
    return this.request({ type: "userVaultEquities", user });
  }

  vaultDetails(vaultAddress: string, user?: string): Promise<VaultDetails | null> {
    return this.request({ type: "vaultDetails", vaultAddress, ...(user ? { user } : {}) });
  }

  delegations(user: string): Promise<readonly Delegation[]> {
    return this.request({ type: "delegations", user });
  }

  delegatorSummary(user: string): Promise<DelegatorSummary> {
    return this.request({ type: "delegatorSummary", user });
  }

  activeAssetData(user: string, coin: string): Promise<ActiveAssetData> {
    return this.request({ type: "activeAssetData", user, coin });
  }
}
