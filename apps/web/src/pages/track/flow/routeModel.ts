/**
 * Route model (pure): turns a plan (the Elyia planner's dry run, or the
 * browser's own offline plan) into what the route card draws: waypoints
 * across FLOOR / RIDGE / SUMMIT, the hut fees, signatures, the Rule Book
 * lines and the bound quote. Every line is read from the plan; nothing is
 * invented to fill the card.
 */
import type { CreateIntentResponse, VenueQuoteView } from "@elyia/core/api/intents";
import type { IntentGraph, IntentStep, StepAmount } from "@elyia/core/intent";
import type { Journey, JourneyStop } from "@elyia/core/journey";
import { NETWORKS, type NetworkKey } from "@elyia/core/networks";

import type { Grade } from "../../../topo/geometry/conditions";
import type { Layer } from "../../../topo/geometry/relief";
import type { RouteStep, RouteStepState } from "../../../topo/RouteCard";

export const LAYER_OF_FAMILY: Readonly<Record<string, Layer>> = { hypercore: "floor", hyperevm: "ridge", elysium: "summit" };

export function layerOf(network: NetworkKey): Layer {
  return LAYER_OF_FAMILY[NETWORKS[network].family] ?? "floor";
}

const ALTITUDE: Readonly<Record<Layer, number>> = { floor: 0, ridge: 1, summit: 2 };

/** "ascend" going up a layer, "descend" going down, "traverse" on one layer. */
export function direction(from: Layer, to: Layer): "ascend" | "descend" | "traverse" {
  const delta = ALTITUDE[to] - ALTITUDE[from];
  return delta > 0 ? "ascend" : delta < 0 ? "descend" : "traverse";
}

export const PROTOCOL_LABEL: Readonly<Record<string, string>> = {
  "elysium-canonical-bridge": "canonical bridge",
  "elysium-mirror-bridge": "mirror bridge",
  "hyperevm-core-link": "Core link",
  "hypercore-transfers": "HyperCore",
  "hypercore-spot": "HyperCore spot",
  "hypercore-staking": "HyperCore staking",
  "hypercore-vaults": "HyperCore vaults",
  kinetiq: "Kinetiq",
  "kalos-v3": "Kalos V3",
  "dex-da-costa": "Dex Da Costa",
  "hyperswap-v3": "HyperSwap V3",
  perpme: "PerpMe V3",
  hexswap: "HexSwap",
  signal: "Signal launch pools",
  "kalos-stkalos": "Kalos stKALOS",
  cheshire: "Cheshire vault",
  "elyra-lending": "Elyra lending",
  "wrapped-hype": "WHYPE wrap",
  "evm-transfer": "Send",
  "elysium-names": "Elysium Names",
  "hypercore-perps": "HyperCore perps",
  "hypercore-twap": "HyperCore TWAP",
};

/** "+7,829% vs reference", "−99% vs reference", "at the reference" (±0.5%). */
export function deviationLabel(bps: number): string {
  const pct = bps / 100;
  if (Math.abs(pct) < 0.5) return "at the reference";
  const shown = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)).toLocaleString("en-US") : Math.abs(pct).toFixed(1);
  return `${pct > 0 ? "▲ +" : "▼ −"}${shown}% vs reference`;
}

/** A pool paying 25% more than the reference is not a market price (testnet pools often pay 50x). */
export function isFakePrice(bps: number | undefined): boolean {
  return bps !== undefined && Math.abs(bps) >= 2_500;
}

export function protocolLabel(id: string): string {
  return PROTOCOL_LABEL[id] ?? id;
}

/** Base units to a short decimal: "1964048129", 6 -> "1,964.05". */
export function formatBase(value: string, decimals: number, maxFraction?: number): string {
  if (!/^\d+$/u.test(value)) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = BigInt(padded.slice(0, padded.length - decimals));
  const raw = decimals > 0 ? padded.slice(-decimals) : "";
  // Large amounts keep 2 decimals; small ones keep enough to read (4 significant).
  const keep = maxFraction ?? (whole >= 1000n ? 2 : whole >= 1n ? 4 : Math.min(decimals, Math.max(4, raw.search(/[1-9]/u) + 4)));
  const fraction = raw.slice(0, keep).replace(/0+$/u, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function amountLabel(amount: Pick<StepAmount, "expected" | "decimals" | "symbol">, field: "expected" | "minimum" = "expected"): string {
  const value = field === "minimum" ? ((amount as StepAmount).minimum ?? amount.expected) : amount.expected;
  return `${formatBase(value, amount.decimals)} ${amount.symbol}`;
}

/** "2 s", "~2 min", "~31 min", "~5 d 14 h". */
export function formatEta(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `~${hours} h ${minutes} min` : `~${hours} h`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3600);
  return hours > 0 ? `~${days} d ${hours} h` : `~${days} d`;
}

export function phaseState(phase: JourneyStop["phase"] | undefined): RouteStepState {
  switch (phase) {
    case "done":
    case "skipped":
      return "settled";
    case "in-flight":
      return "climbing";
    case "your-turn":
      return "next";
    case "failed":
    case "review":
    case "stopped":
      return "failed";
    default:
      return "waiting";
  }
}

/** A short verb for the route card from the step kind and the layers it crosses. */
export function stepVerb(kind: string, from: Layer, to: Layer): string {
  if (kind === "bridge" || kind === "link") return direction(from, to);
  if (kind === "margin") return "traverse";
  return kind;
}

export interface FlowStepView extends RouteStep {
  readonly stepId: string;
  readonly network: NetworkKey;
  readonly title: string;
  /** Who acts: the wallet signs, settlement waits on the chain. */
  readonly signer: "wallet" | "agent" | "none";
  readonly estimatedSeconds: number | null;
}

export interface FlowQuote {
  readonly protocol: string;
  readonly label: string;
  readonly out: string;
  readonly minimum: string;
  readonly winner: boolean;
  readonly excluded?: string;
  /** Step the venue quoted (`s2`). */
  readonly stepId?: string;
  /** Output value vs input value at reference prices, basis points (+ = pays more than the market: a fake pool price). */
  readonly deviationBps?: number;
  /** USD of the expected output at reference prices, when priced. */
  readonly referenceUsd?: string;
}

export type FlowSource = "planner" | "offline";

export interface FlowRoute {
  readonly id: string;
  readonly sentence: string;
  readonly grade: Grade;
  readonly source: FlowSource;
  readonly steps: readonly FlowStepView[];
  readonly fees: string;
  readonly signatures: { readonly done: number; readonly needed: number; readonly note?: string };
  readonly rules: readonly string[];
  readonly binding?: string;
  readonly warnings: readonly string[];
  readonly quotes: readonly FlowQuote[];
  /** What arrives at the end ("1,964.05 USDC"). */
  readonly arrives: string | null;
  /** Guaranteed floor of the last output, when the plan sets one. */
  readonly minimum: string | null;
  readonly notionalUsd: string | null;
  readonly totalSeconds: number | null;
  /** The planner refused or asked to confirm. */
  readonly decision: "allow" | "confirm" | "deny";
  /** What the Rule Book asks the user to confirm before the first prepare. */
  readonly confirmations?: readonly string[];
}

/** Four hex characters for the route id ("7F3A"), stable per seed. */
export function shortRouteId(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return hash.toString(16).toUpperCase().padStart(4, "0").slice(-4);
}

function stepView(step: IntentStep, stop: JourneyStop | undefined, index: number): FlowStepView {
  const layer = layerOf(step.network);
  const destination = step.settlement?.destinationNetwork;
  const toLayer = destination && layerOf(destination) !== layer ? layerOf(destination) : undefined;
  const input = step.inputs[0];
  const output = step.outputs[0];
  const inOut = input && output ? `${amountLabel(input)} → ${amountLabel(output)}` : input ? amountLabel(input) : output ? amountLabel(output) : "—";
  const seconds = step.settlement?.expectedSeconds ?? step.estimatedSeconds ?? null;
  return {
    id: `W${index + 1}`,
    stepId: step.id,
    network: step.network,
    title: step.title,
    layer,
    toLayer,
    action: stepVerb(step.kind, layer, toLayer ?? layer),
    venue: protocolLabel(step.protocol),
    inOut,
    fee: step.feesUsd ? `$${step.feesUsd}` : step.feesUsd === null ? "unpriced" : "—",
    eta: formatEta(seconds),
    state: phaseState(stop?.phase),
    signer: step.mode === "wallet" ? "wallet" : step.mode === "agent" || step.mode === "keeper" ? "agent" : "none",
    estimatedSeconds: seconds,
  };
}

function rulesFrom(response: CreateIntentResponse): string[] {
  const policy = response.policy;
  const lines: string[] = [];
  lines.push(policy.decision === "allow" ? "Rule Book: allowed" : policy.decision === "confirm" ? "Rule Book: asks you to confirm" : "Rule Book: refused");
  if (policy.notionalUsd) lines.push(`$${policy.notionalUsd} at reference price`);
  // Only swaps carry their floor on chain (ERC-4626 and lending calls do not: the planner verifies them after).
  const floor = response.intent.steps.find((step) => step.kind === "swap" && step.outputs.some((output) => output.minimum && output.minimum !== output.expected));
  if (floor) lines.push("minimum out written into the tx");
  else if (response.intent.steps.some((step) => step.kind === "deposit" || step.kind === "withdraw")) lines.push("result checked against the vault preview");
  const owned = new Set(response.intent.accounts.map((account) => account.split(":").at(-1)?.toLowerCase()));
  const others = [...new Set(response.intent.steps.flatMap((step) => (step.recipient && !owned.has(step.recipient.split(":").at(-1)?.toLowerCase()) ? [step.recipient.split(":").at(-1)!] : [])))];
  if (others.length === 0) lines.push("to your own address");
  for (const other of others) lines.push(`pays ${other.slice(0, 6)}…${other.slice(-4)}, not your address`);
  for (const reason of policy.reasons) lines.push(reason.message);
  return lines;
}

/** The planner's dry run as a route card. */
export function routeFromPlanner(response: CreateIntentResponse, sentence: string, grade: Grade): FlowRoute {
  const stops = new Map(response.journey.stops.map((stop) => [stop.stepId, stop]));
  const steps = response.intent.steps.map((step, index) => stepView(step, stops.get(step.id), index));
  const last = response.intent.steps.at(-1)?.outputs[0];
  const fee = response.intent.summary.totalFeesUsd;
  const signers = steps.filter((step) => step.signer !== "none");
  const quotes: FlowQuote[] = response.quotes.map((quote: VenueQuoteView) => ({
    protocol: quote.protocol,
    label: protocolLabel(quote.protocol),
    out: `${formatBase(quote.expected, quote.decimals)} ${quote.symbol}`,
    minimum: `${formatBase(quote.minimum, quote.decimals)} ${quote.symbol}`,
    winner: quote.winner,
    stepId: quote.stepId,
    ...(quote.excluded ? { excluded: quote.note ?? quote.excluded } : {}),
    ...(quote.referenceDeviationBps !== undefined ? { deviationBps: quote.referenceDeviationBps } : {}),
    ...(quote.referenceUsd !== undefined ? { referenceUsd: quote.referenceUsd } : {}),
  }));
  return {
    id: shortRouteId(response.intent.id),
    sentence,
    grade,
    source: "planner",
    steps,
    fees: fee ? `$${fee}` : "unpriced",
    signatures: { done: signers.filter((step) => step.state === "settled").length, needed: signers.length, note: signers.length > 1 ? "one per step" : undefined },
    rules: rulesFrom(response),
    binding: response.policy.ruleBookHash,
    warnings: [...new Set([...response.intent.warnings, ...response.intent.steps.flatMap((step) => step.warnings ?? [])])],
    quotes,
    arrives: last ? amountLabel(last) : null,
    minimum: last?.minimum && last.minimum !== last.expected ? amountLabel(last, "minimum") : null,
    notionalUsd: response.policy.notionalUsd,
    totalSeconds: response.intent.summary.estimatedSeconds ?? null,
    decision: response.policy.decision,
    confirmations: response.policy.reasons.filter((reason) => reason.outcome === "confirm").map((reason) => reason.message),
  };
}

/**
 * A stored intent (GET /v1/intents/:id + its journey) as a route card: the
 * planner's own record, with the states it verified from chain.
 */
export function routeFromIntent(intent: IntentGraph, journey: Journey, grade: Grade): FlowRoute {
  const stops = new Map(journey.stops.map((stop) => [stop.stepId, stop]));
  const steps = intent.steps.map((step, index) => stepView(step, stops.get(step.id), index));
  const last = intent.steps.at(-1);
  const output = last?.actualOutputs?.[0] ?? last?.outputs[0];
  const signers = steps.filter((step) => step.signer !== "none");
  const fee = intent.summary.totalFeesUsd;
  return {
    id: shortRouteId(intent.id),
    sentence: intent.text ?? intent.metadata?.sentence ?? intent.summary.title,
    grade,
    source: "planner",
    steps,
    fees: fee ? `$${fee}` : "unpriced",
    signatures: { done: signers.filter((step) => step.state === "settled").length, needed: signers.length },
    rules: intent.policy ? [intent.policy.decision === "allow" ? "Rule Book: allowed" : "Rule Book: confirmed by you", ...(intent.policy.notionalUsd ? [`$${intent.policy.notionalUsd} at reference price`] : []), "evidence read from chain"] : ["evidence read from chain"],
    binding: intent.policy?.ruleBookHash,
    warnings: [...new Set([...intent.warnings, ...intent.steps.flatMap((step) => [...(step.warnings ?? []), ...(step.failure ? [step.failure.message] : [])])])],
    quotes: [],
    arrives: output ? amountLabel(output) : null,
    minimum: null,
    notionalUsd: intent.policy?.notionalUsd ?? null,
    totalSeconds: intent.summary.estimatedSeconds ?? null,
    decision: "allow",
  };
}
