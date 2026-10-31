/**
 * Pure graph updates the service composes: step transitions along the core
 * lifecycle (every hop checked), unlocking steps whose parents are done,
 * appending engine follow-up steps, and the derived intent status.
 */
import {
  assertStepPath,
  deriveIntentStatus,
  formatAccountId,
  NETWORKS,
  stepFailure,
  unlockableSteps,
  type ErrorCode,
  type IntentGraph,
  type IntentStep,
  type StepEvidence,
  type StepFailure,
  type StepStatus,
} from "@elyia/core";
import { stepAddress } from "./assets.js";
import type { FollowUpStep } from "./types.js";

/** Evidence kept per step (the newest). */
export const MAX_STEP_EVIDENCE = 40;

/** A copy of `step` without the listed optional fields. */
export function without<K extends keyof IntentStep>(step: IntentStep, ...keys: K[]): IntentStep {
  const copy: Record<string, unknown> = { ...step };
  for (const key of keys) delete copy[key as string];
  return copy as unknown as IntentStep;
}

/** Moves a step along `path` (each hop validated), merging `patch`. */
export function moveStep(step: IntentStep, path: readonly StepStatus[], patch: Partial<IntentStep> = {}): IntentStep {
  if (path.length > 0) assertStepPath(step, path);
  const status = path.length > 0 ? (path[path.length - 1] as StepStatus) : step.status;
  return { ...step, ...patch, status };
}

export function addEvidence(step: IntentStep, evidence: readonly StepEvidence[]): IntentStep {
  if (evidence.length === 0) return step;
  return { ...step, evidence: [...step.evidence, ...evidence].slice(-MAX_STEP_EVIDENCE) };
}

/** A failure record from a code (unknown codes are internal and not retryable). */
export function failureOf(code: string, message: string, review = false): StepFailure {
  try {
    const failure = stepFailure(code as ErrorCode, { message });
    return review ? { ...failure, retryable: false, review: true } : failure;
  } catch {
    return { code, message, retryable: false, ...(review ? { review: true } : {}) };
  }
}

export function replaceStep(graph: IntentGraph, step: IntentStep): IntentGraph {
  return { ...graph, steps: graph.steps.map((candidate) => (candidate.id === step.id ? step : candidate)) };
}

/** Blocked steps whose dependencies are all settled or skipped become ready. */
export function unlock(graph: IntentGraph): IntentGraph {
  const ids = new Set(unlockableSteps(graph.steps));
  if (ids.size === 0) return graph;
  return { ...graph, steps: graph.steps.map((step) => (ids.has(step.id) ? moveStep(step, ["ready"]) : step)) };
}

/** Appends an engine follow-up step (deduplicated by key), ready immediately. */
export function appendFollowUp(graph: IntentGraph, followUp: FollowUpStep, owner: IntentStep): IntentGraph {
  if (graph.steps.some((step) => step.route?.params?.followUpKey === followUp.key)) return graph;
  const index = graph.steps.length;
  const step: IntentStep = {
    id: `s${index + 1}`,
    index,
    kind: followUp.kind,
    title: followUp.title,
    network: followUp.network,
    chain: NETWORKS[followUp.network].caip2,
    account: formatAccountId(followUp.network, stepAddress(owner)),
    protocol: followUp.protocol,
    mode: "wallet",
    inputs: [],
    outputs: [],
    dependsOn: [],
    status: "ready",
    route: { ...followUp.route, params: { ...(followUp.route.params ?? {}), followUpKey: followUp.key } },
    evidence: [],
    settlement: { kind: "same-network", mechanism: "receipt" },
  };
  return { ...graph, steps: [...graph.steps, step] };
}

/** Stamps `updatedAt` and the derived status. */
export function touch(graph: IntentGraph, now: number): IntentGraph {
  return { ...graph, updatedAt: new Date(now).toISOString(), status: deriveIntentStatus(graph.steps, graph.expiresAt, now) };
}

/** True once a step has been handed out or acted on (the plan no longer expires). */
export function started(graph: IntentGraph): boolean {
  return graph.steps.some((step) => step.prepared !== undefined || (step.status !== "ready" && step.status !== "blocked" && step.status !== "skipped"));
}
