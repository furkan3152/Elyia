import { ChartCandlestick, Crosshair, X } from "lucide-react";
import type { MouseEvent } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import type { PositionRow } from "../../features/trading/accountModel";
import { distanceBar, distanceTone } from "../../features/trading/liquidation";
import { useTradeStore } from "../../features/trading/tradeStore";
import { formatUsdCompact } from "../../lib/format";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { signedPercent, signedUsd } from "./labels";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/** One line per position, every column (wide panels). */
const WIDE_GRID = "grid grid-cols-[minmax(150px,1.5fr)_minmax(90px,1fr)_minmax(72px,0.8fr)_minmax(72px,0.8fr)_minmax(120px,1.2fr)_minmax(170px,1.7fr)_minmax(64px,0.7fr)_132px] items-center gap-x-3";
/** Two lines per position (the chart column on a laptop, phones). */
const COMPACT_GRID = "grid grid-cols-[minmax(118px,1.35fr)_minmax(84px,1fr)_minmax(84px,0.95fr)_minmax(124px,1.45fr)_58px] items-center gap-x-3";

const BAR_TONE = { rose: "bg-rose", gold: "bg-gold", mint: "bg-mint" } as const;

export function LiquidationBar({ position, compact = false }: { readonly position: PositionRow; readonly compact?: boolean }) {
  const { marketByCoin } = useTerminal();
  const market = marketByCoin.get(position.coin) ?? null;
  const distance = position.liquidationDistance;
  const tone = distanceTone(distance);
  const percent = distance === null ? "—" : `${(distance * 100).toFixed(distance < 0.1 ? 1 : 0)}%`;
  const label = position.liquidationPx === null ? "no liq. price" : `liq ${formatPx(position.liquidationPx, market)} · ${percent}`;
  return (
    <span className="flex min-w-0 items-center gap-2" title={position.liquidationPx === null ? "The account's margin covers this position at any price HyperCore models." : `Liquidation at ${formatPx(position.liquidationPx, market)}: the mark is ${((distance ?? 0) * 100).toFixed(1)}% away.`}>
      <span className={cx("h-1.5 flex-1 overflow-hidden rounded-full bg-bg-2", compact ? "min-w-[36px]" : "min-w-[56px]")} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(distanceBar(distance) * 100)} aria-label="Distance to liquidation">
        <span className={cx("block h-full rounded-full", BAR_TONE[tone])} style={{ width: `${distanceBar(distance) * 100}%` }} />
      </span>
      <span className={cx("tnum shrink-0 whitespace-nowrap", tone === "rose" ? "text-rose" : tone === "gold" ? "text-gold" : "text-text-1")}>{label}</span>
    </span>
  );
}

function RowActions({ position, compact }: { readonly position: PositionRow; readonly compact: boolean }) {
  const { readOnly } = useTerminal();
  if (readOnly) return <span role="cell" />;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <span role="cell" className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          useTerminalUi.getState().set({ tpslCoin: position.coin });
        }}
        aria-label={`Set TP/SL on ${position.coin}`}
        title="Set or change TP/SL"
        className={cx("inline-flex h-6 items-center gap-1 rounded-md border border-line-strong px-1.5 text-[11px] text-text-1 hover:text-text-0", FOCUS_RING)}
      >
        <Crosshair className="h-3 w-3" aria-hidden="true" />
        {compact ? null : "TP/SL"}
      </button>
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          useTerminalUi.getState().set({ closeCoin: position.coin });
        }}
        aria-label={`Close ${position.coin}`}
        title="Close this position (F)"
        className={cx("inline-flex h-6 items-center gap-1 rounded-md border border-rose/40 bg-rose/[0.08] px-1.5 text-[11px] text-rose hover:bg-rose/[0.16]", FOCUS_RING)}
      >
        <X className="h-3 w-3" aria-hidden="true" />
        {compact ? null : "Close"}
      </button>
    </span>
  );
}

function PositionLine({ position, selected, compact }: { readonly position: PositionRow; readonly selected: boolean; readonly compact: boolean }) {
  const { marketByCoin, viewAs, ctx, market: active } = useTerminal();
  const market = marketByCoin.get(position.coin) ?? null;
  const select = () => useTradeStore.getState().selectPosition(selected ? null : position.coin);
  const mark = active?.coin === position.coin && ctx?.markPx ? ctx.markPx : position.markPx;
  const name = market?.kind === "spot" ? market.displayName : (market?.base ?? position.coin);
  const unit = market?.base ?? "";
  const pnlTone = position.unrealizedPnl >= 0 ? "text-mint" : "text-rose";
  const fundingTone = position.fundingSinceOpen > 0 ? "text-rose" : position.fundingSinceOpen < 0 ? "text-mint" : "text-text-2";
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    navigate(`${routeHref("trade", { market: market?.slug ?? position.coin })}${viewAs ? `?as=${viewAs}` : ""}`);
  };
  const marketCell = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={position.isLong ? "text-mint" : "text-rose"}>{position.isLong ? "LONG" : "SHORT"}</span>
      <button type="button" onClick={open} className={cx("truncate text-text-0 hover:text-violet-soft", FOCUS_RING)} title={`Open ${name}`}>
        {name}
      </button>
      <span className="shrink-0 text-text-2">
        {position.leverage}× {position.leverageType === "cross" ? "cross" : "iso"}
      </span>
    </span>
  );
  const rowClass = cx(compact ? COMPACT_GRID : WIDE_GRID, "cursor-pointer px-4 font-mono text-xs transition-colors", compact ? "py-1.5" : "py-[7px]", selected ? "bg-violet/[0.12]" : "hover:bg-text-0/[0.03]");
  if (compact) {
    return (
      <div role="row" aria-selected={selected} onClick={select} className={rowClass}>
        <span role="cell" className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={position.isLong ? "text-mint" : "text-rose"}>{position.isLong ? "LONG" : "SHORT"}</span>
            <button type="button" onClick={open} className={cx("truncate text-text-0 hover:text-violet-soft", FOCUS_RING)} title={`Open ${name}`}>
              {name}
            </button>
          </span>
          <span className="tnum truncate text-[11px] text-text-2">
            {position.leverage}× {position.leverageType === "cross" ? "cross" : "iso"} · {formatPx(position.entryPx, market)} → {formatPx(mark, market)}
          </span>
        </span>
        <span role="cell" className="flex min-w-0 flex-col gap-0.5">
          <span className="tnum truncate text-text-0" title={`${formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)} ${unit}`}>
            {formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)}
          </span>
          <span className="tnum text-[11px] text-text-2">{formatUsdCompact(position.positionValue)}</span>
        </span>
        <span role="cell" className={cx("flex flex-col gap-0.5", pnlTone)}>
          <span className="tnum">{signedUsd(position.unrealizedPnl)}</span>
          <span className="tnum text-[11px] opacity-80">{signedPercent(position.roe, 1)} ROE</span>
        </span>
        <span role="cell" className="flex min-w-0 flex-col gap-0.5">
          <LiquidationBar position={position} compact />
          <span className={cx("tnum text-[11px]", fundingTone)} title="Funding since the position opened">
            funding {signedUsd(-position.fundingSinceOpen)}
          </span>
        </span>
        <RowActions position={position} compact />
      </div>
    );
  }
  return (
    <div role="row" aria-selected={selected} onClick={select} className={rowClass}>
      <span role="cell">{marketCell}</span>
      <span role="cell" className="tnum truncate text-text-0">
        {formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)} <span className="text-text-2">{unit}</span>
      </span>
      <span role="cell" className="tnum text-text-1">{formatPx(position.entryPx, market)}</span>
      <span role="cell" className="tnum text-text-1">{formatPx(mark, market)}</span>
      <span role="cell" className={cx("tnum whitespace-nowrap", pnlTone)}>
        {signedUsd(position.unrealizedPnl)} <span className="opacity-80">({signedPercent(position.roe, 1)})</span>
      </span>
      <span role="cell" className="min-w-0">
        <LiquidationBar position={position} />
      </span>
      <span role="cell" className={cx("tnum", fundingTone)} title="Funding since the position opened">
        {signedUsd(-position.fundingSinceOpen)}
      </span>
      <RowActions position={position} compact={false} />
    </div>
  );
}

export function PositionsTable({ compact }: { readonly compact: boolean }) {
  const { feeds, account } = useTerminal();
  const selected = useTradeStore((state) => state.selectedPosition);
  if (!account) {
    return <EmptyState compact icon={<ChartCandlestick className="h-5 w-5" aria-hidden="true" />} title="Connect to see your positions" description="Or add ?as=0x… to the address to watch any HyperCore account, read only." />;
  }
  if (feeds.positions === null) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (feeds.positions.length === 0) {
    return <EmptyState compact icon={<ChartCandlestick className="h-5 w-5" aria-hidden="true" />} title="No open positions" description="Open one from the ticket, or say it: the Oracle turns a sentence into the same order." example="long ETH 5x with 200 USDC, stop at -3%" />;
  }
  const grid = compact ? COMPACT_GRID : WIDE_GRID;
  return (
    <div role="table" aria-label="Positions" className={compact ? "min-w-[520px]" : "min-w-[960px]"}>
      <div role="row" className={cx(grid, "sticky top-0 z-[1] bg-bg-0 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-2")}>
        <span role="columnheader">Market</span>
        <span role="columnheader">Size</span>
        {compact ? null : <span role="columnheader">Entry</span>}
        {compact ? null : <span role="columnheader">Mark</span>}
        <span role="columnheader">PnL (ROE)</span>
        <span role="columnheader">Liquidation distance</span>
        {compact ? null : <span role="columnheader">Funding</span>}
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      {feeds.positions.map((position) => (
        <PositionLine key={`${position.dex}:${position.coin}`} position={position} selected={selected === position.coin} compact={compact} />
      ))}
    </div>
  );
}
