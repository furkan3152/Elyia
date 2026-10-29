/**
 * Hyperliquid wire types for the API. The info request/response types come
 * from `@elyia/core/hypercore/info` (shared with the web app and SDK). Kept
 * here: the few info requests only the server makes (exchange status for
 * health, funding history, perp dexs, ...) and the WebSocket shapes, which
 * core does not model.
 */
import type {
  AllMids,
  BookLevel,
  Candle,
  CandleInterval,
  DecimalString,
  FrontendOpenOrder,
  HexAddress,
  InfoRequest as CoreInfoRequest,
  L2Book,
  OrderStatusValue,
  PerpAssetCtx,
  RecentTrade,
  SpotAssetCtx,
} from "@elyia/core/hypercore/info";

export type * from "@elyia/core/hypercore/info";
export type { Cloid } from "@elyia/core/hypercore/wire";

/* ------------------------------------------------- server-only requests */

/** Info requests the API makes that the shared core list does not cover. */
export type ExtraInfoRequest =
  | { readonly type: "exchangeStatus" }
  | { readonly type: "perpDexs" }
  | { readonly type: "fundingHistory"; readonly coin: string; readonly startTime: number; readonly endTime?: number }
  | { readonly type: "predictedFundings" }
  | { readonly type: "activeAssetData"; readonly user: string; readonly coin: string }
  | { readonly type: "userFees"; readonly user: string }
  | { readonly type: "subAccounts"; readonly user: string };

export type InfoRequest = CoreInfoRequest | ExtraInfoRequest;
export type InfoRequestType = InfoRequest["type"];

export interface ExchangeStatus {
  readonly time: number;
  readonly specialStatuses: unknown;
}

export interface PerpDex {
  readonly name: string;
  readonly fullName: string;
  readonly deployer: HexAddress;
  readonly oracleUpdater: HexAddress | null;
  readonly feeRecipient?: HexAddress | null;
}

export interface FundingRecord {
  readonly coin: string;
  readonly fundingRate: DecimalString;
  readonly premium: DecimalString;
  readonly time: number;
}

/** [coin, [[venue, prediction | null]]] as HL sends it. */
export type PredictedFundings = ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [string, { readonly fundingRate: DecimalString; readonly nextFundingTime: number; readonly fundingIntervalHours?: number } | null]>]
>;

export interface ActiveAssetData {
  readonly user: HexAddress;
  readonly coin: string;
  readonly leverage: { readonly type: "cross" | "isolated"; readonly value: number };
  readonly maxTradeSzs: readonly [DecimalString, DecimalString];
  readonly availableToTrade: readonly [DecimalString, DecimalString];
  readonly markPx?: DecimalString;
}

/** One entry of `historicalOrders`. */
export interface HistoricalOrder {
  readonly order: FrontendOpenOrder;
  readonly status: OrderStatusValue;
  readonly statusTimestamp: number;
}

/* ---------------------------------------------------------- websocket */

export type WsSubscription =
  | { readonly type: "allMids"; readonly dex?: string }
  | { readonly type: "trades"; readonly coin: string }
  | { readonly type: "l2Book"; readonly coin: string; readonly nSigFigs?: 2 | 3 | 4 | 5 | null; readonly mantissa?: 1 | 2 | 5 | null }
  | { readonly type: "candle"; readonly coin: string; readonly interval: CandleInterval }
  | { readonly type: "bbo"; readonly coin: string }
  | { readonly type: "activeAssetCtx"; readonly coin: string }
  | { readonly type: "activeAssetData"; readonly user: string; readonly coin: string }
  | { readonly type: "orderUpdates"; readonly user: string }
  | { readonly type: "userEvents"; readonly user: string }
  | { readonly type: "userFills"; readonly user: string; readonly aggregateByTime?: boolean }
  | { readonly type: "userFundings"; readonly user: string }
  | { readonly type: "userNonFundingLedgerUpdates"; readonly user: string }
  | { readonly type: "webData2"; readonly user: string }
  | { readonly type: "notification"; readonly user: string }
  | { readonly type: "userTwapSliceFills"; readonly user: string }
  | { readonly type: "userTwapHistory"; readonly user: string };

export type WsSubscriptionType = WsSubscription["type"];

/** A trade print on the `trades` channel (same shape as an info `recentTrades` entry). */
export type WsTrade = RecentTrade;

export interface WsBbo {
  readonly coin: string;
  readonly time: number;
  readonly bbo: readonly [BookLevel | null, BookLevel | null];
}

export interface WsActiveAssetCtx {
  readonly coin: string;
  readonly ctx: PerpAssetCtx | SpotAssetCtx;
}

/** The `data` payload a listener receives for each subscription type. */
export type WsDataFor<S extends WsSubscription> = S extends { type: "allMids" }
  ? { readonly mids: AllMids; readonly dex?: string }
  : S extends { type: "trades" }
    ? readonly WsTrade[]
    : S extends { type: "l2Book" }
      ? L2Book
      : S extends { type: "candle" }
        ? Candle
        : S extends { type: "bbo" }
          ? WsBbo
          : S extends { type: "activeAssetCtx" }
            ? WsActiveAssetCtx
            : S extends { type: "activeAssetData" }
              ? ActiveAssetData
              : unknown;
