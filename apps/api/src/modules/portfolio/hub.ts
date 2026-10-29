/**
 * Live portfolio fan-out. One refresh loop per (mode, address), shared by
 * every connection watching it:
 *
 * - The first listener starts the loop; a new listener gets the last
 *   snapshot at once. The loop stops `idleMs` after the last listener left.
 * - Every refresh compares a digest of the content (timestamps excluded):
 *   a change publishes `snapshot` with the next `seq`, no change publishes
 *   `unchanged` (diff-friendly: clients keep the last snapshot).
 * - Interval: BASE_INTERVAL_MS, stretched when many addresses are watched so
 *   the loops together stay inside STREAM_WEIGHT_PER_MINUTE of HyperCore
 *   REST weight; a refresh is skipped (and marked stale) when the shared
 *   budget is below RESERVE_WEIGHT.
 * - At most MAX_ADDRESSES watched addresses per process (503 beyond).
 */
import { canonicalDigest } from "@elyia/core";
import type { PortfolioMode, PortfolioSnapshot, PortfolioStreamError, PortfolioStreamSnapshot, PortfolioStreamUnchanged } from "@elyia/core/api/portfolio";
import { ElyiaHttpError, isElyiaHttpError, retryAfterHeader } from "../../http/errors.js";
import type { Logger } from "../../log.js";

export const BASE_INTERVAL_MS = 4_000;
/** Approximate weight of one refresh: perps (2) + spot (2) + a HIP-3 dex or two, plus the amortized slow parts. */
export const WEIGHT_PER_REFRESH = 8;
export const STREAM_WEIGHT_PER_MINUTE = 300;
export const RESERVE_WEIGHT = 200;
export const MAX_ADDRESSES = 25;
export const IDLE_MS = 5_000;

export type HubEvent =
  | { readonly type: "snapshot"; readonly payload: PortfolioStreamSnapshot }
  | { readonly type: "unchanged"; readonly payload: PortfolioStreamUnchanged }
  | { readonly type: "error"; readonly payload: PortfolioStreamError };

export type HubListener = (event: HubEvent) => void;

export interface PortfolioHubOptions {
  readonly load: (address: string, mode: PortfolioMode) => Promise<PortfolioSnapshot>;
  readonly now: () => number;
  /** REST weight left in the shared budget of the mode's HyperCore network. */
  readonly remainingWeight?: (mode: PortfolioMode) => number;
  readonly log?: Logger;
  readonly baseIntervalMs?: number;
  readonly weightPerRefresh?: number;
  readonly weightPerMinute?: number;
  readonly reserveWeight?: number;
  readonly maxAddresses?: number;
  readonly idleMs?: number;
}

interface Channel {
  readonly key: string;
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly listeners: Set<HubListener>;
  seq: number;
  digest: string;
  last: PortfolioStreamSnapshot | null;
  stale: boolean;
  timer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  refreshing: boolean;
  closed: boolean;
}

/** Digest of a snapshot's content: timestamps that change on every read are left out. */
export function snapshotDigest(snapshot: PortfolioSnapshot): string {
  return canonicalDigest({
    ...snapshot,
    generatedAt: 0,
    pricing: { ...snapshot.pricing, time: 0 },
    accounts: snapshot.accounts.map((account) => ({ ...account, time: 0 })),
  });
}

export class PortfolioHub {
  private readonly channels = new Map<string, Channel>();

  constructor(private readonly options: PortfolioHubOptions) {}

  get size(): number {
    return this.channels.size;
  }

  /** Current refresh interval for `mode`, stretched with the number of watched addresses. */
  intervalMs(mode: PortfolioMode): number {
    const watched = [...this.channels.values()].filter((channel) => channel.mode === mode).length;
    const budget = this.options.weightPerMinute ?? STREAM_WEIGHT_PER_MINUTE;
    const perRefresh = this.options.weightPerRefresh ?? WEIGHT_PER_REFRESH;
    return Math.max(this.options.baseIntervalMs ?? BASE_INTERVAL_MS, Math.ceil((watched * perRefresh * 60_000) / budget));
  }

  /** Throws 503 STREAM_CAPACITY when watching one more address would exceed the cap. */
  assertCapacity(address: string, mode: PortfolioMode): void {
    if (this.channels.has(`${mode}|${address}`) || this.channels.size < (this.options.maxAddresses ?? MAX_ADDRESSES)) return;
    throw new ElyiaHttpError("STREAM_CAPACITY", 503, "Too many portfolios are being watched live right now. Use GET /v1/portfolio/:address or retry shortly.", undefined, {
      headers: retryAfterHeader(30),
    });
  }

  /** Adds a listener; returns its idempotent unsubscribe. 503 STREAM_CAPACITY when too many addresses are watched. */
  subscribe(address: string, mode: PortfolioMode, listener: HubListener): () => void {
    const key = `${mode}|${address}`;
    let channel = this.channels.get(key);
    if (!channel) {
      this.assertCapacity(address, mode);
      channel = { key, address, mode, listeners: new Set(), seq: 0, digest: "", last: null, stale: false, timer: null, idleTimer: null, refreshing: false, closed: false };
      this.channels.set(key, channel);
    }
    const current = channel;
    if (current.idleTimer) clearTimeout(current.idleTimer);
    current.idleTimer = null;
    current.listeners.add(listener);
    if (current.last) {
      const last = current.last;
      queueMicrotask(() => {
        if (current.listeners.has(listener)) this.deliver(listener, { type: "snapshot", payload: last });
      });
    }
    if (!current.timer && !current.refreshing) void this.refresh(current);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      current.listeners.delete(listener);
      if (current.listeners.size > 0 || current.idleTimer) return;
      current.idleTimer = setTimeout(() => {
        current.idleTimer = null;
        if (current.listeners.size === 0) this.stop(current);
      }, this.options.idleMs ?? IDLE_MS);
      current.idleTimer.unref();
    };
  }

  close(): void {
    for (const channel of [...this.channels.values()]) this.stop(channel);
  }

  private stop(channel: Channel): void {
    channel.closed = true;
    if (channel.timer) clearTimeout(channel.timer);
    if (channel.idleTimer) clearTimeout(channel.idleTimer);
    channel.timer = null;
    channel.idleTimer = null;
    channel.listeners.clear();
    if (this.channels.get(channel.key) === channel) this.channels.delete(channel.key);
  }

  private emit(channel: Channel, event: HubEvent): void {
    for (const listener of [...channel.listeners]) this.deliver(listener, event);
  }

  private deliver(listener: HubListener, event: HubEvent): void {
    try {
      listener(event);
    } catch (error) {
      this.options.log?.error("portfolio stream listener failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private schedule(channel: Channel): void {
    if (channel.closed || channel.listeners.size === 0) return;
    channel.timer = setTimeout(() => {
      channel.timer = null;
      void this.refresh(channel);
    }, this.intervalMs(channel.mode));
    channel.timer.unref();
  }

  private async refresh(channel: Channel): Promise<void> {
    if (channel.closed || channel.refreshing) return;
    channel.refreshing = true;
    try {
      const remaining = this.options.remainingWeight?.(channel.mode);
      if (channel.last && remaining !== undefined && remaining < (this.options.reserveWeight ?? RESERVE_WEIGHT)) {
        channel.stale = true;
        this.emit(channel, { type: "unchanged", payload: { seq: channel.seq, digest: channel.digest, checkedAt: this.options.now(), stale: true } });
        return;
      }
      const snapshot = await this.options.load(channel.address, channel.mode);
      if (channel.closed) return;
      const digest = snapshotDigest(snapshot);
      channel.stale = false;
      if (digest !== channel.digest || !channel.last) {
        channel.seq += 1;
        channel.digest = digest;
        channel.last = { seq: channel.seq, digest, snapshot, stale: false, intervalMs: this.intervalMs(channel.mode) };
        this.emit(channel, { type: "snapshot", payload: channel.last });
      } else {
        this.emit(channel, { type: "unchanged", payload: { seq: channel.seq, digest, checkedAt: snapshot.generatedAt, stale: false } });
      }
    } catch (error) {
      channel.stale = true;
      const payload: PortfolioStreamError = isElyiaHttpError(error)
        ? { code: error.code, message: error.message }
        : { code: "PORTFOLIO_REFRESH_FAILED", message: "The portfolio could not be refreshed; retrying." };
      this.emit(channel, { type: "error", payload });
    } finally {
      channel.refreshing = false;
      this.schedule(channel);
    }
  }
}
