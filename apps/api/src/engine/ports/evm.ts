/**
 * The EVM reads the engine needs, behind one port so adapters and the
 * verifier run against fakes in tests. The production implementation talks
 * raw JSON-RPC through the shared viem clients (ctx.chains): Nitro deposit
 * and retryable transactions (types 0x64, 0x68, 0x69) are read without any
 * client-side formatting, and Nitro header fields (sendCount, sendRoot,
 * l1BlockNumber) are kept.
 *
 * Unknown is never zero: a failed read throws; "not found" is a value.
 */
import type { NetworkKey } from "@elyia/core";
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type DecodeFunctionResultReturnType, type Hex } from "viem";
import type { EvmChains } from "../../chains/evm.js";
import type { Clock } from "../../clock.js";

export interface EvmLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint | null;
  readonly transactionHash: Hex | null;
  readonly logIndex: number | null;
}

export type TxObservation =
  | { readonly state: "not_found" }
  | { readonly state: "pending" }
  | {
      readonly state: "landed";
      readonly hash: Hex;
      readonly status: "success" | "reverted";
      readonly from: Address;
      readonly to: Address | null;
      readonly input: Hex;
      readonly value: bigint;
      readonly chainId: number | null;
      readonly nonce: number | null;
      readonly type: string;
      readonly blockNumber: bigint;
      /** Unix seconds; null when the block could not be read (callers fail closed). */
      readonly blockTimestamp: number | null;
      readonly logs: readonly EvmLog[];
    };

export interface EvmBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly timestamp: number;
  readonly baseFeePerGas: bigint | null;
  /** Nitro: L2->L1 messages sent up to this block, and their Merkle root. */
  readonly sendCount: bigint | null;
  readonly sendRoot: Hex | null;
  readonly l1BlockNumber: bigint | null;
}

export interface CallRequest {
  readonly from?: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value?: bigint;
  /** Native balances to pretend for the call (state override). */
  readonly balances?: Readonly<Record<string, bigint>>;
}

export type CallResult = { readonly ok: true; readonly data: Hex } | { readonly ok: false; readonly revertData: Hex | null; readonly message: string };

export interface SimulatedCall {
  readonly status: "success" | "reverted";
  readonly returnData: Hex;
  readonly gasUsed: bigint;
  readonly logs: readonly EvmLog[];
  readonly error?: string;
}

export interface SimulationRequest {
  readonly calls: readonly { readonly from: Address; readonly to: Address; readonly data: Hex; readonly value?: bigint }[];
  /** Native balances (state override). */
  readonly balances?: Readonly<Record<string, bigint>>;
  /** Storage overrides per contract (`stateDiff`), e.g. an ERC-20 balance slot. */
  readonly storage?: Readonly<Record<string, Readonly<Record<Hex, Hex>>>>;
}

export interface LogFilter {
  readonly address?: Address | readonly Address[];
  readonly topics?: readonly (Hex | readonly Hex[] | null)[];
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

export interface EvmPort {
  observeTransaction(network: NetworkKey, hash: Hex): Promise<TxObservation>;
  call(network: NetworkKey, request: CallRequest): Promise<CallResult>;
  read<const abi extends Abi, name extends ContractFunctionName<abi, "pure" | "view">>(
    network: NetworkKey,
    request: { readonly address: Address; readonly abi: abi; readonly functionName: name; readonly args?: ContractFunctionArgs<abi, "pure" | "view", name> },
  ): Promise<DecodeFunctionResultReturnType<abi, name>>;
  estimateGas(network: NetworkKey, request: CallRequest & { readonly from: Address }): Promise<bigint>;
  /** eth_simulateV1; null when the network's RPC does not offer it. */
  simulate(network: NetworkKey, request: SimulationRequest): Promise<SimulatedCall[] | null>;
  getBalance(network: NetworkKey, address: Address, block?: bigint): Promise<bigint>;
  getBlock(network: NetworkKey, block: bigint | "latest" | Hex): Promise<EvmBlock | null>;
  getLogs(network: NetworkKey, filter: LogFilter): Promise<EvmLog[]>;
  gasPrice(network: NetworkKey): Promise<bigint>;
  getStorageAt(network: NetworkKey, address: Address, slot: Hex): Promise<Hex>;
  getCode(network: NetworkKey, address: Address): Promise<Hex>;
}

/* ------------------------------------------------------------ JSON-RPC */

type RawRequest = (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;

const hexOf = (value: bigint): Hex => `0x${value.toString(16)}`;

function bigintOf(value: unknown): bigint | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/u.test(value) ? BigInt(value) : null;
}

function numberOf(value: unknown): number | null {
  const big = bigintOf(value);
  return big === null ? null : Number(big);
}

function addressOf(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value) ? (value.toLowerCase() as Address) : null;
}

function hexValue(value: unknown): Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value) ? (value.toLowerCase() as Hex) : "0x";
}

function logOf(raw: Record<string, unknown>): EvmLog {
  return {
    address: addressOf(raw.address) ?? "0x0000000000000000000000000000000000000000",
    topics: Array.isArray(raw.topics) ? raw.topics.map((topic) => hexValue(topic)) : [],
    data: hexValue(raw.data),
    blockNumber: bigintOf(raw.blockNumber),
    transactionHash: typeof raw.transactionHash === "string" ? (raw.transactionHash.toLowerCase() as Hex) : null,
    logIndex: numberOf(raw.logIndex),
  };
}

function overrides(balances?: Readonly<Record<string, bigint>>, storage?: SimulationRequest["storage"]): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [address, balance] of Object.entries(balances ?? {})) out[address.toLowerCase()] = { balance: hexOf(balance) };
  for (const [address, slots] of Object.entries(storage ?? {})) out[address.toLowerCase()] = { ...(out[address.toLowerCase()] ?? {}), stateDiff: { ...slots } };
  return Object.keys(out).length > 0 ? out : undefined;
}

function rpcMessage(error: unknown): { readonly message: string; readonly data: Hex | null; readonly code: number | null } {
  const record = error as { details?: unknown; shortMessage?: unknown; message?: unknown; data?: unknown; code?: unknown; cause?: unknown } | null;
  const cause = record?.cause as { data?: unknown; code?: unknown; message?: unknown } | undefined;
  const data = typeof record?.data === "string" ? record.data : typeof cause?.data === "string" ? cause.data : null;
  const code = typeof record?.code === "number" ? record.code : typeof cause?.code === "number" ? cause.code : null;
  const message = typeof record?.details === "string" ? record.details : typeof record?.shortMessage === "string" ? record.shortMessage : String(record?.message ?? error);
  return { message, data: data && /^0x[0-9a-fA-F]*$/u.test(data) ? (data as Hex) : null, code };
}

/** JSON-RPC "execution reverted" (code 3 or the message), as opposed to a transport or rate-limit failure. */
export function isRevertError(error: unknown): boolean {
  const { message, code } = rpcMessage(error);
  return code === 3 || /execution reverted|revert/iu.test(message);
}

function isMethodMissing(error: unknown): boolean {
  const { message, code } = rpcMessage(error);
  return code === -32601 || /does not exist|not available|method not found|not supported/iu.test(message);
}

const BLOCK_TIME_CACHE = 2_000;
const GAS_PRICE_TTL_MS = 10_000;

/** The production port over the shared viem clients. */
export class ChainsEvmPort implements EvmPort {
  private readonly blockTimes = new Map<string, number>();
  private readonly gasPrices = new Map<NetworkKey, { readonly value: bigint; readonly at: number }>();
  private readonly simulateMissing = new Set<NetworkKey>();

  constructor(
    private readonly chains: EvmChains,
    private readonly clock: Clock,
  ) {}

  private raw(network: NetworkKey): RawRequest {
    return this.chains.client(network).request as unknown as RawRequest;
  }

  async observeTransaction(network: NetworkKey, hash: Hex): Promise<TxObservation> {
    const request = this.raw(network);
    const receipt = (await request({ method: "eth_getTransactionReceipt", params: [hash] })) as Record<string, unknown> | null;
    if (!receipt) {
      const tx = (await request({ method: "eth_getTransactionByHash", params: [hash] })) as Record<string, unknown> | null;
      return tx ? { state: "pending" } : { state: "not_found" };
    }
    const tx = (await request({ method: "eth_getTransactionByHash", params: [hash] })) as Record<string, unknown> | null;
    if (!tx) return { state: "pending" };
    const blockNumber = bigintOf(receipt.blockNumber);
    if (blockNumber === null) return { state: "pending" };
    return {
      state: "landed",
      hash: hash.toLowerCase() as Hex,
      status: bigintOf(receipt.status) === 1n ? "success" : "reverted",
      from: addressOf(tx.from) ?? "0x0000000000000000000000000000000000000000",
      to: addressOf(tx.to),
      input: hexValue(tx.input),
      value: bigintOf(tx.value) ?? 0n,
      chainId: numberOf(tx.chainId),
      nonce: numberOf(tx.nonce),
      type: typeof tx.type === "string" ? tx.type : "0x0",
      blockNumber,
      blockTimestamp: await this.blockTimestamp(network, blockNumber).catch(() => null),
      logs: Array.isArray(receipt.logs) ? (receipt.logs as Record<string, unknown>[]).map(logOf) : [],
    };
  }

  private async blockTimestamp(network: NetworkKey, number: bigint): Promise<number | null> {
    const key = `${network}:${number}`;
    const cached = this.blockTimes.get(key);
    if (cached !== undefined) return cached;
    const block = await this.getBlock(network, number);
    if (!block) return null;
    this.blockTimes.set(key, block.timestamp);
    if (this.blockTimes.size > BLOCK_TIME_CACHE) {
      const oldest = this.blockTimes.keys().next().value;
      if (oldest !== undefined) this.blockTimes.delete(oldest);
    }
    return block.timestamp;
  }

  async call(network: NetworkKey, request: CallRequest): Promise<CallResult> {
    const params: unknown[] = [
      { ...(request.from ? { from: request.from } : {}), to: request.to, data: request.data, ...(request.value ? { value: hexOf(request.value) } : {}) },
      "latest",
    ];
    const state = overrides(request.balances);
    if (state) params.push(state);
    try {
      return { ok: true, data: hexValue(await this.raw(network)({ method: "eth_call", params })) };
    } catch (error) {
      if (!isRevertError(error)) throw error;
      const { message, data } = rpcMessage(error);
      return { ok: false, revertData: data, message: message.slice(0, 200) };
    }
  }

  async read<const abi extends Abi, name extends ContractFunctionName<abi, "pure" | "view">>(
    network: NetworkKey,
    request: { readonly address: Address; readonly abi: abi; readonly functionName: name; readonly args?: ContractFunctionArgs<abi, "pure" | "view", name> },
  ): Promise<DecodeFunctionResultReturnType<abi, name>> {
    const data = encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args } as never);
    const result = await this.call(network, { to: request.address, data });
    if (!result.ok) throw new Error(`${request.functionName} reverted on ${network}: ${result.message}`);
    return decodeFunctionResult({ abi: request.abi, functionName: request.functionName, data: result.data } as never) as DecodeFunctionResultReturnType<abi, name>;
  }

  async estimateGas(network: NetworkKey, request: CallRequest & { readonly from: Address }): Promise<bigint> {
    const params: unknown[] = [{ from: request.from, to: request.to, data: request.data, ...(request.value ? { value: hexOf(request.value) } : {}) }];
    const result = await this.raw(network)({ method: "eth_estimateGas", params });
    const gas = bigintOf(result);
    if (gas === null) throw new Error("eth_estimateGas returned no number.");
    return gas;
  }

  async simulate(network: NetworkKey, request: SimulationRequest): Promise<SimulatedCall[] | null> {
    if (this.simulateMissing.has(network)) return null;
    const state = overrides(request.balances, request.storage);
    const params = [
      {
        blockStateCalls: [
          {
            ...(state ? { stateOverrides: state } : {}),
            calls: request.calls.map((call) => ({ from: call.from, to: call.to, data: call.data, ...(call.value ? { value: hexOf(call.value) } : {}) })),
          },
        ],
        validation: false,
      },
      "latest",
    ];
    let result: unknown;
    try {
      result = await this.raw(network)({ method: "eth_simulateV1", params });
    } catch (error) {
      if (isMethodMissing(error)) {
        this.simulateMissing.add(network);
        return null;
      }
      throw error;
    }
    const block = Array.isArray(result) ? (result[0] as { calls?: unknown } | undefined) : undefined;
    const calls = Array.isArray(block?.calls) ? (block.calls as Record<string, unknown>[]) : [];
    return calls.map((call) => {
      const error = call.error as { message?: unknown } | undefined;
      return {
        status: bigintOf(call.status) === 1n ? ("success" as const) : ("reverted" as const),
        returnData: hexValue(call.returnData),
        gasUsed: bigintOf(call.gasUsed) ?? 0n,
        logs: Array.isArray(call.logs) ? (call.logs as Record<string, unknown>[]).map(logOf) : [],
        ...(error && typeof error.message === "string" ? { error: error.message.slice(0, 200) } : {}),
      };
    });
  }

  async getBalance(network: NetworkKey, address: Address, block?: bigint): Promise<bigint> {
    const result = await this.raw(network)({ method: "eth_getBalance", params: [address, block === undefined ? "latest" : hexOf(block)] });
    const balance = bigintOf(result);
    if (balance === null) throw new Error("eth_getBalance returned no number.");
    return balance;
  }

  async getBlock(network: NetworkKey, block: bigint | "latest" | Hex): Promise<EvmBlock | null> {
    const byHash = typeof block === "string" && block.length === 66;
    const raw = (await this.raw(network)({
      method: byHash ? "eth_getBlockByHash" : "eth_getBlockByNumber",
      params: [typeof block === "bigint" ? hexOf(block) : block, false],
    })) as Record<string, unknown> | null;
    if (!raw) return null;
    const number = bigintOf(raw.number);
    const timestamp = numberOf(raw.timestamp);
    if (number === null || timestamp === null || typeof raw.hash !== "string") return null;
    return {
      number,
      hash: raw.hash.toLowerCase() as Hex,
      timestamp,
      baseFeePerGas: bigintOf(raw.baseFeePerGas),
      sendCount: bigintOf(raw.sendCount),
      sendRoot: typeof raw.sendRoot === "string" ? (raw.sendRoot.toLowerCase() as Hex) : null,
      l1BlockNumber: bigintOf(raw.l1BlockNumber),
    };
  }

  async getLogs(network: NetworkKey, filter: LogFilter): Promise<EvmLog[]> {
    const params = [
      {
        ...(filter.address ? { address: filter.address } : {}),
        ...(filter.topics ? { topics: filter.topics } : {}),
        fromBlock: hexOf(filter.fromBlock),
        toBlock: hexOf(filter.toBlock),
      },
    ];
    const result = await this.raw(network)({ method: "eth_getLogs", params });
    return Array.isArray(result) ? (result as Record<string, unknown>[]).map(logOf) : [];
  }

  async gasPrice(network: NetworkKey): Promise<bigint> {
    const now = this.clock.now();
    const cached = this.gasPrices.get(network);
    if (cached && now - cached.at < GAS_PRICE_TTL_MS) return cached.value;
    const value = bigintOf(await this.raw(network)({ method: "eth_gasPrice", params: [] }));
    if (value === null) throw new Error("eth_gasPrice returned no number.");
    this.gasPrices.set(network, { value, at: now });
    return value;
  }

  async getStorageAt(network: NetworkKey, address: Address, slot: Hex): Promise<Hex> {
    return hexValue(await this.raw(network)({ method: "eth_getStorageAt", params: [address, slot, "latest"] }));
  }

  async getCode(network: NetworkKey, address: Address): Promise<Hex> {
    return hexValue(await this.raw(network)({ method: "eth_getCode", params: [address, "latest"] }));
  }
}
