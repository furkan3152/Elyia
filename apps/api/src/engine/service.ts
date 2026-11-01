/**
 * The intent service (ported from Kletia's service.ts): plan and store,
 * prepare (fresh quote -> unsigned requests + quote binding, after the Rule
 * Book), submit (references only, verified from chain or the info API,
 * claimed globally once), progress (re-verification, settlement polls,
 * follow-up steps, unlocking) and stop.
 *
 * Invariants: the server never signs; a submitted reference that is not the
 * step's own payload (wrong sender, chain, network, binding, too old, used)
 * is rejected with 422 and never changes the step; a step whose outcome
 * cannot be proven is held for review, never retried or failed silently.
 */
import {
  buildJourney,
  fundedFlow,
  getEvmNetwork,
  isStepDone,
  isStepTerminal,
  l1RequestConsistent,
  NETWORKS,
  newIntentId,
  parentCredit,
  parseAccountId,
  parseReference,
  quoteBinding,
  referenceClaimKey,
  referenceFitsNetwork,
  userSignedRequestConsistent,
  type AccountId,
  type IntentActionSpec,
  type IntentConstraints,
  type IntentGraph,
  type IntentSource,
  type IntentStep,
  type NetworkEnvironment,
  type ParsedReference,
  type PreparedRequestRecord,
  type PreparedStepRecord,
  type StepExecutionPayload,
  type TransactionRequest,
} from "@elyia/core";
import type { CreateIntentResponse, IntentSigner, PolicySummary, PrepareStepBody, PrepareStepResponse, StopIntentResponse, SubmitStepResponse, VenueQuoteView } from "@elyia/core/api/intents";
import type { Logger } from "../log.js";
import type { EngineDeps } from "./deps.js";
import { engineError } from "./errors.js";
import type { IntentEvents } from "./events.js";
import { addEvidence, appendFollowUp, failureOf, moveStep, replaceStep, started, touch, unlock, without } from "./graph.js";
import { L1_EXPIRY_MS } from "./hypercore/requests.js";
import { ownerAddress } from "./planner/normalize.js";
import type { Planner } from "./planner/build.js";
import { isDerisking, PolicyGate, unpricedWarnings } from "./policy.js";
import type { AdapterRegistry } from "./registry.js";
import type { IntentStore, StoredIntent } from "./store.js";
import type { PreparedPayload, VerificationResult } from "./types.js";
import { isRejection } from "./verify.js";

/** Earlier payloads kept on a step (an older signed payload that lands still verifies). */
export const MAX_HISTORY = 10;
/** GET re-checks in-flight steps at most this often per intent. */
export const LAZY_PROGRESS_MS = 10_000;

export interface CreateInput {
  readonly actions: readonly IntentActionSpec[];
  readonly accounts: readonly AccountId[];
  readonly environment: NetworkEnvironment;
  readonly constraints?: IntentConstraints;
  readonly signer: IntentSigner;
  readonly agent?: string;
  readonly dryRun: boolean;
  readonly text?: string;
  readonly source: IntentSource;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly clientReference?: string;
}

export interface ServiceParts {
  readonly deps: EngineDeps;
  readonly registry: AdapterRegistry;
  readonly planner: Planner;
  readonly store: IntentStore;
  readonly events: IntentEvents;
  readonly gate: PolicyGate;
  readonly log: Logger;
}

function flatMessage(action: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(action)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** What the step records about each request it handed out (enough to attribute evidence later). */
export function requestRecord(request: TransactionRequest, payload: PreparedPayload): PreparedRequestRecord {
  if (request.vm === "evm") return { vm: "evm", network: request.network, to: request.to.toLowerCase(), description: request.description };
  if (request.kind === "user-signed") {
    return { vm: "hypercore", network: request.network, kind: "user-signed", actionType: request.action.type, description: request.description, nonce: request.nonce, message: flatMessage(request.action) };
  }
  return {
    vm: "hypercore",
    network: request.network,
    kind: "l1-action",
    actionType: request.action.type,
    description: request.description,
    nonce: request.nonce,
    agent: request.agent,
    expiresAfter: request.expiresAfter,
    ...(request.cloids ? { cloids: request.cloids } : {}),
    ...(request.action.type === "order" && payload.order ? { orders: [payload.order] } : {}),
  };
}

/** The service's own checks on an adapter's payload before it is handed out (PAYLOAD_INVALID otherwise). */
export function validatePayload(step: IntentStep, requests: readonly TransactionRequest[], now: number, agent: string | undefined): string | null {
  const account = parseAccountId(step.account);
  if (!account) return "The step account is not a CAIP-10 id.";
  const owner = account.address.toLowerCase();
  if (requests.length === 0) return "The payload has no requests.";
  for (const [index, request] of requests.entries()) {
    const where = `request ${index + 1}`;
    if (request.network !== step.network) return `${where} is for another network.`;
    if (request.from.toLowerCase() !== owner) return `${where} is from another account.`;
    if (request.vm === "evm") {
      const network = NETWORKS[request.network];
      if (network.vm !== "evm" || request.chainId !== network.chainId) return `${where} has the wrong chain id.`;
      if (!/^0x[0-9a-fA-F]{40}$/u.test(request.to)) return `${where} has no valid target.`;
      if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(request.data)) return `${where} has malformed calldata.`;
      if (!/^\d+$/u.test(request.value)) return `${where} has a malformed value.`;
      continue;
    }
    if (NETWORKS[request.network].vm !== "hypercore") return `${where} is not a HyperCore request.`;
    if (request.kind === "user-signed") {
      if (!userSignedRequestConsistent(request)) return `${where}: the typed data does not match the action.`;
      continue;
    }
    if (!l1RequestConsistent(request)) return `${where}: the connection id does not commit to the action, nonce and expiry.`;
    if (request.expiresAfter <= now || request.expiresAfter > now + 5 * 60_000) return `${where}: expiresAfter is out of range.`;
    if (agent && request.agent.toLowerCase() !== agent.toLowerCase()) return `${where} names another agent.`;
  }
  return null;
}

/** Quotes whose output token has no reference price say so (the amounts are real, the USD value is unknown). */
function labelUnpricedQuotes(quotes: readonly VenueQuoteView[], graph: IntentGraph, summary: PolicySummary): VenueQuoteView[] {
  const unpriced = new Set((summary.unpriced ?? []).map((note) => note.asset.toLowerCase()));
  if (unpriced.size === 0) return [...quotes];
  return quotes.map((quote) => {
    const output = graph.steps.find((step) => step.id === quote.stepId)?.outputs[0]?.asset.toLowerCase();
    if (!output || !unpriced.has(output)) return quote;
    const note = `unpriced: ${quote.symbol} has no reference price; this amount has no USD value here.`;
    return { ...quote, note: quote.note ? `${quote.note} ${note}` : note };
  });
}

export class IntentService {
  private readonly lastProgress = new Map<string, number>();

  constructor(private readonly parts: ServiceParts) {}

  private get now(): number {
    return this.parts.deps.clock.now();
  }

  /* ---------------------------------------------------------------- create */

  async create(input: CreateInput): Promise<CreateIntentResponse> {
    const { deps, planner, gate, store, events } = this.parts;
    const owner = ownerAddress(input.accounts);
    const id = newIntentId(deps.random);
    const planned = await planner.plan({
      id,
      environment: input.environment,
      owner,
      accounts: input.accounts,
      actions: input.actions,
      ...(input.constraints ? { constraints: input.constraints } : {}),
      signer: input.signer,
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.text ? { text: input.text } : {}),
      source: input.source,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    const graph = planned.graph;
    for (const step of graph.steps) {
      for (const network of [step.network, step.settlement?.destinationNetwork]) {
        if (network && NETWORKS[network].status !== "live") throw engineError("ENVIRONMENT_UNAVAILABLE", `${NETWORKS[network].name} is not live yet.`);
      }
    }
    const result = await gate.evaluate(graph, { stage: "plan", stored: !input.dryRun, owner });
    if (!input.dryRun) PolicyGate.enforce(result);
    const unpriced = unpricedWarnings(result.summary);
    const stamped: IntentGraph = {
      ...graph,
      ...(unpriced.length > 0 ? { warnings: [...new Set([...graph.warnings, ...unpriced])] } : {}),
      ...(result.evaluation.decision !== "deny" ? { policy: PolicyGate.stamp(result) } : {}),
    };
    const now = this.now;
    const quotes = labelUnpricedQuotes(planned.quotes, graph, result.summary);
    if (input.dryRun) {
      return { intent: stamped, journey: buildJourney(stamped, now), policy: result.summary, quotes, dryRun: true, replayed: false };
    }
    const { stored, replayed } = await store.create(stamped, input.clientReference);
    if (!replayed) events.diff(null, stored.graph);
    return { intent: stored.graph, journey: buildJourney(stored.graph, now), policy: result.summary, quotes: replayed ? [] : quotes, dryRun: false, replayed };
  }

  /* ------------------------------------------------------------------ read */

  async get(id: string): Promise<IntentGraph> {
    const last = this.lastProgress.get(id) ?? 0;
    const current = await this.parts.store.require(id);
    const inFlight = current.graph.steps.some((step) => step.status === "submitted" || step.status === "settling");
    if (inFlight && this.now - last >= LAZY_PROGRESS_MS) {
      try {
        return (await this.progress(id)).graph;
      } catch (error) {
        this.parts.log.warn("lazy intent progress failed", { intentId: id, error });
      }
    }
    return touch(current.graph, this.now);
  }

  async journey(id: string) {
    const graph = await this.get(id);
    return buildJourney(graph, this.now);
  }

  /* --------------------------------------------------------------- prepare */

  private stepOf(graph: IntentGraph, stepId: string): IntentStep {
    const step = graph.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw engineError("STEP_NOT_FOUND");
    return step;
  }

  private assertOpen(graph: IntentGraph, now: number): void {
    if (graph.steps.every((step) => step.status === "stopped" || isStepTerminal(step)) && graph.steps.some((step) => step.status === "stopped")) throw engineError("INTENT_STOPPED");
    if (!started(graph) && Date.parse(graph.expiresAt) < now) throw engineError("INTENT_EXPIRED");
  }

  /** The amount the step executes now (funded steps: their share of what the parent delivered). */
  private amountFor(graph: IntentGraph, step: IntentStep): bigint {
    const planned = step.route?.plannedInput ?? step.inputs[0]?.expected ?? "0";
    if (!step.funding) return BigInt(planned);
    const credit = parentCredit(graph, step);
    if (!credit || credit.certainty !== "observed") throw engineError("STEP_NOT_READY", "The step this one spends from has not reported what it delivered yet.");
    const flow = fundedFlow(graph, step, credit, { slippageBps: step.route?.slippageBps ?? 50, plannedInput: BigInt(planned) });
    if (flow.spends.expected <= 0n) throw engineError("AMOUNT_TOO_SMALL", "Nothing is left to spend after the gas reserve.");
    return flow.spends.expected;
  }

  async prepare(id: string, stepId: string, body: PrepareStepBody): Promise<PrepareStepResponse> {
    const { registry, gate, store, events } = this.parts;
    const loaded = await store.require(id);
    const now = this.now;
    const graph = loaded.graph;
    this.assertOpen(graph, now);
    let step = this.stepOf(graph, stepId);
    if (step.status === "blocked") throw engineError("STEP_NOT_READY");
    const preparable = step.status === "ready" || step.status === "awaiting-signature" || (step.status === "failed" && step.failure?.retryable === true && step.failure.review !== true);
    if (!preparable) throw engineError("STEP_NOT_PREPARABLE", undefined, { status: step.status });
    const parents = graph.steps.filter((candidate) => step.dependsOn.includes(candidate.id));
    if (parents.some((parent) => !isStepDone(parent))) throw engineError("STEP_NOT_READY");

    const owner = parseAccountId(step.account)?.address.toLowerCase() ?? "";
    const derisking = isDerisking(step);
    const policy = await gate.evaluate(graph, { stage: "prepare", stored: true, owner });
    if (!derisking) {
      PolicyGate.enforce(policy);
      if (policy.evaluation.decision === "confirm" && body.confirmed !== true) {
        throw engineError("POLICY_CONFIRMATION_REQUIRED", policy.evaluation.reasons.find((reason) => reason.outcome === "confirm")?.message, { reasons: policy.summary.reasons });
      }
    }

    const amount = this.amountFor(graph, step);
    const adapter = registry.forStep(step);
    const expiresAt = Math.floor((now + L1_EXPIRY_MS) / 1000);
    const agent = body.agent?.toLowerCase() ?? (step.mode === "agent" || step.mode === "keeper" ? step.agent?.address : undefined);
    const signatureChainId = body.signatureChainId ?? getEvmNetwork(`elysium-${graph.environment}` as const).chainId;
    const payload = await adapter.prepare({ graph, step, amount, now, expiresAt, signatureChainId, ...(agent ? { agent } : {}) });

    if (payload.skip) {
      const path = step.status === "ready" ? (["skipped"] as const) : (["ready", "skipped"] as const);
      const skipped = addEvidence(without(moveStep(step, [...path]), "failure"), [{ kind: "note", network: step.network, observedAt: new Date(now).toISOString(), detail: payload.skip }]);
      const next = touch(unlock(replaceStep(graph, skipped)), now);
      const saved = await store.save(next, loaded.version);
      events.diff(graph, saved.graph);
      const empty: StepExecutionPayload = { intentId: id, stepId, vm: NETWORKS[step.network].vm, requests: [], expiresAt, quoteBinding: quoteBinding([]) };
      return { intent: saved.graph, payload: empty, policy: policy.summary, warnings: [payload.skip] };
    }

    const problem = validatePayload(step, payload.requests, now, step.mode === "agent" || step.mode === "keeper" ? agent : undefined);
    if (problem) {
      this.parts.log.error("payload failed the service checks", { intentId: id, stepId, problem });
      throw engineError("PAYLOAD_INVALID", undefined, { problem });
    }
    const binding = quoteBinding(payload.requests);
    const floor = payload.outputs[0]?.minimum;
    const record: PreparedStepRecord = {
      quoteBinding: binding,
      preparedAt: new Date(now).toISOString(),
      expiresAt,
      requests: payload.requests.map((request) => requestRecord(request, payload)),
      ...(payload.observed ? { observed: payload.observed } : {}),
      ...(floor !== undefined ? { floor } : {}),
    };
    const path = step.status === "ready" ? (["preparing", "awaiting-signature"] as const) : step.status === "failed" ? (["ready", "preparing", "awaiting-signature"] as const) : (["preparing", "awaiting-signature"] as const);
    const history = step.prepared ? [...(step.history ?? []), step.prepared].slice(-MAX_HISTORY) : step.history;
    const warnings = [...new Set([...(step.warnings ?? []), ...payload.warnings])].slice(-20);
    const moved = moveStep(step, [...path], {
      inputs: payload.inputs,
      outputs: payload.outputs,
      ...(payload.extraCosts ? { extraCosts: payload.extraCosts } : {}),
      ...(payload.order ? { order: payload.order } : {}),
      ...(payload.cancel ? { cancel: payload.cancel } : {}),
      ...(payload.agent ? { agent: payload.agent } : {}),
      ...(payload.settlement ? { settlement: { ...(step.settlement ?? { kind: "same-network" }), ...payload.settlement } } : {}),
      prepared: record,
      ...(history ? { history } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
    step = without(moved, "failure", "references", "submittedAt");
    const next = touch(replaceStep(graph, step), now);
    const saved = await store.save(next, loaded.version);
    events.diff(graph, saved.graph);
    if (!derisking && policy.evaluation.notionalUsdMicros !== null && !(await store.hasSpend(owner, id))) {
      await store.recordSpend(owner, id, policy.evaluation.notionalUsdMicros).catch((error: unknown) => this.parts.log.warn("spend ledger write failed", { intentId: id, error }));
    }
    const executionPayload: StepExecutionPayload = {
      intentId: id,
      stepId,
      vm: NETWORKS[step.network].vm,
      requests: payload.requests,
      expiresAt,
      quoteBinding: binding,
      policy: { decisionId: policy.decisionId, notionalUsd: policy.summary.notionalUsd, ruleBookHash: policy.ruleBookHash as StepExecutionPayload["quoteBinding"] },
    };
    return { intent: saved.graph, payload: executionPayload, policy: policy.summary, warnings: [...new Set([...payload.warnings, ...unpricedWarnings(policy.summary)])] };
  }

  /* ---------------------------------------------------------------- submit */

  private parseReferences(step: IntentStep, raw: readonly string[]): ParsedReference[] {
    const parsed = raw.map((value) => parseReference(value));
    if (parsed.some((value) => value === null)) throw engineError("REFERENCE_INVALID");
    const references = parsed as ParsedReference[];
    if (references.length !== (step.prepared?.requests.length ?? 0)) throw engineError("REFERENCE_COUNT_MISMATCH", undefined, { expected: step.prepared?.requests.length ?? 0, received: references.length });
    for (const reference of references) {
      if (!referenceFitsNetwork(reference, step.network)) throw engineError("REFERENCE_WRONG_NETWORK");
    }
    return references;
  }

  async submit(id: string, stepId: string, raw: readonly string[]): Promise<SubmitStepResponse> {
    const { registry, store, events } = this.parts;
    const loaded = await store.require(id);
    const now = this.now;
    const graph = loaded.graph;
    const step = this.stepOf(graph, stepId);
    if (step.status === "submitted" || step.status === "settling" || step.status === "settled") {
      if (step.references && step.references.length === raw.length && step.references.every((value, index) => value.toLowerCase() === raw[index]?.toLowerCase())) {
        return { intent: touch(graph, now), step, verification: step.status === "submitted" ? "pending" : "confirmed" };
      }
    }
    if (step.status !== "awaiting-signature" || !step.prepared) throw engineError("STEP_NOT_AWAITING_SIGNATURE", undefined, { status: step.status });
    const references = this.parseReferences(step, raw);
    const keys = references.map((reference) => referenceClaimKey(step.network, reference));
    for (const key of keys) {
      const owner = await store.claimOwner(key);
      if (owner && (owner.intentId !== id || owner.stepId !== stepId)) throw engineError("REFERENCE_ALREADY_USED");
    }
    const result = await registry.forStep(step).verify({ graph, step, references, submittedAt: now, now });
    if (isRejection(result)) throw engineError(result.failure.code, result.failure.message);
    for (const key of keys) {
      const claimed = await store.claim(key, id, stepId);
      if (!claimed.ok) throw engineError("REFERENCE_ALREADY_USED");
    }
    const submitted = moveStep(step, ["submitted"], { references: raw.map((value) => value.trim()), submittedAt: new Date(now).toISOString() });
    const next = this.applyVerification(graph, submitted, result, now);
    const saved = await store.save(next, loaded.version);
    events.diff(graph, saved.graph);
    const final = this.stepOf(saved.graph, stepId);
    return { intent: saved.graph, step: final, verification: result.status === "confirmed" ? "confirmed" : result.status === "pending" ? "pending" : "failed" };
  }

  /** A submitted step after a verification result (not a rejection). */
  private applyVerification(graph: IntentGraph, step: IntentStep, result: VerificationResult, now: number): IntentGraph {
    let next: IntentStep = addEvidence(step, result.evidence);
    if (result.status === "pending") {
      if (!result.stale) return touch(replaceStep(graph, next), now);
      next = moveStep(next, ["failed"], { failure: failureOf("OUTCOME_UNKNOWN", `Still unconfirmed after a long wait: ${result.reason}`, true) });
      return touch(replaceStep(graph, next), now);
    }
    if (result.status === "failed") {
      next = moveStep(next, ["failed"], { failure: failureOf(result.failure.code, result.failure.message) });
      return touch(replaceStep(graph, next), now);
    }
    const settlement = result.settlement ? { settlement: { ...(next.settlement ?? { kind: "same-network" as const }), ...result.settlement } } : {};
    next = moveStep(next, [result.settled ? "settled" : "settling"], { ...settlement, ...(result.actualOutputs ? { actualOutputs: result.actualOutputs } : {}) });
    return touch(unlock(replaceStep(graph, next)), now);
  }

  /* -------------------------------------------------------------- progress */

  /** Re-verifies submitted steps and polls settling ones (and review steps with something to follow). */
  async progress(id: string): Promise<StoredIntent> {
    const { store, events, log } = this.parts;
    this.lastProgress.set(id, this.now);
    let before: IntentGraph | null = null;
    const saved = await store.update(id, async (current) => {
      before = current.graph;
      const now = this.now;
      let graph = current.graph;
      let changed = false;
      for (const step of current.graph.steps) {
        try {
          const updated = await this.progressStep(graph, step, now);
          if (updated !== graph) {
            graph = updated;
            changed = true;
          }
        } catch (error) {
          log.warn("step progress failed", { intentId: id, stepId: step.id, error });
        }
      }
      const unlocked = unlock(graph);
      if (unlocked !== graph) {
        graph = unlocked;
        changed = true;
      }
      return changed ? touch(graph, now) : null;
    });
    if (before && saved.graph !== before) events.diff(before, saved.graph);
    return saved;
  }

  private async progressStep(graph: IntentGraph, original: IntentStep, now: number): Promise<IntentGraph> {
    const step = graph.steps.find((candidate) => candidate.id === original.id) ?? original;
    const adapter = this.parts.registry.forStep(step);
    if (step.status === "submitted") {
      const references = (step.references ?? []).map((value) => parseReference(value)).filter((value): value is ParsedReference => value !== null);
      const submittedAt = step.submittedAt ? Date.parse(step.submittedAt) : now;
      const result = await adapter.verify({ graph, step, references, submittedAt, now });
      if (isRejection(result)) {
        // Not this step's payload after all: release the references and hand the payload back.
        for (const reference of references) await this.parts.store.releaseClaim(referenceClaimKey(step.network, reference), graph.id, step.id);
        const back = moveStep({ ...step, failure: failureOf(result.failure.code, result.failure.message) }, ["failed", "ready", "awaiting-signature"]);
        const noted = addEvidence(without(back, "failure", "references", "submittedAt"), [{ kind: "note", network: step.network, observedAt: new Date(now).toISOString(), detail: `Submitted reference rejected: ${result.failure.message}` }]);
        return replaceStep(graph, noted);
      }
      return this.applyVerification(graph, step, result, now);
    }
    const review = step.status === "failed" && step.failure?.review === true;
    if ((step.status !== "settling" && !review) || !adapter.poll) return graph;
    const result = await adapter.poll(step, graph, now);
    if (result.status === "settling") {
      const merged = result.settlement ? { settlement: { ...(step.settlement ?? { kind: "same-network" as const }), ...result.settlement } } : {};
      const evidenceNew = result.evidence.filter((entry) => !step.evidence.some((seen) => seen.detail === entry.detail));
      let next = graph;
      if (step.status === "settling" && (evidenceNew.length > 0 || result.settlement)) next = replaceStep(next, addEvidence({ ...step, ...merged }, evidenceNew));
      if (result.followUp) next = appendFollowUp(next, result.followUp, step);
      return next;
    }
    if (result.status === "settled") {
      const settled = moveStep(addEvidence(step, result.evidence), ["settled"], {
        ...(result.settlement ? { settlement: { ...(step.settlement ?? { kind: "same-network" as const }), ...result.settlement } } : {}),
        ...(result.actualOutputs ? { actualOutputs: result.actualOutputs } : {}),
      });
      return replaceStep(graph, without(settled, "failure"));
    }
    if (review) return graph;
    const failed = moveStep(addEvidence(step, result.evidence), ["failed"], { failure: failureOf(result.failure.code, result.failure.message, result.review === true) });
    return replaceStep(graph, failed);
  }

  /** One poller pass over the active intents (sequential, bounded). */
  async pollActive(limit = 50): Promise<number> {
    const { store, log } = this.parts;
    const ids = await store.activeIds(limit);
    let touched = 0;
    for (const id of ids) {
      try {
        const current = await store.get(id);
        if (!current) {
          await store.deactivate(id);
          continue;
        }
        const graph = current.graph;
        const now = this.now;
        const done = graph.steps.every((step) => isStepTerminal(step)) || (!started(graph) && Date.parse(graph.expiresAt) < now);
        if (done) {
          await store.deactivate(id);
          continue;
        }
        if (graph.steps.some((step) => step.status === "submitted" || step.status === "settling" || (step.status === "failed" && step.failure?.review === true))) {
          await this.progress(id);
          touched += 1;
        }
      } catch (error) {
        log.warn("intent poll failed", { intentId: id, error });
      }
    }
    return touched;
  }

  /* ------------------------------------------------------------------ stop */

  async stop(id: string): Promise<StopIntentResponse> {
    const { store, events } = this.parts;
    const loaded = await store.require(id);
    const now = this.now;
    const graph = loaded.graph;
    const stoppable = (step: IntentStep) =>
      step.status === "blocked" || step.status === "ready" || step.status === "awaiting-signature" || (step.status === "failed" && step.failure?.review !== true);
    const targets = graph.steps.filter(stoppable);
    if (targets.length === 0) {
      if (graph.steps.every((step) => step.status === "stopped" || isStepTerminal(step))) {
        if (graph.steps.some((step) => step.status === "stopped")) return { intent: touch(graph, now) };
        throw engineError("INTENT_COMPLETED");
      }
      throw engineError("INTENT_IN_FLIGHT");
    }
    const steps = graph.steps.map((step) => (stoppable(step) ? moveStep(step, ["stopped"]) : step));
    const next = touch({ ...graph, steps }, now);
    const saved = await store.save(next, loaded.version);
    events.diff(graph, saved.graph);
    if (saved.graph.steps.every((step) => isStepTerminal(step))) await store.deactivate(id);
    return { intent: saved.graph };
  }
}
