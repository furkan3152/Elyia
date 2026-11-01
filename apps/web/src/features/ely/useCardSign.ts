/**
 * The real sign flow behind a route card Ely drafted (or an insight's
 * draft): the same planner path the deck and the flows use. The proposal's
 * actions (or, for an anonymous chat, the sentence itself) are planned as a
 * fresh dry run (`useFlowPlan`, re-quoted every 30 s), and each step is
 * prepared, signed in the user's wallet and submitted only when they press
 * the button (`useFlowRun`). Nothing signs on a timer.
 */
import { useMemo } from "react";
import { useAccount } from "wagmi";

import { useFlowPlan } from "../../pages/track/flow/useFlowPlan";
import { useFlowRun } from "../../pages/track/flow/useFlowRun";
import type { RouteStepState } from "../../topo/RouteCard";
import { askOf, type SignSource } from "./signSource";

export type { SignSource } from "./signSource";

export function useCardSign(source: SignSource | null) {
  const { address } = useAccount();
  const ask = useMemo(() => (source ? askOf(source) : null), [source]);
  const plan = useFlowPlan(ask, address ?? null);
  const run = useFlowRun(ask, plan.data ?? null);
  const route = plan.data && (plan.data.kind === "planner" || plan.data.kind === "offline") ? plan.data.route : null;
  const states: RouteStepState[] | undefined = route ? route.steps.map((step) => run.states[step.stepId] ?? step.state) : undefined;
  return { ask, plan: plan.data, planning: plan.isFetching, updatedAt: plan.dataUpdatedAt, planError: plan.error, run, route, states, connected: Boolean(address) };
}

export type CardSign = ReturnType<typeof useCardSign>;
