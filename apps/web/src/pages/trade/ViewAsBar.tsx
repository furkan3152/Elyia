import { X } from "lucide-react";

import { routeHref } from "../../app/routes/routeTable";
import { Ely } from "../../pixel/Ely";
import { AddressPill } from "../../ui/AddressPill";
import { ButtonLink } from "../../ui/Button";
import { usd } from "./labels";
import { useTerminal } from "./terminalContext";

/**
 * "View as" mode (?as=0x…): any account's ropes, orders and fills, live and
 * read only. A sun-yellow survey strip with Ely on watch, so it is never
 * mistaken for your own sheet.
 */
export function ViewAsBar() {
  const { viewAs, readOnly, feeds, market, endpoints } = useTerminal();
  if (!viewAs || !readOnly) return null;
  const positions = feeds.positions?.length ?? null;
  const orders = feeds.openOrders?.length ?? null;
  return (
    <div className="px-frame-thin flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-signal/25 py-1.5 pl-1 pr-2 text-[13px]">
      <span className="flex items-center gap-1 self-stretch bg-signal pr-3 text-signal-ink">
        <Ely state="watch" size={34} label={null} className="-my-1" />
        <span className="font-tag text-[11px] uppercase">Surveying</span>
      </span>
      <AddressPill address={viewAs} network={endpoints.networkKey} />
      <span className="tnum w-full px-2.5 font-tag text-[11px] uppercase text-ink-2 md:w-auto md:px-0">
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
