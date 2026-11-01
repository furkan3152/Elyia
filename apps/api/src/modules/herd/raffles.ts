/** Raffle records: commit (entrants frozen, future block), draw (block hash seed), apply (approve winners). */
import type { NetworkKey } from "@elyia/core";
import type { HerdRaffle } from "@elyia/core/api/herd";
import type { Hex } from "viem";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { randomHex } from "../ops/auth/crypto.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { allApplications, decide } from "./applications.js";
import { drawWinners, entrantsHash, RAFFLE_ALGORITHM, raffleIdOf, raffleSeed, sortEntrants, type RaffleEntrant } from "./raffle.js";
import { audit } from "./state.js";

interface RaffleDoc extends HerdRaffle {
  readonly pool: readonly RaffleEntrant[];
}

const raffles = (ctx: AppContext) => docs<RaffleDoc>(ctx, PLATFORM_COLLECTIONS.herdRaffles);

export function raffleView(doc: RaffleDoc): HerdRaffle {
  const { pool: _pool, ...rest } = doc;
  return rest;
}

/** Minimum distance to the target block: the hash must not be known at commit. */
export const MIN_BLOCKS_AHEAD = 20;

export async function commitRaffle(ctx: AppContext, by: string, network: NetworkKey, input: { readonly winners: number; readonly targetBlock?: number; readonly blocksAhead?: number }): Promise<HerdRaffle> {
  if (!ctx.chains.isAvailable(network)) throw new ElyiaHttpError("NETWORK_UNAVAILABLE", 503, `${network} has no RPC configured.`);
  const head = Number(await ctx.chains.client(network).getBlockNumber());
  const target = input.targetBlock ?? head + (input.blocksAhead ?? 3_000);
  if (target < head + MIN_BLOCKS_AHEAD) throw new ElyiaHttpError("INVALID_REQUEST", 400, `Pick a block at least ${MIN_BLOCKS_AHEAD} blocks ahead (head is ${head}).`);
  const pool = sortEntrants((await allApplications(ctx)).filter((doc) => doc.status === "pending").map((doc) => ({ wallet: doc.wallet, weight: doc.score.weight })));
  if (pool.length === 0) throw new ElyiaHttpError("NO_ENTRANTS", 409, "No pending application has a raffle weight above 0.");
  const now = ctx.clock.now();
  const id = raffleIdOf(now, randomHex(4));
  const doc: RaffleDoc = {
    id,
    network,
    status: "committed",
    winners: Math.min(input.winners, pool.length),
    targetBlock: target,
    committedAtBlock: head,
    entrants: pool.length,
    totalWeight: Math.round(pool.reduce((sum, entrant) => sum + entrant.weight, 0) * 1000) / 1000,
    entrantsHash: entrantsHash(pool),
    blockHash: null,
    seed: null,
    drawn: [],
    algorithm: RAFFLE_ALGORITHM,
    createdAt: new Date(now).toISOString(),
    createdBy: by,
    drawnAt: null,
    pool,
  };
  await raffles(ctx).put(id, doc);
  await audit(ctx, by, "raffle.commit", `${id}: ${doc.winners} winner(s) from ${pool.length} entrants, block ${target} (head ${head}), entrants ${doc.entrantsHash}`);
  return raffleView(doc);
}

export async function drawRaffle(ctx: AppContext, by: string, id: string): Promise<HerdRaffle> {
  const doc = (await raffles(ctx).get(id))?.value;
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such raffle.");
  if (doc.status !== "committed") return raffleView(doc);
  const block = await ctx.chains.client(doc.network).getBlock({ blockNumber: BigInt(doc.targetBlock) }).catch(() => null);
  if (!block?.hash) throw new ElyiaHttpError("TOO_EARLY", 409, `Block ${doc.targetBlock} is not there yet. Draw once it is.`);
  const seed = raffleSeed(block.hash, doc.entrantsHash as Hex, doc.id);
  const drawn = drawWinners(doc.pool, seed, doc.winners);
  const next: RaffleDoc = { ...doc, status: "drawn", blockHash: block.hash, seed, drawn, drawnAt: new Date(ctx.clock.now()).toISOString() };
  await raffles(ctx).put(id, next);
  await audit(ctx, by, "raffle.draw", `${id}: block ${doc.targetBlock} hash ${block.hash}, seed ${seed}, ${drawn.length} winner(s)`);
  return raffleView(next);
}

export async function applyRaffle(ctx: AppContext, by: string, id: string): Promise<{ raffle: HerdRaffle; approved: number }> {
  const doc = (await raffles(ctx).get(id))?.value;
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such raffle.");
  if (doc.status !== "drawn") throw new ElyiaHttpError("NOT_DRAWN", 409, doc.status === "applied" ? "Already applied." : "Draw it first.");
  const { updated } = await decide(ctx, by, doc.drawn, "approved", `Raffle ${doc.id} winner`);
  const next: RaffleDoc = { ...doc, status: "applied" };
  await raffles(ctx).put(id, next);
  await audit(ctx, by, "raffle.apply", `${id}: ${updated} winner(s) approved`);
  return { raffle: raffleView(next), approved: updated };
}

export async function listRaffles(ctx: AppContext): Promise<HerdRaffle[]> {
  return (await raffles(ctx).list({ limit: 200 })).map((row) => raffleView(row.value)).reverse();
}

export async function raffleOf(ctx: AppContext, id: string): Promise<(HerdRaffle & { readonly pool: readonly RaffleEntrant[] }) | null> {
  return (await raffles(ctx).get(id))?.value ?? null;
}
