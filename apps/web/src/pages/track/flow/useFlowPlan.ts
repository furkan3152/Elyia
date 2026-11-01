/**
 * Plans a flow: the Elyia planner's dry run first (nothing stored, nothing
 * signed), the browser's offline planner when the planner cannot be
 * reached, and a plain-language refusal otherwise. One hook for bridge,
 * swap and earn.
 */
import type { CreateIntentBody, CreateIntentResponse } from "@elyia/core/api/intents";
import type { IntentActionSpec, IntentConstraints } from "@elyia/core/intent";
import { layersFor, type NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";

import { useUiStore } from "../../../app/state/uiStore";
import { ApiError, apiPost } from "../../../lib/api";
import type { Grade } from "../../../topo/geometry/conditions";
import { planOffline, type LocalPlan } from "./localPlanner";
import { clarifyOf, examplesOf, type LanguageQuestion } from "./sentence";
import { routeFromPlanner, type FlowRoute } from "./routeModel";

/** The account a preview is planned for before a wallet connects (dry runs never touch it). */
export const PREVIEW_ACCOUNT: Address = "0x00000000000000000000000000000000000E1A1A";

export interface FlowAsk {
  /** Changes whenever the ask changes (debounced by the caller). */
  readonly key: string;
  readonly sentence: string;
  readonly grade: Grade;
  /** Structured actions (flow pages). Ignored when `text` is set. */
  readonly actions: readonly IntentActionSpec[];
  readonly constraints?: IntentConstraints;
  /** A sentence the planner reads itself (deck, ⌘K, the Guide): sent as `text` instead of actions. */
  readonly text?: string;
  /** The signed clarify thread of the reader's last turn, when one is open. */
  readonly thread?: string;
}

export type FlowPlan =
  | { readonly kind: "planner"; readonly route: FlowRoute; readonly response: CreateIntentResponse; readonly body: CreateIntentBody }
  | { readonly kind: "offline"; readonly route: FlowRoute; readonly local: LocalPlan; readonly why: string }
  | { readonly kind: "refused"; readonly code: string; readonly message: string; readonly offline: boolean; readonly examples?: readonly string[] }
  /** The planner needs an answer first (422 INTENT_CLARIFY): the questions and the signed thread. */
  | { readonly kind: "clarify"; readonly message: string; readonly questions: readonly LanguageQuestion[]; readonly thread: string | null };

/** CAIP-10 accounts for one 0x address on the mode's two EVM layers (the planner re-homes it on HyperCore). */
export function accountsFor(address: string, mode: NetworkEnvironment): string[] {
  const layers = layersFor(mode);
  return [`${layers.elysium.caip2}:${address}`, `${layers.hyperevm.caip2}:${address}`];
}

export function planBody(ask: FlowAsk, address: string, mode: NetworkEnvironment, dryRun: boolean): CreateIntentBody {
  return {
    ...(ask.text ? { text: ask.text.slice(0, 500), ...(ask.thread ? { thread: ask.thread } : {}) } : { actions: ask.actions }),
    accounts: accountsFor(address, mode) as CreateIntentBody["accounts"],
    mode,
    ...(ask.constraints ? { constraints: ask.constraints } : {}),
    ...(dryRun ? { dryRun: true } : {}),
    metadata: { surface: "elyia-web", sentence: ask.sentence.slice(0, 200) },
  };
}

function transportDown(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT" || error.code === "INVALID_RESPONSE" || (error.status !== null && error.status >= 500));
}

export async function planFlow(ask: FlowAsk, account: string | null, mode: NetworkEnvironment, signal?: AbortSignal): Promise<FlowPlan> {
  const address = account ?? PREVIEW_ACCOUNT;
  const body = planBody(ask, address, mode, true);
  try {
    const response = await apiPost<CreateIntentResponse>("/v1/intents", body, { query: { dryRun: true }, signal, timeoutMs: 15_000 });
    return { kind: "planner", route: routeFromPlanner(response, ask.sentence, ask.grade), response, body };
  } catch (error) {
    const clarify = clarifyOf(error);
    if (clarify) return { kind: "clarify", ...clarify };
    if (!transportDown(error)) {
      const problem = error instanceof ApiError ? error : null;
      const examples = examplesOf(error);
      return { kind: "refused", code: problem?.code ?? "UNKNOWN", message: problem?.message ?? "The planner could not plan this route.", offline: false, ...(examples.length > 0 ? { examples } : {}) };
    }
    if (ask.text) return { kind: "refused", code: "PLANNER_OFFLINE", message: "The Elyia planner is offline: sentences need it to be read and quoted. Nothing was sent.", offline: true };
    const first = ask.actions[0];
    const local = first && ask.actions.length === 1 ? planOffline(first, { account: address as Address, mode, sentence: ask.sentence, grade: ask.grade, now: Date.now() }) : null;
    if (local?.ok) return { kind: "offline", route: local.plan.route, local: local.plan, why: error instanceof ApiError ? error.message : "The planner is offline." };
    return { kind: "refused", code: "PLANNER_OFFLINE", message: local && !local.ok ? local.reason : "The Elyia planner is offline and this route needs it.", offline: true };
  }
}

export function useFlowPlan(ask: FlowAsk | null, account: string | null) {
  const mode = useUiStore((state) => state.mode);
  return useQuery({
    queryKey: ["flow-plan", mode, ask?.key ?? null, account?.toLowerCase() ?? null],
    queryFn: ({ signal }) => planFlow(ask!, account, mode, signal),
    enabled: ask !== null && (ask.actions.length > 0 || Boolean(ask.text)),
    retry: 0,
    staleTime: 20_000,
    // Quotes move: re-plan every 30 s while the card is open.
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}

/** A value that settles `delayMs` after it stops changing (amount fields). */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** Plans that carry a route card (planner or offline); refusals and questions do not. */
export function hasRoute(plan: FlowPlan | null | undefined): plan is Extract<FlowPlan, { readonly kind: "planner" | "offline" }> {
  return plan !== null && plan !== undefined && (plan.kind === "planner" || plan.kind === "offline");
}
