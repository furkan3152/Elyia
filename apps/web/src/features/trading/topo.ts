/**
 * TOPO-ready trading data (pure). The Survey artifacts draw these and
 * nothing else, so every number they show is computed (and tested) here:
 *
 * - Rope (one per position): crevasse = liquidation (HyperCore's own
 *   `liquidationPx`), anchor = stop, climber = mark, entry tick, flag =
 *   take-profit (TP/SL read from the open reduce-only trigger orders), with
 *   the liquidation distance, a risk band and a route grade.
 * - Shock slider: the same ropes under a price shock, and which would snap.
 * - Avalanche bulletin: one 1-5 level for the whole account.
 * - Windsock: hourly funding, APR, countdown to the next hour, the side that
 *   pays and a 0-5 stripe strength.
 * - Weather: realised volatility of a market and its percentile against its
 *   own recent history (clear / few clouds / overcast / storm).
 * - Book depth: levels grouped client-side by a price step, with
 *   cumulative depth for the depth bars.
 * - Account summary: equity, margin, leverage, exposure, PnL.
 *
 * Inputs are the parsed feeds (accountModel.ts, marketCatalog.ts); unknown
 * stays null, never zero.
 */
import type { BookLevel, Candle, FrontendOpenOrder, SpotBalance } from "@elyia/core/hypercore/info";

import { formatCountdown, fundingApr, msToNextFunding } from "../../lib/hypercore/marketCatalog";
import type { AccountSummary, PositionRow } from "./accountModel";
import { triggerKind } from "./orderBuilders";

/* ------------------------------------------------------------------ rope */

/** Liquidation-distance bands: critical < 5% (the rope may blink, at most 1 Hz), danger < 10% (frays), watch < 25%. */
export type RiskBand = "critical" | "danger" | "watch" | "safe" | "unknown";

export function riskBand(distance: number | null): RiskBand {
  if (distance === null || !Number.isFinite(distance)) return "unknown";
  if (distance < 0.05) return "critical";
  if (distance < 0.1) return "danger";
  if (distance < 0.25) return "watch";
  return "safe";
}

/**
 * Route grade (SAC scale) of a perp position by leverage: T3-T4 "mountain"
 * up to 10x, T5-T6 "alpine" beyond. Spot and 1x hiking grades (T1-T2)
 * belong to non-leveraged moves.
 */
export type Grade = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";

export function leverageGrade(leverage: number | null): Grade {
  if (leverage === null || !(leverage > 1)) return "T2";
  if (leverage <= 5) return "T3";
  if (leverage <= 10) return "T4";
  if (leverage <= 20) return "T5";
  return "T6";
}

export interface TriggerLevel {
  readonly px: number;
  readonly oid: number;
  /** Follows the whole position (positionTpsl) rather than a fixed size. */
  readonly wholePosition: boolean;
}

export interface Rope {
  readonly coin: string;
  readonly dex: string;
  readonly side: "long" | "short";
  readonly size: number;
  readonly entryPx: number;
  readonly markPx: number;
  /** HyperCore's liquidation price; null when the position cannot be liquidated (or the API gives none). */
  readonly liquidationPx: number | null;
  readonly tp: TriggerLevel | null;
  readonly sl: TriggerLevel | null;
  /** |mark - liquidation| / mark; null without a liquidation price. */
  readonly distance: number | null;
  readonly band: RiskBand;
  readonly grade: Grade;
  readonly leverage: number;
  readonly leverageType: "cross" | "isolated";
  readonly positionValue: number;
  readonly unrealizedPnl: number;
  readonly roe: number;
  /** Move from mark to the stop / take-profit as a fraction of the mark (positive = that far away); null when unset. */
  readonly toStop: number | null;
  readonly toTarget: number | null;
  /** The stop sits past the liquidation price: liquidation would hit first, so the stop protects nothing. */
  readonly stopBeyondLiquidation: boolean;
}

/** The reduce-only TP and SL triggers of a coin nearest the mark (HyperCore labels each trigger "Take Profit …" or "Stop …"). */
export function triggersFor(coin: string, markPx: number, orders: readonly FrontendOpenOrder[] | null | undefined): { readonly tp: TriggerLevel | null; readonly sl: TriggerLevel | null } {
  let tp: TriggerLevel | null = null;
  let sl: TriggerLevel | null = null;
  for (const order of orders ?? []) {
    if (order.coin !== coin || !order.reduceOnly) continue;
    const kind = triggerKind(order);
    const px = Number(order.triggerPx);
    if (kind === null || !(px > 0)) continue;
    const level: TriggerLevel = { px, oid: order.oid, wholePosition: order.isPositionTpsl === true };
    const distance = Math.abs(px - markPx);
    if (kind === "tp" && (tp === null || distance < Math.abs(tp.px - markPx))) tp = level;
    if (kind === "sl" && (sl === null || distance < Math.abs(sl.px - markPx))) sl = level;
  }
  return { tp, sl };
}

/** One rope per open position. `markOf` gives a live mark (mids feed); the position's own value/size is the fallback. */
export function ropesFrom(positions: readonly PositionRow[] | null | undefined, openOrders: readonly FrontendOpenOrder[] | null | undefined, markOf: (coin: string) => number | null = () => null): Rope[] {
  if (!positions) return [];
  return positions.map((row) => {
    const live = markOf(row.coin);
    const markPx = live !== null && live > 0 ? live : row.markPx;
    const liq = row.liquidationPx;
    const distance = liq !== null && markPx > 0 ? Math.abs(markPx - liq) / markPx : null;
    const { tp, sl } = triggersFor(row.coin, markPx, openOrders);
    const toward = (px: number | null, profit: boolean): number | null => {
      if (px === null || !(markPx > 0)) return null;
      const move = (px - markPx) / markPx;
      return row.isLong === profit ? move : -move;
    };
    return {
      coin: row.coin,
      dex: row.dex,
      side: row.isLong ? "long" : "short",
      size: Math.abs(row.szi),
      entryPx: row.entryPx,
      markPx,
      liquidationPx: liq,
      tp,
      sl,
      distance,
      band: riskBand(distance),
      grade: leverageGrade(row.leverage),
      leverage: row.leverage,
      leverageType: row.leverageType,
      positionValue: row.positionValue,
      unrealizedPnl: row.unrealizedPnl,
      roe: row.roe,
      toStop: toward(sl?.px ?? null, false),
      toTarget: toward(tp?.px ?? null, true),
      stopBeyondLiquidation: sl !== null && liq !== null && (row.isLong ? sl.px <= liq : sl.px >= liq),
    };
  });
}

export interface RopeLayout {
  /** Positions along the rope in [0, 1]: 0 = crevasse side, 1 = summit side. Null when the level is absent. */
  readonly crevasse: number | null;
  readonly anchor: number | null;
  readonly entry: number;
  readonly climber: number;
  readonly flag: number | null;
  /** Prices at the two ends of the drawn pitch. */
  readonly from: number;
  readonly to: number;
}

/**
 * Where each mark sits on a horizontal pitch, oriented so the crevasse
 * (liquidation) is always on the left and the summit flag (take-profit) on
 * the right, for longs and shorts alike. The pitch spans every level shown
 * plus 6% padding at the open ends.
 */
export function ropeLayout(rope: Pick<Rope, "side" | "entryPx" | "markPx" | "liquidationPx" | "tp" | "sl">): RopeLayout {
  const dir = rope.side === "long" ? 1 : -1;
  // Signed "height": larger = further from liquidation.
  const h = (px: number) => dir * px;
  const levels = [rope.entryPx, rope.markPx, rope.liquidationPx, rope.tp?.px ?? null, rope.sl?.px ?? null].filter((px): px is number => px !== null && Number.isFinite(px) && px > 0);
  let low = Math.min(...levels.map(h));
  let high = Math.max(...levels.map(h));
  const span = Math.max(high - low, Math.abs(rope.markPx) * 0.01, 1e-12);
  if (rope.liquidationPx === null) low -= span * 0.06;
  if (rope.tp === null) high += span * 0.06;
  const width = high - low;
  const at = (px: number | null | undefined): number | null => (px === null || px === undefined || !(px > 0) ? null : Math.max(0, Math.min(1, (h(px) - low) / width)));
  return {
    crevasse: at(rope.liquidationPx),
    anchor: at(rope.sl?.px),
    entry: at(rope.entryPx) ?? 0,
    climber: at(rope.markPx) ?? 0,
    flag: at(rope.tp?.px),
    from: dir * low,
    to: dir * high,
  };
}

/* ------------------------------------------------------------- shock slider */

export interface ShockedRope {
  readonly coin: string;
  readonly markPx: number;
  readonly distance: number | null;
  readonly band: RiskBand;
  /** The shocked mark reaches the liquidation price. */
  readonly snaps: boolean;
  /** PnL change of the position under the shock. */
  readonly pnlChange: number;
}

/**
 * Ropes under a price shock: `shock` is a fraction (-0.2 = everything -20%)
 * or a per-coin map (coins absent from it do not move). Liquidation prices
 * are held fixed, which is exact for isolated positions and an estimate for
 * cross (other positions' losses pull a cross liquidation closer).
 */
export function shockRopes(ropes: readonly Rope[], shock: number | Readonly<Record<string, number>>): ShockedRope[] {
  return ropes.map((rope) => {
    const move = typeof shock === "number" ? shock : (shock[rope.coin] ?? 0);
    const markPx = rope.markPx * (1 + move);
    const liq = rope.liquidationPx;
    const snaps = liq !== null && (rope.side === "long" ? markPx <= liq : markPx >= liq);
    const distance = liq !== null && markPx > 0 && !snaps ? Math.abs(markPx - liq) / markPx : snaps ? 0 : null;
    const signed = rope.side === "long" ? rope.size : -rope.size;
    return { coin: rope.coin, markPx, distance, band: snaps ? "critical" : riskBand(distance), snaps, pnlChange: signed * (markPx - rope.markPx) };
  });
}

/* --------------------------------------------------------- account summary */

export interface AccountTopo {
  /** Perp account value across dexes plus spot USDC. */
  readonly equity: number;
  readonly perpValue: number;
  readonly spotUsdc: number;
  readonly withdrawable: number;
  readonly marginUsed: number;
  readonly maintenance: number;
  /** Cross maintenance / cross account value (1 = liquidation); null without a cross account. */
  readonly marginRatio: number | null;
  /** Total position notional / perp account value; null when the account holds nothing. */
  readonly leverage: number | null;
  readonly unrealizedPnl: number;
  readonly longNotional: number;
  readonly shortNotional: number;
  /** Long minus short notional. */
  readonly netExposure: number;
  readonly positions: number;
  /** Smallest liquidation distance across positions. */
  readonly nearest: { readonly coin: string; readonly distance: number } | null;
}

export function accountTopo(summary: AccountSummary | null | undefined, positions: readonly PositionRow[] | null | undefined, spot: readonly SpotBalance[] | null | undefined): AccountTopo | null {
  if (!summary) return null;
  const rows = positions ?? [];
  const usdc = (spot ?? []).find((balance) => balance.coin === "USDC" || balance.token === 0);
  const spotUsdc = usdc ? Number(usdc.total) || 0 : 0;
  let longNotional = 0;
  let shortNotional = 0;
  let unrealizedPnl = 0;
  let nearest: { coin: string; distance: number } | null = null;
  for (const row of rows) {
    if (row.isLong) longNotional += row.positionValue;
    else shortNotional += row.positionValue;
    unrealizedPnl += row.unrealizedPnl;
    if (row.liquidationDistance !== null && (nearest === null || row.liquidationDistance < nearest.distance)) nearest = { coin: row.coin, distance: row.liquidationDistance };
  }
  const total = longNotional + shortNotional;
  return {
    equity: summary.accountValue + spotUsdc,
    perpValue: summary.accountValue,
    spotUsdc,
    withdrawable: summary.withdrawable,
    marginUsed: summary.marginUsed,
    maintenance: summary.maintenance,
    marginRatio: summary.crossAccountValue > 0 ? summary.maintenance / summary.crossAccountValue : null,
    leverage: summary.accountValue > 0 && total > 0 ? total / summary.accountValue : null,
    unrealizedPnl,
    longNotional,
    shortNotional,
    netExposure: longNotional - shortNotional,
    positions: rows.length,
    nearest,
  };
}

export type AvalancheLevel = 1 | 2 | 3 | 4 | 5;

export interface AvalancheBulletin {
  readonly level: AvalancheLevel;
  readonly label: "low" | "moderate" | "considerable" | "high" | "very high";
  /** One line of plain advice. */
  readonly advice: string;
  /** What drove the level. */
  readonly driver: string;
}

const LEVEL_LABELS = ["low", "moderate", "considerable", "high", "very high"] as const;

/**
 * Account risk on the 1-5 avalanche scale: the worse of the nearest
 * liquidation distance (5%, 10%, 20%, 35%) and the cross margin ratio
 * (80%, 60%, 40%, 20% of maintenance used), lifted one level by account
 * leverage above 10x.
 */
export function avalancheBulletin(account: AccountTopo | null): AvalancheBulletin {
  if (!account || account.positions === 0) return { level: 1, label: "low", advice: "No open positions: nothing on the slope.", driver: "no positions" };
  const byDistance = (d: number | null): AvalancheLevel => (d === null ? 1 : d < 0.05 ? 5 : d < 0.1 ? 4 : d < 0.2 ? 3 : d < 0.35 ? 2 : 1);
  const byRatio = (r: number | null): AvalancheLevel => (r === null ? 1 : r >= 0.8 ? 5 : r >= 0.6 ? 4 : r >= 0.4 ? 3 : r >= 0.2 ? 2 : 1);
  const distanceLevel = byDistance(account.nearest?.distance ?? null);
  const ratioLevel = byRatio(account.marginRatio);
  let level = Math.max(distanceLevel, ratioLevel) as AvalancheLevel;
  let driver = distanceLevel >= ratioLevel && account.nearest ? `${account.nearest.coin} is ${(account.nearest.distance * 100).toFixed(1)}% from liquidation` : `cross margin ${((account.marginRatio ?? 0) * 100).toFixed(0)}% used`;
  if (account.leverage !== null && account.leverage > 10 && level < 5) {
    level = (level + 1) as AvalancheLevel;
    driver = `${driver}; account leverage ${account.leverage.toFixed(1)}x`;
  }
  const advice = [
    "Stable conditions. Keep your stops in place.",
    "Mostly stable. Check the nearest rope before adding size.",
    "Take care: one sharp move could reach a liquidation. Add margin or set stops.",
    "Dangerous: a normal move can liquidate you. Reduce size or add margin now.",
    "Very dangerous: liquidation is close. Close or reduce the position, or add margin.",
  ][level - 1] as string;
  return { level, label: LEVEL_LABELS[level - 1] as AvalancheBulletin["label"], advice, driver };
}

/* ---------------------------------------------------------------- windsock */

export interface Windsock {
  /** Hourly funding rate as a fraction (positive: longs pay shorts). */
  readonly hourly: number;
  readonly apr: number;
  /** The side that pays this hour; "none" at exactly zero. */
  readonly payer: "longs" | "shorts" | "none";
  readonly receiver: "longs" | "shorts" | "none";
  /** 0-5 filled stripes by |APR|: 1% / 11% (HyperCore's baseline) / 25% / 50% / 100%. */
  readonly stripes: 0 | 1 | 2 | 3 | 4 | 5;
  /** Top of the next UTC hour (when funding is paid). */
  readonly nextAt: number;
  readonly msToNext: number;
  readonly countdown: string;
}

const STRIPE_APR = [0.01, 0.11, 0.25, 0.5, 1] as const;

export function windsockStripes(apr: number): Windsock["stripes"] {
  const strength = Math.abs(apr);
  let stripes = 0;
  for (const threshold of STRIPE_APR) if (strength >= threshold) stripes += 1;
  return stripes as Windsock["stripes"];
}

/** The windsock for a market's hourly funding; null on spot or before the context arrives. */
export function fundingWindsock(hourly: number | null | undefined, now: number): Windsock | null {
  const apr = fundingApr(hourly);
  if (apr === null || hourly === null || hourly === undefined) return null;
  const payer = hourly > 0 ? "longs" : hourly < 0 ? "shorts" : "none";
  const msToNext = msToNextFunding(now);
  return {
    hourly,
    apr,
    payer,
    receiver: payer === "longs" ? "shorts" : payer === "shorts" ? "longs" : "none",
    stripes: windsockStripes(apr),
    nextAt: now + msToNext,
    msToNext,
    countdown: formatCountdown(msToNext),
  };
}

/* ----------------------------------------------------------------- weather */

export type WeatherKind = "clear" | "few-clouds" | "overcast" | "storm";

export interface Weather {
  readonly kind: WeatherKind;
  /** Annualised realised volatility of the latest window (0.62 = 62%). */
  readonly volatility: number;
  /** Where that sits among the market's own windows over the history (0-1). */
  readonly percentile: number;
  /** Windows compared. */
  readonly samples: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Annualised standard deviation of log returns (sample stdev x sqrt(periods per year)). */
export function realizedVolatility(closes: readonly number[], periodMs: number): number | null {
  if (closes.length < 3 || !(periodMs > 0)) return null;
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const a = closes[index - 1] as number;
    const b = closes[index] as number;
    if (a > 0 && b > 0) returns.push(Math.log(b / a));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(YEAR_MS / periodMs);
}

export function weatherKind(percentile: number): WeatherKind {
  if (percentile < 0.4) return "clear";
  if (percentile < 0.7) return "few-clouds";
  if (percentile < 0.9) return "overcast";
  return "storm";
}

/**
 * Weather from candles (oldest first): the realised volatility of the last
 * `window` returns, ranked against every earlier window of the same length
 * (stepping by `stride`). Needs at least three windows of history; null
 * before that.
 */
export function volatilityWeather(candles: readonly Pick<Candle, "t" | "c">[], periodMs: number, window = 24, stride = 6): Weather | null {
  const closes = candles.map((candle) => Number(candle.c)).filter((value) => value > 0);
  if (closes.length < window * 3 + 1) return null;
  const vols: number[] = [];
  for (let end = closes.length; end - window - 1 >= 0; end -= stride) {
    const vol = realizedVolatility(closes.slice(end - window - 1, end), periodMs);
    if (vol !== null) vols.push(vol);
  }
  const current = vols[0];
  if (current === undefined || vols.length < 3) return null;
  const below = vols.filter((vol) => vol <= current).length;
  // Rank among all windows, the current one included (a fresh record high is the 100th percentile).
  const percentile = vols.length > 1 ? (below - 1) / (vols.length - 1) : 0.5;
  return { kind: weatherKind(percentile), volatility: current, percentile, samples: vols.length };
}

/** Folds a live candle (the `candle` feed) into a snapshot: replaces the same open time, appends a newer one. */
export function mergeCandle<T extends Pick<Candle, "t">>(candles: readonly T[], live: T | null | undefined, keep = 1_000): T[] {
  if (!live) return [...candles];
  const last = candles[candles.length - 1];
  if (last && last.t === live.t) return [...candles.slice(0, -1), live];
  if (last && live.t < last.t) return [...candles];
  const out = [...candles, live];
  return out.length > keep ? out.slice(out.length - keep) : out;
}

/* -------------------------------------------------------------- book depth */

export interface DepthLevel {
  readonly px: number;
  readonly sz: number;
  readonly n: number;
  /** Size from the best price up to and including this level. */
  readonly cumSz: number;
  /** Quote notional from the best price up to and including this level. */
  readonly cumNtl: number;
  /** cumSz / the deeper side's total shown (0-1), for depth bars on one scale. */
  readonly depth: number;
}

export interface DepthBook {
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
  readonly step: number;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly mid: number | null;
  readonly spread: number | null;
  readonly spreadBps: number | null;
  /** Bid share of the shown size (0.5 = balanced; above leans bid). */
  readonly imbalance: number | null;
}

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toString();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.includes(".") ? (text.split(".")[1] ?? "").length : 0;
}

/**
 * Groups one side of the book into buckets of `step` (bids round down,
 * asks round up, so a grouped level never looks better than the real one)
 * and keeps the best `levels` buckets.
 */
export function groupLevels(levels: readonly Pick<BookLevel, "px" | "sz" | "n">[], step: number, side: "bid" | "ask", keep: number): { px: number; sz: number; n: number }[] {
  const decimals = decimalsOf(step);
  const buckets = new Map<string, { px: number; sz: number; n: number }>();
  for (const level of levels) {
    const px = Number(level.px);
    const sz = Number(level.sz);
    if (!(px > 0) || !(sz > 0)) continue;
    const scaled = px / step;
    // Snap values within float noise of a bucket edge onto it before rounding.
    const nearest = Math.round(scaled);
    const units = Math.abs(scaled - nearest) < 1e-9 ? nearest : side === "bid" ? Math.floor(scaled) : Math.ceil(scaled);
    const bucket = Number((units * step).toFixed(decimals));
    const key = bucket.toFixed(decimals);
    const entry = buckets.get(key);
    if (entry) {
      entry.sz += sz;
      entry.n += Number(level.n) || 0;
    } else buckets.set(key, { px: bucket, sz, n: Number(level.n) || 0 });
  }
  const sorted = [...buckets.values()].sort((a, b) => (side === "bid" ? b.px - a.px : a.px - b.px));
  return sorted.slice(0, keep);
}

/** Depth view of a book at a grouping step (use the native tick for none). */
export function depthBook(bids: readonly Pick<BookLevel, "px" | "sz" | "n">[], asks: readonly Pick<BookLevel, "px" | "sz" | "n">[], step: number, levels = 12): DepthBook {
  const grouped = { bid: groupLevels(bids, step, "bid", levels), ask: groupLevels(asks, step, "ask", levels) };
  const cumulate = (rows: { px: number; sz: number; n: number }[]) => {
    let cumSz = 0;
    let cumNtl = 0;
    return rows.map((row) => {
      cumSz += row.sz;
      cumNtl += row.sz * row.px;
      return { ...row, cumSz, cumNtl };
    });
  };
  const bidRows = cumulate(grouped.bid);
  const askRows = cumulate(grouped.ask);
  const bidTotal = bidRows[bidRows.length - 1]?.cumSz ?? 0;
  const askTotal = askRows[askRows.length - 1]?.cumSz ?? 0;
  const scale = Math.max(bidTotal, askTotal) || 1;
  const withDepth = (rows: ReturnType<typeof cumulate>): DepthLevel[] => rows.map((row) => ({ ...row, depth: row.cumSz / scale }));
  // Best prices come from the raw book, not the buckets.
  const bestBid = bids[0] ? Number(bids[0].px) : null;
  const bestAsk = asks[0] ? Number(asks[0].px) : null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  return {
    bids: withDepth(bidRows),
    asks: withDepth(askRows),
    step,
    bestBid,
    bestAsk,
    mid,
    spread,
    spreadBps: spread !== null && mid !== null && mid > 0 ? (spread / mid) * 10_000 : null,
    imbalance: bidTotal + askTotal > 0 ? bidTotal / (bidTotal + askTotal) : null,
  };
}
