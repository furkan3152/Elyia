import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../lib/api";
import { DEMO_MARKETS, hottestMarkets, parseMarkets, type MarketSummary } from "../lib/markets";

export interface HottestMarkets {
  readonly markets: readonly MarketSummary[];
  /** "live" from GET /v1/markets; "demo" when that request fails or returns nothing usable; "loading" shows no figures. */
  readonly source: "live" | "demo" | "loading";
  readonly updatedAt: number | null;
}

const LOADING_MARKETS: readonly MarketSummary[] = DEMO_MARKETS.map((market) => ({ ...market, change: null }));

/**
 * The 7 most traded HyperCore markets from GET /v1/markets (refreshed every
 * 15 s). Falls back to a deterministic demo set, flagged `source: "demo"`, so
 * the Lyre is never blank and never passes demo data off as live.
 */
export function useHottestMarkets(count = 7): HottestMarkets {
  const query = useQuery({
    queryKey: ["markets", "hottest"],
    queryFn: async ({ signal }) => parseMarkets(await apiGet<unknown>("/v1/markets", { signal, timeoutMs: 6_000 })),
    // Refresh live data every 15 s; while the endpoint fails, ask again only once a minute.
    refetchInterval: (query) => (query.state.status === "error" ? 60_000 : 15_000),
    retry: 1,
  });
  // While loading, keep the strings' shape but show no 24h move: sample numbers must not read as live ones.
  if (query.isPending) return { markets: LOADING_MARKETS.slice(0, count), source: "loading", updatedAt: null };
  const live = query.data ? hottestMarkets(query.data, count) : [];
  if (live.length >= 3) return { markets: live, source: "live", updatedAt: query.dataUpdatedAt };
  return { markets: DEMO_MARKETS.slice(0, count), source: "demo", updatedAt: null };
}
