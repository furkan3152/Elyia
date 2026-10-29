import { useTrades } from "../../features/trading/useMarketData";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { cx } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { clock } from "./labels";
import { useTerminal } from "./terminalContext";

/** The live prints of the active market (WS trades), newest first. */
export function TradesTape({ rows = 30, className }: { readonly rows?: number; readonly className?: string }) {
  const { mode, market, account } = useTerminal();
  const trades = useTrades(mode, market?.coin ?? null);
  const mine = account?.toLowerCase() ?? null;
  if (!market) return <div className={className} />;
  return (
    <section aria-label={`${market.displayName} trades`} className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[13px] font-medium text-text-0">Trades</h2>
        <span className="font-mono text-[11px] text-text-2">{trades.length > 0 ? "live" : "waiting for prints"}</span>
      </div>
      <div className="grid grid-cols-3 px-3 pb-1 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-text-2">
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
              return (
                <li key={`${trade.tid}-${trade.time}`} className={cx("grid h-[21px] shrink-0 grid-cols-3 items-center px-3 text-right font-mono text-xs", isMine && "bg-gold/[0.07]")}>
                  <span className={cx("tnum text-left", trade.side === "B" ? "text-mint" : "text-rose")}>{formatPx(trade.px, market)}</span>
                  <span className="tnum text-text-0">{formatSz(trade.sz, Math.min(market.szDecimals, 4))}</span>
                  <span className="tnum text-text-2">{clock(trade.time)}</span>
                </li>
              );
            })}
      </ol>
    </section>
  );
}
