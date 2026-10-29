/**
 * Whale liquidation map: where large positions of the top leaderboard
 * accounts would be liquidated.
 *
 * - The leaderboard dump (tens of MB) is read at most every 30 minutes and
 *   reduced to the top accounts by account value.
 * - One sweep reads `clearinghouseState` (weight 2) of those accounts, four
 *   at a time, at most every SWEEP_TTL_MS, shared by every coin and client.
 *   A sweep starts only when the REST budget keeps a reserve for everything
 *   else; otherwise the last sweep is served as stale, or 503.
 * - Liquidation prices are HyperCore's own (`liquidationPx`); levels are
 *   notional-weighted buckets by distance from mark.
 */
import type { NetworkEnvironment } from "@elyia/core";
import type { HyperCoreNetworkKey, LiquidationLevel, WhalePosition } from "@elyia/core/api/markets";
import type { ClearinghouseState } from "@elyia/core/hypercore/info";
import type { Clock } from "../../clock.js";
import { providerRateLimited } from "../../http/errors.js";
import type { HyperliquidClients } from "../../hyperliquid/index.js";
import type { FetchLike } from "../../hyperliquid/info.js";
import type { Logger } from "../../log.js";
import { liquidationDistancePct, signedDistancePct } from "../portfolio/liquidation.js";
import { RefreshingCacheMap, type CachedValue } from "./cache.js";
import { round, roundPct, roundUsd, toNumber } from "./num.js";
import { fetchStatsDump } from "./statsData.js";

export const WHALE_ACCOUNTS = 60;
export const SWEEP_TTL_MS = 3 * 60_000;
export const LEADERBOARD_TTL_MS = 30 * 60_000;
/** REST weight left untouched for everything else when a sweep would start. */
export const SWEEP_RESERVE_WEIGHT = 300;
const SWEEP_CONCURRENCY = 4;
const STATE_WEIGHT = 2;
const MAX_LEVELS = 10;

export interface LeaderboardEntry {
  readonly address: string;
  readonly accountValue: number;
  readonly displayName: string | null;
}

/** Top `limit` rows of the leaderboard dump by account value. */
export function parseLeaderboard(raw: unknown, limit: number): LeaderboardEntry[] {
  const rows = typeof raw === "object" && raw !== null && Array.isArray((raw as { leaderboardRows?: unknown }).leaderboardRows) ? (raw as { leaderboardRows: unknown[] }).leaderboardRows : Array.isArray(raw) ? raw : [];
  const entries: LeaderboardEntry[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const address = typeof record.ethAddress === "string" ? record.ethAddress.toLowerCase() : null;
    const accountValue = toNumber(record.accountValue);
    if (!address || !/^0x[0-9a-f]{40}$/u.test(address) || accountValue === null || accountValue <= 0) continue;
    entries.push({ address, accountValue, displayName: typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim().slice(0, 40) : null });
  }
  return entries.sort((a, b) => b.accountValue - a.accountValue).slice(0, limit);
}

export interface SweptPosition {
  readonly address: string;
  readonly displayName: string | null;
  readonly coin: string;
  readonly szi: number;
  readonly entryPx: string;
  readonly positionValue: number;
  readonly unrealizedPnl: number;
  readonly leverage: { readonly type: "cross" | "isolated"; readonly value: number };
  readonly liquidationPx: string | null;
}

export interface Sweep {
  readonly sweptAt: number;
  readonly accounts: number;
  readonly failed: number;
  readonly positions: readonly SweptPosition[];
}

export function positionsOf(entry: LeaderboardEntry, state: ClearinghouseState): SweptPosition[] {
  return state.assetPositions.flatMap(({ position }) => {
    const szi = toNumber(position.szi);
    const positionValue = toNumber(position.positionValue);
    if (szi === null || szi === 0 || positionValue === null) return [];
    return [
      {
        address: entry.address,
        displayName: entry.displayName,
        coin: position.coin,
        szi,
        entryPx: position.entryPx,
        positionValue,
        unrealizedPnl: toNumber(position.unrealizedPnl) ?? 0,
        leverage: { type: position.leverage.type, value: position.leverage.value },
        liquidationPx: position.liquidationPx,
      },
    ];
  });
}

export interface LiquidationMap {
  readonly positions: WhalePosition[];
  readonly longLiquidations: LiquidationLevel[];
  readonly shortLiquidations: LiquidationLevel[];
  readonly longNotionalUsd: number;
  readonly shortNotionalUsd: number;
  readonly accountsWithPosition: number;
}

function levels(entries: readonly { readonly px: number; readonly distance: number; readonly notional: number }[], bucketPct: number, minNotionalUsd: number): LiquidationLevel[] {
  const buckets = new Map<number, { weighted: number; distanceWeighted: number; notional: number; positions: number }>();
  for (const entry of entries) {
    const key = Math.floor(Math.abs(entry.distance) / bucketPct);
    const bucket = buckets.get(key) ?? { weighted: 0, distanceWeighted: 0, notional: 0, positions: 0 };
    bucket.weighted += entry.px * entry.notional;
    bucket.distanceWeighted += entry.distance * entry.notional;
    bucket.notional += entry.notional;
    bucket.positions += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, bucket]) => ({
      px: round(bucket.weighted / bucket.notional, 8),
      distancePct: roundPct(bucket.distanceWeighted / bucket.notional),
      notionalUsd: roundUsd(bucket.notional),
      positions: bucket.positions,
    }))
    .filter((level) => level.notionalUsd >= minNotionalUsd)
    .slice(0, MAX_LEVELS);
}

/** Positions of one coin and their liquidation levels around `mark`. */
export function liquidationMap(input: {
  readonly coin: string;
  readonly mark: number | null;
  readonly positions: readonly SweptPosition[];
  readonly bucketPct: number;
  readonly minNotionalUsd: number;
  readonly limit: number;
}): LiquidationMap {
  const mine = input.positions.filter((position) => position.coin === input.coin);
  const longs: { px: number; distance: number; notional: number }[] = [];
  const shorts: { px: number; distance: number; notional: number }[] = [];
  let longNotional = 0;
  let shortNotional = 0;
  const views = mine.map((position): WhalePosition => {
    const side = position.szi > 0 ? 1 : -1;
    const notional = Math.abs(position.positionValue);
    if (side === 1) longNotional += notional;
    else shortNotional += notional;
    const liq = toNumber(position.liquidationPx);
    const distance = input.mark !== null && liq !== null ? signedDistancePct(input.mark, liq) : null;
    if (liq !== null && liq > 0 && distance !== null && input.mark !== null) {
      // Only liquidations still ahead of the mark (a long below it, a short above it).
      if (side === 1 && liq < input.mark) longs.push({ px: liq, distance, notional });
      if (side === -1 && liq > input.mark) shorts.push({ px: liq, distance, notional });
    }
    return {
      address: position.address,
      displayName: position.displayName,
      side: side === 1 ? "long" : "short",
      size: String(Math.abs(position.szi)),
      notionalUsd: roundUsd(notional),
      entryPx: position.entryPx,
      leverage: position.leverage,
      liquidationPx: position.liquidationPx,
      liquidationDistancePct: input.mark === null ? null : liquidationDistancePct(side, input.mark, liq),
      unrealizedPnl: roundUsd(position.unrealizedPnl),
    };
  });
  return {
    positions: views.sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, input.limit),
    longLiquidations: levels(longs, input.bucketPct, input.minNotionalUsd),
    shortLiquidations: levels(shorts, input.bucketPct, input.minNotionalUsd),
    longNotionalUsd: roundUsd(longNotional),
    shortNotionalUsd: roundUsd(shortNotional),
    accountsWithPosition: new Set(mine.map((position) => position.address)).size,
  };
}

async function mapLimited<T, R>(items: readonly T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface WhaleWatchDeps {
  readonly hyperliquid: HyperliquidClients;
  readonly fetch: FetchLike;
  readonly clock: Clock;
  readonly log?: Logger;
  readonly accounts?: number;
  readonly reserveWeight?: number;
}

export class WhaleWatch {
  private readonly leaderboards: RefreshingCacheMap<readonly LeaderboardEntry[]>;
  private readonly sweeps: RefreshingCacheMap<Sweep>;

  constructor(private readonly deps: WhaleWatchDeps) {
    const accounts = deps.accounts ?? WHALE_ACCOUNTS;
    this.leaderboards = new RefreshingCacheMap(async (environment) => parseLeaderboard(await fetchStatsDump(deps.fetch, environment as NetworkEnvironment, "leaderboard"), accounts), {
      ttlMs: LEADERBOARD_TTL_MS,
      maxStaleMs: 6 * 60 * 60_000,
      clock: deps.clock,
      errorBackoffMs: 60_000,
      maxEntries: 2,
    });
    this.sweeps = new RefreshingCacheMap((network) => this.sweep(network as HyperCoreNetworkKey), {
      ttlMs: SWEEP_TTL_MS,
      maxStaleMs: 20 * 60_000,
      clock: deps.clock,
      errorBackoffMs: 15_000,
      maxEntries: 2,
    });
  }

  /** The latest sweep of `network` (shared; refreshed at most every SWEEP_TTL_MS). */
  latest(network: HyperCoreNetworkKey): Promise<CachedValue<Sweep>> {
    return this.sweeps.get(network);
  }

  private async sweep(network: HyperCoreNetworkKey): Promise<Sweep> {
    const environment: NetworkEnvironment = network === "hypercore-mainnet" ? "mainnet" : "testnet";
    const { value: entries } = await this.leaderboards.get(environment);
    const info = this.deps.hyperliquid.info(network);
    const needed = entries.length * STATE_WEIGHT + (this.deps.reserveWeight ?? SWEEP_RESERVE_WEIGHT);
    if (info.remainingWeight < needed) throw providerRateLimited("Hyperliquid", 30);
    let failed = 0;
    const results = await mapLimited(entries, SWEEP_CONCURRENCY, async (entry) => {
      try {
        return positionsOf(entry, await info.clearinghouseState(entry.address));
      } catch {
        failed += 1;
        return [];
      }
    });
    if (entries.length > 0 && failed > entries.length / 2) throw providerRateLimited("Hyperliquid", 30);
    this.deps.log?.info("whale sweep done", { network, accounts: entries.length, failed });
    return { sweptAt: this.deps.clock.now(), accounts: entries.length, failed, positions: results.flat() };
  }
}
