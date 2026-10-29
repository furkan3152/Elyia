/**
 * Per-connection coalescing for the market stream. Upstream messages are
 * folded into pending state and flushed on a timer:
 *
 * - mids: the latest value per coin, only coins whose mid changed since the
 *   last delivered event;
 * - book: the latest book per coin (an older book is superseded, never sent);
 * - trades: a queue per coin, capped; when a slow client lets it overflow the
 *   oldest prints are dropped and counted (`dropped` event).
 *
 * Every write is `droppable`: while the client is not draining, nothing new
 * is queued in the socket and the pending state keeps only the newest data.
 */
import type { MarketStreamBook, TradeView } from "@elyia/core/api/markets";
import { MARKET_STREAM_EVENTS } from "@elyia/core/api/markets";

export const MAX_QUEUED_TRADES_PER_COIN = 200;

export interface CoalescerSink {
  readonly closed: boolean;
  /** False when the event was not written (client not draining, or closed). */
  send(event: string, data: unknown): boolean;
}

export class StreamCoalescer {
  private readonly pendingMids = new Map<string, string>();
  private readonly sentMids = new Map<string, string>();
  private readonly pendingBooks = new Map<string, MarketStreamBook>();
  private readonly pendingTrades = new Map<string, TradeView[]>();
  private droppedTrades = 0;

  constructor(
    private readonly now: () => number,
    private readonly maxQueuedTradesPerCoin = MAX_QUEUED_TRADES_PER_COIN,
  ) {}

  /** Folds a mids update; only `coins` are kept, and only values that differ from the last delivered ones. */
  pushMids(mids: Readonly<Record<string, string>>, coins: ReadonlySet<string>): void {
    for (const coin of coins) {
      const mid = mids[coin];
      if (mid === undefined) continue;
      if (this.sentMids.get(coin) === mid) this.pendingMids.delete(coin);
      else this.pendingMids.set(coin, mid);
    }
  }

  pushBook(book: MarketStreamBook): void {
    this.pendingBooks.set(book.coin, book);
  }

  pushTrades(coin: string, trades: readonly TradeView[]): void {
    if (trades.length === 0) return;
    const queue = this.pendingTrades.get(coin) ?? [];
    queue.push(...trades);
    const overflow = queue.length - this.maxQueuedTradesPerCoin;
    if (overflow > 0) {
      queue.splice(0, overflow);
      this.droppedTrades += overflow;
    }
    this.pendingTrades.set(coin, queue);
  }

  get pending(): { readonly mids: number; readonly books: number; readonly trades: number; readonly dropped: number } {
    let trades = 0;
    for (const queue of this.pendingTrades.values()) trades += queue.length;
    return { mids: this.pendingMids.size, books: this.pendingBooks.size, trades, dropped: this.droppedTrades };
  }

  /** Writes what is pending; anything the sink refuses stays pending (superseded by newer data). */
  flush(sink: CoalescerSink): void {
    if (sink.closed) return;
    if (this.pendingMids.size > 0) {
      const mids = Object.fromEntries(this.pendingMids);
      if (sink.send(MARKET_STREAM_EVENTS.mids, { time: this.now(), mids })) {
        for (const [coin, mid] of this.pendingMids) this.sentMids.set(coin, mid);
        this.pendingMids.clear();
      }
    }
    for (const [coin, book] of [...this.pendingBooks]) {
      if (sink.closed || !sink.send(MARKET_STREAM_EVENTS.book, book)) break;
      this.pendingBooks.delete(coin);
    }
    for (const [coin, trades] of [...this.pendingTrades]) {
      if (sink.closed || !sink.send(MARKET_STREAM_EVENTS.trades, { coin, trades })) break;
      this.pendingTrades.delete(coin);
    }
    if (this.droppedTrades > 0 && !sink.closed && sink.send(MARKET_STREAM_EVENTS.dropped, { trades: this.droppedTrades })) {
      this.droppedTrades = 0;
    }
  }
}
