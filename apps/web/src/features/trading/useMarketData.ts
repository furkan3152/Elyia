/**
 * Market data for the terminal: the catalogue (REST, refreshed), the live
 * context, book, trades and mids of the active market (WebSocket feeds).
 */
import type { BookLevel, L2Book, MetaAndAssetCtxs, PerpAssetCtx, PerpMeta, RecentTrade, SpotAssetCtx, SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHyperCoreFeed } from "../../lib/hypercore/feeds";
import { ctxsByDexFrom, hip3MarketsFrom, perpCtx, perpMarketsFrom, spotCtx, spotMarketsFrom, type BookGrouping, type MarketCtx, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { infoClient } from "../../lib/hypercore/runtime";

export interface Catalog {
  readonly markets: readonly TradeMarket[];
  readonly loading: boolean;
  readonly error: string | null;
}

/** First-dex perps and spot pairs with their contexts (refreshed every 15 s / 30 s). */
export function useMarketCatalog(mode: NetworkEnvironment): Catalog {
  const perps = useQuery({
    queryKey: ["hypercore", mode, "metaAndAssetCtxs"],
    queryFn: () => infoClient(mode).post<MetaAndAssetCtxs>({ type: "metaAndAssetCtxs" }),
    refetchInterval: 15_000,
    staleTime: 8_000,
    retry: 2,
  });
  const spot = useQuery({
    queryKey: ["hypercore", mode, "spotMetaAndAssetCtxs"],
    queryFn: () => infoClient(mode).post<SpotMetaAndAssetCtxs>({ type: "spotMetaAndAssetCtxs" }),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  });
  const markets = useMemo(() => [...perpMarketsFrom(perps.data), ...spotMarketsFrom(spot.data)], [perps.data, spot.data]);
  const error = perps.error ? (perps.error instanceof Error ? perps.error.message : "HyperCore did not answer.") : null;
  return { markets, loading: perps.isPending, error };
}

/** HIP-3 builder dexes: metas once (heavy, cached), contexts live while `enabled`. */
export function useHip3Catalog(mode: NetworkEnvironment, enabled: boolean): Catalog {
  const metas = useQuery({
    queryKey: ["hypercore", mode, "allPerpMetas"],
    queryFn: () => infoClient(mode).post<(PerpMeta | null)[]>({ type: "allPerpMetas" }),
    enabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  const dexs = useQuery({
    queryKey: ["hypercore", mode, "perpDexs"],
    queryFn: () => infoClient(mode).post<({ name: string } | null)[]>({ type: "perpDexs" }),
    enabled,
    staleTime: 10 * 60_000,
  });
  const ctxs = useHyperCoreFeed<unknown>(mode, enabled ? { type: "allDexsAssetCtxs" } : null);
  const markets = useMemo(() => hip3MarketsFrom(metas.data, dexs.data, ctxsByDexFrom(ctxs.value)), [metas.data, dexs.data, ctxs.value]);
  return { markets, loading: enabled && (metas.isPending || dexs.isPending), error: metas.error ? "HIP-3 markets did not load." : null };
}

/** Live context of the active market (activeAssetCtx; spot answers on activeSpotAssetCtx). */
export function useLiveCtx(mode: NetworkEnvironment, market: TradeMarket | null): MarketCtx | null {
  const feed = useHyperCoreFeed<{ coin: string; ctx: Partial<PerpAssetCtx> & Partial<SpotAssetCtx> }>(mode, market ? { type: "activeAssetCtx", coin: market.coin } : null);
  return useMemo(() => {
    const live = feed.value && market && feed.value.coin === market.coin ? feed.value.ctx : null;
    if (!live) return market?.ctx ?? null;
    return market?.isSpot ? spotCtx(live) : perpCtx(live);
  }, [feed.value, market]);
}

export interface BookView {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly time: number | null;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly mid: number | null;
  readonly spread: number | null;
}

const EMPTY_BOOK: BookView = { bids: [], asks: [], time: null, bestBid: null, bestAsk: null, mid: null, spread: null };

/** The order book at a grouping (server-side aggregation). */
export function useBook(mode: NetworkEnvironment, coin: string | null, grouping: BookGrouping | null): BookView {
  const sub = coin ? { type: "l2Book" as const, coin, ...(grouping?.nSigFigs ? { nSigFigs: grouping.nSigFigs } : {}), ...(grouping?.mantissa ? { mantissa: grouping.mantissa } : {}) } : null;
  const feed = useHyperCoreFeed<L2Book>(mode, sub);
  return useMemo(() => {
    const book = feed.value;
    if (!book || book.coin !== coin) return EMPTY_BOOK;
    const [bids = [], asks = []] = book.levels;
    const bestBid = bids[0] ? Number(bids[0].px) : null;
    const bestAsk = asks[0] ? Number(asks[0].px) : null;
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
    return { bids, asks, time: book.time, bestBid, bestAsk, mid, spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null };
  }, [feed.value, coin]);
}

/** Recent prints of the active market, newest first. */
export function useTrades(mode: NetworkEnvironment, coin: string | null): readonly RecentTrade[] {
  const feed = useHyperCoreFeed<RecentTrade[]>(mode, coin ? { type: "trades", coin } : null, "trades");
  return useMemo(() => (feed.value ?? []).filter((trade) => trade.coin === coin), [feed.value, coin]);
}
