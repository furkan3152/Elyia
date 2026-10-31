/**
 * Shared verification of submitted references (ported from Kletia's
 * adapters/verification.ts, EVM half).
 *
 * EVM: every reference must be mined on the step chain from the step
 * account, and the landed transactions (chain, from, to, calldata, value)
 * must reproduce the quote binding of a payload prepared for this step
 * (current or earlier) exactly, mined after that payload was first prepared
 * (minus clock skew). Only then does a revert count as a failure of the
 * step, and only then does the adapter's outcome check run on the logs.
 *
 * Failures whose code is a rejection prove the references are not this
 * step's transactions: they never fail the step (the service refuses the
 * submission, 422) and are never claimed.
 */
import { bindingHash, evmBindingView, explorerTxUrl, NETWORKS, parseAccountId, type IntentStep, type PreparedStepRecord, type StepAmount, type StepEvidence } from "@elyia/core";
import { decodeEventLog, type Abi, type Hex } from "viem";
import type { EvmLog, EvmPort, TxObservation } from "./ports/evm.js";
import { evidence, type AdapterFailure, type VerificationResult, type VerifyContext } from "./types.js";

/** Landed evidence older than the first prepare minus this skew is refused. */
export const CLOCK_SKEW_SECONDS = 300;
/** References unseen this long are reported stale (never auto-failed: an EVM nonce can still land). */
export const REFERENCE_STALE_MS = 60 * 60 * 1000;

/** Codes that mean "these references are not this step's evidence". */
export const REJECTION_CODES: ReadonlySet<string> = new Set([
  "REFERENCE_WRONG_SENDER",
  "REFERENCE_WRONG_CHAIN",
  "REFERENCE_WRONG_NETWORK",
  "REFERENCE_MISMATCH",
  "REFERENCE_STALE",
  "REFERENCE_ALREADY_USED",
]);

export function isRejection(result: VerificationResult): result is Extract<VerificationResult, { status: "failed" }> {
  return result.status === "failed" && REJECTION_CODES.has(result.failure.code);
}

export function failed(evidenceList: readonly StepEvidence[], code: string, message: string): VerificationResult {
  return { status: "failed", evidence: evidenceList, failure: { code, message } };
}

/** Every payload prepared for the step (current one last). */
export function preparedRecords(step: IntentStep): PreparedStepRecord[] {
  return [...(step.history ?? []), ...(step.prepared ? [step.prepared] : [])];
}

/** Binding of every payload prepared for this step -> unix ms when it was first prepared. */
export function preparedBindings(step: IntentStep): Map<string, number> {
  const bindings = new Map<string, number>();
  for (const record of preparedRecords(step)) {
    const at = Date.parse(record.preparedAt);
    if (!Number.isFinite(at)) continue;
    const known = bindings.get(record.quoteBinding);
    if (known === undefined || at < known) bindings.set(record.quoteBinding, at);
  }
  return bindings;
}

/** Unix ms of the first prepare, or null. */
export function firstPreparedAt(step: IntentStep): number | null {
  const times = [...preparedBindings(step).values()];
  return times.length > 0 ? Math.min(...times) : null;
}

/** Lowest guaranteed output any prepared payload (or the plan) promised, base units. */
export function lowestPreparedFloor(step: IntentStep): bigint | null {
  const values = [step.outputs[0]?.minimum, step.route?.plannedMinimum, ...preparedRecords(step).map((record) => record.floor)]
    .filter((value): value is string => typeof value === "string" && /^\d+$/u.test(value))
    .map((value) => BigInt(value));
  return values.length > 0 ? values.reduce((low, value) => (value < low ? value : low)) : null;
}

export type LandedTx = Extract<TxObservation, { state: "landed" }>;

export interface EvmOutcome {
  /** The outcome is not proven (a required event is missing): the step fails with this code. */
  readonly failure?: AdapterFailure;
  readonly actualOutputs?: readonly StepAmount[];
  readonly evidence?: readonly StepEvidence[];
  readonly settlement?: Extract<VerificationResult, { status: "confirmed" }>["settlement"];
  /** False when the step continues on another network (cross-network or long settlement). */
  readonly settled?: boolean;
}

export type EvmCheck = (receipts: readonly LandedTx[]) => EvmOutcome | Promise<EvmOutcome>;

/** Decoded events `eventName` emitted by `address` (strict ABI; other logs skipped). */
export function eventsOf<const abi extends Abi>(
  logs: readonly EvmLog[],
  filter: { readonly address?: string; readonly abi: abi; readonly eventName: string },
): Array<{ readonly args: Record<string, unknown>; readonly log: EvmLog }> {
  const out: Array<{ readonly args: Record<string, unknown>; readonly log: EvmLog }> = [];
  const address = filter.address?.toLowerCase();
  for (const log of logs) {
    if (address && log.address.toLowerCase() !== address) continue;
    try {
      const decoded = decodeEventLog({ abi: filter.abi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
      if (decoded.eventName === filter.eventName) out.push({ args: decoded.args as unknown as Record<string, unknown>, log });
    } catch {
      // Not this event (or another ABI): skipped.
    }
  }
  return out;
}

export async function verifyEvmReceipts(evm: EvmPort, context: VerifyContext, check?: EvmCheck): Promise<{ readonly result: VerificationResult; readonly receipts: readonly LandedTx[] }> {
  const { step, references, now } = context;
  const account = parseAccountId(step.account);
  const network = NETWORKS[step.network];
  if (!step.prepared || !account || network.vm !== "evm") {
    return { result: failed([], "STEP_INVALID", "The step has no prepared EVM payload."), receipts: [] };
  }
  const landed: LandedTx[] = [];
  for (const reference of references) {
    if (reference.kind !== "evm-tx") return { result: failed([], "REFERENCE_WRONG_NETWORK", "EVM steps take 0x transaction hashes."), receipts: [] };
    const observation = await evm.observeTransaction(step.network, reference.hash);
    if (observation.state !== "landed") {
      return {
        result: {
          status: "pending",
          evidence: [],
          reason: observation.state === "pending" ? "Transaction is pending." : "Transaction is not visible yet.",
          stale: now - context.submittedAt > REFERENCE_STALE_MS,
        },
        receipts: [],
      };
    }
    // Fail closed: without a block time the transaction cannot be ordered against prepare.
    if (observation.blockTimestamp === null) return { result: { status: "pending", evidence: [], reason: "Block time is not readable yet.", stale: false }, receipts: [] };
    landed.push(observation);
  }
  for (const [index, tx] of landed.entries()) {
    if (tx.chainId !== null && tx.chainId !== network.chainId) return { result: failed([], "REFERENCE_WRONG_CHAIN", `Transaction ${index + 1} is not on ${network.name}.`), receipts: landed };
    if (tx.from.toLowerCase() !== account.address.toLowerCase()) return { result: failed([], "REFERENCE_WRONG_SENDER", `Transaction ${index + 1} was not sent by the step account.`), receipts: landed };
  }
  const binding = bindingHash(landed.map((tx) => evmBindingView({ chainId: network.chainId, from: tx.from, to: tx.to ?? "0x0000000000000000000000000000000000000000", data: tx.input, value: tx.value.toString() })));
  const preparedAt = preparedBindings(step).get(binding);
  if (preparedAt === undefined) {
    return { result: failed([], "REFERENCE_MISMATCH", "The submitted transactions do not match a payload prepared for this step (target, calldata or value differ)."), receipts: landed };
  }
  const notBefore = Math.floor(preparedAt / 1000) - CLOCK_SKEW_SECONDS;
  for (const [index, tx] of landed.entries()) {
    if ((tx.blockTimestamp ?? 0) < notBefore) return { result: failed([], "REFERENCE_STALE", `Transaction ${index + 1} was mined before this step's payload was prepared.`), receipts: landed };
  }
  const receiptEvidence = landed.map((tx) =>
    evidence("receipt", step.network, now, `${tx.status === "success" ? "Succeeded" : "Reverted"} in block ${tx.blockNumber}.`, { reference: tx.hash, url: explorerTxUrl(step.network, tx.hash) }),
  );
  const reverted = landed.findIndex((tx) => tx.status !== "success");
  if (reverted !== -1) return { result: failed(receiptEvidence, "TRANSACTION_REVERTED", `Transaction ${reverted + 1} reverted on-chain.`), receipts: landed };
  const outcome = check ? await check(landed) : {};
  const all = [...receiptEvidence, ...(outcome.evidence ?? [])];
  if (outcome.failure) {
    // The binding matched, so these are the step's own transactions: a missing effect is an outcome failure, never a rejection.
    const code = REJECTION_CODES.has(outcome.failure.code) ? "OUTCOME_NOT_PROVEN" : outcome.failure.code;
    return { result: failed(all, code, outcome.failure.message), receipts: landed };
  }
  return {
    result: {
      status: "confirmed",
      evidence: all,
      settled: outcome.settled ?? true,
      ...(outcome.actualOutputs ? { actualOutputs: outcome.actualOutputs } : {}),
      ...(outcome.settlement ? { settlement: outcome.settlement } : {}),
    },
    receipts: landed,
  };
}

/** ERC-20 units `token` moved from `from` (any when null) to `to` across logs. */
export function erc20Credit(logs: readonly EvmLog[], token: string, to: string, from: string | null = null): bigint {
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase() || log.topics[0] !== transferTopic || log.topics.length !== 3) continue;
    const recipient = `0x${(log.topics[2] ?? "").slice(26)}`.toLowerCase();
    const sender = `0x${(log.topics[1] ?? "").slice(26)}`.toLowerCase();
    if (recipient !== to.toLowerCase()) continue;
    if (from !== null && sender !== from.toLowerCase()) continue;
    total += BigInt(log.data === "0x" ? 0 : log.data);
  }
  return total;
}

/**
 * Native HYPE a router unwrapped from its wrapped token: WETH9-style
 * `Withdrawal(src = router)` events, or (canonical Elysium WHYPE emits no
 * Withdrawal) the burn `Transfer(router -> 0x0)`. The larger of the two,
 * never their sum, so a token that emits both is not counted twice.
 */
export function nativeUnwrapped(logs: readonly EvmLog[], wrapped: string, router: string): bigint {
  const withdrawalTopic = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
  let withdrawals = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== wrapped.toLowerCase() || log.topics[0] !== withdrawalTopic || log.topics.length !== 2) continue;
    if (`0x${(log.topics[1] ?? "").slice(26)}`.toLowerCase() !== router.toLowerCase()) continue;
    withdrawals += BigInt(log.data === "0x" ? 0 : log.data);
  }
  const burned = erc20Credit(logs, wrapped, "0x0000000000000000000000000000000000000000", router);
  return withdrawals > burned ? withdrawals : burned;
}
