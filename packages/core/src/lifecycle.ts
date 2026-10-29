/**
 * Intent lifecycle: the only legal step transitions, graph validation and
 * intent status derivation. Shared by the API (authoritative), the web app
 * and Telegram (optimistic display).
 *
 * Invariants carried over from Kletia:
 * - one transition table; every hop is asserted (multi-hop paths too);
 * - a step whose outcome is unknown is held for review and never retried
 *   automatically (`failure.review`), it can only move on when evidence lands;
 * - in-flight steps (submitted, settling, preparing) cannot be stopped: they
 *   are followed to settlement; a resting order needs a cancel step;
 * - only unstarted intents expire, so long withdrawals and resting orders
 *   never turn an intent "expired" mid-flight;
 * - capital lanes never mix (one environment per intent).
 */
import { parseAccountId } from "./caip.js";
import { NETWORKS, isNetworkKey } from "./networks.js";
import type { IntentEdge, IntentGraph, IntentStatus, IntentStep, StepStatus } from "./intent.js";

const STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = Object.freeze({
  blocked: ["ready", "skipped", "stopped", "failed"],
  ready: ["preparing", "awaiting-signature", "blocked", "skipped", "stopped", "failed"],
  preparing: ["awaiting-signature", "ready", "failed"],
  "awaiting-signature": ["submitted", "preparing", "ready", "stopped", "failed"],
  submitted: ["settling", "settled", "failed"],
  settling: ["settled", "failed"],
  settled: [],
  // ready: re-prepare after a retryable failure; settling / settled: late evidence for a step under review.
  failed: ["ready", "settling", "settled", "stopped"],
  skipped: [],
  stopped: [],
});

export const TERMINAL_STEP_STATUSES: readonly StepStatus[] = Object.freeze(["settled", "skipped", "stopped"]);
/** Statuses in which value may be moving: a stop must wait for these. */
export const IN_FLIGHT_STEP_STATUSES: readonly StepStatus[] = Object.freeze(["preparing", "submitted", "settling"]);

export class StepTransitionError extends Error {
  readonly from: StepStatus;
  readonly to: StepStatus;
  constructor(from: StepStatus, to: StepStatus, reason?: string) {
    super(`Illegal step transition ${from} -> ${to}${reason ? `: ${reason}` : ""}.`);
    this.name = "StepTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** The status-only rule (a status may always "transition" to itself). */
export function canTransitionStep(from: StepStatus, to: StepStatus): boolean {
  return from === to || STEP_TRANSITIONS[from].includes(to);
}

export function nextStepStatuses(from: StepStatus): readonly StepStatus[] {
  return STEP_TRANSITIONS[from];
}

/**
 * The full rule for a concrete step: the table, plus the failure guards. A
 * failed step goes back to `ready` only when its failure is retryable and not
 * under review; it moves to `settling` / `settled` only when it was under
 * review (the outcome was unknown, and evidence has now landed).
 */
export function stepTransitionProblem(step: Pick<IntentStep, "status" | "failure">, to: StepStatus): string | null {
  if (!canTransitionStep(step.status, to)) return "not in the transition table";
  if (step.status === "failed" && to !== "failed") {
    const failure = step.failure;
    if (to === "ready" && (!failure || !failure.retryable || failure.review === true)) return "the failure is not retryable or is held for review";
    if ((to === "settling" || to === "settled") && failure?.review !== true) return "only a step under review can settle after failing";
  }
  return null;
}

export function assertStepTransition(step: Pick<IntentStep, "status" | "failure">, to: StepStatus): void {
  const problem = stepTransitionProblem(step, to);
  if (problem) throw new StepTransitionError(step.status, to, problem);
}

/** Asserts every hop of a path (e.g. failed -> ready -> preparing -> awaiting-signature). */
export function assertStepPath(step: Pick<IntentStep, "status" | "failure">, path: readonly StepStatus[]): void {
  let current: Pick<IntentStep, "status" | "failure"> = step;
  for (const to of path) {
    assertStepTransition(current, to);
    current = { status: to, ...(to === "failed" ? { failure: current.failure } : {}) };
  }
}

/** Done for dependency purposes: settled, or skipped as not needed. A stopped parent never unlocks children. */
export function isStepDone(step: Pick<IntentStep, "status">): boolean {
  return step.status === "settled" || step.status === "skipped";
}

export function isStepTerminal(step: Pick<IntentStep, "status" | "failure">): boolean {
  return TERMINAL_STEP_STATUSES.includes(step.status) || (step.status === "failed" && step.failure?.retryable !== true && step.failure?.review !== true);
}

export function isStepInFlight(step: Pick<IntentStep, "status">): boolean {
  return IN_FLIGHT_STEP_STATUSES.includes(step.status);
}

/** Steps that may run next: blocked or ready, with every dependency done. */
export function readySteps(steps: readonly IntentStep[]): IntentStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return steps.filter(
    (step) =>
      (step.status === "blocked" || step.status === "ready") &&
      step.dependsOn.every((dependency) => {
        const parent = byId.get(dependency);
        return parent !== undefined && isStepDone(parent);
      }),
  );
}

/** Ids of blocked steps whose dependencies are now all done (to move to `ready`). */
export function unlockableSteps(steps: readonly IntentStep[]): string[] {
  return readySteps(steps).filter((step) => step.status === "blocked").map((step) => step.id);
}

/**
 * Intent status from its steps:
 * - every step terminal: `completed` when all settled; `stopped` / `cancelled`
 *   when none ran (stopped by the user / all skipped); else `partially-completed`;
 * - otherwise the first match: `needs-review` (an unknown outcome), `failed`
 *   (`partially-completed` when something already settled), `settling`,
 *   then `executing` once anything started; an unstarted intent past
 *   `expiresAt` is `expired`, else `planned`.
 */
export function deriveIntentStatus(steps: readonly Pick<IntentStep, "status" | "failure">[], expiresAt?: string, now: number = Date.now()): IntentStatus {
  if (steps.length === 0) return "failed";
  const statuses = steps.map((step) => step.status);
  const settled = statuses.filter((status) => status === "settled").length;
  if (statuses.every((status) => TERMINAL_STEP_STATUSES.includes(status))) {
    if (settled === steps.length) return "completed";
    if (settled === 0) return statuses.includes("stopped") ? "stopped" : "cancelled";
    return "partially-completed";
  }
  if (steps.some((step) => step.status === "failed" && step.failure?.review === true)) return "needs-review";
  if (statuses.includes("failed")) return settled > 0 ? "partially-completed" : "failed";
  if (statuses.includes("settling")) return "settling";
  const started = statuses.some((status) => status === "preparing" || status === "awaiting-signature" || status === "submitted" || status === "settled");
  if (!started && expiresAt !== undefined && Date.parse(expiresAt) < now) return "expired";
  return started ? "executing" : "planned";
}

/** Kahn topological order; throws on a cycle or an unknown dependency. */
export function topologicalOrder<T extends Pick<IntentStep, "id" | "dependsOn">>(steps: readonly T[]): T[] {
  const ids = new Set(steps.map((step) => step.id));
  const indegree = new Map<string, number>(steps.map((step) => [step.id, 0]));
  const children = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency}.`);
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      children.set(dependency, [...(children.get(dependency) ?? []), step.id]);
    }
  }
  const byId = new Map(steps.map((step) => [step.id, step]));
  const queue = steps.filter((step) => (indegree.get(step.id) ?? 0) === 0).map((step) => step.id);
  const ordered: T[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const step = byId.get(id);
    if (step) ordered.push(step);
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) queue.push(child);
    }
  }
  if (ordered.length !== steps.length) throw new Error("Intent graph contains a cycle.");
  return ordered;
}

/** Edges implied by the steps: `funds` from each step's funding parent, `orders` for every other dependency. */
export function edgesFromSteps(steps: readonly Pick<IntentStep, "id" | "dependsOn" | "funding">[]): IntentEdge[] {
  return steps.flatMap((step) =>
    step.dependsOn.map((dependency) => ({ from: dependency, to: step.id, kind: step.funding?.from === dependency ? ("funds" as const) : ("orders" as const) })),
  );
}

export interface GraphValidationIssue {
  readonly path: string;
  readonly message: string;
}

const HYPERCORE_ONLY_KINDS = new Set(["order", "cancel", "leverage", "twap", "agent", "margin"]);

/** Structural validation of a compiled graph. Returns an empty list when valid. */
export function validateIntentGraph(graph: IntentGraph): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const ids = new Set<string>();
  graph.accounts.forEach((account, index) => {
    const parsed = parseAccountId(account);
    if (!parsed) issues.push({ path: `accounts[${index}]`, message: "Accounts must be CAIP-10 ids." });
    else if (parsed.network.environment !== graph.environment) issues.push({ path: `accounts[${index}]`, message: "Account is on the other environment." });
  });
  graph.steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    if (ids.has(step.id)) issues.push({ path, message: `Duplicate step id ${step.id}.` });
    ids.add(step.id);
    if (step.index !== index) issues.push({ path, message: "Step index does not match its position." });
    if (!isNetworkKey(step.network)) {
      issues.push({ path, message: `Unknown network ${String(step.network)}.` });
      return;
    }
    const network = NETWORKS[step.network];
    if (network.caip2 !== step.chain) issues.push({ path, message: "Step chain does not match its network." });
    if (network.environment !== graph.environment) issues.push({ path, message: "Step network is on the other environment: testnet and mainnet capital never mix." });
    const account = parseAccountId(step.account);
    if (!account || account.network.key !== step.network) issues.push({ path, message: "Step account must be a CAIP-10 account on the step network." });
    if (step.recipient !== undefined) {
      const recipient = parseAccountId(step.recipient);
      const target = step.settlement?.destinationNetwork ?? step.network;
      if (!recipient || recipient.network.key !== target) issues.push({ path: `${path}.recipient`, message: "Recipient must be a CAIP-10 account on the network that receives the funds." });
    }
    const destination = step.settlement?.destinationNetwork;
    if (destination !== undefined && (!isNetworkKey(destination) || NETWORKS[destination].environment !== graph.environment)) {
      issues.push({ path: `${path}.settlement`, message: "Cross-network step mixes mainnet and testnet capital." });
    }
    if (HYPERCORE_ONLY_KINDS.has(step.kind) && network.vm !== "hypercore") {
      issues.push({ path: `${path}.kind`, message: `${step.kind} steps run on HyperCore.` });
    }
    if (step.kind === "order" && !step.order) issues.push({ path, message: "An order step needs its order snapshot." });
    if (step.kind === "twap" && !step.twap) issues.push({ path, message: "A TWAP step needs its TWAP snapshot." });
    if (step.kind === "leverage" && !step.leverage) issues.push({ path, message: "A leverage step needs its leverage snapshot." });
    if ((step.mode === "agent" || step.mode === "keeper") && network.vm !== "hypercore") {
      issues.push({ path: `${path}.mode`, message: "Only HyperCore actions are signed by an agent key." });
    }
    if (step.funding && !step.dependsOn.includes(step.funding.from)) issues.push({ path: `${path}.funding`, message: "A funded step must depend on its funding parent." });
  });
  graph.steps.forEach((step, index) => {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) issues.push({ path: `steps[${index}].dependsOn`, message: `Unknown dependency ${dependency}.` });
    }
  });
  graph.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) issues.push({ path: `edges[${index}]`, message: "Edge references an unknown step." });
  });
  if (issues.every((issue) => !issue.message.startsWith("Unknown dependency"))) {
    try {
      topologicalOrder(graph.steps);
    } catch (error) {
      issues.push({ path: "steps", message: (error as Error).message });
    }
  }
  return issues;
}
