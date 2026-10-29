/**
 * Fetches the raw history of one address and builds it (cached 60 s per
 * address, mode and window). Upstream cost per refresh: userFillsByTime
 * (20 + 1 per 20 fills), userFunding (20 + 1 per 20, at most
 * MAX_FUNDING_PAGES pages of 500), userNonFundingLedgerUpdates (20) and
 * portfolio (20). Each part fails on its own; the response says which.
 */
import { tokensFor } from "@elyia/core";
import type { PortfolioHistory, PortfolioMode } from "@elyia/core/api/portfolio";
import type { LedgerUpdate, UserFill, UserFundingEntry } from "@elyia/core/hypercore/info";
import type { Clock } from "../../clock.js";
import { isElyiaHttpError } from "../../http/errors.js";
import type { HyperliquidClients } from "../../hyperliquid/index.js";
import { RefreshingCacheMap } from "../markets/cache.js";
import { priceSymbol, type ReferenceTable } from "../markets/reference.js";
import type { LedgerServices } from "../markets/services.js";
import { buildHistory } from "./history.js";
import { hyperCoreNetworkFor } from "./sources.js";

export const HISTORY_TTL_MS = 60_000;
export const FUNDING_PAGE_SIZE = 500;
export const MAX_FUNDING_PAGES = 4;
/** HyperCore returns at most this many fills per userFillsByTime call. */
export const FILLS_PAGE_SIZE = 2_000;
const DAY_MS = 86_400_000;

function message(error: unknown): string {
  return isElyiaHttpError(error) ? error.message : "Not available right now.";
}

/** Fee-token valuation: on testnet only tokens the registry links to HyperCore (names repeat there). */
export function feeValuer(table: ReferenceTable | null, mode: PortfolioMode): (token: string) => number | null {
  const linked = new Set(tokensFor(mode === "mainnet" ? "hyperevm-mainnet" : "hyperevm-testnet").flatMap((token) => (token.coreToken ? [token.coreToken.name.toUpperCase()] : [])));
  return (token) => {
    if (!table) return null;
    if (mode === "testnet" && !linked.has(token.toUpperCase())) return null;
    return priceSymbol(table, token)?.usd ?? null;
  };
}

export class HistoryReader {
  private readonly cache: RefreshingCacheMap<PortfolioHistory>;

  constructor(private readonly deps: { readonly hyperliquid: HyperliquidClients; readonly services: LedgerServices; readonly clock: Clock }) {
    this.cache = new RefreshingCacheMap((key) => this.load(key), { ttlMs: HISTORY_TTL_MS, maxStaleMs: HISTORY_TTL_MS * 5, clock: deps.clock, maxEntries: 256 });
  }

  async get(address: string, mode: PortfolioMode, days: number): Promise<PortfolioHistory> {
    return (await this.cache.get(`${mode}|${address}|${days}`)).value;
  }

  private async load(key: string): Promise<PortfolioHistory> {
    const [mode, address, daysText] = key.split("|") as [PortfolioMode, string, string];
    const info = this.deps.hyperliquid.info(hyperCoreNetworkFor(mode));
    const now = this.deps.clock.now();
    const from = now - Number(daysText) * DAY_MS;

    const fundingPages = async (): Promise<{ items: UserFundingEntry[]; truncated: boolean }> => {
      const items: UserFundingEntry[] = [];
      let start = from;
      for (let page = 0; page < MAX_FUNDING_PAGES; page += 1) {
        const batch = await info.userFunding(address, start);
        items.push(...batch);
        const last = batch[batch.length - 1];
        if (batch.length < FUNDING_PAGE_SIZE || !last) return { items, truncated: false };
        start = last.time + 1;
      }
      return { items, truncated: true };
    };

    const [fills, funding, ledger, portfolio, table] = await Promise.all([
      info.userFillsByTime(address, from, undefined, true).then(
        (items: readonly UserFill[]) => ({ items, truncated: items.length >= FILLS_PAGE_SIZE, message: null }),
        (error: unknown) => ({ items: null, truncated: false, message: message(error) }),
      ),
      fundingPages().then(
        ({ items, truncated }) => ({ items, truncated, message: null }),
        (error: unknown) => ({ items: null, truncated: false, message: message(error) }),
      ),
      info.userNonFundingLedgerUpdates(address, from).then(
        (items: readonly LedgerUpdate[]) => ({ items, truncated: false, message: null }),
        (error: unknown) => ({ items: null, truncated: false, message: message(error) }),
      ),
      info.portfolio(address).then(
        (value) => ({ value, message: null }),
        (error: unknown) => ({ value: null, message: message(error) }),
      ),
      this.deps.services.reference.table().then(
        (cached) => cached.value,
        () => null,
      ),
    ]);
    return buildHistory({ address, mode, from, to: now, now, fills, funding, ledger, portfolio, feeUsd: feeValuer(table, mode) });
  }
}
