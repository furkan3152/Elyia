/**
 * Shared EVM building blocks for adapters: request construction, exact
 * approvals, balance checks, fee estimates and simulation with an ERC-20
 * balance override (the balance slot is discovered on-chain once per token).
 */
import { assessToken, getEvmNetwork, type EvmTransactionRequest, type NetworkKey } from "@elyia/core";
import { encodeAbiParameters, encodeFunctionData, keccak256, maxUint256, numberToHex, pad, type Address, type Hex } from "viem";
import { erc20Abi } from "../abis.js";
import type { ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { ReferencePrices } from "../prices.js";
import type { SimulatedCall, SimulationRequest } from "../ports/evm.js";

/** Router deadlines: payload expiry plus this grace (the on-chain minimum output is the real guard). */
export const DEADLINE_GRACE_SECONDS = 300;
/** Highest slippage a DEX step may encode, whatever was asked. */
export const MAX_DEX_SLIPPAGE_BPS = 300;
/** Gas units per operation for plan-time fee estimates (Elysium measured: a HYPE transfer is about 21,140). */
export const GAS = Object.freeze({
  transfer: 21_140n,
  erc20Transfer: 65_000n,
  approve: 60_000n,
  wrap: 58_000n,
  unwrap: 48_000n,
  v3Swap: 160_000n,
  v2Swap: 135_000n,
  depositEth: 95_000n,
  gatewayDeposit: 260_000n,
  withdrawEth: 120_000n,
  gatewayWithdraw: 200_000n,
  outboxExecute: 300_000n,
  redeem: 150_000n,
  stake: 285_000n,
  coreDeposit: 120_000n,
  mirrorWallet: 450_000n,
  mirrorRegister: 450_000n,
});

export function evmRequest(network: NetworkKey, from: Address, to: Address, data: Hex, value: bigint, description: string): EvmTransactionRequest {
  return {
    vm: "evm",
    network,
    chainId: getEvmNetwork(network).chainId,
    from: from.toLowerCase() as Address,
    to: to.toLowerCase() as Address,
    data,
    value: value.toString(),
    description,
  };
}

export function deadlineFor(expiresAt: number): bigint {
  return BigInt(expiresAt + DEADLINE_GRACE_SECONDS);
}

export async function allowanceOf(deps: EngineDeps, network: NetworkKey, token: Address, owner: Address, spender: Address): Promise<bigint> {
  return deps.evm.read(network, { address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/**
 * An exact approval of `spender` for `amount`, only when the current
 * allowance is short. `bestEffort` (plan) treats an unreadable allowance as
 * zero; prepare reads strictly.
 */
export async function approvalFor(
  deps: EngineDeps,
  network: NetworkKey,
  input: { readonly token: Address; readonly symbol: string; readonly owner: Address; readonly spender: Address; readonly spenderLabel: string; readonly amount: bigint; readonly bestEffort?: boolean },
): Promise<EvmTransactionRequest | null> {
  const allowance = await allowanceOf(deps, network, input.token, input.owner, input.spender).catch((error: unknown) => {
    if (input.bestEffort) return 0n;
    throw error;
  });
  if (allowance >= input.amount) return null;
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [input.spender, input.amount] });
  return evmRequest(network, input.owner, input.token, data, 0n, `Approve ${input.spenderLabel} to spend exactly this ${input.symbol}`);
}

/** Native or ERC-20 balance of `owner`. */
export async function balanceOf(deps: EngineDeps, asset: ResolvedAsset, owner: Address): Promise<bigint> {
  if (asset.native) return deps.evm.getBalance(asset.network, owner);
  if (!asset.address) throw engineError("STEP_INVALID", `${asset.symbol} has no contract on ${asset.network}.`);
  return deps.evm.read(asset.network, { address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** Refuses (422 INSUFFICIENT_BALANCE) when `owner` holds less than `amount` (+ native value). */
export async function assertBalance(deps: EngineDeps, asset: ResolvedAsset, owner: Address, amount: bigint, nativeValue = 0n): Promise<void> {
  const balance = await balanceOf(deps, asset, owner);
  const needed = asset.native ? amount + nativeValue : amount;
  if (balance < needed) {
    throw engineError("INSUFFICIENT_BALANCE", `The account holds ${balance} base units of ${asset.symbol} on ${asset.network}, less than the ${needed} this step needs.`, {
      network: asset.network,
      asset: asset.id,
      balance: balance.toString(),
      needed: needed.toString(),
    });
  }
  if (!asset.native && nativeValue > 0n) {
    const gas = await deps.evm.getBalance(asset.network, owner);
    if (gas < nativeValue) throw engineError("INSUFFICIENT_GAS", `This step sends ${nativeValue} wei of HYPE with the transaction; the account holds ${gas}.`);
  }
}

/** USD of `gas` units at the network's gas price and the reference HYPE price; null when unknown. */
export async function feesUsd(deps: EngineDeps, network: NetworkKey, gas: bigint): Promise<string | null> {
  try {
    const [price, snapshot] = await Promise.all([deps.evm.gasPrice(network), deps.prices.snapshot()]);
    return ReferencePrices.usdText(gas * price, 18, ReferencePrices.symbolMicros(snapshot, "HYPE"));
  } catch {
    return null;
  }
}

/* --------------------------------------------- simulation with a balance */

const balanceSlots = new Map<string, bigint | null>();
/** OpenZeppelin v5 ERC20Upgradeable namespace (ERC-7201 "openzeppelin.storage.ERC20"). */
const OZ5_ERC20_SLOT = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
const CANDIDATE_SLOTS: readonly bigint[] = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 51n, 52n, 101n, 151n, 201n, OZ5_ERC20_SLOT];

export function mappingSlot(holder: Address, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));
}

/**
 * The storage slot of `token`'s balance mapping, found by matching
 * `balanceOf(holder)` against the candidate slots (holder must hold some).
 * Cached per token; null when no candidate matches.
 */
export async function balanceMappingSlot(deps: EngineDeps, network: NetworkKey, token: Address, holder: Address): Promise<bigint | null> {
  const key = `${network}:${token.toLowerCase()}`;
  if (balanceSlots.has(key)) return balanceSlots.get(key) ?? null;
  // Two passes: a busy holder (a pool) can trade between the balance read and the storage reads.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const balance = await deps.evm.read(network, { address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
    if (balance === 0n) return null;
    const expected = pad(numberToHex(balance), { size: 32 });
    for (const slot of CANDIDATE_SLOTS) {
      const value = await deps.evm.getStorageAt(network, token, mappingSlot(holder, slot));
      if (value.toLowerCase() === expected.toLowerCase()) {
        balanceSlots.set(key, slot);
        return slot;
      }
    }
  }
  balanceSlots.set(key, null);
  return null;
}

/**
 * eth_simulateV1 of `calls` as `from`, giving it `nativeBalance` and, when
 * `erc20` is set, that token balance (through the discovered balance slot,
 * with `erc20.holder` as the discovery reference). Null when the network
 * cannot simulate or the slot is unknown.
 */
export async function simulateWithFunds(
  deps: EngineDeps,
  network: NetworkKey,
  input: {
    readonly from: Address;
    readonly calls: SimulationRequest["calls"];
    readonly nativeBalance?: bigint;
    readonly erc20?: { readonly token: Address; readonly amount: bigint; readonly holder: Address };
  },
): Promise<SimulatedCall[] | null> {
  const storage: Record<string, Record<Hex, Hex>> = {};
  if (input.erc20) {
    const slot = await balanceMappingSlot(deps, network, input.erc20.token, input.erc20.holder).catch(() => null);
    if (slot === null) return null;
    storage[input.erc20.token.toLowerCase()] = { [mappingSlot(input.from, slot)]: pad(numberToHex(input.erc20.amount), { size: 32 }) };
  }
  return deps.evm.simulate(network, {
    calls: input.calls,
    balances: { [input.from.toLowerCase()]: input.nativeBalance ?? 10n ** 24n },
    ...(Object.keys(storage).length > 0 ? { storage } : {}),
  });
}

export function approveCall(spender: Address, amount: bigint = maxUint256): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

/**
 * Trust check of the tokens a step touches. Unverified tokens only reach an
 * adapter when the request named the venue (the planner resolves unlisted
 * addresses only then); each gets a warning. A token whose symbol or name
 * imitates a registry token (look-alike WHYPE / USDC / kHYPE) is refused:
 * look-alikes are warnings, never routable tokens.
 */
export function tokenTrustWarnings(assets: readonly ResolvedAsset[]): string[] {
  const warnings: string[] = [];
  for (const asset of assets) {
    if (asset.verified || asset.native || !asset.address) continue;
    const trust = assessToken({ network: asset.network, address: asset.address, symbol: asset.symbol });
    if (trust.status !== "verified" && trust.flagged) {
      // Registry FLAGGED_TOKENS (look-alike WHYPE / USDC / kHYPE, impersonations): never routable.
      throw engineError("TOKEN_LOOKALIKE", trust.warning, { network: asset.network, address: asset.address, flagged: trust.flagged.reason });
    }
    if (trust.status === "lookalike") {
      throw engineError("TOKEN_LOOKALIKE", trust.warning, { network: asset.network, address: asset.address, lookalikeOf: trust.lookalikeOf.id });
    }
    if (trust.status === "unverified") warnings.push(`${asset.symbol} (${asset.address}): ${trust.warning}`);
  }
  return warnings;
}
