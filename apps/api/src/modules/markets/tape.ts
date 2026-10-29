/**
 * Trade tape: recent prints per coin from the shared Hyperliquid WebSocket.
 *
 * The first request for a coin seeds a ring buffer from `recentTrades` (one
 * REST call) and subscribes to the coin's `trades` channel; later requests
 * read the buffer at no REST weight. A coin nobody asked for during
 * `idleMs` is unsubscribed. Beyond `maxCoins` taped coins, requests fall back
 * to the REST snapshot (cached by the info client).
 */
import type { TradeView } from "@elyia/core/api/markets";
import type { RecentTrade } from "@elyia/core/hypercore/info";
import type { HyperliquidInfoClient } from "../../hyperliquid/info.js";
import type { HyperliquidWs } from "../../hyperliquid/ws.js";
import type { Logger } from "../../log.js";
import { tradeView } from "./book.js";

export const TAPE_CAPACITY = 200;
export const TAPE_IDLE_MS = 5 * 60_000;
export const TAPE_MAX_COINS = 40;

/** Newest-first ring of trades, deduplicated by trade id. */
export class TradeRing {
  private readonly trades: TradeView[] = [];
  private readonly seen = new Set<number>();

  constructor(private readonly capacity = TAPE_CAPACITY) {}

  /** Adds prints in any order; returns how many were new. */
  add(prints: readonly TradeView[]): number {
    let added = 0;
    for (const print of prints) {
      if (this.seen.has(print.tid)) continue;
      this.seen.add(print.tid);
      this.trades.push(print);
      added += 1;
    }
    if (added > 0) {
      this.trades.sort((a, b) => b.time - a.time || b.tid - a.tid);
      for (const dropped of this.trades.splice(this.capacity)) this.seen.delete(dropped.tid);
    }
    return added;
  }

  latest(limit: number): TradeView[] {
    return this.trades.slice(0, Math.max(0, limit));
  }

  get size(): number {
    return this.trades.length;
  }
}

interface TapeEntry {
  readonly ring: TradeRing;
  readonly unsubscribe: () => void;
  readonly seeded: Promise<void>;
  lastUsed: number;
}

export interface TradeTapeDeps {
  readonly info: () => HyperliquidInfoClient;
  readonly ws: () => HyperliquidWs;
  readonly now: () => number;
  readonly log?: Logger;
  readonly idleMs?: number;
  readonly maxCoins?: number;
  readonly capacity?: number;
}

export class TradeTape {
  private readonly entries = new Map<string, TapeEntry>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly deps: TradeTapeDeps) {}

  /** Newest first. `coin` must already be validated against the market catalog. */
  async recent(coin: string, limit: number): Promise<{ readonly trades: TradeView[]; readonly source: "tape" | "info" }> {
    const entry = this.entries.get(coin) ?? this.open(coin);
    if (!entry) {
      const trades = await this.deps.info().recentTrades(coin);
      return { trades: [...trades].map(tradeView).sort((a, b) => b.time - a.time || b.tid - a.tid).slice(0, limit), source: "info" };
    }
    entry.lastUsed = this.deps.now();
    await entry.seeded;
    return { trades: entry.ring.latest(limit), source: "tape" };
  }

  get coins(): number {
    return this.entries.size;
  }

  close(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const entry of this.entries.values()) entry.unsubscribe();
    this.entries.clear();
  }

  private open(coin: string): TapeEntry | null {
    if (this.entries.size >= (this.deps.maxCoins ?? TAPE_MAX_COINS)) return null;
    const ring = new TradeRing(this.deps.capacity ?? TAPE_CAPACITY);
    let unsubscribe: () => void;
    try {
      unsubscribe = this.deps.ws().subscribe({ type: "trades", coin }, (prints) => {
        ring.add(prints.map(tradeView));
      });
    } catch (error) {
      this.deps.log?.warn("trade tape subscribe failed", { coin, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
    const seeded = this.deps
      .info()
      .recentTrades(coin)
      .then((trades: readonly RecentTrade[]) => {
        ring.add(trades.map(tradeView));
      })
      .catch((error: unknown) => {
        // The live feed still fills the ring; the first answer is just shorter.
        this.deps.log?.warn("trade tape seed failed", { coin, error: error instanceof Error ? error.message : String(error) });
      });
    const entry: TapeEntry = { ring, unsubscribe, seeded, lastUsed: this.deps.now() };
    this.entries.set(coin, entry);
    this.ensureSweeper();
    return entry;
  }

  /** Unsubscribes coins idle for longer than `idleMs` (also callable directly in tests). */
  sweep(): void {
    const idleMs = this.deps.idleMs ?? TAPE_IDLE_MS;
    const now = this.deps.now();
    for (const [coin, entry] of this.entries) {
      if (now - entry.lastUsed < idleMs) continue;
      entry.unsubscribe();
      this.entries.delete(coin);
    }
    if (this.entries.size === 0 && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), Math.max(1_000, Math.floor((this.deps.idleMs ?? TAPE_IDLE_MS) / 4)));
    this.sweeper.unref();
  }
}
