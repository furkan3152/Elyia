/**
 * Browser client for HyperCore's info API (`POST {apiUrl}/info`).
 *
 * - Cache: each request type has a time to live (meta for minutes, account
 *   reads for a few seconds); a fresh cached answer costs nothing.
 * - In-flight de-duplication: identical requests share one fetch, so ten
 *   components asking for `metaAndAssetCtxs` at mount make one call.
 * - Transient failures (429, 5xx, network) are retried once after a short
 *   backoff; a 429 also empties the local bucket so the queue slows down.
 * - A modest rate: HyperCore allows 1200 request weight per minute per IP
 *   (l2Book, allMids, clearinghouseState... weigh 2, userRole 60, most others
 *   20). This browser spends at most `budgetPerMinute` (default 800) through
 *   a token bucket and queues the rest; a request that would wait longer than
 *   `maxQueueMs` fails with a plain-words error instead of piling up.
 *
 * Pure enough for node tests: `fetch` and the clock are injectable.
 */

export interface InfoBody {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type InfoErrorCode = "HTTP" | "RATE_LIMITED" | "LOCAL_BUDGET" | "TIMEOUT" | "NETWORK" | "BAD_RESPONSE" | "ABORTED";

export class InfoError extends Error {
  readonly code: InfoErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: InfoErrorCode, message: string, options: { readonly status?: number | null; readonly retryable?: boolean } = {}) {
    super(message);
    this.name = "InfoError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? (code !== "BAD_RESPONSE" && code !== "ABORTED");
  }
}

const LIGHT_TYPES = new Set(["l2Book", "allMids", "clearinghouseState", "orderStatus", "spotClearinghouseState", "exchangeStatus"]);

/** HyperCore's rate-limit weight of one info request (base weight; per-item surcharges are approximated for big lists). */
export function infoWeight(body: InfoBody): number {
  if (LIGHT_TYPES.has(body.type)) return 2;
  if (body.type === "userRole") return 60;
  // candleSnapshot adds 1 per 60 candles; the terminal asks for at most ~500.
  if (body.type === "candleSnapshot") return 28;
  // Fill and order histories add 1 per 20 items (up to 2000 items).
  if (body.type === "userFills" || body.type === "historicalOrders" || body.type === "userFillsByTime") return 40;
  return 20;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** How long an answer of this type stays fresh in the cache. */
export function cacheTtlMs(body: InfoBody): number {
  switch (body.type) {
    case "meta":
    case "spotMeta":
    case "perpDexs":
    case "allPerpMetas":
      return 10 * MINUTE;
    case "userFees":
      return 5 * MINUTE;
    case "metaAndAssetCtxs":
    case "spotMetaAndAssetCtxs":
      return 8 * SECOND;
    case "candleSnapshot":
      return 15 * SECOND;
    case "extraAgents":
    case "userRole":
    case "orderStatus":
      return 0;
    default:
      return 3 * SECOND;
  }
}

/** Stable cache key: the JSON of the body with keys sorted. */
export function infoKey(body: InfoBody): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
          .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(body));
}

export interface InfoClientOptions {
  readonly url: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Weight this browser may spend per minute (HyperCore allows 1200 per IP). */
  readonly budgetPerMinute?: number;
  /** Longest a request may wait for budget before failing. */
  readonly maxQueueMs?: number;
  readonly timeoutMs?: number;
  /** Test hook: how the client waits for budget. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxCacheEntries?: number;
  /** Extra attempts after a retryable failure (429, 5xx, network); default 1. */
  readonly retries?: number;
  /** First retry delay; doubles per attempt (default 600 ms). */
  readonly retryBaseMs?: number;
}

export interface InfoRequestOptions {
  /** Overrides the type's default time to live; 0 disables the cache for this call. */
  readonly ttlMs?: number;
  /** Ignore a fresh cached answer (still de-duplicated with an identical request in flight). */
  readonly force?: boolean;
  readonly signal?: AbortSignal;
}

interface CacheEntry {
  readonly value: unknown;
  readonly at: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class InfoClient {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly budget: number;
  private readonly maxQueueMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxCacheEntries: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private tokens: number;
  private refilledAt: number;
  /** Requests waiting for budget run in arrival order. */
  private queue: Promise<void> = Promise.resolve();
  private queuedWeight = 0;

  constructor(options: InfoClientOptions) {
    this.url = options.url;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.budget = Math.max(20, options.budgetPerMinute ?? 800);
    this.maxQueueMs = options.maxQueueMs ?? 12 * SECOND;
    this.timeoutMs = options.timeoutMs ?? 10 * SECOND;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxCacheEntries = options.maxCacheEntries ?? 200;
    this.retries = Math.max(0, options.retries ?? 1);
    this.retryBaseMs = options.retryBaseMs ?? 600;
    this.tokens = this.budget;
    this.refilledAt = this.now();
  }

  /** A cached answer when still fresh, else undefined (does not fetch). */
  peek<T>(body: InfoBody, ttlMs: number = cacheTtlMs(body)): T | undefined {
    const entry = this.cache.get(infoKey(body));
    if (!entry || this.now() - entry.at > ttlMs) return undefined;
    return entry.value as T;
  }

  /** Forget cached answers (all, or those whose body matches). */
  invalidate(match?: (body: InfoBody) => boolean): void {
    if (!match) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      try {
        if (match(JSON.parse(key) as InfoBody)) this.cache.delete(key);
      } catch {
        this.cache.delete(key);
      }
    }
  }

  async post<T>(body: InfoBody, options: InfoRequestOptions = {}): Promise<T> {
    const key = infoKey(body);
    const ttl = options.ttlMs ?? cacheTtlMs(body);
    if (!options.force && ttl > 0) {
      const entry = this.cache.get(key);
      if (entry && this.now() - entry.at <= ttl) return entry.value as T;
    }
    let shared = this.inFlight.get(key);
    if (!shared) {
      shared = this.fetchFresh(body, key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, shared);
    }
    if (!options.signal) return (await shared) as T;
    return (await abortable(shared, options.signal)) as T;
  }

  /** Weight available right now (for diagnostics and tests). */
  availableWeight(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.refilledAt);
    this.refilledAt = now;
    this.tokens = Math.min(this.budget, this.tokens + (elapsed * this.budget) / MINUTE);
  }

  private acquire(weight: number): Promise<void> {
    this.refill();
    // Expected wait if everything already queued is served first.
    const deficit = this.queuedWeight + weight - this.tokens;
    const waitMs = deficit > 0 ? (deficit * MINUTE) / this.budget : 0;
    if (waitMs > this.maxQueueMs) {
      return Promise.reject(new InfoError("LOCAL_BUDGET", "Elyia is pacing its HyperCore requests to stay under the rate limit. Try again in a few seconds."));
    }
    this.queuedWeight += weight;
    const turn = this.queue.then(async () => {
      this.refill();
      if (this.tokens < weight) await this.sleep(((weight - this.tokens) * MINUTE) / this.budget);
      this.refill();
      this.tokens -= weight;
      this.queuedWeight -= weight;
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /** One logical request: paced attempts, retried with backoff while the failure is transient. */
  private async fetchFresh(body: InfoBody, key: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt(body, key);
      } catch (error) {
        const transient = error instanceof InfoError && error.retryable && error.code !== "LOCAL_BUDGET" && error.code !== "TIMEOUT";
        if (!transient || attempt >= this.retries) throw error;
        // A 429 means the IP budget is spent: also drain the local bucket so queued requests slow down.
        if (error.code === "RATE_LIMITED") this.tokens = Math.min(this.tokens, 0);
        await this.sleep(this.retryBaseMs * 2 ** attempt);
      }
    }
  }

  private async attempt(body: InfoBody, key: string): Promise<unknown> {
    await this.acquire(infoWeight(body));
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      if (controller?.signal.aborted) throw new InfoError("TIMEOUT", "HyperCore did not answer in time. Check your connection and try again.");
      throw new InfoError("NETWORK", "Could not reach HyperCore. Check your connection.", { retryable: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (response.status === 429) throw new InfoError("RATE_LIMITED", "HyperCore is rate limiting this connection. Wait a few seconds; Elyia slows its requests down.", { status: 429, retryable: true });
    if (!response.ok) {
      throw new InfoError("HTTP", `HyperCore answered ${response.status}${response.status >= 500 ? "; it should recover shortly" : ""}.`, { status: response.status, retryable: response.status >= 500 });
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new InfoError("BAD_RESPONSE", "HyperCore sent an unreadable answer.");
    }
    this.store(key, value);
    return value;
  }

  private store(key: string, value: unknown): void {
    this.cache.delete(key);
    this.cache.set(key, { value, at: this.now() });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new InfoError("ABORTED", "Request cancelled."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new InfoError("ABORTED", "Request cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
