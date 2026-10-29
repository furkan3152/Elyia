import { Search, Star } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { useTradeStore } from "../../features/trading/tradeStore";
import { formatUsdCompact } from "../../lib/format";
import { change24h, filterMarkets, formatPx, type MarketTab, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Dialog } from "../../ui/Dialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { marketTitle, signedPercent } from "./labels";
import { MarketBadge } from "./MarketHeader";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

const ROW_LIMIT = 160;

function Row({ market, active, highlighted, favorite, onPick, onStar, onHover }: { readonly market: TradeMarket; readonly active: boolean; readonly highlighted: boolean; readonly favorite: boolean; readonly onPick: () => void; readonly onStar: () => void; readonly onHover: () => void }) {
  const change = change24h(market.ctx);
  return (
    <li
      role="option"
      aria-selected={highlighted}
      id={`mk-${market.coin}`}
      onPointerEnter={onHover}
      className={cx(
        "grid cursor-pointer grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_76px_minmax(0,0.9fr)] items-center gap-2 rounded-lg px-2 py-2 font-mono text-[13px] sm:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_76px_minmax(0,0.9fr)_minmax(0,0.9fr)]",
        highlighted ? "bg-violet/[0.14]" : "hover:bg-text-0/[0.04]",
        active && "ring-1 ring-inset ring-violet-glow/40",
      )}
      onClick={onPick}
    >
      <button
        type="button"
        aria-label={favorite ? `Remove ${market.displayName} from favorites` : `Add ${market.displayName} to favorites`}
        aria-pressed={favorite}
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
        className={cx("inline-flex h-7 w-7 items-center justify-center rounded-md text-text-2 hover:text-gold", FOCUS_RING)}
      >
        <Star className={cx("h-4 w-4", favorite && "fill-gold text-gold")} aria-hidden="true" />
      </button>
      <span className="flex min-w-0 items-center gap-2 font-sans">
        <span className="truncate font-semibold text-text-0">{marketTitle(market)}</span>
        <MarketBadge market={market} />
      </span>
      <span className="tnum truncate text-right text-text-0">{formatPx(market.ctx?.markPx ?? null, market)}</span>
      <span className={cx("tnum text-right", change === null ? "text-text-2" : change >= 0 ? "text-mint" : "text-rose")}>{signedPercent(change)}</span>
      <span className="tnum truncate text-right text-text-1">{formatUsdCompact(market.ctx?.dayNtlVlm ?? null)}</span>
      <span className="tnum hidden truncate text-right text-gold sm:block">
        {market.ctx?.funding !== null && market.ctx?.funding !== undefined ? `${(market.ctx.funding * 100).toFixed(4)}%` : <span className="text-text-2">—</span>}
      </span>
    </li>
  );
}

export function MarketPicker() {
  const open = useTerminalUi((state) => state.pickerOpen);
  const close = () => useTerminalUi.getState().set({ pickerOpen: false });
  return (
    <Dialog open={open} onClose={close} title="Markets" description="HyperCore perps, HIP-3 builder markets and spot, by 24 h volume." size="lg">
      {open ? <PickerBody onClose={close} /> : null}
    </Dialog>
  );
}

function PickerBody({ onClose }: { readonly onClose: () => void }) {
  const { markets, market: active, viewAs, catalogLoading } = useTerminal();
  const favorites = useTradeStore((state) => state.favorites);
  const toggleFavorite = useTradeStore((state) => state.toggleFavorite);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MarketTab>(active?.kind ?? "perp");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(() => {
    // A search looks across every kind; the tabs browse.
    if (query.trim()) {
      return (["perp", "hip3", "spot"] as const).flatMap((kind) => filterMarkets(markets, { tab: kind, query, favorites: favoriteSet, limit: 60 })).sort((a, b) => (b.ctx?.dayNtlVlm ?? 0) - (a.ctx?.dayNtlVlm ?? 0)).slice(0, ROW_LIMIT);
    }
    return filterMarkets(markets, { tab, favorites: favoriteSet, limit: ROW_LIMIT });
  }, [markets, query, tab, favoriteSet]);
  const counts = useMemo(() => ({ perp: markets.filter((m) => m.kind === "perp" && !m.isDelisted).length, hip3: markets.filter((m) => m.kind === "hip3" && !m.isDelisted).length, spot: markets.filter((m) => m.kind === "spot").length }), [markets]);
  const current = Math.min(highlight, Math.max(0, rows.length - 1));

  const pick = (market: TradeMarket) => {
    onClose();
    navigate(`${routeHref("trade", { market: market.slug })}${viewAs ? `?as=${viewAs}` : ""}`);
  };

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    setHighlight(next);
    const id = rows[next] ? `mk-${rows[next].coin}` : null;
    if (id) listRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-bg-2/60 px-3 focus-within:border-violet-glow/70">
        <Search className="h-4 w-4 text-text-2" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const target = rows[current];
              if (target) pick(target);
            }
          }}
          placeholder={`Search ${counts.perp} perps, HIP-3 and ${counts.spot} spot pairs`}
          aria-label="Search markets"
          aria-controls="market-list"
          aria-activedescendant={rows[current] ? `mk-${rows[current].coin}` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-text-0 outline-none placeholder:text-text-2"
        />
        <span className="hidden font-mono text-xs text-text-2 sm:inline">↑↓ · Enter</span>
      </label>
      {!query.trim() ? (
        <SegmentedControl<MarketTab>
          label="Market kind"
          value={tab}
          onChange={(value) => {
            setTab(value);
            setHighlight(0);
          }}
          size="sm"
          options={[
            { value: "favorites", label: `★ ${favorites.length}` },
            { value: "perp", label: `Perps ${counts.perp || ""}`.trim() },
            { value: "hip3", label: `HIP-3 ${counts.hip3 || ""}`.trim(), hint: "Builder-deployed perp dexes (stocks, FX, test markets)" },
            { value: "spot", label: `Spot ${counts.spot || ""}`.trim() },
          ]}
        />
      ) : null}
      <div className="grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_76px_minmax(0,0.9fr)] gap-2 px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-2 sm:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_76px_minmax(0,0.9fr)_minmax(0,0.9fr)]">
        <span />
        <span>Market</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h</span>
        <span className="text-right">Volume</span>
        <span className="hidden text-right sm:block">Funding/h</span>
      </div>
      <ul id="market-list" ref={listRef} role="listbox" aria-label="Markets" className="-mx-1 max-h-[52dvh] overflow-y-auto px-1">
        {catalogLoading && rows.length === 0
          ? Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="px-2 py-2">
                <Skeleton className="h-6 w-full" />
              </li>
            ))
          : rows.map((market, index) => (
              <Row
                key={market.coin}
                market={market}
                active={market.coin === active?.coin}
                highlighted={index === current}
                favorite={favoriteSet.has(market.coin)}
                onPick={() => pick(market)}
                onStar={() => toggleFavorite(market.coin)}
                onHover={() => setHighlight(index)}
              />
            ))}
        {!catalogLoading && rows.length === 0 ? (
          <li className="px-2 py-8 text-center text-sm text-text-2">{tab === "favorites" && !query ? "Star markets to keep them here." : tab === "hip3" && !query ? "Loading HIP-3 dexes…" : `No market matches “${query}”.`}</li>
        ) : null}
      </ul>
    </div>
  );
}
