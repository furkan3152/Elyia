/**
 * The developer portal's data: public reads (health, protocols, venues, the
 * playground) and the signed-in developer's keys, usage, webhooks, fee and
 * widget. Every developer call carries the wallet session; none can sign or
 * move funds.
 */
import type {
  ApiKeyListResponse,
  ApiKeyScope,
  CreateKeyResponse,
  CreateWebhookResponse,
  DeveloperProfile,
  IntegratorFeeConfig,
  UsageResponse,
  WebhookDeliveriesResponse,
  WebhookDelivery,
  WebhookEventType,
  WebhookListResponse,
  WidgetConfig,
} from "@elyia/core/api/developers";
import type { CreateIntentResponse, VenuesResponse } from "@elyia/core/api/intents";
import type { ParseIntentResponse } from "@elyia/core/api/language";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "../../lib/api";
import { authedFetch, useSessionStore } from "../../features/session";

const DEV = ["developers"] as const;

/* --------------------------------------------------------------- public */

export interface HealthLite {
  readonly status: string;
  readonly version?: string;
  readonly mode?: string;
}

export function useApiHealth() {
  return useQuery({ queryKey: ["health", "v1"], queryFn: ({ signal }) => apiGet<HealthLite>("/v1/health", { signal, timeoutMs: 6_000 }), staleTime: 30_000, retry: 0, refetchInterval: 60_000 });
}

export function useProtocolCount() {
  return useQuery({
    queryKey: ["protocols", "summary-count"],
    queryFn: async ({ signal }) => {
      const body = await apiGet<{ readonly total?: number; readonly count?: number; readonly executableIds?: readonly string[] }>("/v1/protocols", { signal, timeoutMs: 8_000, query: { view: "summary" } });
      return { total: body.total ?? body.count ?? null, executable: Array.isArray(body.executableIds) ? body.executableIds.length : null };
    },
    staleTime: 300_000,
    retry: 0,
  });
}

export function useVenues() {
  return useQuery({ queryKey: ["venues", "all"], queryFn: ({ signal }) => apiGet<VenuesResponse>("/v1/venues", { signal, timeoutMs: 8_000 }), staleTime: 300_000, retry: 0 });
}

export interface Timed<T> {
  readonly body: T;
  readonly ms: number;
  readonly status: number;
}

async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now();
  const body = await run();
  return { body, ms: Math.round(performance.now() - started), status: 200 };
}

export function parseIntent(text: string): Promise<Timed<ParseIntentResponse>> {
  return timed(() => apiPost<ParseIntentResponse>("/v1/intents/parse", { text, locale: "en" }, { timeoutMs: 15_000 }));
}

/** A dry-run plan: priced, nothing stored, nothing signed. */
export function planDryRun(text: string, account: string): Promise<Timed<CreateIntentResponse>> {
  return timed(() => apiPost<CreateIntentResponse>("/v1/intents", { text, accounts: [account], dryRun: true }, { timeoutMs: 25_000 }));
}

/* ------------------------------------------------------------ developer */

export interface DeveloperMe {
  readonly profile: DeveloperProfile;
  readonly fee: IntegratorFeeConfig;
  readonly widget: WidgetConfig;
}

function useDeveloperEnabled(): boolean {
  return useSessionStore((state) => Boolean(state.stored?.session.roles.includes("developer")));
}

export function useDeveloperMe() {
  const enabled = useDeveloperEnabled();
  return useQuery({ queryKey: [...DEV, "me"], queryFn: ({ signal }) => authedFetch<DeveloperMe>("/v1/developers/me", { signal }), enabled, staleTime: 30_000, retry: 0 });
}

export function useRegisterDeveloper() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => authedFetch<DeveloperProfile>("/v1/developers/register", { method: "POST", body: name ? { name } : {} }),
    onSuccess: () => {
      const store = useSessionStore.getState();
      const roles = store.stored?.session.roles ?? [];
      if (!roles.includes("developer")) store.setRoles([...roles, "developer"]);
      void client.invalidateQueries({ queryKey: DEV });
    },
  });
}

export function useKeys() {
  const enabled = useDeveloperEnabled();
  return useQuery({ queryKey: [...DEV, "keys"], queryFn: ({ signal }) => authedFetch<ApiKeyListResponse>("/v1/developers/keys", { signal }), enabled, retry: 0 });
}

export function useKeyActions() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: DEV });
  const create = useMutation({ mutationFn: (input: { readonly name: string; readonly scopes: readonly ApiKeyScope[] }) => authedFetch<CreateKeyResponse>("/v1/developers/keys", { method: "POST", body: input }), onSuccess: refresh });
  const rotate = useMutation({ mutationFn: (id: string) => authedFetch<CreateKeyResponse>(`/v1/developers/keys/${encodeURIComponent(id)}/rotate`, { method: "POST", body: {} }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => authedFetch<unknown>(`/v1/developers/keys/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: refresh });
  return { create, rotate, revoke } as const;
}

export function useUsage(days: number) {
  const enabled = useDeveloperEnabled();
  return useQuery({ queryKey: [...DEV, "usage", days], queryFn: ({ signal }) => authedFetch<UsageResponse>("/v1/developers/usage", { signal, query: { days } }), enabled, retry: 0, refetchInterval: 60_000 });
}

export function useWebhooks() {
  const enabled = useDeveloperEnabled();
  return useQuery({ queryKey: [...DEV, "webhooks"], queryFn: ({ signal }) => authedFetch<WebhookListResponse>("/v1/developers/webhooks", { signal }), enabled, retry: 0 });
}

export function useDeliveries(webhookId: string | null) {
  const enabled = useDeveloperEnabled() && Boolean(webhookId);
  return useQuery({ queryKey: [...DEV, "deliveries", webhookId], queryFn: ({ signal }) => authedFetch<WebhookDeliveriesResponse>(`/v1/developers/webhooks/${encodeURIComponent(webhookId ?? "")}/deliveries`, { signal }), enabled, retry: 0, refetchInterval: 15_000 });
}

export function useWebhookActions() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: DEV });
  const create = useMutation({ mutationFn: (input: { readonly url: string; readonly events: readonly WebhookEventType[] }) => authedFetch<CreateWebhookResponse>("/v1/developers/webhooks", { method: "POST", body: input }), onSuccess: refresh });
  const test = useMutation({ mutationFn: (id: string) => authedFetch<{ readonly delivery: WebhookDelivery }>(`/v1/developers/webhooks/${encodeURIComponent(id)}/test`, { method: "POST", body: {} }), onSuccess: refresh });
  const update = useMutation({ mutationFn: (input: { readonly id: string; readonly events: readonly WebhookEventType[] }) => authedFetch<unknown>(`/v1/developers/webhooks/${encodeURIComponent(input.id)}`, { method: "PATCH", body: { events: input.events } }), onSuccess: refresh });
  return { create, test, update } as const;
}

export function useSaveFee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly feeBps: number; readonly recipient: string | null }) => authedFetch<IntegratorFeeConfig>("/v1/developers/fees", { method: "PUT", body: input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: [...DEV, "me"] }),
  });
}
