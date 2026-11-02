/**
 * HyperCore trading through L1 actions signed by the user's trade-only
 * agent key (in the browser, or the opt-in Keeper): orders (IOC "market"
 * at mid +/- slippage on a valid tick, limits, standalone TP/SL triggers,
 * entries with `normalTpsl` children), cancels (by oid or cloid), TWAP,
 * leverage, isolated margin and the dead man's switch.
 *
 * Every payload carries fresh cloids, a fresh monotonic nonce and
 * `expiresAfter` = prepare + 90 s, so a leaked signature dies quickly and
 * every order is addressable for verification exactly like a tx hash.
 */
import {
  applySlippage,
  compareDecimal,
  hypercore,
  marginAssetId,
  perpAssetId,
  spotAssetId,
  toBaseUnitsBig,
  type OrderSnapshot,
  type StepAmount,
} from "@elyia/core";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { assertMinNotional, divDecimal, lotSize, marketFor, midOf, mulDecimal, type MarketView } from "../hypercore/markets.js";
import { l1Request, L1_EXPIRY_MS } from "../hypercore/requests.js";
import { attributeL1, decimalUnits, isPreparedMatch, L1_EFFECT_STALE_MS, orderOutcome, pendingResult, verifyOrder } from "../hypercore/verify.js";
import { ReferencePrices } from "../prices.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type TradeRequest, type VerificationResult, type VerifyContext } from "../types.js";
import { failed } from "../verify.js";
import { stepAddress } from "../assets.js";

/** Most slippage an IOC "market" order may encode. */
export const MAX_ORDER_SLIPPAGE_BPS = 1_000;
/** Trigger "market" orders execute up to this far past the trigger (HyperCore's own UI uses 10%). */
export const TRIGGER_MARKET_SLIPPAGE_BPS = 1_000;
/** Conservative spot taker fee kept out of a buy's guaranteed output. */
const SPOT_FEE_BPS = 10;

const TRADE_KINDS = new Set(["order", "cancel", "leverage", "twap", "margin"]);

function priceRounding(isBuy: boolean): "down" | "up" {
  // A limit never ends up more aggressive than asked: buys round down, sells up.
  return isBuy ? "down" : "up";
}

function offsetPrice(px: string, bps: number, up: boolean, market: MarketView): string {
  const factor = (10_000 + (up ? bps : -bps)).toString();
  return hypercore.roundPrice(divDecimal(mulDecimal(px, factor), "10000", 12), market.szDecimals, market.isSpot, up ? "up" : "down");
}

/** Absolute price from a price string or a percent offset (`-3%` / `3%`) relative to `reference`. */
function priceFrom(value: string | undefined, pct: unknown, reference: string, longSide: boolean, kind: "tp" | "sl", market: MarketView): string | undefined {
  if (value !== undefined) return hypercore.roundPrice(value, market.szDecimals, market.isSpot, "nearest");
  if (pct === undefined) return undefined;
  const percent = Number(String(pct).replace("%", "").replace("-", ""));
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) throw engineError("ORDER_PRICE_INVALID", "TP/SL offsets are percentages between 0 and 100.");
  const bps = Math.round(percent * 100);
  // Long: TP above, SL below. Short: the reverse.
  const up = kind === "tp" ? longSide : !longSide;
  return offsetPrice(reference, bps, up, market);
}

interface OrderPlan {
  readonly market: MarketView;
  readonly snapshot: OrderSnapshot;
  readonly mid: string;
  readonly warnings: string[];
}

function triggerOrder(market: MarketView, isBuy: boolean, sz: string, triggerPx: string, tpsl: "tp" | "sl", isMarket: boolean, grouping: hypercore.OrderGrouping, cloid: hypercore.Cloid): OrderSnapshot {
  const limitPx = isMarket ? offsetPrice(triggerPx, TRIGGER_MARKET_SLIPPAGE_BPS, isBuy, market) : triggerPx;
  return {
    market: market.coin,
    displayName: market.displayName,
    marketKind: market.isSpot ? "spot" : "perp",
    assetIndex: market.asset,
    side: isBuy ? "buy" : "sell",
    sz,
    limitPx,
    tif: null,
    reduceOnly: true,
    cloid,
    trigger: { triggerPx, isMarket, tpsl },
    grouping,
  };
}

/** Builds the order snapshot (entry and TP/SL children) from the request and a fresh mid. */
export async function planOrder(deps: EngineDeps, action: Pick<AdapterAction, "network" | "trade" | "slippageBps" | "params" | "amount" | "funded">, mid: string | null = null): Promise<OrderPlan> {
  const trade = action.trade as TradeRequest;
  const kind = action.params.marketKind === "spot" ? "spot" : action.params.marketKind === "perp" ? "perp" : undefined;
  const market = await marketFor(deps, action.network, trade.market, kind);
  const current = mid ?? (await midOf(deps, action.network, market));
  const warnings: string[] = [];
  const cloid = () => hypercore.newCloid(deps.random);

  // Standalone TP/SL: always reduce-only (HyperCore refuses non-reduce-only standalone triggers).
  if (trade.trigger) {
    if (!trade.size) throw engineError("ORDER_SIZE_INVALID", "A standalone TP/SL needs the size it protects.");
    const isBuy = trade.side === "buy";
    const { sz } = lotSize(trade.size, market);
    const triggerPx = hypercore.roundPrice(trade.trigger.price, market.szDecimals, market.isSpot, "nearest");
    const snapshot = triggerOrder(market, isBuy, sz, triggerPx, trade.trigger.kind, trade.trigger.isMarket, "na", cloid());
    return { market, snapshot, mid: current, warnings };
  }

  const isBuy = trade.side === "buy";
  const slippageBps = Math.max(1, Math.min(action.slippageBps, MAX_ORDER_SLIPPAGE_BPS));
  const limit = trade.price !== undefined;
  const limitPx = limit
    ? hypercore.roundPrice(trade.price as string, market.szDecimals, market.isSpot, priceRounding(isBuy))
    : hypercore.marketPrice({ mid: current, isBuy, slippageBps, szDecimals: market.szDecimals, isSpot: market.isSpot });
  if (limit && compareDecimal(limitPx, trade.price as string) !== 0) warnings.push(`Limit price rounded to the HyperCore tick: ${limitPx}.`);

  // Size: base size, or from USD notional / margin x leverage, or from a funded amount.
  let size: string | undefined = trade.size;
  if (size === undefined && action.funded && action.amount > 0n) {
    if (market.isSpot && isBuy && market.quote) size = divDecimal(unitsToDecimal(action.amount, market.quote.weiDecimals), limitPx, market.szDecimals);
    else if (market.isSpot && !isBuy && market.base) size = unitsToDecimal(action.amount, market.base.weiDecimals);
  }
  const notionalUsd = typeof action.params.notionalUsd === "string" ? action.params.notionalUsd : typeof action.params.marginUsd === "string" && trade.leverage ? mulDecimal(action.params.marginUsd, String(trade.leverage.value)) : undefined;
  if (size === undefined && notionalUsd !== undefined) size = divDecimal(notionalUsd, limit ? limitPx : current, market.szDecimals);
  if (size === undefined && market.isSpot && isBuy && typeof action.params.quoteAmount === "string") size = divDecimal(action.params.quoteAmount, limitPx, market.szDecimals);
  if (size === undefined) throw engineError("ORDER_SIZE_INVALID", "How much? Give a size, a USD notional or a margin with leverage.");
  const lot = lotSize(size, market);
  if (lot.rounded) warnings.push(`Size rounded down to the ${market.displayName} lot: ${lot.sz}.`);
  assertMinNotional(lot.sz, limit ? limitPx : current, market);

  const tif: hypercore.Tif = limit ? trade.tif ?? "Gtc" : "Ioc";
  const longSide = isBuy;
  const reference = limit ? limitPx : current;
  const tp = priceFrom(trade.takeProfit, action.params.takeProfitPct, reference, longSide, "tp", market);
  const sl = priceFrom(trade.stopLoss, action.params.stopLossPct, reference, longSide, "sl", market);
  if ((tp || sl) && market.isSpot) throw engineError("ROUTE_UNSUPPORTED", "TP/SL children are for perp entries; place spot trigger orders separately.");
  const grouping: hypercore.OrderGrouping = tp || sl ? "normalTpsl" : "na";
  const children: OrderSnapshot[] = [];
  if (tp) children.push(triggerOrder(market, !isBuy, lot.sz, tp, "tp", true, grouping, cloid()));
  if (sl) children.push(triggerOrder(market, !isBuy, lot.sz, sl, "sl", true, grouping, cloid()));
  const notional = mulDecimal(lot.sz, limitPx);
  const snapshot: OrderSnapshot = {
    market: market.coin,
    displayName: market.displayName,
    marketKind: market.isSpot ? "spot" : "perp",
    assetIndex: market.asset,
    side: isBuy ? "buy" : "sell",
    sz: lot.sz,
    limitPx,
    tif,
    reduceOnly: trade.reduceOnly === true,
    cloid: cloid(),
    grouping,
    ...(limit ? {} : { worstPx: limitPx }),
    ...(trade.leverage && !market.isSpot ? { leverage: { value: trade.leverage.value, mode: trade.leverage.mode } } : {}),
    notionalUsd: market.isSpot ? null : truncate2(notional),
    ...(children.length > 0 ? { children } : {}),
  };
  return { market, snapshot, mid: current, warnings };
}

function truncate2(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 2)}` : whole;
}

export function unitsToDecimal(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString();
  const digits = units.toString().padStart(decimals + 1, "0");
  const out = `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`.replace(/\.?0+$/u, "");
  return out === "" ? "0" : out;
}

/** The order wire of a snapshot (exact key order through core builders). */
export function wireOf(snapshot: OrderSnapshot): hypercore.OrderWire {
  return hypercore.orderWire({
    asset: snapshot.assetIndex,
    isBuy: snapshot.side === "buy",
    price: snapshot.limitPx,
    size: snapshot.sz,
    reduceOnly: snapshot.reduceOnly,
    kind: snapshot.trigger ? { trigger: { isMarket: snapshot.trigger.isMarket, triggerPx: snapshot.trigger.triggerPx, tpsl: snapshot.trigger.tpsl } } : { limit: { tif: snapshot.tif ?? "Gtc" } },
    cloid: snapshot.cloid,
  });
}

export function orderActionOf(snapshot: OrderSnapshot): hypercore.OrderAction {
  return hypercore.orderAction([wireOf(snapshot), ...(snapshot.children ?? []).map(wireOf)], { grouping: snapshot.grouping });
}

/** Step amounts of an order: perps move a position; spot spends one token for another. */
function orderAmounts(network: AdapterAction["network"], market: MarketView, snapshot: OrderSnapshot, mid: string): { readonly inputs: StepAmount[]; readonly outputs: StepAmount[] } {
  if (!market.isSpot) {
    const units = toBaseUnitsBig(snapshot.sz, market.szDecimals).toString();
    return { inputs: [], outputs: [{ asset: perpAssetId(network, market.coin), symbol: market.coin, decimals: market.szDecimals, expected: units, minimum: snapshot.tif === "Ioc" ? "0" : units }] };
  }
  const base = market.base;
  const quote = market.quote;
  if (!base || !quote) throw engineError("MARKET_UNKNOWN", `${market.displayName} has no token metadata.`);
  const baseUnits = decimalUnits(snapshot.sz, base.weiDecimals);
  const quoteMax = decimalUnits(mulDecimal(snapshot.sz, snapshot.limitPx), quote.weiDecimals);
  const quoteMid = decimalUnits(mulDecimal(snapshot.sz, mid), quote.weiDecimals);
  const baseAmount = (expected: bigint, minimum?: bigint): StepAmount => ({ asset: spotAssetId(network, base.index), symbol: base.name, decimals: base.weiDecimals, expected: expected.toString(), ...(minimum !== undefined ? { minimum: minimum.toString() } : {}) });
  const quoteAmount = (expected: bigint, extra: { minimum?: bigint; maximum?: bigint } = {}): StepAmount => ({
    asset: spotAssetId(network, quote.index),
    symbol: quote.name,
    decimals: quote.weiDecimals,
    expected: expected.toString(),
    ...(extra.minimum !== undefined ? { minimum: extra.minimum.toString() } : {}),
    ...(extra.maximum !== undefined ? { maximum: extra.maximum.toString() } : {}),
  });
  if (snapshot.side === "buy") {
    return { inputs: [quoteAmount(quoteMid, { maximum: quoteMax })], outputs: [baseAmount(applySlippage(baseUnits, SPOT_FEE_BPS), snapshot.tif === "Ioc" ? 0n : applySlippage(baseUnits, SPOT_FEE_BPS))] };
  }
  return { inputs: [baseAmount(baseUnits)], outputs: [quoteAmount(applySlippage(quoteMid, SPOT_FEE_BPS), { minimum: applySlippage(quoteMax, SPOT_FEE_BPS) })] };
}

function describeOrder(snapshot: OrderSnapshot): string {
  if (snapshot.trigger) return `${snapshot.trigger.tpsl === "tp" ? "Take profit" : "Stop loss"} on ${snapshot.displayName ?? snapshot.market} at ${snapshot.trigger.triggerPx} (reduce-only, ${snapshot.sz})`;
  const what = snapshot.marketKind === "perp" ? (snapshot.side === "buy" ? "Long" : "Short") : snapshot.side === "buy" ? "Buy" : "Sell";
  const how = snapshot.tif === "Ioc" ? `market (worst ${snapshot.limitPx})` : `limit ${snapshot.limitPx} ${snapshot.tif}`;
  const extras = (snapshot.children ?? []).map((child) => `${child.trigger?.tpsl.toUpperCase()} ${child.trigger?.triggerPx}`).join(", ");
  return `${what} ${snapshot.sz} ${snapshot.displayName ?? snapshot.market} ${how}${snapshot.reduceOnly ? " reduce-only" : ""}${extras ? ` with ${extras}` : ""}`;
}

function signerMode(action: Pick<AdapterAction, "signer">): "agent" | "keeper" {
  return action.signer === "keeper" ? "keeper" : "agent";
}

function requireAgent(context: PrepareContext): string {
  const agent = context.agent ?? context.step.agent?.address;
  if (!agent) throw engineError("AGENT_KEY_REQUIRED", "This step is signed by your trade-only agent key: send its address as `agent` when preparing.");
  return agent;
}

export function createHypercoreTradeAdapter(deps: EngineDeps): ProtocolAdapter {
  const supports = (route: AdapterRoute) => TRADE_KINDS.has(route.kind) && deps.networks[route.network]?.vm === "hypercore" && (route.kind !== "margin" || route.variant === "isolated-margin");

  async function planTrade(action: AdapterAction): Promise<PlannedStep> {
    const trade = action.trade;
    if (!trade) throw engineError("STEP_INVALID", "A trading step needs its market.");
    const mode = signerMode(action);
    const base = { mode, settlement: { kind: "same-network" as const, mechanism: "order-fill" as const }, requestCount: 1, estimatedSeconds: 2, feesUsd: "0" };
    switch (action.kind) {
      case "order": {
        const plan = await planOrder(deps, action);
        const amounts = orderAmounts(action.network, plan.market, plan.snapshot, plan.mid);
        const snapshot = await withSpotNotional(plan.snapshot, plan.market);
        return {
          ...base,
          protocol: plan.market.isSpot ? "hypercore-spot" : "hypercore-perps",
          kind: "order",
          title: describeOrder(snapshot),
          ...amounts,
          warnings: plan.warnings,
          route: { variant: `order:${plan.market.coin}`, slippageBps: action.slippageBps, params: { market: plan.market.coin, marketKind: plan.market.isSpot ? "spot" : "perp", mid: plan.mid } },
          order: snapshot,
        };
      }
      case "leverage": {
        const market = await marketFor(deps, action.network, trade.market, "perp");
        const requested = trade.leverage;
        if (!requested) throw engineError("LEVERAGE_INVALID", "Which leverage? Give a whole number like 5.");
        if (market.maxLeverage !== null && requested.value > market.maxLeverage) throw engineError("LEVERAGE_INVALID", `HyperCore allows at most ${market.maxLeverage}x on ${market.displayName} (an exchange limit, not a Rule Book rule).`);
        const warnings: string[] = [];
        let isCross = requested.mode !== "isolated";
        if (isCross && market.onlyIsolated) {
          isCross = false;
          warnings.push(`${market.displayName} trades isolated only on HyperCore; leverage is set as isolated.`);
        }
        return {
          ...base,
          settlement: { kind: "same-network", mechanism: "ledger" },
          protocol: "hypercore-perps",
          kind: "leverage",
          title: `Set ${market.displayName} leverage to ${requested.value}x ${isCross ? "cross" : "isolated"}`,
          inputs: [],
          outputs: [],
          warnings,
          route: { variant: "leverage", slippageBps: 0, params: { market: market.coin } },
          leverage: { market: market.coin, assetIndex: market.asset, leverage: requested.value, isCross },
        };
      }
      case "cancel": {
        const cancel = trade.cancel ?? {};
        if (cancel.scheduleAt !== undefined) {
          const time = cancel.scheduleAt;
          if (time !== null && time < deps.clock.now() + 5_000) throw engineError("INVALID_REQUEST", "A scheduled cancel must be at least 5 seconds away.");
          return {
            ...base,
            settlement: { kind: "same-network", mechanism: "ledger" },
            protocol: "hypercore-perps",
            kind: "cancel",
            title: time === null ? "Clear the scheduled cancel-all" : `Cancel all open orders at ${new Date(time).toISOString()} (dead man's switch)`,
            inputs: [],
            outputs: [],
            warnings: ["HyperCore allows 10 scheduled cancels per day."],
            route: { variant: "schedule-cancel", slippageBps: 0 },
            cancel: { market: "*", assetIndex: 0, schedule: { time } },
          };
        }
        const kindOfMarket = action.params.marketKind === "spot" ? "spot" : action.params.marketKind === "perp" ? "perp" : undefined;
        const market = await marketFor(deps, action.network, trade.market, kindOfMarket);
        if (cancel.oid === undefined && cancel.cloid === undefined && cancel.twapId === undefined) throw engineError("INVALID_REQUEST", "Which order? Give its oid, cloid or TWAP id.");
        const target = cancel.twapId !== undefined ? `TWAP ${cancel.twapId}` : cancel.cloid !== undefined ? `order ${cancel.cloid}` : `order ${cancel.oid}`;
        return {
          ...base,
          settlement: { kind: "same-network", mechanism: "ledger" },
          protocol: cancel.twapId !== undefined ? "hypercore-twap" : market.isSpot ? "hypercore-spot" : "hypercore-perps",
          kind: "cancel",
          title: `Cancel ${target} on ${market.displayName}`,
          inputs: [],
          outputs: [],
          warnings: [],
          route: { variant: cancel.twapId !== undefined ? "twap-cancel" : cancel.cloid !== undefined ? "cancel-cloid" : "cancel-oid", slippageBps: 0, params: { market: market.coin } },
          cancel: {
            market: market.coin,
            assetIndex: market.asset,
            ...(cancel.oid !== undefined ? { oid: cancel.oid } : {}),
            ...(cancel.cloid !== undefined ? { cloid: hypercore.normalizeCloid(cancel.cloid) } : {}),
            ...(cancel.twapId !== undefined ? { twapId: cancel.twapId } : {}),
          },
        };
      }
      case "twap": {
        const kindOfMarket = action.params.marketKind === "spot" ? "spot" : action.params.marketKind === "perp" ? "perp" : undefined;
        const market = await marketFor(deps, action.network, trade.market, kindOfMarket);
        const minutes = trade.minutes ?? 0;
        if (!Number.isInteger(minutes) || minutes < hypercore.TWAP_MIN_MINUTES || minutes > hypercore.TWAP_MAX_MINUTES) throw engineError("TWAP_INVALID");
        if (!trade.size) throw engineError("ORDER_SIZE_INVALID", "A TWAP needs a total size.");
        const { sz } = lotSize(trade.size, market);
        const mid = await midOf(deps, action.network, market);
        // HyperCore requires at least $100 for a TWAP.
        if (compareDecimal(mulDecimal(sz, mid), "100") < 0) throw engineError("TWAP_INVALID", "HyperCore TWAPs must be worth at least 100 USD.");
        return {
          ...base,
          settlement: { kind: "same-network", mechanism: "order-fill", expectedSeconds: minutes * 60 },
          protocol: "hypercore-twap",
          kind: "twap",
          title: `${trade.side === "sell" ? "Sell" : "Buy"} ${sz} ${market.displayName} over ${minutes} min (TWAP)`,
          inputs: [],
          outputs: market.isSpot ? [] : [{ asset: perpAssetId(action.network, market.coin), symbol: market.coin, decimals: market.szDecimals, expected: toBaseUnitsBig(sz, market.szDecimals).toString(), minimum: "0" }],
          estimatedSeconds: minutes * 60,
          warnings: ["TWAP slices fill over time at up to 3% slippage each."],
          route: { variant: "twap", slippageBps: 300, params: { market: market.coin, mid } },
          twap: { market: market.coin, marketKind: market.isSpot ? "spot" : "perp", assetIndex: market.asset, side: trade.side === "sell" ? "sell" : "buy", sz, minutes, randomize: trade.randomize === true, reduceOnly: trade.reduceOnly === true },
        };
      }
      case "margin": {
        const market = await marketFor(deps, action.network, trade.market, "perp");
        if (!trade.marginUsd) throw engineError("INVALID_REQUEST", "How much margin? Give a USD amount (negative removes).");
        const ntli = hypercore.usdToMicros(trade.marginUsd);
        return {
          ...base,
          settlement: { kind: "same-network", mechanism: "ledger" },
          protocol: "hypercore-perps",
          kind: "margin",
          title: `${ntli >= 0 ? "Add" : "Remove"} ${trade.marginUsd.replace("-", "")} USDC isolated margin on ${market.displayName}`,
          inputs: ntli > 0 ? [{ asset: marginAssetId(action.network), symbol: "USDC", decimals: 6, expected: String(ntli) }] : [],
          outputs: [],
          warnings: [],
          route: { variant: "isolated-margin", slippageBps: 0, params: { market: market.coin } },
          margin: { market: market.coin, assetIndex: market.asset, ntli },
        };
      }
      default:
        throw engineError("ROUTE_UNSUPPORTED", `${action.kind} is not a HyperCore trading step.`);
    }
  }

  /** Spot orders: notional from the base asset's reference USD price (the quote may not be USD). */
  async function withSpotNotional(snapshot: OrderSnapshot, market: MarketView): Promise<OrderSnapshot> {
    if (!market.isSpot || !market.base) return snapshot;
    const micros = ReferencePrices.symbolMicros(await deps.prices.snapshot(), market.base.name);
    const usd = ReferencePrices.usdText(toBaseUnitsBig(snapshot.sz, market.szDecimals), market.szDecimals, micros);
    return { ...snapshot, notionalUsd: usd };
  }

  async function prepareOrder(context: PrepareContext): Promise<PreparedPayload> {
    const { step } = context;
    const planned = step.order;
    if (!planned) throw engineError("STEP_INVALID", "The order step lost its snapshot.");
    const agent = requireAgent(context);
    const isBuy = planned.side === "buy";
    const funded = step.funding !== undefined;
    const trade: TradeRequest = planned.trigger
      ? { market: planned.market, side: planned.side, size: planned.sz, trigger: { kind: planned.trigger.tpsl, price: planned.trigger.triggerPx, isMarket: planned.trigger.isMarket } }
      : {
          market: planned.market,
          side: planned.side,
          ...(funded ? {} : { size: planned.sz }),
          ...(planned.tif === "Ioc" ? {} : { price: planned.limitPx, tif: planned.tif ?? "Gtc" }),
          reduceOnly: planned.reduceOnly,
          ...((planned.children ?? []).find((child) => child.trigger?.tpsl === "tp") ? { takeProfit: (planned.children ?? []).find((child) => child.trigger?.tpsl === "tp")?.trigger?.triggerPx } : {}),
          ...((planned.children ?? []).find((child) => child.trigger?.tpsl === "sl") ? { stopLoss: (planned.children ?? []).find((child) => child.trigger?.tpsl === "sl")?.trigger?.triggerPx } : {}),
        };
    const plan = await planOrder(deps, {
      network: step.network,
      trade,
      slippageBps: step.route?.slippageBps ?? 50,
      params: { marketKind: planned.marketKind },
      amount: context.amount,
      funded,
    });
    const snapshot = { ...(await withSpotNotional(plan.snapshot, plan.market)), ...(planned.leverage ? { leverage: planned.leverage } : {}) };
    // A re-prepared market order is held to the planned worst price (Kletia priceMoved).
    if (planned.worstPx && snapshot.worstPx) {
      const moved = isBuy ? compareDecimal(snapshot.worstPx, planned.worstPx) > 0 : compareDecimal(snapshot.worstPx, planned.worstPx) < 0;
      if (moved && !funded) {
        throw engineError("QUOTE_MOVED", `The ${planned.displayName ?? planned.market} mid moved past the planned worst price (${planned.worstPx}; now ${snapshot.worstPx}). Plan again.`);
      }
      if (moved) plan.warnings.push(`Price moved since planning: worst price is now ${snapshot.worstPx}.`);
    }
    const nonce = deps.nonces.next();
    const expiresAfter = context.now + L1_EXPIRY_MS;
    const action = orderActionOf(snapshot);
    const cloids = [snapshot.cloid, ...(snapshot.children ?? []).map((child) => child.cloid)];
    const amounts = orderAmounts(step.network, plan.market, snapshot, plan.mid);
    return {
      requests: [l1Request({ network: step.network, from: stepAddress(step), agent, signer: step.mode === "keeper" ? "keeper" : "agent", action, nonce, expiresAfter, description: describeOrder(snapshot), cloids })],
      ...amounts,
      warnings: plan.warnings,
      order: snapshot,
    };
  }

  async function prepareOther(context: PrepareContext): Promise<PreparedPayload> {
    const { step } = context;
    const agent = requireAgent(context);
    const nonce = deps.nonces.next();
    const expiresAfter = context.now + L1_EXPIRY_MS;
    const signer = step.mode === "keeper" ? "keeper" : "agent";
    const from = stepAddress(step);
    const request = (action: hypercore.L1Action, description: string) => l1Request({ network: step.network, from, agent, signer, action, nonce, expiresAfter, description });
    switch (step.kind) {
      case "leverage": {
        const leverage = step.leverage;
        if (!leverage) throw engineError("STEP_INVALID", "The leverage step lost its snapshot.");
        return { requests: [request(hypercore.updateLeverageAction(leverage.assetIndex, leverage.isCross, leverage.leverage), step.title)], inputs: [], outputs: [], warnings: [] };
      }
      case "cancel": {
        const cancel = step.cancel;
        if (!cancel) throw engineError("STEP_INVALID", "The cancel step lost its snapshot.");
        if (cancel.schedule) {
          const time = cancel.schedule.time;
          if (time !== null && time < context.now + 5_000) throw engineError("INVALID_REQUEST", "The scheduled cancel time has passed; plan it again.");
          return { requests: [request(hypercore.scheduleCancelAction(time ?? undefined), step.title)], inputs: [], outputs: [], warnings: [] };
        }
        const action = cancel.twapId !== undefined
          ? hypercore.twapCancelAction(cancel.assetIndex, cancel.twapId)
          : cancel.cloid !== undefined
            ? hypercore.cancelByCloidAction([{ asset: cancel.assetIndex, cloid: cancel.cloid }])
            : hypercore.cancelAction([{ asset: cancel.assetIndex, oid: cancel.oid as number }]);
        return { requests: [request(action, step.title)], inputs: [], outputs: [], warnings: [] };
      }
      case "twap": {
        const twap = step.twap;
        if (!twap) throw engineError("STEP_INVALID", "The TWAP step lost its snapshot.");
        const action = hypercore.twapOrderAction({ asset: twap.assetIndex, isBuy: twap.side === "buy", size: twap.sz, reduceOnly: twap.reduceOnly, minutes: twap.minutes, randomize: twap.randomize });
        return { requests: [request(action, step.title)], inputs: step.inputs, outputs: step.outputs, warnings: [] };
      }
      case "margin": {
        const margin = step.margin;
        if (!margin) throw engineError("STEP_INVALID", "The margin step lost its snapshot.");
        const state = await deps.core.clearinghouseState(step.network, from);
        const position = state.assetPositions.find((entry) => entry.position.coin === margin.market)?.position;
        if (!position || position.leverage.type !== "isolated") throw engineError("ROUTE_UNAVAILABLE", `There is no isolated ${margin.market} position to change margin on.`);
        return {
          requests: [request(hypercore.updateIsolatedMarginAction(margin.assetIndex, margin.ntli), step.title)],
          inputs: step.inputs,
          outputs: [],
          warnings: [],
          observed: { rawUsd: position.leverage.rawUsd },
        };
      }
      default:
        throw engineError("STEP_INVALID", `${step.kind} is not a HyperCore trading step.`);
    }
  }

  async function verifyOther(context: VerifyContext): Promise<VerificationResult> {
    const { step, now } = context;
    const matched = attributeL1(step, context.references);
    if (!isPreparedMatch(matched)) return matched;
    const user = stepAddress(step);
    const stale = now - context.submittedAt > L1_EFFECT_STALE_MS;
    switch (step.kind) {
      case "leverage": {
        const leverage = step.leverage;
        if (!leverage) return failed([], "STEP_INVALID", "The leverage step lost its snapshot.");
        const data = await deps.core.activeAssetData(step.network, user, leverage.market);
        const type = leverage.isCross ? "cross" : "isolated";
        if (data.leverage.type === type && data.leverage.value === leverage.leverage) {
          return { status: "confirmed", settled: true, evidence: [evidence("ledger", step.network, now, `${leverage.market} leverage is ${data.leverage.value}x ${data.leverage.type}.`)] };
        }
        return pendingResult(`${leverage.market} leverage reads ${data.leverage.value}x ${data.leverage.type}.`, stale);
      }
      case "cancel": {
        const cancel = step.cancel;
        if (!cancel) return failed([], "STEP_INVALID", "The cancel step lost its snapshot.");
        if (cancel.schedule || cancel.twapId !== undefined) {
          // The info API exposes neither scheduled cancels nor TWAP state; nothing moves either way.
          return { status: "confirmed", settled: true, evidence: [evidence("note", step.network, now, "Submitted. HyperCore's info API does not expose this action's state; it moves no funds.")] };
        }
        const status = await deps.core.orderStatus(step.network, user, (cancel.cloid ?? cancel.oid) as number | hypercore.Cloid);
        if (status.status === "unknownOid") return failed([], "ORDER_UNKNOWN", "HyperCore does not know the order this step cancels.");
        const value = status.order.status;
        if (value === "open" || value === "triggered") return pendingResult("The order is still open.", stale);
        return {
          status: "confirmed",
          settled: true,
          evidence: [evidence("order", step.network, now, value === "filled" ? "The order had already filled before the cancel." : `Order ${status.order.order.oid} is ${value}.`, { reference: `oid:${status.order.order.oid}` })],
        };
      }
      case "twap": {
        const twap = step.twap;
        if (!twap) return failed([], "STEP_INVALID", "The TWAP step lost its snapshot.");
        const fills = await deps.core.userFillsByTime(step.network, user, matched.preparedAt - 300_000);
        const slices = fills.filter((fill) => fill.coin === twap.market && fill.twapId !== null && fill.time >= matched.preparedAt - 300_000);
        if (slices.length === 0) return pendingResult("No TWAP slice has filled yet.", stale);
        const twapId = slices[0]?.twapId ?? null;
        return {
          status: "confirmed",
          settled: true,
          evidence: [evidence("fill", step.network, now, `TWAP ${twapId} running: ${slices.length} slice(s) filled so far.`, { reference: slices[0]?.hash })],
          settlement: { state: "filling", ...(twapId !== null ? { trackingId: String(twapId) } : {}) },
        };
      }
      case "margin": {
        const margin = step.margin;
        const before = matched.record.observed?.rawUsd;
        if (!margin || before === undefined) return failed([], "STEP_INVALID", "The margin step lost its snapshot.");
        const state = await deps.core.clearinghouseState(step.network, user);
        const position = state.assetPositions.find((entry) => entry.position.coin === margin.market)?.position;
        if (!position || position.leverage.type !== "isolated") return pendingResult("The isolated position is not visible.", stale);
        const delta = decimalUnits(position.leverage.rawUsd, 6) * (position.leverage.rawUsd.startsWith("-") ? -1n : 1n) - decimalUnits(before, 6) * (before.startsWith("-") ? -1n : 1n);
        const wanted = BigInt(margin.ntli);
        const tolerance = (wanted < 0n ? -wanted : wanted) / 100n + 1n;
        if (delta - wanted <= tolerance && wanted - delta <= tolerance) {
          return { status: "confirmed", settled: true, evidence: [evidence("ledger", step.network, now, `Isolated margin moved by ${unitsToDecimal(delta < 0n ? -delta : delta, 6)} USD.`)] };
        }
        return pendingResult("The isolated margin has not moved yet.", stale);
      }
      default:
        return failed([], "STEP_INVALID", `${step.kind} is not a HyperCore trading step.`);
    }
  }

  return {
    id: "hypercore-trade",
    protocols: ["hypercore-perps", "hypercore-spot", "hypercore-twap"],
    label: "HyperCore",
    supports,
    plan: planTrade,
    prepare: (context) => (context.step.kind === "order" ? prepareOrder(context) : prepareOther(context)),
    verify: (context) => (context.step.kind === "order" ? verifyOrder(deps, context) : verifyOther(context)),
    async poll(step, _graph, now) {
      // Resting limit orders: follow until filled, canceled or rejected.
      const order = step.order;
      const oid = Number(step.settlement?.trackingId);
      if (step.kind !== "order" || !order || !Number.isSafeInteger(oid)) return { status: "settling", evidence: [] };
      const status = await deps.core.orderStatus(step.network, stepAddress(step), oid);
      if (status.status === "unknownOid") return { status: "settling", evidence: [] };
      const preparedAt = Date.parse(step.prepared?.preparedAt ?? new Date(now).toISOString());
      const outcome = await orderOutcome(deps, step, order, oid, status.order.status, preparedAt, now, []);
      if (outcome.status === "confirmed") {
        if (!outcome.settled) return { status: "settling", evidence: [], ...(outcome.settlement ? { settlement: outcome.settlement } : {}) };
        return { status: "settled", evidence: outcome.evidence, ...(outcome.actualOutputs ? { actualOutputs: outcome.actualOutputs } : {}) };
      }
      if (outcome.status === "failed") return { status: "failed", evidence: outcome.evidence, failure: outcome.failure };
      return { status: "settling", evidence: [] };
    },
  };
}

