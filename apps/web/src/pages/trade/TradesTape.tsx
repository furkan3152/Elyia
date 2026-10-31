import { useMemo, type ReactNode } from "react";

import { useTrades } from "../../features/trading/useMarketData";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { cx } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { clock } from "./labels";
import { Caption, Frame } from "./parts";
import { useTerminal } from "./terminalContext";

/**
 * The live prints of the active market (WS trades), newest first: a ruled
 * log. Prints in the top tenth by size are set in bold with an ink tick, so
 * the whales stand out without anything flashing; your own fills carry the
 * yellow "you are here" mark.
 */
export function TradesTape({ rows = 30, className, heading }: { readonly rows?: number; readonly className?: string; readonly heading?: ReactNode }) {
  const { mode, market, account } = useTerminal();
  const trades = useTrades(mode, market?.coin ?? null);
  const mine = account?.toLowerCase() ?? null;
  const bigFrom = useMemo(() => {
    const sizes = trades.map((trade) => Number(trade.sz) * Number(trade.px)).filter((value) => value > 0).sort((a, b) => b - a);
    return sizes.length >= 10 ? sizes[Math.floor(sizes.length / 10)]! : Number.POSITIVE_INFINITY;
  }, [trades]);
  if (!market) {
    return (
      <Frame label="tape" className={className} title={heading ?? <Caption tone="ink" parts={["TAPE", "SURVEYING…"]} />}>
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
      label={`${market.displayName} trades`}
      className={className}
      title={heading ?? <Caption tone="ink" parts={["TAPE", trades.length > 0 ? "LIVE" : "WAITING"]} />}
      aside={<span className="font-tag text-[10px] uppercase text-ink-3">bold = top 10%</span>}
    >
      <div className="grid grid-cols-[1.1fr_1fr_1fr] px-3 pb-1 pt-1.5 text-right font-tag text-[10px] uppercase text-ink-3">
        <span className="text-left">Price</span>
        <span>Size</span>
        <span>Time</span>
      </div>
      <ol className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-live="off">
        {trades.length === 0
          ? Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="px-3 py-1">
                <Skeleton className="h-3.5 w-full" />
              </li>
            ))
          : trades.slice(0, rows).map((trade) => {
              const isMine = mine !== null && trade.users.some((user) => user.toLowerCase() === mine);
              const big = Number(trade.sz) * Number(trade.px) >= bigFrom;
              const buy = trade.side === "B";
              return (
                <li key={`${trade.tid}-${trade.time}`} className={cx("tx-row-seam relative grid h-[20px] shrink-0 grid-cols-[1.1fr_1fr_1fr] items-center px-3 text-right font-mono text-[12px]", isMine && "bg-signal/30")}>
                  {big ? <span aria-hidden="true" className="absolute inset-y-[4px] left-0 w-1 bg-ink" /> : null}
                  <span className={cx("tnum inline-flex items-center gap-1 text-left", buy ? "text-up" : "text-down", big && "font-semibold")}>
                    <span aria-hidden="true" className="text-[8px]">
                      {buy ? "▲" : "▼"}
                    </span>
                    <span className="sr-only">{buy ? "buy" : "sell"}</span>
                    {formatPx(trade.px, market)}
                  </span>
                  <span className={cx("tnum text-ink", big && "font-semibold")}>{formatSz(trade.sz, Math.min(market.szDecimals, 4))}</span>
                  <span className="tnum text-ink-3">{clock(trade.time)}</span>
                </li>
              );
            })}
      </ol>
    </Frame>
  );
}
