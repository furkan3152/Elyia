/**
 * Portfolio workspace (pure): the account bar's allocation and risk line,
 * the Positions / Balances / Activity tables, each position's one-tap Ely
 * action, the tab keys, and the labelled sample answer to "Explain my PnL".
 * Every figure comes from the snapshot, the ropes, the history and Ely's
 * insights (or the labelled sample); nothing is filled in to look good.
 */
import type { Insight } from "@elyia/core/api/agent";
import type { BalanceLine, PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import type { IntentActionSpec } from "@elyia/core/intent";
import type { NetworkKey } from "@elyia/core/networks";

import type { SignSource } from "../../../features/ely/signSource";
import { newElyTurn, type ElyTurn } from "../../../features/ely/turn";
import type { Rope } from "../../../features/trading/topo";
import type { Layer } from "../../../topo/geometry/relief";
import { usdSigned } from "../range/format";
import { layerSplit, LAYER_OF, registerEntries, type RegisterEntry } from "../range/model";
import { pnlSteps, rankedCauses, waterfall } from "../v2/model";

/* ----------------------------------------------------------------- tabs */

export type WorkspaceTab = "map" | "positions" | "balances" | "activity";

export const TABS: readonly { readonly id: WorkspaceTab; readonly label: string; readonly key: string }[] = [
  { id: "map", label: "Map", key: "1" },
  { id: "positions", label: "Positions", key: "2" },
  { id: "balances", label: "Balances", key: "3" },
  { id: "activity", label: "Activity", key: "4" },
];

/** The tab a number key selects (1–4), null otherwise. */
export function tabForKey(key: string): WorkspaceTab | null {
  return TABS.find((tab) => tab.key === key)?.id ?? null;
}

/* ----------------------------------------------------------- allocation */

export const LAYER_TITLE: Readonly<Record<Layer, string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };

export interface AllocationPart {
  readonly layer: Layer;
  readonly title: string;
  readonly usd: number;
  /** Whole percent; the three always add up to 100 (largest remainder), or all 0 for an empty range. */
  readonly pct: number;
}

export function allocation(snapshot: PortfolioSnapshot): AllocationPart[] {
  const split = layerSplit(snapshot);
  const raw = split.map((part) => part.share * 100);
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return split.map((part) => ({ layer: part.layer, title: LAYER_TITLE[part.layer], usd: part.usd, pct: 0 }));
  const floors = raw.map((value) => Math.floor(value));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const entry of order) {
    if (left <= 0) break;
    floors[entry.index]! += 1;
    left -= 1;
  }
  return split.map((part, index) => ({ layer: part.layer, title: LAYER_TITLE[part.layer], usd: part.usd, pct: floors[index]! }));
}

/* ------------------------------------------------------------------ risk */

export type RopeWord = "risk" | "watch" | "ok" | "no liq";

/** The same words as Ask Ely's Watching list: under 10% risk, under 20% watch. */
export function ropeWord(distance: number | null): RopeWord {
  if (distance === null) return "no liq";
  if (distance < 0.1) return "risk";
  if (distance < 0.2) return "watch";
  return "ok";
}

export interface RiskLine {
  readonly tone: "up" | "dn" | "mute";
  readonly text: string;
}

export function riskLine(ropes: readonly Pick<Rope, "distance">[]): RiskLine {
  if (ropes.length === 0) return { tone: "mute", text: "no open ropes" };
  const fraying = ropes.filter((rope) => rope.distance !== null && rope.distance < 0.1).length;
  if (fraying > 0) return { tone: "dn", text: `▼ ${fraying} rope${fraying === 1 ? "" : "s"} under 10%` };
  return { tone: "up", text: `▲ every rope over 10%` };
}

/* ------------------------------------------------------------- positions */

export interface RowAction {
  readonly label: string;
  readonly title: string;
  readonly source: SignSource;
  /** Ely's insight behind it (its id), null for the table's own fallback. */
  readonly insightId: string | null;
}

export interface PositionRowView {
  readonly id: string;
  readonly coin: string;
  readonly market: string;
  readonly side: "long" | "short";
  readonly leverage: number;
  readonly layer: Layer;
  readonly size: number;
  readonly valueUsd: number;
  readonly pnlUsd: number;
  /** Return on equity, fraction. */
  readonly roe: number;
  readonly distance: number | null;
  readonly word: RopeWord;
  readonly hasStop: boolean;
  readonly action: RowAction;
}

const coinOf = (insight: Insight): string | null => (typeof insight.figures.coin === "string" ? insight.figures.coin : null);

function priceText(value: number): string {
  return String(Number(value.toPrecision(5)));
}

/**
 * The one-tap Ely action of a position: Ely's own draft when an insight
 * names the coin (ease the rope, set a stop), else ease a rope under 10%,
 * set a reduce-only stop when none rests, or close. Every one is a draft
 * the wallet signs; nothing is sent from here.
 */
export function rowAction(rope: Pick<Rope, "coin" | "side" | "markPx" | "liquidationPx" | "distance" | "sl">, insights: readonly Insight[], network: NetworkKey): RowAction {
  const named = insights.filter((insight) => coinOf(insight) === rope.coin && insight.actions.length > 0 && !insight.paper);
  const guard = named.find((insight) => insight.kind === "liquidation-guard");
  if (guard) return { label: "Ease", title: guard.title.en, source: { kind: "actions", actions: guard.actions, sentence: guard.title.en }, insightId: guard.id };
  const protect = named.find((insight) => insight.kind === "auto-protect");
  if (protect) return { label: "Protect", title: protect.title.en, source: { kind: "actions", actions: protect.actions, sentence: protect.title.en }, insightId: protect.id };
  if (rope.distance !== null && rope.distance < 0.1) {
    const title = `Ease the ${rope.coin} rope: trim 25%, reduce-only`;
    const actions: IntentActionSpec[] = [{ kind: "order", network, market: rope.coin, params: { reduce: true, portionBps: 2_500 } }];
    return { label: "Ease", title, source: { kind: "actions", actions, sentence: title }, insightId: null };
  }
  if (!rope.sl && rope.markPx > 0) {
    // Inside half the distance to liquidation, never wider than 8% (the API's balanced stop).
    const half = rope.distance === null ? null : (rope.distance * 100) / 2;
    const distancePct = half === null ? 8 : Math.min(8, half);
    const stop = rope.side === "long" ? rope.markPx * (1 - distancePct / 100) : rope.markPx * (1 + distancePct / 100);
    const title = `Anchor ${rope.coin}: a reduce-only stop at ${priceText(stop)}`;
    const actions: IntentActionSpec[] = [{ kind: "order", network, market: rope.coin, stopLoss: priceText(stop), params: { protect: true } }];
    return { label: "Anchor", title, source: { kind: "actions", actions, sentence: title }, insightId: null };
  }
  const title = `Close the ${rope.coin} ${rope.side}, reduce-only`;
  const actions: IntentActionSpec[] = [{ kind: "order", network, market: rope.coin, params: { reduce: true, portionBps: 10_000 } }];
  return { label: "Close", title, source: { kind: "actions", actions, sentence: title }, insightId: null };
}

/** Positions nearest the edge first, then the largest. */
export function positionRows(ropes: readonly Rope[], insights: readonly Insight[], network: NetworkKey): PositionRowView[] {
  return [...ropes]
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.positionValue - a.positionValue)
    .map((rope) => ({
      id: `${rope.dex}|${rope.coin}`,
      coin: rope.coin,
      market: rope.dex ? `${rope.dex}:${rope.coin}` : rope.coin,
      side: rope.side,
      leverage: rope.leverage,
      layer: "floor" as const,
      size: rope.size,
      valueUsd: rope.positionValue,
      pnlUsd: rope.unrealizedPnl,
      roe: rope.roe,
      distance: rope.distance,
      word: ropeWord(rope.distance),
      hasStop: rope.sl !== null,
      action: rowAction(rope, insights, network),
    }));
}

/* -------------------------------------------------------------- balances */

export const ACCOUNT_WORD: Readonly<Record<BalanceLine["account"], string>> = { spot: "spot", perp: "perp margin", staking: "staked", vault: "vault", wallet: "wallet" };

export interface BalanceRowView {
  readonly id: string;
  readonly layer: Layer;
  readonly asset: string;
  readonly account: string;
  readonly amount: number;
  readonly priceUsd: number | null;
  readonly usd: number | null;
  /** Share of net worth, fraction (null when unpriced). */
  readonly share: number | null;
  readonly note: string | null;
}

export interface BalanceGroup {
  readonly layer: Layer;
  readonly title: string;
  readonly usd: number;
  readonly rows: readonly BalanceRowView[];
  /** Lines under the dust line or without a price, hidden unless asked. */
  readonly hidden: number;
}

/** Every line, by layer (Floor, Ridge, Summit), largest first; dust (under `dustUsd`) and unpriced lines folded unless `showDust`. */
export function balanceGroups(snapshot: PortfolioSnapshot, showDust: boolean, dustUsd = 5): BalanceGroup[] {
  const worth = snapshot.totals.netWorthUsd;
  const split = layerSplit(snapshot);
  return split.map((part) => {
    const lines = snapshot.layers.filter((summary) => LAYER_OF[summary.layer] === part.layer).flatMap((summary) => summary.lines);
    const rows: BalanceRowView[] = lines
      .filter((line) => Number(line.amount) !== 0)
      .map((line) => ({
        id: line.id,
        layer: part.layer,
        asset: line.asset,
        account: ACCOUNT_WORD[line.account],
        amount: Number(line.amount),
        priceUsd: line.priceUsd,
        usd: line.usd,
        share: line.usd !== null && worth > 0 ? line.usd / worth : null,
        note: line.note,
      }))
      .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.asset.localeCompare(b.asset));
    const shown = showDust ? rows : rows.filter((row) => row.usd !== null && row.usd >= dustUsd);
    return { layer: part.layer, title: LAYER_TITLE[part.layer], usd: part.usd, rows: shown, hidden: rows.length - shown.length };
  });
}

/* -------------------------------------------------------------- activity */

export type ActivityFilter = "all" | "fill" | "funding" | "ledger";

export const ACTIVITY_FILTERS: readonly { readonly id: ActivityFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "fill", label: "Fills" },
  { id: "funding", label: "Funding" },
  { id: "ledger", label: "Transfers" },
];

export function activityRows(history: PortfolioHistory | null, filter: ActivityFilter, limit = 120): RegisterEntry[] {
  if (!history) return [];
  const timeline = filter === "all" ? history.timeline : history.timeline.filter((event) => event.kind === filter);
  return registerEntries(timeline, limit);
}

/* ---------------------------------------------------------- explain pnl */

/** A message about PnL gets the waterfall artifact under Ely's answer (the same words the API's planner reads). */
export function wantsPnl(text: string): boolean {
  return /(\bpnl\b|p&l|profit|where did my money|kâr|kar zarar)/iu.test(text);
}

export const EXPLAIN_PNL = "Explain my PnL";

/**
 * The labelled sample's answer to "Explain my PnL", as an Ely turn (the
 * sample range is nobody's wallet, so the chat API is not asked about it):
 * three settled readings and the causes in order of size.
 */
export function samplePnlTurn(figures: Readonly<Record<string, string | number | null>>, id: string, now: number): ElyTurn {
  const steps = pnlSteps(figures);
  const causes = rankedCauses(steps);
  const total = waterfall(null, steps, "Net").total;
  const days = typeof figures.days === "number" ? figures.days : 30;
  const words: Readonly<Record<string, (value: number) => string>> = {
    Realized: () => "closed trades",
    Funding: (value) => (value < 0 ? "you paid funding" : "funding paid you"),
    Fees: () => "venue and network fees",
    Unrealized: () => "open positions, marked now",
  };
  const lines = causes.map((cause) => `**${cause.label}, ${usdSigned(cause.value)}.** ${words[cause.label]?.(cause.value) ?? ""}`);
  const text =
    causes.length === 0
      ? "No fills, funding or fees in the window: nothing moved your PnL."
      : `${causes.length === 1 ? "One thing" : `${["Two", "Three", "Four"][causes.length - 2]} things`}, in order of size:\n${lines.join("\n")}\nNet over ${days} days, open positions included: **${usdSigned(total)}** (labelled sample).`;
  const base = newElyTurn(id, now);
  // Unknown reading names show as they are: the chips read "Fills · 30 d", "Funding · 30 d", "Fees".
  const reading = (name: string, offset: number) => ({ id: `${id}_${offset}`, name, input: null, at: now + offset, ok: true, summary: `${name} (labelled sample)`, settledAt: now + offset + 250 });
  return {
    ...base,
    mode: "deterministic",
    readings: [reading(`Fills · ${days} d`, 100), reading(`Funding · ${days} d`, 300), reading("Fees", 500)],
    text,
    textAt: now + 900,
    doneAt: now + 1_000,
    stopReason: "end_turn",
  };
}
