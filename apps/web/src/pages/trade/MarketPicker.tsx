import { Search, Star } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { useTradeStore } from "../../features/trading/tradeStore";
import { formatUsdCompact } from "../../lib/format";
import { change24h, filterMarkets, formatPx, fundingApr, openInterestUsd, type MarketTab, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { fieldBoxClasses } from "../../ui/fieldStyles";
import { Dialog } from "../../ui/Dialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Skeleton } from "../../ui/Skeleton";
import { marketTitle, signedPercent } from "./labels";
import { MarketBadge } from "./MarketHeader";
import { Chevron } from "./parts";
import { signTone } from "./survey";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

const ROW_LIMIT = 160;

type SortKey = "volume" | "change" | "funding" | "oi";

const SORTS: readonly { readonly id: SortKey; readonly label: string; readonly hint: string }[] = [
  { id: "volume", label: "Volume", hint: "24 h notional volume, largest first" },
  { id: "change", label: "Movers", hint: "Largest 24 h move either way" },
  { id: "funding", label: "Funding", hint: "Strongest funding either way (who pays the most)" },
  { id: "oi", label: "OI", hint: "Open interest, largest first" },
];

function sortValue(market: TradeMarket, key: SortKey): number {
  if (key === "change") return Math.abs(change24h(market.ctx) ?? 0);
  if (key === "funding") return Math.abs(market.ctx?.funding ?? 0);
  if (key === "oi") return openInterestUsd(market.ctx) ?? 0;
  return market.ctx?.dayNtlVlm ?? 0;
}

const GRID = "grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_84px_minmax(0,0.9fr)] items-center gap-2 sm:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_84px_minmax(0,0.9fr)_minmax(0,0.9fr)]";

function Row({ market, active, highlighted, favorite, onPick, onStar, onHover }: { readonly market: TradeMarket; readonly active: boolean; readonly highlighted: boolean; readonly favorite: boolean; readonly onPick: () => void; readonly onStar: () => void; readonly onHover: () => void }) {
  const change = change24h(market.ctx);
  const apr = fundingApr(market.ctx?.funding ?? null);
  return (
    <li
      role="option"
      aria-selected={highlighted}
      id={`mk-${market.coin}`}
      onPointerEnter={onHover}
      className={cx(GRID, "relative cursor-pointer border-b border-rule/15 px-2 py-1.5 font-mono text-[13px]", highlighted ? "bg-paper-2" : "", active && "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:bg-signal")}
      onClick={onPick}
    >
      <button
        type="button"
        aria-label={favorite ? `Remove ${market.displayName} from favourites` : `Add ${market.displayName} to favourites`}
        aria-pressed={favorite}
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
        className={cx("inline-flex h-7 w-7 items-center justify-center text-ink-3 hover:text-ink", FOCUS_RING)}
      >
        <Star className={cx("h-4 w-4", favorite && "fill-signal text-ink")} aria-hidden="true" />
      </button>
      <span className="flex min-w-0 items-center gap-2 font-sans">
        <span className="truncate text-[14px] font-bold text-ink">{marketTitle(market)}</span>
        <MarketBadge market={market} />
      </span>
      <span className="tnum truncate text-right text-ink">{formatPx(market.ctx?.markPx ?? null, market)}</span>
      <span className={cx("tnum inline-flex items-center justify-end gap-1 text-right", signTone(change))}>
        <Chevron value={change} className="text-[8px]" />
        {signedPercent(change)}
      </span>
      <span className="tnum truncate text-right text-ink-2">{formatUsdCompact(market.ctx?.dayNtlVlm ?? null)}</span>
      <span className={cx("tnum hidden truncate text-right sm:block", apr !== null && apr < 0 ? "text-down" : "text-ink-2")}>{apr !== null && !market.isSpot ? `${(apr * 100).toFixed(1)}%` : <span className="text-ink-3">—</span>}</span>
    </li>
  );
}

export function MarketPicker() {
  const open = useTerminalUi((state) => state.pickerOpen);
  const close = () => useTerminalUi.getState().set({ pickerOpen: false });
  return (
    <Dialog open={open} onClose={close} title="Markets" description="HyperCore perps, HIP-3 builder markets and spot. Type to search, ↑ ↓ and Enter to go, ★ to pin to the header." size="lg">
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
  const [sort, setSort] = useState<SortKey>("volume");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(() => {
    // A search looks across every kind (best match first); the tabs browse by the chosen sort.
    if (query.trim()) {
      return (["perp", "hip3", "spot"] as const).flatMap((kind) => filterMarkets(markets, { tab: kind, query, favorites: favoriteSet, limit: 60 })).sort((a, b) => (b.ctx?.dayNtlVlm ?? 0) - (a.ctx?.dayNtlVlm ?? 0)).slice(0, ROW_LIMIT);
    }
    const browsed = filterMarkets(markets, { tab, favorites: favoriteSet });
    if (sort !== "volume") browsed.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    return browsed.slice(0, ROW_LIMIT);
  }, [markets, query, tab, sort, favoriteSet]);
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
      <label className={fieldBoxClasses({ size: "lg" })}>
        <Search className="h-4 w-4 text-ink-3" aria-hidden="true" />
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
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3 sm:inline">↑↓ · enter</span>
      </label>
      {!query.trim() ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <SegmentedControl<SortKey>
            label="Sort markets"
            value={sort}
            onChange={(value) => {
              setSort(value);
              setHighlight(0);
            }}
            size="sm"
            options={SORTS.map((option) => ({ value: option.id, label: option.label, hint: option.hint }))}
          />
        </div>
      ) : null}
      <div className={cx(GRID, "border-b-2 border-rule px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3")}>
        <span />
        <span>Market</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h</span>
        <span className="text-right">Volume</span>
        <span className="hidden text-right sm:block">Funding APR</span>
      </div>
      <ul id="market-list" ref={listRef} role="listbox" aria-label="Markets" className="-mx-1 -mt-3 max-h-[52dvh] overflow-y-auto px-1">
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
          <li className="px-2 py-8 text-center text-sm text-ink-2">{tab === "favorites" && !query ? "Star markets with ★ to pin them here and in the header." : tab === "hip3" && !query ? "Loading HIP-3 dexes…" : `No market matches “${query}”. Try a ticker like ETH, HYPE or xyz:TSLA.`}</li>
        ) : null}
      </ul>
    </div>
  );
}
