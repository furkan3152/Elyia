/**
 * The browser-direct balance sheet (pure): when the Elyia API cannot be
 * reached, the page reads HyperCore itself (the account WebSocket feeds, the
 * staking summary and the `portfolio` equity curves) and the two EVM layers
 * through the wallet's public RPCs, then builds the same `PortfolioSnapshot`
 * / `PortfolioHistory` shapes the API sends, so every drawing works the same.
 *
 * Pricing follows the API's rule: HyperCore **mainnet** mids, labelled
 * "reference" on testnet. A token without a reference price stays unpriced.
 */
import type { BalanceLine, ExposureRow, FillEvent, FundingEvent, LayerSummary, LedgerEvent, PerpPositionView, PortfolioHistory, PortfolioLayer, PortfolioMode, PortfolioSnapshot, TimelineEvent } from "@elyia/core/api/portfolio";
import type { DelegatorSummary, LedgerUpdate, Portfolio, SpotBalance, UserFill } from "@elyia/core/hypercore/info";
import type { NetworkKey } from "@elyia/core/networks";

import type { AccountSummary, PositionRow } from "../../../features/trading/accountModel";
import type { FundingRow } from "../../../features/trading/useAccountFeeds";
import { calendarFromTimeline } from "./model";

const STABLES = new Set(["USDC", "USDH", "USDT", "USDT0", "USDE", "USDXL", "FEUSD"]);

/** Reference USD price of a symbol from mainnet mids (stables at 1); null when unknown. */
export function referencePrice(symbol: string, mids: Readonly<Record<string, string>> | null): number | null {
  const upper = symbol.toUpperCase();
  if (STABLES.has(upper)) return 1;
  if (!mids) return null;
  const direct = Number(mids[symbol] ?? mids[upper]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  // Wrapped and liquid-staked HYPE follow HYPE.
  if (upper === "WHYPE" || upper === "KHYPE" || upper === "STHYPE") return referencePrice("HYPE", mids);
  const unwrapped = upper.startsWith("U") ? Number(mids[upper.slice(1)]) : NaN;
  return Number.isFinite(unwrapped) && unwrapped > 0 ? unwrapped : null;
}

export interface EvmLayerRead {
  readonly network: NetworkKey;
  /** Native HYPE (decimal), null when the read failed. */
  readonly hype: number | null;
  readonly usdc: number | null;
  readonly blockNumber: string | null;
}

export interface BrowserInputs {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly now: number;
  readonly summary: AccountSummary | null;
  readonly positions: readonly PositionRow[] | null;
  readonly spot: readonly SpotBalance[] | null;
  readonly staking: DelegatorSummary | null;
  /** Mainnet mids (reference prices). */
  readonly mids: Readonly<Record<string, string>> | null;
  readonly ridge: EvmLayerRead | null;
  readonly summit: EvmLayerRead | null;
}

const HC_NETWORK: Readonly<Record<PortfolioMode, NetworkKey>> = { testnet: "hypercore-testnet", mainnet: "hypercore-mainnet" };

function line(partial: Omit<BalanceLine, "assetId" | "locked" | "note" | "underlyingAmount" | "usd" | "priceUsd"> & { priceUsd: number | null; locked?: string | null; note?: string | null }): BalanceLine {
  const qty = Number(partial.amount) || 0;
  const usd = partial.priceUsd === null ? null : qty * partial.priceUsd;
  return { assetId: null, locked: partial.locked ?? null, note: partial.note ?? null, underlyingAmount: partial.underlying ? qty : null, usd, ...partial };
}

/** Builds a snapshot from what the browser could read; returns null until HyperCore's account state has arrived. */
export function snapshotFromBrowser(input: BrowserInputs): PortfolioSnapshot | null {
  if (!input.summary || !input.positions) return null;
  const hc = HC_NETWORK[input.mode];
  const hypercore: BalanceLine[] = [];
  hypercore.push(line({ id: "hypercore|perp|main", layer: "hypercore", account: "perp", network: hc, asset: "USDC", amount: String(input.summary.accountValue), priceUsd: 1, underlying: "USD", locked: String(input.summary.marginUsed), note: `Perps: account value incl. unrealized PnL of ${input.positions.length} position(s)` }));
  for (const balance of input.spot ?? []) {
    const total = Number(balance.total);
    if (!(total > 0)) continue;
    const priceUsd = referencePrice(balance.coin, input.mids);
    hypercore.push(line({ id: `hypercore|spot|${balance.token}`, layer: "hypercore", account: "spot", network: hc, asset: balance.coin, amount: balance.total, priceUsd, underlying: STABLES.has(balance.coin.toUpperCase()) ? "USD" : balance.coin, locked: Number(balance.hold) > 0 ? balance.hold : null }));
  }
  if (input.staking) {
    const staked = (Number(input.staking.delegated) || 0) + (Number(input.staking.undelegated) || 0) + (Number(input.staking.totalPendingWithdrawal) || 0);
    if (staked > 0) {
      hypercore.push(
        line({
          id: "hypercore|staking|HYPE",
          layer: "hypercore",
          account: "staking",
          network: hc,
          asset: "HYPE",
          amount: String(staked),
          priceUsd: referencePrice("HYPE", input.mids),
          underlying: "HYPE",
          locked: input.staking.delegated,
          note: `Delegated ${input.staking.delegated}, undelegated ${input.staking.undelegated}, pending withdrawal ${input.staking.totalPendingWithdrawal} (${input.staking.nPendingWithdrawals})`,
        }),
      );
    }
  }
  const evmLines = (layer: PortfolioLayer, read: EvmLayerRead | null): BalanceLine[] => {
    if (!read) return [];
    const out: BalanceLine[] = [];
    if (read.hype !== null && read.hype > 0) out.push(line({ id: `${layer}|wallet|HYPE`, layer, account: "wallet", network: read.network, asset: "HYPE", amount: String(read.hype), priceUsd: referencePrice("HYPE", input.mids), underlying: "HYPE" }));
    if (read.usdc !== null && read.usdc > 0) out.push(line({ id: `${layer}|wallet|USDC`, layer, account: "wallet", network: read.network, asset: "USDC", amount: String(read.usdc), priceUsd: 1, underlying: "USD" }));
    return out;
  };
  const summary = (layer: PortfolioLayer, lines: BalanceLine[], read: EvmLayerRead | null | "hypercore"): LayerSummary => {
    const status = read === "hypercore" ? "ok" : read === null ? "unavailable" : read.hype === null && read.usdc === null ? "error" : read.hype === null || read.usdc === null ? "partial" : "ok";
    return {
      layer,
      status,
      totalUsd: lines.reduce((sum, entry) => sum + (entry.usd ?? 0), 0),
      unpricedLines: lines.filter((entry) => entry.usd === null).length,
      lines: [...lines].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1)),
      sources: [{ network: read === "hypercore" ? hc : (read?.network ?? hc), part: read === "hypercore" ? "browser" : "wallet rpc", status: status === "error" ? "error" : status === "unavailable" ? "unavailable" : "ok", message: null, blockNumber: read === "hypercore" || read === null ? null : read.blockNumber }],
    };
  };
  const layers = [summary("hypercore", hypercore, "hypercore"), summary("hyperevm", evmLines("hyperevm", input.ridge), input.ridge), summary("elysium", evmLines("elysium", input.summit), input.summit)];

  const positions: PerpPositionView[] = input.positions.map((row) => ({
    id: `${row.dex}|${row.coin}`,
    dex: row.dex,
    coin: row.coin,
    side: row.isLong ? "long" : "short",
    size: String(Math.abs(row.szi)),
    szi: row.sziText,
    entryPx: String(row.entryPx),
    markPx: row.markPx,
    positionValue: row.positionValue,
    unrealizedPnl: row.unrealizedPnl,
    roePct: row.roe * 100,
    leverage: { type: row.leverageType, value: row.leverage },
    maxLeverage: row.maxLeverage,
    liquidationPx: row.liquidationPx === null ? null : String(row.liquidationPx),
    liquidationDistancePct: row.liquidationDistance === null ? null : row.liquidationDistance * 100,
    liquidationRisk: row.liquidationDistance === null ? "none" : row.liquidationDistance >= 0.15 ? "safe" : row.liquidationDistance >= 0.05 ? "watch" : "danger",
    marginUsed: row.marginUsed,
    fundingSinceOpen: -row.fundingSinceOpen,
    fundingAllTime: 0,
    positionValueUsd: row.positionValue,
  }));

  const exposure = new Map<string, { perp: number; spot: number; lst: number }>();
  const add = (underlying: string, key: "perp" | "spot" | "lst", qty: number) => {
    const entry = exposure.get(underlying) ?? { perp: 0, spot: 0, lst: 0 };
    entry[key] += qty;
    exposure.set(underlying, entry);
  };
  for (const row of input.positions) add(row.coin, "perp", row.szi);
  for (const entry of layers.flatMap((layer) => layer.lines)) {
    if (entry.underlying === "USD") add("USD", "spot", entry.usd ?? 0);
    else if (entry.underlying) add(entry.underlying, "spot", Number(entry.amount) || 0);
  }
  const exposureRows: ExposureRow[] = [...exposure.entries()].map(([underlying, entry]) => {
    const isCash = underlying === "USD";
    const priceUsd = isCash ? 1 : referencePrice(underlying, input.mids);
    const net = entry.perp + entry.spot + entry.lst;
    return { underlying, perp: entry.perp, spot: entry.spot, lst: entry.lst, net, priceUsd, netUsd: priceUsd === null ? null : net * priceUsd, isCash };
  });
  exposureRows.sort((a, b) => Math.abs(b.netUsd ?? 0) - Math.abs(a.netUsd ?? 0));

  const byLayer = { hypercore: layers[0]!.totalUsd, hyperevm: layers[1]!.totalUsd, elysium: layers[2]!.totalUsd };
  return {
    address: input.address.toLowerCase(),
    mode: input.mode,
    generatedAt: input.now,
    pricing: { source: "hypercore-mainnet-reference" as PortfolioSnapshot["pricing"]["source"], label: input.mode === "testnet" ? "reference" : "market", time: input.now, khypeToHype: null },
    totals: {
      netWorthUsd: byLayer.hypercore + byLayer.hyperevm + byLayer.elysium,
      byLayer,
      unpricedLines: layers.reduce((sum, layer) => sum + layer.unpricedLines, 0),
      unrealizedPnlUsd: input.positions.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossPerpNotionalUsd: input.positions.reduce((sum, row) => sum + row.positionValue, 0),
    },
    layers,
    positions,
    accounts: [],
    exposure: exposureRows,
    dexes: [],
    notes: ["Read in your browser: the Elyia API could not be reached. HyperCore and wallet RPCs answered directly."],
  };
}

/* --------------------------------------------------------------- history */

export function fillEvent(fill: UserFill): FillEvent {
  const px = Number(fill.px);
  const sz = Number(fill.sz);
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
    notional: px * sz,
    fee: Number(fill.fee) || 0,
    feeToken: fill.feeToken,
    builderFee: fill.builderFee === undefined ? null : Number(fill.builderFee),
    closedPnl: Number(fill.closedPnl) || 0,
    oid: fill.oid,
    tid: fill.tid,
    crossed: fill.crossed,
    liquidation: fill.liquidation !== undefined,
  };
}

export function fundingEvent(row: FundingRow): FundingEvent {
  return { kind: "funding", id: `funding:${row.coin}:${row.time}`, time: row.time, coin: row.coin, usdc: Number(row.usdc) || 0, szi: row.szi, fundingRate: row.fundingRate, samples: null };
}

export function ledgerEventFrom(update: LedgerUpdate, address: string): LedgerEvent {
  const delta = update.delta as { readonly type: string; readonly usdc?: string; readonly token?: string; readonly amount?: string; readonly destination?: string; readonly user?: string };
  const raw = delta.usdc !== undefined ? Number(delta.usdc) : NaN;
  const outgoing = /withdraw/iu.test(delta.type) || (delta.user !== undefined && delta.user.toLowerCase() === address.toLowerCase() && delta.destination !== undefined && delta.destination.toLowerCase() !== address.toLowerCase());
  const usdc = Number.isFinite(raw) ? (outgoing ? -Math.abs(raw) : raw) : null;
  const words: Readonly<Record<string, string>> = { deposit: "Deposit", withdraw: "Withdraw", accountClassTransfer: "Spot ↔ Perps", spotTransfer: "Spot transfer", internalTransfer: "Internal transfer", vaultDeposit: "Vault deposit", vaultWithdraw: "Vault withdrawal", send: "Send", cStakingTransfer: "Staking transfer" };
  const what = words[delta.type] ?? delta.type;
  const amountText = delta.usdc !== undefined ? `${delta.usdc} USDC` : delta.amount ? `${delta.amount} ${delta.token ?? ""}`.trim() : "";
  return { kind: "ledger", id: `ledger:${update.hash}:${update.time}:${delta.type}`, time: update.time, hash: update.hash, type: delta.type, usdc, token: delta.token ?? (delta.usdc !== undefined ? "USDC" : null), amount: delta.amount ?? delta.usdc ?? null, summary: `${what} ${amountText}`.trim() };
}

export interface BrowserHistoryInputs {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly now: number;
  readonly from: number;
  readonly portfolio: Portfolio | null;
  readonly fills: readonly UserFill[] | null;
  readonly fundings: readonly FundingRow[] | null;
  readonly ledger: readonly LedgerUpdate[] | null;
}

export function historyFromBrowser(input: BrowserHistoryInputs): PortfolioHistory {
  const timeline: TimelineEvent[] = [
    ...(input.fills ?? []).map(fillEvent),
    ...(input.fundings ?? []).map(fundingEvent),
    ...(input.ledger ?? []).map((update) => ledgerEventFrom(update, input.address)),
  ]
    .filter((event) => event.time >= input.from)
    .sort((a, b) => b.time - a.time);
  const equity: PortfolioHistory["equity"] = Object.fromEntries(
    (input.portfolio ?? []).map(([period, data]) => [
      period,
      {
        accountValue: data.accountValueHistory.map(([t, v]) => [t, Number(v)] as const),
        pnl: data.pnlHistory.map(([t, v]) => [t, Number(v)] as const),
        volume: Number((data as { vlm?: string }).vlm ?? 0) || 0,
      },
    ]),
  );
  const calendar = calendarFromTimeline(timeline);
  const totals = calendar.reduce((sum, day) => ({ realizedPnl: sum.realizedPnl + day.realizedPnl, fees: sum.fees + day.fees, funding: sum.funding + day.funding, net: sum.net + day.net, volume: sum.volume + day.volume }), { realizedPnl: 0, fees: 0, funding: 0, net: 0, volume: 0 });
  const section = (value: readonly unknown[] | null) => ({ status: value === null ? ("error" as const) : ("ok" as const), message: value === null ? "Not read yet." : null, truncated: false, count: value?.length ?? 0 });
  return {
    address: input.address.toLowerCase(),
    mode: input.mode,
    from: input.from,
    to: input.now,
    generatedAt: input.now,
    timeline,
    equity,
    calendar,
    totals,
    sections: { fills: section(input.fills), funding: section(input.fundings), ledger: section(input.ledger), equity: section(input.portfolio) },
  };
}
