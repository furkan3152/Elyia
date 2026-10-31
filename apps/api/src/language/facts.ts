/**
 * Live facts for the HTTP reader, all optional and all cached: the HyperCore
 * market universe (first dex, spot, and the HIP-3 dexes the catalog bulk-reads),
 * reference USD prices (HyperCore mainnet mids, labelled "reference"), and
 * Elysium Names resolution (ElyNames `resolve(string)` on Elysium testnet,
 * 0x13A1…6ddD, verified 2026-10-31). A failed read leaves the fact out; the
 * reader then asks instead of assuming.
 */
import type { NetworkEnvironment } from "@elyia/core";
import type { HyperCoreNetworkKey } from "@elyia/core/api/markets";
import { parseAbi, type Address } from "viem";
import type { AppContext } from "../context.js";
import { ledgerServices } from "../modules/markets/services.js";
import { priceSymbol } from "../modules/markets/reference.js";
import type { MarketFact } from "./entities.js";

export const MARKET_FACTS_TTL_MS = 60_000;
export const NAME_TTL_MS = 5 * 60_000;
const MAX_HIP3_DEXES = 6;

/** ElyNames registry on Elysium testnet (research/elysium-protocols.json, eth_getCode 11,723 B; resolve("bona") -> 0xe49D…175e). */
export const ELY_NAMES: Readonly<Partial<Record<NetworkEnvironment, Address>>> = Object.freeze({ testnet: "0x13A130B336400409c956dF042C128238F1486ddD" });
const ELY_NAMES_ABI = parseAbi(["function resolve(string name) view returns (address)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

interface Cached<T> {
  readonly at: number;
  readonly value: T;
}

const marketCache = new WeakMap<AppContext, Map<string, Cached<MarketFact[]> | Promise<MarketFact[]>>>();
const nameCache = new WeakMap<AppContext, Map<string, Cached<string | null>>>();

/** HyperCore markets of the environment, as reading facts. Empty on failure. */
export async function marketFacts(ctx: AppContext, environment: NetworkEnvironment): Promise<MarketFact[]> {
  let cache = marketCache.get(ctx);
  if (!cache) {
    cache = new Map();
    marketCache.set(ctx, cache);
  }
  const hit = cache.get(environment);
  const now = ctx.clock.now();
  if (hit && !(hit instanceof Promise) && now - hit.at < MARKET_FACTS_TTL_MS) return hit.value;
  if (hit instanceof Promise) return hit;
  const pending = loadMarkets(ctx, `hypercore-${environment}` as HyperCoreNetworkKey)
    .then((value) => {
      cache.set(environment, { at: ctx.clock.now(), value });
      return value;
    })
    .catch((error: unknown) => {
      ctx.log.warn("language market facts unavailable", { error });
      cache.delete(environment);
      return hit && !(hit instanceof Promise) ? hit.value : [];
    });
  cache.set(environment, pending);
  return pending;
}

async function loadMarkets(ctx: AppContext, network: HyperCoreNetworkKey): Promise<MarketFact[]> {
  const catalog = ledgerServices(ctx).catalog;
  const [perps, spot, bulk] = await Promise.all([
    catalog.perpRows(network, ""),
    catalog.spotRows(network).catch(() => []),
    catalog.bulkDexes(network).catch(() => ({ selected: [] as readonly string[], omitted: 0 })),
  ]);
  const hip3 = await Promise.all(bulk.selected.filter((dex) => dex !== "").slice(0, MAX_HIP3_DEXES).map((dex) => catalog.perpRows(network, dex, true).catch(() => [])));
  const out: MarketFact[] = [];
  for (const row of [...perps, ...hip3.flat()]) {
    if (row.isDelisted) continue;
    out.push({ coin: row.base, kind: "perp", ...(row.dex ? { dex: row.dex } : {}), ...(row.maxLeverage ? { maxLeverage: row.maxLeverage } : {}), ...(row.onlyIsolated ? { onlyIsolated: true } : {}) });
  }
  for (const row of spot) {
    if (row.quote !== "USDC" || out.some((fact) => fact.kind === "spot" && fact.coin === row.base)) continue;
    out.push({ coin: row.base, kind: "spot" });
  }
  return out;
}

/** Reference USD prices (HyperCore mainnet mids) for the symbols a sentence names. */
export async function referencePrices(ctx: AppContext, symbols: readonly string[]): Promise<Record<string, string>> {
  if (symbols.length === 0) return {};
  try {
    const table = (await ledgerServices(ctx).reference.table()).value;
    const out: Record<string, string> = {};
    for (const symbol of new Set(symbols.map((entry) => entry.toUpperCase()))) {
      const price = priceSymbol(table, symbol);
      if (price && price.usd > 0) out[symbol] = String(price.usd);
    }
    return out;
  } catch (error) {
    ctx.log.warn("language reference prices unavailable", { error });
    return {};
  }
}

/** `name.ely` -> address via ElyNames; null when unregistered; undefined when it could not be read. */
export async function resolveElyName(ctx: AppContext, environment: NetworkEnvironment, name: string): Promise<string | null | undefined> {
  const registry = ELY_NAMES[environment];
  if (!registry) return undefined;
  let cache = nameCache.get(ctx);
  if (!cache) {
    cache = new Map();
    nameCache.set(ctx, cache);
  }
  const key = `${environment}:${name}`;
  const hit = cache.get(key);
  if (hit && ctx.clock.now() - hit.at < NAME_TTL_MS) return hit.value;
  try {
    const label = name.replace(/\.ely$/u, "");
    const address = (await ctx.chains.client(`elysium-${environment}`).readContract({ address: registry, abi: ELY_NAMES_ABI, functionName: "resolve", args: [label] })) as string;
    const value = address.toLowerCase() === ZERO ? null : address;
    cache.set(key, { at: ctx.clock.now(), value });
    return value;
  } catch (error) {
    ctx.log.warn("ElyNames resolve failed", { error, name });
    return undefined;
  }
}
