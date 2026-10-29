import { useQuery } from "@tanstack/react-query";
import { Coins, History, Hourglass, Receipt, X } from "lucide-react";
import { useState } from "react";

import { cancelTwap } from "../../features/trading/orderBuilders";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { infoClient } from "../../lib/hypercore/runtime";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { dateTime, signedUsd } from "./labels";
import { useTerminal } from "./terminalContext";

const HEAD = "sticky top-0 z-[1] bg-bg-0 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-2";
const ROW = "px-4 py-[7px] font-mono text-xs hover:bg-text-0/[0.03]";

function Loading() {
  return (
    <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  );
}

function useMarketName() {
  const { marketByCoin } = useTerminal();
  return (coin: string) => {
    const market = marketByCoin.get(coin);
    return { market: market ?? null, name: market ? (market.kind === "spot" ? market.displayName : market.base) : coin };
  };
}

const TWAP_GRID = "grid grid-cols-[minmax(70px,1fr)_minmax(36px,0.5fr)_minmax(70px,0.9fr)_minmax(110px,1.6fr)_minmax(70px,0.9fr)_minmax(90px,1fr)_32px] items-center gap-x-3";

export function TwapTable() {
  const { feeds, account, now, readOnly, run } = useTerminal();
  const named = useMarketName();
  const [busy, setBusy] = useState<number | null>(null);
  if (!account) return <EmptyState compact icon={<Hourglass className="h-5 w-5" aria-hidden="true" />} title="Connect to see your TWAPs" />;
  if (feeds.twaps === null) return <Loading />;
  if (feeds.twaps.length === 0) {
    return <EmptyState compact icon={<Hourglass className="h-5 w-5" aria-hidden="true" />} title="No TWAP running" description="A TWAP buys or sells over time in 30-second slices, at most 3% slippage each." example="buy $5k HYPE over 2h" />;
  }
  return (
    <div role="table" aria-label="TWAP orders" className="min-w-[560px]">
      <div role="row" className={cx(TWAP_GRID, HEAD)}>
        <span role="columnheader">Market</span>
        <span role="columnheader">Side</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Executed</span>
        <span role="columnheader">Avg price</span>
        <span role="columnheader">Time left</span>
        <span role="columnheader" className="sr-only">
          Cancel
        </span>
      </div>
      {feeds.twaps.map((twap) => {
        const { market, name } = named(twap.coin);
        const done = twap.size > 0 ? Math.min(1, twap.executed / twap.size) : 0;
        const left = Math.max(0, twap.startedAt + twap.minutes * 60_000 - now);
        const cancel = async () => {
          if (!market) return;
          setBusy(twap.id);
          await run({ label: `Cancel TWAP ${name}`, actions: [cancelTwap(market.asset, twap.id)] });
          setBusy(null);
        };
        return (
          <div role="row" key={twap.id} className={cx(TWAP_GRID, ROW)}>
            <span role="cell" className="text-text-0">{name}</span>
            <span role="cell" className={twap.isBuy ? "text-mint" : "text-rose"}>{twap.isBuy ? "buy" : "sell"}</span>
            <span role="cell" className="tnum text-text-1">{formatSz(twap.size, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-2">
                <span className="block h-full rounded-full bg-violet-glow" style={{ width: `${done * 100}%` }} />
              </span>
              <span className="tnum shrink-0 text-text-1">{Math.round(done * 100)}%</span>
            </span>
            <span role="cell" className="tnum text-text-1">{twap.executed > 0 ? formatPx(twap.executedNotional / twap.executed, market) : "—"}</span>
            <span role="cell" className="tnum text-text-2">
              {Math.floor(left / 60_000)}m {Math.floor((left % 60_000) / 1000)}s / {twap.minutes}m
            </span>
            <span role="cell" className="flex justify-end">
              {!readOnly ? (
                <button type="button" disabled={busy === twap.id || !market} onClick={() => void cancel()} aria-label={`Cancel TWAP ${twap.id}`} className={cx("inline-flex h-6 w-6 items-center justify-center rounded-md text-text-2 hover:bg-rose/[0.12] hover:text-rose disabled:opacity-40", FOCUS_RING)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const FILL_GRID = "grid grid-cols-[minmax(92px,0.9fr)_minmax(100px,1fr)_minmax(110px,1.1fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(80px,0.8fr)_minmax(90px,0.9fr)] items-center gap-x-3";
const FILL_COMPACT = "grid grid-cols-[minmax(150px,1.6fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,0.9fr)] items-center gap-x-3";

export function FillsTable({ compact }: { readonly compact: boolean }) {
  const { feeds, account } = useTerminal();
  const named = useMarketName();
  if (!account) return <EmptyState compact icon={<Receipt className="h-5 w-5" aria-hidden="true" />} title="Connect to see your fills" />;
  if (feeds.fills === null) return <Loading />;
  if (feeds.fills.length === 0) return <EmptyState compact icon={<Receipt className="h-5 w-5" aria-hidden="true" />} title="No fills yet" description="Every fill lands here the moment HyperCore matches it." />;
  return (
    <div role="table" aria-label="Fills" className={compact ? "min-w-[440px]" : "min-w-[820px]"}>
      {compact ? (
        <div role="row" className={cx(FILL_COMPACT, HEAD)}>
          <span role="columnheader">Market · direction</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Closed PnL</span>
        </div>
      ) : (
        <div role="row" className={cx(FILL_GRID, HEAD)}>
          <span role="columnheader">Time</span>
          <span role="columnheader">Market</span>
          <span role="columnheader">Direction</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Fee</span>
          <span role="columnheader">Closed PnL</span>
        </div>
      )}
      {feeds.fills.slice(0, 200).map((fill) => {
        const { market, name } = named(fill.coin);
        const pnl = Number(fill.closedPnl);
        if (compact) {
          return (
            <div role="row" key={`${fill.tid}-${fill.time}`} className={cx(FILL_COMPACT, ROW, "py-1.5")}>
              <span role="cell" className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  <span className="text-text-0">{name}</span> <span className={fill.side === "B" ? "text-mint" : "text-rose"}>{fill.dir}</span>
                </span>
                <span className="tnum text-[11px] text-text-2">
                  {dateTime(fill.time)} · fee {Number(fill.fee).toFixed(4)}
                </span>
              </span>
              <span role="cell" className="tnum text-text-1">{formatPx(fill.px, market)}</span>
              <span role="cell" className="tnum text-text-1">{formatSz(fill.sz, market?.szDecimals ?? 4)}</span>
              <span role="cell" className={cx("tnum", pnl > 0 ? "text-mint" : pnl < 0 ? "text-rose" : "text-text-2")}>{pnl === 0 ? "—" : signedUsd(pnl)}</span>
            </div>
          );
        }
        return (
          <div role="row" key={`${fill.tid}-${fill.time}`} className={cx(FILL_GRID, ROW)}>
            <span role="cell" className="tnum text-text-2">{dateTime(fill.time)}</span>
            <span role="cell" className="truncate text-text-0">{name}</span>
            <span role="cell" className={cx("truncate", fill.side === "B" ? "text-mint" : "text-rose")}>
              {fill.dir}
              {fill.liquidation ? <span className="text-rose"> · liquidation</span> : null}
            </span>
            <span role="cell" className="tnum text-text-1">{formatPx(fill.px, market)}</span>
            <span role="cell" className="tnum text-text-1">{formatSz(fill.sz, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="tnum text-text-2">{Number(fill.fee).toFixed(4)}</span>
            <span role="cell" className={cx("tnum", pnl > 0 ? "text-mint" : pnl < 0 ? "text-rose" : "text-text-2")}>{pnl === 0 ? "—" : signedUsd(pnl)}</span>
          </div>
        );
      })}
    </div>
  );
}

const FUNDING_GRID = "grid grid-cols-[minmax(84px,1fr)_minmax(64px,1fr)_minmax(76px,1fr)_minmax(76px,1fr)_minmax(84px,1fr)] items-center gap-x-3";

export function FundingTable() {
  const { feeds, account } = useTerminal();
  const named = useMarketName();
  if (!account) return <EmptyState compact icon={<Coins className="h-5 w-5" aria-hidden="true" />} title="Connect to see your funding" />;
  if (feeds.fundings === null) return <Loading />;
  if (feeds.fundings.length === 0) return <EmptyState compact icon={<Coins className="h-5 w-5" aria-hidden="true" />} title="No funding payments yet" description="HyperCore settles funding every hour on open perp positions." />;
  const total = feeds.fundings.reduce((sum, row) => sum + Number(row.usdc), 0);
  return (
    <div role="table" aria-label="Funding payments" className="min-w-[460px]">
      <div className="flex items-center justify-between px-4 pb-1 pt-2 font-mono text-xs text-text-2">
        <span>{feeds.fundings.length} payments</span>
        <span>
          net <span className={total >= 0 ? "text-mint" : "text-rose"}>{signedUsd(total)}</span>
        </span>
      </div>
      <div role="row" className={cx(FUNDING_GRID, HEAD)}>
        <span role="columnheader">Time</span>
        <span role="columnheader">Market</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Rate</span>
        <span role="columnheader">Payment</span>
      </div>
      {feeds.fundings.slice(0, 200).map((row) => {
        const { market, name } = named(row.coin);
        const usdc = Number(row.usdc);
        return (
          <div role="row" key={`${row.time}-${row.coin}`} className={cx(FUNDING_GRID, ROW)}>
            <span role="cell" className="tnum text-text-2">{dateTime(row.time)}</span>
            <span role="cell" className="text-text-0">{name}</span>
            <span role="cell" className={cx("tnum", Number(row.szi) >= 0 ? "text-mint" : "text-rose")}>{formatSz(row.szi, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="tnum text-gold">{(Number(row.fundingRate) * 100).toFixed(4)}%</span>
            <span role="cell" className={cx("tnum", usdc >= 0 ? "text-mint" : "text-rose")}>{signedUsd(usdc, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}

interface HistoricalOrder {
  readonly order: { readonly coin: string; readonly side: "A" | "B"; readonly limitPx: string; readonly origSz: string; readonly sz: string; readonly orderType: string; readonly timestamp: number; readonly oid: number; readonly reduceOnly?: boolean; readonly tif?: string | null };
  readonly status: string;
  readonly statusTimestamp: number;
}

const HISTORY_GRID = "grid grid-cols-[minmax(92px,0.9fr)_minmax(100px,1fr)_minmax(110px,1.1fr)_minmax(60px,0.6fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(120px,1.2fr)] items-center gap-x-3";
const HISTORY_COMPACT = "grid grid-cols-[minmax(150px,1.6fr)_minmax(80px,1fr)_minmax(70px,0.9fr)_minmax(90px,1fr)] items-center gap-x-3";

export function HistoryTable({ compact }: { readonly compact: boolean }) {
  const { account, mode } = useTerminal();
  const named = useMarketName();
  const query = useQuery({
    queryKey: ["hypercore", mode, "historicalOrders", account],
    queryFn: () => infoClient(mode).post<HistoricalOrder[]>({ type: "historicalOrders", user: account as string }),
    enabled: account !== null,
    staleTime: 15_000,
  });
  if (!account) return <EmptyState compact icon={<History className="h-5 w-5" aria-hidden="true" />} title="Connect to see your order history" />;
  if (query.isPending) return <Loading />;
  if (query.isError) return <p className="px-4 py-6 text-sm text-text-2">Order history did not load. It refreshes when you open this tab again.</p>;
  const rows = (query.data ?? []).slice(0, 200);
  if (rows.length === 0) return <EmptyState compact icon={<History className="h-5 w-5" aria-hidden="true" />} title="No order history" />;
  return (
    <div role="table" aria-label="Order history" className={compact ? "min-w-[440px]" : "min-w-[840px]"}>
      {compact ? (
        <div role="row" className={cx(HISTORY_COMPACT, HEAD)}>
          <span role="columnheader">Market · type</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Status</span>
        </div>
      ) : (
        <div role="row" className={cx(HISTORY_GRID, HEAD)}>
          <span role="columnheader">Time</span>
          <span role="columnheader">Market</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Status</span>
        </div>
      )}
      {rows.map((row) => {
        const { market, name } = named(row.order.coin);
        const tone = row.status === "filled" ? "text-mint" : row.status === "open" ? "text-sky" : /Rejected|rejected|Canceled/u.test(row.status) && row.status !== "canceled" ? "text-rose" : "text-text-2";
        const status = row.status.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
        if (compact) {
          return (
            <div role="row" key={`${row.order.oid}-${row.statusTimestamp}`} className={cx(HISTORY_COMPACT, ROW, "py-1.5")}>
              <span role="cell" className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  <span className="text-text-0">{name}</span> <span className={row.order.side === "B" ? "text-mint" : "text-rose"}>{row.order.side === "B" ? "buy" : "sell"}</span>
                </span>
                <span className="truncate text-[11px] text-text-2">
                  {row.order.orderType} · {dateTime(row.statusTimestamp)}
                </span>
              </span>
              <span role="cell" className="tnum text-text-1">{formatPx(row.order.limitPx, market)}</span>
              <span role="cell" className="tnum text-text-1">{formatSz(row.order.origSz, market?.szDecimals ?? 4)}</span>
              <span role="cell" className={cx("truncate", tone)}>{status}</span>
            </div>
          );
        }
        return (
          <div role="row" key={`${row.order.oid}-${row.statusTimestamp}`} className={cx(HISTORY_GRID, ROW)}>
            <span role="cell" className="tnum text-text-2">{dateTime(row.statusTimestamp)}</span>
            <span role="cell" className="truncate text-text-0">{name}</span>
            <span role="cell" className="truncate text-text-1">{row.order.orderType}</span>
            <span role="cell" className={row.order.side === "B" ? "text-mint" : "text-rose"}>{row.order.side === "B" ? "buy" : "sell"}</span>
            <span role="cell" className="tnum text-text-1">{formatPx(row.order.limitPx, market)}</span>
            <span role="cell" className="tnum text-text-1">{formatSz(row.order.origSz, market?.szDecimals ?? 4)}</span>
            <span role="cell" className={cx("truncate", tone)}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}
