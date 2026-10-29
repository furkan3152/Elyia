import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

import { cancelTwap } from "../../features/trading/orderBuilders";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { infoClient } from "../../lib/hypercore/runtime";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { WatchAnyone } from "./WatchAnyone";
import { dateTime, signedUsd } from "./labels";
import { useTerminal } from "./terminalContext";

const HEAD = "sticky top-0 z-[1] bg-card px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 border-b-1.5 border-rule/40";
const ROW = "border-b border-rule/15 px-4 py-[7px] font-mono text-xs hover:bg-paper-2/60";

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
  if (!account) return <EmptyState compact scene="trail" title="No TWAPs on this sheet" description="Connect to see TWAPs slicing your size over time." />;
  if (feeds.twaps === null) return <Loading />;
  if (feeds.twaps.length === 0) {
    return <EmptyState compact scene="trail" title="No TWAP running" description="A TWAP buys or sells over time in 30-second slices, at most 3% slippage each." example="buy $5k HYPE over 2h" />;
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
            <span role="cell" className="text-ink">{name}</span>
            <span role="cell" className={twap.isBuy ? "text-up" : "text-down"}>{twap.isBuy ? "▲ buy" : "▼ sell"}</span>
            <span role="cell" className="tnum text-ink-2">{formatSz(twap.size, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden bg-ink/10">
                <span className="block h-full bg-ink" style={{ width: `${done * 100}%` }} />
              </span>
              <span className="tnum shrink-0 text-ink-2">{Math.round(done * 100)}%</span>
            </span>
            <span role="cell" className="tnum text-ink-2">{twap.executed > 0 ? formatPx(twap.executedNotional / twap.executed, market) : "—"}</span>
            <span role="cell" className="tnum text-ink-3">
              {Math.floor(left / 60_000)}m {Math.floor((left % 60_000) / 1000)}s / {twap.minutes}m
            </span>
            <span role="cell" className="flex justify-end">
              {!readOnly ? (
                <button type="button" disabled={busy === twap.id || !market} onClick={() => void cancel()} aria-label={`Cancel TWAP ${twap.id}`} className={cx("inline-flex h-6 w-6 items-center justify-center text-ink-3 hover:bg-down hover:text-card disabled:opacity-40", FOCUS_RING)}>
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
  if (!account) return <EmptyState compact scene="trail" title="No fills on this sheet" description="Connect, or survey any account, to read its fills log." action={<WatchAnyone />} />;
  if (feeds.fills === null) return <Loading />;
  if (feeds.fills.length === 0) return <EmptyState compact scene="trail" title="No fills yet" description="Every fill lands here the moment HyperCore matches it, with the fee and closed PnL." example="buy 0.1 ETH at market" />;
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
                  <span className="text-ink">{name}</span> <span className={fill.side === "B" ? "text-up" : "text-down"}>{fill.side === "B" ? "▲" : "▼"} {fill.dir}</span>
                </span>
                <span className="tnum text-[11px] text-ink-3">
                  {dateTime(fill.time)} · fee {Number(fill.fee).toFixed(4)}
                </span>
              </span>
              <span role="cell" className="tnum text-ink-2">{formatPx(fill.px, market)}</span>
              <span role="cell" className="tnum text-ink-2">{formatSz(fill.sz, market?.szDecimals ?? 4)}</span>
              <span role="cell" className={cx("tnum", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-ink-3")}>{pnl === 0 ? "—" : signedUsd(pnl)}</span>
            </div>
          );
        }
        return (
          <div role="row" key={`${fill.tid}-${fill.time}`} className={cx(FILL_GRID, ROW)}>
            <span role="cell" className="tnum text-ink-3">{dateTime(fill.time)}</span>
            <span role="cell" className="truncate text-ink">{name}</span>
            <span role="cell" className={cx("truncate", fill.side === "B" ? "text-up" : "text-down")}>
              {fill.side === "B" ? "▲" : "▼"} {fill.dir}
              {fill.liquidation ? <span className="text-down"> · liquidation</span> : null}
            </span>
            <span role="cell" className="tnum text-ink-2">{formatPx(fill.px, market)}</span>
            <span role="cell" className="tnum text-ink-2">{formatSz(fill.sz, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="tnum text-ink-3">{Number(fill.fee).toFixed(4)}</span>
            <span role="cell" className={cx("tnum", pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-ink-3")}>{pnl === 0 ? "—" : signedUsd(pnl)}</span>
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
  if (!account) return <EmptyState compact scene="trail" title="No funding log yet" description="Connect to see the hourly funding your ropes paid or earned." />;
  if (feeds.fundings === null) return <Loading />;
  if (feeds.fundings.length === 0) return <EmptyState compact scene="trail" title="No funding paid yet" description="Funding settles every hour on open perps; the windsock in the header shows who pays." />;
  const total = feeds.fundings.reduce((sum, row) => sum + Number(row.usdc), 0);
  return (
    <div role="table" aria-label="Funding payments" className="min-w-[460px]">
      <div className="flex items-center justify-between px-4 pb-1 pt-2 font-mono text-xs text-ink-3">
        <span>{feeds.fundings.length} payments</span>
        <span>
          net <span className={total >= 0 ? "text-up" : "text-down"}>{signedUsd(total)}</span>
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
            <span role="cell" className="tnum text-ink-3">{dateTime(row.time)}</span>
            <span role="cell" className="text-ink">{name}</span>
            <span role="cell" className={cx("tnum", Number(row.szi) >= 0 ? "text-up" : "text-down")}>{formatSz(row.szi, market?.szDecimals ?? 4)}</span>
            <span role="cell" className="tnum text-warn-ink">{(Number(row.fundingRate) * 100).toFixed(4)}%</span>
            <span role="cell" className={cx("tnum", usdc >= 0 ? "text-up" : "text-down")}>{signedUsd(usdc, 4)}</span>
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
  if (!account) return <EmptyState compact scene="trail" title="No history on this sheet" description="Connect to read every order you placed, filled or cancelled." />;
  if (query.isPending) return <Loading />;
  if (query.isError) return <p className="px-4 py-6 text-sm text-ink-3">Order history did not load. It refreshes when you open this tab again.</p>;
  const rows = (query.data ?? []).slice(0, 200);
  if (rows.length === 0) return <EmptyState compact scene="trail" title="No order history" description="Orders you place show up here with their final state." />;
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
        const tone = row.status === "filled" ? "text-up" : row.status === "open" ? "text-water" : /Rejected|rejected|Canceled/u.test(row.status) && row.status !== "canceled" ? "text-down" : "text-ink-3";
        const status = row.status.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
        if (compact) {
          return (
            <div role="row" key={`${row.order.oid}-${row.statusTimestamp}`} className={cx(HISTORY_COMPACT, ROW, "py-1.5")}>
              <span role="cell" className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  <span className="text-ink">{name}</span> <span className={row.order.side === "B" ? "text-up" : "text-down"}>{row.order.side === "B" ? "▲ buy" : "▼ sell"}</span>
                </span>
                <span className="truncate text-[11px] text-ink-3">
                  {row.order.orderType} · {dateTime(row.statusTimestamp)}
                </span>
              </span>
              <span role="cell" className="tnum text-ink-2">{formatPx(row.order.limitPx, market)}</span>
              <span role="cell" className="tnum text-ink-2">{formatSz(row.order.origSz, market?.szDecimals ?? 4)}</span>
              <span role="cell" className={cx("truncate", tone)}>{status}</span>
            </div>
          );
        }
        return (
          <div role="row" key={`${row.order.oid}-${row.statusTimestamp}`} className={cx(HISTORY_GRID, ROW)}>
            <span role="cell" className="tnum text-ink-3">{dateTime(row.statusTimestamp)}</span>
            <span role="cell" className="truncate text-ink">{name}</span>
            <span role="cell" className="truncate text-ink-2">{row.order.orderType}</span>
            <span role="cell" className={row.order.side === "B" ? "text-up" : "text-down"}>{row.order.side === "B" ? "▲ buy" : "▼ sell"}</span>
            <span role="cell" className="tnum text-ink-2">{formatPx(row.order.limitPx, market)}</span>
            <span role="cell" className="tnum text-ink-2">{formatSz(row.order.origSz, market?.szDecimals ?? 4)}</span>
            <span role="cell" className={cx("truncate", tone)}>{status}</span>
          </div>
        );
      })}
    </div>
  );
}
