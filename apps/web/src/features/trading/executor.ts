/**
 * Sends what the user triggered: each L1 action of a plan (leverage
 * first, then the order) is checked by the Rule Book, signed by the
 * in-browser agent key and posted to /exchange, in order, stopping at the
 * first refusal. Optimistic rows appear at once and are reconciled from the
 * live feeds; nothing here retries on its own or runs on a timer.
 */
import type { L1Action } from "@elyia/core/hypercore/actions";
import type { RuleBook } from "@elyia/core/policy";
import type { PolicyEvaluation } from "@elyia/core/policyEvaluate";

import { AgentExpiredError, ConfirmationRequiredError, GuardBlockedError, signAgentAction, type AgentSignerDeps } from "../agentKey/signer";
import { ExchangeError, postExchange, readOutcomes, type ActionOutcome } from "../../lib/hypercore/exchangeClient";
import { combineEvaluations, evaluateAction, guardFactsFor, type GuardContext } from "./guard";
import type { OrderLeg } from "./orderBuilders";
import type { PendingOrder } from "./tradeStore";

export interface TradePlan {
  /** "Long 0.2991 ETH at market". */
  readonly label: string;
  readonly actions: readonly L1Action[];
  readonly legs?: readonly OrderLeg[];
  readonly coin?: string;
  readonly marketSlippageBps?: number | null;
  readonly plannedLeverage?: Readonly<Record<string, number>>;
}

export type SubmitResult =
  | { readonly ok: true; readonly outcomes: readonly ActionOutcome[] }
  | { readonly ok: false; readonly kind: "confirm"; readonly evaluation: PolicyEvaluation; readonly message: string }
  | { readonly ok: false; readonly kind: "blocked"; readonly message: string; readonly evaluation: PolicyEvaluation | null }
  | { readonly ok: false; readonly kind: "refused"; readonly message: string; readonly title: string; readonly outcomes: readonly ActionOutcome[] }
  | { readonly ok: false; readonly kind: "error"; readonly message: string; readonly title: string };

export function contextFor(base: GuardContext, plan: TradePlan, now: number): GuardContext {
  return {
    ...base,
    now,
    ...(plan.plannedLeverage ? { plannedLeverage: plan.plannedLeverage } : {}),
    ...(plan.marketSlippageBps !== undefined ? { marketSlippageBps: plan.marketSlippageBps } : {}),
  };
}

/** The verdict for a whole plan (what the guard strip and the review show). */
export function evaluatePlan(book: RuleBook, base: GuardContext, plan: TradePlan, now: number): ReturnType<typeof combineEvaluations> {
  const ctx = contextFor(base, plan, now);
  return combineEvaluations(plan.actions.map((action) => evaluateAction(book, action, ctx)));
}

export interface ExecutorDeps {
  readonly signer: AgentSignerDeps | null;
  readonly book: RuleBook;
  readonly guard: GuardContext;
  readonly exchangeUrl: string;
  readonly onPending?: (rows: readonly PendingOrder[]) => void;
  readonly onSettled?: (cloids: readonly string[], status: PendingOrder["status"] | "drop") => void;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Runs a plan. `confirmed` is the user's explicit confirmation of this
 * plan after a "confirm" verdict (the review step). Each action's guard is
 * evaluated against the context of the moment it is signed.
 */
export async function executePlan(deps: ExecutorDeps, plan: TradePlan, options: { readonly confirmed?: boolean } = {}): Promise<SubmitResult> {
  if (!deps.signer) return { ok: false, kind: "blocked", message: "Trading is locked. Enable or unlock trading first.", evaluation: null };
  const clock = deps.now ?? (() => Date.now());
  // Check every action before signing any, so a plan never half-runs because its second step is refused.
  const ctx0 = contextFor(deps.guard, plan, clock());
  for (const action of plan.actions) {
    const evaluation = evaluateAction(deps.book, action, ctx0);
    if (evaluation.decision === "deny") {
      return { ok: false, kind: "blocked", message: evaluation.reasons.find((reason) => reason.outcome === "deny")?.message ?? "Your Rule Book blocks this.", evaluation };
    }
    if (evaluation.decision === "confirm" && !options.confirmed) {
      return { ok: false, kind: "confirm", evaluation, message: evaluation.reasons.find((reason) => reason.outcome === "confirm")?.message ?? "Confirm this order." };
    }
  }
  const outcomes: ActionOutcome[] = [];
  for (const action of plan.actions) {
    const isOrder = action.type === "order";
    const cloids = isOrder ? action.orders.map((order) => order.c ?? "").filter(Boolean) : [];
    try {
      const ctx = contextFor(deps.guard, plan, clock());
      const signed = await signAgentAction(deps.signer, action, { book: deps.book, facts: guardFactsFor(action, ctx) }, { confirmed: options.confirmed === true });
      if (isOrder && plan.legs && deps.onPending) {
        deps.onPending(
          plan.legs.map((leg) => ({ cloid: leg.cloid, coin: plan.coin ?? "", isBuy: leg.isBuy, px: leg.px, sz: leg.sz, label: leg.role, status: "sent" as const, at: clock() })),
        );
      }
      const response = await postExchange(deps.exchangeUrl, signed.request, deps.fetch);
      const results = readOutcomes(response);
      outcomes.push(...results);
      if (isOrder) {
        results.forEach((result, index) => {
          const cloid = cloids[index];
          if (!cloid) return;
          deps.onSettled?.([cloid], result.kind === "error" ? "drop" : result.kind === "filled" ? "filled" : "resting");
        });
        if (results.length === 1 && results[0]?.kind === "error" && cloids.length > 1) deps.onSettled?.(cloids, "drop");
      }
      const errors = results.filter((result): result is Extract<ActionOutcome, { kind: "error" }> => result.kind === "error");
      if (errors.length > 0 && (errors.length === results.length || !isOrder)) {
        const first = errors[0]!;
        return { ok: false, kind: "refused", title: first.error.title, message: first.error.message, outcomes };
      }
    } catch (error) {
      if (cloids.length > 0) deps.onSettled?.(cloids, "drop");
      if (error instanceof ConfirmationRequiredError) return { ok: false, kind: "confirm", evaluation: error.evaluation, message: error.message };
      if (error instanceof GuardBlockedError) return { ok: false, kind: "blocked", message: error.message, evaluation: error.evaluation };
      if (error instanceof AgentExpiredError) return { ok: false, kind: "blocked", message: error.message, evaluation: null };
      if (error instanceof ExchangeError) return { ok: false, kind: "error", title: error.title, message: error.message };
      return { ok: false, kind: "error", title: "Could not send", message: error instanceof Error ? error.message : "Something went wrong; nothing was sent." };
    }
  }
  return { ok: true, outcomes };
}
