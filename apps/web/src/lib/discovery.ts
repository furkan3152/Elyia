/**
 * Discovery endpoints (GET /v1/protocols, /v1/protocols/live,
 * /v1/discovery/launches + its SSE stream, /v1/discovery/shield/:token,
 * /v1/elysium/stats): react-query hooks that report whether the
 * endpoint answered. A 404 means this API does not serve it yet; callers
 * then keep the core registry or their browser path and say so. Nothing is
 * ever filled in to look live.
 */
import type { ElysiumStatsResponse, LaunchesResponse, LaunchView, ProtocolListResponse, ProtocolLiveResponse, ShieldReport } from "@elyia/core/api/discovery";
import type { NetworkKey } from "@elyia/core/networks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError, apiGet, apiUrl } from "./api";
import { launchOf, statusOf, withLaunch, withStatus } from "./discoveryModel";
import { openEventStream, type StreamState } from "./sse";

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

/** The registry as this API runs it (`executable` = what its engine executes). */
export function useProtocols() {
  return useQuery({
    queryKey: ["protocols"],
    queryFn: ({ signal }) => apiGet<ProtocolListResponse>("/v1/protocols", { signal, timeoutMs: 12_000 }),
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

const LAUNCH_LIMIT = 40;

/**
 * The launch radar: the listing, then its SSE stream (`launch` events fold
 * into the same cache, `status` keeps the scanned block). The stream only
 * opens once the listing answered, and polls stop while it is open.
 */
export function useLaunches(network: NetworkKey) {
  const client = useQueryClient();
  const [stream, setStream] = useState<StreamState | "off">("off");
  const query = useQuery({
    queryKey: ["discovery-launches", network],
    queryFn: ({ signal }) => apiGet<LaunchesResponse>("/v1/discovery/launches", { query: { network, limit: LAUNCH_LIMIT }, signal, timeoutMs: 12_000 }),
    staleTime: 60_000,
    refetchInterval: (state) => (state.state.error || stream === "open" ? false : 60_000),
    retry: 0,
  });
  const answered = query.data !== undefined;
  useEffect(() => {
    if (!answered) return undefined;
    const key = ["discovery-launches", network];
    const fold = (update: (current: LaunchesResponse) => LaunchesResponse) => client.setQueryData<LaunchesResponse>(key, (current) => (current ? update(current) : current));
    const events = openEventStream<LaunchEvents>({
      url: apiUrl("/v1/discovery/launches/stream", { network, limit: 1 }),
      parsers: { launch: launchOf, status: statusOf },
      maxAttempts: 4,
      onStateChange: (state) => setStream(state),
      onEvent: (name, value) => {
        if (name === "launch") fold((current) => withLaunch(current, value as LaunchView, LAUNCH_LIMIT));
        else fold((current) => withStatus(current, value as LaunchEvents["status"]));
      },
    });
    return () => events.close();
  }, [answered, network, client]);
  return { query, stream };
}

interface LaunchEvents {
  readonly launch: LaunchView;
  readonly status: Omit<LaunchesResponse, "launches">;
}

export function useElysiumStats(network: NetworkKey) {
  return useQuery({
    queryKey: ["elysium-stats", network],
    queryFn: ({ signal }) => apiGet<ElysiumStatsResponse>("/v1/elysium/stats", { query: { network }, signal, timeoutMs: 10_000 }),
    staleTime: 15_000,
    refetchInterval: (state) => (state.state.error ? false : 30_000),
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
