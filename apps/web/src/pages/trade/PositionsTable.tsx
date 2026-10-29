import type { MouseEvent } from "react";
import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import type { PositionRow } from "../../features/trading/accountModel";
import { useTradeStore } from "../../features/trading/tradeStore";
import { usePositionRopes, type RopeView } from "../../features/trading/useTopoData";
import { formatUsdCompact } from "../../lib/format";
import { formatPx, formatSz } from "../../lib/hypercore/marketCatalog";
import { Blaze } from "../../topo/Blaze";
import { Rope } from "../../topo/Rope";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { signedPercent, signedUsd } from "./labels";
import { Chevron, SideMark } from "./parts";
import { gradeOfLeverage, signTone } from "./survey";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";
import { WatchAnyone } from "./WatchAnyone";

/** One line per position, every column (wide panels). */
const WIDE_GRID = "grid grid-cols-[minmax(150px,1.2fr)_minmax(100px,0.9fr)_minmax(150px,1.1fr)_minmax(118px,1fr)_minmax(240px,2.4fr)_minmax(80px,0.7fr)_128px] items-center gap-x-4";
/** Two lines per position (narrow panels, phones). */
const COMPACT_GRID = "grid grid-cols-[minmax(124px,1.2fr)_minmax(96px,1fr)_minmax(170px,2fr)_64px] items-center gap-x-3";

const HEAD = "sticky top-0 z-[1] border-b-1.5 border-rule/40 bg-card px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

/** The rope of a position in a table row: crevasse → anchor → climber → flag, with the distance on the rope. */
export function RowRope({ rope, position }: { readonly rope: RopeView | undefined; readonly position: PositionRow }) {
  const { marketByCoin } = useTerminal();
  const market = marketByCoin.get(position.coin) ?? null;
  return (
    <Rope
      variant="compact"
      side={position.isLong ? "long" : "short"}
      entry={position.entryPx}
      mark={rope?.markPx ?? position.markPx}
      liquidation={position.liquidationPx}
      stop={rope?.sl?.px ?? null}
      takeProfit={rope?.tp?.px ?? null}
      symbol={market?.base ?? position.coin}
      formatPrice={(price) => formatPx(price, market)}
    />
  );
}

/** "✕ 23% · liq 82.09" under the rope: the number the drawing is about. */
function RopeLegend({ rope, position }: { readonly rope: RopeView | undefined; readonly position: PositionRow }) {
  const { marketByCoin } = useTerminal();
  const market = marketByCoin.get(position.coin) ?? null;
  const distance = rope?.distance ?? position.liquidationDistance;
  if (position.liquidationPx === null) return <span className="font-mono text-[11px] text-ink-3">no crevasse · margin covers it</span>;
  const tight = distance !== null && distance < 0.1;
  return (
    <span className={cx("tnum flex flex-wrap items-center gap-x-2 font-mono text-[11px]", tight ? "text-down" : "text-ink-2")}>
      <span className="font-semibold">✕ {distance === null ? "—" : `${(distance * 100).toFixed(distance < 0.1 ? 1 : 0)}%`}</span>
      <span className="text-ink-3">liq {formatPx(position.liquidationPx, market)}</span>
      {rope?.stopBeyondLiquidation ? <span className="text-down">anchor below crevasse</span> : null}
    </span>
  );
}

function RowActions({ position, compact }: { readonly position: PositionRow; readonly compact: boolean }) {
  const { readOnly } = useTerminal();
  if (readOnly) return <span role="cell" />;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <span role="cell" className={cx("flex justify-end gap-1.5", compact ? "flex-col items-end" : "items-center")}>
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          useTerminalUi.getState().set({ tpslCoin: position.coin });
        }}
        aria-label={`Set flag and anchor (TP/SL) on ${position.coin}`}
        title="Set or move the flag (TP) and anchor (SL)"
        className={cx("inline-flex h-6 items-center border-1.5 border-rule bg-card px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-ink hover:bg-paper-2", FOCUS_RING)}
      >
        ⚑ TP/SL
      </button>
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          useTerminalUi.getState().set({ closeCoin: position.coin });
        }}
        aria-label={`Close ${position.coin}`}
        title="Close this position (X)"
        className={cx("inline-flex h-6 items-center border-1.5 border-down bg-card px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-down hover:bg-down hover:text-card", FOCUS_RING)}
      >
        Close
      </button>
    </span>
  );
}

function PositionLine({ position, rope, selected, compact, stack }: { readonly position: PositionRow; readonly rope: RopeView | undefined; readonly selected: boolean; readonly compact: boolean; readonly stack: boolean }) {
  const { marketByCoin, viewAs } = useTerminal();
  const market = marketByCoin.get(position.coin) ?? null;
  const select = () => useTradeStore.getState().selectPosition(selected ? null : position.coin);
  const mark = rope?.markPx ?? position.markPx;
  const name = market?.kind === "spot" ? market.displayName : (market?.base ?? position.coin);
  const unit = market?.base ?? "";
  const fundingPaid = -position.fundingSinceOpen;
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    navigate(`${routeHref("trade", { market: market?.slug ?? position.coin })}${viewAs ? `?as=${viewAs}` : ""}`);
  };
  const marketCell = (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <SideMark long={position.isLong} />
        <button type="button" onClick={open} className={cx("truncate font-sans text-[14px] font-bold text-ink underline-offset-2 hover:underline", FOCUS_RING)} title={`Open ${name}`}>
          {name}
        </button>
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
        <Blaze grade={gradeOfLeverage(position.leverage)} size={10} />
        {position.leverage}× {position.leverageType === "cross" ? "cross" : "iso"}
      </span>
    </span>
  );
  const pnlCell = (
    <span role="cell" className={cx("flex flex-col gap-0.5 font-mono", signTone(position.unrealizedPnl))}>
      <span className="tnum inline-flex items-center gap-1 text-[13px] font-semibold">
        <Chevron value={position.unrealizedPnl} strong={Number.POSITIVE_INFINITY} className="text-[9px]" />
        {signedUsd(position.unrealizedPnl)}
      </span>
      <span className="tnum text-[11px] opacity-80">{signedPercent(position.roe, 1)} ROE</span>
    </span>
  );
  const ropeCell = (
    <span role="cell" className="flex min-w-0 flex-col">
      <RowRope rope={rope} position={position} />
      <RopeLegend rope={rope} position={position} />
    </span>
  );
  const rowClass = cx(
    compact ? COMPACT_GRID : WIDE_GRID,
    "relative cursor-pointer border-b border-rule/15 px-4 py-1.5 transition-colors duration-fast",
    selected ? "bg-signal/20" : "hover:bg-paper-2/60",
    rope?.band === "critical" && "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-down",
  );
  if (stack) {
    // Phones: one card per rope, the rope across the full width.
    return (
      <div role="row" aria-selected={selected} onClick={select} className={cx("relative flex cursor-pointer flex-col gap-1.5 border-b border-rule/15 px-3 py-2.5", selected ? "bg-signal/20" : "", rope?.band === "critical" && "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-down")}>
        <span className="flex items-start justify-between gap-3">
          <span role="cell">{marketCell}</span>
          {pnlCell}
        </span>
        {ropeCell}
        <span className="flex items-center justify-between gap-3">
          <span role="cell" className="tnum truncate font-mono text-[11px] text-ink-2">
            {formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)} {unit} · {formatUsdCompact(position.positionValue)} · {formatPx(mark, market)}
          </span>
          <span className="shrink-0 [&>span]:flex-row">
            <RowActions position={position} compact={false} />
          </span>
        </span>
      </div>
    );
  }
  if (compact) {
    return (
      <div role="row" aria-selected={selected} onClick={select} className={rowClass}>
        <span role="cell" className="flex min-w-0 flex-col gap-1">
          {marketCell}
          <span className="tnum truncate font-mono text-[11px] text-ink-2">
            {formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)} {unit} · {formatUsdCompact(position.positionValue)}
          </span>
        </span>
        {pnlCell}
        {ropeCell}
        <RowActions position={position} compact />
      </div>
    );
  }
  return (
    <div role="row" aria-selected={selected} onClick={select} className={rowClass}>
      <span role="cell">{marketCell}</span>
      <span role="cell" className="flex flex-col gap-0.5 font-mono">
        <span className="tnum truncate text-[13px] text-ink">
          {formatSz(Math.abs(position.szi), market?.szDecimals ?? 4)} <span className="text-ink-3">{unit}</span>
        </span>
        <span className="tnum text-[11px] text-ink-3">{formatUsdCompact(position.positionValue)}</span>
      </span>
      <span role="cell" className="flex flex-col gap-0.5 font-mono">
        <span className="tnum text-[13px] text-ink">{formatPx(mark, market)}</span>
        <span className="tnum text-[11px] text-ink-3">from {formatPx(position.entryPx, market)}</span>
      </span>
      {pnlCell}
      {ropeCell}
      <span role="cell" className={cx("tnum font-mono text-[12px]", signTone(fundingPaid))} title="Funding since the position opened (+ received, − paid)">
        {signedUsd(fundingPaid)}
      </span>
      <RowActions position={position} compact={false} />
    </div>
  );
}

export function PositionsTable({ compact, stack = false }: { readonly compact: boolean; readonly stack?: boolean }) {
  const { feeds, account, mode } = useTerminal();
  const selected = useTradeStore((state) => state.selectedPosition);
  const ropes = usePositionRopes(mode, feeds);
  const ropeByCoin = useMemo(() => new Map(ropes.map((rope) => [`${rope.dex}:${rope.coin}`, rope])), [ropes]);
  if (!account) {
    return (
      <EmptyState
        compact
        scene="map"
        title="No ropes on this sheet yet"
        description="Connect to see your own positions as ropes from crevasse to flag, or survey any HyperCore account read only."
        action={<WatchAnyone />}
      />
    );
  }
  if (feeds.positions === null) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (feeds.positions.length === 0) {
    return <EmptyState compact scene="summit" title="No ropes out" description="Every position you open hangs here as a rope: how far to the crevasse, where your anchor and flag sit." example="long ETH 5x with 200 USDC, stop at -3%" />;
  }
  const grid = compact ? COMPACT_GRID : WIDE_GRID;
  return (
    <div role="table" aria-label="Positions" className={stack ? "" : compact ? "min-w-[520px]" : "min-w-[1000px]"}>
      {stack ? null : (
      <div role="row" className={cx(grid, HEAD)}>
        <span role="columnheader">Market</span>
        {compact ? null : <span role="columnheader">Size</span>}
        {compact ? null : <span role="columnheader">Mark · entry</span>}
        <span role="columnheader">PnL</span>
        <span role="columnheader" className="truncate" title="crevasse = liquidation, anchor = stop, climber = mark, flag = take profit">Rope · ✕ liq ⚓ stop ● mark ⚑ tp</span>
        {compact ? null : <span role="columnheader">Funding</span>}
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      )}
      {feeds.positions.map((position) => (
        <PositionLine key={`${position.dex}:${position.coin}`} position={position} rope={ropeByCoin.get(`${position.dex}:${position.coin}`)} selected={selected === position.coin} compact={compact} stack={stack} />
      ))}
    </div>
  );
}
