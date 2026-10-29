/**
 * Portfolio history: fills, funding and non-funding ledger updates merged
 * into one typed timeline, equity curves from HyperCore's `portfolio`
 * request, and a PnL calendar by UTC day (realized PnL - fees + funding).
 */
import type {
  EquityCurve,
  EquityPeriod,
  FillEvent,
  FundingEvent,
  HistorySection,
  LedgerEvent,
  PnlDay,
  PortfolioHistory,
  PortfolioMode,
  TimelineEvent,
} from "@elyia/core/api/portfolio";
import type { LedgerUpdate, Portfolio, UserFill, UserFundingEntry } from "@elyia/core/hypercore/info";
import { round, roundUsd, toNumber } from "../markets/num.js";

export const MAX_TIMELINE = 1_500;
const EQUITY_PERIODS: readonly EquityPeriod[] = ["day", "week", "month", "allTime", "perpDay", "perpWeek", "perpMonth", "perpAllTime"];

export function fillEvent(fill: UserFill): FillEvent {
  const px = toNumber(fill.px) ?? 0;
  const sz = toNumber(fill.sz) ?? 0;
  return {
    kind: "fill",
    id: `fill:${fill.tid}`,
    time: fill.time,
    hash: fill.hash,
    coin: fill.coin,
    side: fill.side === "B" ? "buy" : "sell",
    dir: fill.dir,
    px: fill.px,
    sz: fill.sz,
    notional: roundUsd(px * sz),
    fee: roundUsd(toNumber(fill.fee) ?? 0),
    feeToken: fill.feeToken,
    builderFee: fill.builderFee === undefined ? null : roundUsd(toNumber(fill.builderFee) ?? 0),
    closedPnl: roundUsd(toNumber(fill.closedPnl) ?? 0),
    oid: fill.oid,
    tid: fill.tid,
    crossed: fill.crossed,
    liquidation: fill.liquidation !== undefined && fill.liquidation !== null,
  };
}

export function fundingEvent(entry: UserFundingEntry): FundingEvent {
  return {
    kind: "funding",
    id: `funding:${entry.time}:${entry.delta.coin}`,
    time: entry.time,
    coin: entry.delta.coin,
    usdc: roundUsd(toNumber(entry.delta.usdc) ?? 0),
    szi: entry.delta.szi,
    fundingRate: entry.delta.fundingRate,
    samples: entry.delta.nSamples,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** One ledger update from `address`'s point of view: signed USD when HyperCore states it, and a plain summary. */
export function ledgerEvent(update: LedgerUpdate, address: string): LedgerEvent {
  const delta = update.delta as Record<string, unknown> & { type: string };
  const self = address.toLowerCase();
  const usd = (key: string) => toNumber(delta[key]);
  const outgoing = text(delta.user)?.toLowerCase() === self;
  const incoming = text(delta.destination)?.toLowerCase() === self;
  let usdc: number | null = null;
  let token: string | null = null;
  let amount: string | null = null;
  let summary: string = delta.type;
  switch (delta.type) {
    case "deposit":
      usdc = usd("usdc");
      summary = `Deposit ${delta.usdc} USDC`;
      break;
    case "withdraw":
      usdc = usd("usdc") === null ? null : -(usd("usdc") as number);
      summary = `Withdraw ${delta.usdc} USDC (fee ${text(delta.fee) ?? "0"})`;
      break;
    case "accountClassTransfer":
      amount = text(delta.usdc);
      token = "USDC";
      summary = delta.toPerp === true ? `Spot → Perps ${delta.usdc} USDC` : `Perps → Spot ${delta.usdc} USDC`;
      break;
    case "internalTransfer": {
      const value = usd("usdc");
      usdc = value === null || outgoing === incoming ? null : outgoing ? -value : value;
      token = "USDC";
      amount = text(delta.usdc);
      summary = outgoing === incoming ? `Internal transfer ${delta.usdc} USDC` : outgoing ? `Sent ${delta.usdc} USDC` : `Received ${delta.usdc} USDC`;
      break;
    }
    case "spotTransfer":
    case "send": {
      token = text(delta.token);
      amount = text(delta.amount);
      const value = usd("usdcValue");
      const sourceDex = text(delta.sourceDex);
      const destinationDex = text(delta.destinationDex);
      if (outgoing && incoming) {
        summary = `Moved ${amount} ${token} ${sourceDex || "perps"} → ${destinationDex || "perps"}`;
      } else {
        usdc = value === null ? null : outgoing ? -value : value;
        summary = `${outgoing ? "Sent" : "Received"} ${amount} ${token}`;
      }
      break;
    }
    case "vaultCreate":
    case "vaultDeposit":
      usdc = usd("usdc") === null ? null : -(usd("usdc") as number);
      summary = `${delta.type === "vaultCreate" ? "Created vault" : "Vault deposit"} ${delta.usdc} USDC`;
      break;
    case "vaultWithdraw":
      usdc = usd("netWithdrawnUsd");
      summary = `Vault withdrawal ${text(delta.netWithdrawnUsd) ?? "?"} USDC`;
      break;
    case "cStakingTransfer":
      token = text(delta.token);
      amount = text(delta.amount);
      summary = `${delta.isDeposit === true ? "Staking deposit" : "Staking withdrawal"} ${amount} ${token}`;
      break;
    case "liquidation":
      summary = `Liquidated (${delta.leverageType ?? "?"}): account value ${text(delta.accountValue) ?? "?"}`;
      break;
    case "rewardsClaim":
      amount = text(delta.amount);
      summary = `Rewards claimed ${amount}`;
      break;
    default:
      break;
  }
  return { kind: "ledger", id: `ledger:${update.hash}:${update.time}:${delta.type}`, time: update.time, hash: update.hash, type: delta.type, usdc: usdc === null ? null : roundUsd(usdc), token, amount, summary };
}

export function equityCurves(portfolio: Portfolio): Partial<Record<EquityPeriod, EquityCurve>> {
  const out: Partial<Record<EquityPeriod, EquityCurve>> = {};
  for (const [period, history] of portfolio) {
    if (!EQUITY_PERIODS.includes(period)) continue;
    const points = (series: readonly (readonly [number, string])[]) =>
      series.flatMap(([time, value]) => {
        const parsed = toNumber(value);
        return parsed === null ? [] : [[time, roundUsd(parsed)] as const];
      });
    out[period] = { accountValue: points(history.accountValueHistory), pnl: points(history.pnlHistory), volume: roundUsd(toNumber(history.vlm) ?? 0) };
  }
  return out;
}

export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Daily PnL (oldest first). Fees in another token than USDC are valued with
 * `feeUsd(token)`; fees without a value are left out (and counted).
 */
export function pnlCalendar(fills: readonly FillEvent[], funding: readonly FundingEvent[], feeUsd: (token: string) => number | null): { days: PnlDay[]; unpricedFees: number } {
  const days = new Map<string, { realizedPnl: number; fees: number; funding: number; fills: number; volume: number }>();
  const day = (time: number) => {
    const key = utcDay(time);
    let entry = days.get(key);
    if (!entry) {
      entry = { realizedPnl: 0, fees: 0, funding: 0, fills: 0, volume: 0 };
      days.set(key, entry);
    }
    return entry;
  };
  let unpricedFees = 0;
  for (const fill of fills) {
    const entry = day(fill.time);
    entry.realizedPnl += fill.closedPnl;
    entry.fills += 1;
    entry.volume += fill.notional;
    const rate = fill.feeToken === "USDC" || fill.feeToken === "" ? 1 : feeUsd(fill.feeToken);
    if (rate === null) unpricedFees += 1;
    else entry.fees += fill.fee * rate;
  }
  for (const payment of funding) day(payment.time).funding += payment.usdc;
  const out = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]): PnlDay => ({
      day: key,
      realizedPnl: roundUsd(entry.realizedPnl),
      fees: roundUsd(entry.fees),
      funding: roundUsd(entry.funding),
      net: roundUsd(entry.realizedPnl - entry.fees + entry.funding),
      fills: entry.fills,
      volume: roundUsd(entry.volume),
    }));
  return { days: out, unpricedFees };
}

export interface HistoryInput {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly from: number;
  readonly to: number;
  readonly now: number;
  readonly fills: { readonly items: readonly UserFill[] | null; readonly truncated: boolean; readonly message: string | null };
  readonly funding: { readonly items: readonly UserFundingEntry[] | null; readonly truncated: boolean; readonly message: string | null };
  readonly ledger: { readonly items: readonly LedgerUpdate[] | null; readonly truncated: boolean; readonly message: string | null };
  readonly portfolio: { readonly value: Portfolio | null; readonly message: string | null };
  readonly feeUsd: (token: string) => number | null;
}

function section(items: readonly unknown[] | null, truncated: boolean, message: string | null): HistorySection {
  return items === null ? { status: "error", message: message ?? "Not available right now.", truncated: false, count: 0 } : { status: "ok", message: null, truncated, count: items.length };
}

export function buildHistory(input: HistoryInput): PortfolioHistory {
  const inRange = (time: number) => time >= input.from && time <= input.to;
  const fills = (input.fills.items ?? []).filter((fill) => inRange(fill.time)).map(fillEvent);
  const funding = (input.funding.items ?? []).filter((entry) => inRange(entry.time)).map(fundingEvent);
  const ledger = (input.ledger.items ?? []).filter((update) => inRange(update.time)).map((update) => ledgerEvent(update, input.address));
  const timeline: TimelineEvent[] = [...fills, ...funding, ...ledger].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id)).slice(0, MAX_TIMELINE);
  const { days } = pnlCalendar(fills, funding, input.feeUsd);
  const totals = days.reduce(
    (sum, entry) => ({
      realizedPnl: sum.realizedPnl + entry.realizedPnl,
      fees: sum.fees + entry.fees,
      funding: sum.funding + entry.funding,
      net: sum.net + entry.net,
      volume: sum.volume + entry.volume,
    }),
    { realizedPnl: 0, fees: 0, funding: 0, net: 0, volume: 0 },
  );
  return {
    address: input.address,
    mode: input.mode,
    from: input.from,
    to: input.to,
    generatedAt: input.now,
    timeline,
    equity: input.portfolio.value ? equityCurves(input.portfolio.value) : {},
    calendar: days,
    totals: {
      realizedPnl: roundUsd(totals.realizedPnl),
      fees: roundUsd(totals.fees),
      funding: roundUsd(totals.funding),
      net: roundUsd(totals.net),
      volume: round(totals.volume, 2),
    },
    sections: {
      fills: section(input.fills.items, input.fills.truncated, input.fills.message),
      funding: section(input.funding.items, input.funding.truncated, input.funding.message),
      ledger: section(input.ledger.items, input.ledger.truncated, input.ledger.message),
      equity: input.portfolio.value === null ? { status: "error", message: input.portfolio.message ?? "Not available right now.", truncated: false, count: 0 } : { status: "ok", message: null, truncated: false, count: input.portfolio.value.length },
    },
  };
}
