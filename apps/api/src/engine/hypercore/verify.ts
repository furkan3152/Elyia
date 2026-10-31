/**
 * Verification of HyperCore steps from the info API (solver-planner §3.5-H).
 * Mirrors the EVM verifier's structure: format, attribution (signer and
 * account), binding (the reference must name something this step prepared),
 * time order (not older than the first prepare minus skew), then outcome.
 *
 * - orders (`hc:cloid:<user>:<cloid>`): `orderStatus` by cloid must match the
 *   prepared snapshot of that cloid (coin, side, price, size, reduce-only,
 *   type); fills come from `userFillsByTime` filtered by the order id;
 * - user-signed actions (`hc:nonce:<user>:<nonce>`): a ledger entry with the
 *   signed fields (and the nonce where the ledger carries it), or
 *   `extraAgents` for approveAgent;
 * - other L1 actions (`hc:nonce:<agent>:<nonce>`): the effect read back
 *   (order canceled, leverage set, margin moved, TWAP slices filling).
 * An unknown cloid stays pending until the action's `expiresAfter` passed
 * (plus grace): then it can never land and the step fails, retryably.
 */
import {
  compareDecimal,
  hypercore,
  parseAccountId,
  toBaseUnitsBig,
  truncateDecimal,
  type IntentStep,
  type OrderSnapshot,
  type ParsedReference,
  type PreparedRequestRecord,
  type PreparedStepRecord,
  type StepAmount,
} from "@elyia/core";
import type { FrontendOpenOrder, UserFill } from "../../hyperliquid/types.js";
import type { EngineDeps } from "../deps.js";
import { CLOCK_SKEW_SECONDS, failed, preparedRecords } from "../verify.js";
import { evidence, type VerificationResult, type VerifyContext } from "../types.js";
import { divDecimal, mulDecimal } from "./markets.js";
import { expectationFor, matchLedger } from "./ledger.js";

/** A ledger entry or effect unseen this long after submit: the outcome is unknown (review). */
export const HYPERCORE_STALE_MS = 10 * 60 * 1000;
/** Effects of L1 actions (leverage, cancels) unseen this long: review. */
export const L1_EFFECT_STALE_MS = 3 * 60 * 1000;
/** An unknown cloid this long after the action's expiry never landed. */
export const EXPIRY_GRACE_MS = 60_000;

export interface PreparedMatch {
  readonly record: PreparedStepRecord;
  readonly request: PreparedRequestRecord;
  readonly preparedAt: number;
}

/** The prepared request (current or earlier payload) whose nonce or entry cloid the reference names. */
export function preparedFor(step: IntentStep, reference: ParsedReference): PreparedMatch | null {
  for (const record of [...preparedRecords(step)].reverse()) {
    const request = record.requests[0];
    if (!request || request.vm !== "hypercore") continue;
    const matches =
      reference.kind === "hc-nonce" ? request.nonce === reference.nonce : reference.kind === "hc-cloid" ? request.cloids?.[0]?.toLowerCase() === reference.cloid : false;
    if (matches) return { record, request, preparedAt: Date.parse(record.preparedAt) };
  }
  return null;
}

export function decimalUnits(value: string, decimals: number): bigint {
  const clean = value.replace(/^-/u, "");
  return toBaseUnitsBig(truncateDecimal(clean, decimals) || "0", decimals);
}

function pendingResult(reason: string, stale: boolean): VerificationResult {
  return { status: "pending", evidence: [], reason, stale };
}

function account(step: IntentStep): string {
  return (parseAccountId(step.account)?.address ?? "").toLowerCase();
}

/** Shared attribution: one reference, the right kind, the right signer, something this step prepared. */
function attribute(step: IntentStep, references: readonly ParsedReference[], expected: "hc-cloid" | "hc-nonce", signer: "account" | "agent"): PreparedMatch | VerificationResult {
  if (references.length !== 1) return failed([], "REFERENCE_MISMATCH", "Submit exactly one reference for this HyperCore step.");
  const reference = references[0] as ParsedReference;
  if (reference.kind === "evm-tx") return failed([], "REFERENCE_WRONG_NETWORK", "HyperCore steps take hc:cloid: or hc:nonce: references, not transaction hashes.");
  if (reference.kind !== expected) return failed([], "REFERENCE_MISMATCH", `This step is verified by an ${expected === "hc-cloid" ? "hc:cloid:" : "hc:nonce:"} reference.`);
  const match = preparedFor(step, reference);
  if (!match) return failed([], "REFERENCE_MISMATCH", "The reference does not name a payload prepared for this step.");
  const who = reference.kind === "hc-cloid" ? reference.user : reference.signer;
  const wanted = signer === "account" ? account(step) : (match.request.agent ?? "").toLowerCase();
  if (who !== wanted) return failed([], "REFERENCE_WRONG_SENDER", signer === "account" ? "The reference names another account." : "The reference names another signer than the agent this step was prepared for.");
  return match;
}

function isMatch(value: PreparedMatch | VerificationResult): value is PreparedMatch {
  return "record" in value;
}

/* ------------------------------------------------------------- orders */

function sideOf(order: OrderSnapshot): "B" | "A" {
  return order.side === "buy" ? "B" : "A";
}

/** True when the order HyperCore reports is the prepared snapshot (price, size, side, flags, type). */
export function orderMatches(seen: FrontendOpenOrder, prepared: OrderSnapshot): boolean {
  if (seen.coin !== prepared.market || seen.side !== sideOf(prepared)) return false;
  if (compareDecimal(seen.origSz, prepared.sz) !== 0 || compareDecimal(seen.limitPx, prepared.limitPx) !== 0) return false;
  if ((seen.reduceOnly ?? false) !== prepared.reduceOnly) return false;
  if (prepared.trigger) {
    return seen.isTrigger === true && compareDecimal(seen.triggerPx, prepared.trigger.triggerPx) === 0;
  }
  return seen.isTrigger !== true && (seen.tif === null || seen.tif === prepared.tif || (prepared.tif === "Ioc" && seen.tif === "FrontendMarket"));
}

export interface FillSummary {
  readonly sz: string;
  readonly notional: string;
  readonly vwap: string | null;
  readonly fees: Readonly<Record<string, string>>;
  readonly hashes: readonly string[];
  readonly count: number;
}

export function summarizeFills(fills: readonly UserFill[], oid: number): FillSummary {
  const own = fills.filter((fill) => fill.oid === oid);
  let sz = "0";
  let notional = "0";
  const fees: Record<string, string> = {};
  for (const fill of own) {
    sz = addDecimal(sz, fill.sz);
    notional = addDecimal(notional, mulDecimal(fill.sz, fill.px));
    const token = fill.feeToken || "USDC";
    fees[token] = addDecimal(fees[token] ?? "0", fill.fee.replace(/^-/u, ""));
  }
  return { sz, notional, vwap: compareDecimal(sz, "0") > 0 ? divDecimal(notional, sz, 8) : null, fees, hashes: own.map((fill) => fill.hash), count: own.length };
}

export function addDecimal(a: string, b: string): string {
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const sum = toBaseUnitsBig(a, scale) + toBaseUnitsBig(b, scale);
  if (scale === 0) return sum.toString();
  const digits = sum.toString().padStart(scale + 1, "0");
  const out = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`.replace(/\.?0+$/u, "");
  return out === "" ? "0" : out;
}

function subDecimal(a: string, b: string): string {
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const diff = toBaseUnitsBig(a, scale) - toBaseUnitsBig(b, scale);
  if (diff <= 0n) return "0";
  if (scale === 0) return diff.toString();
  const digits = diff.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`.replace(/\.?0+$/u, "");
}

/**
 * What a fill summary delivered in the step's first output asset: perps the
 * filled size; spot buys the base received net of base-denominated fees;
 * spot sells the quote received net of quote-denominated fees.
 */
export function fillOutputs(step: IntentStep, order: OrderSnapshot, summary: FillSummary): StepAmount[] {
  const output = step.outputs[0];
  if (!output) return [];
  let received: string;
  if (order.marketKind === "perp") received = summary.sz;
  else if (order.side === "buy") received = subDecimal(summary.sz, summary.fees[output.symbol] ?? "0");
  else received = subDecimal(summary.notional, summary.fees[output.symbol] ?? "0");
  const units = decimalUnits(received, output.decimals).toString();
  return [{ ...output, expected: units, minimum: units }];
}

export async function verifyOrder(deps: EngineDeps, context: VerifyContext): Promise<VerificationResult> {
  const { step, now } = context;
  const matched = attribute(step, context.references, "hc-cloid", "account");
  if (!isMatch(matched)) return matched;
  const prepared = matched.request.orders?.[0] ?? step.order;
  if (!prepared) return failed([], "STEP_INVALID", "The order step has no prepared order snapshot.");
  const user = account(step);
  const cloid = matched.request.cloids?.[0] as hypercore.Cloid;
  const status = await deps.core.orderStatus(step.network, user, cloid);
  if (status.status === "unknownOid") {
    const expiry = matched.request.expiresAfter ?? matched.preparedAt + 120_000;
    if (now > expiry + EXPIRY_GRACE_MS) return failed([], "TRANSACTION_EXPIRED", "HyperCore never saw this order and its signature has expired. Prepare the step again.");
    return pendingResult("HyperCore does not know this order yet.", false);
  }
  const seen = status.order.order;
  if (!orderMatches(seen, prepared)) return failed([], "REFERENCE_MISMATCH", "The order HyperCore reports for this cloid is not the prepared one (market, side, price, size or type differ).");
  if (seen.timestamp < matched.preparedAt - CLOCK_SKEW_SECONDS * 1000) return failed([], "REFERENCE_STALE", "This order was placed before the step was prepared.");
  const orderEvidence = evidence("order", step.network, now, `Order ${seen.oid} ${status.order.status} (${seen.coin} ${seen.side === "B" ? "buy" : "sell"} ${seen.origSz} @ ${seen.limitPx}).`, { reference: `oid:${seen.oid}` });
  const childEvidence = await childrenEvidence(deps, step, matched.request, now);
  return orderOutcome(deps, step, prepared, seen.oid, status.order.status, matched.preparedAt, now, [orderEvidence, ...childEvidence]);
}

async function childrenEvidence(deps: EngineDeps, step: IntentStep, request: PreparedRequestRecord, now: number) {
  const cloids = (request.cloids ?? []).slice(1);
  const out = [];
  for (const cloid of cloids) {
    const child = await deps.core.orderStatus(step.network, account(step), cloid).catch(() => null);
    if (child && child.status === "order") {
      out.push(evidence("order", step.network, now, `Protective ${child.order.order.orderType} ${child.order.order.oid}: ${child.order.status}.`, { reference: `oid:${child.order.order.oid}` }));
    }
  }
  return out;
}

/** The outcome of an order from its status and fills (also used by the resting-order poll). */
export async function orderOutcome(
  deps: EngineDeps,
  step: IntentStep,
  prepared: OrderSnapshot,
  oid: number,
  status: string,
  preparedAt: number,
  now: number,
  base: ReturnType<typeof evidence>[],
): Promise<VerificationResult> {
  const fillsNeeded = status !== "open" || prepared.trigger === undefined;
  const fills = fillsNeeded ? await deps.core.userFillsByTime(step.network, account(step), preparedAt - CLOCK_SKEW_SECONDS * 1000) : [];
  const summary = summarizeFills(fills, oid);
  const filled = compareDecimal(summary.sz, "0") > 0;
  const fillEvidence = filled
    ? [evidence("fill", step.network, now, `${summary.count} fill(s): ${summary.sz} @ ${summary.vwap ?? "?"}; fees ${Object.entries(summary.fees).map(([token, fee]) => `${fee} ${token}`).join(", ") || "0"}.`, { reference: summary.hashes[0] })]
    : [];
  const all = [...base, ...fillEvidence];
  const outputs = filled ? fillOutputs(step, prepared, summary) : undefined;
  if (status === "filled") return { status: "confirmed", settled: true, evidence: all, ...(outputs ? { actualOutputs: outputs } : {}) };
  if (status === "open" || status === "triggered") {
    // A standalone TP/SL resting on the book is the step's outcome; an unfilled limit entry keeps settling.
    if (prepared.trigger) return { status: "confirmed", settled: true, evidence: all, settlement: { state: "resting", trackingId: String(oid) } };
    return { status: "confirmed", settled: false, evidence: all, settlement: { kind: "same-network", mechanism: "order-fill", state: filled ? "filling" : "resting", trackingId: String(oid) } };
  }
  // Terminal without a full fill (canceled, rejected, IOC remainder canceled).
  if (filled) {
    return { status: "confirmed", settled: true, evidence: [...all, evidence("note", step.network, now, `Partially filled (${summary.sz} of ${prepared.sz}); the rest was ${status}.`)], ...(outputs ? { actualOutputs: outputs } : {}) };
  }
  return failed(all, "ORDER_REJECTED", `HyperCore ${hypercore.isRejectedOrderStatus(status) ? "rejected" : "canceled"} the order (${status}). Nothing was filled.`);
}

/* ---------------------------------------------------- user-signed actions */

export async function verifyUserSigned(deps: EngineDeps, context: VerifyContext): Promise<VerificationResult> {
  const { step, now } = context;
  const matched = attribute(step, context.references, "hc-nonce", "account");
  if (!isMatch(matched)) return matched;
  const request = matched.request;
  const user = account(step);
  const stale = now - context.submittedAt > HYPERCORE_STALE_MS;
  if (request.actionType === "approveAgent") {
    const agent = String(request.message?.agentAddress ?? "").toLowerCase();
    const agents = await deps.core.extraAgents(step.network, user);
    const found = agents.find((entry) => entry.address.toLowerCase() === agent);
    if (!found) return pendingResult("The agent is not listed by extraAgents yet.", stale);
    return { status: "confirmed", settled: true, evidence: [evidence("ledger", step.network, now, `Agent ${found.name} ${agent} approved until ${new Date(found.validUntil).toISOString()}.`)] };
  }
  const expectation = request.message && request.actionType ? expectationFor(request.actionType, request.message, matched.preparedAt - CLOCK_SKEW_SECONDS * 1000) : null;
  if (!expectation) return failed([], "STEP_INVALID", "This HyperCore action has no ledger expectation.");
  const entries = await deps.core.ledger(step.network, user, expectation.notBefore);
  const entry = matchLedger(entries, expectation);
  if (!entry) return pendingResult("No matching ledger entry yet.", stale);
  return { status: "confirmed", settled: true, evidence: [evidence("ledger", step.network, now, `Ledger ${String((entry.delta as { type?: unknown }).type)} at ${new Date(entry.time).toISOString()}.`, { reference: entry.hash })] };
}

/* ------------------------------------------------------ other L1 actions */

/** Attribution of an agent-signed non-order action (cancel, leverage, margin, TWAP). */
export function attributeL1(step: IntentStep, references: readonly ParsedReference[]): PreparedMatch | VerificationResult {
  return attribute(step, references, "hc-nonce", "agent");
}

export { isMatch as isPreparedMatch, pendingResult };
