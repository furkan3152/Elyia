/**
 * Quote bindings. At prepare the engine hashes the security-relevant fields
 * of every request it hands out; at submit it rebuilds the same view from the
 * evidence (the mined transaction, or the HyperCore action it finds) and
 * accepts the references only when the hashes match a binding it prepared.
 *
 * The views keep exactly the fields that decide where value goes:
 * - EVM: chain id, sender, target, calldata, value;
 * - HyperCore user-signed: environment, signer, primary type, signing chain
 *   and the full typed message (destination, amount, token, nonce...);
 * - HyperCore L1: environment, account, agent, connection id (which commits
 *   to the whole action through msgpack), nonce, expiry and vault.
 * Addresses and hex are lower-cased so checksum case never changes a hash.
 */
import { canonicalDigest, canonicalJson, type Sha256Digest } from "./canonical.js";
import { NETWORKS, type NetworkKey } from "./networks.js";
import { actionHash, typedDataForUserAction } from "./hypercore/signing.js";
import { userSignedNonce } from "./hypercore/actions.js";
import type { EvmTransactionRequest, HyperCoreL1ActionRequest, HyperCoreUserSignedRequest, TransactionRequest } from "./intent.js";

export const BINDING_SPEC = "elyia.binding/v1" as const;

export type QuoteBinding = Sha256Digest;

export interface EvmBindingView {
  readonly vm: "evm";
  readonly chainId: number;
  readonly from: string;
  readonly to: string;
  readonly data: string;
  readonly value: string;
}

export interface UserSignedBindingView {
  readonly vm: "hypercore";
  readonly kind: "user-signed";
  readonly chain: "Mainnet" | "Testnet";
  readonly from: string;
  readonly primaryType: string;
  readonly signatureChainId: number;
  readonly message: Readonly<Record<string, string | number | boolean>>;
}

export interface L1BindingView {
  readonly vm: "hypercore";
  readonly kind: "l1";
  readonly chain: "Mainnet" | "Testnet";
  readonly from: string;
  readonly agent: string;
  readonly connectionId: string;
  readonly nonce: string;
  readonly expiresAfter: number;
  readonly vault: string | null;
}

export type BindingView = EvmBindingView | UserSignedBindingView | L1BindingView;

function hyperliquidChain(network: NetworkKey): "Mainnet" | "Testnet" {
  const descriptor = NETWORKS[network];
  if (descriptor.vm !== "hypercore") throw new Error(`${network} is not a HyperCore network.`);
  return descriptor.hyperliquidChain;
}

function lowerMessage(message: Readonly<Record<string, string | number | boolean>>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(message)) out[key] = typeof value === "string" && /^0x[0-9a-fA-F]+$/u.test(value) ? value.toLowerCase() : value;
  return out;
}

export function evmBindingView(request: Pick<EvmTransactionRequest, "chainId" | "from" | "to" | "data" | "value">): EvmBindingView {
  return {
    vm: "evm",
    chainId: request.chainId,
    from: request.from.toLowerCase(),
    to: request.to.toLowerCase(),
    data: request.data.toLowerCase(),
    value: BigInt(request.value).toString(),
  };
}

export function userSignedBindingView(request: HyperCoreUserSignedRequest): UserSignedBindingView {
  return {
    vm: "hypercore",
    kind: "user-signed",
    chain: hyperliquidChain(request.network),
    from: request.from.toLowerCase(),
    primaryType: request.typedData.primaryType,
    signatureChainId: request.typedData.domain.chainId,
    message: lowerMessage(request.typedData.message),
  };
}

export function l1BindingView(request: HyperCoreL1ActionRequest): L1BindingView {
  return {
    vm: "hypercore",
    kind: "l1",
    chain: hyperliquidChain(request.network),
    from: request.from.toLowerCase(),
    agent: request.agent.toLowerCase(),
    connectionId: request.connectionId.toLowerCase(),
    nonce: request.nonce,
    expiresAfter: request.expiresAfter,
    vault: request.vaultAddress ? request.vaultAddress.toLowerCase() : null,
  };
}

export function bindingView(request: TransactionRequest): BindingView {
  if (request.vm === "evm") return evmBindingView(request);
  return request.kind === "user-signed" ? userSignedBindingView(request) : l1BindingView(request);
}

/** `sha256:` digest of the canonical binding views of a step's requests, in order. */
export function bindingHash(views: readonly BindingView[]): QuoteBinding {
  return canonicalDigest({ spec: BINDING_SPEC, views });
}

/** The quote binding of a prepared payload. */
export function quoteBinding(requests: readonly TransactionRequest[]): QuoteBinding {
  return bindingHash(requests.map(bindingView));
}

/**
 * True when an L1 request's `connectionId` really commits to its action,
 * nonce, vault and expiry (an engine guard independent of the adapter that
 * built it).
 */
export function l1RequestConsistent(request: HyperCoreL1ActionRequest): boolean {
  try {
    return actionHash(request.action, request.vaultAddress ?? null, BigInt(request.nonce), request.expiresAfter) === request.connectionId.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * True when a user-signed request's typed data is exactly what its action
 * implies (same primary type, fields, domain chain and message) and its
 * nonce is the action's own.
 */
export function userSignedRequestConsistent(request: HyperCoreUserSignedRequest): boolean {
  try {
    const expected = typedDataForUserAction(request.action);
    return (
      canonicalJson(expected) === canonicalJson(request.typedData) &&
      String(userSignedNonce(request.action)) === request.nonce &&
      request.action.hyperliquidChain === hyperliquidChain(request.network)
    );
  } catch {
    return false;
  }
}
