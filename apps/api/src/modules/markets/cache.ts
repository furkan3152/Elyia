/**
 * Small read-through caches for upstream data that is expensive to fetch
 * (stats-data dumps, account sweeps, reference prices).
 *
 * - A value younger than `ttlMs` is served as is.
 * - An older value triggers one refresh; concurrent callers share it.
 * - When the refresh fails, a value younger than `maxStaleMs` is served with
 *   `stale: true` instead of the error; otherwise the error propagates.
 * - After a failure, callers within `errorBackoffMs` get the stale value (or
 *   the same error) without another upstream attempt.
 */
import type { Clock } from "../../clock.js";

export interface CachedValue<T> {
  readonly value: T;
  readonly fetchedAt: number;
  readonly stale: boolean;
}

export interface RefreshingCacheOptions {
  readonly ttlMs: number;
  readonly maxStaleMs: number;
  readonly clock: Clock;
  readonly errorBackoffMs?: number;
}

export class RefreshingCache<T> {
  private current: { readonly value: T; readonly fetchedAt: number } | null = null;
  private inflight: Promise<{ readonly value: T; readonly fetchedAt: number }> | null = null;
  private failure: { readonly at: number; readonly error: unknown } | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly options: RefreshingCacheOptions,
  ) {}

  /** The cached value without loading (null when never loaded or older than `maxStaleMs`). */
  peek(): CachedValue<T> | null {
    if (!this.current) return null;
    const age = this.options.clock.now() - this.current.fetchedAt;
    if (age >= this.options.maxStaleMs) return null;
    return { ...this.current, stale: age >= this.options.ttlMs };
  }

  async get(): Promise<CachedValue<T>> {
    const now = this.options.clock.now();
    const current = this.current;
    if (current && now - current.fetchedAt < this.options.ttlMs) return { ...current, stale: false };
    const backoff = this.options.errorBackoffMs ?? 0;
    if (this.failure && now - this.failure.at < backoff) return this.staleOr(this.failure.error);
    try {
      const fresh = await this.refresh();
      return { ...fresh, stale: false };
    } catch (error) {
      return this.staleOr(error);
    }
  }

  /** Drops the cached value (tests, forced refresh). */
  clear(): void {
    this.current = null;
    this.failure = null;
  }

  private staleOr(error: unknown): CachedValue<T> {
    const current = this.current;
    if (current && this.options.clock.now() - current.fetchedAt < this.options.maxStaleMs) return { ...current, stale: true };
    throw error;
  }

  private refresh(): Promise<{ readonly value: T; readonly fetchedAt: number }> {
    if (this.inflight) return this.inflight;
    const promise = this.load()
      .then((value) => {
        const entry = { value, fetchedAt: this.options.clock.now() };
        this.current = entry;
        this.failure = null;
        return entry;
      })
      .catch((error: unknown) => {
        this.failure = { at: this.options.clock.now(), error };
        throw error;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = promise;
    return promise;
  }
}

/** RefreshingCache per key, bounded: the least recently used key is evicted beyond `maxEntries`. */
export class RefreshingCacheMap<T> {
  private readonly caches = new Map<string, RefreshingCache<T>>();

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly options: RefreshingCacheOptions & { readonly maxEntries: number },
  ) {}

  get(key: string): Promise<CachedValue<T>> {
    return this.cacheFor(key).get();
  }

  peek(key: string): CachedValue<T> | null {
    return this.caches.get(key)?.peek() ?? null;
  }

  get size(): number {
    return this.caches.size;
  }

  clear(): void {
    this.caches.clear();
  }

  private cacheFor(key: string): RefreshingCache<T> {
    let cache = this.caches.get(key);
    if (cache) {
      // Re-insert: Map keeps insertion order, so the first key is the least recently used.
      this.caches.delete(key);
      this.caches.set(key, cache);
      return cache;
    }
    cache = new RefreshingCache(() => this.load(key), this.options);
    this.caches.set(key, cache);
    while (this.caches.size > this.options.maxEntries) {
      const oldest = this.caches.keys().next().value;
      if (oldest === undefined) break;
      this.caches.delete(oldest);
    }
    return cache;
  }
}
