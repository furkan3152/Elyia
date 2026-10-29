/**
 * MarketCatalog: HyperCore market metadata and contexts behind short shared
 * snapshots, so a busy market list costs a bounded REST weight:
 *
 *   perp contexts per dex, spot contexts   15 s   (weight 20 each per refresh)
 *   dex directory (perpDexs + allPerpMetas) 5 min
 *   HIP-3 bulk (`dex=all`)                 60 s, at most MAX_BULK_DEXES dexes
 *   predicted fundings                     30 s
 *
 * The info client's own per-type cache stays at its defaults (other modules
 * share it and need fresher data); these snapshots sit on top of it. Live
 * prices belong to GET /v1/markets/stream.
 */
import { tokenForCoreIndex } from "@elyia/core";
import type { HyperCoreNetworkKey, MarketRow, PerpDexSummary } from "@elyia/core/api/markets";
import type { MetaAndAssetCtxs, PerpMeta, SpotMeta, SpotMetaAndAssetCtxs } from "@elyia/core/hypercore/info";
import type { Clock } from "../../clock.js";
import { ElyiaHttpError } from "../../http/errors.js";
import type { HyperliquidClients } from "../../hyperliquid/index.js";
import type { InfoRequest, PerpDex, PredictedFundings } from "../../hyperliquid/types.js";
import { RefreshingCacheMap } from "./cache.js";
import { buildPerpRows, buildSpotRows, perpAssetId, perpDexOf } from "./catalog.js";
import { priceMainnetToken, type ReferencePriceService } from "./reference.js";

export const CONTEXT_TTL_MS = 15_000;
export const DIRECTORY_TTL_MS = 5 * 60_000;
export const BULK_TTL_MS = 60_000;
export const FUNDING_TTL_MS = 30_000;
export const MAX_BULK_DEXES = 8;
const USDC_INDEX = 0;

export type ResolvedMarket =
  | { readonly type: "perp"; readonly coin: string; readonly dex: string; readonly dexIndex: number; readonly universeIndex: number }
  | { readonly type: "spot"; readonly coin: string; readonly pairIndex: number };

export interface DexDirectory {
  readonly dexes: readonly PerpDexSummary[];
  /** Name -> index in `perpDexs`. */
  readonly indexByName: ReadonlyMap<string, number>;
}

export interface CatalogDeps {
  readonly hyperliquid: HyperliquidClients;
  readonly reference: ReferencePriceService;
  readonly clock: Clock;
}

export function marketNotFound(coin: string): ElyiaHttpError {
  return new ElyiaHttpError("MARKET_NOT_FOUND", 404, `No HyperCore market is called ${coin}. List markets with GET /v1/markets.`, { coin });
}

function dexNotFound(dex: string): ElyiaHttpError {
  return new ElyiaHttpError("DEX_NOT_FOUND", 404, `No HIP-3 perp dex is called ${dex}. The response of GET /v1/markets lists them.`, { dex });
}

/** Directory rows from `perpDexs` and `allPerpMetas` (same order: index 0 is the first dex). */
export function buildDexDirectory(perpDexs: ReadonlyArray<PerpDex | null>, metas: readonly PerpMeta[], spotTokens: ReadonlyMap<number, string>): DexDirectory {
  const dexes: PerpDexSummary[] = [];
  const indexByName = new Map<string, number>();
  perpDexs.forEach((dex, index) => {
    if (!dex || index === 0) return;
    const meta = metas[index];
    const universe = meta?.universe ?? [];
    indexByName.set(dex.name, index);
    dexes.push({
      name: dex.name,
      fullName: dex.fullName,
      index,
      markets: universe.length,
      liveMarkets: universe.filter((asset) => asset.isDelisted !== true).length,
      collateral: meta?.collateralToken === undefined ? null : (spotTokens.get(meta.collateralToken) ?? null),
      collateralToken: meta?.collateralToken ?? null,
    });
  });
  return { dexes, indexByName };
}

export class MarketCatalog {
  private readonly perpCache: RefreshingCacheMap<MetaAndAssetCtxs>;
  private readonly bulkCache: RefreshingCacheMap<MetaAndAssetCtxs>;
  private readonly spotCache: RefreshingCacheMap<SpotMetaAndAssetCtxs>;
  private readonly directories: RefreshingCacheMap<DexDirectory>;
  private readonly fundingCache: RefreshingCacheMap<PredictedFundings>;

  constructor(private readonly deps: CatalogDeps) {
    const clock = deps.clock;
    this.perpCache = new RefreshingCacheMap((key) => this.loadPerps(key), { ttlMs: CONTEXT_TTL_MS, maxStaleMs: 5 * 60_000, clock, errorBackoffMs: 2_000, maxEntries: 64 });
    this.bulkCache = new RefreshingCacheMap((key) => this.loadPerps(key), { ttlMs: BULK_TTL_MS, maxStaleMs: 10 * 60_000, clock, errorBackoffMs: 5_000, maxEntries: 64 });
    this.spotCache = new RefreshingCacheMap((key) => this.deps.hyperliquid.info(key as HyperCoreNetworkKey).spotMetaAndAssetCtxs(), {
      ttlMs: CONTEXT_TTL_MS,
      maxStaleMs: 5 * 60_000,
      clock,
      errorBackoffMs: 2_000,
      maxEntries: 4,
    });
    this.directories = new RefreshingCacheMap((key) => this.loadDirectory(key as HyperCoreNetworkKey), {
      ttlMs: DIRECTORY_TTL_MS,
      maxStaleMs: 60 * 60_000,
      clock,
      errorBackoffMs: 10_000,
      maxEntries: 4,
    });
    this.fundingCache = new RefreshingCacheMap((key) => this.deps.hyperliquid.info(key as HyperCoreNetworkKey).predictedFundings(), {
      ttlMs: FUNDING_TTL_MS,
      maxStaleMs: 10 * 60_000,
      clock,
      errorBackoffMs: 5_000,
      maxEntries: 4,
    });
  }

  /** Cross-venue funding predictions (first dex only), from the 30 s snapshot. */
  predictedFundings(network: HyperCoreNetworkKey): Promise<PredictedFundings> {
    return this.fundingCache.get(network).then((cached) => cached.value);
  }

  private loadPerps(key: string): Promise<MetaAndAssetCtxs> {
    const [network, dex] = key.split("|") as [HyperCoreNetworkKey, string];
    return this.deps.hyperliquid.info(network).metaAndAssetCtxs(dex || undefined);
  }

  private async loadDirectory(network: HyperCoreNetworkKey): Promise<DexDirectory> {
    const info = this.deps.hyperliquid.info(network);
    // `allPerpMetas` (one meta per dex, weight 20) is not in the shared request union; its shape is PerpMeta[].
    const allPerpMetas = { type: "allPerpMetas" } as unknown as InfoRequest;
    const [perpDexs, metas, spotMeta] = await Promise.all([
      info.perpDexs(),
      info.request<readonly PerpMeta[]>(allPerpMetas, { cacheMs: DIRECTORY_TTL_MS }),
      info.spotMeta(),
    ]);
    return buildDexDirectory(perpDexs, metas, new Map(spotMeta.tokens.map((token) => [token.index, token.name])));
  }

  directory(network: HyperCoreNetworkKey): Promise<DexDirectory> {
    return this.directories.get(network).then((cached) => cached.value);
  }

  async dexIndex(network: HyperCoreNetworkKey, dex: string): Promise<number> {
    if (dex === "") return 0;
    const index = (await this.directory(network)).indexByName.get(dex);
    if (index === undefined) throw dexNotFound(dex);
    return index;
  }

  /** Perp meta + contexts of one dex (`""` = first dex), from the 15 s snapshot. */
  async perpContexts(network: HyperCoreNetworkKey, dex: string, bulk = false): Promise<{ readonly value: MetaAndAssetCtxs; readonly fetchedAt: number }> {
    const cache = bulk ? this.bulkCache : this.perpCache;
    return cache.get(`${network}|${dex}`);
  }

  async spotContexts(network: HyperCoreNetworkKey): Promise<{ readonly value: SpotMetaAndAssetCtxs; readonly fetchedAt: number }> {
    return this.spotCache.get(network);
  }

  /** USD per unit of a spot quote/collateral token on `network`: 1 for USDC; mainnet tokens at their reference price; unknown otherwise. */
  async quoteUsdResolver(network: HyperCoreNetworkKey): Promise<(tokenIndex: number) => number | null> {
    if (network === "hypercore-testnet") return (index) => (index === USDC_INDEX ? 1 : null);
    const table = await this.deps.reference.table().then((cached) => cached.value).catch(() => null);
    return (index) => {
      if (index === USDC_INDEX) return 1;
      return table ? (priceMainnetToken(table, index)?.usd ?? null) : null;
    };
  }

  /** Rows of one perp dex. */
  async perpRows(network: HyperCoreNetworkKey, dex: string, bulk = false): Promise<MarketRow[]> {
    const dexIndex = await this.dexIndex(network, dex);
    const [{ value }, quoteUsd, spotNames] = await Promise.all([this.perpContexts(network, dex, bulk), this.quoteUsdResolver(network), this.spotTokenNames(network)]);
    const [meta, ctxs] = value;
    const collateralIndex = meta.collateralToken ?? USDC_INDEX;
    return buildPerpRows({ dex, dexIndex, meta, ctxs, collateral: spotNames.get(collateralIndex) ?? "USDC", quoteUsd: quoteUsd(collateralIndex) });
  }

  async spotRows(network: HyperCoreNetworkKey): Promise<MarketRow[]> {
    const [{ value }, quoteUsd] = await Promise.all([this.spotContexts(network), this.quoteUsdResolver(network)]);
    const [meta, ctxs] = value;
    return buildSpotRows({ meta, ctxs, quoteUsd });
  }

  private async spotTokenNames(network: HyperCoreNetworkKey): Promise<ReadonlyMap<number, string>> {
    const meta = await this.deps.hyperliquid.info(network).spotMeta();
    return new Map(meta.tokens.map((token) => [token.index, token.name]));
  }

  /** HIP-3 dexes with live markets for `dex=all`, most live markets first, capped. */
  async bulkDexes(network: HyperCoreNetworkKey): Promise<{ readonly selected: readonly string[]; readonly omitted: number }> {
    const { dexes } = await this.directory(network);
    const live = dexes.filter((dex) => dex.liveMarkets > 0).sort((a, b) => b.liveMarkets - a.liveMarkets || a.index - b.index);
    return { selected: live.slice(0, MAX_BULK_DEXES).map((dex) => dex.name), omitted: Math.max(0, live.length - MAX_BULK_DEXES) };
  }

  /**
   * Resolves a coin as HyperCore names books (`BTC`, `xyz:TSLA`, `@1035`,
   * `PURR/USDC`) or a spot display name (`HYPE/USDC`, canonical pair first).
   * 404 MARKET_NOT_FOUND otherwise, so nothing unknown reaches upstream.
   */
  async resolve(network: HyperCoreNetworkKey, coin: string): Promise<ResolvedMarket> {
    const info = this.deps.hyperliquid.info(network);
    if (coin.includes("/") || coin.startsWith("@")) {
      const evm = network === "hypercore-mainnet" ? "hyperevm-mainnet" : "hyperevm-testnet";
      return resolveSpot(await info.spotMeta(), coin, (index) => tokenForCoreIndex(evm, index) !== null);
    }
    const dex = perpDexOf(coin);
    const dexIndex = await this.dexIndex(network, dex).catch((error: unknown) => {
      if (error instanceof ElyiaHttpError && error.code === "DEX_NOT_FOUND") throw marketNotFound(coin);
      throw error;
    });
    const meta = await info.meta(dex || undefined);
    const universeIndex = meta.universe.findIndex((asset) => asset.name === coin);
    if (universeIndex < 0) throw marketNotFound(coin);
    return { type: "perp", coin, dex, dexIndex, universeIndex };
  }

  /** The row of one resolved market, from the shared snapshots. */
  async row(network: HyperCoreNetworkKey, market: ResolvedMarket): Promise<{ readonly row: MarketRow; readonly perpMeta: PerpMeta | null; readonly spotMeta: SpotMeta | null }> {
    if (market.type === "perp") {
      const rows = await this.perpRows(network, market.dex);
      const row = rows[market.universeIndex];
      if (!row || row.coin !== market.coin || row.assetId !== perpAssetId(market.dexIndex, market.universeIndex)) throw marketNotFound(market.coin);
      const { value } = await this.perpContexts(network, market.dex);
      return { row, perpMeta: value[0], spotMeta: null };
    }
    const rows = await this.spotRows(network);
    const row = rows.find((candidate) => candidate.coin === market.coin);
    if (!row) throw marketNotFound(market.coin);
    const { value } = await this.spotContexts(network);
    return { row, perpMeta: null, spotMeta: value[0] };
  }

  clear(): void {
    this.perpCache.clear();
    this.bulkCache.clear();
    this.spotCache.clear();
    this.directories.clear();
    this.fundingCache.clear();
  }
}

/**
 * Spot pair by book coin (`@1035`, `PURR/USDC`) or by `BASE/QUOTE` token
 * names. Token names repeat on testnet, so ties go to canonical pairs, then to
 * base tokens Elyia's registry links (`isKnownToken`), then to the oldest pair.
 */
export function resolveSpot(meta: SpotMeta, coin: string, isKnownToken: (index: number) => boolean = () => false): ResolvedMarket {
  const direct = meta.universe.find((pair) => pair.name === coin);
  if (direct) return { type: "spot", coin: direct.name, pairIndex: direct.index };
  const slash = coin.indexOf("/");
  if (slash > 0) {
    const baseName = coin.slice(0, slash).toUpperCase();
    const quoteName = coin.slice(slash + 1).toUpperCase();
    const tokens = new Map(meta.tokens.map((token) => [token.index, token]));
    const candidates = meta.universe.filter((pair) => tokens.get(pair.tokens[0])?.name.toUpperCase() === baseName && tokens.get(pair.tokens[1])?.name.toUpperCase() === quoteName);
    const rank = (pair: (typeof candidates)[number]) => (pair.isCanonical ? 0 : isKnownToken(pair.tokens[0]) ? 1 : 2);
    const best = [...candidates].sort((a, b) => rank(a) - rank(b) || a.index - b.index)[0];
    if (best) return { type: "spot", coin: best.name, pairIndex: best.index };
  }
  throw marketNotFound(coin);
}
