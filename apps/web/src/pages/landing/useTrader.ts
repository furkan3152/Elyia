import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../../lib/api";
import { hasTerrain, parseTrader, type TraderSnapshot } from "./model";
import { PUBLIC_TRADER, SAMPLE_TRADER } from "./sample";

export interface TraderView {
  readonly snapshot: TraderSnapshot;
  /** True when this is the labelled sample, not the public trader read now. */
  readonly sample: boolean;
  /** Still waiting for the first answer (the sample is shown meanwhile). */
  readonly loading: boolean;
}

/**
 * The public testnet trader the landing maps, read from GET
 * /v1/portfolio/:address every 30 s while the page is open. Never blocks: the
 * labelled sample stands in until (and unless) the API answers with a book.
 */
export function useTrader(address: string = PUBLIC_TRADER): TraderView {
  const query = useQuery({
    queryKey: ["landing", "trader", address],
    queryFn: async ({ signal }) => parseTrader(await apiFetch<unknown>(`/v1/portfolio/${address}`, { signal, timeoutMs: 12_000, query: { mode: "testnet" } })),
    retry: false,
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const live = query.data ?? null;
  if (hasTerrain(live)) return { snapshot: live, sample: false, loading: false };
  return { snapshot: SAMPLE_TRADER, sample: true, loading: query.isPending };
}
