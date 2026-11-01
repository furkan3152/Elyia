/**
 * The weighted raffle, verifiable by anyone:
 *
 * 1. Commit: the admin picks how many winners and a future Elysium block.
 *    The entrants (pending applications, weight = raffle weight) are frozen
 *    and published as entrantsHash = keccak256(abi.encode(address[], uint256[]))
 *    over the list sorted by address, weights in thousandths.
 * 2. Draw (once that block exists): seed = keccak256(abi.encode(blockHash,
 *    entrantsHash, raffleId)). For k = 0, 1, …: r = keccak256(abi.encode(seed, k))
 *    mod (sum of the remaining weights); the entrant whose cumulative weight
 *    range holds r wins and leaves the pool. Same inputs, same winners.
 */
import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";

export const RAFFLE_ALGORITHM =
  "entrantsHash = keccak256(abi.encode(address[] sorted, uint256[] weight×1000)); seed = keccak256(abi.encode(bytes32 blockHash, bytes32 entrantsHash, string raffleId)); for k = 0..: r = uint256(keccak256(abi.encode(seed, k))) % remainingWeight, walk the cumulative weights in address order, the hit wins and leaves the pool.";

export interface RaffleEntrant {
  readonly wallet: string;
  /** Raffle weight (1..5), stored as thousandths for the draw. */
  readonly weight: number;
}

export function milli(weight: number): bigint {
  return BigInt(Math.max(0, Math.round(weight * 1000)));
}

export function sortEntrants(entrants: readonly RaffleEntrant[]): RaffleEntrant[] {
  const seen = new Set<string>();
  return [...entrants]
    .map((entrant) => ({ wallet: entrant.wallet.toLowerCase(), weight: entrant.weight }))
    .filter((entrant) => milli(entrant.weight) > 0n && !seen.has(entrant.wallet) && Boolean(seen.add(entrant.wallet)))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
}

export function entrantsHash(entrants: readonly RaffleEntrant[]): Hex {
  const sorted = sortEntrants(entrants);
  return keccak256(encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }], [sorted.map((entrant) => entrant.wallet as Hex), sorted.map((entrant) => milli(entrant.weight))]));
}

export function raffleSeed(blockHash: Hex, hash: Hex, raffleId: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "string" }], [blockHash, hash, raffleId]));
}

/** Deterministic weighted draw without replacement. */
export function drawWinners(entrants: readonly RaffleEntrant[], seed: Hex, winners: number): string[] {
  const pool = sortEntrants(entrants).map((entrant) => ({ wallet: entrant.wallet, weight: milli(entrant.weight) }));
  const out: string[] = [];
  for (let k = 0; k < winners && pool.length > 0; k += 1) {
    const total = pool.reduce((sum, entrant) => sum + entrant.weight, 0n);
    if (total === 0n) break;
    const r = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [seed, BigInt(k)]))) % total;
    let cumulative = 0n;
    let index = 0;
    for (; index < pool.length; index += 1) {
      cumulative += pool[index]!.weight;
      if (r < cumulative) break;
    }
    out.push(pool[index]!.wallet);
    pool.splice(index, 1);
  }
  return out;
}

export function raffleIdOf(at: number, salt: string): string {
  return `rfl_${toHex(at).slice(2).padStart(12, "0")}${salt}`;
}
