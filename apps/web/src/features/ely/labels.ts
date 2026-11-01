/**
 * Plain words for what Ely did (pure): tool calls become survey reading
 * chips ("Portfolio", "Simulated route", "What-if HYPE −20%"), and the turn
 * status line says what it is doing. Unknown tools keep their own name.
 */
import type { RouteCard } from "@elyia/core/api/agent";

import type { Reading } from "./turn";
import type { TurnPhase } from "./timeline";

type Rec = Readonly<Record<string, unknown>>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

const BASE: Readonly<Record<string, string>> = {
  get_portfolio: "Portfolio",
  get_markets: "Markets",
  get_market: "Market",
  get_protocols: "Protocols",
  get_venues: "Venues",
  assess_token: "Shield",
  simulate_shock: "What-if",
  get_insights: "Insights",
  plan_intent: "Simulated route",
  propose_intent: "Proposal drafted",
  propose_alert: "Alert draft",
  propose_automation: "Automation draft",
  remember: "Memory",
};

function signedPct(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;
}

/** The chip label for one reading. A planning reading with a card names the auction ("6 venues"). */
export function readingLabel(reading: Pick<Reading, "name" | "input">, card?: RouteCard | null): string {
  const input = isRec(reading.input) ? reading.input : {};
  switch (reading.name) {
    case "get_market":
      return typeof input.coin === "string" ? `${input.coin.toUpperCase().slice(0, 12)} market` : "Market";
    case "simulate_shock":
      return typeof input.underlying === "string" && typeof input.movePct === "number" ? `What-if ${input.underlying.toUpperCase().slice(0, 10)} ${signedPct(input.movePct)}` : "What-if";
    case "get_venues":
    case "get_protocols":
      return typeof input.network === "string" ? `${BASE[reading.name]} · ${networkWord(input.network)}` : BASE[reading.name]!;
    case "plan_intent":
    case "propose_intent":
      if (card && card.venues.length > 1) return `${card.venues.length} venues`;
      return reading.name === "plan_intent" ? "Simulated route" : "Proposal drafted";
    default:
      return BASE[reading.name] ?? reading.name.replace(/_/gu, " ");
  }
}

/** "elysium-testnet" -> "Elysium". */
export function networkWord(network: string): string {
  if (network.startsWith("elysium")) return "Elysium";
  if (network.startsWith("hyperevm")) return "HyperEVM";
  if (network.startsWith("hypercore")) return "HyperCore";
  return network;
}

export function phaseLabel(phase: TurnPhase, info: { readonly readings: number; readonly seconds: number; readonly planning: boolean; readonly mode: "ai" | "deterministic" | null; readonly asking?: boolean }): string {
  switch (phase) {
    case "surveying":
      return "surveying the range";
    case "drafting":
      return info.planning ? "drafting the route" : "thinking";
    case "streaming":
      return info.planning ? "on the trail" : "talking";
    case "ready":
      return "route ready";
    case "error":
      return "stopped";
    case "answered":
      return info.readings > 0 ? `${info.readings} reading${info.readings === 1 ? "" : "s"} · ${info.seconds.toFixed(1)} s` : info.asking ? "one question first" : "answered";
  }
}
