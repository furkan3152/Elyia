/**
 * HyperCore signing payloads, byte-for-byte compatible with the official
 * Python SDK (`hyperliquid/utils/signing.py`). This module builds hashes and
 * EIP-712 typed data only: secp256k1 signing happens in the wallet (user-
 * signed actions) or with the in-browser agent key (L1 actions), never here.
 *
 * L1 actions:
 *   connectionId = keccak256( msgpack(action)
 *                             || nonce as 8-byte big-endian
 *                             || (vaultAddress ? 0x01 || 20 address bytes : 0x00)
 *                             || (expiresAfter !== null ? 0x00 || expiresAfter as 8-byte big-endian : nothing) )
 *   signed as EIP-712 `Agent{source: "a" mainnet | "b" testnet, connectionId}`
 *   in the domain {name "Exchange", version "1", chainId 1337, verifyingContract 0x0}.
 *
 * User-signed actions: EIP-712 `HyperliquidTransaction:<Name>` in the domain
 * {name "HyperliquidSignTransaction", version "1", chainId = signatureChainId
 * (the wallet's chain), verifyingContract 0x0}; `hyperliquidChain` decides
 * the environment so a signature cannot be replayed on the other one.
 */
import { encode } from "@msgpack/msgpack";
import { hexToBytes } from "@noble/hashes/utils";
import { isEvmAddress, keccak256Hex } from "../caip.js";
import { isUserSignedAction, type HyperliquidChain, type L1Action, type UserSignedAction, type UserSignedActionType } from "./actions.js";

export class HyperCoreSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HyperCoreSigningError";
  }
}

export interface Eip712Field {
  readonly name: string;
  readonly type: string;
}

export interface Eip712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: `0x${string}`;
}

/**
 * EIP-712 payload in the shape viem / wagmi `signTypedData` take (no
 * `EIP712Domain` entry in `types`; use `withDomainType` for raw
 * `eth_signTypedData_v4`).
 */
export interface Eip712TypedData<P extends string = string> {
  readonly domain: Eip712Domain;
  readonly types: Readonly<Record<P, readonly Eip712Field[]>>;
  readonly primaryType: P;
  readonly message: Readonly<Record<string, string | number | boolean>>;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const EIP712_DOMAIN_TYPE: readonly Eip712Field[] = Object.freeze([
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
]);

/** Adds the `EIP712Domain` type for wallets called directly through `eth_signTypedData_v4`. */
export function withDomainType<P extends string>(typed: Eip712TypedData<P>): Eip712TypedData<P> & { readonly types: Readonly<Record<P | "EIP712Domain", readonly Eip712Field[]>> } {
  return { ...typed, types: { ...typed.types, EIP712Domain: EIP712_DOMAIN_TYPE } as Readonly<Record<P | "EIP712Domain", readonly Eip712Field[]>> };
}

/* --------------------------------------------------------------- msgpack */

/** Throws unless `value` encodes deterministically: no floats, bigints, undefined or exotic objects. */
function assertMsgpackSafe(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new HyperCoreSigningError(`${path} is ${value}: only safe integers may be hashed (prices and sizes are strings).`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMsgpackSafe(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) throw new HyperCoreSigningError(`${path}.${key} is undefined: omit absent fields instead.`);
      assertMsgpackSafe(entry, `${path}.${key}`);
    }
    return;
  }
  throw new HyperCoreSigningError(`${path} has a type that cannot be hashed (${typeof value}).`);
}

/** msgpack bytes of an action, keys in insertion order (the SDK's `msgpack.packb`). */
export function actionMsgpack(action: object): Uint8Array {
  assertMsgpackSafe(action, "action");
  return encode(action);
}

function uint64Bytes(value: number | bigint, what: string): Uint8Array {
  const big = typeof value === "bigint" ? value : Number.isSafeInteger(value) ? BigInt(value) : -1n;
  if (big < 0n || big >= 1n << 64n) throw new HyperCoreSigningError(`${what} must be an unsigned 64-bit integer.`);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, big, false);
  return bytes;
}

/* ------------------------------------------------------------- L1 actions */

/**
 * The SDK's `action_hash(action, vault_address, nonce, expires_after)`.
 * `action` is normally an `L1Action` from actions.ts; any plain object is
 * accepted so the SDK's own test vectors (`dummy`, `createSubAccount`...) port as-is.
 */
export function actionHash(action: L1Action | object, vaultAddress: string | null, nonce: number | bigint, expiresAfter: number | bigint | null): `0x${string}` {
  const body = actionMsgpack(action);
  if (vaultAddress !== null && !isEvmAddress(vaultAddress)) throw new HyperCoreSigningError(`vaultAddress ${vaultAddress} is not an address.`);
  const parts: Uint8Array[] = [body, uint64Bytes(nonce, "nonce")];
  if (vaultAddress === null) parts.push(Uint8Array.of(0));
  else parts.push(Uint8Array.of(1), hexToBytes(vaultAddress.slice(2)));
  if (expiresAfter !== null) parts.push(Uint8Array.of(0), uint64Bytes(expiresAfter, "expiresAfter"));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return keccak256Hex(bytes);
}

export interface PhantomAgent {
  readonly source: "a" | "b";
  readonly connectionId: `0x${string}`;
}

/** The SDK's `construct_phantom_agent`: source "a" on mainnet, "b" on testnet. */
export function phantomAgent(connectionId: string, isMainnet: boolean): PhantomAgent {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(connectionId)) throw new HyperCoreSigningError("connectionId must be a 32-byte hex hash.");
  return { source: isMainnet ? "a" : "b", connectionId: connectionId.toLowerCase() as `0x${string}` };
}

export const L1_DOMAIN: Eip712Domain = Object.freeze({ name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO_ADDRESS });

export const AGENT_TYPES: Readonly<Record<"Agent", readonly Eip712Field[]>> = Object.freeze({
  Agent: Object.freeze([
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ]),
});

/** The SDK's `l1_payload(phantom_agent)`. */
export function l1TypedData(agent: PhantomAgent): Eip712TypedData<"Agent"> {
  return { domain: L1_DOMAIN, types: AGENT_TYPES, primaryType: "Agent", message: { source: agent.source, connectionId: agent.connectionId } };
}

export interface L1SigningRequest {
  readonly action: L1Action | object;
  readonly nonce: number;
  readonly vaultAddress?: string | null;
  /** Unix ms after which HyperCore rejects the action. Elyia always sets it for agent-signed actions. */
  readonly expiresAfter?: number | null;
  readonly isMainnet: boolean;
}

/** Everything an agent signer needs for one L1 action: the connection id and the typed data to sign. */
export function l1ActionTypedData(request: L1SigningRequest): { readonly connectionId: `0x${string}`; readonly typedData: Eip712TypedData<"Agent"> } {
  const connectionId = actionHash(request.action, request.vaultAddress ?? null, request.nonce, request.expiresAfter ?? null);
  return { connectionId, typedData: l1TypedData(phantomAgent(connectionId, request.isMainnet)) };
}

/* ---------------------------------------------------- user-signed actions */

const f = (name: string, type: string): Eip712Field => ({ name, type });

/* Field lists, exactly as the Python SDK's signing.py constants. */
export const USD_SEND_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("destination", "string"), f("amount", "string"), f("time", "uint64")]);
export const SPOT_TRANSFER_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("destination", "string"), f("token", "string"), f("amount", "string"), f("time", "uint64")]);
export const WITHDRAW_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("destination", "string"), f("amount", "string"), f("time", "uint64")]);
export const USD_CLASS_TRANSFER_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("amount", "string"), f("toPerp", "bool"), f("nonce", "uint64")]);
export const SEND_ASSET_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([
  f("hyperliquidChain", "string"), f("destination", "string"), f("sourceDex", "string"), f("destinationDex", "string"),
  f("token", "string"), f("amount", "string"), f("fromSubAccount", "string"), f("nonce", "uint64"),
]);
export const USER_DEX_ABSTRACTION_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("user", "address"), f("enabled", "bool"), f("nonce", "uint64")]);
export const USER_SET_ABSTRACTION_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("user", "address"), f("abstraction", "string"), f("nonce", "uint64")]);
export const TOKEN_DELEGATE_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("validator", "address"), f("wei", "uint64"), f("isUndelegate", "bool"), f("nonce", "uint64")]);
export const CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("signers", "string"), f("nonce", "uint64")]);
export const MULTI_SIG_ENVELOPE_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("multiSigActionHash", "bytes32"), f("nonce", "uint64")]);
/** `sign_agent` in the SDK. */
export const APPROVE_AGENT_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("agentAddress", "address"), f("agentName", "string"), f("nonce", "uint64")]);
/** `sign_approve_builder_fee` in the SDK. */
export const APPROVE_BUILDER_FEE_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("maxFeeRate", "string"), f("builder", "address"), f("nonce", "uint64")]);
/** Staking moves (not in the Python SDK; field lists from the exchange docs and the TypeScript SDK). */
export const C_DEPOSIT_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("wei", "uint64"), f("nonce", "uint64")]);
export const C_WITHDRAW_SIGN_TYPES: readonly Eip712Field[] = Object.freeze([f("hyperliquidChain", "string"), f("wei", "uint64"), f("nonce", "uint64")]);

export interface UserSignedSpec {
  readonly primaryType: `HyperliquidTransaction:${string}`;
  readonly fields: readonly Eip712Field[];
}

export const USER_SIGNED_SPECS: Readonly<Record<UserSignedActionType, UserSignedSpec>> = Object.freeze({
  usdSend: { primaryType: "HyperliquidTransaction:UsdSend", fields: USD_SEND_SIGN_TYPES },
  spotSend: { primaryType: "HyperliquidTransaction:SpotSend", fields: SPOT_TRANSFER_SIGN_TYPES },
  withdraw3: { primaryType: "HyperliquidTransaction:Withdraw", fields: WITHDRAW_SIGN_TYPES },
  usdClassTransfer: { primaryType: "HyperliquidTransaction:UsdClassTransfer", fields: USD_CLASS_TRANSFER_SIGN_TYPES },
  sendAsset: { primaryType: "HyperliquidTransaction:SendAsset", fields: SEND_ASSET_SIGN_TYPES },
  approveAgent: { primaryType: "HyperliquidTransaction:ApproveAgent", fields: APPROVE_AGENT_SIGN_TYPES },
  approveBuilderFee: { primaryType: "HyperliquidTransaction:ApproveBuilderFee", fields: APPROVE_BUILDER_FEE_SIGN_TYPES },
  tokenDelegate: { primaryType: "HyperliquidTransaction:TokenDelegate", fields: TOKEN_DELEGATE_TYPES },
  cDeposit: { primaryType: "HyperliquidTransaction:CDeposit", fields: C_DEPOSIT_SIGN_TYPES },
  cWithdraw: { primaryType: "HyperliquidTransaction:CWithdraw", fields: C_WITHDRAW_SIGN_TYPES },
});

/** Domain chain id of a user-signed action (`int(signatureChainId, 16)`). */
export function signatureChainIdNumber(signatureChainId: string): number {
  if (!/^0x[0-9a-fA-F]{1,12}$/u.test(signatureChainId)) throw new HyperCoreSigningError(`signatureChainId ${signatureChainId} is not hex.`);
  const chainId = Number.parseInt(signatureChainId.slice(2), 16);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new HyperCoreSigningError(`signatureChainId ${signatureChainId} is not a chain id.`);
  return chainId;
}

/**
 * The SDK's `user_signed_payload(primary_type, payload_types, action)` for a
 * given field list: the message holds exactly the typed fields (an unnamed
 * approveAgent signs `agentName: ""`, as the SDK does).
 */
export function userSignedTypedData<P extends `HyperliquidTransaction:${string}`>(
  action: { readonly signatureChainId: string; readonly hyperliquidChain: HyperliquidChain } & Readonly<Record<string, unknown>>,
  primaryType: P,
  fields: readonly Eip712Field[],
): Eip712TypedData<P> {
  const message: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const raw = action[field.name];
    const value = raw === undefined && field.name === "agentName" ? "" : raw;
    if (typeof value === "number" && Number.isSafeInteger(value)) message[field.name] = value;
    else if (typeof value === "string" || typeof value === "boolean") message[field.name] = value;
    else throw new HyperCoreSigningError(`${primaryType} needs ${field.name} (${field.type}).`);
  }
  return {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: signatureChainIdNumber(action.signatureChainId), verifyingContract: ZERO_ADDRESS },
    types: { [primaryType]: fields } as Readonly<Record<P, readonly Eip712Field[]>>,
    primaryType,
    message,
  };
}

/** Typed data for one of Elyia's user-signed actions, with the SDK's primary type and field list. */
export function typedDataForUserAction(action: UserSignedAction): Eip712TypedData<`HyperliquidTransaction:${string}`> {
  if (!isUserSignedAction(action)) throw new HyperCoreSigningError(`${(action as { type: string }).type} is not a user-signed action.`);
  const spec = USER_SIGNED_SPECS[action.type];
  return userSignedTypedData(action as unknown as Parameters<typeof userSignedTypedData>[0], spec.primaryType, spec.fields);
}

/* ------------------------------------------------------ /exchange payload */

export interface ExchangeSignature {
  /** 0x + 64 hex. */
  readonly r: `0x${string}`;
  readonly s: `0x${string}`;
  readonly v: 27 | 28;
}

/** Splits a 65-byte `0x{r}{s}{v}` signature (v as 27/28 or 0/1) into the /exchange form. */
export function splitSignature(signature: string): ExchangeSignature {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) throw new HyperCoreSigningError("A signature is 65 bytes of hex (0x + 130 characters).");
  const r = `0x${signature.slice(2, 66).toLowerCase()}` as const;
  const s = `0x${signature.slice(66, 130).toLowerCase()}` as const;
  const rawV = Number.parseInt(signature.slice(130, 132), 16);
  const v = rawV < 27 ? rawV + 27 : rawV;
  if (v !== 27 && v !== 28) throw new HyperCoreSigningError(`Signature recovery id ${rawV} is not 0, 1, 27 or 28.`);
  // Reject high-s signatures: HyperCore, like Ethereum, expects canonical low-s.
  if (BigInt(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) throw new HyperCoreSigningError("Signature s value is not canonical (high s).");
  return { r, s, v };
}

export interface ExchangeRequest {
  readonly action: L1Action | UserSignedAction;
  readonly nonce: number;
  readonly signature: ExchangeSignature;
  readonly vaultAddress?: string;
  readonly expiresAfter?: number;
}

/**
 * The JSON body for `POST /exchange`. User-signed actions carry neither
 * `vaultAddress` nor `expiresAfter` (the exchange rejects both there), and
 * their nonce must equal the action's own `time` / `nonce`.
 */
export function buildExchangeRequest(input: {
  readonly action: L1Action | UserSignedAction;
  readonly nonce: number;
  readonly signature: ExchangeSignature | string;
  readonly vaultAddress?: string | null;
  readonly expiresAfter?: number | null;
}): ExchangeRequest {
  if (!Number.isSafeInteger(input.nonce) || input.nonce <= 0) throw new HyperCoreSigningError("nonce must be a positive integer (ms).");
  const signature = typeof input.signature === "string" ? splitSignature(input.signature) : splitSignature(`${input.signature.r}${input.signature.s.slice(2)}${input.signature.v.toString(16)}`);
  if (isUserSignedAction(input.action)) {
    if (input.vaultAddress) throw new HyperCoreSigningError("User-signed actions do not take a vaultAddress.");
    if (input.expiresAfter !== undefined && input.expiresAfter !== null) throw new HyperCoreSigningError("User-signed actions do not support expiresAfter.");
    const own = "time" in input.action ? input.action.time : input.action.nonce;
    if (own !== input.nonce) throw new HyperCoreSigningError("The request nonce must equal the action's time / nonce.");
    return { action: input.action, nonce: input.nonce, signature };
  }
  const vault = input.vaultAddress ?? null;
  if (vault !== null && !isEvmAddress(vault)) throw new HyperCoreSigningError(`vaultAddress ${vault} is not an address.`);
  const expires = input.expiresAfter ?? null;
  if (expires !== null && (!Number.isSafeInteger(expires) || expires <= 0)) throw new HyperCoreSigningError("expiresAfter must be a positive integer (ms).");
  return {
    action: input.action,
    nonce: input.nonce,
    signature,
    ...(vault !== null ? { vaultAddress: vault.toLowerCase() } : {}),
    ...(expires !== null ? { expiresAfter: expires } : {}),
  };
}
