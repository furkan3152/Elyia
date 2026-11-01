/**
 * The route card artifact's view model (pure): legs, the four readouts, the
 * guard chips and the honest labels, from Ely's `RouteCard` (instant, from
 * the chat stream) and, once the planner's fresh dry run is in, from its
 * route (per-step amounts and times, live step states while signing).
 * Nothing is invented: a missing number shows as "—".
 */
import type { RouteCard } from "@elyia/core/api/agent";

import type { RouteStepState } from "../../topo/RouteCard";
import type { FlowRoute } from "../../pages/track/flow/routeModel";

export type CardLayer = "floor" | "ridge" | "summit";

export const LAYER_WORD: Readonly<Record<CardLayer, string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };
export const LAYER_NET: Readonly<Record<CardLayer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };

export function layerOfNetwork(network: string): CardLayer {
  if (network.startsWith("hypercore")) return "floor";
  if (network.startsWith("hyperevm")) return "ridge";
  return "summit";
}

export interface LegView {
  readonly n: number;
  readonly layer: CardLayer;
  readonly title: string;
  readonly detail: string;
  readonly amount: string | null;
  readonly eta: string | null;
  readonly state: RouteStepState;
}

export interface Readout {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

export interface CardView {
  /** Four hex characters, stable per card ("7F3A"). */
  readonly id: string;
  readonly title: string;
  readonly legs: readonly LegView[];
  readonly readouts: readonly [Readout, Readout, Readout, Readout];
  readonly guards: readonly string[];
  readonly warnings: readonly string[];
  /** A testnet pool pays far above the reference price. */
  readonly fakePrice: boolean;
  readonly testnet: boolean;
  readonly decision: string;
  readonly integratorFee: string | null;
  readonly from: CardLayer;
  readonly to: CardLayer;
}

/** "6,288.74", "0.004213", "1.2M". */
export function compactAmount(raw: string | number): string {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return String(raw);
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (abs >= 1e5) return `${(value / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs === 0) return "0";
  return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function usd(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e5) return `$${compactAmount(value)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: value !== 0 && Math.abs(value) < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function etaWord(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  return `~${Math.round(seconds / 3600)} h`;
}

export function cardId(card: Pick<RouteCard, "title" | "steps">): string {
  const seed = `${card.title}|${card.steps.map((step) => `${step.network}:${step.protocol}:${step.title}`).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  return (hash & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

const VENUE: Readonly<Record<string, string>> = {
  "kalos-v3": "Kalos V3",
  "dex-da-costa": "Dex Da Costa",
  "elyia-router": "Elyia Router",
  cheshire: "Cheshire",
  hypercore: "HyperCore",
  kinetiq: "Kinetiq",
  hyperswap: "HyperSwap",
};

export function venueLabel(protocol: string): string {
  return VENUE[protocol] ?? protocol.replace(/[-_]/gu, " ").replace(/\b\w/gu, (char) => char.toUpperCase());
}

/** The default step states before anything is signed: the first is next, the rest wait. */
export function defaultStates(count: number): RouteStepState[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? "next" : "waiting"));
}

export function cardView(card: RouteCard, options: { readonly route?: FlowRoute | null; readonly states?: readonly RouteStepState[] } = {}): CardView {
  const route = options.route ?? null;
  const steps = route && route.steps.length > 0 ? route.steps : null;
  const count = steps ? steps.length : card.steps.length;
  const states = options.states && options.states.length === count ? options.states : defaultStates(count);
  const lastOut = card.outputs.at(-1) ?? null;
  const legs: LegView[] = steps
    ? steps.map((step, index) => ({
        n: index + 1,
        layer: layerOfNetwork(step.network),
        title: step.title,
        detail: `${step.venue}${step.toLayer && step.toLayer !== step.layer ? ` · ${LAYER_NET[step.layer as CardLayer] ?? step.layer} → ${LAYER_NET[step.toLayer as CardLayer] ?? step.toLayer}` : ` · ${LAYER_NET[layerOfNetwork(step.network)]}`}`,
        amount: step.inOut ? (step.inOut.split("→").at(-1)?.trim() ?? null) : null,
        eta: step.eta || null,
        state: states[index]!,
      }))
    : card.steps.map((step, index) => ({
        n: index + 1,
        layer: layerOfNetwork(step.network),
        title: step.title,
        detail: `${venueLabel(step.protocol)} · ${LAYER_NET[layerOfNetwork(step.network)]}`,
        amount: index === card.steps.length - 1 && lastOut ? `${compactAmount(lastOut.expected)} ${lastOut.symbol}` : null,
        eta: index === card.steps.length - 1 ? etaWord(card.estimatedSeconds) : null,
        state: states[index]!,
      }));
  const expected = lastOut ? Number(lastOut.expected) : NaN;
  const minimum = lastOut ? Number(lastOut.minimum) : NaN;
  const slip = Number.isFinite(expected) && Number.isFinite(minimum) && expected > 0 ? ((expected - minimum) / expected) * 100 : null;
  const testnet = card.steps.some((step) => step.network.endsWith("testnet"));
  const fakePrice = card.warnings.some((warning) => /fake price/iu.test(warning));
  const guards = [
    slip !== null ? `min-out ${slip < 0.1 ? slip.toFixed(2) : slip.toFixed(1)}%` : null,
    `Rule Book · ${card.policy.decision}`,
    "fail-closed",
    testnet ? "testnet · reference prices" : "reference prices",
  ].filter((entry): entry is string => entry !== null);
  const fee = card.integratorFee ? `${(card.integratorFee.bps / 100).toFixed(2)}% integrator fee` : null;
  const from = legs[0]?.layer ?? "floor";
  const to = legs.at(-1)?.layer ?? from;
  return {
    id: cardId(card),
    title: card.title,
    legs,
    readouts: [
      { label: "Value", value: usd(card.notionalUsd), sub: card.notionalUsd ? "reference USD" : "unpriced" },
      { label: "You get", value: lastOut ? compactAmount(lastOut.expected) : "—", sub: lastOut ? `${lastOut.symbol} · min ${compactAmount(lastOut.minimum)}` : "no output" },
      { label: "Fees", value: usd(card.feesUsd), sub: fee ?? "network + venue" },
      { label: "Time", value: etaWord(route?.totalSeconds ?? card.estimatedSeconds) ?? "—", sub: `${count} camp${count === 1 ? "" : "s"}` },
    ],
    guards,
    warnings: card.warnings,
    fakePrice,
    testnet,
    decision: card.policy.decision,
    integratorFee: fee,
    from,
    to,
  };
}
