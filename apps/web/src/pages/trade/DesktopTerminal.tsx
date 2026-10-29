import { AccountPanel } from "./AccountPanel";
import { MarketHeader } from "./MarketHeader";
import { OrderBook } from "./OrderBook";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { TradesTape } from "./TradesTape";
import { ViewAsBar } from "./ViewAsBar";

/**
 * Desktop terminal (>= 1024 px), as in the approved mockup: chart and
 * account tabs | book and trades | ticket. It fills the viewport under the
 * top bar; each column scrolls on its own.
 */
export function DesktopTerminal() {
  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h))] min-h-[620px] flex-col md:-mb-12">
      <MarketHeader />
      <ViewAsBar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_268px_312px] gap-px bg-[var(--line)] xl:grid-cols-[minmax(0,1fr)_292px_340px]">
        <section aria-label="Chart and account" className="flex min-h-0 min-w-0 flex-col bg-bg-0">
          <PriceChart className="min-h-[240px] flex-1" />
          <AccountPanel className="h-[262px] shrink-0 border-t border-line 2xl:h-[300px]" />
        </section>
        <section aria-label="Book and trades" className="flex min-h-0 flex-col bg-bg-0">
          <OrderBook className="min-h-0 flex-[3]" />
          <TradesTape className="min-h-0 flex-[2] border-t border-line" />
        </section>
        <aside aria-label="Order ticket" className="min-h-0 overflow-y-auto bg-[rgb(var(--bg-1)/0.55)] p-4">
          <OrderTicket />
        </aside>
      </div>
    </div>
  );
}
