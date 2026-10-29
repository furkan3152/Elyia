/**
 * Signs HyperCore L1 actions with the in-browser agent key, behind the Rule
 * Book. Order of checks, all fail closed:
 *
 * 1. The action type must be one an agent may sign (core
 *    AGENT_SIGNABLE_ACTIONS: trading only, never withdrawals or transfers).
 * 2. A Rule Book check must be supplied, and its facts must describe this
 *    action (every step an agent-signed step of this action type).
 * 3. `evaluatePolicy(book, facts)` must allow it; a "confirm" decision
 *    needs the user's explicit confirmation for this very action. A
 *    de-risking action (cancels, reduce-only orders: read from the action
 *    itself) passes every limit but the hard floor (trading/derisk.ts).
 * 4. The key must not be past its expiry (HyperCore would refuse anyway).
 *
 * Only then is a nonce taken (monotonic per agent), `expiresAfter` set, the
 * phantom-agent typed data built by @elyia/core and signed locally. Nothing
 * here runs on a timer: callers sign only what the user triggered.
 */
import { isAgentSignable, type L1Action } from "@elyia/core/hypercore/actions";
import { buildExchangeRequest, l1ActionTypedData, type Eip712TypedData, type ExchangeRequest } from "@elyia/core/hypercore/signing";
import type { RuleBook } from "@elyia/core/policy";
import { evaluatePolicy, type PolicyEvaluation, type PolicyFacts } from "@elyia/core/policyEvaluate";

import { applyDeriskLane, type LaneEvaluation } from "../trading/derisk";
import type { NonceManager } from "./nonce";

export class GuardBlockedError extends Error {
  readonly evaluation: PolicyEvaluation | null;
  constructor(message: string, evaluation: PolicyEvaluation | null = null) {
    super(message);
    this.name = "GuardBlockedError";
    this.evaluation = evaluation;
  }
}

export class ConfirmationRequiredError extends Error {
  readonly evaluation: PolicyEvaluation;
  constructor(evaluation: PolicyEvaluation) {
    super(evaluation.reasons.find((reason) => reason.outcome === "confirm")?.message ?? "Your rules ask you to confirm this.");
    this.name = "ConfirmationRequiredError";
    this.evaluation = evaluation;
  }
}

export interface GuardInput {
  readonly book: RuleBook;
  readonly facts: PolicyFacts;
}

export interface AgentSignerDeps {
  /** The agent's local signer (viem `privateKeyToAccount(...).signTypedData`). */
  readonly signTypedData: (typedData: Eip712TypedData<"Agent">) => Promise<`0x${string}`>;
  readonly nonces: NonceManager;
  readonly isMainnet: boolean;
  /** The key's HyperCore expiry (ms); a key past it is never used. */
  readonly validUntil?: number;
  readonly now?: () => number;
}

export class AgentExpiredError extends Error {
  constructor() {
    super("Your trading key has expired. Enable trading again to make a fresh one.");
    this.name = "AgentExpiredError";
  }
}

export interface SignOptions {
  /** The user confirmed this action after seeing a "confirm" verdict. */
  readonly confirmed?: boolean;
  /** HyperCore drops the action after this long (default 45 s). */
  readonly expiresInMs?: number;
  readonly vaultAddress?: string | null;
}

export interface SignedAction {
  readonly request: ExchangeRequest;
  readonly evaluation: LaneEvaluation;
  readonly nonce: number;
}

/** Runs the Rule Book for an action and throws unless it may be signed now. */
export function checkGuard(action: L1Action, guard: GuardInput | null, confirmed: boolean): LaneEvaluation {
  if (!isAgentSignable(action)) throw new GuardBlockedError(`The trading key may never sign ${action.type}.`);
  if (!guard) throw new GuardBlockedError("No Rule Book check was run for this action, so Elyia will not sign it.");
  const steps = guard.facts.steps;
  if (steps.length === 0 || steps.some((step) => step.signer !== "agent" || step.agentAction !== action.type)) {
    throw new GuardBlockedError("The Rule Book check does not describe this action, so Elyia will not sign it.");
  }
  if (guard.facts.stage !== "sign") throw new GuardBlockedError("The Rule Book check must run at signing time.");
  const evaluation = applyDeriskLane(action, evaluatePolicy(guard.book, guard.facts));
  if (evaluation.decision === "deny") {
    throw new GuardBlockedError(evaluation.reasons.find((reason) => reason.outcome === "deny")?.message ?? "Your Rule Book blocks this.", evaluation);
  }
  if (evaluation.decision === "confirm" && !confirmed) throw new ConfirmationRequiredError(evaluation);
  return evaluation;
}

/** Guard, nonce, typed data, local signature, /exchange body. */
export async function signAgentAction(deps: AgentSignerDeps, action: L1Action, guard: GuardInput | null, options: SignOptions = {}): Promise<SignedAction> {
  const evaluation = checkGuard(action, guard, options.confirmed === true);
  if (deps.validUntil !== undefined && deps.validUntil <= (deps.now ?? Date.now)()) throw new AgentExpiredError();
  const nonce = deps.nonces.next();
  const expiresAfter = nonce + (options.expiresInMs ?? 45_000);
  const vaultAddress = options.vaultAddress ?? null;
  const { typedData } = l1ActionTypedData({ action, nonce, vaultAddress, expiresAfter, isMainnet: deps.isMainnet });
  const signature = await deps.signTypedData(typedData);
  const request = buildExchangeRequest({ action, nonce, signature, vaultAddress, expiresAfter });
  return { request, evaluation, nonce };
}
