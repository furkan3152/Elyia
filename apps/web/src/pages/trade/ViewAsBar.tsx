import { X } from "lucide-react";

import { routeHref } from "../../app/routes/routeTable";
import { AddressPill } from "../../ui/AddressPill";
import { ButtonLink } from "../../ui/Button";
import { usd } from "./labels";
import { useTerminal } from "./terminalContext";

/**
 * "View as" mode (?as=0x…): any account's ropes, orders and fills, live and
 * read only. Marked with the yellow "you are here" highlight so it is never
 * mistaken for your own sheet.
 */
export function ViewAsBar() {
  const { viewAs, readOnly, feeds, market, endpoints } = useTerminal();
  if (!viewAs || !readOnly) return null;
  const positions = feeds.positions?.length ?? null;
  const orders = feeds.openOrders?.length ?? null;
  return (
    <div className="mx-4 mb-2.5 flex shrink-0 lg:mx-3 flex-wrap items-center gap-x-3 gap-y-1.5 border-2 border-rule bg-signal/30 py-1.5 pl-0 pr-2 text-[13px]">
      <span className="self-stretch border-r-2 border-rule bg-signal px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase leading-[22px] tracking-[0.14em] text-signal-ink">Surveying</span>
      <AddressPill address={viewAs} network={endpoints.networkKey} />
      <span className="tnum w-full px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2 md:w-auto md:px-0">
        read only
        {feeds.summary ? ` · equity ${usd(feeds.summary.accountValue, 0)}` : ""}
        {positions !== null ? ` · ${positions} rope${positions === 1 ? "" : "s"}` : ""}
        {orders !== null ? ` · ${orders} order${orders === 1 ? "" : "s"}` : ""}
        {" · nothing can be signed"}
      </span>
      <ButtonLink to={routeHref("trade", { market: market?.slug ?? "BTC" })} variant="ghost" size="xs" className="ml-auto" leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}>
        Back to my sheet
      </ButtonLink>
    </div>
  );
}
