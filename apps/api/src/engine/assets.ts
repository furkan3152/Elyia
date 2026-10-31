/**
 * Asset resolution for the planner and adapters. EVM assets come from the
 * verified core token registry (an unlisted address resolves as an
 * unverified token with its on-chain metadata, for explicit routes such as
 * the mirror bridge); HyperCore spot tokens come from the live `spotMeta`,
 * never from a guess. Symbols never resolve across networks.
 */
import {
  findToken,
  formatUnitsTrim,
  resolveToken,
  getToken,
  isEvmAddress,
  marginAssetId,
  NETWORKS,
  nativeToken,
  parseAccountId,
  parseAssetId,
  spotAssetId,
  erc20AssetId,
  type AssetId,
  type NetworkKey,
  type StepAmount,
  type TokenDescriptor,
} from "@elyia/core";
import type { Address } from "viem";
import { ERC20_METADATA_ABI } from "./abis.js";
import { engineError } from "./errors.js";
import type { HyperCorePort } from "./ports/hypercore.js";
import type { EvmPort } from "./ports/evm.js";
import type { SpotMeta } from "../hyperliquid/types.js";

/** A HyperCore spot token as `spotMeta` describes it. */
export interface CoreTokenInfo {
  readonly index: number;
  readonly name: string;
  /** 16-byte id; spotSend's `token` is `${name}:${tokenId}`. */
  readonly tokenId: `0x${string}`;
  readonly weiDecimals: number;
  readonly szDecimals: number;
  /** Linked HyperEVM contract and extra decimals, when linked. */
  readonly evmContract: { readonly address: Address; readonly extraWeiDecimals: number } | null;
}

export interface ResolvedAsset {
  readonly network: NetworkKey;
  readonly id: AssetId;
  readonly symbol: string;
  readonly decimals: number;
  /** The EVM gas asset (HYPE on Elysium and HyperEVM). */
  readonly native: boolean;
  /** ERC-20 contract on EVM networks. */
  readonly address: Address | null;
  readonly token: TokenDescriptor | null;
  /** In the verified registry (HyperCore spot tokens from spotMeta count as verified). */
  readonly verified: boolean;
  /** HyperCore spot token, or the perp margin balance (`margin`). */
  readonly core?: CoreTokenInfo;
  readonly margin?: boolean;
}

export function fromToken(token: TokenDescriptor): ResolvedAsset {
  return {
    network: token.network,
    id: token.id,
    symbol: token.symbol,
    decimals: token.decimals,
    native: token.kind === "native",
    address: token.address === null ? null : (token.address.toLowerCase() as Address),
    token,
    verified: true,
  };
}

export function nativeAsset(network: NetworkKey): ResolvedAsset {
  const token = nativeToken(network);
  if (!token) throw engineError("TOKEN_UNKNOWN", `${NETWORKS[network].name} has no native gas asset.`);
  return fromToken(token);
}

/** spotMeta token -> CoreTokenInfo. */
export function coreTokenInfo(meta: SpotMeta, match: (token: SpotMeta["tokens"][number]) => boolean): CoreTokenInfo | null {
  const token = meta.tokens.find(match);
  if (!token) return null;
  const evm = token.evmContract;
  return {
    index: token.index,
    name: token.name,
    tokenId: token.tokenId as `0x${string}`,
    weiDecimals: token.weiDecimals,
    szDecimals: token.szDecimals,
    evmContract: evm && isEvmAddress(evm.address) ? { address: evm.address.toLowerCase() as Address, extraWeiDecimals: evm.evm_extra_wei_decimals } : null,
  };
}

/** USDC perp margin on HyperCore (token 0, 6 decimals of USD on the wire). */
export function marginAsset(network: NetworkKey): ResolvedAsset {
  return { network, id: marginAssetId(network), symbol: "USDC", decimals: 6, native: false, address: null, token: null, verified: true, margin: true };
}

export function coreSpotAsset(network: NetworkKey, core: CoreTokenInfo): ResolvedAsset {
  return { network, id: spotAssetId(network, core.index), symbol: core.name, decimals: core.weiDecimals, native: false, address: null, token: null, verified: true, core };
}

export interface AssetDeps {
  readonly evm: EvmPort;
  readonly core: HyperCorePort;
}

/**
 * Resolves a symbol, address or CAIP-19 id on one network. HyperCore:
 * `USDC` with `{ margin: true }` is perp margin, otherwise spot tokens by
 * name. Unlisted EVM addresses resolve unverified (with on-chain metadata)
 * only when `allowUnverified` is set.
 */
export async function resolveAsset(
  deps: AssetDeps,
  network: NetworkKey,
  raw: string,
  options: { readonly margin?: boolean; readonly allowUnverified?: boolean } = {},
): Promise<ResolvedAsset> {
  const descriptor = NETWORKS[network];
  const text = raw.trim();
  if (descriptor.vm === "hypercore") {
    const parsed = parseAssetId(text);
    if (parsed && parsed.network.key !== network) throw engineError("ASSET_NETWORK_MISMATCH", `${text} is not on ${descriptor.name}.`);
    if (options.margin || parsed?.namespace === "margin") return marginAsset(network);
    const meta = await deps.core.spotMeta(network);
    const wanted = parsed?.namespace === "spot" ? Number(parsed.reference) : null;
    const symbol = text.toUpperCase();
    const core = coreTokenInfo(meta, (token) => (wanted !== null ? token.index === wanted : token.name.toUpperCase() === symbol));
    if (!core) throw engineError("TOKEN_UNKNOWN", `HyperCore has no spot token ${text}.`);
    return coreSpotAsset(network, core);
  }
  const token = findToken(network, text);
  if (token) return fromToken(token);
  const parsed = parseAssetId(text);
  const address = isEvmAddress(text) ? text : parsed?.namespace === "erc20" && parsed.network.key === network ? parsed.reference : null;
  if (parsed && parsed.network.key !== network) throw engineError("ASSET_NETWORK_MISMATCH", `${text} is not on ${descriptor.name}.`);
  if (!address) throw engineError("TOKEN_UNKNOWN", `${text} is not a listed token on ${descriptor.name}. Use a listed symbol or the token's address.`);
  const flagged = resolveToken(network, address);
  if (flagged.flagged) throw engineError("TOKEN_LOOKALIKE", flagged.warning ?? `${address} is a flagged token on ${descriptor.name}; Elyia never routes it.`, { network, address: address.toLowerCase() });
  if (!options.allowUnverified) {
    throw engineError("TOKEN_UNVERIFIED", `${address} is not in Elyia's verified token list for ${descriptor.name}. Name the protocol explicitly to use it deliberately.`);
  }
  const lower = address.toLowerCase() as Address;
  const [symbol, decimals] = await Promise.all([
    deps.evm.read(network, { address: lower, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
    deps.evm.read(network, { address: lower, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
  ]).catch(() => {
    throw engineError("TOKEN_UNKNOWN", `${address} does not answer as an ERC-20 token on ${descriptor.name}.`);
  });
  return { network, id: erc20AssetId(network, lower), symbol: String(symbol).slice(0, 24), decimals: Number(decimals), native: false, address: lower, token: null, verified: false };
}

/** The step account's 0x address (lower-case). */
export function stepAddress(step: { readonly account: string }): Address {
  const parsed = parseAccountId(step.account);
  if (!parsed) throw engineError("STEP_INVALID", "The step account is not a CAIP-10 id.");
  return parsed.address.toLowerCase() as Address;
}

/** The asset a recorded StepAmount names (prepare and verify rebuild assets from the stored step alone). */
export function assetOfAmount(amount: StepAmount): ResolvedAsset {
  const parsed = parseAssetId(amount.asset);
  if (!parsed) throw engineError("STEP_INVALID", `Stored asset ${amount.asset} is not a CAIP-19 id.`);
  const network = parsed.network.key;
  const token = getToken(amount.asset);
  if (token) return fromToken(token);
  switch (parsed.namespace) {
    case "slip44":
      return nativeAsset(network);
    case "erc20":
      return { network, id: amount.asset as AssetId, symbol: amount.symbol, decimals: amount.decimals, native: false, address: parsed.reference.toLowerCase() as Address, token: null, verified: false };
    case "margin":
      return marginAsset(network);
    default:
      return { network, id: amount.asset as AssetId, symbol: amount.symbol, decimals: amount.decimals, native: false, address: null, token: null, verified: true };
  }
}

export function sameResolved(a: ResolvedAsset | null, b: ResolvedAsset | null): boolean {
  return a !== null && b !== null && a.network === b.network && a.id.toLowerCase() === b.id.toLowerCase();
}

/** A StepAmount for `asset` (base units). */
export function amountOf(asset: ResolvedAsset, expected: bigint, extra: { readonly minimum?: bigint; readonly maximum?: bigint; readonly usd?: string | null } = {}): StepAmount {
  return {
    asset: asset.id,
    symbol: asset.symbol,
    decimals: asset.decimals,
    expected: expected.toString(),
    ...(extra.minimum !== undefined ? { minimum: extra.minimum.toString() } : {}),
    ...(extra.maximum !== undefined ? { maximum: extra.maximum.toString() } : {}),
    ...(extra.usd !== undefined ? { usd: extra.usd } : {}),
  };
}

/** "1.5 HYPE" from base units, for titles and messages. */
export function formatAmount(units: bigint, decimals: number, symbol: string, maxFraction = 6): string {
  return `${formatUnitsTrim(units, decimals, maxFraction)} ${symbol}`;
}
