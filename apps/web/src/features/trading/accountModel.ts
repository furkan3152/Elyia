/**
 * The followed account, read from HyperCore's WebSocket feeds (pure):
 * positions across every perp dex (allDexsClearinghouseState), open orders,
 * spot balances, fills, funding and TWAPs, plus the trading facts the Rule
 * Book needs (open orders, open notional, 24 h volume and realized loss).
 * Unknown stays null: the guard fails closed on it.
 */
import type { ClearinghouseState, FrontendOpenOrder, PerpPositionState, SpotBalance, UserFill } from "@elyia/core/hypercore/info";
import type { TradingFacts } from "@elyia/core/policyEvaluate";

import { liquidationDistance } from "./liquidation";

export interface PositionRow {
  readonly coin: string;
  readonly dex: string;
  /** Signed size (positive long). */
  readonly szi: number;
  readonly sziText: string;
  readonly isLong: boolean;
  readonly entryPx: number;
  readonly positionValue: number;
  readonly unrealizedPnl: number;
  /** Return on equity as a fraction. */
  readonly roe: number;
  readonly liquidationPx: number | null;
  readonly marginUsed: number;
  readonly leverage: number;
  readonly leverageType: "cross" | "isolated";
  readonly maxLeverage: number;
  /** Funding since the position opened (positive = paid). */
  readonly fundingSinceOpen: number;
  /** Mark implied by value / size. */
  readonly markPx: number;
  readonly liquidationDistance: number | null;
}

export interface AccountSummary {
  readonly accountValue: number;
  readonly withdrawable: number;
  readonly marginUsed: number;
  readonly maintenance: number;
  readonly totalNotional: number;
  readonly crossAccountValue: number;
}

function n(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullable(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionRow(position: PerpPositionState, dex: string): PositionRow | null {
  const szi = n(position.szi);
  if (szi === 0) return null;
  const value = Math.abs(n(position.positionValue));
  const markPx = value / Math.abs(szi);
  const liq = nullable(position.liquidationPx);
  return {
    coin: position.coin,
    dex,
    szi,
    sziText: String(position.szi),
    isLong: szi > 0,
    entryPx: n(position.entryPx),
    positionValue: value,
    unrealizedPnl: n(position.unrealizedPnl),
    roe: n(position.returnOnEquity),
    liquidationPx: liq !== null && liq > 0 ? liq : null,
    marginUsed: n(position.marginUsed),
    leverage: n(position.leverage?.value),
    leverageType: position.leverage?.type === "isolated" ? "isolated" : "cross",
    maxLeverage: n(position.maxLeverage),
    fundingSinceOpen: n(position.cumFunding?.sinceOpen),
    markPx,
    liquidationDistance: liquidationDistance(markPx, liq),
  };
}

/** `[dex, clearinghouseState]` pairs from either feed shape. */
export function clearinghouseStates(data: unknown): Array<readonly [string, ClearinghouseState]> {
  const body = data as { clearinghouseStates?: unknown; clearinghouseState?: unknown; dex?: unknown } | null;
  if (!body) return [];
  if (Array.isArray(body.clearinghouseStates)) {
    return body.clearinghouseStates.filter((entry): entry is [string, ClearinghouseState] => Array.isArray(entry) && typeof entry[0] === "string" && !!entry[1] && typeof entry[1] === "object");
  }
  if (body.clearinghouseState && typeof body.clearinghouseState === "object") return [[typeof body.dex === "string" ? body.dex : "", body.clearinghouseState as ClearinghouseState]];
  if ("assetPositions" in (body as object)) return [["", body as unknown as ClearinghouseState]];
  return [];
}

/** Every open position across dexes, largest first. */
export function positionsFrom(data: unknown): PositionRow[] {
  const rows: PositionRow[] = [];
  for (const [dex, state] of clearinghouseStates(data)) {
    for (const entry of state.assetPositions ?? []) {
      const row = entry?.position ? positionRow(entry.position, dex) : null;
      if (row) rows.push(row);
    }
  }
  return rows.sort((a, b) => b.positionValue - a.positionValue);
}

/** Margin summary across dexes (the first dex's cross account plus every builder dex). */
export function accountSummaryFrom(data: unknown): AccountSummary | null {
  const states = clearinghouseStates(data);
  if (states.length === 0) return null;
  let accountValue = 0;
  let withdrawable = 0;
  let marginUsed = 0;
  let maintenance = 0;
  let totalNotional = 0;
  let crossAccountValue = 0;
  for (const [dex, state] of states) {
    accountValue += n(state.marginSummary?.accountValue);
    withdrawable += n(state.withdrawable);
    marginUsed += n(state.marginSummary?.totalMarginUsed);
    maintenance += n(state.crossMaintenanceMarginUsed);
    totalNotional += n(state.marginSummary?.totalNtlPos);
    if (dex === "") crossAccountValue = n(state.crossMarginSummary?.accountValue);
  }
  return { accountValue, withdrawable, marginUsed, maintenance, totalNotional, crossAccountValue };
}

/** Open orders from the `openOrders` feed (frontend fields: triggers, reduce-only, TP/SL children). */
export function openOrdersFrom(data: unknown): FrontendOpenOrder[] {
  const orders = (data as { orders?: unknown } | null)?.orders;
  return Array.isArray(orders) ? (orders as FrontendOpenOrder[]).filter((order) => order && typeof order.oid === "number") : [];
}

export function spotBalancesFrom(data: unknown): SpotBalance[] {
  const balances = (data as { spotState?: { balances?: unknown } } | null)?.spotState?.balances;
  return Array.isArray(balances) ? (balances as SpotBalance[]) : [];
}

/** USDC on spot (total and free). */
export function spotUsdc(balances: readonly SpotBalance[]): { readonly total: number; readonly free: number } {
  const usdc = balances.find((balance) => balance.coin === "USDC" || balance.token === 0);
  if (!usdc) return { total: 0, free: 0 };
  return { total: n(usdc.total), free: Math.max(0, n(usdc.total) - n(usdc.hold)) };
}

export interface TwapRow {
  readonly id: number;
  readonly coin: string;
  readonly isBuy: boolean;
  readonly size: number;
  readonly executed: number;
  readonly executedNotional: number;
  readonly minutes: number;
  readonly reduceOnly: boolean;
  readonly randomize: boolean;
  readonly startedAt: number;
}

/** Running TWAPs from `twapStates` (`states: [[id, state], ...]`). */
export function twapsFrom(data: unknown): TwapRow[] {
  const states = (data as { states?: unknown } | null)?.states;
  if (!Array.isArray(states)) return [];
  const rows: TwapRow[] = [];
  for (const entry of states) {
    if (!Array.isArray(entry) || typeof entry[0] !== "number" || !entry[1] || typeof entry[1] !== "object") continue;
    const state = entry[1] as Record<string, unknown>;
    rows.push({
      id: entry[0],
      coin: String(state.coin ?? ""),
      isBuy: state.side === "B",
      size: n(state.sz),
      executed: n(state.executedSz),
      executedNotional: n(state.executedNtl),
      minutes: n(state.minutes),
      reduceOnly: state.reduceOnly === true,
      randomize: state.randomize === true,
      startedAt: n(state.timestamp),
    });
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when a fill added risk (opened or flipped a position, or a spot buy/sell that is not a close). */
export function fillAddsRisk(fill: Pick<UserFill, "dir">): boolean {
  const dir = fill.dir ?? "";
  return dir.startsWith("Open") || dir.includes(">") || dir === "Buy" || dir === "Sell";
}

export interface FillWindow {
  /** Risk-adding notional in the window; null when the fill history may not reach back that far. */
  readonly volume: number | null;
  /** Realized loss (positive) net of fees in the window; 0 when the window made money; null when unknown. */
  readonly realizedLoss: number | null;
}

/**
 * Volume and realized loss over the last `windowMs` from the newest-first
 * fill list. `complete` says the list holds every fill the feed has (not
 * cut at a cap); when it is cut and the oldest fill is inside the window,
 * the window cannot be measured and the answer is null.
 */
export function fillWindow(fills: readonly Pick<UserFill, "time" | "px" | "sz" | "dir" | "closedPnl" | "fee">[] | null, now: number, windowMs: number = DAY_MS, complete = true): FillWindow {
  if (fills === null) return { volume: null, realizedLoss: null };
  const since = now - windowMs;
  const oldest = fills.length > 0 ? fills[fills.length - 1]!.time : Number.POSITIVE_INFINITY;
  if (!complete && oldest >= since) return { volume: null, realizedLoss: null };
  let volume = 0;
  let pnl = 0;
  for (const fill of fills) {
    if (fill.time < since) continue;
    if (fillAddsRisk(fill)) volume += n(fill.px) * n(fill.sz);
    pnl += n(fill.closedPnl) - n(fill.fee);
  }
  return { volume, realizedLoss: pnl < 0 ? -pnl : 0 };
}

function micros(usd: number | null): bigint | null {
  if (usd === null || !Number.isFinite(usd)) return null;
  return BigInt(Math.ceil(Math.max(0, usd) * 1_000_000));
}

export interface GuardAccountFacts {
  readonly trading: TradingFacts;
  /** Rolling windows for the Rule Book caps; null when unknown. */
  readonly dayUsdMicros: bigint | null;
  readonly weekUsdMicros: bigint | null;
}

/**
 * The Rule Book's account facts. Each input may be null (feed not loaded
 * yet): the matching fact stays null and any rule that needs it denies.
 */
export function guardAccountFacts(input: {
  readonly positions: readonly PositionRow[] | null;
  readonly openOrders: readonly FrontendOpenOrder[] | null;
  readonly fills: readonly Pick<UserFill, "time" | "px" | "sz" | "dir" | "closedPnl" | "fee">[] | null;
  readonly fillsComplete: boolean;
  readonly now: number;
}): GuardAccountFacts {
  const day = fillWindow(input.fills, input.now, DAY_MS, input.fillsComplete);
  const week = fillWindow(input.fills, input.now, 7 * DAY_MS, input.fillsComplete);
  return {
    trading: {
      openOrders: input.openOrders ? input.openOrders.length : null,
      openNotionalUsdMicros: input.positions ? micros(input.positions.reduce((sum, position) => sum + position.positionValue, 0)) : null,
      dayVolumeUsdMicros: micros(day.volume),
      dayRealizedLossUsdMicros: micros(day.realizedLoss),
    },
    dayUsdMicros: micros(day.volume),
    weekUsdMicros: micros(week.volume),
  };
}
