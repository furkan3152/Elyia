/**
 * Unsigned HyperCore requests: user-signed actions (EIP-712 typed data for
 * the wallet) and L1 actions (phantom-agent typed data for the trade-only
 * agent key, with a connection id that commits to the action, nonce and
 * expiry). Built only from core builders, so key order (msgpack) and field
 * lists (EIP-712) are the SDK's.
 */
import {
  getHyperCoreNetwork,
  hypercore,
  signatureChainIdHex,
  type EvmAddress,
  type HyperCoreL1ActionRequest,
  type HyperCoreUserSignedRequest,
  type NetworkKey,
} from "@elyia/core";

export type L1Action = hypercore.L1Action;
export type UserSignedAction = hypercore.UserSignedAction;

/** Payloads expire quickly: an L1 action carries `expiresAfter` = prepare + this. */
export const L1_EXPIRY_MS = 90_000;

export function userSignedContext(network: NetworkKey, signatureChainId: number): hypercore.UserSignedContext {
  return { hyperliquidChain: getHyperCoreNetwork(network).hyperliquidChain, signatureChainId: signatureChainIdHex(signatureChainId) };
}

export function userSignedRequest(network: NetworkKey, from: string, action: UserSignedAction, description: string): HyperCoreUserSignedRequest {
  return {
    vm: "hypercore",
    network,
    kind: "user-signed",
    signer: "wallet",
    from: from.toLowerCase() as EvmAddress,
    action,
    typedData: hypercore.typedDataForUserAction(action),
    nonce: String(hypercore.userSignedNonce(action)),
    description,
  };
}

export function l1Request(input: {
  readonly network: NetworkKey;
  readonly from: string;
  readonly agent: string;
  readonly signer: "agent" | "keeper";
  readonly action: L1Action;
  readonly nonce: number;
  readonly expiresAfter: number;
  readonly description: string;
  readonly cloids?: readonly hypercore.Cloid[];
}): HyperCoreL1ActionRequest {
  const network = getHyperCoreNetwork(input.network);
  const { connectionId, typedData } = hypercore.l1ActionTypedData({ action: input.action, nonce: input.nonce, expiresAfter: input.expiresAfter, isMainnet: network.hyperliquidChain === "Mainnet" });
  return {
    vm: "hypercore",
    network: input.network,
    kind: "l1-action",
    signer: input.signer,
    from: input.from.toLowerCase() as EvmAddress,
    agent: input.agent.toLowerCase() as EvmAddress,
    action: input.action,
    nonce: String(input.nonce),
    expiresAfter: input.expiresAfter,
    connectionId,
    typedData,
    ...(input.cloids && input.cloids.length > 0 ? { cloids: input.cloids } : {}),
    description: input.description,
  };
}
