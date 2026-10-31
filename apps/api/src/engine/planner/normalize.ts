/**
 * Structured actions -> normalized planner actions. One request action may
 * become several planner actions (composites), always with an explanation
 * in the intent warnings:
 *
 * - "get me on Elysium" (bridge HyperCore -> Elysium from USDC): buy HYPE
 *   on HyperCore spot, spotSend it to 0x2222 (native HYPE on HyperEVM),
 *   Inbox.depositEth, and optionally swap all but the gas back to the asked
 *   asset on Elysium;
 * - bridge Elysium <-> HyperCore: two hops through HyperEVM;
 * - "bridge X HYPE to Elysium and stake half": Kinetiq stakes on HyperEVM,
 *   so stake there first, then bridge the HYPE that is left and the kHYPE;
 * - an order with leverage: a leverage step before the order;
 * - close / reduce / cancel-all: sized or fanned out from live HyperCore state.
 *
 * Amount specs: an exact decimal, `max` (the previous action's output, or
 * the first `after` parent's), with `params.portionBps` for a share.
 */
import { NETWORKS, parseAccountId, type IntentActionSpec, type NetworkEnvironment, type NetworkKey, type StepKind } from "@elyia/core";
import type { EngineDeps } from "../deps.js";
import { mulDecimal } from "../hypercore/markets.js";
import { engineError } from "../errors.js";
import type { TradeRequest } from "../types.js";
import { LENDING_VENUES } from "../venues.js";

function isLendingVenue(protocol: string): boolean {
  return LENDING_VENUES.some((venue) => venue.id === protocol);
}

export type ActionParams = Readonly<Record<string, string | number | boolean>>;

export type AmountSpec =
  | { readonly t: "exact"; readonly value: string }
  | { readonly t: "previous"; readonly portionBps: number }
  | { readonly t: "none" };

export interface NormalizedAction {
  /** Index of the request action this came from. */
  readonly source: number;
  readonly kind: StepKind;
  readonly network: NetworkKey;
  readonly destination: NetworkKey;
  readonly from?: string;
  readonly to?: string;
  readonly amount: AmountSpec;
  /** Gas kept back from a funded native-HYPE spend (base units). */
  readonly gasReserve?: bigint;
  readonly recipient?: string;
  readonly protocol?: string;
  readonly variant?: string;
  readonly trade?: TradeRequest;
  readonly params: ActionParams;
  /** Normalized indexes this action waits for (the first funds it when amount is `previous`). */
  readonly after?: readonly number[];
}

export interface Normalized {
  readonly actions: readonly NormalizedAction[];
  readonly warnings: readonly string[];
}

/** Gas kept on Elysium / HyperEVM when a step spends all of a parent's HYPE: 0.05 HYPE. */
export const GAS_RESERVE_WEI = 50_000_000_000_000_000n;
/**
 * "Get me on Elysium": HYPE kept as gas on Elysium when the rest is swapped
 * (`params.gasHype` overrides). 0.05 HYPE pays for hundreds of Elysium
 * transactions (a plain transfer is ~21,140 gas).
 */
export const DEFAULT_ARRIVAL_GAS = "0.05";

function layer(environment: NetworkEnvironment, family: "elysium" | "hyperevm" | "hypercore"): NetworkKey {
  return `${family}-${environment}` as NetworkKey;
}

function amountSpec(action: IntentActionSpec): AmountSpec {
  if (action.amount === undefined) return { t: "none" };
  if (action.amount === "max") {
    const portion = Number(action.params?.portionBps ?? 10_000);
    if (!Number.isInteger(portion) || portion < 1 || portion > 10_000) throw engineError("INVALID_REQUEST", "params.portionBps is 1-10000.");
    return { t: "previous", portionBps: portion };
  }
  return { t: "exact", value: action.amount };
}

function sideOf(side: IntentActionSpec["side"]): "buy" | "sell" | undefined {
  if (side === undefined) return undefined;
  return side === "buy" || side === "long" ? "buy" : "sell";
}

function tradeOf(action: IntentActionSpec): TradeRequest {
  if (!action.market) throw engineError("INVALID_REQUEST", `${action.kind} actions need a market.`);
  const params = action.params ?? {};
  const triggerKind = params.trigger === "tp" || params.trigger === "sl" ? params.trigger : undefined;
  const side = sideOf(action.side);
  return {
    market: action.market,
    ...(side ? { side } : {}),
    ...(action.size !== undefined ? { size: action.size } : {}),
    ...(action.price !== undefined && !triggerKind ? { price: action.price } : {}),
    ...(action.tif !== undefined ? { tif: action.tif } : {}),
    ...(action.reduceOnly !== undefined ? { reduceOnly: action.reduceOnly } : {}),
    ...(action.takeProfit !== undefined ? { takeProfit: action.takeProfit } : {}),
    ...(action.stopLoss !== undefined ? { stopLoss: action.stopLoss } : {}),
    ...(triggerKind && action.price !== undefined ? { trigger: { kind: triggerKind, price: action.price, isMarket: params.triggerLimit !== true } } : {}),
    ...(action.leverage ? { leverage: { value: action.leverage.value, mode: action.leverage.mode ?? "cross" } } : {}),
    ...(action.minutes !== undefined ? { minutes: action.minutes } : {}),
    ...(params.randomize === true ? { randomize: true } : {}),
    ...(action.kind === "cancel"
      ? {
          cancel: {
            ...(typeof params.oid === "number" ? { oid: params.oid } : typeof params.oid === "string" && /^\d+$/u.test(params.oid) ? { oid: Number(params.oid) } : {}),
            ...(typeof params.cloid === "string" ? { cloid: params.cloid } : {}),
            ...(typeof params.twapId === "number" ? { twapId: params.twapId } : {}),
            ...(params.scheduleAt !== undefined ? { scheduleAt: params.scheduleAt === "clear" || params.scheduleAt === false ? null : Number(params.scheduleAt) } : {}),
          },
        }
      : {}),
    ...(action.kind === "margin" && typeof params.marginUsd === "string" ? { marginUsd: params.marginUsd } : {}),
  };
}

interface Context {
  readonly deps: EngineDeps;
  readonly environment: NetworkEnvironment;
  readonly owner: string;
}

/** Live perp position (signed size and entry price), for close / reduce / protect. */
async function positionOf(context: Context, network: NetworkKey, market: string): Promise<{ readonly szi: string; readonly entryPx: string }> {
  const state = await context.deps.core.clearinghouseState(network, context.owner);
  const position = state.assetPositions.find((entry) => entry.position.coin.toUpperCase() === market.toUpperCase())?.position;
  if (!position || /^-?0(?:\.0+)?$/u.test(position.szi)) throw engineError("INTENT_UNSUPPORTED", `You have no open ${market} position on HyperCore.`);
  return { szi: position.szi, entryPx: position.entryPx };
}

/** entry x (1 +/- pct/100), for percent TP/SL on an existing position (rounded to the tick by the trade adapter). */
function offsetPrice(entryPx: string, pct: string, up: boolean): string {
  const factor = up ? addPercent(pct) : subtractPercent(pct);
  return mulDecimal(entryPx, factor);
}

function addPercent(pct: string): string {
  return mulDecimal(pct, "0.01") === "0" ? "1" : sumDecimal("1", mulDecimal(pct, "0.01"));
}

function subtractPercent(pct: string): string {
  const share = mulDecimal(pct, "0.01");
  const rest = subtractDecimal("1", share);
  if (rest === "0") throw engineError("INVALID_REQUEST", "A stop more than 100% away is not a price.");
  return rest;
}

function sumDecimal(a: string, b: string): string {
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const units = (text: string) => BigInt(text.replace(".", "") + "0".repeat(scale - (text.split(".")[1] ?? "").length));
  const total = units(a) + units(b);
  if (scale === 0) return total.toString();
  const digits = total.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`.replace(/\.?0+$/u, "");
}

async function expandOne(context: Context, action: IntentActionSpec, source: number, warnings: string[]): Promise<Omit<NormalizedAction, "after">[]> {
  const { environment } = context;
  const params: ActionParams = action.params ?? {};
  const base = { source, params, ...(action.protocol ? { protocol: action.protocol } : typeof params.venue === "string" ? { protocol: params.venue } : {}), ...(action.recipient ? { recipient: action.recipient } : {}) };
  const network = action.network;
  const destination = action.toNetwork ?? network;
  const family = NETWORKS[network].family;
  const destinationFamily = NETWORKS[destination].family;
  const amount = amountSpec(action);

  switch (action.kind) {
    case "swap": {
      if (destination !== network) throw engineError("ROUTE_UNSUPPORTED", "A swap runs on one network: bridge first, then swap on the destination.");
      if (NETWORKS[network].vm !== "evm") throw engineError("ROUTE_UNSUPPORTED", "On HyperCore, trade on the order book (kind order, spot market) instead of swapping.");
      if (!action.from || !action.to) throw engineError("INTENT_CLARIFY", "Which tokens? A swap needs from and to.");
      return [{ ...base, kind: "swap", network, destination, from: action.from, to: action.to, amount }];
    }
    case "transfer":
      if (!action.recipient) throw engineError("INTENT_CLARIFY", "Send to whom? A transfer needs a recipient.");
      return [{ ...base, kind: "transfer", network, destination: network, ...(action.from ? { from: action.from } : {}), amount }];
    case "link":
    case "bridge": {
      if (destination === network) throw engineError("INTENT_CLARIFY", "Bridge to which network? Set toNetwork.");
      if (family === "hyperevm" && destinationFamily === "elysium") return [{ ...base, kind: "bridge", network, destination, from: action.from ?? "HYPE", amount }];
      if (family === "elysium" && destinationFamily === "hyperevm") return [{ ...base, kind: "bridge", network, destination, from: action.from ?? "HYPE", amount }];
      if ((family === "hyperevm" && destinationFamily === "hypercore") || (family === "hypercore" && destinationFamily === "hyperevm")) {
        return [{ ...base, kind: "link", network, destination, from: action.from ?? (family === "hypercore" ? "HYPE" : "HYPE"), amount }];
      }
      const hyperevm = layer(environment, "hyperevm");
      if (family === "elysium" && destinationFamily === "hypercore") {
        warnings.push("Elysium to HyperCore goes through HyperEVM: withdraw (claim after the challenge period), then move it to HyperCore.");
        return [
          { ...base, kind: "bridge", network, destination: hyperevm, from: action.from ?? "HYPE", amount },
          { source, params: {}, kind: "link", network: hyperevm, destination, from: action.from ?? "HYPE", amount: { t: "previous", portionBps: 10_000 } },
        ];
      }
      if (family === "hypercore" && destinationFamily === "elysium") return getMeOnElysium(context, action, source, warnings);
      throw engineError("ROUTE_UNSUPPORTED", `No route from ${NETWORKS[network].name} to ${NETWORKS[destination].name}.`);
    }
    case "stake":
      if (family !== "hyperevm") throw engineError("ROUTE_UNSUPPORTED", "There is no staking contract on this network: Kinetiq stakes HYPE on HyperEVM. Bridge HYPE to HyperEVM and stake there, or say \"bridge X HYPE to Elysium and stake half\".");
      return [{ ...base, kind: "stake", network, destination: network, from: action.from ?? "HYPE", to: action.to ?? "kHYPE", amount }];
    case "unstake":
      throw engineError("ROUTE_UNSUPPORTED", "Unstaking kHYPE goes through Kinetiq's withdrawal queue (queueWithdrawal, then confirm after the delay; a fee applies). Elyia shows the queue but does not execute it yet.", { protocol: "kinetiq", queue: "read-only" });
    case "deposit":
    case "withdraw": {
      if (NETWORKS[network].vm !== "evm") throw engineError("ROUTE_UNSUPPORTED", "Vault deposits and lending run on Elysium or HyperEVM.");
      if (!base.protocol) throw engineError("INTENT_CLARIFY", `${action.kind === "deposit" ? "Deposit into" : "Withdraw from"} which venue? Name the vault or lending market (protocol).`);
      // "Withdraw everything" from a lending market: by position shares (the wallet holds no receipt token).
      if (action.kind === "withdraw" && action.amount === "max" && isLendingVenue(base.protocol) && action.after === undefined && source === 0) {
        return [{ ...base, kind: "withdraw", network, destination: network, ...(action.from ? { from: action.from } : {}), ...(action.to ? { to: action.to } : {}), amount: { t: "none" }, params: { ...params, all: true } }];
      }
      return [{ ...base, kind: action.kind, network, destination: network, ...(action.from ? { from: action.from } : {}), ...(action.to ? { to: action.to } : {}), amount }];
    }
    case "margin": {
      if (NETWORKS[network].vm !== "hypercore") throw engineError("ROUTE_UNSUPPORTED", "Margin moves happen on HyperCore.");
      if (action.market) return [{ ...base, kind: "margin", network, destination: network, variant: "isolated-margin", trade: tradeOf(action), amount: { t: "none" } }];
      const toPerp = params.toPerp !== false && params.direction !== "toSpot";
      return [{ ...base, kind: "margin", network, destination: network, from: toPerp ? "USDC" : "USDC@margin", amount, params: { ...params, toPerp } }];
    }
    case "order": {
      if (NETWORKS[network].vm !== "hypercore") throw engineError("ROUTE_UNSUPPORTED", "Orders run on HyperCore.");
      const trade = tradeOf(action);
      const out: Omit<NormalizedAction, "after">[] = [];
      if (params.protect === true) {
        // Standalone reduce-only TP / SL on the live position.
        const { szi, entryPx } = await positionOf(context, network, trade.market);
        const long = !szi.startsWith("-");
        const size = szi.replace(/^-/u, "");
        const tp = trade.takeProfit ?? (typeof params.takeProfitPct === "string" ? offsetPrice(entryPx, params.takeProfitPct, long) : undefined);
        const sl = trade.stopLoss ?? (typeof params.stopLossPct === "string" ? offsetPrice(entryPx, params.stopLossPct, !long) : undefined);
        if (!tp && !sl) throw engineError("INTENT_CLARIFY", "Protect at which price (take profit or stop)?");
        for (const [kind, price] of [["tp", tp], ["sl", sl]] as const) {
          if (!price) continue;
          out.push({ ...base, kind: "order", network, destination: network, amount: { t: "none" }, trade: { market: trade.market, side: long ? "sell" : "buy", size, reduceOnly: true, trigger: { kind, price, isMarket: true } }, params: { marketKind: "perp" } });
        }
        return out;
      }
      if (params.close === true || params.reduce === true) {
        const { szi } = await positionOf(context, network, trade.market);
        const portion = Number(params.portionBps ?? 10_000);
        const absolute = szi.replace(/^-/u, "");
        const size = portion === 10_000 ? absolute : scaleDecimal(absolute, portion);
        out.push({ ...base, kind: "order", network, destination: network, amount: { t: "none" }, trade: { market: trade.market, side: szi.startsWith("-") ? "buy" : "sell", size, reduceOnly: true, ...(trade.price ? { price: trade.price } : {}) }, params: { ...params, marketKind: "perp" } });
        return out;
      }
      if (!trade.side) throw engineError("INTENT_CLARIFY", "Long or short (buy or sell)?");
      if (trade.leverage && params.marketKind !== "spot" && !trade.reduceOnly) {
        out.push({ ...base, kind: "leverage", network, destination: network, amount: { t: "none" }, trade: { market: trade.market, leverage: trade.leverage }, params: { marketKind: "perp" } });
      }
      out.push({ ...base, kind: "order", network, destination: network, amount: amount.t === "previous" ? amount : { t: "none" }, trade, params });
      return out;
    }
    case "cancel": {
      if (NETWORKS[network].vm !== "hypercore") throw engineError("ROUTE_UNSUPPORTED", "Cancels run on HyperCore.");
      const trade = tradeOf({ ...action, market: action.market ?? "*" });
      const cancel = trade.cancel ?? {};
      if (cancel.scheduleAt !== undefined || cancel.oid !== undefined || cancel.cloid !== undefined || cancel.twapId !== undefined) {
        return [{ ...base, kind: "cancel", network, destination: network, amount: { t: "none" }, trade }];
      }
      if (!action.market) throw engineError("INTENT_CLARIFY", "Cancel which orders? Name the market.");
      const open = await context.deps.core.frontendOpenOrders(network, context.owner);
      const mine = open.filter((order) => order.coin.toUpperCase() === action.market?.toUpperCase() || order.coin === action.market).slice(0, 10);
      if (mine.length === 0) throw engineError("INTENT_UNSUPPORTED", `You have no open ${action.market} orders.`);
      return mine.map((order) => ({ ...base, kind: "cancel" as const, network, destination: network, amount: { t: "none" as const }, trade: { market: order.coin, cancel: { oid: order.oid } } }));
    }
    case "leverage":
      return [{ ...base, kind: "leverage", network, destination: network, amount: { t: "none" }, trade: tradeOf(action), params: { marketKind: "perp" } }];
    case "twap":
      return [{ ...base, kind: "twap", network, destination: network, amount: { t: "none" }, trade: tradeOf(action) }];
    case "agent":
      return [{ ...base, kind: "agent", network, destination: network, amount: { t: "none" } }];
    case "alert":
    case "automation":
      throw engineError("ROUTE_UNSUPPORTED", "Alerts and automations are managed by the Elysium Agent (POST /v1/agent/automations), not planned as an intent.");
    default:
      throw engineError("ROUTE_UNSUPPORTED", `Elyia does not execute ${action.kind} actions yet.`);
  }
}

/** HyperCore USDC (or HYPE) -> native HYPE on Elysium, optionally swapped back to another asset. */
function getMeOnElysium(context: Context, action: IntentActionSpec, source: number, warnings: string[]): Omit<NormalizedAction, "after">[] {
  const { environment } = context;
  const hypercore = layer(environment, "hypercore");
  const hyperevm = layer(environment, "hyperevm");
  const elysium = layer(environment, "elysium");
  const from = (action.from ?? "USDC").toUpperCase();
  const amount = amountSpec(action);
  const out: Omit<NormalizedAction, "after">[] = [];
  if (from === "USDC") {
    if (amount.t !== "exact") throw engineError("INTENT_CLARIFY", "How much USDC should go to Elysium?");
    out.push({
      source,
      kind: "order",
      network: hypercore,
      destination: hypercore,
      amount: { t: "none" },
      trade: { market: "HYPE", side: "buy" },
      params: { marketKind: "spot", quoteAmount: amount.value },
    });
  } else if (from !== "HYPE") {
    throw engineError("ROUTE_UNSUPPORTED", "From HyperCore, Elyia brings USDC or HYPE to Elysium (as HYPE, the gas asset).");
  }
  out.push({ source, kind: "link", network: hypercore, destination: hyperevm, from: "HYPE", amount: from === "USDC" ? { t: "previous", portionBps: 10_000 } : amount, params: {} });
  out.push({ source, kind: "bridge", network: hyperevm, destination: elysium, from: "HYPE", amount: { t: "previous", portionBps: 10_000 }, gasReserve: GAS_RESERVE_WEI, params: {} });
  const target = action.to?.toUpperCase();
  if (target && target !== "HYPE") {
    const gas = typeof action.params?.gasHype === "string" ? action.params.gasHype : DEFAULT_ARRIVAL_GAS;
    out.push({ source, kind: "swap", network: elysium, destination: elysium, from: "HYPE", to: action.to as string, amount: { t: "previous", portionBps: 10_000 }, params: { arrivalGas: gas } });
    warnings.push(`Getting on Elysium: buy HYPE on HyperCore spot, move it to HyperEVM (0x2222…2222), deposit it into Elysium, then swap all but ${gas} HYPE (kept for gas) to ${action.to}.`);
  } else {
    warnings.push("Getting on Elysium: buy HYPE on HyperCore spot, move it to HyperEVM (0x2222…2222), then deposit it into Elysium, where HYPE is the gas asset.");
  }
  return out;
}

function scaleDecimal(value: string, portionBps: number): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const scale = fraction.length;
  const units = BigInt(`${whole}${fraction}`) * BigInt(portionBps) / 10_000n;
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`.replace(/\.?0+$/u, "") || "0";
}

/**
 * "bridge X HYPE to Elysium and stake (a share of) it": there is no staking
 * on Elysium, so stake that share on HyperEVM first, then bridge the HYPE
 * that is left and the kHYPE.
 */
function reorderStake(actions: readonly IntentActionSpec[], warnings: string[]): readonly IntentActionSpec[] {
  const out: IntentActionSpec[] = [];
  // Request index -> index (in `out`) of the action that now carries its output.
  const moved = new Map<number, number>();
  const remap = (action: IntentActionSpec): IntentActionSpec =>
    action.after ? { ...action, after: action.after.map((parent) => moved.get(parent) ?? Number.MAX_SAFE_INTEGER) } : action;
  for (let index = 0; index < actions.length; index += 1) {
    const bridge = actions[index] as IntentActionSpec;
    const stake = actions[index + 1];
    const bridgesHype = bridge.kind === "bridge" && NETWORKS[bridge.network].family === "hyperevm" && bridge.toNetwork !== undefined && NETWORKS[bridge.toNetwork].family === "elysium" && (bridge.from ?? "HYPE").toUpperCase() === "HYPE";
    const stakesThere = stake?.kind === "stake" && bridge.toNetwork !== undefined && stake.network === bridge.toNetwork && (stake.amount === undefined || stake.amount === "max");
    if (!bridgesHype || !stakesThere || bridge.amount === undefined || bridge.amount === "max") {
      out.push(remap(bridge));
      moved.set(index, out.length - 1);
      continue;
    }
    const portion = Number(stake?.params?.portionBps ?? 10_000);
    const staked = scaleDecimal(bridge.amount, portion);
    const rest = subtractDecimal(bridge.amount, staked);
    out.push({ kind: "stake", network: bridge.network, from: "HYPE", to: "kHYPE", amount: staked, ...(bridge.after ? { after: remap(bridge).after as number[] } : {}) });
    if (rest !== "0") out.push({ kind: "bridge", network: bridge.network, toNetwork: bridge.toNetwork, from: "HYPE", amount: rest, after: bridge.after ? (remap(bridge).after as number[]) : [] });
    out.push({ kind: "bridge", network: bridge.network, toNetwork: bridge.toNetwork, from: "kHYPE", amount: "max", after: [out.length - (rest !== "0" ? 2 : 1)] });
    warnings.push(`Kinetiq staking runs on HyperEVM, not Elysium: Elyia stakes ${staked} HYPE on HyperEVM first, then bridges ${rest !== "0" ? `the other ${rest} HYPE and ` : ""}the kHYPE to Elysium.`);
    moved.set(index, out.length - 1);
    moved.set(index + 1, out.length - 1);
    index += 1;
  }
  return out;
}

function subtractDecimal(a: string, b: string): string {
  const scale = Math.max((a.split(".")[1] ?? "").length, (b.split(".")[1] ?? "").length);
  const units = (text: string) => BigInt(text.replace(".", "") + "0".repeat(scale - (text.split(".")[1] ?? "").length));
  const diff = units(a) - units(b);
  if (diff <= 0n) return "0";
  if (scale === 0) return diff.toString();
  const digits = diff.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`.replace(/\.?0+$/u, "") || "0";
}

/** The owner's 0x address (one key on Elysium, HyperEVM and HyperCore). */
export function ownerAddress(accounts: readonly string[]): string {
  const parsed = accounts.map((account) => parseAccountId(account)).filter((value) => value !== null);
  const first = parsed[0];
  if (!first) throw engineError("ACCOUNT_REQUIRED");
  if (parsed.some((account) => account.address.toLowerCase() !== first.address.toLowerCase())) {
    throw engineError("ACCOUNT_REQUIRED", "Send one wallet address (re-homed on every network); several different owners in one intent are not supported.");
  }
  return first.address.toLowerCase();
}

export async function normalizeActions(deps: EngineDeps, environment: NetworkEnvironment, owner: string, actions: readonly IntentActionSpec[]): Promise<Normalized> {
  const warnings: string[] = [];
  const reordered = reorderStake(actions, warnings);
  const context: Context = { deps, environment, owner };
  const out: NormalizedAction[] = [];
  const lastOf = new Map<number, number>();
  for (const [index, action] of reordered.entries()) {
    if (NETWORKS[action.network].environment !== environment || (action.toNetwork && NETWORKS[action.toNetwork].environment !== environment)) throw engineError("CAPITAL_LANE_MIXED");
    const expanded = await expandOne(context, action, index, warnings);
    const after = action.after?.map((parent) => {
      const last = lastOf.get(parent);
      if (last === undefined) throw engineError("INVALID_REQUEST", "after lists indexes of earlier actions.");
      return last;
    });
    expanded.forEach((entry, position) => {
      out.push({ ...entry, ...(position === 0 && after !== undefined ? { after } : {}) });
    });
    lastOf.set(index, out.length - 1);
  }
  if (out.length > 12) throw engineError("PLAN_INVALID", "At most 12 steps are planned per intent.");
  return { actions: out, warnings };
}
