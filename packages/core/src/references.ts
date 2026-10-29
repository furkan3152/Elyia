/**
 * Step references: what a client submits after signing, instead of anything
 * signed. The engine verifies each reference against the chain or the
 * HyperCore info API before storing it, and claims it globally so one piece
 * of evidence can complete one step only.
 *
 * - EVM transaction hash: `0x` + 64 hex (Elysium, HyperEVM);
 * - HyperCore order: `hc:cloid:<user>:<cloid>` (the cloid chosen at prepare);
 * - other HyperCore actions: `hc:nonce:<signer>:<nonce>` (signer = the
 *   wallet for user-signed actions, the agent for L1 actions).
 */
import { isEvmAddress, isEvmTransactionHash, type EvmAddress } from "./caip.js";
import { NETWORKS, type NetworkKey } from "./networks.js";
import { isCloid, type Cloid } from "./hypercore/wire.js";

export type ParsedReference =
  | { readonly kind: "evm-tx"; readonly hash: `0x${string}` }
  | { readonly kind: "hc-cloid"; readonly user: EvmAddress; readonly cloid: Cloid }
  | { readonly kind: "hc-nonce"; readonly signer: EvmAddress; readonly nonce: string };

/** HyperCore nonces are ms timestamps: positive integers that fit in a uint64. */
const NONCE = /^[1-9]\d{0,19}$/u;
const UINT64_MAX = (1n << 64n) - 1n;

export function formatEvmReference(hash: string): string {
  if (!isEvmTransactionHash(hash)) throw new Error(`${hash} is not a transaction hash.`);
  return hash.toLowerCase();
}

export function formatCloidReference(user: string, cloid: string): string {
  if (!isEvmAddress(user)) throw new Error(`${user} is not an address.`);
  if (!isCloid(cloid)) throw new Error(`${cloid} is not a cloid.`);
  return `hc:cloid:${user.toLowerCase()}:${cloid.toLowerCase()}`;
}

export function formatNonceReference(signer: string, nonce: number | string | bigint): string {
  if (!isEvmAddress(signer)) throw new Error(`${signer} is not an address.`);
  const text = String(nonce);
  if (!NONCE.test(text) || BigInt(text) > UINT64_MAX) throw new Error(`${text} is not a HyperCore nonce.`);
  return `hc:nonce:${signer.toLowerCase()}:${text}`;
}

/** Strict parse; null for anything malformed (mixed-case `hc:` prefixes included). */
export function parseReference(value: unknown): ParsedReference | null {
  if (typeof value !== "string") return null;
  if (isEvmTransactionHash(value)) return { kind: "evm-tx", hash: value.toLowerCase() as `0x${string}` };
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "hc") return null;
  const [, kind, who = "", what = ""] = parts;
  if (!isEvmAddress(who)) return null;
  if (kind === "cloid" && isCloid(what)) return { kind: "hc-cloid", user: who.toLowerCase() as EvmAddress, cloid: what.toLowerCase() as Cloid };
  if (kind === "nonce" && NONCE.test(what) && BigInt(what) <= UINT64_MAX) return { kind: "hc-nonce", signer: who.toLowerCase() as EvmAddress, nonce: what };
  return null;
}

/** True when the reference kind fits the network's VM (EVM hashes on EVM networks, `hc:` on HyperCore). */
export function referenceFitsNetwork(reference: ParsedReference, network: NetworkKey): boolean {
  return NETWORKS[network].vm === "evm" ? reference.kind === "evm-tx" : reference.kind !== "evm-tx";
}

/**
 * Global claim key: one reference completes one step, across every intent.
 * `eip155:99801:tx:0x…`, `hypercore:testnet:cloid:<user>:<cloid>`,
 * `hypercore:testnet:nonce:<signer>:<nonce>`.
 */
export function referenceClaimKey(network: NetworkKey, reference: ParsedReference): string {
  const caip2 = NETWORKS[network].caip2;
  switch (reference.kind) {
    case "evm-tx":
      return `${caip2}:tx:${reference.hash}`;
    case "hc-cloid":
      return `${caip2}:cloid:${reference.user}:${reference.cloid}`;
    case "hc-nonce":
      return `${caip2}:nonce:${reference.signer}:${reference.nonce}`;
  }
}
