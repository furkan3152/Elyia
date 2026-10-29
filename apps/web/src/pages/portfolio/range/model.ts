/**
 * The range (pure): what the Deck and the Portfolio draw, computed from one
 * balance sheet (`PortfolioSnapshot`, from the API, the browser or the
 * labelled sample) and its history. Every figure on those pages comes from a
 * function here, so it is tested once and every surface agrees.
 *
 * Unknown stays null, never zero. Testnet USD values are HyperCore mainnet
 * reference prices (the snapshot says so in `pricing`).
 */
import type { BalanceLine, ExposureRow, FillEvent, LedgerEvent, PerpPositionView, PnlDay, PortfolioHistory, PortfolioLayer, PortfolioSnapshot, TimelineEvent } from "@elyia/core/api/portfolio";

import type { PositionRow } from "../../../features/trading/accountModel";
import type { Rope, ShockedRope } from "../../../features/trading/topo";
import type { ProfileCamp, ProfilePoint } from "../../../topo/geometry/profile";
import type { Layer, ReliefHolding } from "../../../topo/geometry/relief";
import { amount, dayLabel, logTime, pct, usdFull, usdShort } from "./format";

/* ---------------------------------------------------------------- layers */

export const LAYERS: readonly Layer[] = ["floor", "ridge", "summit"];

export const LAYER_OF: Readonly<Record<PortfolioLayer, Layer>> = { hypercore: "floor", hyperevm: "ridge", elysium: "summit" };
export const NETWORK_OF: Readonly<Record<Layer, PortfolioLayer>> = { floor: "hypercore", ridge: "hyperevm", summit: "elysium" };
export const LAYER_NAME: Readonly<Record<Layer, string>> = { floor: "FLOOR", ridge: "RIDGE", summit: "SUMMIT" };
export const NETWORK_NAME: Readonly<Record<Layer, string>> = { floor: "HyperCore", ridge: "HyperEVM", summit: "Elysium" };

export interface LayerShare {
  readonly layer: Layer;
  readonly usd: number;
  /** Share of net worth, 0..1 (0 when the net worth is 0). */
  readonly share: number;
  readonly status: "ok" | "partial" | "unavailable" | "error";
}

export function layerSplit(snapshot: PortfolioSnapshot): LayerShare[] {
  const total = Math.max(0, snapshot.totals.netWorthUsd);
  return LAYERS.map((layer) => {
    const network = NETWORK_OF[layer];
    const usd = Math.max(0, snapshot.totals.byLayer[network] ?? 0);
    const status = snapshot.layers.find((summary) => summary.layer === network)?.status ?? "unavailable";
    return { layer, usd, share: total > 0 ? usd / total : 0, status };
  });
}

/* ---------------------------------------------------------------- relief */

/** The largest hill is drawn at this many map units: whales and small accounts read the same. */
export const MAP_UNITS = 16_000;

export interface ReliefPlan {
  readonly holdings: readonly ReliefHolding[];
  /** Map units per USD (map value = usd * scale). */
  readonly scale: number;
  /** Holdings left off the map (below the dust line or past the cap). */
  readonly hidden: { readonly count: number; readonly usd: number };
  /** id -> what the hill stands for (detail panel). */
  readonly sources: ReadonlyMap<string, ReliefSource>;
  /** id -> the exact USD value (map heights are rounded; labels are not). */
  readonly exactUsd: ReadonlyMap<string, number>;
}

export type ReliefSource =
  | { readonly kind: "line"; readonly line: BalanceLine }
  | { readonly kind: "position"; readonly position: PerpPositionView };

function lineSymbol(line: BalanceLine): string {
  if (line.account === "perp") return line.note?.startsWith("Perps:") || !line.note ? `${line.asset} margin` : `${line.asset} margin · ${line.note.split(" ")[0]}`;
  if (line.account === "staking") return `Staked ${line.asset}`;
  if (line.account === "vault") return line.asset.length > 18 ? `${line.asset.slice(0, 16)}…` : line.asset;
  return line.asset;
}

/**
 * Holdings for the Relief: every perp position (shorts as basins, leverage as
 * cliffs) and every priced line above the dust line, largest first, capped so
 * the sheet stays legible. Values are scaled to map units; `scale` turns them
 * back into dollars for labels.
 */
export function reliefPlan(snapshot: PortfolioSnapshot, options: { readonly cap?: number; readonly dustUsd?: number; readonly ropes?: readonly Pick<Rope, "coin" | "distance">[] } = {}): ReliefPlan {
  const cap = options.cap ?? 14;
  const dust = options.dustUsd ?? dustThreshold(snapshot.totals.netWorthUsd);
  const sources = new Map<string, ReliefSource>();
  const candidates: { holding: Omit<ReliefHolding, "usd">; usd: number }[] = [];
  const ropeOf = (coin: string) => options.ropes?.find((rope) => rope.coin === coin)?.distance ?? null;
  for (const position of snapshot.positions) {
    const usd = Math.abs(position.positionValueUsd ?? position.positionValue);
    if (!(usd > 0)) continue;
    const distance = ropeOf(position.coin) ?? (position.liquidationDistancePct === null ? null : position.liquidationDistancePct / 100);
    const id = `pos:${position.id}`;
    sources.set(id, { kind: "position", position });
    candidates.push({
      holding: { id, symbol: position.dex ? `${position.dex}:${position.coin}` : position.coin, layer: "floor", side: position.side, leverage: position.leverage.value, note: distance === null ? undefined : `rope ${pct(distance, 0)}` },
      usd,
    });
  }
  for (const summary of snapshot.layers) {
    for (const line of summary.lines) {
      if (line.usd === null || !(line.usd > 0)) continue;
      const id = `line:${line.id}`;
      sources.set(id, { kind: "line", line });
      candidates.push({ holding: { id, symbol: lineSymbol(line), layer: LAYER_OF[line.layer], side: "spot" }, usd: line.usd });
    }
  }
  candidates.sort((a, b) => b.usd - a.usd || a.holding.id.localeCompare(b.holding.id));
  const shown = candidates.filter((candidate) => candidate.usd >= dust).slice(0, cap);
  const hiddenItems = candidates.filter((candidate) => !shown.includes(candidate));
  const max = shown[0]?.usd ?? 0;
  const scale = max > 0 ? MAP_UNITS / max : 1;
  return {
    // Two significant figures of map height: a live tick does not re-survey the whole sheet.
    holdings: shown.map((candidate) => ({ ...candidate.holding, usd: Number((candidate.usd * scale).toPrecision(2)) })),
    scale,
    hidden: { count: hiddenItems.length, usd: hiddenItems.reduce((sum, item) => sum + item.usd, 0) },
    sources,
    exactUsd: new Map(shown.map((candidate) => [candidate.holding.id, candidate.usd])),
  };
}

/** Dust: under $5, or under 0.01% of a large net worth (never above $250). */
export function dustThreshold(netWorth: number): number {
  return Math.min(250, Math.max(5, netWorth * 0.0001));
}

/* ------------------------------------------------------------- positions */

/** The snapshot's positions as the trading rows the rope math reads (no live feed yet). */
export function positionRowsFrom(positions: readonly PerpPositionView[]): PositionRow[] {
  return positions.map((position) => {
    const szi = Number(position.szi);
    const liq = position.liquidationPx === null ? null : Number(position.liquidationPx);
    return {
      coin: position.coin,
      dex: position.dex,
      szi,
      sziText: position.szi,
      isLong: szi > 0,
      entryPx: Number(position.entryPx),
      positionValue: position.positionValue,
      unrealizedPnl: position.unrealizedPnl,
      roe: position.roePct / 100,
      liquidationPx: liq !== null && liq > 0 ? liq : null,
      marginUsed: position.marginUsed,
      leverage: position.leverage.value,
      leverageType: position.leverage.type,
      maxLeverage: position.maxLeverage,
      fundingSinceOpen: position.fundingSinceOpen,
      markPx: position.markPx,
      liquidationDistance: position.liquidationDistancePct === null ? null : position.liquidationDistancePct / 100,
    };
  });
}

/** Nearest to the crevasse first; ropes without a liquidation price last. */
export function sortRopes<T extends Pick<Rope, "distance" | "positionValue">>(ropes: readonly T[]): T[] {
  return [...ropes].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.positionValue - a.positionValue);
}

/* -------------------------------------------------------------- exposure */

export interface ExposureFold {
  readonly rows: readonly (ExposureRow & { readonly perpUsd: number; readonly spotUsd: number })[];
  readonly cashUsd: number;
  /** Sum of signed non-cash exposure (USD). */
  readonly netUsd: number;
  /** Sum of absolute non-cash exposure / net worth. */
  readonly gross: number | null;
  readonly longUsd: number;
  readonly shortUsd: number;
}

/** Real exposure folded across the three layers: perps, spot, staking and LSTs on one line per underlying. */
export function exposureFold(snapshot: PortfolioSnapshot): ExposureFold {
  let cashUsd = 0;
  let netUsd = 0;
  let longUsd = 0;
  let shortUsd = 0;
  const rows: ExposureFold["rows"][number][] = [];
  for (const row of snapshot.exposure) {
    if (row.isCash) {
      cashUsd += row.netUsd ?? 0;
      continue;
    }
    const px = row.priceUsd ?? 0;
    const perpUsd = row.perp * px;
    const spotUsd = (row.spot + row.lst) * px;
    const value = row.netUsd ?? (row.net * px);
    netUsd += value;
    if (value >= 0) longUsd += value;
    else shortUsd += -value;
    rows.push({ ...row, perpUsd, spotUsd });
  }
  rows.sort((a, b) => Math.abs(b.netUsd ?? 0) - Math.abs(a.netUsd ?? 0));
  const worth = snapshot.totals.netWorthUsd;
  return { rows, cashUsd, netUsd, gross: worth > 0 ? (longUsd + shortUsd) / worth : null, longUsd, shortUsd };
}

/* ---------------------------------------------------------------- shocks */

export interface ShockOutcome {
  readonly netWorth: number;
  readonly change: number;
  readonly ropesChange: number;
  readonly spotChange: number;
  readonly snapped: readonly string[];
  readonly fraying: readonly string[];
}

/** Coins the shock moves: one driver (`{ HYPE: -0.2 }`) or the whole range (a number). */
export function shockMap(driver: string | null, shock: number): number | Readonly<Record<string, number>> {
  return driver === null ? shock : { [driver]: shock };
}

/**
 * What the range is worth after the shock: rope PnL from the shocked ropes,
 * plus the spot, staked and LST holdings of every moved underlying (perp
 * exposure is inside the ropes, so it is not counted twice).
 */
export function shockOutcome(snapshot: PortfolioSnapshot, shocked: readonly ShockedRope[], driver: string | null, shock: number): ShockOutcome {
  const ropesChange = shocked.reduce((sum, rope) => sum + rope.pnlChange, 0);
  let spotChange = 0;
  for (const row of snapshot.exposure) {
    if (row.isCash || row.priceUsd === null) continue;
    if (driver !== null && row.underlying !== driver) continue;
    spotChange += (row.spot + row.lst) * row.priceUsd * shock;
  }
  const change = ropesChange + spotChange;
  return {
    netWorth: snapshot.totals.netWorthUsd + change,
    change,
    ropesChange,
    spotChange,
    snapped: shocked.filter((rope) => rope.snaps).map((rope) => rope.coin),
    fraying: shocked.filter((rope) => !rope.snaps && rope.distance !== null && rope.distance < 0.1).map((rope) => rope.coin),
  };
}

export interface HedgeSuggestion {
  /** Plain words: what the Guide suggests and why. */
  readonly text: string;
  /** The sentence the planner receives. */
  readonly sentence: string;
}

/**
 * The Guide's hedge for a shock: a rope that snaps or frays is reduced first;
 * otherwise a large spot exposure to the driver is half-covered with a 1x
 * short on the Floor. Null when nothing needs doing.
 */
export function hedgeSuggestion(snapshot: PortfolioSnapshot, shocked: readonly ShockedRope[], ropes: readonly Pick<Rope, "coin" | "side" | "distance">[], driver: string | null, shock: number): HedgeSuggestion | null {
  if (shock === 0) return null;
  // Only ropes the shock pulls toward the crevasse count: one already fraying but not moved is the bulletin's job.
  const worsened = (rope: ShockedRope) => {
    const before = ropes.find((entry) => entry.coin === rope.coin)?.distance ?? null;
    return before !== null && rope.distance !== null && rope.distance < before - 1e-9;
  };
  const worst = [...shocked].filter((rope) => rope.snaps || (rope.distance !== null && rope.distance < 0.1 && worsened(rope))).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];
  if (worst) {
    const side = ropes.find((rope) => rope.coin === worst.coin)?.side ?? "long";
    return {
      text: `${worst.coin} ${side} ${worst.snaps ? "snaps" : "frays"} at this move. Halve it, or add margin, before the slope gives.`,
      sentence: `reduce ${worst.coin} by 50%`,
    };
  }
  const exposed = snapshot.exposure
    .filter((row) => !row.isCash && row.priceUsd !== null && (driver === null || row.underlying === driver))
    .sort((a, b) => Math.abs(b.netUsd ?? 0) - Math.abs(a.netUsd ?? 0))[0];
  if (!exposed || exposed.priceUsd === null) return null;
  const loss = (exposed.spot + exposed.lst) * exposed.priceUsd * shock;
  const worth = snapshot.totals.netWorthUsd;
  if (!(worth > 0) || Math.abs(loss) / worth < 0.02 || loss > 0) return null;
  const units = Math.abs(exposed.spot + exposed.lst) / 2;
  const rounded = units >= 100 ? Math.round(units / 10) * 10 : units >= 1 ? Math.round(units) : Number(units.toPrecision(2));
  return {
    text: `Your ${exposed.underlying} on every layer would lose ${usdShort(Math.abs(loss))}. Short ${amount(rounded)} ${exposed.underlying} 1× on the Floor to cover half of it.`,
    sentence: `short ${rounded} ${exposed.underlying} 1x`,
  };
}

/* ------------------------------------------------------------ one-tap jobs */

export interface DustLine {
  readonly id: string;
  readonly asset: string;
  readonly layer: Layer;
  readonly usd: number;
  readonly amount: string;
}

/** Small priced balances (not cash, not margin) that a sweep turns into USDC. */
export function dustLines(snapshot: PortfolioSnapshot, threshold = 5): DustLine[] {
  const out: DustLine[] = [];
  for (const summary of snapshot.layers) {
    for (const line of summary.lines) {
      if (line.account === "perp" || line.account === "staking" || line.account === "vault") continue;
      if (line.underlying === "USD") continue;
      // Native HYPE on an EVM layer is gas, never dust.
      if (line.account === "wallet" && line.asset === "HYPE") continue;
      if (line.usd === null || !(line.usd > 0) || line.usd >= threshold) continue;
      out.push({ id: line.id, asset: line.asset, layer: LAYER_OF[line.layer], usd: line.usd, amount: line.amount });
    }
  }
  return out.sort((a, b) => b.usd - a.usd);
}

export interface GasCamp {
  readonly layer: Layer;
  /** HYPE for gas; null when the layer needs none (HyperCore) or it could not be read. */
  readonly hype: number | null;
  readonly needsGas: boolean;
  readonly state: "ok" | "low" | "empty" | "none-needed" | "unknown";
  /** Top-up sentence when low. */
  readonly sentence: string | null;
}

export const GAS_LOW_HYPE = 0.05;

/** HYPE for gas at each camp: HyperCore needs none, HyperEVM and Elysium pay in HYPE. */
export function gasCamps(snapshot: PortfolioSnapshot): GasCamp[] {
  return LAYERS.map((layer) => {
    if (layer === "floor") return { layer, hype: null, needsGas: false, state: "none-needed", sentence: null };
    const summary = snapshot.layers.find((entry) => entry.layer === NETWORK_OF[layer]);
    if (!summary || summary.status === "unavailable" || summary.status === "error") return { layer, hype: null, needsGas: true, state: "unknown", sentence: null };
    const hype = summary.lines.filter((line) => line.account === "wallet" && line.asset === "HYPE").reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const state = hype <= 0 ? "empty" : hype < GAS_LOW_HYPE ? "low" : "ok";
    const sentence = state === "ok" ? null : layer === "summit" ? "bridge 0.3 HYPE to Elysium" : "move 0.3 HYPE to HyperEVM";
    return { layer, hype, needsGas: true, state, sentence };
  });
}

export interface DescentItem {
  readonly id: string;
  readonly layer: Layer;
  readonly what: string;
  readonly when: string | null;
  readonly state: "on-the-way" | "claimable" | "locked" | "landed";
}

/**
 * The descent radar: what is on its way down or waiting to be claimed:
 * HyperCore staking withdrawals (7-day queue), locked vault balances and
 * withdrawals of the last week from the ledger.
 */
export function descentRadar(snapshot: PortfolioSnapshot, history: PortfolioHistory | null, now: number): DescentItem[] {
  const items: DescentItem[] = [];
  for (const summary of snapshot.layers) {
    for (const line of summary.lines) {
      if (line.account === "staking") {
        const match = /pending withdrawal ([\d.]+) \((\d+)\)/u.exec(line.note ?? "");
        const pending = match ? Number(match[1]) : 0;
        if (pending > 0) items.push({ id: `${line.id}:pending`, layer: LAYER_OF[line.layer], what: `${amount(pending)} ${line.asset} unstaking (${match?.[2] ?? 1} in queue)`, when: "7-day queue", state: "on-the-way" });
      } else if (line.account === "vault" && line.locked !== null && Number(line.locked) > 0) {
        items.push({ id: `${line.id}:locked`, layer: LAYER_OF[line.layer], what: `${line.asset} · ${usdShort(Number(line.locked))} locked`, when: "vault lock-up", state: "locked" });
      }
    }
  }
  for (const event of history?.timeline ?? []) {
    if (event.kind !== "ledger" || now - event.time > 7 * 86_400_000) continue;
    if (!/withdraw/iu.test(event.type)) continue;
    items.push({ id: event.id, layer: "floor", what: event.summary || `${event.type} ${event.amount ?? ""} ${event.token ?? ""}`.trim(), when: logTime(event.time), state: "landed" });
  }
  return items;
}

export type RebalancePreset = "thirds" | "floor-heavy" | "summit-heavy";

export const REBALANCE_TARGETS: Readonly<Record<RebalancePreset, Readonly<Record<Layer, number>>>> = {
  thirds: { floor: 1 / 3, ridge: 1 / 3, summit: 1 / 3 },
  "floor-heavy": { floor: 0.6, ridge: 0.2, summit: 0.2 },
  "summit-heavy": { floor: 0.3, ridge: 0.2, summit: 0.5 },
};

export interface RebalanceMove {
  readonly from: Layer;
  readonly to: Layer;
  readonly usd: number;
  readonly sentence: string;
}

/** Moves (largest surplus to largest deficit) that bring the layer split to the target, in USDC, ignoring moves under $1. */
export function rebalanceMoves(split: readonly LayerShare[], target: Readonly<Record<Layer, number>>): RebalanceMove[] {
  const total = split.reduce((sum, entry) => sum + entry.usd, 0);
  if (!(total > 0)) return [];
  const delta = split.map((entry) => ({ layer: entry.layer, gap: entry.usd - total * (target[entry.layer] ?? 0) }));
  const surplus = delta.filter((entry) => entry.gap > 0).sort((a, b) => b.gap - a.gap);
  const deficit = delta.filter((entry) => entry.gap < 0).map((entry) => ({ ...entry, gap: -entry.gap })).sort((a, b) => b.gap - a.gap);
  const moves: RebalanceMove[] = [];
  for (const giver of surplus) {
    let left = giver.gap;
    for (const taker of deficit) {
      if (left < 1 || taker.gap < 1) continue;
      const usd = Math.min(left, taker.gap);
      left -= usd;
      taker.gap -= usd;
      const rounded = usd >= 100 ? Math.round(usd / 10) * 10 : Math.round(usd);
      moves.push({ from: giver.layer, to: taker.layer, usd, sentence: `move ${rounded.toLocaleString("en-US")} USDC from ${NETWORK_NAME[giver.layer]} to ${NETWORK_NAME[taker.layer]}` });
    }
  }
  return moves;
}

/* --------------------------------------------------------------- history */

export type EquityRange = "day" | "week" | "month" | "allTime";

export function equitySeries(history: PortfolioHistory | null, range: EquityRange): ProfilePoint[] {
  const curve = history?.equity[range]?.accountValue ?? [];
  return curve.map(([t, value]) => ({ t, value })).filter((point) => Number.isFinite(point.value));
}

const ROMAN = ["I", "II", "III", "IV", "V"] as const;

/**
 * Camps on the elevation profile: the biggest events inside the curve's
 * window (transfers in or out, and the largest position openings), at most
 * three, in time order.
 */
export function campsFor(timeline: readonly TimelineEvent[], from: number, to: number, max = 3): ProfileCamp[] {
  const candidates: { t: number; weight: number; label: string }[] = [];
  const opens = new Map<string, { t: number; notional: number; dir: string; coin: string }>();
  for (const event of timeline) {
    if (event.time < from || event.time > to) continue;
    if (event.kind === "ledger" && event.usdc !== null && Math.abs(event.usdc) > 0) {
      candidates.push({ t: event.time, weight: Math.abs(event.usdc), label: `${event.usdc > 0 ? "+" : "−"}${usdShort(Math.abs(event.usdc)).replace(/^\$/u, "$")} ${ledgerWord(event)}` });
    } else if (event.kind === "fill" && /^Open/u.test(event.dir)) {
      // Fills of one order arrive in pieces: fold them per coin and direction per hour.
      const key = `${event.coin}|${event.dir}|${Math.floor(event.time / 3_600_000)}`;
      const known = opens.get(key);
      opens.set(key, { t: known ? Math.min(known.t, event.time) : event.time, notional: (known?.notional ?? 0) + event.notional, dir: event.dir, coin: event.coin });
    }
  }
  for (const open of opens.values()) candidates.push({ t: open.t, weight: open.notional, label: `${open.coin} ${open.dir.replace(/^Open /u, "").toLowerCase()} ${usdShort(open.notional)}` });
  // Biggest first, but camps keep apart (12% of the window) so their labels never stack.
  const gap = (to - from) * 0.12;
  const picked: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.weight - a.weight)) {
    if (picked.length >= max) break;
    if (picked.every((camp) => Math.abs(camp.t - candidate.t) >= gap)) picked.push(candidate);
  }
  picked.sort((a, b) => a.t - b.t);
  return picked.map((camp, index) => ({ t: camp.t, label: `CAMP ${ROMAN[index] ?? index + 1} · ${camp.label}` }));
}

function ledgerWord(event: LedgerEvent): string {
  if (/deposit/iu.test(event.type)) return "deposit";
  if (/withdraw/iu.test(event.type)) return "withdrawal";
  if (/vault/iu.test(event.type)) return "vault";
  if (/send|transfer/iu.test(event.type)) return "transfer";
  return event.type;
}

export interface CalendarCell {
  /** `YYYY-MM-DD`, or null for padding before the first day. */
  readonly day: string | null;
  readonly date: number | null;
  readonly entry: PnlDay | null;
  /** |net| / largest |net| in the window, 0..1. */
  readonly intensity: number;
}

/** The PnL calendar: `days` UTC days ending today, in weeks starting Monday, with padding cells. */
export function calendarGrid(calendar: readonly PnlDay[], now: number, days = 35): { readonly weeks: readonly (readonly CalendarCell[])[]; readonly best: PnlDay | null; readonly worst: PnlDay | null; readonly total: number } {
  const byDay = new Map(calendar.map((entry) => [entry.day, entry]));
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const first = today - (days - 1) * 86_400_000;
  const max = Math.max(1e-9, ...calendar.map((entry) => Math.abs(entry.net)));
  const cells: CalendarCell[] = [];
  const weekday = (new Date(first).getUTCDay() + 6) % 7; // Monday = 0
  for (let index = 0; index < weekday; index += 1) cells.push({ day: null, date: null, entry: null, intensity: 0 });
  let total = 0;
  let best: PnlDay | null = null;
  let worst: PnlDay | null = null;
  for (let t = first; t <= today; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? null;
    if (entry) {
      total += entry.net;
      if (!best || entry.net > best.net) best = entry;
      if (!worst || entry.net < worst.net) worst = entry;
    }
    cells.push({ day, date: new Date(t).getUTCDate(), entry, intensity: entry ? Math.abs(entry.net) / max : 0 });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null, entry: null, intensity: 0 });
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return { weeks, best: best && best.net > 0 ? best : null, worst: worst && worst.net < 0 ? worst : null, total };
}

/** Daily PnL from a timeline (the browser path; the API sends its own calendar). */
export function calendarFromTimeline(timeline: readonly TimelineEvent[]): PnlDay[] {
  const days = new Map<string, { realizedPnl: number; fees: number; funding: number; fills: number; volume: number }>();
  for (const event of timeline) {
    if (event.kind === "ledger") continue;
    const day = new Date(event.time).toISOString().slice(0, 10);
    const entry = days.get(day) ?? { realizedPnl: 0, fees: 0, funding: 0, fills: 0, volume: 0 };
    if (event.kind === "fill") {
      entry.realizedPnl += event.closedPnl;
      entry.fees += event.feeToken === "USDC" ? event.fee : 0;
      entry.fills += 1;
      entry.volume += event.notional;
    } else {
      entry.funding += event.usdc;
    }
    days.set(day, entry);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entry]) => ({ day, ...entry, net: entry.realizedPnl - entry.fees + entry.funding }));
}

export interface RegisterEntry {
  readonly id: string;
  readonly time: number;
  readonly kind: TimelineEvent["kind"];
  readonly when: string;
  readonly entry: string;
  readonly layer: Layer;
  readonly amount: string;
  readonly direction: "up" | "down" | undefined;
  readonly hash: string | null;
}

/**
 * The Summit Register: the timeline as log-book lines. Fills of one order
 * (same order, or same coin and side within a minute) are folded into one line, as a guide would
 * write them.
 */
export function registerEntries(timeline: readonly TimelineEvent[], limit = 200): RegisterEntry[] {
  const out: RegisterEntry[] = [];
  let open: { entry: RegisterEntry; fill: FillEvent; sz: number; notional: number; pnl: number; count: number } | null = null;
  const flush = () => {
    if (!open) return;
    const { fill, sz, notional, pnl, count } = open;
    const avg = sz > 0 ? notional / sz : Number(fill.px);
    const verb = fill.dir || (fill.side === "buy" ? "Buy" : "Sell");
    out.push({
      ...open.entry,
      entry: `${verb} ${amount(sz)} ${fill.coin} at ${Number(avg.toPrecision(5)).toLocaleString("en-US")}${count > 1 ? ` · ${count} fills` : ""}${fill.liquidation ? " · LIQUIDATION" : ""}${pnl !== 0 ? ` · closed ${pnl > 0 ? "+" : "−"}${usdFull(Math.abs(pnl)).replace(/^−/u, "")}` : ""}`,
      amount: usdShort(notional),
      direction: fill.side === "buy" ? "up" : "down",
    });
    open = null;
  };
  for (const event of timeline) {
    if (out.length >= limit) break;
    if (event.kind === "fill") {
      // Same order (oid), or the same coin and direction within a minute (a TWAP slice, a ladder).
      const sameOrder = open !== null && open.fill.coin === event.coin && open.fill.dir === event.dir && (open.fill.oid === event.oid || Math.abs(open.fill.time - event.time) < 60_000);
      if (open && sameOrder) {
        open.sz += Number(event.sz) || 0;
        open.notional += event.notional;
        open.pnl += event.closedPnl;
        open.count += 1;
        continue;
      }
      flush();
      open = {
        entry: { id: event.id, time: event.time, kind: "fill", when: logTime(event.time), entry: "", layer: "floor", amount: "", direction: undefined, hash: event.hash },
        fill: event,
        sz: Number(event.sz) || 0,
        notional: event.notional,
        pnl: event.closedPnl,
        count: 1,
      };
      continue;
    }
    flush();
    if (event.kind === "funding") {
      out.push({ id: event.id, time: event.time, kind: "funding", when: logTime(event.time), entry: `Funding on ${event.coin} · ${event.usdc >= 0 ? "received" : "paid"}${event.samples && event.samples > 1 ? ` · ${event.samples} hours` : ""}`, layer: "floor", amount: `${event.usdc >= 0 ? "+" : "−"}${usdFull(Math.abs(event.usdc))}`, direction: event.usdc >= 0 ? "up" : "down", hash: null });
    } else {
      out.push({
        id: event.id,
        time: event.time,
        kind: "ledger",
        when: logTime(event.time),
        entry: event.summary || event.type,
        layer: "floor",
        amount: event.usdc !== null ? `${event.usdc >= 0 ? "+" : "−"}${usdFull(Math.abs(event.usdc))}` : event.amount ? `${event.amount} ${event.token ?? ""}`.trim() : "",
        direction: event.usdc === null ? undefined : event.usdc >= 0 ? "up" : "down",
        hash: event.hash || null,
      });
    }
  }
  flush();
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------- csv */

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Spreadsheet formula injection: a leading = + - @ is neutralised.
  const safe = /^[=+\-@\t\r]/u.test(text) && !/^-?\d/u.test(text) ? `'${text}` : text;
  return /[",\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** The timeline as CSV (one row per event, UTC ISO times). */
export function timelineCsv(timeline: readonly TimelineEvent[]): string {
  const header = ["time_utc", "kind", "coin_or_type", "direction", "size", "price", "notional_usd", "fee", "fee_token", "closed_pnl", "funding_usdc", "ledger_usdc", "hash"];
  const rows = timeline.map((event) => {
    const time = new Date(event.time).toISOString();
    if (event.kind === "fill") return [time, "fill", event.coin, event.dir, event.sz, event.px, event.notional.toFixed(2), event.fee, event.feeToken, event.closedPnl, "", "", event.hash];
    if (event.kind === "funding") return [time, "funding", event.coin, Number(event.szi) >= 0 ? "long" : "short", event.szi, "", "", "", "", "", event.usdc, "", ""];
    return [time, "ledger", event.type, event.summary, event.amount, "", "", "", event.token, "", "", event.usdc, event.hash];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/* ------------------------------------------------------------ certificate */

export interface SummitFacts {
  readonly high: number | null;
  readonly highAt: number | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly change: number | null;
  readonly changePct: number | null;
  readonly drawdown: number;
  readonly days: number;
}

/** Figures for the summit certificate from an equity series. */
export function summitFacts(series: readonly ProfilePoint[]): SummitFacts {
  if (series.length === 0) return { high: null, highAt: null, start: null, end: null, change: null, changePct: null, drawdown: 0, days: 0 };
  let high = series[0]!;
  let peak = series[0]!.value;
  let drawdown = 0;
  for (const point of series) {
    if (point.value > high.value) high = point;
    if (point.value > peak) peak = point.value;
    if (peak > 0) drawdown = Math.max(drawdown, (peak - point.value) / peak);
  }
  const start = series[0]!.value;
  const end = series[series.length - 1]!.value;
  const days = Math.max(1, Math.round((series[series.length - 1]!.t - series[0]!.t) / 86_400_000));
  return { high: high.value, highAt: high.t, start, end, change: end - start, changePct: start > 0 ? (end - start) / start : null, drawdown, days };
}

export function rangeLabel(series: readonly ProfilePoint[]): { readonly start: string; readonly end: string } {
  if (series.length === 0) return { start: "", end: "" };
  return { start: dayLabel(series[0]!.t), end: "NOW" };
}
