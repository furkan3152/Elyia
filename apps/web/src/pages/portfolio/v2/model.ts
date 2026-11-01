/**
 * Portfolio × Ely (pure): what-if presets, the PnL waterfall maths, the
 * insight cards' view model, altimeter digits, and the hero pills. Every
 * number comes from the API's snapshot and insights (or the labelled
 * sample); nothing is filled in to look good.
 */
import type { Insight, InsightKind } from "@elyia/core/api/agent";

import type { GlyphName } from "../../../features/ely/draw";

/* ------------------------------------------------------------ what-if */

export interface WhatIfPreset {
  readonly label: string;
  /** null: the whole range moves. */
  readonly driver: string | null;
  readonly pct: number;
}

/**
 * Four presets for the what-if slider (equal buttons): the largest
 * exposure −10%, the whole range −30%, HYPE +20% (or the largest exposure),
 * and Reset. `drivers` are the range's markets, largest first.
 */
export function whatIfPresets(drivers: readonly string[]): readonly [WhatIfPreset, WhatIfPreset, WhatIfPreset, WhatIfPreset] {
  const top = drivers[0] ?? null;
  const hype = drivers.find((coin) => coin.toUpperCase() === "HYPE") ?? top;
  return [
    { label: top ? `${top} −10%` : "All −10%", driver: top, pct: -10 },
    { label: "All −30%", driver: null, pct: -30 },
    { label: hype ? `${hype} +20%` : "All +20%", driver: hype, pct: 20 },
    { label: "Reset", driver: top, pct: 0 },
  ];
}

export function signedPct(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

/* ----------------------------------------------------------- waterfall */

export interface WaterfallInput {
  readonly label: string;
  readonly value: number;
}

export interface WaterfallBar {
  readonly label: string;
  /** Signed change (the total's value for the total bar). */
  readonly value: number;
  readonly from: number;
  readonly to: number;
  readonly kind: "start" | "up" | "down" | "total";
}

export interface Waterfall {
  readonly bars: readonly WaterfallBar[];
  /** Axis bounds (the caption states where the axis starts). */
  readonly min: number;
  readonly max: number;
  readonly total: number;
}

/**
 * A waterfall from `start` through each signed step to the total: each bar
 * runs from the running sum before it to the one after, so the bars
 * reconcile by construction (start + steps = total). The axis is padded by
 * 8% of the span and never cuts a bar.
 */
export function waterfall(start: WaterfallInput | null, steps: readonly WaterfallInput[], totalLabel: string): Waterfall {
  const bars: WaterfallBar[] = [];
  let running = start?.value ?? 0;
  if (start) bars.push({ label: start.label, value: start.value, from: 0, to: start.value, kind: "start" });
  for (const step of steps) {
    const from = running;
    running += step.value;
    bars.push({ label: step.label, value: step.value, from, to: running, kind: step.value >= 0 ? "up" : "down" });
  }
  bars.push({ label: totalLabel, value: running, from: 0, to: running, kind: "total" });
  // With a start bar the axis may start above zero (the caption says where); without one it always includes zero.
  const ends = bars.flatMap((bar) => (start && (bar.kind === "start" || bar.kind === "total") ? [bar.to] : [bar.from, bar.to]));
  const lo = Math.min(...ends, ...(start ? [] : [0]));
  const hi = Math.max(...ends, ...(start ? [] : [0]));
  const pad = Math.max(1e-9, hi - lo) * 0.08;
  return { bars, min: start && lo > 0 ? Math.max(0, lo - pad) : lo < 0 ? lo - pad : lo, max: hi + pad, total: running };
}

/** Rows of the 30-day explain-PnL insight as waterfall steps (fees are a cost: negative). */
export function pnlSteps(figures: Readonly<Record<string, string | number | null>>): WaterfallInput[] {
  const num = (key: string) => (typeof figures[key] === "number" ? (figures[key] as number) : 0);
  return [
    { label: "Realized", value: num("realizedPnlUsd") },
    { label: "Funding", value: num("fundingUsd") },
    { label: "Fees", value: -Math.abs(num("feesUsd")) },
    { label: "Unrealized", value: num("unrealizedPnlUsd") },
  ];
}

/** The causes, largest first (what Ely says, in order of size). */
export function rankedCauses(steps: readonly WaterfallInput[]): WaterfallInput[] {
  return [...steps].filter((step) => step.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/* ------------------------------------------------------------- insights */

export interface InsightView {
  readonly id: string;
  readonly kind: InsightKind;
  readonly glyph: GlyphName;
  readonly title: string;
  readonly body: string;
  readonly severity: Insight["severity"];
  readonly severityWord: string;
  readonly layer: string | null;
  /** The one-tap button (null: information only, or paper). */
  readonly action: string | null;
  readonly paper: boolean;
  readonly figures: readonly { readonly key: string; readonly value: string }[];
}

const GLYPH: Readonly<Record<InsightKind, GlyphName>> = {
  "liquidation-guard": "anchor",
  "auto-protect": "shield",
  rebalance: "rebalance",
  "funding-harvest": "bolt",
  "idle-cash": "coin",
  "what-if": "eye",
  "gas-top-up": "gas",
  "dust-sweep": "broom",
  "explain-pnl": "chat",
};

const ACTION: Readonly<Record<InsightKind, string>> = {
  "liquidation-guard": "Ease the rope",
  "auto-protect": "Set anchors",
  rebalance: "Rebalance",
  "funding-harvest": "Harvest",
  "idle-cash": "Sweep to vault",
  "what-if": "Hedge",
  "gas-top-up": "Top up gas",
  "dust-sweep": "Sweep dust",
  "explain-pnl": "Explain",
};

function layerOf(insight: Insight): string | null {
  const networks = new Set(insight.actions.map((action) => action.network));
  if (networks.size === 0) return null;
  if (networks.size > 1) return `${networks.size} layers`;
  const network = [...networks][0]!;
  return network.startsWith("hypercore") ? "HyperCore" : network.startsWith("hyperevm") ? "HyperEVM" : network.startsWith("elysium") ? "Elysium" : network;
}

function figureText(value: string | number | null): string {
  if (value === null) return "—";
  if (typeof value === "number") return Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Math.round(value * 10_000) / 10_000);
  return value;
}

const SEVERITY_ORDER: Readonly<Record<Insight["severity"], number>> = { act: 0, watch: 1, info: 2 };

/** Cards, the ones to act on first; what-if and explain-PnL have their own sections. */
export function insightViews(insights: readonly Insight[], locale: "en" | "tr" = "en"): InsightView[] {
  return insights
    .filter((insight) => insight.kind !== "what-if" && insight.kind !== "explain-pnl")
    .map((insight) => ({
      id: insight.id,
      kind: insight.kind,
      glyph: GLYPH[insight.kind],
      title: insight.title[locale],
      body: insight.explanation[locale],
      severity: insight.severity,
      severityWord: insight.severity === "act" ? "Risk · act" : insight.severity === "watch" ? "Watch" : "Info",
      layer: layerOf(insight),
      action: insight.paper || insight.actions.length === 0 ? null : ACTION[insight.kind],
      paper: insight.paper,
      figures: Object.entries(insight.figures).map(([key, value]) => ({ key: key.replace(/([A-Z])/gu, " $1").toLowerCase(), value: figureText(value) })),
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/* -------------------------------------------------------------- digits */

/** Altimeter digit blocks for a USD value: the characters, and which changed since `previous` (only those roll). */
export function altimeterDigits(value: number, previous: number | null): { readonly chars: readonly string[]; readonly changed: readonly boolean[] } {
  const text = Math.round(value).toLocaleString("en-US");
  const before = previous === null ? null : Math.round(previous).toLocaleString("en-US").padStart(text.length, " ");
  const chars = [...text];
  return { chars, changed: chars.map((char, index) => before !== null && char !== "," && before[before.length - text.length + index] !== char) };
}
