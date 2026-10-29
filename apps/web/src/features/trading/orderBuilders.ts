/**
 * Order builders for the terminal (pure), on top of @elyia/core's HyperCore
 * actions and wire rules. Everything that reaches a signature is a wire
 * string checked by core (`orderWireFor` refuses, never silently rounds);
 * the rounding done here is deliberate and always toward the user's
 * safety:
 *
 * - sizes round down to the market's lot (never more than asked);
 * - limit prices round down for buys and up for sells (never a worse price);
 * - "market" orders are IOC limits at mid +/- slippage, rounded toward the
 *   mid by core `marketPrice` (never more slippage than allowed);
 * - TP/SL triggers are reduce-only and on the correct side of the entry.
 *
 * Every builder throws a TicketError with plain words and the fix.
 */
import {
  cancelAction,
  orderAction,
  orderWireFor,
  twapCancelAction,
  twapOrderAction,
  updateIsolatedMarginAction,
  updateLeverageAction,
  TWAP_MAX_MINUTES,
  TWAP_MIN_MINUTES,
  type BuilderFee,
  type CancelAction,
  type OrderAction,
  type OrderGrouping,
  type OrderWire,
  type Tif,
  type TwapCancelAction,
  type TwapOrderAction,
  type UpdateIsolatedMarginAction,
  type UpdateLeverageAction,
} from "@elyia/core/hypercore/actions";
import { HyperCoreWireError, marketPrice, newCloid, numberToPlainString, roundPrice, roundSize, usdToMicros, type MarketInfo } from "@elyia/core/hypercore/wire";

import { ladderPrices, splitLots, scaleWeights, type ScaleSkew } from "./scale";

export type Side = "buy" | "sell";

/** HyperCore refuses orders under $10 (10 quote units on spot). */
export const MIN_ORDER_NOTIONAL = 10;
/** Market TP/SL triggers execute as IOC with up to this slippage from the trigger (HyperCore's own cap). */
export const TRIGGER_MARKET_SLIPPAGE_BPS = 1_000;
/** TWAP minimum value (HyperCore docs). */
export const MIN_TWAP_NOTIONAL = 100;

export class TicketError extends Error {
  readonly field: "size" | "price" | "tp" | "sl" | "leverage" | "twap" | "scale" | "market";
  constructor(field: TicketError["field"], message: string) {
    super(message);
    this.name = "TicketError";
    this.field = field;
  }
}

function text(value: string | number): string {
  return typeof value === "number" ? numberToPlainString(value) : value;
}

function positive(value: string | number, field: TicketError["field"], what: string): string {
  const raw = text(value).trim();
  if (!/^\d+(?:\.\d+)?$/u.test(raw) || Number(raw) <= 0) throw new TicketError(field, `Enter a ${what} above zero.`);
  return raw;
}

/** Size rounded down to whole lots; refuses when nothing is left. */
export function lotSize(size: string | number, market: Pick<MarketInfo, "szDecimals" | "displayName">): string {
  const rounded = roundSize(positive(size, "size", "size"), market.szDecimals, "down");
  if (Number(rounded) <= 0) throw new TicketError("size", `The size is below one lot of ${market.displayName} (${(10 ** -market.szDecimals).toFixed(market.szDecimals)}).`);
  return rounded;
}

/** A person's limit price on the tick, never worse for them: buys round down, sells up. */
export function tickPrice(price: string | number, market: Pick<MarketInfo, "szDecimals" | "isSpot">, side: Side): string {
  try {
    return roundPrice(positive(price, "price", "price"), market.szDecimals, market.isSpot, side === "buy" ? "down" : "up");
  } catch (error) {
    if (error instanceof TicketError) throw error;
    throw new TicketError("price", error instanceof Error ? error.message : "The price is not valid.");
  }
}

function assertMinNotional(size: string, px: string, field: TicketError["field"] = "size", minimum = MIN_ORDER_NOTIONAL): void {
  if (Number(size) * Number(px) < minimum) {
    throw new TicketError(field, `Orders must be worth at least $${minimum} (this one is $${(Number(size) * Number(px)).toFixed(2)}). Increase the size.`);
  }
}

function wrapWire<T>(build: () => T, field: TicketError["field"]): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof TicketError) throw error;
    if (error instanceof HyperCoreWireError) throw new TicketError(field, error.message);
    throw error;
  }
}

/** One leg of a built order, for previews, chart lines and optimistic rows. */
export interface OrderLeg {
  readonly role: "entry" | "tp" | "sl" | "close" | "ladder";
  readonly isBuy: boolean;
  readonly px: string;
  readonly sz: string;
  readonly reduceOnly: boolean;
  readonly tif: Tif | null;
  readonly triggerPx: string | null;
  readonly cloid: string;
}

export interface BuiltOrder {
  readonly action: OrderAction;
  readonly legs: readonly OrderLeg[];
  /** Entry legs only: size x limit price (the worst case). */
  readonly notional: number;
  readonly grouping: OrderGrouping;
}

function legsOf(wires: readonly OrderWire[], roles: readonly OrderLeg["role"][]): OrderLeg[] {
  return wires.map((wire, index) => ({
    role: roles[index] ?? "entry",
    isBuy: wire.b,
    px: wire.p,
    sz: wire.s,
    reduceOnly: wire.r,
    tif: "limit" in wire.t ? wire.t.limit.tif : null,
    triggerPx: "trigger" in wire.t ? wire.t.trigger.triggerPx : null,
    cloid: wire.c ?? "",
  }));
}

export interface TpslInput {
  /** Take-profit trigger price. */
  readonly tp?: string | number | null;
  /** Stop-loss trigger price. */
  readonly sl?: string | number | null;
  /** Execute triggers at market (default) or as limits at the trigger price. */
  readonly isMarket?: boolean;
}

/**
 * Reduce-only TP/SL triggers that close a position of `entrySide`: they sell
 * a long and buy back a short. `reference` is the entry (or mark) they must
 * sit on the right side of.
 */
export function tpslWires(market: MarketInfo, entrySide: Side, size: string, reference: number, input: TpslInput, cloid: () => string = newCloid): { readonly wires: OrderWire[]; readonly roles: OrderLeg["role"][] } {
  const closeIsBuy = entrySide === "sell";
  const isMarket = input.isMarket !== false;
  const wires: OrderWire[] = [];
  const roles: OrderLeg["role"][] = [];
  for (const kind of ["tp", "sl"] as const) {
    const raw = kind === "tp" ? input.tp : input.sl;
    if (raw === undefined || raw === null || raw === "") continue;
    const trigger = roundPrice(positive(raw, kind, kind === "tp" ? "take-profit price" : "stop price"), market.szDecimals, market.isSpot, "nearest");
    const triggerNum = Number(trigger);
    const long = entrySide === "buy";
    if (kind === "tp" && (long ? triggerNum <= reference : triggerNum >= reference)) {
      throw new TicketError("tp", `A take profit for a ${long ? "long" : "short"} must be ${long ? "above" : "below"} ${reference.toPrecision(6)}.`);
    }
    if (kind === "sl" && (long ? triggerNum >= reference : triggerNum <= reference)) {
      throw new TicketError("sl", `A stop loss for a ${long ? "long" : "short"} must be ${long ? "below" : "above"} ${reference.toPrecision(6)}.`);
    }
    // A market trigger still carries a limit: the trigger price +/- HyperCore's market slippage, rounded toward the trigger.
    const limit = isMarket
      ? marketPrice({ mid: trigger, isBuy: closeIsBuy, slippageBps: TRIGGER_MARKET_SLIPPAGE_BPS, szDecimals: market.szDecimals, isSpot: market.isSpot })
      : trigger;
    wires.push(
      wrapWire(
        () =>
          orderWireFor(market, {
            isBuy: closeIsBuy,
            price: limit,
            size,
            reduceOnly: true,
            kind: { trigger: { isMarket, triggerPx: trigger, tpsl: kind } },
            cloid: cloid(),
          }),
        kind,
      ),
    );
    roles.push(kind);
  }
  return { wires, roles };
}

export interface EntryInput {
  readonly market: MarketInfo;
  readonly side: Side;
  /** Base size (rounded down to lots here). */
  readonly size: string | number;
  readonly reduceOnly?: boolean;
  readonly tpsl?: TpslInput;
  readonly builder?: BuilderFee;
  readonly cloid?: () => string;
}

function entryWithTpsl(input: EntryInput, entry: OrderWire, reference: number): BuiltOrder {
  const cloid = input.cloid ?? newCloid;
  const { wires, roles } = input.tpsl && !input.market.isSpot ? tpslWires(input.market, input.side, entry.s, reference, input.tpsl, cloid) : { wires: [], roles: [] };
  const grouping: OrderGrouping = wires.length > 0 ? "normalTpsl" : "na";
  const all = [entry, ...wires];
  const action = orderAction(all, { grouping, ...(input.builder ? { builder: input.builder } : {}) });
  return { action, legs: legsOf(action.orders, ["entry", ...roles]), notional: Number(entry.s) * Number(entry.p), grouping };
}

/** "Market": an IOC limit at mid +/- slippage (rounded toward the mid). */
export function marketOrder(input: EntryInput & { readonly mid: string | number; readonly slippageBps: number }): BuiltOrder {
  const size = lotSize(input.size, input.market);
  const mid = positive(input.mid, "price", "mid price");
  const isBuy = input.side === "buy";
  const px = wrapWire(() => marketPrice({ mid, isBuy, slippageBps: input.slippageBps, szDecimals: input.market.szDecimals, isSpot: input.market.isSpot }), "price");
  if (!input.reduceOnly) assertMinNotional(size, mid);
  const entry = wrapWire(
    () => orderWireFor(input.market, { isBuy, price: px, size, reduceOnly: input.reduceOnly === true, kind: { limit: { tif: "Ioc" } }, cloid: (input.cloid ?? newCloid)() }),
    "price",
  );
  return entryWithTpsl(input, entry, Number(mid));
}

/** Limit order (GTC, post-only ALO, or IOC). */
export function limitOrder(input: EntryInput & { readonly price: string | number; readonly tif: Tif }): BuiltOrder {
  const size = lotSize(input.size, input.market);
  const px = tickPrice(input.price, input.market, input.side);
  if (!input.reduceOnly) assertMinNotional(size, px);
  const entry = wrapWire(
    () => orderWireFor(input.market, { isBuy: input.side === "buy", price: px, size, reduceOnly: input.reduceOnly === true, kind: { limit: { tif: input.tif } }, cloid: (input.cloid ?? newCloid)() }),
    "price",
  );
  return entryWithTpsl(input, entry, Number(px));
}

/** Position TP/SL: triggers that follow the whole position (grouping positionTpsl). */
export function positionTpslOrder(input: { readonly market: MarketInfo; readonly szi: string | number; readonly reference: number; readonly tpsl: TpslInput; readonly cloid?: () => string }): BuiltOrder {
  const signed = Number(text(input.szi));
  if (!Number.isFinite(signed) || signed === 0) throw new TicketError("size", "There is no position to protect.");
  const side: Side = signed > 0 ? "buy" : "sell";
  const size = roundSize(numberToPlainString(Math.abs(signed)), input.market.szDecimals, "down");
  const { wires, roles } = tpslWires(input.market, side, size, input.reference, input.tpsl, input.cloid ?? newCloid);
  if (wires.length === 0) throw new TicketError("tp", "Set a take-profit or a stop-loss price.");
  const action = orderAction(wires, { grouping: "positionTpsl" });
  return { action, legs: legsOf(action.orders, roles), notional: 0, grouping: "positionTpsl" };
}

/**
 * Closes all (or a fraction of) a position at market: a reduce-only IOC on
 * the other side at mid +/- slippage.
 */
export function closePositionOrder(input: { readonly market: MarketInfo; readonly szi: string | number; readonly mid: string | number; readonly slippageBps: number; readonly fraction?: number; readonly cloid?: () => string }): BuiltOrder {
  const signed = Number(text(input.szi));
  if (!Number.isFinite(signed) || signed === 0) throw new TicketError("size", "There is no position to close.");
  const fraction = input.fraction ?? 1;
  if (!(fraction > 0 && fraction <= 1)) throw new TicketError("size", "Close between 0% and 100% of the position.");
  const abs = Math.abs(signed);
  const size = fraction === 1 ? roundSize(numberToPlainString(abs), input.market.szDecimals, "down") : roundSize(numberToPlainString(abs * fraction), input.market.szDecimals, "down");
  if (Number(size) <= 0) throw new TicketError("size", "That part of the position is smaller than one lot.");
  const isBuy = signed < 0;
  const mid = positive(input.mid, "price", "mid price");
  const px = wrapWire(() => marketPrice({ mid, isBuy, slippageBps: input.slippageBps, szDecimals: input.market.szDecimals, isSpot: input.market.isSpot }), "price");
  const wire = wrapWire(() => orderWireFor(input.market, { isBuy, price: px, size, reduceOnly: true, kind: { limit: { tif: "Ioc" } }, cloid: (input.cloid ?? newCloid)() }), "price");
  const action = orderAction([wire]);
  return { action, legs: legsOf(action.orders, ["close"]), notional: 0, grouping: "na" };
}

export interface ScaleInput {
  readonly market: MarketInfo;
  readonly side: Side;
  readonly totalSize: string | number;
  /** First and last price of the ladder (either order). */
  readonly from: string | number;
  readonly to: string | number;
  readonly count: number;
  readonly skew: ScaleSkew;
  readonly tif?: Tif;
  readonly reduceOnly?: boolean;
  readonly builder?: BuilderFee;
  readonly cloid?: () => string;
}

/** Whole lots back to a wire size ("0.25", "3"). */
export function lotsToSize(lots: bigint, decimals: number): string {
  if (decimals === 0) return lots.toString();
  const base = 10n ** BigInt(decimals);
  const fraction = (lots % base).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fraction ? `${lots / base}.${fraction}` : `${lots / base}`;
}

/** A ladder of limit orders in one batch. */
export function scaleOrder(input: ScaleInput): BuiltOrder {
  const total = lotSize(input.totalSize, input.market);
  const from = Number(positive(input.from, "scale", "start price"));
  const to = Number(positive(input.to, "scale", "end price"));
  if (from === to) throw new TicketError("scale", "Set two different prices for the ladder.");
  let weights: number[];
  try {
    weights = scaleWeights(input.count, input.skew);
  } catch (error) {
    throw new TicketError("scale", error instanceof Error ? error.message : "Invalid number of orders.");
  }
  const lotsPerUnit = 10n ** BigInt(input.market.szDecimals);
  const [whole = "0", fraction = ""] = total.split(".");
  const totalLots = BigInt(whole) * lotsPerUnit + BigInt((fraction + "0".repeat(input.market.szDecimals)).slice(0, input.market.szDecimals) || "0");
  const lots = splitLots(totalLots, weights);
  const prices = ladderPrices(from, to, input.count).map((px) => tickPrice(numberToPlainString(Number(px.toPrecision(12))), input.market, input.side));
  if (new Set(prices).size !== prices.length) throw new TicketError("scale", "The prices are too close together for this many orders. Widen the range or use fewer orders.");
  const cloid = input.cloid ?? newCloid;
  const wires: OrderWire[] = [];
  lots.forEach((lot, index) => {
    if (lot <= 0n) throw new TicketError("scale", "Some orders would be smaller than one lot. Use fewer orders or a larger size.");
    const sz = lotsToSize(lot, input.market.szDecimals);
    const px = prices[index] as string;
    if (!input.reduceOnly && Number(sz) * Number(px) < MIN_ORDER_NOTIONAL) {
      throw new TicketError("scale", `Each order must be worth at least $${MIN_ORDER_NOTIONAL}; order ${index + 1} would be $${(Number(sz) * Number(px)).toFixed(2)}. Use fewer orders or a larger size.`);
    }
    wires.push(
      wrapWire(
        () => orderWireFor(input.market, { isBuy: input.side === "buy", price: px, size: sz, reduceOnly: input.reduceOnly === true, kind: { limit: { tif: input.tif ?? "Gtc" } }, cloid: cloid() }),
        "scale",
      ),
    );
  });
  const action = orderAction(wires, input.builder ? { builder: input.builder } : {});
  return {
    action,
    legs: legsOf(action.orders, wires.map(() => "ladder")),
    notional: action.orders.reduce((sum, wire) => sum + Number(wire.s) * Number(wire.p), 0),
    grouping: "na",
  };
}

/** TWAP: HyperCore slices it (every 30 s, at most 3% slippage per slice). */
export function twapOrder(input: { readonly market: MarketInfo; readonly side: Side; readonly size: string | number; readonly minutes: number; readonly randomize: boolean; readonly reduceOnly?: boolean; readonly referencePx?: number | null }): TwapOrderAction {
  const size = lotSize(input.size, input.market);
  if (!Number.isInteger(input.minutes) || input.minutes < TWAP_MIN_MINUTES || input.minutes > TWAP_MAX_MINUTES) {
    throw new TicketError("twap", `A TWAP runs ${TWAP_MIN_MINUTES} to ${TWAP_MAX_MINUTES} minutes.`);
  }
  if (!input.reduceOnly && input.referencePx !== undefined && input.referencePx !== null && Number(size) * input.referencePx < MIN_TWAP_NOTIONAL) {
    throw new TicketError("size", `A TWAP must be worth at least $${MIN_TWAP_NOTIONAL}. Increase the size.`);
  }
  return twapOrderAction({ asset: input.market.asset, isBuy: input.side === "buy", size, reduceOnly: input.reduceOnly === true, minutes: input.minutes, randomize: input.randomize });
}

/** Leverage (and margin mode) for a perp; isolated-only markets refuse cross. */
export function leverageAction(market: MarketInfo, leverage: number, isCross: boolean): UpdateLeverageAction {
  if (market.isSpot) throw new TicketError("leverage", "Spot has no leverage.");
  if (!Number.isInteger(leverage) || leverage < 1) throw new TicketError("leverage", "Leverage is a whole number of at least 1.");
  if (market.maxLeverage !== null && leverage > market.maxLeverage) throw new TicketError("leverage", `${market.displayName} allows at most ${market.maxLeverage}x.`);
  if (isCross && market.onlyIsolated) throw new TicketError("leverage", `${market.displayName} trades isolated margin only.`);
  return updateLeverageAction(market.asset, isCross, leverage);
}

/**
 * Adds margin to (or removes it from) an isolated position: `amountUsd` is a
 * positive USD amount; "remove" sends it negative. HyperCore refuses a
 * removal that would breach the initial margin.
 */
export function isolatedMarginAction(market: MarketInfo, amountUsd: string | number, direction: "add" | "remove"): UpdateIsolatedMarginAction {
  if (market.isSpot) throw new TicketError("market", "Spot has no margin to adjust.");
  const raw = positive(amountUsd, "size", "USD amount");
  let micros: number;
  try {
    micros = usdToMicros(raw);
  } catch (error) {
    throw new TicketError("size", error instanceof Error ? error.message : "The amount is not valid.");
  }
  if (micros < 1) throw new TicketError("size", "Enter an amount of at least $0.000001.");
  return updateIsolatedMarginAction(market.asset, direction === "add" ? micros : -micros);
}

export interface OpenOrderRef {
  readonly asset: number;
  readonly oid: number;
}

/** Cancels many orders in one action (null when there is nothing to cancel). */
export function cancelOrders(orders: readonly OpenOrderRef[]): CancelAction | null {
  if (orders.length === 0) return null;
  return cancelAction(orders.map((order) => ({ asset: order.asset, oid: order.oid })));
}

export function cancelTwap(asset: number, twapId: number): TwapCancelAction {
  return twapCancelAction(asset, twapId);
}

export interface FlattenPosition {
  readonly market: MarketInfo;
  readonly szi: string;
  readonly mid: string | number | null;
}

export interface FlattenPlan {
  readonly cancel: CancelAction | null;
  /** One batch of reduce-only IOC closes (null when there is no position). */
  readonly close: BuiltOrder | null;
  /** Positions that could not be closed here, with the reason. */
  readonly skipped: readonly { readonly coin: string; readonly reason: string }[];
}

/**
 * "Flatten all": cancel every open order first (so nothing re-opens risk),
 * then close every position with reduce-only IOC orders in one batch.
 */
export function flattenPlan(input: { readonly orders: readonly OpenOrderRef[]; readonly positions: readonly FlattenPosition[]; readonly slippageBps: number; readonly cloid?: () => string }): FlattenPlan {
  const skipped: { coin: string; reason: string }[] = [];
  const wires: OrderWire[] = [];
  for (const position of input.positions) {
    if (Number(position.szi) === 0) continue;
    if (position.mid === null || position.mid === undefined || Number(position.mid) <= 0) {
      skipped.push({ coin: position.market.displayName, reason: "no live price" });
      continue;
    }
    try {
      const built = closePositionOrder({ market: position.market, szi: position.szi, mid: position.mid, slippageBps: input.slippageBps, ...(input.cloid ? { cloid: input.cloid } : {}) });
      wires.push(...built.action.orders);
    } catch (error) {
      skipped.push({ coin: position.market.displayName, reason: error instanceof Error ? error.message : "could not build the close" });
    }
  }
  const close = wires.length > 0 ? (() => {
    const action = orderAction(wires);
    return { action, legs: legsOf(action.orders, wires.map(() => "close")), notional: 0, grouping: "na" as const };
  })() : null;
  return { cancel: cancelOrders(input.orders), close, skipped };
}

/** An open trigger order as the feeds show it (frontendOpenOrders fields). */
export interface TriggerOrderRef {
  readonly coin: string;
  readonly oid: number;
  readonly isTrigger: boolean;
  readonly reduceOnly: boolean;
  readonly orderType: string;
}

/** "tp" / "sl" for a TP/SL trigger order, from HyperCore's order type label; null otherwise. */
export function triggerKind(order: Pick<TriggerOrderRef, "isTrigger" | "orderType">): "tp" | "sl" | null {
  if (!order.isTrigger) return null;
  if (/^take profit/iu.test(order.orderType)) return "tp";
  if (/^stop/iu.test(order.orderType)) return "sl";
  return null;
}

export interface ModifyTpslPlan {
  /** The new position TP/SL (placed first, so the position is never unprotected). */
  readonly place: BuiltOrder;
  /** The old reduce-only triggers of the same kinds, cancelled after the new ones are in (null when none). */
  readonly cancel: CancelAction | null;
  readonly replaced: readonly number[];
}

/**
 * Moves a position's TP and/or SL: place the new positionTpsl triggers,
 * then cancel the old reduce-only triggers of the kinds being replaced.
 * Placing first leaves a brief overlap of two reduce-only triggers (harmless:
 * they can only shrink the position) instead of a gap with none.
 */
export function modifyTpslPlan(input: { readonly market: MarketInfo; readonly szi: string | number; readonly reference: number; readonly tpsl: TpslInput; readonly openOrders: readonly TriggerOrderRef[]; readonly cloid?: () => string }): ModifyTpslPlan {
  const place = positionTpslOrder({ market: input.market, szi: input.szi, reference: input.reference, tpsl: input.tpsl, ...(input.cloid ? { cloid: input.cloid } : {}) });
  const kinds = new Set(place.legs.map((leg) => leg.role));
  const old = input.openOrders.filter((order) => order.coin === input.market.coin && order.reduceOnly && kinds.has(triggerKind(order) ?? "entry"));
  return { place, cancel: cancelOrders(old.map((order) => ({ asset: input.market.asset, oid: order.oid }))), replaced: old.map((order) => order.oid) };
}
