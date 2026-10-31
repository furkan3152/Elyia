import { useMemo } from "react";

import { useTradeStore } from "../../features/trading/tradeStore";
import type { TradeMarket } from "../../lib/hypercore/marketCatalog";
import type { ChartRopeKind } from "./chartRopes";
import { ROPE_ALARM } from "./pixelTerminal";
import { restingLevels } from "./survey";
import { useTerminal } from "./terminalContext";

export type ChartTone = "up" | "down" | "ink" | "ink-2" | "water" | "accent-line" | "ridge" | "warn";

export interface ChartLine {
  readonly id: string;
  readonly price: number;
  readonly title: string;
  readonly tone: ChartTone;
  readonly style: "solid" | "dashed" | "dotted";
  readonly width?: 1 | 2;
  /** Price label on the axis (resting orders keep only their line title, so the axis stays readable). */
  readonly axis?: boolean;
  /** Drawn as a pixel rope marker on the overlay (the chart keeps only its axis label and title). */
  readonly rope?: ChartRopeKind;
  /** Crevasse only: the position is long (the ground past it is below). */
  readonly long?: boolean;
  /** Crevasse only: under 10% to liquidation. */
  readonly frays?: boolean;
}

/** Resting orders drawn per market at most (the nearest to the mark): a busy account must not bury the chart. */
const MAX_ORDER_LINES = 8;

/**
 * Lines on the chart, in the Rope's words: the position's entry, its
 * liquidation (✕ crevasse), stop (⚓ anchor) and take-profit (⚑ flag),
 * resting orders, and the ticket's own preview (price, TP, SL).
 */
export function useChartLines(market: TradeMarket | null): ChartLine[] {
  const { feeds, ctx } = useTerminal();
  const price = useTradeStore((state) => state.price);
  const kind = useTradeStore((state) => state.kind);
  const tp = useTradeStore((state) => state.tp);
  const sl = useTradeStore((state) => state.sl);
  const tpslOn = useTradeStore((state) => state.tpslOn);
  const tpslUnit = useTradeStore((state) => state.tpslUnit);
  const reference = ctx?.markPx ?? null;
  // Re-rank the nearest orders only when the mark moves by a visible step, not every tick.
  const coarse = reference !== null ? Number(reference.toPrecision(3)) : null;
  return useMemo(() => {
    if (!market) return [];
    const lines: ChartLine[] = [];
    const position = feeds.positions?.find((row) => row.coin === market.coin);
    if (position) {
      lines.push({ id: "entry", price: position.entryPx, title: `ENTRY · ${position.isLong ? "▲ LONG" : "▼ SHORT"} ${position.leverage}×`, tone: "ink", style: "dashed", rope: "entry" });
      if (position.liquidationPx) lines.push({ id: "liq", price: position.liquidationPx, title: "✕ CREVASSE · LIQ", tone: "down", style: "solid", width: 2, rope: "crevasse", long: position.isLong, frays: position.liquidationDistance !== null && position.liquidationDistance < ROPE_ALARM });
    }
    const orders = (feeds.openOrders ?? []).filter((order) => order.coin === market.coin);
    // The protective triggers nearest the mark, then resting orders folded by price ("BUY 300 · 3 orders").
    const triggers = orders.filter((order) => order.isTrigger);
    const nearTriggers = coarse === null ? triggers : [...triggers].sort((a, b) => Math.abs(Number(a.triggerPx) - coarse) - Math.abs(Number(b.triggerPx) - coarse));
    for (const order of nearTriggers.slice(0, 4)) {
      const isTp = /take profit/iu.test(order.orderType);
      lines.push({ id: `o${order.oid}`, price: Number(order.triggerPx), title: isTp ? "⚑ FLAG · TP" : "⚓ ANCHOR · SL", tone: isTp ? "up" : "ink-2", style: "dashed", width: 2, rope: isTp ? "flag" : "anchor" });
    }
    for (const level of restingLevels(orders, coarse, MAX_ORDER_LINES)) {
      lines.push({ id: `o${level.oid}`, price: level.px, title: `${level.buy ? "BUY" : "SELL"} ${level.sz}${level.count > 1 ? ` · ${level.count} orders` : ""}`, tone: "water", style: "dotted", axis: false });
    }
    if (kind === "limit" && Number(price) > 0) lines.push({ id: "ticket", price: Number(price), title: "TICKET", tone: "accent-line", style: "dashed", width: 2, rope: "ticket" });
    if (tpslOn && tpslUnit === "price") {
      if (Number(tp) > 0) lines.push({ id: "ticket-tp", price: Number(tp), title: "⚑ NEW FLAG", tone: "up", style: "dotted", rope: "new-flag" });
      if (Number(sl) > 0) lines.push({ id: "ticket-sl", price: Number(sl), title: "⚓ NEW ANCHOR", tone: "ink-2", style: "dotted", rope: "new-anchor" });
    }
    return lines;
  }, [market, feeds.positions, feeds.openOrders, coarse, kind, price, tp, sl, tpslOn, tpslUnit]);
}
