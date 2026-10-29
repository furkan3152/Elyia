import { useTradeStore } from "../../features/trading/tradeStore";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { AccountPanel } from "./AccountPanel";
import { ConnectionDot, MarketButton, MarketStats } from "./MarketHeader";
import { OrderBook } from "./OrderBook";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { TradesTape } from "./TradesTape";
import { useTerminal } from "./terminalContext";
import { useTerminalUi, type MobilePane } from "./terminalUi";
import { ViewAsBar } from "./ViewAsBar";

/**
 * Phone and tablet terminal (< 1024 px): chart / book / trades tabs,
 * account tabs, and a sticky Long / Short bar that opens the ticket
 * as a bottom sheet.
 */
export function MobileTerminal() {
  const { market, readOnly } = useTerminal();
  const pane = useTerminalUi((state) => state.mobilePane);
  const ticketOpen = useTerminalUi((state) => state.ticketOpen);
  const set = useTerminalUi((state) => state.set);
  const side = useTradeStore((state) => state.side);
  const isSpot = market?.isSpot ?? false;
  const openTicket = (next: "buy" | "sell") => {
    useTradeStore.getState().patch({ side: next });
    set({ ticketOpen: true });
  };
  return (
    <div className="flex min-w-0 flex-col pb-24">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <MarketButton compact />
        <ConnectionDot />
      </div>
      <div className="scrollbar-none overflow-x-auto px-3 py-3">
        <MarketStats compact />
      </div>
      <ViewAsBar />
      <div className="px-3 pb-2">
        <SegmentedControl<MobilePane>
          label="Market view"
          value={pane}
          onChange={(mobilePane) => set({ mobilePane })}
          fullWidth
          options={[
            { value: "chart", label: "Chart" },
            { value: "book", label: "Book" },
            { value: "trades", label: "Trades" },
          ]}
        />
      </div>
      <div className="h-[380px] min-w-0 border-y border-line bg-bg-0">
        {pane === "chart" ? <PriceChart className="h-full" /> : pane === "book" ? <OrderBook className="h-full" levels={8} /> : <TradesTape className="h-full" rows={17} />}
      </div>
      <AccountPanel showLegend={false} className="min-h-[320px] border-t border-line" />

      {!readOnly ? (
        <div className="glass fixed inset-x-0 bottom-16 z-30 border-t border-line px-3 py-2.5 md:bottom-0">
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
            <button type="button" onClick={() => openTicket("buy")} className="h-12 rounded-xl bg-mint-fill text-[15px] font-bold text-ink-mint active:translate-y-px">
              {isSpot ? "Buy" : "Long"}
            </button>
            <button type="button" onClick={() => openTicket("sell")} className="h-12 rounded-xl bg-rose-fill text-[15px] font-bold text-ink-rose active:translate-y-px">
              {isSpot ? "Sell" : "Short"}
            </button>
          </div>
        </div>
      ) : null}
      <Sheet open={ticketOpen} onClose={() => set({ ticketOpen: false })} side="bottom" title={`${side === "buy" ? (isSpot ? "Buy" : "Long") : isSpot ? "Sell" : "Short"} ${market?.isSpot ? market.displayName : (market?.base ?? "")}`}>
        <OrderTicket />
      </Sheet>
    </div>
  );
}
