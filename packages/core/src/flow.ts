/**
 * One amount model for funded steps (Kletia amount flow F1-F7). A step funded
 * by an earlier step spends its share of what that step delivers, so the
 * preview, the journey and the planner agree about the same money:
 *
 * - F3: the step spends share x parent credit (shares round down; the rest
 *   of a split stays at the parent's output as `kept`, F7);
 * - F6: a planned gas reserve (`funding.gasReserve`) is subtracted after the
 *   share and also stays `kept`; it never makes the spend negative;
 * - a funded step paying someone else never pays more than its planned input
 *   x (1 + slippage); anything above stays with the user. "Someone else" uses
 *   `sameOwner`: the same 0x address on Elysium, HyperEVM or HyperCore is the
 *   user, not a third party.
 *
 * Pure integer math on base units.
 */
import { sameAsset, sameOwner } from "./caip.js";
import type { IntentGraph, IntentStep, StepAmount } from "./intent.js";

/** Default slippage of a step whose quote recorded none. */
export const FLOW_DEFAULT_SLIPPAGE_BPS = 50;
/** F6: a gas reserve may take at most this share of the step's share (else the amount is too small). */
export const GAS_RESERVE_MAX_SHARE_BPS = 2_500;

export interface ParentCredit {
  /** What the parent delivers in the step's input asset. */
  readonly expected: bigint;
  readonly worst: bigint;
  /** observed once the parent settled; quoted for same-network quotes; minimum for cross-network floors. */
  readonly certainty: "observed" | "quoted" | "minimum";
}

export interface FundedFlow {
  readonly spends: { readonly expected: bigint; readonly worst: bigint };
  readonly kept: { readonly expected: bigint; readonly worst: bigint };
  readonly reserve: bigint;
  /** Units the step's quote and payload were built on (planned input). */
  readonly encoded: bigint;
}

function nonNegative(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

/** The step a funded step spends from: `funding.from`, else the `funds` edge into it. */
export function fundingParent(graph: IntentGraph, step: IntentStep): IntentStep | null {
  const from = step.funding?.from ?? graph.edges.find((edge) => edge.to === step.id && edge.kind === "funds")?.from;
  if (!from) return null;
  return graph.steps.find((candidate) => candidate.id === from) ?? null;
}

/** True when `account` belongs to the intent's owner (same 0x address on any network). */
export function isOwnAccount(graph: IntentGraph, account: string): boolean {
  return graph.accounts.some((own) => sameOwner(own, account));
}

function amountIn(list: readonly StepAmount[] | undefined, asset: string): StepAmount | undefined {
  return list?.find((amount) => sameAsset(amount.asset, asset));
}

/** What the funding parent delivers in the step's (first) input asset; null when the step is not funded by it. */
export function parentCredit(graph: IntentGraph, step: IntentStep): ParentCredit | null {
  const input = step.inputs[0];
  if (!input) return null;
  const parent = fundingParent(graph, step);
  if (!parent) return null;
  const observed = amountIn(parent.actualOutputs, input.asset);
  if (observed) {
    const value = BigInt(observed.expected);
    return { expected: value, worst: value, certainty: "observed" };
  }
  const planned = amountIn(parent.outputs, input.asset);
  if (!planned) return null;
  const expected = BigInt(planned.expected);
  const worst = BigInt(planned.minimum ?? planned.expected);
  return { expected: expected < worst ? worst : expected, worst, certainty: parent.settlement?.kind === "cross-network" ? "minimum" : "quoted" };
}

/** F3, F6, F7 and the third-party cap, in base units of the step's input. */
export function fundedFlow(
  graph: IntentGraph,
  step: IntentStep,
  credit: ParentCredit,
  options: { readonly slippageBps?: number; readonly plannedInput?: bigint } = {},
): FundedFlow {
  const portion = BigInt(step.funding?.portionBps ?? 10_000);
  const reserve = nonNegative(step.funding?.gasReserve ? BigInt(step.funding.gasReserve) : 0n);
  const encoded = step.inputs[0] ? BigInt(step.inputs[0].expected) : 0n;
  let expected = nonNegative((credit.expected * portion) / 10_000n - reserve);
  let worst = nonNegative((credit.worst * portion) / 10_000n - reserve);
  if (!isOwnAccount(graph, step.recipient ?? step.account)) {
    const slippage = BigInt(options.slippageBps ?? FLOW_DEFAULT_SLIPPAGE_BPS);
    const cap = ((options.plannedInput ?? encoded) * (10_000n + slippage)) / 10_000n;
    if (expected > cap) expected = cap;
    if (worst > cap) worst = cap;
  }
  return {
    spends: { expected, worst },
    kept: { expected: nonNegative(credit.expected - expected), worst: nonNegative(credit.worst - worst) },
    reserve,
    encoded,
  };
}

/** Linear scaling of a step's output by spends / encoded (marked estimated when it differs). */
export function scaleOutput(output: bigint, flow: FundedFlow | null): { readonly expected: bigint; readonly estimated: boolean } {
  if (!flow || flow.encoded === 0n || flow.spends.expected === flow.encoded) return { expected: output, estimated: false };
  return { expected: (output * flow.spends.expected) / flow.encoded, estimated: true };
}

/** The guaranteed output when the funding floor fell below the encoded input: scaled down, never up. */
export function scaleFloor(minimum: bigint, flow: FundedFlow | null): bigint {
  if (!flow || flow.encoded === 0n || flow.spends.worst >= flow.encoded) return minimum;
  return (minimum * flow.spends.worst) / flow.encoded;
}

/** Rounds a non-negative integer up to `digits` significant digits (4458 -> 4500 with two). */
export function ceilSignificant(value: bigint, digits = 2): bigint {
  if (value <= 0n) return 0n;
  const width = value.toString().length;
  if (width <= digits) return value;
  const unit = 10n ** BigInt(width - digits);
  return ((value + unit - 1n) / unit) * unit;
}

/** F6: the HYPE kept back for gas: twice the estimated fees, rounded up to two significant digits. */
export function gasReserveUnits(fees: bigint): bigint {
  return ceilSignificant(2n * nonNegative(fees));
}

/** True when the reserve would take GAS_RESERVE_MAX_SHARE_BPS or more of the share (mostly fees would arrive). */
export function reserveTooLarge(reserve: bigint, share: bigint): boolean {
  return reserve > 0n && reserve * 10_000n >= share * BigInt(GAS_RESERVE_MAX_SHARE_BPS);
}
