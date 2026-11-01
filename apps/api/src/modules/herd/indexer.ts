/**
 * The mint indexer: follows the recorded ElyHerd's `Minted` and `Transfer`
 * logs (eth_getLogs in adaptive block chunks) into `herd_tokens`, one doc
 * per token: minter, current owner, phase, price paid, block, tx. Powers the
 * mint dashboard, holder token ids and the testnet → mainnet snapshot.
 * Perks never read it: they use balanceOf on chain.
 */
import { HERD_PHASES, type HerdDashboardResponse, type HerdMintEvent, type HerdPhase } from "@elyia/core/api/herd";
import type { NetworkKey } from "@elyia/core";
import { parseAbiItem, type AbiEvent, type Address, type Log } from "viem";
import type { AppContext } from "../../context.js";
import { registerStats } from "../admin/stats.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { herdAbi } from "./abi.js";
import { herdNetwork, herdRecord, phaseName } from "./chain.js";

export interface TokenDoc {
  readonly tokenId: number;
  readonly minter: string | null;
  readonly owner: string;
  readonly phase: HerdPhase | null;
  /** "team" (TeamMinted), "collab" (CollabMinted), else null (the phase says it). */
  readonly bucket?: "team" | "collab" | null;
  readonly partnerTag?: string | null;
  readonly priceWei: string;
  readonly block: number;
  readonly txHash: string;
}

interface IndexState {
  readonly address: string;
  readonly next: number;
  readonly head: number | null;
  readonly updatedAt: number;
  readonly lastError: string | null;
  readonly chunk: number;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_CHUNK = 50_000;
const MIN_CHUNK = 200;
const CHUNKS_PER_TICK = 20;
const POLL_MS = 12_000;

const MINTED_SPEC = parseAbiItem("event Minted(address indexed to, uint256 indexed id, uint8 indexed phase, uint256 pricePaid)");
const TEAM_MINTED = parseAbiItem("event TeamMinted(address indexed to, uint256 firstId, uint256 qty)");
const COLLAB_MINTED = parseAbiItem("event CollabMinted(address indexed to, uint256 indexed id, bytes32 indexed partnerTag)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

function tokenKey(network: NetworkKey, id: number): string {
  return `${network}:${String(id).padStart(6, "0")}`;
}

async function indexedEvents(): Promise<AbiEvent[]> {
  const { abi } = await herdAbi();
  const find = (name: string, fallback: AbiEvent) => ((abi as readonly { type: string; name?: string }[]).find((entry) => entry.type === "event" && entry.name === name) as AbiEvent | undefined) ?? fallback;
  return [find("Minted", MINTED_SPEC), find("TeamMinted", TEAM_MINTED), find("CollabMinted", COLLAB_MINTED), TRANSFER];
}

function arg(log: Log, name: string, index: number): unknown {
  const args = (log as unknown as { args?: Record<string, unknown> | unknown[] }).args;
  if (Array.isArray(args)) return args[index];
  return args?.[name];
}

/** Applies decoded logs to token docs (pure on the store; exported for tests). */
export async function applyLogs(ctx: AppContext, network: NetworkKey, logs: readonly Log[]): Promise<number> {
  const tokens = docs<TokenDoc>(ctx, PLATFORM_COLLECTIONS.herdTokens);
  let applied = 0;
  for (const log of logs) {
    const name = (log as unknown as { eventName?: string }).eventName;
    const block = Number(log.blockNumber ?? 0);
    const txHash = String(log.transactionHash ?? "");
    if (name === "Minted") {
      const id = Number(arg(log, "id", 1) ?? arg(log, "tokenId", 1));
      const to = String(arg(log, "to", 0)).toLowerCase();
      const phase = phaseName(arg(log, "phase", 2));
      const price = arg(log, "pricePaid", 3) ?? arg(log, "price", 3);
      if (!Number.isFinite(id)) continue;
      const current = (await tokens.get(tokenKey(network, id)))?.value;
      await tokens.put(tokenKey(network, id), { tokenId: id, minter: to, owner: current?.owner ?? to, phase, bucket: current?.bucket ?? null, partnerTag: current?.partnerTag ?? null, priceWei: typeof price === "bigint" ? price.toString() : "0", block, txHash });
      applied += 1;
    } else if (name === "TeamMinted" || name === "CollabMinted") {
      const ids = name === "TeamMinted" ? Array.from({ length: Math.min(500, Number(arg(log, "qty", 2) ?? 0)) }, (_, index) => Number(arg(log, "firstId", 1)) + index) : [Number(arg(log, "id", 1))];
      for (const id of ids) {
        if (!Number.isFinite(id)) continue;
        const current = (await tokens.get(tokenKey(network, id)))?.value;
        const to = String(arg(log, "to", 0)).toLowerCase();
        await tokens.put(tokenKey(network, id), { tokenId: id, minter: current?.minter ?? to, owner: current?.owner ?? to, phase: current?.phase ?? null, bucket: name === "TeamMinted" ? "team" : "collab", partnerTag: name === "CollabMinted" ? String(arg(log, "partnerTag", 2)) : null, priceWei: current?.priceWei ?? "0", block: current?.block ?? block, txHash: current?.txHash ?? txHash });
      }
      applied += 1;
    } else if (name === "Transfer") {
      const id = Number(arg(log, "tokenId", 2));
      const from = String(arg(log, "from", 0)).toLowerCase();
      const to = String(arg(log, "to", 1)).toLowerCase();
      if (!Number.isFinite(id)) continue;
      const current = (await tokens.get(tokenKey(network, id)))?.value;
      if (to === ZERO) {
        await tokens.delete(tokenKey(network, id));
      } else {
        await tokens.put(tokenKey(network, id), {
          tokenId: id,
          minter: current?.minter ?? (from === ZERO ? to : null),
          owner: to,
          phase: current?.phase ?? null,
          bucket: current?.bucket ?? null,
          partnerTag: current?.partnerTag ?? null,
          priceWei: current?.priceWei ?? "0",
          block: current?.block ?? block,
          txHash: current?.txHash ?? txHash,
        });
      }
      applied += 1;
    }
  }
  return applied;
}

/** One indexing pass (up to CHUNKS_PER_TICK chunks). Returns the state, or null when nothing is recorded. */
export async function indexOnce(ctx: AppContext, network: NetworkKey = herdNetwork(ctx)): Promise<IndexState | null> {
  const record = await herdRecord(ctx, network);
  if (!record || !ctx.chains.isAvailable(network)) return null;
  const states = docs<IndexState>(ctx, PLATFORM_COLLECTIONS.herdIndex);
  let state = (await states.get(network))?.value ?? null;
  if (!state || state.address !== record.address) {
    // A new deployment: forget the old one's tokens.
    for (const row of await docs<TokenDoc>(ctx, PLATFORM_COLLECTIONS.herdTokens).list({ prefix: `${network}:`, limit: 1_000 })) await docs(ctx, PLATFORM_COLLECTIONS.herdTokens).delete(row.id);
    state = { address: record.address, next: Number(record.blockNumber), head: null, updatedAt: ctx.clock.now(), lastError: null, chunk: 10_000 };
  }
  const client = ctx.chains.client(network);
  const events = await indexedEvents();
  let { next, chunk } = state;
  let head: number | null = state.head;
  let lastError: string | null = null;
  try {
    head = Number(await client.getBlockNumber());
    for (let pass = 0; pass < CHUNKS_PER_TICK && next <= head; pass += 1) {
      const to = Math.min(head, next + chunk - 1);
      try {
        const logs = await client.getLogs({ address: record.address as Address, events, fromBlock: BigInt(next), toBlock: BigInt(to) });
        const sorted = [...logs].sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
        await applyLogs(ctx, network, sorted);
        next = to + 1;
        chunk = Math.min(MAX_CHUNK, chunk * 2);
      } catch (error) {
        if (chunk <= MIN_CHUNK) throw error;
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 4));
      }
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 160) : String(error);
  }
  const saved: IndexState = { address: record.address, next, head, updatedAt: ctx.clock.now(), lastError, chunk };
  await states.put(network, saved);
  return saved;
}

export async function indexState(ctx: AppContext, network: NetworkKey): Promise<IndexState | null> {
  return (await docs<IndexState>(ctx, PLATFORM_COLLECTIONS.herdIndex).get(network))?.value ?? null;
}

export async function allTokens(ctx: AppContext, network: NetworkKey): Promise<TokenDoc[]> {
  const out: TokenDoc[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await docs<TokenDoc>(ctx, PLATFORM_COLLECTIONS.herdTokens).list({ prefix: `${network}:`, limit: 1_000, ...(after ? { after } : {}) });
    out.push(...page.map((row) => row.value));
    if (page.length < 1_000) break;
    after = page[page.length - 1]!.id;
  }
  return out;
}

export async function tokensOf(ctx: AppContext, network: NetworkKey, owner: string): Promise<number[]> {
  const who = owner.toLowerCase();
  return (await allTokens(ctx, network)).filter((token) => token.owner === who).map((token) => token.tokenId).sort((a, b) => a - b);
}

export function dashboardOf(tokens: readonly TokenDoc[]): Pick<HerdDashboardResponse, "minted" | "byPhase" | "revenueWei" | "holders" | "recent" | "topHolders"> {
  const byPhase: Record<string, number> = Object.fromEntries([...HERD_PHASES.filter((phase) => phase === "wl" || phase === "public"), "collab", "team"].map((phase) => [phase, 0]));
  let revenue = 0n;
  const holders = new Map<string, number>();
  for (const token of tokens) {
    const key = token.bucket ?? token.phase ?? "unknown";
    byPhase[key] = (byPhase[key] ?? 0) + 1;
    revenue += BigInt(token.priceWei || "0");
    holders.set(token.owner, (holders.get(token.owner) ?? 0) + 1);
  }
  const recent: HerdMintEvent[] = [...tokens]
    .sort((a, b) => b.block - a.block || b.tokenId - a.tokenId)
    .slice(0, 25)
    .map((token) => ({ tokenId: token.tokenId, to: token.minter ?? token.owner, phase: token.phase, priceWei: token.priceWei, block: token.block, txHash: token.txHash }));
  const topHolders = [...holders.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([address, count]) => ({ address, count }));
  return { minted: tokens.length, byPhase, revenueWei: revenue.toString(), holders: holders.size, recent, topHolders };
}

/* ---------------------------------------------------------- the poller */

const timers = new WeakMap<AppContext, ReturnType<typeof setInterval>>();
const stats = new WeakMap<AppContext, { lastRunAt: number | null; lastError: string | null; running: boolean }>();

export function startIndexer(ctx: AppContext): void {
  if (timers.has(ctx)) return;
  const stat = { lastRunAt: null as number | null, lastError: null as string | null, running: false };
  stats.set(ctx, stat);
  const tick = async () => {
    if (stat.running) return;
    stat.running = true;
    try {
      const state = await indexOnce(ctx);
      stat.lastRunAt = ctx.clock.now();
      stat.lastError = state?.lastError ?? null;
    } catch (error) {
      stat.lastError = error instanceof Error ? error.message.slice(0, 160) : String(error);
    } finally {
      stat.running = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
  timers.set(ctx, timer);
  void tick();
  registerStats(ctx, "herdIndexer", async () => {
    const state = await indexState(ctx, herdNetwork(ctx));
    return { running: true, lastRunAt: stat.lastRunAt, lastError: stat.lastError, pending: state?.head !== null && state?.head !== undefined ? Math.max(0, state.head - state.next + 1) : 0, note: state ? `next block ${state.next}` : "no ElyHerd recorded" };
  });
}

export function stopIndexer(ctx: AppContext): void {
  const timer = timers.get(ctx);
  if (timer) clearInterval(timer);
  timers.delete(ctx);
}
