/**
 * Types for the HyperCore info API (`POST {apiUrl}/info`) responses Elyia
 * reads, and for `/exchange` responses. Shapes were confirmed by calling
 * https://api.hyperliquid-testnet.xyz/info on 2026-10-29 and against the
 * Hyperliquid docs. Numbers the API sends as strings stay strings (decimal
 * text, never parsed into floats here).
 *
 * The API grows fields over time; consumers must tolerate extra ones.
 */
import type { Cloid } from "./wire.js";

/** Decimal number encoded as a string ("79660.0"). */
export type DecimalString = string;
/** 0x address (lower-case as the API returns it). */
export type HexAddress = `0x${string}`;
/** Book side: "B" bid / buy, "A" ask / sell. */
export type BookSide = "A" | "B";

/* ------------------------------------------------------------ requests */

export type InfoRequest =
  | { readonly type: "meta"; readonly dex?: string }
  | { readonly type: "metaAndAssetCtxs"; readonly dex?: string }
  | { readonly type: "spotMeta" }
  | { readonly type: "spotMetaAndAssetCtxs" }
  | { readonly type: "allMids"; readonly dex?: string }
  | { readonly type: "l2Book"; readonly coin: string; readonly nSigFigs?: 2 | 3 | 4 | 5 | null; readonly mantissa?: 1 | 2 | 5 | null }
  | { readonly type: "recentTrades"; readonly coin: string }
  | { readonly type: "candleSnapshot"; readonly req: { readonly coin: string; readonly interval: CandleInterval; readonly startTime: number; readonly endTime?: number } }
  | { readonly type: "clearinghouseState"; readonly user: string; readonly dex?: string }
  | { readonly type: "spotClearinghouseState"; readonly user: string }
  | { readonly type: "openOrders"; readonly user: string; readonly dex?: string }
  | { readonly type: "frontendOpenOrders"; readonly user: string; readonly dex?: string }
  | { readonly type: "userFills"; readonly user: string; readonly aggregateByTime?: boolean }
  | { readonly type: "userFillsByTime"; readonly user: string; readonly startTime: number; readonly endTime?: number; readonly aggregateByTime?: boolean }
  | { readonly type: "userFunding"; readonly user: string; readonly startTime: number; readonly endTime?: number }
  | { readonly type: "userNonFundingLedgerUpdates"; readonly user: string; readonly startTime: number; readonly endTime?: number }
  | { readonly type: "orderStatus"; readonly user: string; readonly oid: number | Cloid }
  | { readonly type: "historicalOrders"; readonly user: string }
  | { readonly type: "extraAgents"; readonly user: string }
  | { readonly type: "userRole"; readonly user: string }
  | { readonly type: "delegatorSummary"; readonly user: string }
  | { readonly type: "delegations"; readonly user: string }
  | { readonly type: "vaultDetails"; readonly vaultAddress: string; readonly user?: string }
  | { readonly type: "userVaultEquities"; readonly user: string }
  | { readonly type: "portfolio"; readonly user: string }
  | { readonly type: "userRateLimit"; readonly user: string };

export type CandleInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

export const CANDLE_INTERVALS: readonly CandleInterval[] = Object.freeze(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]);

/* --------------------------------------------------------- market data */

export interface MarginTier {
  readonly lowerBound: DecimalString;
  readonly maxLeverage: number;
}

export interface PerpAssetMeta {
  readonly name: string;
  readonly szDecimals: number;
  readonly maxLeverage: number;
  readonly marginTableId?: number;
  readonly onlyIsolated?: boolean;
  readonly isDelisted?: boolean;
  /** e.g. "strictIsolated", "noCross" on newer assets. */
  readonly marginMode?: string;
}

export interface PerpMeta {
  readonly universe: readonly PerpAssetMeta[];
  readonly marginTables?: readonly (readonly [number, { readonly description: string; readonly marginTiers: readonly MarginTier[] }])[];
  /** Spot token index of the collateral (0 = USDC). */
  readonly collateralToken?: number;
}

export interface PerpAssetCtx {
  readonly funding: DecimalString;
  readonly openInterest: DecimalString;
  readonly prevDayPx: DecimalString;
  readonly dayNtlVlm: DecimalString;
  readonly premium: DecimalString | null;
  readonly oraclePx: DecimalString;
  readonly markPx: DecimalString;
  readonly midPx: DecimalString | null;
  readonly impactPxs: readonly [DecimalString, DecimalString] | null;
  readonly dayBaseVlm: DecimalString;
}

export type MetaAndAssetCtxs = readonly [PerpMeta, readonly PerpAssetCtx[]];

export interface SpotTokenEvmContract {
  readonly address: HexAddress;
  /** EVM decimals = weiDecimals + this (may be negative). */
  readonly evm_extra_wei_decimals: number;
}

export interface SpotToken {
  readonly name: string;
  readonly szDecimals: number;
  readonly weiDecimals: number;
  readonly index: number;
  readonly tokenId: `0x${string}`;
  readonly isCanonical: boolean;
  readonly evmContract: SpotTokenEvmContract | null;
  readonly fullName: string | null;
  readonly deployerTradingFeeShare?: DecimalString;
  readonly deployerLabel?: string;
}

export interface SpotPair {
  /** Book coin: "PURR/USDC" for canonical pairs, "@<index>" otherwise. */
  readonly name: string;
  /** [base token index, quote token index]. */
  readonly tokens: readonly [number, number];
  readonly index: number;
  readonly isCanonical: boolean;
}

export interface SpotMeta {
  readonly universe: readonly SpotPair[];
  readonly tokens: readonly SpotToken[];
}

export interface SpotAssetCtx {
  readonly coin: string;
  readonly prevDayPx: DecimalString;
  readonly dayNtlVlm: DecimalString;
  readonly markPx: DecimalString;
  readonly midPx: DecimalString | null;
  readonly circulatingSupply: DecimalString;
  readonly totalSupply: DecimalString;
  readonly dayBaseVlm: DecimalString;
}

export type SpotMetaAndAssetCtxs = readonly [SpotMeta, readonly SpotAssetCtx[]];

/** Coin -> mid. Keys include perps ("BTC"), spot books ("@1035", "PURR/USDC") and outcome markets ("#102170"). */
export type AllMids = Readonly<Record<string, DecimalString>>;

export interface BookLevel {
  readonly px: DecimalString;
  readonly sz: DecimalString;
  /** Number of orders at the level. */
  readonly n: number;
}

export interface L2Book {
  readonly coin: string;
  readonly time: number;
  /** [bids (best first), asks (best first)]. */
  readonly levels: readonly [readonly BookLevel[], readonly BookLevel[]];
}

export interface RecentTrade {
  readonly coin: string;
  /** Aggressor side. */
  readonly side: BookSide;
  readonly px: DecimalString;
  readonly sz: DecimalString;
  readonly time: number;
  readonly hash: `0x${string}`;
  readonly tid: number;
  /** [buyer, seller]. */
  readonly users: readonly [HexAddress, HexAddress];
}

export interface Candle {
  /** Open time (ms). */
  readonly t: number;
  /** Close time (ms). */
  readonly T: number;
  readonly s: string;
  readonly i: CandleInterval;
  readonly o: DecimalString;
  readonly c: DecimalString;
  readonly h: DecimalString;
  readonly l: DecimalString;
  /** Base volume. */
  readonly v: DecimalString;
  /** Trade count. */
  readonly n: number;
}

/* -------------------------------------------------------------- accounts */

export interface MarginSummary {
  readonly accountValue: DecimalString;
  readonly totalNtlPos: DecimalString;
  readonly totalRawUsd: DecimalString;
  readonly totalMarginUsed: DecimalString;
}

export interface PerpPositionState {
  readonly coin: string;
  /** Signed size: positive long, negative short. */
  readonly szi: DecimalString;
  readonly leverage: { readonly type: "cross"; readonly value: number } | { readonly type: "isolated"; readonly value: number; readonly rawUsd: DecimalString };
  readonly entryPx: DecimalString;
  readonly positionValue: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly returnOnEquity: DecimalString;
  readonly liquidationPx: DecimalString | null;
  readonly marginUsed: DecimalString;
  readonly maxLeverage: number;
  readonly cumFunding: { readonly allTime: DecimalString; readonly sinceOpen: DecimalString; readonly sinceChange: DecimalString };
}

export interface AssetPosition {
  readonly type: "oneWay";
  readonly position: PerpPositionState;
}

export interface ClearinghouseState {
  readonly marginSummary: MarginSummary;
  readonly crossMarginSummary: MarginSummary;
  readonly crossMaintenanceMarginUsed: DecimalString;
  readonly withdrawable: DecimalString;
  readonly assetPositions: readonly AssetPosition[];
  readonly time: number;
}

export interface SpotBalance {
  readonly coin: string;
  /** Spot token index. */
  readonly token: number;
  readonly total: DecimalString;
  /** Reserved by open orders. */
  readonly hold: DecimalString;
  readonly entryNtl: DecimalString;
}

export interface SpotClearinghouseState {
  readonly balances: readonly SpotBalance[];
}

export interface OpenOrder {
  readonly coin: string;
  readonly side: BookSide;
  readonly limitPx: DecimalString;
  /** Remaining size. */
  readonly sz: DecimalString;
  readonly oid: number;
  readonly timestamp: number;
  readonly origSz: DecimalString;
  readonly cloid?: Cloid | null;
  readonly reduceOnly?: boolean;
}

export type FrontendOrderType = "Limit" | "Market" | "Stop Market" | "Stop Limit" | "Take Profit Market" | "Take Profit Limit" | (string & {});

export interface FrontendOpenOrder extends OpenOrder {
  readonly triggerCondition: string;
  readonly isTrigger: boolean;
  readonly triggerPx: DecimalString;
  readonly children: readonly FrontendOpenOrder[];
  readonly isPositionTpsl: boolean;
  readonly reduceOnly: boolean;
  readonly orderType: FrontendOrderType;
  /** null for trigger orders. */
  readonly tif: "Gtc" | "Ioc" | "Alo" | "FrontendMarket" | "LiquidationMarket" | null;
  readonly cloid: Cloid | null;
}

export interface UserFill {
  readonly coin: string;
  readonly px: DecimalString;
  readonly sz: DecimalString;
  readonly side: BookSide;
  readonly time: number;
  readonly startPosition: DecimalString;
  /** "Open Long", "Close Short", "Buy", "Sell", "Long > Short", ... */
  readonly dir: string;
  readonly closedPnl: DecimalString;
  readonly hash: `0x${string}`;
  readonly oid: number;
  /** True when the fill took liquidity. */
  readonly crossed: boolean;
  /** Negative = rebate. */
  readonly fee: DecimalString;
  readonly tid: number;
  readonly feeToken: string;
  readonly twapId: number | null;
  readonly cloid?: Cloid | null;
  readonly builderFee?: DecimalString;
  readonly liquidation?: { readonly liquidatedUser: HexAddress | null; readonly markPx: DecimalString; readonly method: string };
}

export interface FundingDelta {
  readonly type: "funding";
  readonly coin: string;
  /** USDC paid (negative) or received (positive). */
  readonly usdc: DecimalString;
  readonly szi: DecimalString;
  readonly fundingRate: DecimalString;
  readonly nSamples: number | null;
}

export interface UserFundingEntry {
  readonly time: number;
  readonly hash: `0x${string}`;
  readonly delta: FundingDelta;
}

/* Ledger deltas seen on testnet, plus documented ones; `type` discriminates. */
export type LedgerDelta =
  | { readonly type: "deposit"; readonly usdc: DecimalString }
  | { readonly type: "withdraw"; readonly usdc: DecimalString; readonly nonce: number; readonly fee: DecimalString }
  | { readonly type: "accountClassTransfer"; readonly usdc: DecimalString; readonly toPerp: boolean }
  | { readonly type: "internalTransfer"; readonly usdc: DecimalString; readonly user: HexAddress; readonly destination: HexAddress; readonly fee: DecimalString }
  | {
      readonly type: "spotTransfer";
      readonly token: string;
      readonly amount: DecimalString;
      readonly usdcValue: DecimalString;
      readonly user: HexAddress;
      readonly destination: HexAddress;
      readonly fee: DecimalString;
      readonly nativeTokenFee?: DecimalString;
      readonly nonce?: number | null;
    }
  | {
      readonly type: "send";
      readonly user: HexAddress;
      readonly destination: HexAddress;
      readonly sourceDex: string;
      readonly destinationDex: string;
      readonly token: string;
      readonly amount: DecimalString;
      readonly usdcValue: DecimalString;
      readonly fee: DecimalString;
      readonly nativeTokenFee: DecimalString;
      readonly nonce: number | null;
      readonly feeToken: string;
    }
  | { readonly type: "vaultCreate"; readonly vault: HexAddress; readonly usdc: DecimalString; readonly fee: DecimalString }
  | { readonly type: "vaultDeposit"; readonly vault: HexAddress; readonly usdc: DecimalString }
  | {
      readonly type: "vaultWithdraw";
      readonly vault: HexAddress;
      readonly user: HexAddress;
      readonly requestedUsd: DecimalString;
      readonly commission: DecimalString;
      readonly closingCost: DecimalString;
      readonly basis: DecimalString;
      readonly netWithdrawnUsd: DecimalString;
    }
  | { readonly type: "cStakingTransfer"; readonly token: string; readonly amount: DecimalString; readonly isDeposit: boolean }
  | {
      readonly type: "liquidation";
      readonly liquidatedNtlPos: DecimalString;
      readonly accountValue: DecimalString;
      readonly leverageType: "Cross" | "Isolated";
      readonly liquidatedPositions: readonly { readonly coin: string; readonly szi: DecimalString }[];
    }
  | { readonly type: "rewardsClaim"; readonly amount: DecimalString };

export type LedgerDeltaType = LedgerDelta["type"];

export interface LedgerUpdate {
  readonly time: number;
  /** L1 transaction hash; usable as evidence. */
  readonly hash: `0x${string}`;
  readonly delta: LedgerDelta | { readonly type: string; readonly [key: string]: unknown };
}

/* ------------------------------------------------------------- orders */

export type OrderStatusValue =
  | "open"
  | "filled"
  | "canceled"
  | "triggered"
  | "rejected"
  | "marginCanceled"
  | "vaultWithdrawalCanceled"
  | "openInterestCapCanceled"
  | "selfTradeCanceled"
  | "reduceOnlyCanceled"
  | "siblingFilledCanceled"
  | "delistedCanceled"
  | "liquidatedCanceled"
  | "scheduledCancel"
  | "tickRejected"
  | "minTradeNtlRejected"
  | "perpMarginRejected"
  | "reduceOnlyRejected"
  | "badAloPxRejected"
  | "iocCancelRejected"
  | "badTriggerPxRejected"
  | "marketOrderNoLiquidityRejected"
  | "positionIncreaseAtOpenInterestCapRejected"
  | "positionFlipAtOpenInterestCapRejected"
  | "tooAggressiveAtOpenInterestCapRejected"
  | "openInterestIncreaseRejected"
  | "insufficientSpotBalanceRejected"
  | "oracleRejected"
  | "perpMaxPositionRejected";

/** Statuses after which the order will never fill further. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatusValue[] = Object.freeze([
  "filled", "canceled", "rejected", "marginCanceled", "vaultWithdrawalCanceled", "openInterestCapCanceled", "selfTradeCanceled",
  "reduceOnlyCanceled", "siblingFilledCanceled", "delistedCanceled", "liquidatedCanceled", "scheduledCancel", "tickRejected",
  "minTradeNtlRejected", "perpMarginRejected", "reduceOnlyRejected", "badAloPxRejected", "iocCancelRejected", "badTriggerPxRejected",
  "marketOrderNoLiquidityRejected", "positionIncreaseAtOpenInterestCapRejected", "positionFlipAtOpenInterestCapRejected",
  "tooAggressiveAtOpenInterestCapRejected", "openInterestIncreaseRejected", "insufficientSpotBalanceRejected", "oracleRejected",
  "perpMaxPositionRejected",
]);

export function isTerminalOrderStatus(status: string): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/** True for statuses where the exchange refused the order at placement (`...Rejected`, `rejected`). */
export function isRejectedOrderStatus(status: string): boolean {
  return status === "rejected" || status.endsWith("Rejected");
}

export type OrderStatusResponse =
  | { readonly status: "order"; readonly order: { readonly order: FrontendOpenOrder; readonly status: OrderStatusValue; readonly statusTimestamp: number } }
  | { readonly status: "unknownOid" };

/* ----------------------------------------------- agents, staking, vaults */

export interface ExtraAgent {
  readonly name: string;
  readonly address: HexAddress;
  /** Expiry (ms). */
  readonly validUntil: number;
}

export interface UserRole {
  readonly role: "user" | "agent" | "vault" | "subAccount" | "missing" | (string & {});
  readonly data?: { readonly user?: HexAddress; readonly master?: HexAddress };
}

export interface DelegatorSummary {
  readonly delegated: DecimalString;
  readonly undelegated: DecimalString;
  readonly totalPendingWithdrawal: DecimalString;
  readonly nPendingWithdrawals: number;
}

export interface Delegation {
  readonly validator: HexAddress;
  readonly amount: DecimalString;
  readonly lockedUntilTimestamp: number;
}

export type PortfolioPeriod = "day" | "week" | "month" | "allTime" | "perpDay" | "perpWeek" | "perpMonth" | "perpAllTime";

export interface PortfolioHistory {
  /** [ms, accountValue]. */
  readonly accountValueHistory: readonly (readonly [number, DecimalString])[];
  /** [ms, cumulative pnl]. */
  readonly pnlHistory: readonly (readonly [number, DecimalString])[];
  readonly vlm: DecimalString;
}

export type Portfolio = readonly (readonly [PortfolioPeriod, PortfolioHistory])[];

export interface VaultFollower {
  readonly user: HexAddress;
  readonly vaultEquity: DecimalString;
  readonly pnl: DecimalString;
  readonly allTimePnl: DecimalString;
  readonly daysFollowing: number;
  readonly vaultEntryTime: number;
  readonly lockupUntil: number;
}

export interface VaultDetails {
  readonly name: string;
  readonly vaultAddress: HexAddress;
  readonly leader: HexAddress;
  readonly description: string;
  readonly portfolio: Portfolio;
  /** Annualised, as a fraction (0.049 = 4.9%). */
  readonly apr: number;
  readonly followerState: VaultFollower | null;
  readonly leaderFraction: number;
  readonly leaderCommission: number;
  readonly followers: readonly VaultFollower[];
  readonly maxDistributable: number;
  readonly maxWithdrawable: number;
  readonly isClosed: boolean;
  readonly relationship: { readonly type: "normal" } | { readonly type: "parent"; readonly data: { readonly childAddresses: readonly HexAddress[] } } | { readonly type: "child"; readonly data: { readonly parentAddress: HexAddress } };
  readonly allowDeposits: boolean;
  readonly alwaysCloseOnWithdraw: boolean;
}

export interface UserVaultEquity {
  readonly vaultAddress: HexAddress;
  readonly equity: DecimalString;
  readonly lockedUntilTimestamp: number;
}

export interface UserRateLimit {
  readonly cumVlm: DecimalString;
  readonly nRequestsUsed: number;
  readonly nRequestsCap: number;
  readonly nRequestsSurplus?: number;
}

/* ----------------------------------------------------- /exchange replies */

export type OrderPlacementStatus =
  | { readonly resting: { readonly oid: number; readonly cloid?: Cloid } }
  | { readonly filled: { readonly totalSz: DecimalString; readonly avgPx: DecimalString; readonly oid: number; readonly cloid?: Cloid } }
  | { readonly error: string }
  | "waitingForFill"
  | "waitingForTrigger";

export type ExchangeResponse =
  | { readonly status: "ok"; readonly response: { readonly type: "order"; readonly data: { readonly statuses: readonly OrderPlacementStatus[] } } }
  | { readonly status: "ok"; readonly response: { readonly type: "cancel" | "cancelByCloid"; readonly data: { readonly statuses: readonly ("success" | { readonly error: string })[] } } }
  | { readonly status: "ok"; readonly response: { readonly type: "twapOrder"; readonly data: { readonly status: { readonly running: { readonly twapId: number } } | { readonly error: string } } } }
  | { readonly status: "ok"; readonly response: { readonly type: "twapCancel"; readonly data: { readonly status: "success" | { readonly error: string } } } }
  | { readonly status: "ok"; readonly response: { readonly type: "default" | (string & {}); readonly data?: unknown } }
  | { readonly status: "err"; readonly response: string };

/**
 * Per-order outcome of an `/exchange` order reply. An exchange reply is a
 * hint, never proof: verification re-reads `orderStatus` / fills.
 */
export function orderPlacementOutcomes(
  response: ExchangeResponse,
): readonly ({ readonly kind: "resting"; readonly oid: number } | { readonly kind: "filled"; readonly oid: number; readonly totalSz: string; readonly avgPx: string } | { readonly kind: "error"; readonly message: string } | { readonly kind: "waiting" })[] {
  if (response.status === "err") return [{ kind: "error", message: response.response }];
  const body = response.response;
  if (body.type !== "order" || !body.data || typeof body.data !== "object" || !("statuses" in body.data)) return [];
  return (body.data.statuses as readonly OrderPlacementStatus[]).map((status) => {
    if (typeof status === "string") return { kind: "waiting" as const };
    if ("resting" in status) return { kind: "resting" as const, oid: status.resting.oid };
    if ("filled" in status) return { kind: "filled" as const, oid: status.filled.oid, totalSz: status.filled.totalSz, avgPx: status.filled.avgPx };
    return { kind: "error" as const, message: status.error };
  });
}
