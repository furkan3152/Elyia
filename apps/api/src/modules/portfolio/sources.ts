/**
 * PortfolioReader: fetches everything one balance sheet needs, each part
 * independently (a failing part becomes a status, never a failed request).
 *
 * Freshness (shared by GET /portfolio/:address and the stream):
 *   perp + spot clearinghouse state   every call (info client cache 2 s, weight 2 each)
 *   vault equities, staking summary   60 s       (weight 20 each)
 *   EVM balances per network          20 s       (one Multicall3 round trip)
 *   HIP-3 dexes the user touched      10 min     (ledger + fills scan, weight ~40-140)
 */
import { layersFor, tokensFor, type NetworkKey } from "@elyia/core";
import type { HyperCoreNetworkKey } from "@elyia/core/api/markets";
import type { PortfolioMode } from "@elyia/core/api/portfolio";
import type { DelegatorSummary, LedgerUpdate, UserFill, UserVaultEquity } from "@elyia/core/hypercore/info";
import type { BalanceToken, EvmChains } from "../../chains/evm.js";
import type { Clock } from "../../clock.js";
import { describeUpstream, isElyiaHttpError } from "../../http/errors.js";
import type { HyperliquidClients } from "../../hyperliquid/index.js";
import type { Logger } from "../../log.js";
import { RefreshingCacheMap } from "../markets/cache.js";
import { perpDexOf } from "../markets/catalog.js";
import type { LedgerServices } from "../markets/services.js";
import type { EvmRead, PerpDexRead, PortfolioSources, SourceResult } from "./valuation.js";

export const SLOW_PARTS_TTL_MS = 60_000;
export const EVM_TTL_MS = 20_000;
export const DEX_DISCOVERY_TTL_MS = 10 * 60_000;
/** HIP-3 dexes polled per address at most (weight 2 each per read). */
export const MAX_TOUCHED_DEXES = 6;
const CACHE_ENTRIES = 512;

export function hyperCoreNetworkFor(mode: PortfolioMode): HyperCoreNetworkKey {
  return mode === "mainnet" ? "hypercore-mainnet" : "hypercore-testnet";
}

/** HIP-3 dex names seen in a user's ledger (`send` between dexes) and fills (`dex:COIN`). */
export function touchedDexes(ledger: readonly LedgerUpdate[], fills: readonly UserFill[]): string[] {
  const seen = new Set<string>();
  for (const update of ledger) {
    const delta = update.delta as Record<string, unknown>;
    for (const key of ["sourceDex", "destinationDex"]) {
      const dex = delta[key];
      if (typeof dex === "string" && dex !== "" && dex !== "spot") seen.add(dex);
    }
  }
  for (const fill of fills) {
    const dex = perpDexOf(fill.coin);
    if (dex) seen.add(dex);
  }
  return [...seen].sort();
}

function failure<T>(error: unknown): SourceResult<T> {
  const message = isElyiaHttpError(error) ? error.message : "This part could not be read right now.";
  return { value: null, status: "error", message };
}

async function settle<T>(read: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    return { value: await read(), status: "ok", message: null };
  } catch (error) {
    return failure(error);
  }
}

export interface PortfolioReaderDeps {
  readonly hyperliquid: HyperliquidClients;
  readonly chains: EvmChains;
  readonly services: LedgerServices;
  readonly clock: Clock;
  readonly log?: Logger;
}

interface SlowParts {
  readonly vaults: SourceResult<readonly UserVaultEquity[]>;
  readonly staking: SourceResult<DelegatorSummary>;
}

export class PortfolioReader {
  private readonly slow: RefreshingCacheMap<SlowParts>;
  private readonly evm: RefreshingCacheMap<EvmRead>;
  private readonly dexes: RefreshingCacheMap<readonly string[]>;

  constructor(private readonly deps: PortfolioReaderDeps) {
    const clock = deps.clock;
    this.slow = new RefreshingCacheMap((key) => this.readSlow(key), { ttlMs: SLOW_PARTS_TTL_MS, maxStaleMs: SLOW_PARTS_TTL_MS * 5, clock, maxEntries: CACHE_ENTRIES });
    this.evm = new RefreshingCacheMap((key) => this.readEvm(key), { ttlMs: EVM_TTL_MS, maxStaleMs: EVM_TTL_MS * 6, clock, maxEntries: CACHE_ENTRIES });
    this.dexes = new RefreshingCacheMap((key) => this.discoverDexes(key), { ttlMs: DEX_DISCOVERY_TTL_MS, maxStaleMs: DEX_DISCOVERY_TTL_MS * 6, clock, errorBackoffMs: 60_000, maxEntries: CACHE_ENTRIES });
  }

  /** Everything for one snapshot. `address` must be a lower-case 0x address. */
  async read(address: string, mode: PortfolioMode): Promise<PortfolioSources> {
    const network = hyperCoreNetworkFor(mode);
    const info = this.deps.hyperliquid.info(network);
    const layers = layersFor(mode);
    const notes: string[] = [];

    const touched = await this.dexes
      .get(`${network}|${address}`)
      .then((cached) => cached.value)
      .catch(() => {
        notes.push("HIP-3 dexes could not be discovered right now; only the first perp dex is shown.");
        return [] as readonly string[];
      });
    const directory = touched.length > 0 ? await this.deps.services.catalog.directory(network).catch(() => null) : null;
    const known = touched.filter((dex) => directory?.indexByName.has(dex));
    if (known.length > MAX_TOUCHED_DEXES) notes.push(`Only ${MAX_TOUCHED_DEXES} of ${known.length} HIP-3 dexes are read.`);
    const dexList = ["", ...known.slice(0, MAX_TOUCHED_DEXES)];

    const [perps, spot, slow, evm, prices] = await Promise.all([
      Promise.all(
        dexList.map(async (dex): Promise<PerpDexRead> => {
          const state = await settle(() => info.clearinghouseState(address, dex || undefined));
          const meta = dex ? directory?.dexes.find((entry) => entry.name === dex) : undefined;
          // The first dex settles in USDC (token 0); a HIP-3 dex names its own collateral.
          const collateral = meta ? { name: meta.collateral ?? "USDC", index: meta.collateralToken ?? 0 } : { name: "USDC", index: 0 };
          return { dex, collateral, state };
        }),
      ),
      settle(() => info.spotClearinghouseState(address)),
      this.slow.get(`${network}|${address}`).then(
        (cached) => cached.value,
        (error: unknown): SlowParts => ({ vaults: failure(error), staking: failure(error) }),
      ),
      Promise.all(
        [
          { network: layers.hyperevm.key, layer: "hyperevm" as const },
          { network: layers.elysium.key, layer: "elysium" as const },
        ].map(({ network: key, layer }) => this.evm.get(`${key}|${layer}|${address}`).then((cached) => cached.value, (error: unknown) => this.evmFailure(key, layer, error))),
      ),
      this.deps.services.reference.table().then(
        (cached) => ({ table: cached.value, stale: cached.stale }),
        () => null,
      ),
    ]);

    const vaultNames = new Map<string, string>();
    const equities = slow.vaults.value ?? [];
    // Vault names come from the (large, cached) vault list: warm it in the background, never wait for it here.
    if (equities.length > 0 && equities.some((equity) => !this.deps.services.vaults.peek(mode, equity.vaultAddress))) {
      void this.deps.services.vaults.list(mode).catch(() => undefined);
    }
    for (const equity of equities) {
      const row = this.deps.services.vaults.peek(mode, equity.vaultAddress);
      if (row) vaultNames.set(row.address, row.name);
    }
    return { address, mode, now: this.deps.clock.now(), hypercoreNetwork: network, perps, spot, vaults: slow.vaults, staking: slow.staking, evm, prices, vaultNames, notes };
  }

  private async readSlow(key: string): Promise<SlowParts> {
    const [network, address] = key.split("|") as [HyperCoreNetworkKey, string];
    const info = this.deps.hyperliquid.info(network);
    const [vaults, staking] = await Promise.all([settle(() => info.userVaultEquities(address)), settle(() => info.delegatorSummary(address))]);
    return { vaults, staking };
  }

  private evmFailure(network: NetworkKey, layer: EvmRead["layer"], error: unknown): EvmRead {
    this.deps.log?.debug("portfolio evm read failed", { network, error: describeUpstream(error) });
    return { network, layer, status: "error", message: isElyiaHttpError(error) ? error.message : "Balances could not be read right now.", blockNumber: null, balances: [] };
  }

  private async readEvm(key: string): Promise<EvmRead> {
    const [network, layer, address] = key.split("|") as [NetworkKey, EvmRead["layer"], string];
    const tokens = tokensFor(network);
    const reason = this.deps.chains.isAvailable(network) ? null : this.deps.chains.unavailableReason(network);
    if (reason) return { network, layer, status: "unavailable", message: `${network} is not readable: ${reason}.`, blockNumber: null, balances: [] };
    const result = await this.deps.chains.getBalances(network, address, tokens.map((token): BalanceToken => token.address ?? "native"));
    const failed = result.balances.filter((balance) => balance.balance === null).length;
    return {
      network,
      layer,
      status: "ok",
      message: failed > 0 ? `${failed} of ${tokens.length} token balances could not be read.` : null,
      blockNumber: result.blockNumber,
      balances: tokens.map((token, index) => ({ token, units: result.balances[index]?.balance ?? null })),
    };
  }

  private async discoverDexes(key: string): Promise<readonly string[]> {
    const [network, address] = key.split("|") as [HyperCoreNetworkKey, string];
    const info = this.deps.hyperliquid.info(network);
    const [ledger, fills] = await Promise.all([info.userNonFundingLedgerUpdates(address, 0), info.userFills(address, true)]);
    return touchedDexes(ledger, fills);
  }
}
