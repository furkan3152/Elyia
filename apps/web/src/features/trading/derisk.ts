/**
 * The de-risk lane (pure). Closing risk must always stay possible: a cancel,
 * or an order whose every leg is reduce-only, is never blocked by the
 * person's limits (market list, slippage cap, kill switch, open-order count,
 * missing account facts, network opt-in). Only the hard floor still applies:
 * the trading key may sign trading actions only, and dry-run mode signs
 * nothing.
 *
 * Whether an action de-risks is read from the action itself (the wire's
 * reduce-only flag, the action type), never from facts a caller supplies,
 * so it cannot be talked into waiving a limit for an order that opens risk.
 * Core `evaluatePolicy` still runs for every action: the waived reasons are
 * kept on the result so the strip can say what was waived and why.
 */
import type { L1Action, OrderWire } from "@elyia/core/hypercore/actions";
import type { PolicyEvaluation, PolicyRuleId } from "@elyia/core/policyEvaluate";

/** Rules that hold even for de-risking actions. */
export const DERISK_FLOOR: ReadonlySet<PolicyRuleId> = new Set<PolicyRuleId>(["agent.actions", "mode.dryRun"]);

const CANCEL_TYPES: ReadonlySet<L1Action["type"]> = new Set<L1Action["type"]>(["cancel", "cancelByCloid", "twapCancel", "noop", "scheduleCancel"]);

function allReduceOnly(wires: readonly OrderWire[]): boolean {
  return wires.length > 0 && wires.every((wire) => wire.r === true);
}

/** True when the action can only lower risk: cancels, or orders / TWAPs / modifies whose every leg is reduce-only. */
export function isDeriskingAction(action: L1Action): boolean {
  if (CANCEL_TYPES.has(action.type)) return true;
  switch (action.type) {
    case "order":
      return allReduceOnly(action.orders);
    case "modify":
      return allReduceOnly([action.order]);
    case "batchModify":
      return allReduceOnly(action.modifies.map((entry) => entry.order));
    case "twapOrder":
      return action.twap.r === true;
    default:
      return false;
  }
}

export interface LaneEvaluation extends PolicyEvaluation {
  /** Reasons the de-risk lane set aside (empty for ordinary actions). */
  readonly waived: PolicyEvaluation["reasons"];
}

/**
 * Applies the de-risk lane to a core evaluation: for a de-risking action
 * every reason outside the floor is waived; otherwise the evaluation stands.
 */
export function applyDeriskLane(action: L1Action, evaluation: PolicyEvaluation): LaneEvaluation {
  if (!isDeriskingAction(action)) return { ...evaluation, waived: [] };
  const kept = evaluation.reasons.filter((reason) => DERISK_FLOOR.has(reason.rule));
  const waived = evaluation.reasons.filter((reason) => !DERISK_FLOOR.has(reason.rule));
  if (waived.length === 0) return { ...evaluation, waived: [] };
  const denied = kept.some((reason) => reason.outcome === "deny");
  const decision: PolicyEvaluation["decision"] = denied ? "deny" : kept.length > 0 ? "confirm" : "allow";
  return {
    ...evaluation,
    decision,
    reasons: kept,
    code: decision === "deny" ? evaluation.code : decision === "confirm" ? "POLICY_CONFIRMATION_REQUIRED" : null,
    retryAfterSeconds: decision === "deny" ? evaluation.retryAfterSeconds : null,
    waived,
  };
}
