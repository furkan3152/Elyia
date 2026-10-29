import { useState } from "react";

import { cancelOrders } from "../../features/trading/orderBuilders";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { FillsTable, FundingTable, HistoryTable, TwapTable } from "./ActivityTables";
import { OrdersTable } from "./OrdersTable";
import { KeyHint } from "./parts";
import { PositionsTable } from "./PositionsTable";
import { useTerminal } from "./terminalContext";
import { useTerminalUi, type AccountTab } from "./terminalUi";
import { useBoxSize } from "./useBoxSize";

export function HotkeyLegend({ className }: { readonly className?: string }) {
  const keys: readonly [string, string, boolean][] = [
    ["B", "long", true],
    ["S", "short", true],
    ["L M T", "type", true],
    ["1–5", "size", true],
    ["X", "close row", true],
    ["F", "descend all", true],
    ["/", "markets", true],
    ["Esc", "clear", false],
  ];
  return (
    <div className={cx("flex h-8 shrink-0 flex-nowrap items-center gap-x-3.5 overflow-hidden whitespace-nowrap font-mono text-[11px] text-ink-3", className)} aria-label="Keyboard shortcuts">
      {keys.map(([key, label, always]) => (
        <span key={key} className={cx("items-center gap-1.5", always ? "inline-flex" : "hidden 2xl:inline-flex")}>
          <Kbd className="h-5 min-w-5 px-1 text-[10px] shadow-none">{key}</Kbd>
          {label}
        </span>
      ))}
      <span className="hidden items-center gap-1.5 2xl:inline-flex">
        <Kbd className="h-5 min-w-5 px-1 text-[10px] shadow-none">⌘K</Kbd>
        where to?
      </span>
    </div>
  );
}

/** Positions · orders · TWAP · fills · funding · history: a log book with folder tabs, and the two ways down. */
export function AccountPanel({ className, showLegend = true }: { readonly className?: string; readonly showLegend?: boolean }) {
  const { feeds, readOnly, account, marketByCoin, run } = useTerminal();
  const tab = useTerminalUi((state) => state.accountTab);
  const [cancelling, setCancelling] = useState(false);
  const [panelRef, panel] = useBoxSize<HTMLDivElement>();
  // Two-line rows below ~900 px (phones, narrow windows); one line with every column beyond.
  const compact = panel.width > 0 ? panel.width < 900 : true;
  const stack = panel.width > 0 && panel.width < 560;
  const setTab = (accountTab: AccountTab) => useTerminalUi.getState().set({ accountTab });
  const positions = feeds.positions?.length ?? 0;
  const orders = feeds.openOrders?.length ?? 0;
  const twaps = feeds.twaps?.length ?? 0;
  const tabs: readonly { readonly id: AccountTab; readonly label: string; readonly count?: number }[] = [
    { id: "positions", label: "Ropes", count: positions },
    { id: "orders", label: "Orders", count: orders },
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
    <section aria-label="Account" className={cx("flex min-h-0 min-w-0 flex-col border-2 border-rule bg-card", className)}>
      <div className="flex items-end gap-2 border-b-2 border-rule bg-paper-2/50 pl-2 pr-2">
        <div role="tablist" aria-label="Account views" className="scrollbar-none flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1.5">
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={cx(
                  "-mb-[2px] flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border-2 px-3 font-sans text-[12px] font-bold uppercase tracking-[0.08em] transition-colors duration-fast",
                  selected ? "border-rule border-b-card bg-card text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  FOCUS_RING,
                )}
              >
                {item.label}
                {item.count ? <span className={cx("tnum inline-flex h-4 min-w-4 items-center justify-center px-1 font-mono text-[10px]", selected ? "bg-ink text-paper" : "bg-ink/10 text-ink-2")}>{item.count}</span> : null}
              </button>
            );
          })}
        </div>
        {account && !readOnly ? (
          <div className="flex shrink-0 items-center gap-2 py-1.5">
            <button
              type="button"
              disabled={orders === 0 || cancelling}
              onClick={() => void cancelAll()}
              className={cx("h-7 border-2 border-rule bg-card px-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-paper-2 disabled:opacity-40", FOCUS_RING)}
            >
              {cancelling ? "Cancelling…" : "Cancel orders"}
            </button>
            <button
              type="button"
              disabled={positions === 0 && orders === 0}
              onClick={() => useTerminalUi.getState().set({ flattenOpen: true })}
              title="Descend all: cancel every order, then close every position (hold to confirm)"
              className={cx("inline-flex h-7 items-center gap-1.5 border-2 border-down bg-card px-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-down shadow-[2px_2px_0_rgb(var(--down))] transition-colors hover:bg-down hover:text-card disabled:opacity-40 disabled:shadow-none", FOCUS_RING)}
            >
              Descend all
              <KeyHint k="F" />
            </button>
          </div>
        ) : null}
      </div>
      <div ref={panelRef} role="tabpanel" aria-label={tabs.find((item) => item.id === tab)?.label} className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" ? (
          <PositionsTable compact={compact} stack={stack} />
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
      {showLegend ? <HotkeyLegend className="border-t-1.5 border-rule/30 px-3 [@media(max-height:940px)]:hidden" /> : null}
    </section>
  );
}
