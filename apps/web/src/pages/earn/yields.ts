/**
 * Yields (pure): every place idle HYPE or USDC can earn, ranked the same
 * way for all of them, and the geometry of the yield range (one peak per
 * yield: height = APR, base = TVL).
 *
 * Sources, read live:
 * - HyperCore staking: `validatorSummaries`, the stake-weighted weekly
 *   `predictedApr` of active, unjailed validators;
 * - kHYPE (Kinetiq): liquid staking of the same validator rewards, less
 *   Kinetiq's fee; Elyia shows the underlying rate, labelled as an estimate;
 * - HLP and user vaults: the Elyia API (`/v1/vaults`), else the public
 *   stats dump. Child vaults (HLP strategies) take no deposits and are
 *   folded into their parent.
 */
import type { VaultRow } from "@elyia/core/api/markets";

import type { Layer } from "../../topo/geometry/relief";

export type YieldKind = "staking" | "liquid-staking" | "vault" | "lending";

export interface YieldRow {
  readonly id: string;
  readonly name: string;
  readonly kind: YieldKind;
  readonly layer: Layer;
  /** Annual rate in percent; null when unknown. */
  readonly aprPct: number | null;
  /** USD (reference) or test-USDC on testnet; null when unknown. */
  readonly tvlUsd: number | null;
  readonly asset: "HYPE" | "USDC" | "KALOS";
  /** How Elyia gets you in: planned here, or "on Hyperliquid" until the planner executes it. */
  readonly entry: "planner" | "external";
  readonly note: string;
  readonly href?: string;
  /** The APR is derived, not quoted by the venue itself. */
  readonly estimated?: boolean;
  /** The engine venue that executes it (GET /v1/venues id): deposit and withdraw become route cards. */
  readonly venue?: EarnVenue;
  /** TVL in words when it cannot be priced in USD ("1.2M KALOS · unpriced"). */
  readonly tvlNote?: string;
}

/** How the planner enters and leaves a yield (IntentActionSpec fields). */
export interface EarnVenue {
  readonly protocol: string;
  /** "elysium" or "hyperevm": resolved to the mode's network. */
  readonly family: "elysium" | "hyperevm";
  readonly verb: "stake" | "deposit";
  readonly depositAsset: string;
  /** Withdraw: what is redeemed (`from`) or received (`to`); absent when withdrawing is not executed here. */
  readonly withdraw?: { readonly from?: string; readonly to?: string; readonly unit: string };
}

export interface ValidatorSummary {
  readonly validator: string;
  readonly name: string;
  readonly stake: number;
  readonly isJailed: boolean;
  readonly isActive: boolean;
  readonly commission: string;
  readonly stats: ReadonlyArray<readonly [string, { readonly predictedApr: string; readonly uptimeFraction: string }]>;
}

/** HYPE on HyperCore has 8 decimals; `stake` is in those units. */
const HYPE_WEI = 1e8;

/** Stake-weighted weekly predicted APR (percent) and total active stake (HYPE). */
export function stakingRate(validators: readonly ValidatorSummary[]): { readonly aprPct: number | null; readonly stakedHype: number; readonly validators: number } {
  const active = validators.filter((validator) => validator.isActive && !validator.isJailed && validator.stake > 0);
  const total = active.reduce((sum, validator) => sum + validator.stake, 0);
  if (total <= 0) return { aprPct: null, stakedHype: 0, validators: 0 };
  let weighted = 0;
  for (const validator of active) {
    const week = validator.stats.find(([window]) => window === "week")?.[1];
    const apr = week ? Number(week.predictedApr) : NaN;
    if (Number.isFinite(apr)) weighted += apr * validator.stake;
  }
  return { aprPct: (weighted / total) * 100, stakedHype: total / HYPE_WEI, validators: active.length };
}

/** A stats-dump vault (`stats-data.hyperliquid.xyz/<net>/vaults`) as a VaultRow. */
export interface DumpVault {
  readonly apr: number;
  readonly summary: { readonly name: string; readonly vaultAddress: string; readonly leader: string; readonly tvl: string; readonly isClosed: boolean; readonly relationship?: { readonly type: string }; readonly createTimeMillis?: number };
}

export function vaultFromDump(entry: DumpVault): VaultRow {
  return {
    address: entry.summary.vaultAddress,
    name: entry.summary.name,
    leader: entry.summary.leader,
    tvlUsd: Number(entry.summary.tvl) || 0,
    aprPct: Number.isFinite(entry.apr) ? entry.apr * 100 : null,
    isClosed: entry.summary.isClosed,
    relationship: entry.summary.relationship?.type ?? "normal",
    createdAt: entry.summary.createTimeMillis ?? null,
    allTimePnlUsd: null,
  };
}

/** Open, depositable vaults (no child strategies), largest first, with a TVL floor. */
export function depositableVaults(rows: readonly VaultRow[], minTvl = 10_000): VaultRow[] {
  return rows.filter((row) => !row.isClosed && row.relationship !== "child" && row.tvlUsd >= minTvl).sort((a, b) => b.tvlUsd - a.tvlUsd);
}

/**
 * The trail score: APR, discounted for thin pools on a log scale. The TVL
 * weight is 0 at $10k and 1 at $10M (a third per decade between), so a
 * 300% APR on $5k never outranks HLP. Unknown APR sinks to the bottom.
 */
export function trailScore(row: Pick<YieldRow, "aprPct" | "tvlUsd">): number {
  if (row.aprPct === null) return Number.NEGATIVE_INFINITY;
  const tvl = row.tvlUsd ?? 0;
  const decades = tvl > 0 ? Math.log10(tvl) : 0;
  const weight = Math.max(0, Math.min(1, (decades - 4) / 3));
  const apr = Math.max(-100, Math.min(row.aprPct, 200));
  return apr * weight;
}

export function rankYields(rows: readonly YieldRow[]): YieldRow[] {
  return [...rows].sort((a, b) => trailScore(b) - trailScore(a) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
}

/* ------------------------------------------------------- the yield range */

export interface Peak {
  readonly id: string;
  readonly x: number;
  readonly base: number;
  /** Ground line y. */
  readonly ground: number;
  /** Summit y (above the ground for gains, below for a losing vault). */
  readonly top: number;
  readonly basin: boolean;
}

/**
 * One peak per yield, left to right in rank order: height ∝ APR on a
 * square-root scale (so 5% and 50% both read), base ∝ log TVL. A negative
 * APR is a basin under the ground line.
 */
export function yieldPeaks(rows: readonly YieldRow[], width: number, height: number, ground: number): Peak[] {
  if (rows.length === 0) return [];
  // Gains and losses scale separately, so one deep basin never flattens every peak.
  const maxGain = Math.max(1, ...rows.map((row) => row.aprPct ?? 0));
  const maxLoss = Math.max(1, ...rows.map((row) => -(row.aprPct ?? 0)));
  const slot = width / rows.length;
  return rows.map((row, index) => {
    const apr = row.aprPct ?? 0;
    const rise = apr < 0 ? Math.sqrt(-apr / maxLoss) * Math.min(10, height - ground - 8) : Math.sqrt(apr / maxGain) * (ground - 72);
    const tvl = row.tvlUsd ?? 0;
    const base = Math.max(slot * 0.38, Math.min(slot * 1.5, (tvl > 0 ? Math.log10(tvl) / 8 : 0.3) * slot * 1.6));
    return { id: row.id, x: slot * index + slot / 2, base, ground, top: apr < 0 ? ground + rise : ground - Math.max(6, rise), basin: apr < 0 };
  });
}

export function formatApr(aprPct: number | null): string {
  if (aprPct === null) return "n/a";
  const sign = aprPct < 0 ? "−" : "";
  const value = Math.abs(aprPct);
  return `${sign}${value >= 100 ? value.toFixed(0) : value.toFixed(2)}%`;
}

export function formatTvl(usd: number | null): string {
  if (usd === null) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}k`;
  return `$${usd.toFixed(0)}`;
}
