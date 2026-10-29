import { ChevronDown, Star } from "lucide-react";
import type { ReactNode } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { useTradeStore } from "../../features/trading/tradeStore";
import { useFundingWindsock, useVolatilityWeather } from "../../features/trading/useTopoData";
import { formatUsdCompact } from "../../lib/format";
import { useSocketStatus } from "../../lib/hypercore/feeds";
import { change24h, formatPx, openInterestUsd, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { Altimeter } from "../../topo/Altimeter";
import { Weather } from "../../topo/Weather";
import { Windsock } from "../../topo/Windsock";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Tooltip } from "../../ui/Tooltip";
import { marketTitle, signedPercent } from "./labels";
import { Chevron, KeyHint } from "./parts";
import { signTone } from "./survey";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/** "25×" perps, "SPOT", or the HIP-3 dex name, as a small bordered chip. */
export function MarketBadge({ market, className }: { readonly market: TradeMarket; readonly className?: string }) {
  const label = market.kind === "spot" ? "SPOT" : market.kind === "hip3" ? market.dex.toUpperCase() : `${market.maxLeverage ?? 1}×`;
  return (
    <span
      className={cx(
        "tnum inline-flex h-5 shrink-0 items-center border-1.5 px-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.08em]",
        market.kind === "spot" ? "border-water text-water" : market.kind === "hip3" ? "border-ridge text-ridge" : "border-rule text-ink",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** The market tab: opens the picker (also "/"). The market name is the headline of the sheet. */
export function MarketButton({ compact = false }: { readonly compact?: boolean }) {
  const { market } = useTerminal();
  const open = () => useTerminalUi.getState().set({ pickerOpen: true });
  const base = market ? (market.kind === "spot" ? market.displayName : market.base) : "—";
  const suffix = market?.kind === "perp" ? "-PERP" : null;
  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-label={`Market ${marketTitle(market)}. Change market (slash)`}
      className={cx(
        "group inline-flex shrink-0 items-center gap-2.5 border-2 border-rule bg-card pl-3 pr-2 text-ink shadow-hard transition-[transform,box-shadow] duration-fast hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
        compact ? "h-11" : "h-12",
        FOCUS_RING,
      )}
    >
      <span className="flex items-baseline gap-0.5">
        <span className={cx("font-sans font-bold leading-none tracking-[-0.02em]", compact ? "text-[20px]" : "text-[24px]")}>{base}</span>
        {suffix ? <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ink-2">{suffix}</span> : null}
      </span>
      {market ? <MarketBadge market={market} /> : null}
      <ChevronDown className="h-4 w-4 text-ink-2 transition-transform duration-fast group-hover:translate-y-px" aria-hidden="true" />
      {!compact ? <KeyHint k="/" className="text-ink-3" /> : null}
    </button>
  );
}

export function ConnectionDot({ className }: { readonly className?: string }) {
  const { mode } = useTerminal();
  const status = useSocketStatus(mode);
  const live = status === "open";
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2", className)} title={live ? "Live HyperCore WebSocket" : "Reconnecting to HyperCore"}>
      <span aria-hidden="true" className={cx("h-2 w-2 rotate-45 border-1.5 border-rule", live ? "bg-up" : "el-loop animate-breathe bg-warn")} />
      FLOOR · {mode === "mainnet" ? "HyperCore" : "HyperCore testnet"} · {live ? "live" : status === "idle" ? "idle" : "reconnecting"}
    </span>
  );
}

/** One instrument on the strip: a caption over a mono reading, ruled off from its neighbour. */
function Instrument({ label, children, hint, className }: { readonly label: ReactNode; readonly children: ReactNode; readonly hint?: string; readonly className?: string }) {
  const body = (
    <div className={cx("flex min-w-0 flex-col justify-center gap-1 border-l-1.5 border-rule/25 pl-4 leading-none", className)} tabIndex={hint ? 0 : undefined}>
      <span className="caption whitespace-nowrap !text-[11px] !tracking-[0.12em] !text-ink-3">{label}</span>
      <span className="tnum flex items-center gap-1.5 whitespace-nowrap font-mono text-[13px] text-ink">{children}</span>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

const WEATHER_KIND = { clear: "clear", "few-clouds": "few", overcast: "overcast", storm: "storm" } as const;

/** Mark (altimeter), 24 h change, funding windsock, volatility weather, open interest, volume. */
export function MarketStats({ compact = false }: { readonly compact?: boolean }) {
  const { market, ctx, now, mode } = useTerminal();
  const change = change24h(ctx);
  const sock = useFundingWindsock(market?.isSpot ? null : ctx, now);
  const { weather } = useVolatilityWeather(mode, market?.coin ?? null);
  const oi = openInterestUsd(ctx);
  const mark = ctx?.markPx ?? null;
  const markText = mark === null || !market ? "—" : formatPx(mark, market);
  return (
    <div className={cx("flex min-w-0 items-stretch", compact ? "gap-4" : "gap-4 xl:gap-5")}>
      <div className="flex shrink-0 flex-col justify-center gap-1 leading-none">
        <span className="caption !text-[11px] !tracking-[0.12em] !text-ink-3">MARK</span>
        <span className="flex items-baseline gap-2">
          <Altimeter value={markText} label={`${marketTitle(market)} mark price`} variant="inline" size="md" className={cx(compact ? "[&_.el-digit]:text-[20px]" : "[&_.el-digit]:text-[24px]")} />
          <span className={cx("tnum inline-flex items-center gap-1 font-mono text-[13px] font-medium", signTone(change))}>
            <Chevron value={change} className="text-[10px]" />
            {signedPercent(change)}
          </span>
        </span>
      </div>
      {market && !market.isSpot ? (
        <Instrument
          label={sock ? `FUNDING · ${sock.payer === "none" ? "CALM" : `${sock.payer.toUpperCase()} PAY`}` : "FUNDING"}
          hint={sock ? `${(sock.hourly * 100).toFixed(4)}% per hour, ${(sock.apr * 100).toFixed(1)}% a year. ${sock.payer === "none" ? "Nobody pays this hour." : `${sock.payer === "longs" ? "Longs pay shorts" : "Shorts pay longs"}; paid at the top of every hour.`}` : undefined}
        >
          <Windsock fundingApr={sock?.apr ?? null} size={14} />
          <span className={sock && sock.hourly < 0 ? "text-down" : "text-ink"}>{sock ? `${(sock.apr * 100).toFixed(Math.abs(sock.apr) >= 1 ? 0 : 1)}%` : "—"}</span>
          <span className="text-ink-3">APR · {sock?.countdown ?? "--:--"}</span>
        </Instrument>
      ) : null}
      <Instrument
        label="WEATHER"
        hint={weather ? `Realised volatility ${(weather.volatility * 100).toFixed(0)}% a year: ${Math.round(weather.percentile * 100)}th percentile of the last 30 days of this market.` : "Reading the last 30 days of hourly candles."}
      >
        {weather ? (
          <>
            <Weather weather={WEATHER_KIND[weather.kind]} size={16} />
            <span>{(weather.volatility * 100).toFixed(0)}%</span>
            <span className="text-ink-3">vol · p{Math.round(weather.percentile * 100)}</span>
          </>
        ) : (
          <span className="text-ink-3">reading…</span>
        )}
      </Instrument>
      {!compact && market && !market.isSpot ? <Instrument label="OPEN INTEREST">{formatUsdCompact(oi)}</Instrument> : null}
      {!compact ? <Instrument label="24H VOLUME">{formatUsdCompact(ctx?.dayNtlVlm ?? null)}</Instrument> : null}
      {!compact && market && !market.isSpot ? (
        <Instrument label="ORACLE" className="hidden 2xl:flex">
          {formatPx(ctx?.oraclePx ?? null, market)}
        </Instrument>
      ) : null}
    </div>
  );
}

/** Starred markets as quick switches with their 24 h change (★ in the picker adds one). */
export function FavouriteStrip({ limit = 4, className }: { readonly limit?: number; readonly className?: string }) {
  const { markets, market: active, viewAs } = useTerminal();
  const favorites = useTradeStore((state) => state.favorites);
  const byCoin = new Map(markets.map((market) => [market.coin, market]));
  const rows = favorites
    .map((coin) => byCoin.get(coin))
    .filter((market): market is TradeMarket => market !== undefined && market.coin !== active?.coin)
    .slice(0, limit);
  if (rows.length === 0) return null;
  return (
    <nav aria-label="Favourite markets" className={cx("flex min-w-0 items-center gap-1.5", className)}>
      <Star className="h-3.5 w-3.5 shrink-0 fill-signal text-ink" aria-hidden="true" />
      {rows.map((market) => {
        const change = change24h(market.ctx);
        return (
          <button
            key={market.coin}
            type="button"
            onClick={() => navigate(`${routeHref("trade", { market: market.slug })}${viewAs ? `?as=${viewAs}` : ""}`)}
            className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 border-1.5 border-rule/40 bg-card px-2 font-mono text-[11px] text-ink transition-colors duration-fast hover:border-rule", FOCUS_RING)}
            title={`Trade ${marketTitle(market)}`}
          >
            <span className="font-sans text-[12px] font-bold">{market.kind === "spot" ? market.displayName : market.base}</span>
            <span className={cx("tnum inline-flex items-center gap-0.5", signTone(change))}>
              <Chevron value={change} className="text-[8px]" />
              {signedPercent(change, 1)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function MarketHeader() {
  return (
    <div className="flex shrink-0 items-center gap-5 px-3 pb-2.5 pt-3">
      <MarketButton />
      <MarketStats />
      <div className="ml-auto flex min-w-0 items-center gap-4">
        <FavouriteStrip className="hidden min-[1400px]:flex" limit={3} />
      </div>
    </div>
  );
}
