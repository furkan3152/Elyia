import { Eye, X } from "lucide-react";

import { routeHref } from "../../app/routes/routeTable";
import { AddressPill } from "../../ui/AddressPill";
import { ButtonLink } from "../../ui/Button";
import { usd } from "./labels";
import { useTerminal } from "./terminalContext";

/** "View as" mode (?as=0x…): any account's positions, orders and fills, live and read only. */
export function ViewAsBar() {
  const { viewAs, readOnly, feeds, market, endpoints } = useTerminal();
  if (!viewAs || !readOnly) return null;
  const positions = feeds.positions?.length ?? null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-violet-glow/25 bg-violet/[0.08] px-4 py-2 text-[13px]">
      <Eye className="h-4 w-4 text-violet-soft" aria-hidden="true" />
      <span className="text-text-0">Viewing</span>
      <AddressPill address={viewAs} network={endpoints.networkKey} />
      <span className="font-mono text-xs text-text-1">
        read only
        {feeds.summary ? ` · account ${usd(feeds.summary.accountValue, 0)}` : ""}
        {positions !== null ? ` · ${positions} position${positions === 1 ? "" : "s"}` : ""}
      </span>
      <ButtonLink to={routeHref("trade", { market: market?.slug ?? "BTC" })} variant="ghost" size="xs" className="ml-auto" leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}>
        Exit view
      </ButtonLink>
    </div>
  );
}
