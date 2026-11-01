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
        "tnum inline-flex h-5 shrink-0 items-center px-1.5 font-tag text-[10px] uppercase leading-none [box-shadow:inset_0_0_0_2px_currentColor]",
        market.kind === "spot" ? "text-water" : market.kind === "hip3" ? "text-ridge" : "text-ink",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** The market tab: opens the picker (also "/"). The market name is the headline of the sheet. */
export function MarketButton({ compact = false, fill = false }: { readonly compact?: boolean; readonly fill?: boolean }) {
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
        "px-frame px-drop px-press group inline-flex shrink-0 items-center gap-2.5 bg-card pl-3 pr-2.5 text-ink",
        compact ? "h-11" : "h-14",
        fill && "w-full",
        FOCUS_RING,
      )}
    >
      <span className="flex items-baseline gap-0.5">
        <span className={cx("font-display font-bold leading-none", compact ? "text-[22px]" : "text-[28px]")}>{base}</span>
        {suffix ? <span className="font-tag text-[11px] text-ink-2">{suffix}</span> : null}
      </span>
      {market ? <MarketBadge market={market} /> : null}
      <span className={cx("flex items-center gap-2", fill && "ml-auto")}>
        <ChevronDown className="h-4 w-4 text-ink-2" aria-hidden="true" />
        {!compact ? <KeyHint k="/" className="text-ink-3" /> : null}
      </span>
    </button>
  );
}

export function ConnectionDot({ className }: { readonly className?: string }) {
  const { mode } = useTerminal();
  const status = useSocketStatus(mode);
  const live = status === "open";
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap font-tag text-[11px] uppercase text-ink-2", className)} title={live ? "Live HyperCore WebSocket" : "Reconnecting to HyperCore"}>
      <span aria-hidden="true" className={cx("h-2 w-2 [box-shadow:0_0_0_2px_rgb(var(--rule))]", live ? "bg-up" : "bg-warn")} />
      Floor · {mode === "mainnet" ? "mainnet" : "testnet"} · {live ? "live" : status === "idle" ? "idle" : "reconnecting"}
    </span>
  );
}

/** One instrument on the strip: a caption over a mono reading, ruled off from its neighbour. */
function Instrument({ label, children, hint, className, centred = false }: { readonly label: ReactNode; readonly children: ReactNode; readonly hint?: string; readonly className?: string; readonly centred?: boolean }) {
  const body = (
    <div className={cx("flex min-w-0 flex-col justify-center gap-1.5 leading-none", centred ? "items-center text-center" : "border-l-2 border-dotted border-rule pl-4", className)} tabIndex={hint ? 0 : undefined}>
      <span className="whitespace-nowrap font-tag text-[11px] uppercase text-ink-3">{label}</span>
      <span className="tnum flex items-center gap-1.5 whitespace-nowrap font-mono text-[13px] text-ink">{children}</span>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

const WEATHER_KIND = { clear: "clear", "few-clouds": "few", overcast: "overcast", storm: "storm" } as const;

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
            className={cx("px-frame-thin inline-flex h-8 shrink-0 items-center gap-1.5 bg-card px-2 font-mono text-[11px] text-ink transition-colors duration-fast hover:bg-paper-2", FOCUS_RING)}
            title={`Trade ${marketTitle(market)}`}
          >
            <span className="font-display text-[13px] font-bold">{market.kind === "spot" ? market.displayName : market.base}</span>
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

/**
 * The desktop strip, on the terminal's three columns: the market tab over the
 * book rail, the instruments mirrored around the mark on the centre axis
 * (funding · weather | MARK | open interest · volume), the radio and
 * favourites over the ticket rail.
 */
export function MarketHeader() {
  const { market, ctx, now, mode } = useTerminal();
  const change = change24h(ctx);
  const sock = useFundingWindsock(market?.isSpot ? null : ctx, now);
  const { weather } = useVolatilityWeather(mode, market?.coin ?? null);
  const oi = openInterestUsd(ctx);
  const mark = ctx?.markPx ?? null;
  const markText = mark === null || !market ? "—" : formatPx(mark, market);
  const perp = market !== null && !market.isSpot;
  const funding = perp ? (
    <Instrument
      centred
      label={sock ? (sock.payer === "none" ? "Funding · calm" : `Funding · ${sock.payer === "longs" ? "▲" : "▼"} pay`) : "Funding"}
      hint={sock ? `${(sock.hourly * 100).toFixed(4)}% per hour, ${(sock.apr * 100).toFixed(1)}% a year. ${sock.payer === "none" ? "Nobody pays this hour." : `${sock.payer === "longs" ? "Longs pay shorts" : "Shorts pay longs"}; paid at the top of every hour.`}` : undefined}
    >
      <Windsock fundingApr={sock?.apr ?? null} size={14} />
      <span className={sock && sock.hourly < 0 ? "text-down" : "text-ink"}>{sock ? `${(sock.apr * 100).toFixed(Math.abs(sock.apr) >= 1 ? 0 : 1)}%` : "—"}</span>
      <span className="text-ink-3">{sock?.countdown ?? "--:--"}</span>
    </Instrument>
  ) : null;
  const weatherCell = (
    <Instrument centred label="Weather" hint={weather ? `Realised volatility ${(weather.volatility * 100).toFixed(0)}% a year: ${Math.round(weather.percentile * 100)}th percentile of the last 30 days of this market.` : "Reading the last 30 days of hourly candles."}>
      {weather ? (
        <>
          <Weather weather={WEATHER_KIND[weather.kind]} size={16} />
          <span>{(weather.volatility * 100).toFixed(0)}%</span>
          <span className="text-ink-3">p{Math.round(weather.percentile * 100)}</span>
        </>
      ) : (
        <span className="text-ink-3">reading…</span>
      )}
    </Instrument>
  );
  const left = perp ? [funding, weatherCell] : [weatherCell];
  const right = perp
    ? [
        <Instrument key="oi" centred label="Open interest">
          {formatUsdCompact(oi)}
        </Instrument>,
        <Instrument key="vol" centred label="24h volume">
          {formatUsdCompact(ctx?.dayNtlVlm ?? null)}
        </Instrument>,
      ]
    : [
        <Instrument key="vol" centred label="24h volume">
          {formatUsdCompact(ctx?.dayNtlVlm ?? null)}
        </Instrument>,
      ];
  return (
    <div className="grid shrink-0 grid-cols-[var(--tx-rail)_minmax(0,1fr)_var(--tx-rail)] items-center gap-5">
      <MarketButton fill />
      <div className="flex h-14 min-w-0 items-center">
        <div className="flex min-w-0 flex-1 items-center justify-evenly gap-2">
          {left.map((cell, index) => (
            <div key={index} className={cx("min-w-0", left.length > 1 && index === left.length - 1 && "hidden min-[1400px]:block")}>
              {cell}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 px-4 leading-none">
          <span className="font-tag text-[11px] uppercase text-ink-3">Mark · {marketTitle(market)}</span>
          <span className="flex items-baseline gap-2">
            <Altimeter value={markText} label={`${marketTitle(market)} mark price`} variant="inline" size="md" />
            <span className={cx("tnum inline-flex items-center gap-1 font-mono text-[13px] font-medium", signTone(change))}>
              <Chevron value={change} className="text-[10px]" />
              {signedPercent(change)}
            </span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-evenly gap-2">
          {right.map((cell, index) => (
            <div key={index} className={cx("min-w-0", right.length > 1 && index === 0 && "hidden min-[1400px]:block")}>
              {cell}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-14 min-w-0 flex-col items-end justify-center gap-1.5">
        <ConnectionDot />
        <FavouriteStrip limit={2} />
      </div>
    </div>
  );
}

/**
 * The phone strip, on the axis: the mark altimeter centred, then three equal
 * instruments (funding · weather · volume; spot: weather · volume).
 */
export function MobileStats() {
  const { market, ctx, now, mode } = useTerminal();
  const change = change24h(ctx);
  const sock = useFundingWindsock(market?.isSpot ? null : ctx, now);
  const { weather } = useVolatilityWeather(mode, market?.coin ?? null);
  const mark = ctx?.markPx ?? null;
  const markText = mark === null || !market ? "—" : formatPx(mark, market);
  const perp = market !== null && !market.isSpot;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-1 leading-none">
        <span className="font-tag text-[11px] uppercase text-ink-3">Mark</span>
        <span className="flex items-baseline gap-2">
          <Altimeter value={markText} label={`${marketTitle(market)} mark price`} variant="inline" size="lg" />
          <span className={cx("tnum inline-flex items-center gap-1 font-mono text-[13px] font-medium", signTone(change))}>
            <Chevron value={change} className="text-[10px]" />
            {signedPercent(change)}
          </span>
        </span>
      </div>
      <div className={cx("grid w-full gap-2", perp ? "grid-cols-3" : "grid-cols-2")}>
        {perp ? (
          <Instrument centred label={sock ? (sock.payer === "none" ? "Funding" : `Funding ${sock.payer === "longs" ? "▲" : "▼"}`) : "Funding"}>
            <span className={sock && sock.hourly < 0 ? "text-down" : "text-ink"}>{sock ? `${(sock.apr * 100).toFixed(Math.abs(sock.apr) >= 1 ? 0 : 1)}%` : "—"}</span>
          </Instrument>
        ) : null}
        <Instrument centred label="Weather">
          {weather ? (
            <>
              <Weather weather={WEATHER_KIND[weather.kind]} size={14} />
              <span>{(weather.volatility * 100).toFixed(0)}%</span>
            </>
          ) : (
            <span className="text-ink-3">…</span>
          )}
        </Instrument>
        <Instrument centred label="24h vol">
          {formatUsdCompact(ctx?.dayNtlVlm ?? null)}
        </Instrument>
      </div>
    </div>
  );
}
