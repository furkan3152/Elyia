import { ChevronDown, Search } from "lucide-react";
import type { ReactNode } from "react";

import { formatUsdCompact } from "../../lib/format";
import { useSocketStatus } from "../../lib/hypercore/feeds";
import { change24h, formatCountdown, formatPx, fundingApr, msToNextFunding, openInterestUsd, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { NumberTicker } from "../../ui/NumberTicker";
import { Tooltip } from "../../ui/Tooltip";
import { marketTitle, signedPercent } from "./labels";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

export function MarketBadge({ market, className }: { readonly market: TradeMarket; readonly className?: string }) {
  const label = market.kind === "spot" ? "SPOT" : market.kind === "hip3" ? market.dex.toUpperCase() : `${market.maxLeverage ?? 1}×`;
  return (
    <span
      className={cx(
        "tnum inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px] leading-none",
        market.kind === "spot" ? "bg-sky/[0.14] text-sky" : market.kind === "hip3" ? "bg-violet-glow/[0.16] text-violet-soft" : "bg-gold/[0.14] text-gold",
        className,
      )}
    >
      {label}
    </span>
  );
}

function Stat({ label, children, hint }: { readonly label: string; readonly children: ReactNode; readonly hint?: string }) {
  const body = (
    <div className="flex min-w-0 flex-col leading-tight" tabIndex={hint ? 0 : undefined}>
      <span className="whitespace-nowrap font-mono text-[11px] text-text-2">{label}</span>
      <span className="tnum whitespace-nowrap font-mono text-[13px] text-text-0">{children}</span>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

/** The market button: opens the picker (also "/"). */
export function MarketButton({ compact = false }: { readonly compact?: boolean }) {
  const { market } = useTerminal();
  const open = () => useTerminalUi.getState().set({ pickerOpen: true });
  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-label={`Market ${marketTitle(market)}. Change market`}
      className={cx(
        "group inline-flex h-10 shrink-0 items-center gap-2.5 rounded-xl border border-line-strong bg-bg-1/80 px-3 text-text-0 transition-colors hover:border-violet-glow/40",
        FOCUS_RING,
      )}
    >
      <span className={cx("font-semibold tracking-tight", compact ? "text-[15px]" : "text-base")}>{marketTitle(market)}</span>
      {market ? <MarketBadge market={market} /> : null}
      <ChevronDown className="h-4 w-4 text-text-2 transition-colors group-hover:text-text-0" aria-hidden="true" />
      {!compact ? (
        <span className="ml-1 hidden items-center gap-1 text-text-2 xl:inline-flex">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <Kbd>/</Kbd>
        </span>
      ) : null}
    </button>
  );
}

export function ConnectionDot() {
  const { mode } = useTerminal();
  const status = useSocketStatus(mode);
  const live = status === "open";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-text-2" title={live ? "Live HyperCore WebSocket" : "Reconnecting to HyperCore"}>
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-mint" : "el-loop animate-breathe bg-gold")} />
      HyperCore {mode} · {live ? "live" : status === "idle" ? "idle" : "reconnecting"}
    </span>
  );
}

/** Mark, 24 h change, funding (hourly, APR, countdown), open interest and volume. */
export function MarketStats({ compact = false }: { readonly compact?: boolean }) {
  const { market, ctx, now } = useTerminal();
  const change = change24h(ctx);
  const funding = ctx?.funding ?? null;
  const apr = fundingApr(funding);
  const oi = openInterestUsd(ctx);
  const tone = change === null ? "text-text-0" : change >= 0 ? "text-mint" : "text-rose";
  return (
    <div className={cx("flex min-w-0 items-center", compact ? "gap-4" : "gap-5 xl:gap-6")}>
      <div className="flex flex-col leading-tight">
        <span className="font-mono text-[11px] text-text-2">mark</span>
        <NumberTicker value={ctx?.markPx ?? null} format={(value) => formatPx(Number(value), market)} className={cx("font-mono font-medium", compact ? "text-[15px]" : "text-base", tone)} />
      </div>
      <Stat label="24h">
        <span className={tone}>{signedPercent(change)}</span>
      </Stat>
      {market && !market.isSpot ? (
        <Stat label="funding / h" hint={apr === null ? undefined : `${(apr * 100).toFixed(2)}% APR. Paid every hour: longs pay shorts when positive.`}>
          <span className="text-gold">
            {funding === null ? "—" : `${(funding * 100).toFixed(4)}%`}
            <span className="text-text-2"> · {formatCountdown(msToNextFunding(now))}</span>
          </span>
        </Stat>
      ) : null}
      {!compact && market && !market.isSpot ? <Stat label="open interest">{formatUsdCompact(oi)}</Stat> : null}
      {!compact ? <Stat label="24h volume">{formatUsdCompact(ctx?.dayNtlVlm ?? null)}</Stat> : null}
      {!compact && market && !market.isSpot ? (
        <span className="hidden 2xl:block">
          <Stat label="oracle">{formatPx(ctx?.oraclePx ?? null, market)}</Stat>
        </span>
      ) : null}
    </div>
  );
}

export function MarketHeader() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg-0/60 px-4 backdrop-blur-sm">
      <MarketButton />
      <MarketStats />
      <div className="ml-auto hidden xl:block">
        <ConnectionDot />
      </div>
    </div>
  );
}
