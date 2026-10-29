import { cx, FOCUS_RING } from "../../ui/cx";
import { AccountPanel } from "./AccountPanel";
import { MarketHeader } from "./MarketHeader";
import { OrderBook } from "./OrderBook";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { TradesTape } from "./TradesTape";
import { useTerminalUi, type SidePane } from "./terminalUi";
import { useBoxSize } from "./useBoxSize";
import { ViewAsBar } from "./ViewAsBar";

/** Book and tape stack when the column is tall enough to give each real depth; otherwise they share it as tabs. */
const STACK_FROM_PX = 600;

/** BOOK · TAPE as the panel's own title when the two share a column. */
function PaneTabs({ pane }: { readonly pane: SidePane }) {
  return (
    <span role="tablist" aria-label="Book or tape" className="flex items-center gap-1">
      {(["book", "tape"] as const satisfies readonly SidePane[]).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={pane === id}
          onClick={() => useTerminalUi.getState().set({ sidePane: id })}
          className={cx("h-6 px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em]", pane === id ? "bg-ink text-paper" : "text-ink-3 hover:text-ink", FOCUS_RING)}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

function BookColumn() {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const pane = useTerminalUi((state) => state.sidePane);
  const stacked = box.height >= STACK_FROM_PX;
  return (
    <div ref={ref} className="flex min-h-0 flex-col gap-2.5">
      {stacked ? (
        <>
          <OrderBook className="min-h-0 flex-[3]" />
          <TradesTape className="min-h-0 flex-[2]" />
        </>
      ) : pane === "book" ? (
        <OrderBook className="min-h-0 flex-1" heading={<PaneTabs pane={pane} />} />
      ) : (
        <TradesTape className="min-h-0 flex-1" heading={<PaneTabs pane={pane} />} />
      )}
    </div>
  );
}

/**
 * Desktop terminal (>= 1180 px), one map sheet under the top bar:
 *
 *   market strip (name tab · mark altimeter · windsock · weather · OI · volume · favourites)
 *   [ elevation chart | book / tape ] [ ticket card ]
 *   [ ropes · orders · fills log    ] [            ]
 *
 * It fills the viewport; each panel scrolls on its own, the ticket is the one raised card.
 */
export function DesktopTerminal() {
  return (
    <div className="flex h-[calc(100dvh-96px)] min-h-[640px] flex-col md:-mb-6">
      <MarketHeader />
      <ViewAsBar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_264px_340px] grid-rows-[minmax(0,1fr)_minmax(210px,37%)] gap-2.5 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_292px_352px]">
        <PriceChart className="min-h-[240px]" />
        <BookColumn />
        <aside aria-label="Order ticket" className="row-span-2 min-h-0 overflow-y-auto overscroll-contain pb-1.5 pr-1.5">
          <OrderTicket className="el-rise" />
        </aside>
        <AccountPanel className="col-span-2 min-h-0" />
      </div>
    </div>
  );
}
