import type { BookLevel } from "@elyia/core/hypercore/info";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";

import { useTradeStore } from "../../features/trading/tradeStore";
import { useBook, useTrades } from "../../features/trading/useMarketData";
import { bookGroupings, formatPx, formatSz, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { Skeleton } from "../../ui/Skeleton";
import { useTerminal } from "./terminalContext";
import { useBoxSize } from "./useBoxSize";

interface Row {
  readonly px: number;
  readonly pxText: string;
  readonly sz: number;
  readonly total: number;
  readonly n: number;
}

function cumulate(levels: readonly BookLevel[], count: number): Row[] {
  let total = 0;
  return levels.slice(0, count).map((level) => {
    const sz = Number(level.sz);
    total += sz;
    return { px: Number(level.px), pxText: level.px, sz, total, n: level.n };
  });
}

function sizeDecimals(market: TradeMarket): number {
  return Math.min(market.szDecimals, 4);
}

function BookRow({ row, side, maxTotal, market, mine, onPick }: { readonly row: Row; readonly side: "bid" | "ask"; readonly maxTotal: number; readonly market: TradeMarket; readonly mine: boolean; readonly onPick: (px: string) => void }) {
  const width = maxTotal > 0 ? Math.max(2, (row.total / maxTotal) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => onPick(row.pxText)}
      title={`${row.n} order${row.n === 1 ? "" : "s"} · click to use ${formatPx(row.px, market)} as the limit price`}
      className={cx("relative grid h-[22px] w-full shrink-0 grid-cols-3 items-center px-3 text-right font-mono text-xs transition-colors hover:bg-text-0/[0.05]", FOCUS_RING)}
    >
      <span aria-hidden="true" className={cx("absolute inset-y-0 right-0", side === "bid" ? "bg-mint/[0.10]" : "bg-rose/[0.10]")} style={{ width: `${width}%` }} />
      <span className={cx("tnum relative text-left", side === "bid" ? "text-mint" : "text-rose")}>
        {mine ? <span aria-label="your order" className="absolute -left-2 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-gold" /> : null}
        {formatPx(row.px, market)}
      </span>
      <span className="tnum relative text-text-0">{formatSz(row.sz, sizeDecimals(market))}</span>
      <span className="tnum relative text-text-1">{formatSz(row.total, sizeDecimals(market))}</span>
    </button>
  );
}

const ROW_PX = 22;
const SPREAD_PX = 44;

export function OrderBook({ levels: maxLevels = 20, className }: { readonly levels?: number; readonly className?: string }) {
  const { mode, market, ctx, feeds } = useTerminal();
  const [bodyRef, body] = useBoxSize<HTMLDivElement>();
  // As many whole rows per side as the panel holds: no half-cut levels.
  const levels = body.height > 0 ? Math.max(3, Math.min(maxLevels, Math.floor((body.height - SPREAD_PX) / 2 / ROW_PX))) : Math.min(maxLevels, 10);
  const groupingIndex = useTradeStore((state) => state.bookGrouping);
  const setPrefs = useTradeStore((state) => state.setPrefs);
  const pickPrice = useTradeStore((state) => state.pickPrice);
  const reference = ctx?.markPx ?? ctx?.midPx ?? 0;
  // Steps depend only on the price's order of magnitude: re-derive them when that changes, not on every tick.
  const magnitude = reference > 0 ? Math.floor(Math.log10(reference)) : 0;
  const groupings = useMemo(() => (market ? bookGroupings(1.5 * 10 ** magnitude, market.szDecimals, market.isSpot) : []), [market, magnitude]);
  const grouping = groupings[Math.min(groupingIndex, groupings.length - 1)] ?? null;
  const book = useBook(mode, market?.coin ?? null, grouping);
  const trades = useTrades(mode, market?.coin ?? null);
  const asks = useMemo(() => cumulate(book.asks, levels), [book.asks, levels]);
  const bids = useMemo(() => cumulate(book.bids, levels), [book.bids, levels]);
  const maxTotal = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0);
  const myPrices = useMemo(() => new Set((feeds.openOrders ?? []).filter((order) => order.coin === market?.coin && !order.isTrigger).map((order) => Number(order.limitPx))), [feeds.openOrders, market?.coin]);
  const step = grouping?.step ?? 0;
  const mine = (px: number) => (step > 0 ? [...myPrices].some((price) => Math.abs(price - px) < step / 2 + 1e-12) : myPrices.has(px));
  const last = trades[0] ? Number(trades[0].px) : book.mid;
  const previous = trades[1] ? Number(trades[1].px) : null;
  const up = last !== null && previous !== null ? last >= previous : true;
  const spreadPct = book.spread !== null && book.mid ? (book.spread / book.mid) * 100 : null;

  if (!market) return <div className={className} />;
  return (
    <section aria-label={`${market.displayName} order book`} className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[13px] font-medium text-text-0">Order book</h2>
        <Popover
          label="Book grouping"
          align="end"
          className="min-w-[140px]"
          trigger={(props) => (
            <button type="button" {...props} className={cx("inline-flex h-7 items-center gap-1 rounded-md px-2 font-mono text-xs text-text-1 hover:bg-text-0/[0.06]", FOCUS_RING)} aria-label={`Group levels by ${grouping?.label ?? "tick"}`}>
              {grouping?.label ?? "—"}
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        >
          {(close) => (
            <ul className="flex flex-col">
              {groupings.map((option, index) => (
                <li key={option.label}>
                  <button
                    type="button"
                    onClick={() => {
                      setPrefs({ bookGrouping: index });
                      close();
                    }}
                    className={cx("flex w-full items-center justify-between rounded-md px-2 py-1.5 font-mono text-xs hover:bg-text-0/[0.06]", index === groupingIndex ? "text-text-0" : "text-text-1", FOCUS_RING)}
                  >
                    {option.label}
                    {index === 0 ? <span className="text-text-2">tick</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      </div>
      <div className="grid grid-cols-3 px-3 pb-1 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-text-2">
        <span className="text-left">Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      {book.time === null ? (
        <div className="flex flex-1 flex-col gap-1 overflow-hidden px-3 py-2" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <Skeleton key={index} className="h-[18px] w-full shrink-0" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col-reverse justify-start overflow-hidden">
            {asks.map((row) => (
              <BookRow key={`a${row.pxText}`} row={row} side="ask" maxTotal={maxTotal} market={market} mine={mine(row.px)} onPick={pickPrice} />
            ))}
          </div>
          <div className="my-1 flex h-9 shrink-0 items-center justify-between bg-bg-1 px-3">
            <span className={cx("tnum font-mono text-base", up ? "text-mint" : "text-rose")}>
              {formatPx(last, market)} <span aria-hidden="true">{up ? "↑" : "↓"}</span>
            </span>
            <span className="tnum font-mono text-[11px] text-text-2">
              spread {book.spread !== null ? formatPx(book.spread, market) : "—"}
              {spreadPct !== null ? ` · ${spreadPct.toFixed(3)}%` : ""}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {bids.map((row) => (
              <BookRow key={`b${row.pxText}`} row={row} side="bid" maxTotal={maxTotal} market={market} mine={mine(row.px)} onPick={pickPrice} />
            ))}
          </div>
        </>
      )}
      </div>
    </section>
  );
}
