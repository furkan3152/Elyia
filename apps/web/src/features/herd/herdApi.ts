/**
 * The Herd's API calls (react-query). Public reads need nothing; the WL uses
 * the wallet session (SIWE); /v1/admin/herd/* only runs for an admin session
 * and the server re-checks the role on every request.
 */
import type {
  HerdApplication,
  HerdApplicationsQuery,
  HerdApplicationsResponse,
  HerdApplicationStatus,
  HerdAuditEntry,
  HerdConfigResponse,
  HerdDashboardResponse,
  HerdHolderResponse,
  HerdListId,
  HerdMeResponse,
  HerdMerkleBuild,
  HerdPartner,
  HerdPreparedTx,
  HerdProofResponse,
  HerdRaffle,
  HerdSettings,
  HerdTask,
  HerdTaskInput,
  HerdTasksResponse,
} from "@elyia/core/api/herd";
import { SESSION_HEADER } from "@elyia/core/api/ops";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authedFetch, sessionToken } from "../session";
import { apiGet, apiUrl, ApiError } from "../../lib/api";

const HERD = ["herd"] as const;
const ADMIN = ["admin", "herd"] as const;

export function useHerdConfig() {
  return useQuery({ queryKey: [...HERD, "config"], queryFn: ({ signal }) => apiGet<HerdConfigResponse>("/v1/herd", { signal }), staleTime: 4_000, refetchInterval: 12_000, retry: 1 });
}

export function useHolder(address: string | null | undefined) {
  return useQuery({ queryKey: [...HERD, "holder", address], queryFn: ({ signal }) => apiGet<HerdHolderResponse>(`/v1/herd/holder/${address}`, { signal }), enabled: Boolean(address), staleTime: 60_000, retry: 0 });
}

export function useProof(address: string | null | undefined, enabled = true) {
  return useQuery({ queryKey: [...HERD, "proof", address], queryFn: ({ signal }) => apiGet<HerdProofResponse>(`/v1/herd/wl/proof/${address}`, { signal }), enabled: Boolean(address) && enabled, staleTime: 30_000, retry: 0 });
}

export function useWlTasks() {
  return useQuery({ queryKey: [...HERD, "tasks"], queryFn: ({ signal }) => apiGet<HerdTasksResponse>("/v1/herd/wl/tasks", { signal }), staleTime: 60_000, retry: 1 });
}

export function useWlMe(token: string | null) {
  return useQuery({ queryKey: [...HERD, "me", token], queryFn: ({ signal }) => authedFetch<HerdMeResponse>("/v1/herd/wl/me", { signal }), enabled: Boolean(token), retry: 0 });
}

export function useInvalidateHerd() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: HERD });
}

export function useApply() {
  const invalidate = useInvalidateHerd();
  return useMutation({
    mutationFn: (body: { readonly wallet: string; readonly xHandle: string; readonly evidence: Readonly<Record<string, string>>; readonly referredBy?: string; readonly device?: string }) => authedFetch<HerdApplication>("/v1/herd/wl/apply", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useMove() {
  const invalidate = useInvalidateHerd();
  return {
    start: useMutation({ mutationFn: (to: string) => authedFetch<{ to: string; expiresAt: string }>("/v1/herd/wl/move/start", { method: "POST", body: { to } }), onSuccess: invalidate }),
    accept: useMutation({ mutationFn: (from: string) => authedFetch<HerdApplication>("/v1/herd/wl/move/accept", { method: "POST", body: { from } }), onSuccess: invalidate }),
  };
}

export function cardUrl(wallet: string): string {
  return apiUrl(`/v1/herd/wl/card/${wallet}.png`);
}

/* ---------------------------------------------------------------- admin */

export interface HerdOverview {
  readonly config: HerdConfigResponse;
  readonly settings: HerdSettings;
  readonly tasks: readonly HerdTask[];
  readonly builds: readonly HerdMerkleBuild[];
  readonly partners: readonly HerdPartner[];
  readonly raffles: readonly HerdRaffle[];
  readonly audit: readonly HerdAuditEntry[];
  readonly counts: HerdApplicationsResponse["counts"];
  readonly index: { readonly next: number; readonly head: number | null; readonly lastError: string | null } | null;
  readonly xApi: boolean;
}

export function useHerdOverview(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "overview"], queryFn: ({ signal }) => authedFetch<HerdOverview>("/v1/admin/herd/overview", { signal, timeoutMs: 20_000 }), enabled, retry: 0, refetchInterval: 20_000 });
}

export function useApplications(query: HerdApplicationsQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...ADMIN, "applications", query],
    queryFn: ({ signal }) => authedFetch<HerdApplicationsResponse>("/v1/admin/herd/applications", { signal, query: query as Record<string, string | number | boolean | undefined> }),
    enabled,
    retry: 0,
  });
}

export function useHerdDashboard(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "dashboard"], queryFn: ({ signal }) => authedFetch<HerdDashboardResponse>("/v1/admin/herd/dashboard", { signal, timeoutMs: 20_000 }), enabled, retry: 0, refetchInterval: 15_000 });
}

export function useHerdAudit(enabled: boolean) {
  return useQuery({ queryKey: [...ADMIN, "audit"], queryFn: ({ signal }) => authedFetch<{ readonly audit: readonly HerdAuditEntry[] }>("/v1/admin/herd/audit", { signal }), enabled, retry: 0 });
}

function useAdminMutation<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void client.invalidateQueries({ queryKey: ADMIN }) });
}

export function useHerdAdmin() {
  return {
    settings: useAdminMutation((patch: Partial<Pick<HerdSettings, "applicationsOpen" | "reapplyLimit" | "moveLimit">>) => authedFetch<HerdSettings>("/v1/admin/herd/settings", { method: "PUT", body: patch })),
    createTask: useAdminMutation((input: HerdTaskInput) => authedFetch<HerdTask>("/v1/admin/herd/tasks", { method: "POST", body: input })),
    updateTask: useAdminMutation((input: { readonly id: string; readonly patch: Partial<HerdTaskInput> }) => authedFetch<HerdTask>(`/v1/admin/herd/tasks/${input.id}`, { method: "PATCH", body: input.patch })),
    deleteTask: useAdminMutation((id: string) => authedFetch<{ deleted: boolean }>(`/v1/admin/herd/tasks/${id}`, { method: "DELETE" })),
    decide: useAdminMutation((input: { readonly ids: readonly string[]; readonly status: HerdApplicationStatus; readonly note?: string }) => authedFetch<{ updated: number; missing: string[] }>("/v1/admin/herd/applications/decision", { method: "POST", body: input })),
    note: useAdminMutation((input: { readonly id: string; readonly text: string }) => authedFetch<HerdApplication>(`/v1/admin/herd/applications/${input.id}/notes`, { method: "POST", body: { text: input.text } })),
    flags: useAdminMutation((input: { readonly id: string; readonly cleared: boolean }) => authedFetch<HerdApplication>(`/v1/admin/herd/applications/${input.id}/flags`, { method: "POST", body: { cleared: input.cleared } })),
    verify: useAdminMutation((id: string) => authedFetch<HerdApplication>(`/v1/admin/herd/applications/${id}/verify`, { method: "POST", body: {} })),
    rescore: useAdminMutation((ids?: readonly string[]) => authedFetch<{ rescored: number }>("/v1/admin/herd/applications/rescore", { method: "POST", body: ids ? { ids } : {}, timeoutMs: 60_000 })),
    commitRaffle: useAdminMutation((input: { readonly winners: number; readonly blocksAhead?: number; readonly targetBlock?: number }) => authedFetch<HerdRaffle>("/v1/admin/herd/raffles", { method: "POST", body: input })),
    drawRaffle: useAdminMutation((id: string) => authedFetch<HerdRaffle>(`/v1/admin/herd/raffles/${id}/draw`, { method: "POST", body: {} })),
    applyRaffle: useAdminMutation((id: string) => authedFetch<{ raffle: HerdRaffle; approved: number }>(`/v1/admin/herd/raffles/${id}/apply`, { method: "POST", body: {} })),
    putPartner: useAdminMutation((input: { readonly tag: string; readonly name: string; readonly cap: number; readonly wallets: readonly string[] }) => authedFetch<HerdPartner>(`/v1/admin/herd/partners/${input.tag}`, { method: "PUT", body: { name: input.name, cap: input.cap, wallets: input.wallets } })),
    deletePartner: useAdminMutation((tag: string) => authedFetch<{ deleted: boolean }>(`/v1/admin/herd/partners/${tag}`, { method: "DELETE" })),
    build: useAdminMutation((list: HerdListId) => authedFetch<HerdMerkleBuild>(`/v1/admin/herd/merkle/${list}/build`, { method: "POST", body: {} })),
    prepare: useAdminMutation((input: { readonly functionName: string; readonly args: readonly unknown[] }) => authedFetch<HerdPreparedTx>("/v1/admin/herd/tx", { method: "POST", body: input, timeoutMs: 20_000 })),
    sent: useAdminMutation((input: { readonly functionName: string; readonly hash: string }) => authedFetch<{ recorded: boolean }>("/v1/admin/herd/tx/sent", { method: "POST", body: input })),
  };
}

/** Downloads an admin export (CSV or JSON) with the session header, as a file. */
export async function downloadExport(path: string, filename: string): Promise<void> {
  const token = sessionToken();
  if (!token) throw new ApiError({ code: "NO_SESSION", message: "Sign in with your wallet first.", status: 401 });
  const response = await fetch(apiUrl(path), { headers: { [SESSION_HEADER]: token }, credentials: "omit" });
  if (!response.ok) throw new ApiError({ code: "EXPORT_FAILED", message: `The export failed (${response.status}).`, status: response.status });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
