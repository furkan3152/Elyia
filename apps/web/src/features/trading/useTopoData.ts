/**
 * React hooks over topo.ts: what the Survey artifacts (Rope, Windsock,
 * Weather, depth bars, Altimeter, Avalanche bulletin) read. Each hook is a
 * thin memo over a pure function plus, where needed, one shared HyperCore
 * feed or one cached info request.
 */
import type { Candle, CandleInterval } from "@elyia/core/hypercore/info";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHyperCoreFeed } from "../../lib/hypercore/feeds";
import { infoClient } from "../../lib/hypercore/runtime";
import type { MarketCtx } from "../../lib/hypercore/marketCatalog";
import {
  accountTopo,
  avalancheBulletin,
  depthBook,
  fundingWindsock,
  mergeCandle,
  ropeLayout,
  ropesFrom,
  shockRopes,
  volatilityWeather,
  type AccountTopo,
  type AvalancheBulletin,
  type DepthBook,
  type Rope,
  type RopeLayout,
  type ShockedRope,
  type Weather,
  type Windsock,
} from "./topo";
import type { AccountFeeds } from "./useAccountFeeds";
import type { BookView } from "./useMarketData";

/** Live mids of the first perp dex and spot (`allMids`); HIP-3 coins fall back to their position marks. */
export function useMids(mode: NetworkEnvironment, enabled = true): Readonly<Record<string, string>> | null {
  const feed = useHyperCoreFeed<{ mids?: Record<string, string> }>(mode, enabled ? { type: "allMids" } : null);
  return feed.value?.mids ?? null;
}

export interface RopeView extends Rope {
  readonly layout: RopeLayout;
}

/** One rope per open position of the followed account, marks from the live mids. */
export function usePositionRopes(mode: NetworkEnvironment, feeds: Pick<AccountFeeds, "positions" | "openOrders">): readonly RopeView[] {
  const hasPositions = (feeds.positions?.length ?? 0) > 0;
  const mids = useMids(mode, hasPositions);
  return useMemo(() => {
    const markOf = (coin: string) => {
      const value = mids ? Number(mids[coin]) : NaN;
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    return ropesFrom(feeds.positions, feeds.openOrders, markOf).map((rope) => ({ ...rope, layout: ropeLayout(rope) }));
  }, [feeds.positions, feeds.openOrders, mids]);
}

/** The ropes under the shock slider's move (fraction, or per coin). */
export function useShockedRopes(ropes: readonly Rope[], shock: number | Readonly<Record<string, number>>): readonly ShockedRope[] {
  return useMemo(() => shockRopes(ropes, shock), [ropes, shock]);
}

/** Account figures for the altimeter and the bulletin. */
export function useAccountTopo(feeds: Pick<AccountFeeds, "summary" | "positions" | "spot">): { readonly account: AccountTopo | null; readonly bulletin: AvalancheBulletin } {
  return useMemo(() => {
    const account = accountTopo(feeds.summary, feeds.positions, feeds.spot);
    return { account, bulletin: avalancheBulletin(account) };
  }, [feeds.summary, feeds.positions, feeds.spot]);
}

/** The windsock of a market's live context (null on spot); pass a ticking `now` (useNow) for the countdown. */
export function useFundingWindsock(ctx: MarketCtx | null, now: number): Windsock | null {
  const funding = ctx?.funding ?? null;
  // The countdown changes every second; the rest only with the funding rate.
  return useMemo(() => fundingWindsock(funding, now), [funding, now]);
}

const INTERVAL_MS: Partial<Record<CandleInterval, number>> = { "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

/**
 * Weather of a market: realised volatility of the last day of hourly
 * candles (24 returns), ranked against the previous 30 days. Candles come
 * once from `candleSnapshot` (cached) and stay current through the live
 * candle feed.
 */
export function useVolatilityWeather(mode: NetworkEnvironment, coin: string | null, interval: CandleInterval = "1h", windowSize = 24): { readonly weather: Weather | null; readonly loading: boolean } {
  const periodMs = INTERVAL_MS[interval] ?? 3_600_000;
  const snapshot = useQuery({
    queryKey: ["hypercore", mode, "weatherCandles", coin, interval],
    queryFn: () => {
      const endTime = Date.now();
      return infoClient(mode).post<Candle[]>({ type: "candleSnapshot", req: { coin: coin as string, interval, startTime: endTime - periodMs * 30 * windowSize, endTime } });
    },
    enabled: coin !== null,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  const live = useHyperCoreFeed<Candle>(mode, coin ? { type: "candle", coin, interval } : null);
  const latest = live.value && live.value.s === coin && live.value.i === interval ? live.value : null;
  // Recompute when a candle closes (a new open time), not on every tick of the open one.
  const latestOpen = latest?.t ?? null;
  const weather = useMemo(() => {
    if (!snapshot.data) return null;
    return volatilityWeather(mergeCandle(snapshot.data, latest), periodMs, windowSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new candle changes the window
  }, [snapshot.data, latestOpen, periodMs, windowSize]);
  return { weather, loading: coin !== null && snapshot.isPending };
}

/** Depth bars of the live book at a grouping step (the native tick when null). */
export function useBookDepth(book: Pick<BookView, "bids" | "asks">, step: number | null, levels = 12): DepthBook | null {
  return useMemo(() => {
    if (book.bids.length === 0 && book.asks.length === 0) return null;
    const native = step ?? inferTick(book);
    return depthBook(book.bids, book.asks, native, levels);
  }, [book, step, levels]);
}

/** Smallest price gap between adjacent levels (the book's own step). */
function inferTick(book: Pick<BookView, "bids" | "asks">): number {
  let best = Number.POSITIVE_INFINITY;
  for (const side of [book.bids, book.asks]) {
    for (let index = 1; index < side.length; index += 1) {
      const gap = Math.abs(Number(side[index]!.px) - Number(side[index - 1]!.px));
      if (gap > 0 && gap < best) best = gap;
    }
  }
  return Number.isFinite(best) ? Number(best.toPrecision(6)) : 1;
}
