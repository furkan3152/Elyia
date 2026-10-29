/**
 * Wire contract of the portfolio endpoints: one balance sheet across
 * HyperCore, HyperEVM and Elysium, its history and its live stream. Import
 * as `@elyia/core/api/portfolio`.
 *
 * Valuation rule: every USD figure uses HyperCore **mainnet** prices
 * (`pricing.source`). On testnet they are labelled "reference": testnet
 * assets have no market price of their own, and testnet pools are never used
 * for valuation. A line without a reference price has `usd: null` and is
 * counted in `unpricedLines`; it is never valued at zero.
 */
import type { NetworkKey } from "../networks.js";
import type { PriceSource } from "./markets.js";

export type PortfolioMode = "testnet" | "mainnet";
export type PortfolioLayer = "hypercore" | "hyperevm" | "elysium";
/** Where a balance sits inside its layer. */
export type BalanceAccount = "perp" | "spot" | "vault" | "staking" | "wallet";

export interface PricingInfo {
  readonly source: PriceSource;
  /** "reference" on testnet; "market" on mainnet, where the prices are the assets' own. */
  readonly label: "reference" | "market";
  /** When the mainnet mids were read (ms). */
  readonly time: number;
  /** HYPE per kHYPE from the Kinetiq StakingAccountant on HyperEVM mainnet, when it could be read. */
  readonly khypeToHype: number | null;
}

/** One holding. `id` is stable across snapshots (diff key). */
export interface BalanceLine {
  readonly id: string;
  readonly layer: PortfolioLayer;
  readonly account: BalanceAccount;
  readonly network: NetworkKey;
  /** Symbol shown to the user (`HYPE`, `USDC`, `kHYPE`, vault name). */
  readonly asset: string;
  /** CAIP-19 asset id for EVM tokens; `spot:<index>` style ids for HyperCore. */
  readonly assetId: string | null;
  /** Decimal amount in the asset's units. */
  readonly amount: string;
  readonly priceUsd: number | null;
  readonly usd: number | null;
  /** Economic exposure this line adds (`HYPE`, `BTC`, `USD`), or null when unknown. */
  readonly underlying: string | null;
  /** Amount expressed in the underlying (kHYPE converted to HYPE, UBTC as BTC). */
  readonly underlyingAmount: number | null;
  /** Not spendable right now (vault lockups, open-order holds, pending withdrawals), in asset units. */
  readonly locked: string | null;
  readonly note: string | null;
}

export type LayerStatus = "ok" | "partial" | "unavailable" | "error";

export interface LayerSource {
  readonly network: NetworkKey;
  readonly part: string;
  readonly status: "ok" | "unavailable" | "error";
  readonly message: string | null;
  /** EVM block the balances were read at, when known. */
  readonly blockNumber: string | null;
}

export interface LayerSummary {
  readonly layer: PortfolioLayer;
  readonly status: LayerStatus;
  /** Sum of priced lines. */
  readonly totalUsd: number;
  readonly unpricedLines: number;
  readonly lines: readonly BalanceLine[];
  readonly sources: readonly LayerSource[];
}

export interface PerpLeverageView {
  readonly type: "cross" | "isolated";
  readonly value: number;
}

/** One open perp position. `id` = `${dex}|${coin}`. */
export interface PerpPositionView {
  readonly id: string;
  /** `""` for the first perp dex, the HIP-3 dex name otherwise. */
  readonly dex: string;
  readonly coin: string;
  readonly side: "long" | "short";
  /** Absolute size in base units. */
  readonly size: string;
  /** Signed size as HyperCore reports it. */
  readonly szi: string;
  readonly entryPx: string;
  /** Position value / size: the venue's mark when the state was read. */
  readonly markPx: number;
  readonly positionValue: number;
  readonly unrealizedPnl: number;
  /** Return on equity, in percent. */
  readonly roePct: number;
  readonly leverage: PerpLeverageView;
  readonly maxLeverage: number;
  /** HyperCore's own liquidation price (authoritative); null when the position cannot be liquidated at any price. */
  readonly liquidationPx: string | null;
  /** Percent the mark must move against the position to reach `liquidationPx` (always >= 0 while solvent). */
  readonly liquidationDistancePct: number | null;
  /** "safe" >= 15 %, "watch" 5-15 %, "danger" < 5 %. */
  readonly liquidationRisk: "safe" | "watch" | "danger" | "none";
  readonly marginUsed: number;
  /** Funding since the position opened: positive = received, negative = paid. */
  readonly fundingSinceOpen: number;
  readonly fundingAllTime: number;
  /** USD value of `positionValue` at the reference price of the collateral (USDC = 1). */
  readonly positionValueUsd: number | null;
}

/** Margin health of one perp dex account. */
export interface PerpAccountHealth {
  readonly dex: string;
  /** Collateral token of the dex (USDC, USDH...). */
  readonly collateral: string;
  readonly accountValue: number;
  readonly totalNotional: number;
  readonly totalMarginUsed: number;
  readonly crossAccountValue: number;
  readonly crossMaintenanceMarginUsed: number;
  /** Cross maintenance margin / cross account value, in percent; liquidation at 100. */
  readonly crossMarginRatioPct: number | null;
  /** Total notional / account value. */
  readonly accountLeverage: number | null;
  readonly withdrawable: number;
  readonly time: number;
}

/** Net exposure to one underlying across every layer. */
export interface ExposureRow {
  readonly underlying: string;
  /** Signed perp size (base units). */
  readonly perp: number;
  /**
   * Holdings in units of the underlying: HyperCore spot, staking, HyperEVM and
   * Elysium wallets; for `USD` also perp account value (margin incl.
   * unrealized PnL) and vault equity.
   */
  readonly spot: number;
  /** Liquid-staking tokens converted to the underlying (kHYPE). */
  readonly lst: number;
  readonly net: number;
  readonly priceUsd: number | null;
  /** Net exposure in USD. */
  readonly netUsd: number | null;
  /** Stablecoins and margin: dollar cash, not a directional bet. */
  readonly isCash: boolean;
}

export interface PortfolioTotals {
  /** Every priced line on every layer (perp account value counts once; positions are inside it). */
  readonly netWorthUsd: number;
  readonly byLayer: Readonly<Record<PortfolioLayer, number>>;
  readonly unpricedLines: number;
  readonly unrealizedPnlUsd: number;
  /** Sum of absolute perp position values. */
  readonly grossPerpNotionalUsd: number;
}

/** GET /v1/portfolio/:address. */
export interface PortfolioSnapshot {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly generatedAt: number;
  readonly pricing: PricingInfo;
  readonly totals: PortfolioTotals;
  readonly layers: readonly LayerSummary[];
  readonly positions: readonly PerpPositionView[];
  readonly accounts: readonly PerpAccountHealth[];
  /** Largest absolute USD exposure first. */
  readonly exposure: readonly ExposureRow[];
  /** HIP-3 dexes read besides the first dex. */
  readonly dexes: readonly string[];
  readonly notes: readonly string[];
}

/* -------------------------------------------------------------- history */

export interface FillEvent {
  readonly kind: "fill";
  readonly id: string;
  readonly time: number;
  readonly hash: string;
  readonly coin: string;
  readonly side: "buy" | "sell";
  /** "Open Long", "Close Short", "Buy", ... */
  readonly dir: string;
  readonly px: string;
  readonly sz: string;
  readonly notional: number;
  readonly fee: number;
  readonly feeToken: string;
  readonly builderFee: number | null;
  readonly closedPnl: number;
  readonly oid: number;
  readonly tid: number;
  readonly crossed: boolean;
  readonly liquidation: boolean;
}

export interface FundingEvent {
  readonly kind: "funding";
  readonly id: string;
  readonly time: number;
  readonly coin: string;
  /** Positive = received, negative = paid (USDC). */
  readonly usdc: number;
  readonly szi: string;
  readonly fundingRate: string;
  /** Hourly samples merged into this entry (HyperCore merges older funding by day). */
  readonly samples: number | null;
}

export interface LedgerEvent {
  readonly kind: "ledger";
  readonly id: string;
  readonly time: number;
  readonly hash: string;
  /** HyperCore delta type (`deposit`, `withdraw`, `send`, `spotTransfer`, `vaultDeposit`, ...). */
  readonly type: string;
  /** Signed USD value for this account when HyperCore states it (incoming positive). */
  readonly usdc: number | null;
  readonly token: string | null;
  readonly amount: string | null;
  readonly summary: string;
}

export type TimelineEvent = FillEvent | FundingEvent | LedgerEvent;

export interface EquityCurve {
  /** [ms, account value]. */
  readonly accountValue: readonly (readonly [number, number])[];
  /** [ms, cumulative PnL]. */
  readonly pnl: readonly (readonly [number, number])[];
  readonly volume: number;
}

export type EquityPeriod = "day" | "week" | "month" | "allTime" | "perpDay" | "perpWeek" | "perpMonth" | "perpAllTime";

export interface PnlDay {
  /** UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly realizedPnl: number;
  /** Fees paid in USDC or valued at the reference price; rebates are negative. */
  readonly fees: number;
  /** Positive = received. */
  readonly funding: number;
  /** realizedPnl - fees + funding. */
  readonly net: number;
  readonly fills: number;
  readonly volume: number;
}

export interface HistorySection {
  readonly status: "ok" | "error";
  readonly message: string | null;
  /** The upstream page limit was reached: older items in the range are missing. */
  readonly truncated: boolean;
  readonly count: number;
}

/** GET /v1/portfolio/:address/history. */
export interface PortfolioHistory {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly from: number;
  readonly to: number;
  readonly generatedAt: number;
  /** Newest first. */
  readonly timeline: readonly TimelineEvent[];
  readonly equity: Partial<Readonly<Record<EquityPeriod, EquityCurve>>>;
  /** Oldest first. */
  readonly calendar: readonly PnlDay[];
  readonly totals: { readonly realizedPnl: number; readonly fees: number; readonly funding: number; readonly net: number; readonly volume: number };
  readonly sections: { readonly fills: HistorySection; readonly funding: HistorySection; readonly ledger: HistorySection; readonly equity: HistorySection };
}

/* --------------------------------------------------------------- stream */

/** SSE event names of GET /v1/portfolio/:address/stream. */
export const PORTFOLIO_STREAM_EVENTS = Object.freeze({
  /** A full snapshot; sent on connect and whenever the content changed. */
  snapshot: "snapshot",
  /** Nothing changed since `seq`; a heartbeat with the time of the check. */
  unchanged: "unchanged",
  error: "error",
} as const);

export interface PortfolioStreamSnapshot {
  /** Increases by one per published change for this address. */
  readonly seq: number;
  /** Digest of the content (timestamps excluded); equal digests = equal content. */
  readonly digest: string;
  readonly snapshot: PortfolioSnapshot;
  /** True when a refresh was skipped (rate budget or upstream error) and parts are older than the interval. */
  readonly stale: boolean;
  readonly intervalMs: number;
}

export interface PortfolioStreamUnchanged {
  readonly seq: number;
  readonly digest: string;
  readonly checkedAt: number;
  readonly stale: boolean;
}

export interface PortfolioStreamError {
  readonly code: string;
  readonly message: string;
}
