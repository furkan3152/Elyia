/** Pure order-book and trade shaping. */
import type { BookLevelView, TradeView } from "@elyia/core/api/markets";
import type { BookLevel, L2Book, RecentTrade } from "@elyia/core/hypercore/info";
import { round, toNumber } from "./num.js";

export const MAX_BOOK_DEPTH = 20;

export function levelsView(levels: readonly BookLevel[], depth: number): BookLevelView[] {
  let cumulative = 0;
  return levels.slice(0, depth).map((level) => {
    cumulative += toNumber(level.sz) ?? 0;
    return { px: level.px, sz: level.sz, n: level.n, cumSz: round(cumulative, 10) };
  });
}

export interface BookSummary {
  readonly bids: readonly BookLevelView[];
  readonly asks: readonly BookLevelView[];
  readonly bestBid: string | null;
  readonly bestAsk: string | null;
  readonly mid: number | null;
  readonly spread: number | null;
  readonly spreadBps: number | null;
}

export function summarizeBook(book: Pick<L2Book, "levels">, depth = MAX_BOOK_DEPTH): BookSummary {
  const [bidLevels, askLevels] = book.levels;
  const bestBid = bidLevels[0]?.px ?? null;
  const bestAsk = askLevels[0]?.px ?? null;
  const bid = toNumber(bestBid);
  const ask = toNumber(bestAsk);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  return {
    bids: levelsView(bidLevels, depth),
    asks: levelsView(askLevels, depth),
    bestBid,
    bestAsk,
    mid: mid === null ? null : round(mid, 10),
    spread: spread === null ? null : round(spread, 10),
    spreadBps: spread === null || mid === null || mid <= 0 ? null : round((spread / mid) * 10_000, 4),
  };
}

export function tradeView(trade: RecentTrade): TradeView {
  return { px: trade.px, sz: trade.sz, side: trade.side === "B" ? "buy" : "sell", time: trade.time, tid: trade.tid, hash: trade.hash };
}
