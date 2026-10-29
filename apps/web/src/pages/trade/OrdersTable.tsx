import type { FrontendOpenOrder } from "@elyia/core/hypercore/info";
import { ListOrdered, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { cancelOrders } from "../../features/trading/orderBuilders";
import { useTradeStore } from "../../features/trading/tradeStore";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { dateTime } from "./labels";
import { useTerminal } from "./terminalContext";

const GRID = "grid grid-cols-[minmax(92px,0.9fr)_minmax(110px,1.2fr)_minmax(120px,1.2fr)_minmax(80px,0.9fr)_minmax(110px,1.1fr)_minmax(80px,0.9fr)_minmax(60px,0.6fr)_40px] items-center gap-x-3";
const COMPACT = "grid grid-cols-[minmax(150px,1.6fr)_minmax(90px,1fr)_minmax(90px,1fr)_32px] items-center gap-x-3";

function typeLabel(order: FrontendOpenOrder): string {
  if (order.isPositionTpsl) return `${order.orderType} · position`;
  if (order.tif && !order.isTrigger) return `${order.orderType} · ${order.tif === "Alo" ? "post-only" : order.tif.toUpperCase()}`;
  return order.orderType;
}

function OrderLine({ order, compact }: { readonly order: FrontendOpenOrder; readonly compact: boolean }) {
  const { marketByCoin, readOnly, run } = useTerminal();
  const [busy, setBusy] = useState(false);
  const market = marketByCoin.get(order.coin) ?? null;
  const filled = Number(order.origSz) - Number(order.sz);
  const cancel = async () => {
    if (!market) return;
    const action = cancelOrders([{ asset: market.asset, oid: order.oid }]);
    if (!action) return;
    setBusy(true);
    await run({ label: `Cancel ${order.side === "B" ? "buy" : "sell"} ${order.sz} ${market.base}`, actions: [action] });
    setBusy(false);
  };
  const cancelButton = !readOnly ? (
    <button type="button" onClick={() => void cancel()} disabled={busy || !market} aria-label={`Cancel order ${order.oid}`} title={market ? "Cancel" : "Loading the market"} className={cx("inline-flex h-6 w-6 items-center justify-center rounded-md text-text-2 hover:bg-rose/[0.12] hover:text-rose disabled:opacity-40", FOCUS_RING)}>
      {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  ) : null;
  if (compact) {
    return (
      <div role="row" className={cx(COMPACT, "px-4 py-1.5 font-mono text-xs hover:bg-text-0/[0.03]")}>
        <span role="cell" className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">
            <span className="text-text-0">{market?.kind === "spot" ? market.displayName : (market?.base ?? order.coin)}</span>{" "}
            <span className={order.side === "B" ? "text-mint" : "text-rose"}>{order.side === "B" ? "buy" : "sell"}</span>
            {order.reduceOnly ? <span className="text-text-2"> · RO</span> : null}
          </span>
          <span className="truncate text-[11px] text-text-2">
            {typeLabel(order)} · {dateTime(order.timestamp)}
          </span>
        </span>
        <span role="cell" className="tnum text-text-0">{order.isTrigger ? order.triggerCondition : formatPx(order.limitPx, market)}</span>
        <span role="cell" className="tnum text-text-1">
          {formatSz(order.sz, market?.szDecimals ?? 4)}
          {filled > 0 ? <span className="text-text-2"> / {formatSz(order.origSz, market?.szDecimals ?? 4)}</span> : null}
        </span>
        <span role="cell" className="flex justify-end">
          {cancelButton}
        </span>
      </div>
    );
  }
  return (
    <div role="row" className={cx(GRID, "px-4 py-[7px] font-mono text-xs hover:bg-text-0/[0.03]")}>
      <span role="cell" className="tnum text-text-2">{dateTime(order.timestamp)}</span>
      <span role="cell" className="truncate text-text-0">{market?.kind === "spot" ? market.displayName : (market?.base ?? order.coin)}</span>
      <span role="cell" className="truncate text-text-1">{typeLabel(order)}</span>
      <span role="cell" className={order.side === "B" ? "text-mint" : "text-rose"}>
        {order.side === "B" ? "buy" : "sell"}
        {order.reduceOnly ? <span className="text-text-2"> · RO</span> : null}
      </span>
      <span role="cell" className="tnum text-text-0">{order.isTrigger ? `${order.triggerCondition}` : formatPx(order.limitPx, market)}</span>
      <span role="cell" className="tnum text-text-1">
        {formatSz(order.sz, market?.szDecimals ?? 4)}
        {filled > 0 ? <span className="text-text-2"> / {formatSz(order.origSz, market?.szDecimals ?? 4)}</span> : null}
      </span>
      <span role="cell" className="tnum text-text-2">{filled > 0 ? `${Math.round((filled / Number(order.origSz)) * 100)}%` : "—"}</span>
      <span role="cell" className="flex justify-end">
        {cancelButton}
      </span>
    </div>
  );
}

export function OrdersTable({ compact }: { readonly compact: boolean }) {
  const { feeds, account, marketByCoin } = useTerminal();
  const pending = useTradeStore((state) => state.pending);
  if (!account) return <EmptyState compact icon={<ListOrdered className="h-5 w-5" aria-hidden="true" />} title="Connect to see your orders" />;
  if (feeds.openOrders === null) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  const live = new Set<string>(feeds.openOrders.map((order) => order.cloid ?? ""));
  const inFlight = pending.filter((row) => !live.has(row.cloid) && row.status !== "filled");
  if (feeds.openOrders.length === 0 && inFlight.length === 0) {
    return <EmptyState compact icon={<ListOrdered className="h-5 w-5" aria-hidden="true" />} title="No open orders" description="Limit, TP/SL and scale orders rest here until they fill or you cancel them." example="limit buy 0.5 ETH at 3200" />;
  }
  return (
    <div role="table" aria-label="Open orders" className={compact ? "min-w-[440px]" : "min-w-[900px]"}>
      {compact ? (
        <div role="row" className={cx(COMPACT, "sticky top-0 z-[1] bg-bg-0 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-2")}>
          <span role="columnheader">Market · type</span>
          <span role="columnheader">Price / trigger</span>
          <span role="columnheader">Size</span>
          <span role="columnheader" className="sr-only">
            Cancel
          </span>
        </div>
      ) : (
        <div role="row" className={cx(GRID, "sticky top-0 z-[1] bg-bg-0 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-2")}>
          <span role="columnheader">Time</span>
          <span role="columnheader">Market</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Price / trigger</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Filled</span>
          <span role="columnheader" className="sr-only">
            Cancel
          </span>
        </div>
      )}
      {inFlight.map((row) => {
        const market = marketByCoin.get(row.coin) ?? null;
        return (
          <div key={row.cloid} role="row" className={cx(compact ? COMPACT : GRID, "px-4 py-[7px] font-mono text-xs text-text-2")} aria-busy="true">
            <span role="cell" className="flex items-center gap-1.5">
              <LoaderCircle className="h-3 w-3 animate-spin text-violet-soft" aria-hidden="true" />
              {row.status === "resting" ? "resting" : "sending"}
              {compact ? <span className="text-text-1"> {market?.base ?? row.coin} {row.label}</span> : null}
            </span>
            {compact ? null : <span role="cell" className="text-text-1">{market?.base ?? row.coin}</span>}
            {compact ? null : <span role="cell">{row.label}</span>}
            {compact ? null : <span role="cell" className={row.isBuy ? "text-mint" : "text-rose"}>{row.isBuy ? "buy" : "sell"}</span>}
            <span role="cell" className="tnum">{formatPx(row.px, market)}</span>
            <span role="cell" className="tnum">{row.sz}</span>
            {compact ? null : <span role="cell">—</span>}
            <span role="cell" />
          </div>
        );
      })}
      {feeds.openOrders.map((order) => (
        <OrderLine key={order.oid} order={order} compact={compact} />
      ))}
    </div>
  );
}
