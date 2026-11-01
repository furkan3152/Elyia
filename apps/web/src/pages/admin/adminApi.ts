/**
 * The owner console's data. Every /v1/admin call carries the wallet session
 * and only runs for an admin session (the server re-checks the role on every
 * request); /v1/config/contracts is public.
 */
import type { ContractsConfigResponse, DeployPlanResponse, DeploymentRecord, FeatureFlag, FeatureFlagsResponse, RecordDeploymentResponse, RouterSettingsResponse, SystemDashboardResponse } from "@elyia/core/api/admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authedFetch, useSessionStore } from "../../features/session";
import { apiGet } from "../../lib/api";
import type { AdminNetwork, Deployable } from "./deployModel";

const ADMIN = ["admin"] as const;

export function useIsAdmin(): boolean {
  return useSessionStore((state) => Boolean(state.stored?.session.roles.includes("admin")));
}

export function useContractsConfig(enabled: boolean) {
  return useQuery({ queryKey: ["config", "contracts"], queryFn: ({ signal }) => apiGet<ContractsConfigResponse>("/v1/config/contracts", { signal }), enabled, staleTime: 15_000, retry: 0 });
}

export function useDeployments(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "deployments"], queryFn: ({ signal }) => authedFetch<{ readonly deployments: readonly DeploymentRecord[] }>("/v1/admin/deployments", { signal }), enabled, retry: 0 });
}

export function useDeployPlan(network: AdminNetwork, enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "plan", network], queryFn: ({ signal }) => authedFetch<DeployPlanResponse>("/v1/admin/deploy-plan", { signal, query: { network } }), enabled, retry: 0, staleTime: 15_000 });
}

export function useRouterSettings(network: AdminNetwork, enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "router", network], queryFn: ({ signal }) => authedFetch<RouterSettingsResponse>("/v1/admin/router", { signal, query: { network }, timeoutMs: 20_000 }), enabled, retry: 0, staleTime: 15_000 });
}

export function useFlags(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "flags"], queryFn: ({ signal }) => authedFetch<FeatureFlagsResponse>("/v1/admin/flags", { signal }), enabled, retry: 0 });
}

export function useSetFlag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly flag: FeatureFlag; readonly on: boolean }) => authedFetch<FeatureFlagsResponse>("/v1/admin/flags", { method: "PUT", body: { [input.flag]: input.on } }),
    onSuccess: (data) => client.setQueryData([...ADMIN, "flags"], data),
  });
}

export function useSystem(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "system"], queryFn: ({ signal }) => authedFetch<SystemDashboardResponse>("/v1/admin/system", { signal }), enabled, retry: 0, refetchInterval: 30_000 });
}

export interface HealthDependencies {
  readonly status: string;
  readonly uptimeSeconds?: number;
  readonly dependencies?: {
    readonly store?: { readonly kind: string; readonly ok: boolean; readonly latencyMs: number | null };
    readonly networks?: readonly { readonly network: string; readonly reachable: boolean; readonly latencyMs: number | null; readonly head: number | null }[];
  };
}

/** Latency samples per health row, kept while the console is open (sampled here, not stored server side). */
const samples = new Map<string, number[]>();

function remember(id: string, latency: number | null | undefined) {
  if (latency === null || latency === undefined) return;
  samples.set(id, [...(samples.get(id) ?? []), latency].slice(-35));
}

export function useHealth(enabled: boolean) {
  return useQuery({
    queryKey: ["health", "v1", "admin"],
    queryFn: async ({ signal }) => {
      const started = performance.now();
      const health = await apiGet<HealthDependencies>("/v1/health", { signal, timeoutMs: 8_000 });
      remember("api", Math.round(performance.now() - started));
      remember("store", health.dependencies?.store?.latencyMs);
      for (const net of health.dependencies?.networks ?? []) remember(net.network, net.latencyMs);
      return { health, samples: Object.fromEntries([...samples.entries()].map(([id, list]) => [id, [...list]])) as Readonly<Record<string, readonly number[]>> };
    },
    enabled,
    retry: 0,
    refetchInterval: 15_000,
  });
}

export function recordDeployment(input: { readonly network: AdminNetwork; readonly contract: Deployable; readonly txHash: string }): Promise<RecordDeploymentResponse> {
  return authedFetch<RecordDeploymentResponse>("/v1/admin/deployments", { method: "POST", body: input, timeoutMs: 30_000 });
}

export function useInvalidateAdmin() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ADMIN });
    void client.invalidateQueries({ queryKey: ["config", "contracts"] });
  };
}
