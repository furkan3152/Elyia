/**
 * HyperCore vaults from the public stats dump (the `vaultSummaries` info
 * request answers `[]` on testnet). Cached 5 minutes per network; on a
 * failed refresh the previous list is served (marked stale) for up to an hour.
 */
import type { NetworkEnvironment } from "@elyia/core";
import type { VaultRow } from "@elyia/core/api/markets";
import type { Clock } from "../../clock.js";
import type { FetchLike } from "../../hyperliquid/info.js";
import { RefreshingCacheMap, type CachedValue } from "./cache.js";
import { roundPct, roundUsd, toNumber } from "./num.js";
import { fetchStatsDump } from "./statsData.js";

export const VAULTS_TTL_MS = 5 * 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function lastAllTimePnl(pnls: unknown): number | null {
  if (!Array.isArray(pnls)) return null;
  const entry = pnls.find((item): item is [string, unknown[]] => Array.isArray(item) && item[0] === "allTime" && Array.isArray(item[1]));
  const series = entry?.[1];
  return series && series.length > 0 ? toNumber(series[series.length - 1]) : null;
}

/** Rows of the dump, largest TVL first. Malformed entries are skipped, never guessed. */
export function parseVaultDump(raw: unknown): VaultRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: VaultRow[] = [];
  for (const item of raw) {
    const entry = record(item);
    const summary = record(entry?.summary);
    if (!entry || !summary) continue;
    const address = typeof summary.vaultAddress === "string" ? summary.vaultAddress.toLowerCase() : null;
    const tvl = toNumber(summary.tvl);
    if (!address || !/^0x[0-9a-f]{40}$/u.test(address) || tvl === null) continue;
    const apr = toNumber(entry.apr);
    const relationship = record(summary.relationship);
    const pnl = lastAllTimePnl(entry.pnls);
    rows.push({
      address,
      name: typeof summary.name === "string" ? summary.name.slice(0, 120) : address,
      leader: typeof summary.leader === "string" ? summary.leader.toLowerCase() : "",
      tvlUsd: roundUsd(tvl),
      aprPct: apr === null ? null : roundPct(apr * 100),
      isClosed: summary.isClosed === true,
      relationship: typeof relationship?.type === "string" ? relationship.type : "normal",
      createdAt: typeof summary.createTimeMillis === "number" ? summary.createTimeMillis : null,
      allTimePnlUsd: pnl === null ? null : roundUsd(pnl),
    });
  }
  return rows.sort((a, b) => b.tvlUsd - a.tvlUsd);
}

export interface VaultList {
  readonly rows: readonly VaultRow[];
  readonly byAddress: ReadonlyMap<string, VaultRow>;
}

export class VaultDirectory {
  private readonly cache: RefreshingCacheMap<VaultList>;

  constructor(deps: { readonly fetch: FetchLike; readonly clock: Clock }) {
    this.cache = new RefreshingCacheMap(
      async (environment) => {
        const rows = parseVaultDump(await fetchStatsDump(deps.fetch, environment as NetworkEnvironment, "vaults"));
        return { rows, byAddress: new Map(rows.map((row) => [row.address, row])) };
      },
      { ttlMs: VAULTS_TTL_MS, maxStaleMs: 60 * 60_000, clock: deps.clock, errorBackoffMs: 30_000, maxEntries: 2 },
    );
  }

  list(environment: NetworkEnvironment): Promise<CachedValue<VaultList>> {
    return this.cache.get(environment);
  }

  /** A vault's row when the list is already loaded (never triggers the download). */
  peek(environment: NetworkEnvironment, address: string): VaultRow | null {
    return this.cache.peek(environment)?.value.byAddress.get(address.toLowerCase()) ?? null;
  }
}
