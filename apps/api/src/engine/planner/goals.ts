/**
 * Goal IR (core goals.ts, produced by the language layer) -> structured
 * actions the planner executes. Only goals the engine can execute compile;
 * anything else (earn, borrow, USD-sized spends, named recipients, alerts
 * and rules) is refused with the question or the reason, never guessed.
 */
import type { AmountSel, GoalItem, IntentActionSpec, NetworkEnvironment, NetworkKey, PriceSel, TradeGoal, ValueGoal } from "@elyia/core";
import { NETWORKS } from "@elyia/core";
import { engineError } from "../errors.js";
import { LENDING_VENUES, VAULT_VENUES } from "../venues.js";

type Params = Record<string, string | number | boolean>;

function layer(environment: NetworkEnvironment, family: "elysium" | "hyperevm" | "hypercore"): NetworkKey {
  return `${family}-${environment}` as NetworkKey;
}

function symbolOf(selection: ValueGoal["spend"]["asset"], fallback?: string): string | undefined {
  if (!selection) return fallback;
  if ("symbol" in selection) return selection.symbol;
  if (selection.class === "hype" || selection.class === "gas") return "HYPE";
  if (selection.class === "usd-stable") return "USDC";
  throw engineError("INTENT_CLARIFY", "Which stablecoin exactly (USDC, USDT0, USDH)?");
}

function amountOf(selection: AmountSel | undefined, chained: boolean): { readonly amount?: string; readonly params: Params } {
  if (!selection) return chained ? { amount: "max", params: {} } : { params: {} };
  switch (selection.t) {
    case "exact":
      return { amount: selection.value, params: {} };
    case "max":
    case "previous":
      return { amount: "max", params: {} };
    case "portion":
      return { amount: "max", params: { portionBps: selection.bps } };
    case "usd":
      throw engineError("INTENT_CLARIFY", "Give the amount in tokens rather than dollars for this move.");
    case "allBut":
      throw engineError("INTENT_CLARIFY", `Give the exact amount to move (keeping ${selection.keep} is not planned automatically yet).`);
  }
}

function placeNetwork(place: ValueGoal["spend"]["from"] | undefined, environment: NetworkEnvironment): NetworkKey | undefined {
  if (!place) return undefined;
  if (place.network) {
    if (NETWORKS[place.network].environment !== environment) throw engineError("CAPITAL_LANE_MIXED");
    return place.network;
  }
  if (place.custody.kind === "hypercore") return layer(environment, "hypercore");
  return undefined;
}

/** The vault or lending venue a custody place names (registry ids; "kalos" with KALOS is the stKALOS vault). */
function venueOf(place: ValueGoal["spend"]["from"] | undefined, asset: string | undefined): string | undefined {
  if (place?.custody.kind !== "venue" || !place.custody.protocol) return undefined;
  const protocol = place.custody.protocol;
  if (VAULT_VENUES.some((venue) => venue.id === protocol) || LENDING_VENUES.some((venue) => venue.id === protocol)) return protocol;
  const vault = VAULT_VENUES.find((venue) => venue.census === protocol || venue.id.startsWith(`${protocol}-`));
  if (vault && (!asset || [vault.assetSymbol, vault.shareSymbol].includes(asset.toUpperCase()))) return vault.id;
  return protocol;
}

function valueAction(goal: ValueGoal, environment: NetworkEnvironment, index: number): IntentActionSpec {
  // `.ely` names resolve in the planner (Elysium Names); other names and nicknames need an address.
  const named = goal.holder.t === "name" && /\.ely$/iu.test(goal.holder.value) ? goal.holder.value : undefined;
  if ((goal.holder.t === "name" && !named) || goal.holder.t === "nickname" || goal.holder.t === "selfOther") throw engineError("INTENT_CLARIFY", "Send to which address? Give the 0x address or a .ely name.");
  const chained = goal.chain !== undefined;
  if (chained && (goal.chain?.after ?? index) >= index) throw engineError("INVALID_REQUEST", "A goal can only follow an earlier goal.");
  const from = placeNetwork(goal.spend.from, environment);
  const to = placeNetwork(goal.want.at, environment);
  const { amount, params } = amountOf(goal.spend.amount, chained);
  const base = {
    ...(amount !== undefined ? { amount } : {}),
    ...(goal.constraints.via?.[0] ? { protocol: goal.constraints.via[0] } : {}),
    ...(chained ? { after: [goal.chain?.after as number] } : {}),
    ...(goal.constraints.keepGas === false ? { params: { ...params, keepGas: false } } : Object.keys(params).length > 0 ? { params } : {}),
  };
  const spend = symbolOf(goal.spend.asset);
  switch (goal.kind) {
    case "convert": {
      const network = from ?? to ?? layer(environment, "elysium");
      const want = symbolOf(goal.want.asset);
      if (!spend || !want) throw engineError("INTENT_CLARIFY", "Swap which token into which?");
      if (to && to !== network) throw engineError("INTENT_CLARIFY", "Swap first, then bridge: say both steps.");
      return { kind: "swap", network, from: spend, to: want, ...base };
    }
    case "relocate": {
      const network = from ?? layer(environment, "hyperevm");
      if (!to) throw engineError("INTENT_CLARIFY", "Move it to which network?");
      const want = symbolOf(goal.want.asset);
      return { kind: "bridge", network, toNetwork: to, from: spend ?? "HYPE", ...(want && want !== spend ? { to: want } : {}), ...base };
    }
    case "deliver": {
      const recipient = named ?? (goal.holder.t === "address" ? goal.holder.value : undefined);
      if (!recipient) throw engineError("INTENT_CLARIFY", "Send to which address?");
      const network = from ?? to ?? layer(environment, "elysium");
      return { kind: "transfer", network, from: spend ?? "HYPE", recipient, ...base };
    }
    case "earn": {
      // Lend or deposit into a named vault / lending market (deposit kind; the venue's pins pick the tokens).
      const protocol = venueOf(goal.want.at, spend) ?? goal.constraints.via?.[0];
      if (!protocol) throw engineError("INTENT_CLARIFY", "Deposit into which vault or lending market?");
      return { kind: "deposit", network: to ?? from ?? layer(environment, "elysium"), ...(spend ? { from: spend } : {}), ...base, protocol };
    }
    case "exit": {
      const protocol = venueOf(goal.spend.from, spend) ?? goal.constraints.via?.[0];
      if (!protocol) throw engineError("INTENT_CLARIFY", "Withdraw from which vault or lending market?");
      const want = symbolOf(goal.want.asset, spend);
      return { kind: "withdraw", network: from ?? to ?? layer(environment, "elysium"), ...(want ? { to: want } : {}), ...base, amount: base.amount ?? "max", protocol };
    }
    case "stake":
      return { kind: "stake", network: from ?? to ?? layer(environment, "hyperevm"), from: spend ?? "HYPE", to: symbolOf(goal.want.asset, "kHYPE") as string, ...base };
    case "unstake":
      return { kind: "unstake", network: from ?? layer(environment, "hyperevm"), from: spend ?? "kHYPE", ...base };
    default:
      throw engineError("ROUTE_UNSUPPORTED", `Elyia does not execute "${goal.kind}" goals yet.`);
  }
}

function limitOf(price: PriceSel | undefined): string | undefined {
  if (!price || price.t === "market") return undefined;
  if (price.t === "limit") return price.px;
  throw engineError("INTENT_CLARIFY", "Give the limit price as a number.");
}

function triggerParams(goal: TradeGoal, params: Params): { readonly takeProfit?: string; readonly stopLoss?: string } {
  const out: { takeProfit?: string; stopLoss?: string } = {};
  for (const [key, trigger] of [["tp", goal.tp], ["sl", goal.sl]] as const) {
    if (!trigger) continue;
    if (trigger.px.t === "limit") {
      if (key === "tp") out.takeProfit = trigger.px.px;
      else out.stopLoss = trigger.px.px;
    } else if (trigger.px.t === "offset") {
      params[key === "tp" ? "takeProfitPct" : "stopLossPct"] = trigger.px.pct;
    } else {
      throw engineError("INTENT_CLARIFY", `Give the ${key === "tp" ? "take profit" : "stop"} as a price or a percent.`);
    }
  }
  return out;
}

function tradeAction(goal: TradeGoal, environment: NetworkEnvironment): IntentActionSpec {
  const network = layer(environment, "hypercore");
  if (!("coin" in goal.market)) {
    if (goal.kind === "cancel") throw engineError("INTENT_CLARIFY", "Cancel orders on which market?");
    throw engineError("INTENT_CLARIFY", "Close which position?");
  }
  if (goal.market.dex) throw engineError("ROUTE_UNSUPPORTED", "Builder-deployed (HIP-3) perp markets are not traded through intents yet.");
  const market = goal.market.coin;
  const params: Params = { marketKind: goal.market.kind };
  if (goal.maxSlippageBps !== undefined) params.slippageBps = goal.maxSlippageBps;
  const size = goal.size;
  const sizing: { size?: string } = {};
  if (size?.t === "base") sizing.size = size.value;
  else if (size?.t === "notional") params.notionalUsd = size.usd;
  else if (size?.t === "margin") params.marginUsd = size.usd;
  const leverage = goal.leverage ? (goal.leverage.x === "max" ? (() => { throw engineError("INTENT_CLARIFY", "Which leverage exactly (for example 5x)?"); })() : { value: goal.leverage.x, mode: goal.leverage.mode ?? "cross" }) : undefined;
  const tif = goal.tif === "gtc" ? "Gtc" : goal.tif === "alo" ? "Alo" : goal.tif === "ioc" ? "Ioc" : undefined;
  switch (goal.kind) {
    case "open":
    case "order": {
      if (size && size.t !== "base" && size.t !== "notional" && size.t !== "margin") throw engineError("INTENT_CLARIFY", "How big? Give a size, a USD notional or a margin.");
      const price = limitOf(goal.price);
      return {
        kind: "order",
        network,
        market,
        ...(goal.side ? { side: goal.side } : {}),
        ...sizing,
        ...(price ? { price } : {}),
        ...(tif ? { tif } : {}),
        ...(goal.reduceOnly ? { reduceOnly: true } : {}),
        ...(leverage ? { leverage } : {}),
        ...triggerParams(goal, params),
        params,
      };
    }
    case "close":
    case "reduce": {
      if (size && size.t !== "portion") throw engineError("INTENT_CLARIFY", "Reduce by what share (for example half)?");
      const price = limitOf(goal.price);
      return { kind: "order", network, market, ...(price ? { price } : {}), params: { ...params, marketKind: "perp", [goal.kind]: true, ...(size?.t === "portion" ? { portionBps: size.bps } : {}) } };
    }
    case "protect": {
      const triggers = triggerParams(goal, params);
      return { kind: "order", network, market, ...triggers, params: { ...params, marketKind: "perp", protect: true } };
    }
    case "twap": {
      if (!sizing.size) throw engineError("INTENT_CLARIFY", "A TWAP needs a base size.");
      return { kind: "twap", network, market, ...(goal.side ? { side: goal.side } : {}), ...sizing, minutes: goal.twap?.minutes ?? 0, ...(goal.reduceOnly ? { reduceOnly: true } : {}), params: { ...params, ...(goal.twap?.randomize ? { randomize: true } : {}) } };
    }
    case "cancel":
      return { kind: "cancel", network, market, params };
    case "setLeverage":
      if (!leverage) throw engineError("INTENT_CLARIFY", "Which leverage (for example 5x)?");
      return { kind: "leverage", network, market, leverage, params };
  }
}

/** Compiles goals to actions (one per goal; chains become `after` + `max`). */
export function goalsToActions(items: readonly GoalItem[], environment: NetworkEnvironment): IntentActionSpec[] {
  if (items.length === 0) throw engineError("INTENT_UNSUPPORTED");
  return items.map((item, index) => {
    if (item.t === "value") return valueAction(item.goal, environment, index);
    if (item.t === "trade") return tradeAction(item.goal, environment);
    throw engineError("ROUTE_UNSUPPORTED", "Alerts are managed by the Elysium Agent (POST /v1/agent/alerts), not planned as an intent.");
  });
}
