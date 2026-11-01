/**
 * Live reads of the recorded ElyHerd (the admin deployment registry says
 * where it is). No record: "not deployed", with the spec's defaults labelled
 * as such. Every read is an eth_call; nothing is signed or sent.
 */
import { NETWORKS, getEvmNetwork, type NetworkKey } from "@elyia/core";
import type { DeploymentRecord } from "@elyia/core/api/admin";
import { HERD_DEFAULT_ALLOCATIONS, HERD_MAX_SUPPLY, HERD_PHASES, type HerdAllocations, type HerdConfigResponse, type HerdLinks, type HerdPhase, type HerdPhaseWindow, type HerdQuote } from "@elyia/core/api/herd";
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor } from "../../config.js";
import { listDeployments } from "../admin/deployments.js";
import { abiFunction, herdAbi, HERD_CONTRACT } from "./abi.js";

export function herdNetwork(ctx: AppContext): NetworkKey {
  return elysiumNetworkFor(ctx.config.mode);
}

export function herdLinks(ctx: AppContext): HerdLinks {
  const herd = ctx.config.herd;
  return { xProfile: herd.xProfileUrl, engagementPosts: herd.engagementPostUrls, marketplace: herd.marketplaceUrl, treasury: herd.treasury, mainnetLaunch: herd.mainnetLaunch, xApi: herd.xApiBearer !== null };
}

const recordCache = new WeakMap<AppContext, Map<string, { at: number; value: DeploymentRecord | null }>>();
const RECORD_TTL_MS = 5_000;

/** The recorded ElyHerd on `network`, or null (cached 5 s). */
export async function herdRecord(ctx: AppContext, network: NetworkKey): Promise<DeploymentRecord | null> {
  let map = recordCache.get(ctx);
  if (!map) {
    map = new Map();
    recordCache.set(ctx, map);
  }
  const hit = map.get(network);
  const now = ctx.clock.now();
  if (hit && now - hit.at < RECORD_TTL_MS) return hit.value;
  const value = (await listDeployments(ctx, network)).find((record) => record.contract === HERD_CONTRACT) ?? null;
  map.set(network, { at: now, value });
  return value;
}

/** Drops the cached collection reads (owner actions read fresh state). */
export function forgetHerdView(ctx: AppContext): void {
  viewCache.delete(ctx);
}

/** Drops cached records and reads (after a deployment is recorded, tests). */
export function forgetHerdCaches(ctx: AppContext): void {
  recordCache.delete(ctx);
  viewCache.delete(ctx);
}

export async function readHerd(ctx: AppContext, network: NetworkKey, address: string, functionName: string, args: readonly unknown[] = [], abiOverride?: Abi): Promise<unknown> {
  const abi = abiOverride ?? (await herdAbi()).abi;
  const fn = abiFunction(abi, functionName, args.length);
  if (!fn) throw new Error(`${functionName} is not in the ElyHerd ABI.`);
  // A raw eth_call (not readContract): multicall batching would need Multicall3 on every chain (a local node has none).
  const data = encodeFunctionData({ abi: [fn], functionName, args: args as never });
  const request = ctx.chains.client(network).request as unknown as (args: { method: string; params: readonly unknown[] }) => Promise<Hex>;
  const raw = await request({ method: "eth_call", params: [{ to: address as Address, data }, "latest"] });
  return decodeFunctionResult({ abi: [fn], functionName, data: raw });
}

async function tryRead(ctx: AppContext, network: NetworkKey, address: string, functionName: string, args: readonly unknown[] = []): Promise<unknown> {
  try {
    return await readHerd(ctx, network, address, functionName, args);
  } catch {
    return undefined;
  }
}

/** A tuple field by name or position (viem returns arrays for unnamed and multi outputs). */
export function field(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") return (value as Record<string, unknown>)[name];
  return undefined;
}

function num(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return null;
}

function dec(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number" ? value.toString() : "0";
}

export function phaseName(value: unknown): HerdPhase | null {
  const index = num(value);
  return index !== null && index >= 0 && index < HERD_PHASES.length ? HERD_PHASES[index]! : null;
}

export function phaseIndex(phase: HerdPhase): number {
  return HERD_PHASES.indexOf(phase);
}

function iso(seconds: unknown): string | null {
  const value = num(seconds);
  return value && value > 0 ? new Date(value * 1000).toISOString() : null;
}

export function allocationsOf(value: unknown): HerdAllocations | null {
  if (value === undefined || value === null) return null;
  const pick = (name: string, alt: string, index: number) => num(field(value, name, index) ?? field(value, alt, index)) ?? 0;
  return {
    team: pick("team", "teamAlloc", 0),
    wl: pick("wl", "wlAlloc", 1),
    collab: pick("collab", "collabAlloc", 2),
    public: pick("pub", "publicSupply", 3),
    teamMinted: pick("teamMinted", "teamMinted", 4),
    wlMinted: pick("wlMinted", "wlMinted", 5),
    collabMinted: pick("collabMinted_", "collabMinted", 6),
    publicMinted: pick("pubMinted", "publicMinted", 7),
    burned: pick("burned", "burned", 8),
  };
}

function hex32(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value) ? value.toLowerCase() : null;
}

const ZERO32 = `0x${"0".repeat(64)}`;

const viewCache = new WeakMap<AppContext, Map<string, { at: number; value: HerdConfigResponse }>>();
const VIEW_TTL_MS = 3_000;

function base(ctx: AppContext, network: NetworkKey, deployments: HerdConfigResponse["deployments"]): Omit<HerdConfigResponse, "source" | "address" | "note"> {
  const evm = getEvmNetwork(network);
  return {
    network,
    chainId: evm.chainId,
    testnet: NETWORKS[network].environment === "testnet",
    name: "The Herd",
    symbol: "HERD",
    maxSupply: HERD_MAX_SUPPLY,
    totalSupply: null,
    remaining: null,
    soldOut: false,
    phase: null,
    paused: null,
    allocations: null,
    defaults: HERD_DEFAULT_ALLOCATIONS,
    timeline: [],
    quotes: [],
    merkleRoots: { wl: null, collab: null },
    reveal: { revealed: null, provenanceHash: null, frozen: null },
    admin: null,
    open: { wl: null, public: null },
    royalty: { receiver: null, bps: null },
    perWallet: 1,
    deployments,
    links: herdLinks(ctx),
    generatedAt: new Date(ctx.clock.now()).toISOString(),
  };
}

/** GET /v1/herd: the collection, live from chain when recorded. */
export async function collectionView(ctx: AppContext, network: NetworkKey): Promise<HerdConfigResponse> {
  let map = viewCache.get(ctx);
  if (!map) {
    map = new Map();
    viewCache.set(ctx, map);
  }
  const hit = map.get(network);
  if (hit && ctx.clock.now() - hit.at < VIEW_TTL_MS) return hit.value;
  const all = (await listDeployments(ctx)).filter((record) => record.contract === HERD_CONTRACT).map((record) => ({ network: record.network, address: record.address }));
  const record = await herdRecord(ctx, network);
  let value: HerdConfigResponse;
  if (!record) {
    value = { ...base(ctx, network, all), source: "not-deployed", address: null, note: `ElyHerd is not deployed on ${NETWORKS[network].name} yet. Supply and allocations shown are the planned defaults.` };
  } else if (!ctx.chains.isAvailable(network)) {
    value = { ...base(ctx, network, all), source: "chain-error", address: record.address, note: `${NETWORKS[network].name} has no RPC configured.` };
  } else {
    value = await liveView(ctx, network, record.address, all);
  }
  map.set(network, { at: ctx.clock.now(), value });
  return value;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function addr(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value) && !/^0x0{40}$/u.test(value) ? value.toLowerCase() : null;
}

const PRICE_SOURCES = ["fixed", "twap", "fallback"] as const;

async function liveView(ctx: AppContext, network: NetworkKey, address: string, all: HerdConfigResponse["deployments"]): Promise<HerdConfigResponse> {
  const read = (fn: string, args: readonly unknown[] = []) => tryRead(ctx, network, address, fn, args);
  const [name, symbol, max, total, phase, paused, allocations, roots, provenance, revealed, frozen, royalty] = await Promise.all([
    read("name"),
    read("symbol"),
    read("MAX_SUPPLY"),
    read("totalSupply"),
    read("phase"),
    read("paused"),
    read("allocations"),
    read("merkleRoots"),
    read("provenanceHash"),
    read("revealed"),
    read("metadataFrozen"),
    read("royaltyInfo", [1n, 10_000n]),
  ]);
  const [owner, pendingOwner, treasury, eoaOnly, maxMintable, placeholderURI, baseURI, contractURI, commitBlock, offset, delay, oracle, fallback, openWl, openPublic] = await Promise.all([
    read("owner"),
    read("pendingOwner"),
    read("treasury"),
    read("eoaOnly"),
    read("maxMintable"),
    read("placeholderURI"),
    read("baseURI"),
    read("contractURI"),
    read("revealCommitBlock"),
    read("revealOffset"),
    read("REVEAL_DELAY_BLOCKS"),
    read("oracle"),
    read("fallbackPrice"),
    read("isOpen", [phaseIndex("wl")]),
    read("isOpen", [phaseIndex("public")]),
  ]);
  const windows: HerdPhaseWindow[] = [];
  const quotes: HerdQuote[] = [];
  for (const phaseKey of ["wl", "public"] as const) {
    const index = phaseIndex(phaseKey);
    const [config, withSource, plain] = await Promise.all([read("phaseConfig", [index]), read("quoteWithSource", [index]), read("quote", [index])]);
    if (config !== undefined) {
      const mode = num(field(config, "priceMode", 2));
      windows.push({ phase: phaseKey, start: iso(field(config, "start", 0)), end: iso(field(config, "end", 1)), priceMode: mode === 1 ? "usd" : "fixed", priceWei: dec(field(config, "priceWei", 3)), priceUsd6: dec(field(config, "priceUsd6", 4)) });
    }
    const usd = windows.find((window) => window.phase === phaseKey)?.priceMode === "usd";
    const wei = field(withSource, "priceWei", 0) ?? plain;
    const source = PRICE_SOURCES[num(field(withSource, "source", 1)) ?? (usd ? 1 : 0)] ?? "fixed";
    quotes.push(
      typeof wei === "bigint"
        ? { phase: phaseKey, wei: wei.toString(), source, note: source === "fallback" ? "Priced from the admin's fallback HYPE/USD price (the TWAP is not usable right now)." : null }
        : { phase: phaseKey, wei: null, source: "unavailable", note: usd ? "The price oracle is unavailable: the mint fails closed until the TWAP recovers or the admin sets a fresh fallback price." : "The contract did not return a quote." },
    );
  }
  const maxSupply = num(max) ?? HERD_MAX_SUPPLY;
  const totalSupply = num(total);
  const reachable = totalSupply !== null;
  const rootWl = hex32(field(roots, "wl", 0));
  const rootCollab = hex32(field(roots, "collab", 1));
  const royaltyAmount = num(field(royalty, "amount", 1));
  const mintable = num(maxMintable);
  const fallbackUsd = field(fallback, "usdPerHype6", 0);
  const fallbackAt = num(field(fallback, "updatedAt", 1));
  const fallbackStaleness = num(field(fallback, "maxStaleness", 2)) ?? 0;
  const balance = ctx.chains.isAvailable(network) ? await ctx.chains.client(network).getBalance({ address: address as Address }).then((value) => value.toString(), () => null) : null;
  return {
    ...base(ctx, network, all),
    source: reachable ? "chain" : "chain-error",
    address,
    note: reachable ? null : "The contract did not answer; counters are unknown right now.",
    name: typeof name === "string" ? name : "The Herd",
    symbol: typeof symbol === "string" ? symbol : "HERD",
    maxSupply,
    totalSupply,
    remaining: totalSupply === null ? null : Math.max(0, (mintable ?? maxSupply) - totalSupply),
    soldOut: totalSupply !== null && totalSupply >= (mintable ?? maxSupply),
    phase: phaseName(phase),
    paused: typeof paused === "boolean" ? paused : null,
    allocations: allocationsOf(allocations),
    timeline: windows,
    quotes,
    merkleRoots: { wl: rootWl === ZERO32 ? null : rootWl, collab: rootCollab === ZERO32 ? null : rootCollab },
    reveal: { revealed: typeof revealed === "boolean" ? revealed : null, provenanceHash: hex32(provenance) === ZERO32 ? null : hex32(provenance), frozen: typeof frozen === "boolean" ? frozen : null },
    admin: {
      owner: addr(owner),
      pendingOwner: addr(pendingOwner),
      treasury: addr(treasury),
      eoaOnly: typeof eoaOnly === "boolean" ? eoaOnly : null,
      maxMintable: mintable,
      placeholderURI: str(placeholderURI),
      baseURI: str(baseURI),
      contractURI: str(contractURI),
      revealCommitBlock: num(commitBlock) || null,
      revealOffset: revealed === true ? num(offset) : null,
      revealDelayBlocks: num(delay),
      oracle:
        oracle === undefined && fallback === undefined
          ? null
          : {
              pool: addr(field(oracle, "pool", 0)),
              twapSeconds: num(field(oracle, "twapSeconds", 1)) ?? 0,
              maxDeviationBps: num(field(oracle, "maxDeviationBps", 2)) ?? 0,
              fallbackUsdPerHype6: dec(fallbackUsd),
              fallbackUpdatedAt: fallbackAt ? new Date(fallbackAt * 1000).toISOString() : null,
              fallbackMaxStaleness: fallbackStaleness,
              fallbackStale: fallbackAt ? ctx.clock.now() / 1000 > fallbackAt + fallbackStaleness : true,
            },
      balanceWei: balance,
    },
    open: { wl: typeof openWl === "boolean" ? openWl : null, public: typeof openPublic === "boolean" ? openPublic : null },
    royalty: { receiver: addr(field(royalty, "receiver", 0)), bps: royaltyAmount },
  };
}

/** On-chain balance (perks, holder checks). Throws when unreadable. */
export async function balanceOf(ctx: AppContext, network: NetworkKey, contract: string, owner: string): Promise<number> {
  const value = await readHerd(ctx, network, contract, "balanceOf", [owner]);
  const count = num(value);
  if (count === null) throw new Error("balanceOf returned no number");
  return count;
}

/** mintedBy(address) as a boolean (bool or count ABIs), null when unreadable. */
export async function mintedBy(ctx: AppContext, network: NetworkKey, contract: string, owner: string): Promise<boolean | null> {
  const value = await tryRead(ctx, network, contract, "mintedBy", [owner]);
  if (typeof value === "boolean") return value;
  const count = num(value);
  return count === null ? null : count > 0;
}

export async function onChainRoots(ctx: AppContext, network: NetworkKey): Promise<{ readonly wl: string | null; readonly collab: string | null }> {
  const view = await collectionView(ctx, network);
  return view.merkleRoots;
}
