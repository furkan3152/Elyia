/**
 * HyperCore exchange actions: exact TypeScript shapes and builders.
 *
 * L1 actions (orders, cancels, leverage, TWAP...) are signed through their
 * msgpack bytes, so the KEY INSERTION ORDER of every object below is part of
 * the signature: it follows the official Python SDK (`signing.py`,
 * `exchange.py`) and, for actions the SDK lacks (`modify`, `twapOrder`,
 * `twapCancel`), the exchange endpoint docs. Builders always create objects
 * literally in that order and never spread caller input, so a stray or
 * reordered key cannot reach the hash. Optional flags the docs say must be
 * omitted when false (`f` on cancels, `a` on modifies) are only ever set to
 * `true`.
 *
 * User-signed actions (transfers, approveAgent...) are signed as EIP-712
 * typed data, where field order comes from the type lists in signing.ts.
 */
import { isEvmAddress } from "../caip.js";
import { HyperCoreWireError, isCloid, isWireDecimal, normalizeCloid, priceToWire, sizeToWire, type Cloid, type MarketInfo } from "./wire.js";

export type Tif = "Alo" | "Ioc" | "Gtc";
export type Tpsl = "tp" | "sl";
export type OrderGrouping = "na" | "normalTpsl" | "positionTpsl";
export type HyperliquidChain = "Mainnet" | "Testnet";

export interface LimitOrderTypeWire {
  readonly limit: { readonly tif: Tif };
}

export interface TriggerOrderTypeWire {
  readonly trigger: { readonly isMarket: boolean; readonly triggerPx: string; readonly tpsl: Tpsl };
}

export type OrderTypeWire = LimitOrderTypeWire | TriggerOrderTypeWire;

/** a: asset, b: isBuy, p: price, s: size, r: reduceOnly, t: type, c: cloid. */
export interface OrderWire {
  readonly a: number;
  readonly b: boolean;
  readonly p: string;
  readonly s: string;
  readonly r: boolean;
  readonly t: OrderTypeWire;
  readonly c?: Cloid;
}

/** b: builder address (lower-case), f: fee in tenths of a basis point. */
export interface BuilderFee {
  readonly b: string;
  readonly f: number;
}

export interface OrderAction {
  readonly type: "order";
  readonly orders: readonly OrderWire[];
  readonly grouping: OrderGrouping;
  readonly builder?: BuilderFee;
}

export interface CancelAction {
  readonly type: "cancel";
  readonly cancels: readonly { readonly a: number; readonly o: number }[];
  readonly f?: true;
}

export interface CancelByCloidAction {
  readonly type: "cancelByCloid";
  readonly cancels: readonly { readonly asset: number; readonly cloid: Cloid }[];
  readonly f?: true;
}

export interface ModifyAction {
  readonly type: "modify";
  readonly oid: number | Cloid;
  readonly order: OrderWire;
  readonly a?: true;
}

export interface BatchModifyAction {
  readonly type: "batchModify";
  readonly modifies: readonly { readonly oid: number | Cloid; readonly order: OrderWire }[];
  readonly a?: true;
}

export interface UpdateLeverageAction {
  readonly type: "updateLeverage";
  readonly asset: number;
  readonly isCross: boolean;
  readonly leverage: number;
}

export interface UpdateIsolatedMarginAction {
  readonly type: "updateIsolatedMargin";
  readonly asset: number;
  /** Has no effect until hedge mode exists; the exchange expects `true`. */
  readonly isBuy: true;
  /** Margin change in micro-USD (1000000 = 1 USD); negative removes margin. */
  readonly ntli: number;
}

/** a: asset, b: isBuy, s: size, r: reduceOnly, m: minutes, t: randomize. */
export interface TwapOrderAction {
  readonly type: "twapOrder";
  readonly twap: { readonly a: number; readonly b: boolean; readonly s: string; readonly r: boolean; readonly m: number; readonly t: boolean };
}

export interface TwapCancelAction {
  readonly type: "twapCancel";
  readonly a: number;
  /** TWAP id. */
  readonly t: number;
}

export interface ScheduleCancelAction {
  readonly type: "scheduleCancel";
  /** UTC ms; absent clears a scheduled cancel. */
  readonly time?: number;
}

export interface NoopAction {
  readonly type: "noop";
}

/** L1 actions Elyia builds; all are signed through the phantom agent (signing.ts). */
export type L1Action =
  | OrderAction
  | CancelAction
  | CancelByCloidAction
  | ModifyAction
  | BatchModifyAction
  | UpdateLeverageAction
  | UpdateIsolatedMarginAction
  | TwapOrderAction
  | TwapCancelAction
  | ScheduleCancelAction
  | NoopAction;

export type L1ActionType = L1Action["type"];

/**
 * L1 actions the in-browser trade-only agent key may sign. HyperCore itself
 * forbids agents to withdraw or transfer; Elyia narrows further to trading.
 */
export const AGENT_SIGNABLE_ACTIONS: readonly L1ActionType[] = Object.freeze([
  "order",
  "cancel",
  "cancelByCloid",
  "modify",
  "batchModify",
  "updateLeverage",
  "updateIsolatedMargin",
  "twapOrder",
  "twapCancel",
  "scheduleCancel",
  "noop",
]);

/**
 * L1 actions an opt-in Keeper-mode agent key (held by the Elyia server) may
 * sign: trading only. Margin moves and nonce burns stay with the
 * user's own browser agent.
 */
export const KEEPER_SIGNABLE_ACTIONS: readonly L1ActionType[] = Object.freeze([
  "order",
  "cancel",
  "cancelByCloid",
  "modify",
  "batchModify",
  "updateLeverage",
  "twapOrder",
  "twapCancel",
  "scheduleCancel",
]);

/** Agent name prefix of the Keeper key (`elyia-keeper valid_until <ms>`). */
export const KEEPER_AGENT_NAME = "elyia-keeper";
/** Keeper keys expire after at most 30 days; 7 by default. */
export const KEEPER_MAX_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
export const KEEPER_DEFAULT_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------- user-signed */

interface UserSignedBase {
  /** The wallet's chain id at signing time, as 0x hex. */
  readonly signatureChainId: `0x${string}`;
  readonly hyperliquidChain: HyperliquidChain;
}

export interface UsdSendAction extends UserSignedBase {
  readonly type: "usdSend";
  readonly destination: string;
  readonly amount: string;
  readonly time: number;
}

export interface SpotSendAction extends UserSignedBase {
  readonly type: "spotSend";
  readonly destination: string;
  /** `NAME:tokenId`, e.g. `HYPE:0x7317beb7cceed72ef0b346074cc8e7ab`. */
  readonly token: string;
  readonly amount: string;
  readonly time: number;
}

export interface Withdraw3Action extends UserSignedBase {
  readonly type: "withdraw3";
  readonly amount: string;
  readonly time: number;
  readonly destination: string;
}

export interface UsdClassTransferAction extends UserSignedBase {
  readonly type: "usdClassTransfer";
  /** USD amount; for a subaccount, `"<amount> subaccount:<address>"`. */
  readonly amount: string;
  readonly toPerp: boolean;
  readonly nonce: number;
}

export interface SendAssetAction extends UserSignedBase {
  readonly type: "sendAsset";
  readonly destination: string;
  /** "" = the default perp dex, "spot" = spot. */
  readonly sourceDex: string;
  readonly destinationDex: string;
  readonly token: string;
  readonly amount: string;
  /** Subaccount address or "". */
  readonly fromSubAccount: string;
  readonly nonce: number;
}

export interface ApproveAgentAction extends UserSignedBase {
  readonly type: "approveAgent";
  readonly agentAddress: string;
  /** Absent for the unnamed agent (signed as ""). May end with ` valid_until <ms>`. */
  readonly agentName?: string;
  readonly nonce: number;
}

export interface ApproveBuilderFeeAction extends UserSignedBase {
  readonly type: "approveBuilderFee";
  /** Percent string, e.g. "0.001%". */
  readonly maxFeeRate: string;
  readonly builder: string;
  readonly nonce: number;
}

export interface TokenDelegateAction extends UserSignedBase {
  readonly type: "tokenDelegate";
  readonly validator: string;
  /** HYPE in 1e-8 units. */
  readonly wei: number;
  readonly isUndelegate: boolean;
  readonly nonce: number;
}

export interface CDepositAction extends UserSignedBase {
  readonly type: "cDeposit";
  readonly wei: number;
  readonly nonce: number;
}

export interface CWithdrawAction extends UserSignedBase {
  readonly type: "cWithdraw";
  readonly wei: number;
  readonly nonce: number;
}

export type UserSignedAction =
  | UsdSendAction
  | SpotSendAction
  | Withdraw3Action
  | UsdClassTransferAction
  | SendAssetAction
  | ApproveAgentAction
  | ApproveBuilderFeeAction
  | TokenDelegateAction
  | CDepositAction
  | CWithdrawAction;

export type UserSignedActionType = UserSignedAction["type"];

export const USER_SIGNED_ACTION_TYPES: readonly UserSignedActionType[] = Object.freeze([
  "usdSend",
  "spotSend",
  "withdraw3",
  "usdClassTransfer",
  "sendAsset",
  "approveAgent",
  "approveBuilderFee",
  "tokenDelegate",
  "cDeposit",
  "cWithdraw",
]);

export type HyperCoreAction = L1Action | UserSignedAction;

export function isUserSignedAction(action: { readonly type: string }): action is UserSignedAction {
  return (USER_SIGNED_ACTION_TYPES as readonly string[]).includes(action.type);
}

export function isAgentSignable(action: { readonly type: string }): boolean {
  return (AGENT_SIGNABLE_ACTIONS as readonly string[]).includes(action.type);
}

export function isKeeperSignable(action: { readonly type: string }): boolean {
  return (KEEPER_SIGNABLE_ACTIONS as readonly string[]).includes(action.type);
}

/* ------------------------------------------------------------ validation */

export class HyperCoreActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HyperCoreActionError";
  }
}

function assertAsset(asset: number): void {
  if (!Number.isSafeInteger(asset) || asset < 0) throw new HyperCoreActionError(`Asset ${asset} is not a HyperCore asset id.`);
}

function assertUint(value: number, what: string, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min) throw new HyperCoreActionError(`${what} must be an integer of at least ${min}.`);
}

function assertWire(value: string, what: string): void {
  if (!isWireDecimal(value) || value === "0") throw new HyperCoreActionError(`${what} ${JSON.stringify(value)} is not a positive wire decimal (no trailing zeros).`);
}

function lowerAddress(value: string, what: string): string {
  if (!isEvmAddress(value)) throw new HyperCoreActionError(`${what} ${value} is not an address.`);
  return value.toLowerCase();
}

function oidOrCloid(oid: number | string): number | Cloid {
  if (typeof oid === "number") {
    assertUint(oid, "oid");
    return oid;
  }
  if (!isCloid(oid)) throw new HyperCoreActionError(`${oid} is neither an order id nor a cloid.`);
  return normalizeCloid(oid);
}

/* ----------------------------------------------------- L1 action builders */

export type OrderKind =
  | { readonly limit: { readonly tif: Tif } }
  | { readonly trigger: { readonly isMarket: boolean; readonly triggerPx: string; readonly tpsl: Tpsl } };

export interface OrderWireInput {
  readonly asset: number;
  readonly isBuy: boolean;
  /** Wire decimal (use priceToWire / roundPrice first). */
  readonly price: string;
  /** Wire decimal (use sizeToWire / roundSize first). */
  readonly size: string;
  readonly reduceOnly?: boolean;
  readonly kind: OrderKind;
  readonly cloid?: string;
}

function orderTypeWire(kind: OrderKind): OrderTypeWire {
  if ("limit" in kind) {
    const tif = kind.limit.tif;
    if (tif !== "Alo" && tif !== "Ioc" && tif !== "Gtc") throw new HyperCoreActionError(`Unknown time in force ${String(tif)}.`);
    return { limit: { tif } };
  }
  const trigger = kind.trigger;
  assertWire(trigger.triggerPx, "triggerPx");
  if (trigger.tpsl !== "tp" && trigger.tpsl !== "sl") throw new HyperCoreActionError(`Unknown tpsl ${String(trigger.tpsl)}.`);
  // Key order of order_type_to_wire: isMarket, triggerPx, tpsl.
  return { trigger: { isMarket: trigger.isMarket === true, triggerPx: trigger.triggerPx, tpsl: trigger.tpsl } };
}

/** One order in wire form, keys a, b, p, s, r, t[, c] (order_request_to_order_wire). */
export function orderWire(input: OrderWireInput): OrderWire {
  assertAsset(input.asset);
  assertWire(input.price, "price");
  assertWire(input.size, "size");
  const t = orderTypeWire(input.kind);
  const base = { a: input.asset, b: input.isBuy === true, p: input.price, s: input.size, r: input.reduceOnly === true, t };
  return input.cloid === undefined ? base : { ...base, c: normalizeCloid(input.cloid) };
}

export interface MarketOrderInput {
  readonly isBuy: boolean;
  readonly price: string | number;
  readonly size: string | number;
  readonly reduceOnly?: boolean;
  readonly kind:
    | { readonly limit: { readonly tif: Tif } }
    | { readonly trigger: { readonly isMarket: boolean; readonly triggerPx: string | number; readonly tpsl: Tpsl } };
  readonly cloid?: string;
}

/**
 * Order wire for a known market: formats and checks price, trigger price and
 * size against the market's tick and lot rules (throws instead of rounding).
 */
export function orderWireFor(market: MarketInfo, input: MarketOrderInput): OrderWire {
  if (market.isDelisted) throw new HyperCoreWireError("ASSET_UNKNOWN", `${market.displayName} is delisted.`);
  const price = priceToWire(input.price, market.szDecimals, market.isSpot);
  const size = sizeToWire(input.size, market.szDecimals);
  const kind: OrderKind = "limit" in input.kind
    ? { limit: { tif: input.kind.limit.tif } }
    : {
        trigger: {
          isMarket: input.kind.trigger.isMarket,
          triggerPx: priceToWire(input.kind.trigger.triggerPx, market.szDecimals, market.isSpot),
          tpsl: input.kind.trigger.tpsl,
        },
      };
  return orderWire({
    asset: market.asset,
    isBuy: input.isBuy,
    price,
    size,
    reduceOnly: input.reduceOnly === true,
    kind,
    ...(input.cloid !== undefined ? { cloid: input.cloid } : {}),
  });
}

/** Highest builder fee HyperCore accepts, in tenths of a basis point (1% on spot; perps cap at 0.1% = 100). */
export const MAX_BUILDER_FEE_TENTHS_BPS = 1_000;

/** `{type, orders, grouping[, builder]}` (order_wires_to_order_action). */
export function orderAction(orders: readonly OrderWire[], options: { readonly grouping?: OrderGrouping; readonly builder?: BuilderFee } = {}): OrderAction {
  if (orders.length === 0) throw new HyperCoreActionError("An order action needs at least one order.");
  const grouping = options.grouping ?? "na";
  if (grouping !== "na" && grouping !== "normalTpsl" && grouping !== "positionTpsl") throw new HyperCoreActionError(`Unknown grouping ${String(grouping)}.`);
  const wires = orders.map((order) => orderWire({
    asset: order.a,
    isBuy: order.b,
    price: order.p,
    size: order.s,
    reduceOnly: order.r,
    kind: order.t,
    ...(order.c !== undefined ? { cloid: order.c } : {}),
  }));
  if (!options.builder) return { type: "order", orders: wires, grouping };
  const { b, f } = options.builder;
  assertUint(f, "builder fee");
  if (f > MAX_BUILDER_FEE_TENTHS_BPS) throw new HyperCoreActionError(`Builder fee ${f} exceeds ${MAX_BUILDER_FEE_TENTHS_BPS} tenths of a basis point.`);
  return { type: "order", orders: wires, grouping, builder: { b: lowerAddress(b, "builder"), f } };
}

export function cancelAction(cancels: readonly { readonly asset: number; readonly oid: number }[], options: { readonly fast?: boolean } = {}): CancelAction {
  if (cancels.length === 0) throw new HyperCoreActionError("A cancel action needs at least one order.");
  const wires = cancels.map(({ asset, oid }) => {
    assertAsset(asset);
    assertUint(oid, "oid");
    return { a: asset, o: oid };
  });
  return options.fast === true ? { type: "cancel", cancels: wires, f: true } : { type: "cancel", cancels: wires };
}

export function cancelByCloidAction(cancels: readonly { readonly asset: number; readonly cloid: string }[], options: { readonly fast?: boolean } = {}): CancelByCloidAction {
  if (cancels.length === 0) throw new HyperCoreActionError("A cancel action needs at least one order.");
  const wires = cancels.map(({ asset, cloid }) => {
    assertAsset(asset);
    return { asset, cloid: normalizeCloid(cloid) };
  });
  return options.fast === true ? { type: "cancelByCloid", cancels: wires, f: true } : { type: "cancelByCloid", cancels: wires };
}

export function modifyAction(oid: number | string, order: OrderWire, options: { readonly alwaysPlace?: boolean } = {}): ModifyAction {
  const target = oidOrCloid(oid);
  const wire = orderAction([order]).orders[0] as OrderWire;
  return options.alwaysPlace === true ? { type: "modify", oid: target, order: wire, a: true } : { type: "modify", oid: target, order: wire };
}

export function batchModifyAction(
  modifies: readonly { readonly oid: number | string; readonly order: OrderWire }[],
  options: { readonly alwaysPlace?: boolean } = {},
): BatchModifyAction {
  if (modifies.length === 0) throw new HyperCoreActionError("A batch modify needs at least one order.");
  const wires = modifies.map((modify) => ({ oid: oidOrCloid(modify.oid), order: orderAction([modify.order]).orders[0] as OrderWire }));
  return options.alwaysPlace === true ? { type: "batchModify", modifies: wires, a: true } : { type: "batchModify", modifies: wires };
}

export function updateLeverageAction(asset: number, isCross: boolean, leverage: number): UpdateLeverageAction {
  assertAsset(asset);
  assertUint(leverage, "leverage", 1);
  return { type: "updateLeverage", asset, isCross: isCross === true, leverage };
}

/** `ntli` in micro-USD (see wire.ts `usdToMicros`); negative removes margin. */
export function updateIsolatedMarginAction(asset: number, ntli: number): UpdateIsolatedMarginAction {
  assertAsset(asset);
  if (!Number.isSafeInteger(ntli) || ntli === 0) throw new HyperCoreActionError("ntli must be a non-zero integer of micro-USD.");
  return { type: "updateIsolatedMargin", asset, isBuy: true, ntli };
}

/** HyperCore TWAP duration bounds, in minutes. */
export const TWAP_MIN_MINUTES = 5;
export const TWAP_MAX_MINUTES = 1_440;

export function twapOrderAction(input: {
  readonly asset: number;
  readonly isBuy: boolean;
  readonly size: string;
  readonly reduceOnly?: boolean;
  readonly minutes: number;
  readonly randomize?: boolean;
}): TwapOrderAction {
  assertAsset(input.asset);
  assertWire(input.size, "size");
  if (!Number.isInteger(input.minutes) || input.minutes < TWAP_MIN_MINUTES || input.minutes > TWAP_MAX_MINUTES) {
    throw new HyperCoreActionError(`A TWAP runs ${TWAP_MIN_MINUTES} to ${TWAP_MAX_MINUTES} minutes.`);
  }
  return {
    type: "twapOrder",
    twap: { a: input.asset, b: input.isBuy === true, s: input.size, r: input.reduceOnly === true, m: input.minutes, t: input.randomize === true },
  };
}

export function twapCancelAction(asset: number, twapId: number): TwapCancelAction {
  assertAsset(asset);
  assertUint(twapId, "twapId");
  return { type: "twapCancel", a: asset, t: twapId };
}

/** Dead man's switch: cancel every open order at `time` (>= now + 5 s), or clear it when absent. */
export function scheduleCancelAction(time?: number): ScheduleCancelAction {
  if (time === undefined) return { type: "scheduleCancel" };
  assertUint(time, "time");
  return { type: "scheduleCancel", time };
}

/** Marks a nonce used without doing anything (cancels a signed but unsent action). */
export function noopAction(): NoopAction {
  return { type: "noop" };
}

/* -------------------------------------------- user-signed action builders */

export interface UserSignedContext {
  readonly hyperliquidChain: HyperliquidChain;
  /** Chain id of the wallet that signs, as 0x hex (networks.ts `signatureChainIdHex`). */
  readonly signatureChainId: `0x${string}`;
}

function base(context: UserSignedContext): UserSignedContext {
  if (context.hyperliquidChain !== "Mainnet" && context.hyperliquidChain !== "Testnet") throw new HyperCoreActionError("hyperliquidChain must be Mainnet or Testnet.");
  if (!/^0x[1-9a-f][0-9a-f]*$/u.test(context.signatureChainId)) throw new HyperCoreActionError("signatureChainId must be lower-case 0x hex without leading zeros.");
  return context;
}

function amountText(amount: string, what = "amount"): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount) || /^0(?:\.0+)?$/u.test(amount)) throw new HyperCoreActionError(`${what} ${JSON.stringify(amount)} must be a positive decimal string.`);
  return amount;
}

function tokenText(token: string): string {
  if (!/^[A-Za-z0-9]{1,20}:0x[0-9a-f]{32}$/u.test(token)) throw new HyperCoreActionError(`token ${token} must be NAME:tokenId (16-byte lower-case hex).`);
  return token;
}

export function usdSendAction(context: UserSignedContext, input: { readonly destination: string; readonly amount: string; readonly time: number }): UsdSendAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.time, "time", 1);
  return { type: "usdSend", signatureChainId, hyperliquidChain, destination: lowerAddress(input.destination, "destination"), amount: amountText(input.amount), time: input.time };
}

export function spotSendAction(
  context: UserSignedContext,
  input: { readonly destination: string; readonly token: string; readonly amount: string; readonly time: number },
): SpotSendAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.time, "time", 1);
  return {
    type: "spotSend",
    signatureChainId,
    hyperliquidChain,
    destination: lowerAddress(input.destination, "destination"),
    token: tokenText(input.token),
    amount: amountText(input.amount),
    time: input.time,
  };
}

export function withdraw3Action(context: UserSignedContext, input: { readonly destination: string; readonly amount: string; readonly time: number }): Withdraw3Action {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.time, "time", 1);
  return { type: "withdraw3", signatureChainId, hyperliquidChain, amount: amountText(input.amount), time: input.time, destination: lowerAddress(input.destination, "destination") };
}

export function usdClassTransferAction(
  context: UserSignedContext,
  input: { readonly amount: string; readonly toPerp: boolean; readonly nonce: number; readonly subAccount?: string },
): UsdClassTransferAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.nonce, "nonce", 1);
  const amount = amountText(input.amount);
  const tagged = input.subAccount === undefined ? amount : `${amount} subaccount:${lowerAddress(input.subAccount, "subAccount")}`;
  return { type: "usdClassTransfer", signatureChainId, hyperliquidChain, amount: tagged, toPerp: input.toPerp === true, nonce: input.nonce };
}

export function sendAssetAction(
  context: UserSignedContext,
  input: {
    readonly destination: string;
    readonly sourceDex: string;
    readonly destinationDex: string;
    readonly token: string;
    readonly amount: string;
    readonly fromSubAccount?: string;
    readonly nonce: number;
  },
): SendAssetAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.nonce, "nonce", 1);
  const dex = (value: string) => {
    if (!/^(?:|spot|[a-z0-9]{1,16})$/u.test(value)) throw new HyperCoreActionError(`Unknown dex ${value}.`);
    return value;
  };
  return {
    type: "sendAsset",
    signatureChainId,
    hyperliquidChain,
    destination: lowerAddress(input.destination, "destination"),
    sourceDex: dex(input.sourceDex),
    destinationDex: dex(input.destinationDex),
    token: tokenText(input.token),
    amount: amountText(input.amount),
    fromSubAccount: input.fromSubAccount === undefined || input.fromSubAccount === "" ? "" : lowerAddress(input.fromSubAccount, "fromSubAccount"),
    nonce: input.nonce,
  };
}

/** Longest agent validity HyperCore allows (`valid_until` at most 180 days ahead). */
export const MAX_AGENT_VALIDITY_MS = 180 * 24 * 60 * 60 * 1000;

/** Agent name with an expiry, as HyperCore reads it: `"<name> valid_until <ms>"`. */
export function agentNameWithExpiry(name: string, validUntilMs: number, now: number = Date.now()): string {
  if (!/^[A-Za-z0-9_-]{1,16}$/u.test(name)) throw new HyperCoreActionError("Agent names are 1-16 letters, digits, - or _.");
  assertUint(validUntilMs, "validUntil", 1);
  if (validUntilMs <= now || validUntilMs - now > MAX_AGENT_VALIDITY_MS) throw new HyperCoreActionError("An agent expiry must be in the future and at most 180 days away.");
  return `${name} valid_until ${validUntilMs}`;
}

/** The Keeper agent name for an expiry no more than 30 days away. */
export function keeperAgentName(validUntilMs: number, now: number = Date.now()): string {
  if (!Number.isSafeInteger(validUntilMs) || validUntilMs - now > KEEPER_MAX_VALIDITY_MS) {
    throw new HyperCoreActionError("A Keeper key expires at most 30 days from now.");
  }
  return agentNameWithExpiry(KEEPER_AGENT_NAME, validUntilMs, now);
}

/** Splits `"<name> valid_until <ms>"` (as `extraAgents` reports names) into its parts. */
export function parseAgentName(value: string): { readonly name: string; readonly validUntil: number | null } {
  const match = /^(.*) valid_until (\d{1,16})$/u.exec(value);
  return match ? { name: match[1] ?? "", validUntil: Number(match[2]) } : { name: value, validUntil: null };
}

export function approveAgentAction(
  context: UserSignedContext,
  input: { readonly agentAddress: string; readonly agentName: string | null; readonly nonce: number },
): ApproveAgentAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.nonce, "nonce", 1);
  const agentAddress = lowerAddress(input.agentAddress, "agentAddress");
  if (input.agentName === null) return { type: "approveAgent", signatureChainId, hyperliquidChain, agentAddress, nonce: input.nonce };
  if (input.agentName.length === 0 || input.agentName.length > 64) throw new HyperCoreActionError("agentName must be 1-64 characters, or null for the unnamed agent.");
  return { type: "approveAgent", signatureChainId, hyperliquidChain, agentAddress, agentName: input.agentName, nonce: input.nonce };
}

export function approveBuilderFeeAction(
  context: UserSignedContext,
  input: { readonly builder: string; readonly maxFeeRate: string; readonly nonce: number },
): ApproveBuilderFeeAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.nonce, "nonce", 1);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?%$/u.test(input.maxFeeRate)) throw new HyperCoreActionError("maxFeeRate must be a percent string such as \"0.001%\".");
  return { type: "approveBuilderFee", signatureChainId, hyperliquidChain, maxFeeRate: input.maxFeeRate, builder: lowerAddress(input.builder, "builder"), nonce: input.nonce };
}

export function tokenDelegateAction(
  context: UserSignedContext,
  input: { readonly validator: string; readonly wei: number; readonly isUndelegate: boolean; readonly nonce: number },
): TokenDelegateAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.wei, "wei", 1);
  assertUint(input.nonce, "nonce", 1);
  return { type: "tokenDelegate", signatureChainId, hyperliquidChain, validator: lowerAddress(input.validator, "validator"), wei: input.wei, isUndelegate: input.isUndelegate === true, nonce: input.nonce };
}

export function cDepositAction(context: UserSignedContext, input: { readonly wei: number; readonly nonce: number }): CDepositAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.wei, "wei", 1);
  assertUint(input.nonce, "nonce", 1);
  return { type: "cDeposit", signatureChainId, hyperliquidChain, wei: input.wei, nonce: input.nonce };
}

export function cWithdrawAction(context: UserSignedContext, input: { readonly wei: number; readonly nonce: number }): CWithdrawAction {
  const { signatureChainId, hyperliquidChain } = base(context);
  assertUint(input.wei, "wei", 1);
  assertUint(input.nonce, "nonce", 1);
  return { type: "cWithdraw", signatureChainId, hyperliquidChain, wei: input.wei, nonce: input.nonce };
}

/** The nonce a user-signed action carries (`time` for sends and withdrawals, `nonce` otherwise). */
export function userSignedNonce(action: UserSignedAction): number {
  return "time" in action ? action.time : action.nonce;
}
