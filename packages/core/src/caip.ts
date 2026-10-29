/**
 * CAIP-2 / CAIP-10 / CAIP-19 identities for the `eip155` (Elysium, HyperEVM)
 * and `hypercore` namespaces, plus EVM address checks. Elyia never compares
 * raw address strings across networks: values cross every boundary as
 * namespaced ids, and comparisons go through these helpers.
 *
 * One rule differs from a plain CAIP reading on purpose: the same 0x address
 * on Elysium, HyperEVM and HyperCore is one owner (one secp256k1 key), so
 * `sameOwner` treats `eip155:*` and `hypercore:*` as one key family.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  NETWORKS,
  networkByCaip2,
  type HyperCoreNetwork,
  type Network,
  type NetworkEnvironment,
  type NetworkKey,
} from "./networks.js";

export type ChainNamespace = "eip155" | "hypercore";
export type CaipChainId = `eip155:${number}` | `hypercore:${NetworkEnvironment}`;
export type AccountId = `${CaipChainId}:${string}`;
export type AssetId = `${CaipChainId}/${string}:${string}`;
export type EvmAddress = `0x${string}`;

/* ------------------------------------------------------------ EVM address */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/u;

export function isEvmAddress(value: unknown): value is EvmAddress {
  return typeof value === "string" && EVM_ADDRESS.test(value);
}

export function isEvmTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && EVM_HASH.test(value);
}

/** Keccak-256 (Ethereum's hash, not SHA3-256) of bytes or a UTF-8 string, as 0x hex. */
export function keccak256Hex(input: Uint8Array | string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(typeof input === "string" ? utf8ToBytes(input) : input))}`;
}

/** EIP-55 checksum form of a 0x address. Throws on a malformed address. */
export function toChecksumAddress(address: string): EvmAddress {
  if (!isEvmAddress(address)) throw new Error(`Invalid EVM address: ${address}`);
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256Hex(lower).slice(2);
  let out = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const char = lower[index] as string;
    out += Number.parseInt(hash[index] as string, 16) >= 8 ? char.toUpperCase() : char;
  }
  return out as EvmAddress;
}

/**
 * EIP-55 state: `valid` when the mixed case matches the checksum, `uncased`
 * when all lower- or upper-case (nothing to check), `invalid` for a malformed
 * address or a mixed case that does not match (usually one mistyped character).
 */
export function evmChecksumState(address: string): "valid" | "uncased" | "invalid" {
  if (!isEvmAddress(address)) return "invalid";
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return "uncased";
  return toChecksumAddress(address) === address ? "valid" : "invalid";
}

/** False only for a malformed address or a mixed case whose checksum is wrong. */
export function isChecksumAddressValid(address: string): boolean {
  return evmChecksumState(address) !== "invalid";
}

/** Lower-case form used for every comparison and for HyperCore payloads. */
export function normalizeAddress(address: string): EvmAddress {
  if (!isEvmAddress(address)) throw new Error(`Invalid EVM address: ${address}`);
  return address.toLowerCase() as EvmAddress;
}

/** Checksum-insensitive address equality; false when either side is malformed. */
export function sameAddress(a: string, b: string): boolean {
  return isEvmAddress(a) && isEvmAddress(b) && a.toLowerCase() === b.toLowerCase();
}

/* --------------------------------------------------------- CAIP-2 / CAIP-10 */

export function namespaceOf(network: Network): ChainNamespace {
  return network.vm === "evm" ? "eip155" : "hypercore";
}

function networkOf(network: NetworkKey | Network): Network {
  return typeof network === "string" ? NETWORKS[network] : network;
}

/** `eip155:99801:0x…` or `hypercore:testnet:0x…`. The address keeps the case it was given. */
export function formatAccountId(network: NetworkKey | Network, address: string): AccountId {
  const descriptor = networkOf(network);
  if (!isEvmAddress(address)) throw new Error(`Invalid address for ${descriptor.name}: ${address}`);
  return `${descriptor.caip2}:${address}` as AccountId;
}

export interface ParsedAccountId {
  readonly network: Network;
  readonly namespace: ChainNamespace;
  readonly address: EvmAddress;
  readonly id: AccountId;
}

/** Splits at the last `:` so `hypercore:testnet:0x…` parses. Null when malformed or the chain is unknown. */
export function parseAccountId(value: unknown): ParsedAccountId | null {
  if (typeof value !== "string") return null;
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const network = networkByCaip2(value.slice(0, lastColon));
  const address = value.slice(lastColon + 1);
  if (!network || !isEvmAddress(address)) return null;
  return { network, namespace: namespaceOf(network), address, id: `${network.caip2}:${address}` as AccountId };
}

export function isAccountId(value: unknown): value is AccountId {
  return parseAccountId(value) !== null;
}

/** Same chain and same address (checksum-insensitive). */
export function sameAccount(a: string, b: string): boolean {
  const left = parseAccountId(a);
  const right = parseAccountId(b);
  return left !== null && right !== null && left.network.key === right.network.key && sameAddress(left.address, right.address);
}

function ownerAddress(value: string): string | null {
  if (isEvmAddress(value)) return value.toLowerCase();
  return parseAccountId(value)?.address.toLowerCase() ?? null;
}

/**
 * True when both values name the same key holder: the same 0x address on any
 * Elysium, HyperEVM or HyperCore account (or a bare address). This backs
 * `recipients.mode: own` and the third-party cap on funded steps. A smart
 * contract account need not exist at that address on every chain, which is
 * why planners still warn before re-homing contract senders.
 */
export function sameOwner(a: string, b: string): boolean {
  const left = ownerAddress(a);
  const right = ownerAddress(b);
  return left !== null && left === right;
}

/** The same owner's account on another network (re-homing a user's address). */
export function accountOn(account: string, network: NetworkKey | Network): AccountId {
  const parsed = parseAccountId(account);
  const address = parsed?.address ?? (isEvmAddress(account) ? account : null);
  if (!address) throw new Error(`Invalid account: ${account}`);
  return formatAccountId(network, address);
}

/* ------------------------------------------------------------------ CAIP-19 */

/**
 * - `slip44:60`: the native gas asset of an EVM network (HYPE on Elysium and HyperEVM);
 * - `erc20:<address>`: a token on an EVM network;
 * - `spot:<tokenIndex>`: a HyperCore spot token (`spotMeta.tokens[].index`);
 * - `perp:<COIN>`: a HyperCore perp position (the position, not a token);
 * - `margin:usdc`: USDC perp margin on HyperCore.
 */
export type AssetNamespace = "slip44" | "erc20" | "spot" | "perp" | "margin";

export interface ParsedAssetId {
  readonly network: Network;
  readonly namespace: AssetNamespace;
  /** For `perp`, the decoded coin name (`xyz:TSLA` for builder-deployed markets). */
  readonly reference: string;
  readonly id: AssetId;
  readonly isNative: boolean;
}

const PERP_COIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,47})?$/u;

function hyperCoreNetwork(network: NetworkKey | Network | NetworkEnvironment): HyperCoreNetwork {
  const descriptor = network === "testnet" || network === "mainnet" ? NETWORKS[`hypercore-${network}`] : networkOf(network);
  if (descriptor.vm !== "hypercore") throw new Error(`${descriptor.key} is not a HyperCore network`);
  return descriptor;
}

function evmCaip(network: NetworkKey | Network): `eip155:${number}` {
  const descriptor = networkOf(network);
  if (descriptor.vm !== "evm") throw new Error(`${descriptor.key} is not an EVM network`);
  return descriptor.caip2;
}

/** Native gas asset (`slip44:60`) of an EVM network. HyperCore has no gas asset; use `marginAssetId`. */
export function nativeAssetId(network: NetworkKey | Network): AssetId {
  return `${evmCaip(network)}/slip44:60`;
}

export function erc20AssetId(network: NetworkKey | Network, address: string): AssetId {
  if (!isEvmAddress(address)) throw new Error(`Invalid token address: ${address}`);
  return `${evmCaip(network)}/erc20:${address}`;
}

export function spotAssetId(network: NetworkKey | Network | NetworkEnvironment, tokenIndex: number): AssetId {
  if (!Number.isSafeInteger(tokenIndex) || tokenIndex < 0) throw new Error(`Invalid spot token index: ${tokenIndex}`);
  return `${hyperCoreNetwork(network).caip2}/spot:${tokenIndex}`;
}

/** CAIP-19 references cannot hold `:`, so a builder market's `dex:COIN` is stored as `dex%3ACOIN`. */
export function perpAssetId(network: NetworkKey | Network | NetworkEnvironment, coin: string): AssetId {
  if (!PERP_COIN.test(coin)) throw new Error(`Invalid perp coin: ${coin}`);
  return `${hyperCoreNetwork(network).caip2}/perp:${coin.replace(":", "%3A")}`;
}

export function marginAssetId(network: NetworkKey | Network | NetworkEnvironment): AssetId {
  return `${hyperCoreNetwork(network).caip2}/margin:usdc`;
}

export function parseAssetId(value: unknown): ParsedAssetId | null {
  if (typeof value !== "string") return null;
  const slash = value.indexOf("/");
  if (slash <= 0) return null;
  const network = networkByCaip2(value.slice(0, slash));
  if (!network) return null;
  const rest = value.slice(slash + 1);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const namespace = rest.slice(0, colon);
  const raw = rest.slice(colon + 1);
  const evm = network.vm === "evm";
  let reference: string;
  switch (namespace) {
    case "slip44":
      if (!evm || raw !== "60") return null;
      reference = raw;
      break;
    case "erc20":
      if (!evm || !isEvmAddress(raw)) return null;
      reference = raw;
      break;
    case "spot":
      if (evm || !/^(?:0|[1-9]\d{0,9})$/u.test(raw)) return null;
      reference = raw;
      break;
    case "perp": {
      if (evm) return null;
      const coin = raw.replace(/%3A/giu, ":");
      if (!PERP_COIN.test(coin)) return null;
      reference = coin;
      break;
    }
    case "margin":
      if (evm || raw !== "usdc") return null;
      reference = raw;
      break;
    default:
      return null;
  }
  return { network, namespace, reference, id: value as AssetId, isNative: namespace === "slip44" };
}

export function isAssetId(value: unknown): value is AssetId {
  return parseAssetId(value) !== null;
}

/** Asset equality; ERC-20 addresses compare checksum-insensitively. */
export function sameAsset(a: string, b: string): boolean {
  const left = parseAssetId(a);
  const right = parseAssetId(b);
  if (!left || !right) return false;
  if (left.network.key !== right.network.key || left.namespace !== right.namespace) return false;
  return left.namespace === "erc20" ? sameAddress(left.reference, right.reference) : left.reference === right.reference;
}

/** Lower-cases the ERC-20 address of an asset id so ids can key maps. Unparseable input is returned unchanged. */
export function normalizeAssetId(asset: string): string {
  const parsed = parseAssetId(asset);
  return parsed && parsed.namespace === "erc20" ? `${parsed.network.caip2}/erc20:${parsed.reference.toLowerCase()}` : asset;
}
