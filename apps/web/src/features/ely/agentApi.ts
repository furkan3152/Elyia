/**
 * Ely's read and write endpoints for the portfolio and the rail, through
 * react-query: insights (public, read-only), the automation catalog
 * (public), the owner's automations and keeper status (session). Writes are
 * plain switches on the owner's automations (each run only drafts proposals)
 * and never sign anything.
 */
import type { Automation, AutomationKind, AutomationListResponse, InsightsResponse, KeeperStatusResponse } from "@elyia/core/api/agent";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";
import { sessionFetch } from "../session/sessionApi";

export interface SkillsResponse {
  readonly automations: AutomationListResponse["catalog"];
  readonly insights: readonly string[];
}

export function useInsights(address: string | null) {
  return useQuery({
    queryKey: ["ely-insights", address],
    queryFn: ({ signal }) => apiGet<InsightsResponse>(`/v1/agent/insights/${address}`, { signal, timeoutMs: 20_000 }),
    enabled: address !== null,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ["ely-skills"],
    queryFn: ({ signal }) => apiGet<SkillsResponse>("/v1/agent/skills", { signal }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useAutomations(token: string | null) {
  return useQuery({
    queryKey: ["ely-automations", token],
    queryFn: ({ signal }) => sessionFetch<AutomationListResponse>("/v1/agent/automations", token!, { signal }),
    enabled: token !== null,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useKeeperStatus(token: string | null) {
  return useQuery({
    queryKey: ["ely-keeper", token],
    queryFn: ({ signal }) => sessionFetch<KeeperStatusResponse>("/v1/agent/keeper", token!, { signal }),
    enabled: token !== null,
    staleTime: 30_000,
    retry: 0,
  });
}

/** Switch one automation kind on or off (creates it the first time). Runs only draft proposals. */
export function useSwitchAutomation(token: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, enabled, existing }: { readonly kind: AutomationKind; readonly enabled: boolean; readonly existing: Automation | null }) => {
      if (!token) throw new Error("Sign in with your wallet first.");
      if (existing) return sessionFetch<Automation>(`/v1/agent/automations/${existing.id}`, token, { method: "PATCH", body: { enabled } });
      return sessionFetch<Automation>("/v1/agent/automations", token, { method: "POST", body: { kind, enabled } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ely-automations"] });
    },
  });
}
