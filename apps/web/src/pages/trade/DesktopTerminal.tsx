import type { CSSProperties } from "react";

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

/** Book and tape stack when the rail is tall enough to give each real depth; otherwise they share it as tabs. */
const STACK_FROM_PX = 600;

/** BOOK · TAPE as the panel's own title when the two share the rail. */
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
          className={cx("h-6 px-2 font-tag text-[11px] uppercase", pane === id ? "bg-ink text-paper" : "text-ink-3 hover:text-ink", FOCUS_RING)}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

function BookRail() {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const pane = useTerminalUi((state) => state.sidePane);
  const stacked = box.height >= STACK_FROM_PX;
  return (
    <div ref={ref} className="flex min-h-0 flex-col gap-5">
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
 * Desktop terminal (>= 1180 px). One centre axis, two equal rails:
 *
 *   [ market tab ] [ funding · weather | MARK | OI · volume ] [ radio · favourites ]
 *   [ book       ] [ elevation chart                        ] [ ticket card        ]
 *   [ tape       ] [ ropes · orders · fills log             ] [                    ]
 *
 * The book rail and the ticket rail are the same width and the same height,
 * so the chart and the ropes sit on the axis. It fills the viewport; each
 * panel scrolls on its own; the ticket is the one raised card.
 */
export function DesktopTerminal() {
  return (
    <div
      className="flex h-[calc(100dvh-116px)] min-h-[700px] flex-col gap-5 px-6 pb-7 pt-5 [--tx-rail:288px] md:-mb-6 xl:[--tx-rail:312px] min-[1600px]:[--tx-rail:336px]"
      style={{ "--tx-gap": "20px" } as CSSProperties}
    >
      <MarketHeader />
      <ViewAsBar />
      <div className="grid min-h-0 flex-1 grid-cols-[var(--tx-rail)_minmax(0,1fr)_var(--tx-rail)] gap-5">
        <BookRail />
        <div className="flex min-h-0 min-w-0 flex-col gap-5">
          <PriceChart className="min-h-[260px] flex-[11]" />
          <AccountPanel className="min-h-[220px] flex-[8]" />
        </div>
        <aside aria-label="Order ticket" className="-mb-4 -ml-1 -mr-4 -mt-1 min-h-0 overflow-y-auto overscroll-contain pb-4 pl-1 pr-4 pt-1">
          <OrderTicket />
        </aside>
      </div>
    </div>
  );
}
