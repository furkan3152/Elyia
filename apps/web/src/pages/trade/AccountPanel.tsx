import { useState } from "react";

import { cancelOrders } from "../../features/trading/orderBuilders";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { FillsTable, FundingTable, HistoryTable, TwapTable } from "./ActivityTables";
import { OrdersTable } from "./OrdersTable";
import { PositionsTable } from "./PositionsTable";
import { useTerminal } from "./terminalContext";
import { useTerminalUi, type AccountTab } from "./terminalUi";
import { useBoxSize } from "./useBoxSize";

export function HotkeyLegend({ className }: { readonly className?: string }) {
  const keys: readonly [string, string, boolean][] = [
    ["B", "buy", true],
    ["S", "sell", true],
    ["L M T", "type", true],
    ["1–5", "size", true],
    ["F", "close", true],
    ["/", "markets", true],
    ["Esc", "clear", false],
  ];
  return (
    <div className={cx("flex h-9 shrink-0 flex-nowrap items-center gap-x-3.5 overflow-hidden whitespace-nowrap font-mono text-[11px] text-text-2", className)} aria-label="Keyboard shortcuts">
      {keys.map(([key, label, always]) => (
        <span key={key} className={cx("items-center gap-1.5", always ? "inline-flex" : "hidden 2xl:inline-flex")}>
          <Kbd className="h-5 min-w-5 px-1 text-[10px]">{key}</Kbd>
          {label}
        </span>
      ))}
      <span className="hidden items-center gap-1.5 2xl:inline-flex">
        <Kbd className="h-5 min-w-5 px-1 text-[10px]">⌘K</Kbd>
        speak
      </span>
    </div>
  );
}

export function AccountPanel({ className, showLegend = true }: { readonly className?: string; readonly showLegend?: boolean }) {
  const { feeds, readOnly, account, marketByCoin, run } = useTerminal();
  const tab = useTerminalUi((state) => state.accountTab);
  const [cancelling, setCancelling] = useState(false);
  const [panelRef, panel] = useBoxSize<HTMLDivElement>();
  // Two-line rows below ~880 px (the chart column on a laptop, phones); one line with every column beyond.
  const compact = panel.width > 0 ? panel.width < 880 : true;
  const setTab = (accountTab: AccountTab) => useTerminalUi.getState().set({ accountTab });
  const positions = feeds.positions?.length ?? 0;
  const orders = feeds.openOrders?.length ?? 0;
  const twaps = feeds.twaps?.length ?? 0;
  const tabs: readonly { readonly id: AccountTab; readonly label: string; readonly count?: number }[] = [
    { id: "positions", label: "Positions", count: positions },
    { id: "orders", label: "Open orders", count: orders },
    { id: "twap", label: "TWAP", count: twaps },
    { id: "fills", label: "Fills" },
    { id: "funding", label: "Funding" },
    { id: "history", label: "History" },
  ];

  const cancelAll = async () => {
    const refs = (feeds.openOrders ?? []).flatMap((order) => {
      const market = marketByCoin.get(order.coin);
      return market ? [{ asset: market.asset, oid: order.oid }] : [];
    });
    const action = cancelOrders(refs);
    if (!action) return;
    setCancelling(true);
    await run({ label: `Cancel ${refs.length} order${refs.length === 1 ? "" : "s"}`, actions: [action] });
    setCancelling(false);
  };

  return (
    <section aria-label="Account" className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-line px-3">
        <div role="tablist" aria-label="Account views" className="scrollbar-none flex min-w-0 flex-1 items-center gap-4 overflow-x-auto px-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cx("-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13px] transition-colors", tab === item.id ? "border-violet-glow text-text-0" : "border-transparent text-text-2 hover:text-text-1", FOCUS_RING)}
            >
              {item.label}
              {item.count ? <span className="tnum font-mono text-xs text-text-1">{item.count}</span> : null}
            </button>
          ))}
        </div>
        {account && !readOnly ? (
          <div className="flex shrink-0 items-center gap-1.5 py-1.5">
            <button
              type="button"
              disabled={positions === 0 && orders === 0}
              onClick={() => useTerminalUi.getState().set({ flattenOpen: true })}
              className={cx("h-7 rounded-lg border border-rose/40 bg-rose/[0.12] px-2.5 text-xs font-semibold text-rose transition-colors hover:bg-rose/[0.2] disabled:opacity-40", FOCUS_RING)}
            >
              Flatten all
            </button>
            <button
              type="button"
              disabled={orders === 0 || cancelling}
              onClick={() => void cancelAll()}
              className={cx("h-7 rounded-lg border border-line-strong bg-bg-2 px-2.5 text-xs text-text-1 transition-colors hover:text-text-0 disabled:opacity-40", FOCUS_RING)}
            >
              {cancelling ? "Cancelling…" : "Cancel all"}
            </button>
          </div>
        ) : null}
      </div>
      <div ref={panelRef} role="tabpanel" aria-label={tabs.find((item) => item.id === tab)?.label} className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" ? (
          <PositionsTable compact={compact} />
        ) : tab === "orders" ? (
          <OrdersTable compact={compact} />
        ) : tab === "twap" ? (
          <TwapTable />
        ) : tab === "fills" ? (
          <FillsTable compact={compact} />
        ) : tab === "funding" ? (
          <FundingTable />
        ) : (
          <HistoryTable compact={compact} />
        )}
      </div>
      {showLegend ? <HotkeyLegend className="border-t border-line px-4" /> : null}
    </section>
  );
}
