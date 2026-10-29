/**
 * The journey: "where is my money right now?" for one intent, as stops the
 * web app, Telegram and the track page render the same way. Lean by design:
 * it reads the graph only (no I/O), so every surface tells the same story.
 */
import { explorerTxUrl, NETWORKS } from "./networks.js";
import { deriveIntentStatus, isStepDone, topologicalOrder } from "./lifecycle.js";
import { parseReference } from "./references.js";
import type { IntentGraph, IntentStatus, IntentStep, StepAmount, StepStatus } from "./intent.js";

export const JOURNEY_SPEC = "elyia.journey/v1" as const;

/** What the user should understand about a stop at a glance. */
export type JourneyPhase = "waiting" | "your-turn" | "in-flight" | "done" | "skipped" | "stopped" | "failed" | "review";

export interface JourneyStop {
  readonly stepId: string;
  readonly title: string;
  readonly network: string;
  readonly networkName: string;
  readonly status: StepStatus;
  readonly phase: JourneyPhase;
  /** Where the value sits after this stop (actual outputs once known, else planned). */
  readonly holds: readonly StepAmount[];
  /** Signer the user must act with on `your-turn` stops. */
  readonly signer?: "wallet" | "agent" | "keeper";
  /** ISO time the stop is expected to complete, when in flight. */
  readonly eta?: string;
  /** Orbit withdrawals: when the claim opens. */
  readonly claimableAt?: string;
  readonly explorerUrls: readonly string[];
  readonly failure?: { readonly code: string; readonly message: string };
}

export interface Journey {
  readonly spec: typeof JOURNEY_SPEC;
  readonly intentId: string;
  readonly status: IntentStatus;
  readonly stops: readonly JourneyStop[];
  /** First stop that is not done (null when the journey is over). */
  readonly current: string | null;
  readonly next: "sign" | "wait" | "review" | "none";
  readonly done: number;
  readonly total: number;
  /** Latest ETA across in-flight stops. */
  readonly eta?: string;
}

function phaseOf(step: IntentStep): JourneyPhase {
  switch (step.status) {
    case "blocked":
      return "waiting";
    case "ready":
    case "awaiting-signature":
      return step.mode === "read" || step.mode === "settlement" ? "in-flight" : "your-turn";
    case "preparing":
    case "submitted":
    case "settling":
      return "in-flight";
    case "settled":
      return "done";
    case "skipped":
      return "skipped";
    case "stopped":
      return "stopped";
    case "failed":
      return step.failure?.review === true ? "review" : "failed";
  }
}

function explorerUrls(step: IntentStep): string[] {
  const urls: string[] = [];
  for (const reference of step.references ?? []) {
    const parsed = parseReference(reference);
    if (parsed?.kind === "evm-tx") {
      const url = explorerTxUrl(step.network, parsed.hash);
      if (url) urls.push(url);
    }
  }
  for (const evidence of step.evidence) if (evidence.url && !urls.includes(evidence.url)) urls.push(evidence.url);
  return urls;
}

/** Builds the journey from a graph. `now` anchors ETAs of in-flight stops without a recorded start. */
export function buildJourney(graph: IntentGraph, now: number = Date.now()): Journey {
  const ordered = topologicalOrder(graph.steps);
  const stops: JourneyStop[] = ordered.map((step) => {
    const phase = phaseOf(step);
    const lastEvidence = step.evidence.at(-1)?.observedAt;
    const started = lastEvidence !== undefined ? Date.parse(lastEvidence) : now;
    const seconds = step.settlement?.expectedSeconds ?? step.estimatedSeconds;
    const eta = phase === "in-flight" && seconds !== undefined ? new Date(started + seconds * 1000).toISOString() : undefined;
    const signer = phase === "your-turn" && (step.mode === "wallet" || step.mode === "agent" || step.mode === "keeper") ? step.mode : undefined;
    return {
      stepId: step.id,
      title: step.title,
      network: step.network,
      networkName: NETWORKS[step.network].name,
      status: step.status,
      phase,
      holds: step.actualOutputs ?? step.outputs,
      ...(signer ? { signer } : {}),
      ...(eta ? { eta } : {}),
      ...(step.settlement?.claimableAt ? { claimableAt: step.settlement.claimableAt } : {}),
      explorerUrls: explorerUrls(step),
      ...(step.failure ? { failure: { code: step.failure.code, message: step.failure.message } } : {}),
    };
  });
  const current = ordered.find((step) => !isStepDone(step) && step.status !== "stopped")?.id ?? null;
  const phases = stops.map((stop) => stop.phase);
  const next = phases.includes("review") ? "review" : phases.includes("your-turn") ? "sign" : phases.some((phase) => phase === "in-flight" || phase === "waiting") ? "wait" : "none";
  const etas = stops.map((stop) => stop.eta).filter((eta): eta is string => eta !== undefined).sort();
  const latest = etas.at(-1);
  return {
    spec: JOURNEY_SPEC,
    intentId: graph.id,
    status: deriveIntentStatus(graph.steps, graph.expiresAt, now),
    stops,
    current,
    next,
    done: ordered.filter(isStepDone).length,
    total: ordered.length,
    ...(latest ? { eta: latest } : {}),
  };
}
