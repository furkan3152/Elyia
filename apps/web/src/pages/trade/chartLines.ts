import { useMemo } from "react";

import { useTradeStore } from "../../features/trading/tradeStore";
import type { TradeMarket } from "../../lib/hypercore/marketCatalog";
import { useTerminal } from "./terminalContext";

export interface ChartLine {
  readonly id: string;
  readonly price: number;
  readonly title: string;
  readonly tone: "violet" | "mint" | "rose" | "gold" | "sky" | "text-1";
  readonly style: "solid" | "dashed" | "dotted";
}

/** Lines the chart draws: the position's entry and liquidation, resting orders and TP/SL, and the ticket's preview. */
export function useChartLines(market: TradeMarket | null): ChartLine[] {
  const { feeds } = useTerminal();
  const price = useTradeStore((state) => state.price);
  const kind = useTradeStore((state) => state.kind);
  const tp = useTradeStore((state) => state.tp);
  const sl = useTradeStore((state) => state.sl);
  const tpslOn = useTradeStore((state) => state.tpslOn);
  const tpslUnit = useTradeStore((state) => state.tpslUnit);
  return useMemo(() => {
    if (!market) return [];
    const lines: ChartLine[] = [];
    const position = feeds.positions?.find((row) => row.coin === market.coin);
    if (position) {
      lines.push({ id: "entry", price: position.entryPx, title: `entry · ${position.isLong ? "long" : "short"} ${position.leverage}×`, tone: "violet", style: "dashed" });
      if (position.liquidationPx) lines.push({ id: "liq", price: position.liquidationPx, title: "liquidation", tone: "rose", style: "solid" });
    }
    for (const order of feeds.openOrders ?? []) {
      if (order.coin !== market.coin) continue;
      if (order.isTrigger) {
        const isTp = /take profit/iu.test(order.orderType);
        lines.push({ id: `o${order.oid}`, price: Number(order.triggerPx), title: isTp ? "TP" : "SL", tone: isTp ? "mint" : "rose", style: "dotted" });
      } else {
        lines.push({ id: `o${order.oid}`, price: Number(order.limitPx), title: `${order.side === "B" ? "buy" : "sell"} ${order.sz}`, tone: order.side === "B" ? "mint" : "rose", style: "dotted" });
      }
    }
    if (kind === "limit" && Number(price) > 0) lines.push({ id: "ticket", price: Number(price), title: "ticket", tone: "gold", style: "dashed" });
    if (tpslOn && tpslUnit === "price") {
      if (Number(tp) > 0) lines.push({ id: "ticket-tp", price: Number(tp), title: "TP", tone: "mint", style: "dashed" });
      if (Number(sl) > 0) lines.push({ id: "ticket-sl", price: Number(sl), title: "SL", tone: "rose", style: "dashed" });
    }
    return lines;
  }, [market, feeds.positions, feeds.openOrders, kind, price, tp, sl, tpslOn, tpslUnit]);
}

