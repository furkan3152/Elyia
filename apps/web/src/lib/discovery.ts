/**
 * Discovery endpoints (GET /v1/protocols/live, /v1/discovery/launches,
 * /v1/discovery/shield/:token): react-query hooks that report whether the
 * endpoint answered. A 404 means this API does not serve it yet; callers
 * then keep the core registry or their browser path and say so. Nothing is
 * ever filled in to look live.
 */
import type { LaunchesResponse, ProtocolLiveResponse, ShieldReport } from "@elyia/core/api/discovery";
import type { NetworkKey } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "./api";

/** "absent": the API has no such route (404) or cannot be reached; the page falls back. */
export type EndpointState = "live" | "absent" | "loading";

export function endpointState(query: { readonly isPending: boolean; readonly isError: boolean; readonly data?: unknown }): EndpointState {
  if (query.data) return "live";
  if (query.isError) return "absent";
  return query.isPending ? "loading" : "absent";
}

function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === "NOT_FOUND" || error.code === "NETWORK_ERROR" || error.code === "TIMEOUT");
}

export function useProtocolsLive(network: NetworkKey) {
  return useQuery({
    queryKey: ["protocols-live", network],
    queryFn: ({ signal }) => apiGet<ProtocolLiveResponse>("/v1/protocols/live", { query: { network }, signal, timeoutMs: 25_000 }),
    staleTime: 5 * 60_000,
    retry: (count, error) => !isMissing(error) && count < 1,
  });
}

export function useLaunches(network: NetworkKey) {
  return useQuery({
    queryKey: ["discovery-launches", network],
    queryFn: ({ signal }) => apiGet<LaunchesResponse>("/v1/discovery/launches", { query: { network, limit: 40 }, signal, timeoutMs: 12_000 }),
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.error ? false : 60_000),
    retry: 0,
  });
}

export function useShieldReport(token: string | null, network: NetworkKey) {
  return useQuery({
    queryKey: ["discovery-shield", network, token?.toLowerCase() ?? null],
    queryFn: ({ signal }) => apiGet<ShieldReport>(`/v1/discovery/shield/${token}`, { query: { network }, signal, timeoutMs: 20_000 }),
    enabled: token !== null && /^0x[0-9a-fA-F]{40}$/u.test(token),
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
