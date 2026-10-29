/**
 * The balance sheet, built purely from what the reader fetched. Every USD
 * figure applies the reference rule (HyperCore mainnet prices); a holding
 * without a reference keeps `usd: null` and is counted as unpriced.
 *
 * Price identity (what a line is priced as):
 * - HyperCore mainnet spot balances: the token itself (by index).
 * - HyperCore testnet spot balances: only tokens Elyia's registry links to a
 *   HyperEVM token (HYPE, PURR, USDH, KNTQ, UETH) and USDC; testnet token
 *   names are not unique, so a name alone is never trusted.
 * - EVM registry tokens: their symbol, except tokens tagged `test` or
 *   `non-canonical`, which have no reference at all.
 */
import {
  fromBaseUnits,
  marginAssetId,
  spotAssetId,
  tokenForCoreIndex,
  type NetworkKey,
  type TokenDescriptor,
} from "@elyia/core";
import type {
  BalanceLine,
  ExposureRow,
  LayerSource,
  LayerStatus,
  LayerSummary,
  PerpAccountHealth,
  PerpPositionView,
  PortfolioLayer,
  PortfolioMode,
  PortfolioSnapshot,
} from "@elyia/core/api/portfolio";
import type { ClearinghouseState, DelegatorSummary, SpotClearinghouseState, UserVaultEquity } from "@elyia/core/hypercore/info";
import { round, roundPct, roundUsd, toNumber } from "../markets/num.js";
import { isCashUnderlying, priceMainnetToken, priceSymbol, REFERENCE_SOURCE, underlyingOf, type ReferenceTable } from "../markets/reference.js";
import { liquidationDistancePct, liquidationRisk } from "./liquidation.js";

/* ------------------------------------------------------------ sources */

export interface SourceResult<T> {
  readonly value: T | null;
  readonly status: "ok" | "unavailable" | "error";
  readonly message: string | null;
}

export interface PerpDexRead {
  /** `""` = first dex. */
  readonly dex: string;
  /** Collateral token name and HyperCore spot index. */
  readonly collateral: { readonly name: string; readonly index: number };
  readonly state: SourceResult<ClearinghouseState>;
}

export interface EvmRead {
  readonly network: NetworkKey;
  readonly layer: Exclude<PortfolioLayer, "hypercore">;
  readonly status: "ok" | "unavailable" | "error";
  readonly message: string | null;
  readonly blockNumber: bigint | null;
  readonly balances: readonly { readonly token: TokenDescriptor; readonly units: bigint | null }[];
}

export interface PortfolioSources {
  readonly address: string;
  readonly mode: PortfolioMode;
  readonly now: number;
  readonly hypercoreNetwork: NetworkKey;
  readonly perps: readonly PerpDexRead[];
  readonly spot: SourceResult<SpotClearinghouseState>;
  readonly vaults: SourceResult<readonly UserVaultEquity[]>;
  readonly staking: SourceResult<DelegatorSummary>;
  readonly evm: readonly EvmRead[];
  readonly prices: { readonly table: ReferenceTable; readonly stale: boolean } | null;
  /** Vault address -> name, when the vault list is warm. */
  readonly vaultNames: ReadonlyMap<string, string>;
  readonly notes?: readonly string[];
}

/* ------------------------------------------------------------- pricing */

interface Priced {
  readonly priceUsd: number | null;
  readonly underlying: string | null;
  /** Units of the underlying per unit of the asset (kHYPE -> HYPE rate). */
  readonly ratio: number | null;
}

const UNPRICED: Priced = { priceUsd: null, underlying: null, ratio: null };

function bySymbol(table: ReferenceTable | null, symbol: string): Priced {
  const underlying = underlyingOf(symbol);
  const ratio = underlying === "HYPE" && symbol.toUpperCase() === "KHYPE" ? (table?.khypeToHype ?? null) : 1;
  const price = table ? priceSymbol(table, symbol) : null;
  return { priceUsd: price?.usd ?? null, underlying, ratio };
}

/** Pricing of a registry EVM token. */
export function priceToken(table: ReferenceTable | null, token: TokenDescriptor): Priced {
  if (token.tags.includes("test") || token.tags.includes("non-canonical")) return { ...UNPRICED, underlying: null };
  return bySymbol(table, token.symbol);
}

/** Pricing of a HyperCore spot balance on `network`. */
export function priceCoreBalance(table: ReferenceTable | null, network: NetworkKey, index: number, coin: string): Priced {
  if (index === 0) return { priceUsd: 1, underlying: "USD", ratio: 1 };
  if (network === "hypercore-mainnet") {
    const price = table ? priceMainnetToken(table, index) : null;
    const underlying = underlyingOf(coin);
    const ratio = coin.toUpperCase() === "KHYPE" ? (table?.khypeToHype ?? null) : 1;
    return { priceUsd: price?.usd ?? null, underlying, ratio };
  }
  const linked = tokenForCoreIndex("hyperevm-testnet", index);
  return linked ? priceToken(table, linked) : UNPRICED;
}

/* --------------------------------------------------------------- lines */

function line(input: Omit<BalanceLine, "usd" | "underlyingAmount"> & { readonly ratio: number | null }): BalanceLine {
  const amount = toNumber(input.amount) ?? 0;
  const { ratio, ...rest } = input;
  return {
    ...rest,
    usd: input.priceUsd === null ? null : roundUsd(amount * input.priceUsd),
    underlyingAmount: input.underlying === null || ratio === null ? null : round(amount * ratio, 10),
  };
}

function decimalString(value: number): string {
  return String(round(value, 8));
}

function hypercoreLines(sources: PortfolioSources): { lines: BalanceLine[]; sourcesOut: LayerSource[] } {
  const table = sources.prices?.table ?? null;
  const network = sources.hypercoreNetwork;
  const lines: BalanceLine[] = [];
  const out: LayerSource[] = [];
  for (const read of sources.perps) {
    out.push({ network, part: read.dex ? `perps:${read.dex}` : "perps", status: read.state.status, message: read.state.message, blockNumber: null });
    const state = read.state.value;
    if (!state) continue;
    const accountValue = toNumber(state.marginSummary.accountValue) ?? 0;
    if (accountValue === 0 && state.assetPositions.length === 0) continue;
    const priced = priceCoreBalance(table, network, read.collateral.index, read.collateral.name);
    const withdrawable = toNumber(state.withdrawable) ?? 0;
    lines.push(
      line({
        id: `hypercore|perp|${read.dex || "main"}`,
        layer: "hypercore",
        account: "perp",
        network,
        asset: read.collateral.name,
        assetId: read.collateral.index === 0 ? marginAssetId(network) : spotAssetId(network, read.collateral.index),
        amount: state.marginSummary.accountValue,
        priceUsd: priced.priceUsd,
        underlying: priced.underlying,
        ratio: priced.ratio,
        locked: decimalString(Math.max(0, accountValue - withdrawable)),
        note: `${read.dex ? `${read.dex} dex` : "Perps"}: account value incl. unrealized PnL of ${state.assetPositions.length} position(s)`,
      }),
    );
  }
  out.push({ network, part: "spot", status: sources.spot.status, message: sources.spot.message, blockNumber: null });
  for (const balance of sources.spot.value?.balances ?? []) {
    if ((toNumber(balance.total) ?? 0) === 0) continue;
    const priced = priceCoreBalance(table, network, balance.token, balance.coin);
    const hold = toNumber(balance.hold) ?? 0;
    lines.push(
      line({
        id: `hypercore|spot|${balance.token}`,
        layer: "hypercore",
        account: "spot",
        network,
        asset: balance.coin,
        assetId: spotAssetId(network, balance.token),
        amount: balance.total,
        priceUsd: priced.priceUsd,
        underlying: priced.underlying,
        ratio: priced.ratio,
        locked: hold > 0 ? balance.hold : null,
        note: priced.priceUsd === null ? "No reference price for this token" : null,
      }),
    );
  }
  out.push({ network, part: "vaults", status: sources.vaults.status, message: sources.vaults.message, blockNumber: null });
  for (const equity of sources.vaults.value ?? []) {
    if ((toNumber(equity.equity) ?? 0) === 0) continue;
    const address = equity.vaultAddress.toLowerCase();
    const lockedNow = equity.lockedUntilTimestamp > sources.now;
    lines.push(
      line({
        id: `hypercore|vault|${address}`,
        layer: "hypercore",
        account: "vault",
        network,
        asset: sources.vaultNames.get(address) ?? `Vault ${address.slice(0, 6)}…${address.slice(-4)}`,
        assetId: null,
        amount: equity.equity,
        priceUsd: 1,
        underlying: "USD",
        ratio: 1,
        locked: lockedNow ? equity.equity : null,
        note: lockedNow ? `Locked until ${new Date(equity.lockedUntilTimestamp).toISOString()}` : null,
      }),
    );
  }
  out.push({ network, part: "staking", status: sources.staking.status, message: sources.staking.message, blockNumber: null });
  const staking = sources.staking.value;
  if (staking) {
    const delegated = toNumber(staking.delegated) ?? 0;
    const undelegated = toNumber(staking.undelegated) ?? 0;
    const pending = toNumber(staking.totalPendingWithdrawal) ?? 0;
    const total = delegated + undelegated + pending;
    if (total > 0) {
      const priced = bySymbol(table, "HYPE");
      lines.push(
        line({
          id: "hypercore|staking|HYPE",
          layer: "hypercore",
          account: "staking",
          network,
          asset: "HYPE",
          assetId: null,
          amount: decimalString(total),
          priceUsd: priced.priceUsd,
          underlying: "HYPE",
          ratio: 1,
          locked: delegated + pending > 0 ? decimalString(delegated + pending) : null,
          note: `Delegated ${staking.delegated}, undelegated ${staking.undelegated}, pending withdrawal ${staking.totalPendingWithdrawal} (${staking.nPendingWithdrawals})`,
        }),
      );
    }
  }
  return { lines, sourcesOut: out };
}

function evmLines(table: ReferenceTable | null, read: EvmRead): BalanceLine[] {
  const lines: BalanceLine[] = [];
  for (const { token, units } of read.balances) {
    if (units === null || units === 0n) continue;
    const priced = priceToken(table, token);
    lines.push(
      line({
        id: `${read.layer}|wallet|${token.id.toLowerCase()}`,
        layer: read.layer,
        account: "wallet",
        network: read.network,
        asset: token.symbol,
        assetId: token.id,
        amount: fromBaseUnits(units, token.decimals),
        priceUsd: priced.priceUsd,
        underlying: priced.underlying,
        ratio: priced.ratio,
        locked: null,
        note: token.tags.includes("non-canonical") ? "App-specific test token, not canonical" : priced.priceUsd === null ? "No reference price for this token" : null,
      }),
    );
  }
  return lines;
}

/* ----------------------------------------------------------- positions */

export function positionsOf(read: PerpDexRead, collateralUsd: number | null): PerpPositionView[] {
  const state = read.state.value;
  if (!state) return [];
  return state.assetPositions.flatMap(({ position }) => {
    const szi = toNumber(position.szi);
    const positionValue = toNumber(position.positionValue);
    if (szi === null || szi === 0 || positionValue === null) return [];
    const side = szi > 0 ? 1 : -1;
    const mark = Math.abs(positionValue / szi);
    const liq = toNumber(position.liquidationPx);
    const distance = liquidationDistancePct(side, mark, liq);
    return [
      {
        id: `${read.dex}|${position.coin}`,
        dex: read.dex,
        coin: position.coin,
        side: side === 1 ? "long" : "short",
        size: String(Math.abs(szi)),
        szi: position.szi,
        entryPx: position.entryPx,
        markPx: round(mark, 10),
        positionValue: roundUsd(positionValue),
        unrealizedPnl: roundUsd(toNumber(position.unrealizedPnl) ?? 0),
        roePct: roundPct((toNumber(position.returnOnEquity) ?? 0) * 100),
        leverage: { type: position.leverage.type, value: position.leverage.value },
        maxLeverage: position.maxLeverage,
        liquidationPx: liq !== null && liq > 0 ? position.liquidationPx : null,
        liquidationDistancePct: distance,
        liquidationRisk: liquidationRisk(distance),
        marginUsed: roundUsd(toNumber(position.marginUsed) ?? 0),
        // HyperCore's cumFunding counts funding paid as positive; the wire flips it (received = positive).
        fundingSinceOpen: roundUsd(-(toNumber(position.cumFunding.sinceOpen) ?? 0)),
        fundingAllTime: roundUsd(-(toNumber(position.cumFunding.allTime) ?? 0)),
        positionValueUsd: collateralUsd === null ? null : roundUsd(positionValue * collateralUsd),
      },
    ];
  });
}

export function accountHealth(read: PerpDexRead): PerpAccountHealth | null {
  const state = read.state.value;
  if (!state) return null;
  const accountValue = toNumber(state.marginSummary.accountValue) ?? 0;
  const crossValue = toNumber(state.crossMarginSummary.accountValue) ?? 0;
  const crossMaintenance = toNumber(state.crossMaintenanceMarginUsed) ?? 0;
  const notional = toNumber(state.marginSummary.totalNtlPos) ?? 0;
  if (accountValue === 0 && state.assetPositions.length === 0) return null;
  return {
    dex: read.dex,
    collateral: read.collateral.name,
    accountValue: roundUsd(accountValue),
    totalNotional: roundUsd(notional),
    totalMarginUsed: roundUsd(toNumber(state.marginSummary.totalMarginUsed) ?? 0),
    crossAccountValue: roundUsd(crossValue),
    crossMaintenanceMarginUsed: roundUsd(crossMaintenance),
    crossMarginRatioPct: crossValue > 0 ? roundPct((crossMaintenance / crossValue) * 100) : null,
    accountLeverage: accountValue > 0 ? round(notional / accountValue, 4) : null,
    withdrawable: roundUsd(toNumber(state.withdrawable) ?? 0),
    time: state.time,
  };
}

/* ------------------------------------------------------------ exposure */

export function exposureOf(lines: readonly BalanceLine[], positions: readonly PerpPositionView[], priceOf: (underlying: string, position?: PerpPositionView) => number | null): ExposureRow[] {
  const rows = new Map<string, { perp: number; spot: number; lst: number; price: number | null }>();
  const row = (underlying: string) => {
    let entry = rows.get(underlying);
    if (!entry) {
      entry = { perp: 0, spot: 0, lst: 0, price: null };
      rows.set(underlying, entry);
    }
    return entry;
  };
  for (const position of positions) {
    const entry = row(underlyingOf(position.coin));
    entry.perp += toNumber(position.szi) ?? 0;
    entry.price ??= priceOf(underlyingOf(position.coin), position);
  }
  for (const holding of lines) {
    if (holding.underlying === null || holding.underlyingAmount === null) continue;
    const entry = row(holding.underlying);
    if (holding.asset.toUpperCase() === "KHYPE") entry.lst += holding.underlyingAmount;
    else entry.spot += holding.underlyingAmount;
  }
  return [...rows.entries()]
    .map(([underlying, entry]): ExposureRow => {
      const price = entry.price ?? priceOf(underlying);
      const net = entry.perp + entry.spot + entry.lst;
      return {
        underlying,
        perp: round(entry.perp, 10),
        spot: round(entry.spot, 10),
        lst: round(entry.lst, 10),
        net: round(net, 10),
        priceUsd: price,
        netUsd: price === null ? null : roundUsd(net * price),
        isCash: isCashUnderlying(underlying),
      };
    })
    .filter((exposure) => exposure.net !== 0 || exposure.perp !== 0)
    .sort((a, b) => Math.abs(b.netUsd ?? -1) - Math.abs(a.netUsd ?? -1) || a.underlying.localeCompare(b.underlying));
}

/* ---------------------------------------------------------- the sheet */

function layerStatus(parts: readonly { readonly status: "ok" | "unavailable" | "error" }[]): LayerStatus {
  if (parts.length === 0) return "unavailable";
  if (parts.every((part) => part.status === "ok")) return "ok";
  if (parts.every((part) => part.status === "unavailable")) return "unavailable";
  if (parts.every((part) => part.status !== "ok")) return "error";
  return "partial";
}

function summary(layer: PortfolioLayer, lines: readonly BalanceLine[], sources: readonly LayerSource[]): LayerSummary {
  return {
    layer,
    status: layerStatus(sources),
    totalUsd: roundUsd(lines.reduce((total, entry) => total + (entry.usd ?? 0), 0)),
    unpricedLines: lines.filter((entry) => entry.usd === null).length,
    lines: [...lines].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.id.localeCompare(b.id)),
    sources,
  };
}

export function buildSnapshot(sources: PortfolioSources): PortfolioSnapshot {
  const table = sources.prices?.table ?? null;
  const hyper = hypercoreLines(sources);
  const evmLayers = (["hyperevm", "elysium"] as const).map((layer) => {
    const reads = sources.evm.filter((read) => read.layer === layer);
    const lines = reads.flatMap((read) => evmLines(table, read));
    const layerSources = reads.map((read): LayerSource => ({ network: read.network, part: "wallet", status: read.status, message: read.message, blockNumber: read.blockNumber === null ? null : read.blockNumber.toString() }));
    return summary(layer, lines, layerSources);
  });
  const layers = [summary("hypercore", hyper.lines, hyper.sourcesOut), ...evmLayers];

  const positions: PerpPositionView[] = [];
  const accounts: PerpAccountHealth[] = [];
  let unrealizedPnlUsd = 0;
  for (const read of sources.perps) {
    const collateralUsd = priceCoreBalance(table, sources.hypercoreNetwork, read.collateral.index, read.collateral.name).priceUsd;
    const dexPositions = positionsOf(read, collateralUsd);
    positions.push(...dexPositions);
    if (collateralUsd !== null) unrealizedPnlUsd += dexPositions.reduce((total, position) => total + position.unrealizedPnl * collateralUsd, 0);
    const health = accountHealth(read);
    if (health) accounts.push(health);
  }
  positions.sort((a, b) => Math.abs(b.positionValue) - Math.abs(a.positionValue) || a.id.localeCompare(b.id));

  const allLines = layers.flatMap((layer) => layer.lines);
  const exposure = exposureOf(allLines, positions, (underlying, position) => {
    if (underlying === "USD") return 1;
    const reference = table ? priceSymbol(table, underlying) : null;
    if (reference) return reference.usd;
    // On mainnet the venue mark is itself the reference (HIP-3 coins are not in the default mids).
    return sources.mode === "mainnet" && position ? position.markPx : null;
  });

  const byLayer = Object.fromEntries(layers.map((layer) => [layer.layer, layer.totalUsd])) as Record<PortfolioLayer, number>;
  const notes = [...(sources.notes ?? [])];
  if (sources.mode === "testnet") notes.push("Testnet holdings are valued at HyperCore mainnet reference prices; test assets have no market price of their own.");
  if (!sources.prices) notes.push("Reference prices are unavailable right now: USD values are missing, not zero.");
  else if (sources.prices.stale) notes.push(`Reference prices are from ${new Date(sources.prices.table.time).toISOString()} (refresh failed).`);

  return {
    address: sources.address,
    mode: sources.mode,
    generatedAt: sources.now,
    pricing: { source: REFERENCE_SOURCE, label: sources.mode === "testnet" ? "reference" : "market", time: table?.time ?? 0, khypeToHype: table?.khypeToHype ?? null },
    totals: {
      netWorthUsd: roundUsd(layers.reduce((total, layer) => total + layer.totalUsd, 0)),
      byLayer,
      unpricedLines: layers.reduce((total, layer) => total + layer.unpricedLines, 0),
      unrealizedPnlUsd: roundUsd(unrealizedPnlUsd),
      grossPerpNotionalUsd: roundUsd(positions.reduce((total, position) => total + Math.abs(position.positionValueUsd ?? 0), 0)),
    },
    layers,
    positions,
    accounts,
    exposure,
    dexes: sources.perps.map((read) => read.dex).filter((dex) => dex !== ""),
    notes,
  };
}
