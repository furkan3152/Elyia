/**
 * Wire contract of the markets endpoints (HyperCore market data, funding,
 * reference prices, vaults and the whale liquidation map). Import as
 * `@elyia/core/api/markets`.
 *
 * Conventions:
 * - Venue numbers HyperCore sends as decimal strings stay strings (`markPx`,
 *   `openInterest`, book levels). Derived metrics (percent, USD, APR) are numbers.
 * - `null` means unknown or not applicable, never zero.
 * - Testnet volumes, open interest and PnL are in test USDC: real for the
 *   venue, worth nothing. USD *reference* prices always come from HyperCore
 *   mainnet and say so (`PriceSource`).
 */
import type { NetworkKey } from "../networks.js";

export type HyperCoreNetworkKey = Extract<NetworkKey, "hypercore-testnet" | "hypercore-mainnet">;
export type MarketType = "perp" | "spot";
/** `?type=` of GET /v1/markets. */
export type MarketTypeFilter = MarketType | "all";

/* -------------------------------------------------------------- markets */

/** One market row: GET /v1/markets, GET /v1/markets/:coin. */
export interface MarketRow {
  /** Order-book coin: `BTC`, `xyz:TSLA` (HIP-3), `@1035` or `PURR/USDC` (spot). */
  readonly coin: string;
  /** What a person reads: `BTC`, `xyz:TSLA`, `HYPE/USDC`. */
  readonly displayName: string;
  readonly type: MarketType;
  /** Perp dex: `""` for the first (validator-run) dex, the HIP-3 dex name otherwise; null for spot. */
  readonly dex: string | null;
  /** HyperCore asset id for orders: perp index, `10000 + spot index`, or `100000 + dexIndex * 10000 + index` for HIP-3. */
  readonly assetId: number;
  /** Base asset name (`BTC`, `TSLA`, `HYPE`). */
  readonly base: string;
  /** Quote or collateral token name (`USDC`, `USDH`). */
  readonly quote: string;
  readonly szDecimals: number;
  /** Perps only. */
  readonly maxLeverage: number | null;
  readonly onlyIsolated: boolean;
  readonly isDelisted: boolean;
  readonly markPx: string | null;
  readonly midPx: string | null;
  /** Perps only. */
  readonly oraclePx: string | null;
  readonly prevDayPx: string | null;
  /** Mark versus the price 24 h ago, in percent. */
  readonly change24hPct: number | null;
  /** Current funding rate per hour as HyperCore reports it (perps only; HyperCore pays funding hourly). */
  readonly fundingHourly: string | null;
  /** `fundingHourly * 24 * 365 * 100`. */
  readonly fundingAprPct: number | null;
  /** Open interest in base units (perps only). */
  readonly openInterest: string | null;
  /** Open interest times mark, in the quote currency counted as USD (see `quoteUsd`). */
  readonly openInterestUsd: number | null;
  /** 24 h notional volume in the quote currency. */
  readonly volume24hQuote: string | null;
  readonly volume24hUsd: number | null;
  /** USD value of one quote unit used for `*Usd` fields (1 for USDC), or null when unknown. */
  readonly quoteUsd: number | null;
  /** [bid impact, ask impact] prices (perps only). */
  readonly impactPxs: readonly [string, string] | null;
  /** Perps only. */
  readonly premium: string | null;
}

/** A builder-deployed (HIP-3) perp dex. */
export interface PerpDexSummary {
  readonly name: string;
  readonly fullName: string;
  /** Index in `perpDexs` (asset ids start at `100000 + index * 10000`). */
  readonly index: number;
  /** Markets listed in its meta, delisted included. */
  readonly markets: number;
  readonly liveMarkets: number;
  /** Collateral token name, when resolvable. */
  readonly collateral: string | null;
  /** Collateral spot token index (0 = USDC), when the dex meta states it. */
  readonly collateralToken: number | null;
}

export interface MarketsResponse {
  readonly network: HyperCoreNetworkKey;
  readonly type: MarketTypeFilter;
  /** `null` = the first dex; a HIP-3 dex name; or `"all"`. */
  readonly dex: string | null;
  readonly generatedAt: number;
  /** Rows matching the filter before `limit`. */
  readonly total: number;
  readonly count: number;
  /** Sorted by 24 h USD volume (unknown last), then open interest. */
  readonly markets: readonly MarketRow[];
  /** HIP-3 dexes on this network (pick one with `?dex=`). */
  readonly dexes: readonly PerpDexSummary[];
  /** HIP-3 dexes left out of `dex=all` (only that many are fetched per request). */
  readonly dexesOmitted: number;
  readonly notes: readonly string[];
}

export interface MarginTierView {
  /** Position value (quote) from which this tier applies. */
  readonly lowerBoundUsd: number;
  readonly maxLeverage: number;
  /** Maintenance margin rate: half the initial margin at max leverage (`1 / (2 * maxLeverage)`). */
  readonly maintenanceMarginRate: number;
  /** Deduction that keeps the maintenance requirement continuous across tiers. */
  readonly maintenanceDeductionUsd: number;
}

export interface SpotTokenView {
  readonly name: string;
  readonly index: number;
  readonly tokenId: string;
  readonly szDecimals: number;
  readonly weiDecimals: number;
  readonly fullName: string | null;
  /** Linked HyperEVM contract, when the token is linked. */
  readonly evmContract: string | null;
  readonly isCanonical: boolean;
}

/** GET /v1/markets/:coin. */
export interface MarketDetailResponse {
  readonly network: HyperCoreNetworkKey;
  readonly generatedAt: number;
  readonly market: MarketRow;
  /** Perps: the margin tiers of the market's margin table (one tier when the table is flat). */
  readonly marginTiers: readonly MarginTierView[] | null;
  readonly spot: { readonly base: SpotTokenView; readonly quote: SpotTokenView } | null;
}

export interface BookLevelView {
  readonly px: string;
  readonly sz: string;
  /** Orders at the level. */
  readonly n: number;
  /** Cumulative size from the top of the book. */
  readonly cumSz: number;
}

/** GET /v1/markets/:coin/book. */
export interface BookResponse {
  readonly network: HyperCoreNetworkKey;
  readonly coin: string;
  readonly time: number;
  readonly nSigFigs: 2 | 3 | 4 | 5 | null;
  readonly mantissa: 1 | 2 | 5 | null;
  readonly bids: readonly BookLevelView[];
  readonly asks: readonly BookLevelView[];
  readonly bestBid: string | null;
  readonly bestAsk: string | null;
  readonly mid: number | null;
  readonly spread: number | null;
  readonly spreadBps: number | null;
  /** `ws`: the shared live feed; `info`: a REST snapshot. */
  readonly source: "ws" | "info";
}

export type TradeSide = "buy" | "sell";

export interface TradeView {
  readonly px: string;
  readonly sz: string;
  /** Aggressor side. */
  readonly side: TradeSide;
  readonly time: number;
  readonly tid: number;
  readonly hash: string;
}

/** GET /v1/markets/:coin/trades (newest first). */
export interface TradesResponse {
  readonly network: HyperCoreNetworkKey;
  readonly coin: string;
  readonly trades: readonly TradeView[];
  /** `tape`: the server's live WebSocket tape; `info`: a REST snapshot. */
  readonly source: "tape" | "info";
}

export type CandleIntervalParam = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "12h" | "1d";

export interface CandleView {
  /** Open time (ms). */
  readonly t: number;
  /** Close time (ms). */
  readonly T: number;
  readonly o: string;
  readonly h: string;
  readonly l: string;
  readonly c: string;
  /** Base volume. */
  readonly v: string;
  /** Trades. */
  readonly n: number;
}

/** GET /v1/markets/:coin/candles. */
export interface CandlesResponse {
  readonly network: HyperCoreNetworkKey;
  readonly coin: string;
  readonly interval: CandleIntervalParam;
  readonly from: number;
  readonly to: number;
  readonly candles: readonly CandleView[];
  /** True when the requested range was longer than one request may cover and `from` was moved forward. */
  readonly truncated: boolean;
}

/* ---------------------------------------------------- market stream (SSE) */

export type MarketStreamChannel = "mids" | "trades" | "book";

/** SSE event names of GET /v1/markets/stream. */
export const MARKET_STREAM_EVENTS = Object.freeze({
  ready: "ready",
  mids: "mids",
  trades: "trades",
  book: "book",
  dropped: "dropped",
  error: "error",
} as const);

export interface MarketStreamReady {
  readonly network: HyperCoreNetworkKey;
  readonly coins: readonly string[];
  readonly channels: readonly MarketStreamChannel[];
  readonly maxCoins: number;
}

export interface MarketStreamMids {
  readonly time: number;
  /** Coin -> mid, for the subscribed coins that changed. */
  readonly mids: Readonly<Record<string, string>>;
}

export interface MarketStreamTrades {
  readonly coin: string;
  /** Oldest first. */
  readonly trades: readonly TradeView[];
}

export interface MarketStreamBook {
  readonly coin: string;
  readonly time: number;
  readonly bids: readonly BookLevelView[];
  readonly asks: readonly BookLevelView[];
}

/** Sent when a slow client lost trade prints (oldest first are dropped). */
export interface MarketStreamDropped {
  readonly trades: number;
}

export interface MarketStreamError {
  readonly coin: string | null;
  readonly channel: MarketStreamChannel | null;
  readonly code: string;
  readonly message: string;
}

/* --------------------------------------------------------------- funding */

export type FundingVenue = "hyperliquid" | "binance" | "bybit" | (string & {});

export interface VenueFunding {
  readonly venue: FundingVenue;
  /** The rate as the venue quotes it, per `intervalHours`. */
  readonly rate: string;
  readonly intervalHours: number | null;
  /** Normalized to one hour. */
  readonly hourly: number | null;
  readonly aprPct: number | null;
  readonly nextFundingTime: number | null;
}

export interface FundingRow {
  readonly coin: string;
  readonly markPx: string | null;
  readonly openInterestUsd: number | null;
  /** HyperCore's current hourly rate (from the asset context). */
  readonly currentHourly: number | null;
  readonly currentAprPct: number | null;
  /** Predicted next funding per venue (HyperCore, Binance, Bybit), hourly-normalized. */
  readonly venues: readonly VenueFunding[];
  /** Max minus min APR across venues with a prediction (a carry hint, not a promise). */
  readonly spreadAprPct: number | null;
  /** Far from the cross-market median (more than 5 median absolute deviations). */
  readonly outlier: boolean;
}

/** GET /v1/funding. */
export interface FundingResponse {
  readonly network: HyperCoreNetworkKey;
  readonly generatedAt: number;
  readonly rows: readonly FundingRow[];
  readonly stats: { readonly medianAprPct: number | null; readonly madAprPct: number | null };
  readonly outliers: {
    readonly highestApr: readonly string[];
    readonly lowestApr: readonly string[];
    readonly widestSpread: readonly string[];
  };
  readonly notes: readonly string[];
}

/* ----------------------------------------------------- reference prices */

/** Where a USD figure comes from. */
export type PriceSource = "hypercore-mainnet-reference";

export type PriceBasis =
  /** USDC, HyperCore's quote currency: 1 by definition. */
  | "unit"
  /** Mid of a HyperCore mainnet spot pair quoted in USDC. */
  | "spot-pair"
  /** Mid of a HyperCore mainnet perp. */
  | "perp-mid"
  /** kHYPE: the Kinetiq StakingAccountant rate times the HYPE price. */
  | "lst-rate";

export interface ReferencePrice {
  /** The symbol as asked. */
  readonly symbol: string;
  readonly usd: number;
  readonly basis: PriceBasis;
  /** HyperCore mainnet book used (`@107`, `BTC`), when one was. */
  readonly coin: string | null;
  /** Extra derivation, e.g. "1 kHYPE = 1.02727 HYPE". */
  readonly detail: string | null;
}

/** GET /v1/prices. */
export interface PricesResponse {
  readonly source: PriceSource;
  /** Always "reference price": testnet assets have no market price of their own. */
  readonly label: "reference price";
  /** When the mainnet mids were read (ms). */
  readonly time: number;
  readonly prices: readonly ReferencePrice[];
  /** Symbols without a reference (never priced as zero). */
  readonly unknown: readonly string[];
}

/* ---------------------------------------------------------------- vaults */

export interface VaultRow {
  readonly address: string;
  readonly name: string;
  readonly leader: string;
  /** In the network's USDC (test USDC on testnet). */
  readonly tvlUsd: number;
  /** Annualized, in percent. */
  readonly aprPct: number | null;
  readonly isClosed: boolean;
  readonly relationship: "normal" | "parent" | "child" | (string & {});
  readonly createdAt: number | null;
  /** Latest all-time PnL point of the dump. */
  readonly allTimePnlUsd: number | null;
}

/** GET /v1/vaults. */
export interface VaultsResponse {
  readonly network: HyperCoreNetworkKey;
  /** When the dump was fetched (ms). */
  readonly fetchedAt: number;
  /** Vaults in the dump (open and closed). */
  readonly total: number;
  readonly count: number;
  /** Largest TVL first. */
  readonly vaults: readonly VaultRow[];
  readonly source: "stats-data.hyperliquid.xyz";
}

/* --------------------------------------------------- whales (liq map) */

export interface WhalePosition {
  readonly address: string;
  readonly displayName: string | null;
  readonly side: "long" | "short";
  readonly size: string;
  readonly notionalUsd: number;
  readonly entryPx: string;
  readonly leverage: { readonly type: "cross" | "isolated"; readonly value: number };
  readonly liquidationPx: string | null;
  /** Signed percent from mark to the liquidation price (negative = below mark). */
  readonly liquidationDistancePct: number | null;
  readonly unrealizedPnl: number;
}

export interface LiquidationLevel {
  /** Liquidation prices of the bucket, notional-weighted. */
  readonly px: number;
  readonly distancePct: number;
  readonly notionalUsd: number;
  readonly positions: number;
}

/** GET /v1/whales. */
export interface WhalesResponse {
  readonly network: HyperCoreNetworkKey;
  readonly coin: string;
  readonly markPx: string | null;
  /** When the account sweep ran (ms); the sweep is shared and refreshed at most every few minutes. */
  readonly sweptAt: number;
  readonly stale: boolean;
  /** Top leaderboard accounts read. */
  readonly sampledAccounts: number;
  readonly accountsWithPosition: number;
  readonly longNotionalUsd: number;
  readonly shortNotionalUsd: number;
  /** Largest first. */
  readonly positions: readonly WhalePosition[];
  /** Long liquidations below mark, nearest first. */
  readonly longLiquidations: readonly LiquidationLevel[];
  /** Short liquidations above mark, nearest first. */
  readonly shortLiquidations: readonly LiquidationLevel[];
  readonly bucketPct: number;
  readonly source: "stats-data leaderboard + clearinghouseState";
}
