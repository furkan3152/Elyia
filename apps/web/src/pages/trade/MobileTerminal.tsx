import { useTradeStore } from "../../features/trading/tradeStore";
import { buttonClasses } from "../../ui/buttonStyles";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { AccountPanel } from "./AccountPanel";
import { marketTitle } from "./labels";
import { ConnectionDot, FavouriteStrip, MarketButton, MarketStats } from "./MarketHeader";
import { OrderBook } from "./OrderBook";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { TradesTape } from "./TradesTape";
import { useTerminal } from "./terminalContext";
import { useTerminalUi, type MobilePane } from "./terminalUi";
import { ViewAsBar } from "./ViewAsBar";

/**
 * Phone and tablet terminal (< 1180 px): the market strip scrolls sideways,
 * chart / book / tape share one pane, the ropes log sits under it, and a
 * sticky LONG ▲ / SHORT ▼ pair opens the ticket as a bottom sheet.
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
    <div className="flex min-w-0 flex-col gap-3 pb-28">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <MarketButton compact />
        <ConnectionDot className="hidden min-[440px]:inline-flex" />
      </div>
      <div className="scrollbar-none overflow-x-auto px-4">
        <MarketStats compact />
      </div>
      <div className="scrollbar-none overflow-x-auto px-4 empty:hidden">
        <FavouriteStrip limit={6} />
      </div>
      <ViewAsBar />
      <div className="flex flex-col gap-2 px-4">
        <SegmentedControl<MobilePane>
          label="Market view"
          value={pane}
          onChange={(mobilePane) => set({ mobilePane })}
          fullWidth
          options={[
            { value: "chart", label: "Chart" },
            { value: "book", label: "Book" },
            { value: "trades", label: "Tape" },
          ]}
        />
        <div className="flex h-[400px] min-w-0 flex-col">
          {pane === "chart" ? <PriceChart className="h-full" /> : pane === "book" ? <OrderBook className="h-full" levels={8} /> : <TradesTape className="h-full" rows={17} />}
        </div>
      </div>
      <div className="px-4">
        <AccountPanel showLegend={false} className="min-h-[340px]" />
      </div>

      {!readOnly ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t-2 border-rule bg-paper px-4 py-2.5 md:bottom-0">
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-3">
            <button type="button" onClick={() => openTicket("buy")} className={buttonClasses({ variant: "long", size: "lg", fullWidth: true })}>
              <span aria-hidden="true" className="text-[11px]">
                ▲
              </span>
              {isSpot ? "Buy" : "Long"}
            </button>
            <button type="button" onClick={() => openTicket("sell")} className={buttonClasses({ variant: "short", size: "lg", fullWidth: true })}>
              <span aria-hidden="true" className="text-[11px]">
                ▼
              </span>
              {isSpot ? "Sell" : "Short"}
            </button>
          </div>
        </div>
      ) : null}
      <Sheet open={ticketOpen} onClose={() => set({ ticketOpen: false })} side="bottom" title={`${side === "buy" ? (isSpot ? "Buy" : "Long") : isSpot ? "Sell" : "Short"} ${marketTitle(market)}`}>
        <OrderTicket bare />
      </Sheet>
    </div>
  );
}
