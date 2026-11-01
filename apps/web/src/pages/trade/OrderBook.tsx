import type { BookLevel } from "@elyia/core/hypercore/info";
import { ChevronDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { useTradeStore } from "../../features/trading/tradeStore";
import { useBook, useTrades } from "../../features/trading/useMarketData";
import { bookGroupings, formatPx, formatSz, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { Skeleton } from "../../ui/Skeleton";
import { Caption, Frame } from "./parts";
import { balanceBlocks, unitWidth } from "./pixelTerminal";
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

/**
 * One level: price, size, cumulative total. The cumulative depth is a
 * dithered pixel bar from the right edge; this level's own size is the solid
 * block at its outer end, so walls read at a glance. Both grow in whole 4 px
 * units, so the book's right edge steps like a contour.
 */
function BookRow({ row, side, maxTotal, maxSize, width, market, mine, onPick }: { readonly row: Row; readonly side: "bid" | "ask"; readonly maxTotal: number; readonly maxSize: number; readonly width: number; readonly market: TradeMarket; readonly mine: boolean; readonly onPick: (px: string) => void }) {
  const depth = maxTotal > 0 ? unitWidth(row.total / maxTotal, width) : 0;
  const own = maxSize > 0 ? unitWidth((row.sz / maxSize) * 0.3, width) : 0;
  const wall = maxSize > 0 && row.sz >= maxSize * 0.999 && row.n > 0;
  return (
    <button
      type="button"
      onClick={() => onPick(row.pxText)}
      title={`${row.n} order${row.n === 1 ? "" : "s"} · click to use ${formatPx(row.px, market)} as the limit price`}
      className={cx("group relative grid h-[20px] w-full shrink-0 grid-cols-[1.1fr_1fr_1fr] items-center px-3 text-right font-mono text-[12px] hover:bg-paper-2", FOCUS_RING)}
    >
      <span aria-hidden="true" className={cx("absolute inset-y-[2px] right-0", side === "bid" ? "tx-dither-up" : "tx-dither-down")} style={{ width: depth }} />
      <span aria-hidden="true" className={cx("absolute inset-y-[2px] right-0", side === "bid" ? "bg-up/35" : "bg-down/35")} style={{ width: own }} />
      <span className={cx("tnum relative text-left font-medium", side === "bid" ? "text-up" : "text-down")}>
        {mine ? <span aria-label="your order" className="absolute -left-2.5 top-1/2 h-1 w-1 -translate-y-1/2 bg-signal [box-shadow:0_0_0_1px_rgb(var(--rule))]" /> : null}
        {formatPx(row.px, market)}
      </span>
      <span className={cx("tnum relative text-ink", wall && "font-semibold")}>{formatSz(row.sz, sizeDecimals(market))}</span>
      <span className="tnum relative text-ink-2">{formatSz(row.total, sizeDecimals(market))}</span>
    </button>
  );
}

const ROW_PX = 20;
const MID_PX = 46;
const FOOT_PX = 30;

export function OrderBook({ levels: maxLevels = 20, className, heading }: { readonly levels?: number; readonly className?: string; readonly heading?: ReactNode }) {
  const { mode, market, ctx, feeds } = useTerminal();
  const [bodyRef, body] = useBoxSize<HTMLDivElement>();
  // As many whole rows per side as the panel holds: no half-cut levels.
  const levels = body.height > 0 ? Math.max(3, Math.min(maxLevels, Math.floor((body.height - MID_PX - FOOT_PX) / 2 / ROW_PX))) : Math.min(maxLevels, 10);
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
  const maxSize = Math.max(0, ...asks.map((row) => row.sz), ...bids.map((row) => row.sz));
  const myPrices = useMemo(() => new Set((feeds.openOrders ?? []).filter((order) => order.coin === market?.coin && !order.isTrigger).map((order) => Number(order.limitPx))), [feeds.openOrders, market?.coin]);
  const step = grouping?.step ?? 0;
  const mine = (px: number) => (step > 0 ? [...myPrices].some((price) => Math.abs(price - px) < step / 2 + 1e-12) : myPrices.has(px));
  const last = trades[0] ? Number(trades[0].px) : book.mid;
  const previous = trades[1] ? Number(trades[1].px) : null;
  const up = last !== null && previous !== null ? last >= previous : true;
  const spreadBps = book.spread !== null && book.mid ? (book.spread / book.mid) * 10_000 : null;
  const bidShown = bids.at(-1)?.total ?? 0;
  const askShown = asks.at(-1)?.total ?? 0;
  const imbalance = bidShown + askShown > 0 ? bidShown / (bidShown + askShown) : null;
  const width = body.width;

  if (!market) {
    return (
      <Frame label="book" className={className} title={heading ?? <Caption tone="ink" parts={["BOOK", "SURVEYING…"]} />}>
        <div className="flex flex-1 flex-col gap-1.5 overflow-hidden px-3 py-3" aria-busy="true">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-[14px] w-full shrink-0" />
          ))}
        </div>
      </Frame>
    );
  }
  return (
    <Frame
      label={`${market.displayName} order book`}
      className={className}
      title={heading ?? <Caption tone="ink" parts={["BOOK", market.kind === "spot" ? market.displayName : market.base]} />}
      aside={
        <Popover
          label="Book grouping"
          align="end"
          className="min-w-[150px]"
          trigger={(props) => (
            <button type="button" {...props} className={cx("px-frame-thin inline-flex h-6 items-center gap-1 bg-card px-1.5 font-mono text-[11px] text-ink hover:bg-paper-2", FOCUS_RING)} aria-label={`Group levels by ${grouping?.label ?? "tick"}`}>
              {grouping?.label ?? "—"}
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        >
          {(close) => (
            <ul className="flex flex-col">
              <li className="caption px-2 pb-1">Group by</li>
              {groupings.map((option, index) => (
                <li key={option.label}>
                  <button
                    type="button"
                    onClick={() => {
                      setPrefs({ bookGrouping: index });
                      close();
                    }}
                    className={cx("flex w-full items-center justify-between px-2 py-1.5 font-mono text-xs hover:bg-paper-2", index === groupingIndex ? "bg-accent text-accent-ink hover:bg-accent" : "text-ink", FOCUS_RING)}
                  >
                    {option.label}
                    {index === 0 ? <span className="opacity-70">tick</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      }
    >
      <div className="grid grid-cols-[1.1fr_1fr_1fr] px-3 pb-1 pt-1.5 text-right font-tag text-[10px] uppercase text-ink-3">
        <span className="text-left">Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {book.time === null ? (
          <div className="flex flex-1 flex-col gap-1 overflow-hidden px-3 py-2" aria-hidden="true">
            {Array.from({ length: 14 }, (_, index) => (
              <Skeleton key={index} className="h-[16px] w-full shrink-0" />
            ))}
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col-reverse justify-start overflow-hidden" aria-label="Asks">
              {asks.map((row) => (
                <BookRow key={`a${row.pxText}`} row={row} side="ask" maxTotal={maxTotal} maxSize={maxSize} width={width} market={market} mine={mine(row.px)} onPick={pickPrice} />
              ))}
            </div>
            <div className="my-0.5 flex h-[42px] shrink-0 items-center justify-between bg-paper-2 px-3 [box-shadow:0_-2px_0_0_rgb(var(--rule)),0_2px_0_0_rgb(var(--rule))]">
              <span className={cx("tnum inline-flex items-center gap-1.5 font-display text-[22px] font-bold leading-none", up ? "text-up" : "text-down")}>
                {formatPx(last, market)}
                <span aria-hidden="true" className="text-[11px]">
                  {up ? "▲" : "▼"}
                </span>
                <span className="sr-only">{up ? "last trade up" : "last trade down"}</span>
              </span>
              <span className="tnum flex flex-col items-end gap-0.5 font-tag text-[10px] uppercase leading-tight text-ink-3">
                <span>spread {book.spread !== null ? formatPx(book.spread, market) : "—"}</span>
                <span>{spreadBps !== null ? `${spreadBps.toFixed(spreadBps < 1 ? 2 : 1)} bps` : ""}</span>
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Bids">
              {bids.map((row) => (
                <BookRow key={`b${row.pxText}`} row={row} side="bid" maxTotal={maxTotal} maxSize={maxSize} width={width} market={market} mine={mine(row.px)} onPick={pickPrice} />
              ))}
            </div>
            <BookBalance imbalance={imbalance} />
          </>
        )}
      </div>
    </Frame>
  );
}

const BALANCE_BLOCKS = 20;

/** Which side holds more of the shown size: twenty pixel blocks, bids fill from the left, asks from the right. */
function BookBalance({ imbalance }: { readonly imbalance: number | null }) {
  if (imbalance === null) return null;
  const bid = Math.round(imbalance * 100);
  const filled = balanceBlocks(imbalance, BALANCE_BLOCKS);
  return (
    <div className="tx-seam-t flex h-[30px] shrink-0 items-center gap-2 px-3 font-tag text-[10px]" role="img" aria-label={`Book balance: bids ${bid}%, asks ${100 - bid}% of the shown size`}>
      <span className="w-10 text-up">▲ {bid}%</span>
      <span aria-hidden="true" className="flex h-2.5 flex-1 gap-px">
        {Array.from({ length: BALANCE_BLOCKS }, (_, index) => (
          <span key={index} className={cx("h-full flex-1", index < filled ? "bg-up" : "bg-down")} />
        ))}
      </span>
      <span className="w-10 text-right text-down">{100 - bid}% ▼</span>
    </div>
  );
}
