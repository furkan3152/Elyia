/**
 * The order ticket as a plan (pure): what the user typed becomes the L1
 * actions to sign (an updateLeverage when the leverage or margin mode
 * changes, then the order), the button label and a preview (size,
 * notional, margin, estimated liquidation, fees, average price of a
 * ladder). Errors come back in plain words with the field they concern.
 */
import type { L1Action, Tif } from "@elyia/core/hypercore/actions";
import { numberToPlainString } from "@elyia/core/hypercore/wire";

import type { TradeMarket } from "../../lib/hypercore/marketCatalog";
import { formatPx } from "../../lib/hypercore/marketCatalog";
import type { TradePlan } from "./executor";
import { estimateLiquidation } from "./liquidation";
import { leverageAction, limitOrder, marketOrder, scaleOrder, TicketError, twapOrder, type BuiltOrder, type OrderLeg, type Side } from "./orderBuilders";
import { averagePrice, type ScaleSkew } from "./scale";
import { baseSize, feeFor, marginRequired, priceForRoe, type FeeRates, type SizeUnit } from "./ticketMath";
import type { OrderKind, TpslUnit } from "./tradeStore";

export interface TicketInput {
  readonly market: TradeMarket;
  readonly side: Side;
  readonly kind: OrderKind;
  readonly tif: Tif;
  readonly amount: string;
  readonly sizeUnit: SizeUnit;
  readonly price: string;
  /** Leverage on the slider (perps). */
  readonly leverage: number;
  readonly marginMode: "cross" | "isolated";
  /** The account's current leverage and mode on this market (null when unknown or not connected). */
  readonly current: { readonly leverage: number; readonly mode: "cross" | "isolated" } | null;
  readonly reduceOnly: boolean;
  readonly tpslOn: boolean;
  readonly tpslUnit: TpslUnit;
  readonly tp: string;
  readonly sl: string;
  readonly twapMinutes: string;
  readonly twapRandomize: boolean;
  readonly scaleFrom: string;
  readonly scaleTo: string;
  readonly scaleCount: string;
  readonly scaleSkew: ScaleSkew;
  readonly mid: number | null;
  readonly slippageBps: number;
  readonly accountValue: number | null;
  readonly otherMaintenance: number | null;
  readonly fees: FeeRates;
  readonly cloid?: () => string;
}

export interface TicketPreview {
  /** Base size the order would carry. */
  readonly size: string | null;
  readonly notional: number | null;
  readonly margin: number | null;
  readonly liquidation: number | null;
  readonly fee: number | null;
  /** Reference entry (limit price, mid for market and TWAP, ladder average for scale). */
  readonly entryPx: number | null;
  readonly tpPx: number | null;
  readonly slPx: number | null;
  readonly legs: readonly OrderLeg[];
  /** True when the order takes liquidity (market, IOC, TWAP slices). */
  readonly takes: boolean;
}

export interface TicketPlanResult {
  readonly plan: TradePlan | null;
  readonly preview: TicketPreview;
  readonly error: { readonly field: TicketError["field"]; readonly message: string } | null;
  /** "Long ETH 5× · 1,000 USDC". */
  readonly buttonLabel: string;
}

const EMPTY_PREVIEW: TicketPreview = { size: null, notional: null, margin: null, liquidation: null, fee: null, entryPx: null, tpPx: null, slPx: null, legs: [], takes: false };

function amountLabel(input: TicketInput, size: string | null): string {
  if (!input.amount) return "";
  if (input.sizeUnit === "usd") return `${Number(input.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${input.market.isSpot ? input.market.quote : "USDC"}`;
  return `${size ?? input.amount} ${input.market.base}`;
}

function verb(input: TicketInput): string {
  if (input.market.isSpot) return input.side === "buy" ? "Buy" : "Sell";
  if (input.reduceOnly) return input.side === "buy" ? "Close short" : "Close long";
  return input.side === "buy" ? "Long" : "Short";
}

function triggerPrice(input: TicketInput, kind: "tp" | "sl", entry: number | null): string | null {
  const raw = kind === "tp" ? input.tp : input.sl;
  if (!input.tpslOn || !raw || input.market.isSpot) return null;
  if (input.tpslUnit === "price") return raw;
  if (entry === null) return null;
  const px = priceForRoe({ entryPx: entry, isLong: input.side === "buy", roePct: Number(raw), leverage: input.leverage, kind });
  return px === null ? null : numberToPlainString(Number(px.toPrecision(10)));
}

export function planTicket(input: TicketInput): TicketPlanResult {
  const market = input.market;
  const isBuy = input.side === "buy";
  const leverageText = market.isSpot ? "" : ` ${input.leverage}×`;
  const baseLabel = `${verb(input)} ${market.isSpot ? market.displayName : market.base}${input.reduceOnly ? "" : leverageText}`;
  const refPx = input.kind === "limit" ? (Number(input.price) > 0 ? Number(input.price) : null) : input.kind === "scale" ? null : input.mid;
  const size = input.kind === "scale" ? null : baseSize({ amount: input.amount, unit: input.sizeUnit, px: refPx, szDecimals: market.szDecimals });
  const label = (sz: string | null) => {
    const amount = amountLabel(input, sz);
    return amount ? `${baseLabel} · ${amount}` : baseLabel;
  };
  const fail = (field: TicketError["field"], message: string, preview: TicketPreview = EMPTY_PREVIEW): TicketPlanResult => ({ plan: null, preview, error: { field, message }, buttonLabel: label(size) });

  if (market.isDelisted) return fail("market", `${market.displayName} is delisted.`);
  if (!input.amount && input.kind !== "scale") return { plan: null, preview: EMPTY_PREVIEW, error: null, buttonLabel: label(null) };

  const actions: L1Action[] = [];
  const plannedLeverage: Record<string, number> = {};
  if (!market.isSpot && !input.reduceOnly) {
    const mode = market.onlyIsolated ? "isolated" : input.marginMode;
    const changes = !input.current || input.current.leverage !== input.leverage || input.current.mode !== mode;
    if (changes) {
      try {
        actions.push(leverageAction(market, input.leverage, mode === "cross"));
      } catch (error) {
        return fail("leverage", error instanceof Error ? error.message : "Leverage is not valid.");
      }
    }
    plannedLeverage[market.coin] = input.leverage;
  }

  let built: BuiltOrder | null = null;
  let twapSize: string | null = null;
  try {
    if (input.kind === "market") {
      if (input.mid === null) return fail("price", "Waiting for a live price.");
      const tp = triggerPrice(input, "tp", input.mid);
      const sl = triggerPrice(input, "sl", input.mid);
      built = marketOrder({ market, side: input.side, size: input.amount === "" ? "0" : (size ?? "0"), mid: numberToPlainString(input.mid), slippageBps: input.slippageBps, reduceOnly: input.reduceOnly, tpsl: tp || sl ? { tp, sl } : undefined, ...(input.cloid ? { cloid: input.cloid } : {}) });
    } else if (input.kind === "limit") {
      if (!input.price) return fail("price", "Enter a limit price (or click one on the book or chart).");
      const tp = triggerPrice(input, "tp", refPx);
      const sl = triggerPrice(input, "sl", refPx);
      built = limitOrder({ market, side: input.side, size: size ?? "0", price: input.price, tif: input.tif, reduceOnly: input.reduceOnly, tpsl: tp || sl ? { tp, sl } : undefined, ...(input.cloid ? { cloid: input.cloid } : {}) });
    } else if (input.kind === "scale") {
      const count = Number(input.scaleCount);
      const lo = Number(input.scaleFrom);
      const hi = Number(input.scaleTo);
      const avgRef = lo > 0 && hi > 0 ? (lo + hi) / 2 : input.mid;
      const total = baseSize({ amount: input.amount, unit: input.sizeUnit, px: avgRef, szDecimals: market.szDecimals });
      if (!input.amount) return { plan: null, preview: EMPTY_PREVIEW, error: null, buttonLabel: label(null) };
      if (!input.scaleFrom || !input.scaleTo) return fail("scale", "Set the first and last price of the ladder.");
      built = scaleOrder({ market, side: input.side, totalSize: total ?? "0", from: input.scaleFrom, to: input.scaleTo, count, skew: input.scaleSkew, tif: input.tif === "Ioc" ? "Gtc" : input.tif, reduceOnly: input.reduceOnly, ...(input.cloid ? { cloid: input.cloid } : {}) });
    } else {
      const minutes = Number(input.twapMinutes);
      twapSize = size;
      actions.push(twapOrder({ market, side: input.side, size: size ?? "0", minutes, randomize: input.twapRandomize, reduceOnly: input.reduceOnly, referencePx: input.mid }));
    }
  } catch (error) {
    if (error instanceof TicketError) return fail(error.field, error.message);
    return fail("size", error instanceof Error ? error.message : "This order cannot be built.");
  }
  if (built) actions.push(built.action);

  const entryLegs = built ? built.legs.filter((leg) => leg.role === "entry" || leg.role === "ladder") : [];
  const entryPx =
    input.kind === "scale"
      ? averagePrice(entryLegs.map((leg) => ({ px: Number(leg.px), sz: Number(leg.sz) })))
      : input.kind === "limit"
        ? Number(built?.legs[0]?.px ?? refPx)
        : input.mid;
  const orderSize = input.kind === "twap" ? twapSize : input.kind === "scale" ? String(entryLegs.reduce((sum, leg) => sum + Number(leg.sz), 0)) : (built?.legs[0]?.sz ?? size);
  const notional = orderSize !== null && entryPx !== null ? Number(orderSize) * entryPx : null;
  const takes = input.kind === "market" || input.kind === "twap" || (input.kind === "limit" && input.tif === "Ioc");
  const liquidation =
    !market.isSpot && !input.reduceOnly && entryPx !== null && orderSize !== null && market.maxLeverage
      ? estimateLiquidation({
          side: isBuy ? 1 : -1,
          entryPx,
          size: Number(orderSize),
          leverage: input.leverage,
          maxLeverage: market.maxLeverage,
          marginMode: market.onlyIsolated ? "isolated" : input.marginMode,
          accountValue: input.accountValue,
          otherMaintenance: input.otherMaintenance,
        })
      : null;
  const tpLeg = built?.legs.find((leg) => leg.role === "tp");
  const slLeg = built?.legs.find((leg) => leg.role === "sl");
  const preview: TicketPreview = {
    size: orderSize,
    notional,
    margin: notional !== null ? (market.isSpot ? notional : marginRequired(notional, input.leverage)) : null,
    liquidation,
    fee: notional !== null ? feeFor(notional, input.fees, takes) : null,
    entryPx,
    tpPx: tpLeg?.triggerPx ? Number(tpLeg.triggerPx) : null,
    slPx: slLeg?.triggerPx ? Number(slLeg.triggerPx) : null,
    legs: built?.legs ?? [],
    takes,
  };
  const where = input.kind === "market" ? "at market" : input.kind === "limit" ? `at ${formatPx(entryPx, market)}` : input.kind === "scale" ? `in ${entryLegs.length} orders` : `over ${input.twapMinutes} min`;
  const plan: TradePlan = {
    label: `${verb(input)} ${orderSize ?? ""} ${market.isSpot ? market.base : market.base} ${where}`.replace(/\s+/gu, " ").trim(),
    actions,
    ...(built ? { legs: built.legs } : {}),
    coin: market.coin,
    marketSlippageBps: input.kind === "market" ? input.slippageBps : null,
    plannedLeverage,
  };
  return { plan, preview, error: null, buttonLabel: label(orderSize) };
}
