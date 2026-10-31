/**
 * Engine test fakes: a programmable EVM port (reads answered by
 * `address:function` handlers, receipts by hash), a HyperCore info port with
 * small fixed books, and EngineDeps built from them. Not a test file.
 */
import type { NetworkKey } from "@elyia/core";
import { encodeAbiParameters, keccak256, numberToHex, pad, toHex, type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type DecodeFunctionResultReturnType, type Hex } from "viem";
import { ManualClock } from "../../clock.js";
import { createLogger } from "../../log.js";
import type { ClearinghouseState, ExtraAgent, PerpMeta, SpotMeta } from "../../hyperliquid/types.js";
import { NonceSource, type EngineDeps } from "../deps.js";
import type { CallRequest, CallResult, EvmBlock, EvmLog, EvmPort, LogFilter, SimulatedCall, SimulationRequest, TxObservation } from "../ports/evm.js";
import type { HyperCorePort } from "../ports/hypercore.js";
import { ReferencePrices } from "../prices.js";
import { NETWORKS } from "@elyia/core";

export const OWNER = "0x00000000000000000000000000000000000e1a1a" as Address;
export const OTHER = "0xe49d0d8cf01ea366d804cc84738a768f0b8b175e" as Address;

type ReadHandler = (args: readonly unknown[]) => unknown;

export class FakeEvm implements EvmPort {
  readonly reads = new Map<string, ReadHandler>();
  readonly txs = new Map<string, TxObservation>();
  readonly balances = new Map<string, bigint>();
  readonly readLog: string[] = [];
  callHandler: (network: NetworkKey, request: CallRequest) => CallResult = () => ({ ok: false, revertData: null, message: "no fake call" });
  simulateHandler: (network: NetworkKey, request: SimulationRequest) => SimulatedCall[] | null = () => null;
  logsHandler: (network: NetworkKey, filter: LogFilter) => EvmLog[] = () => [];
  storage = new Map<string, Hex>();
  readonly codes = new Map<string, Hex>();
  /** Blocks by hash (Nitro headers with sendCount). */
  readonly blocks = new Map<string, EvmBlock>();
  gas = 100_000_000n;
  head = 1_000n;
  headTime = 1_800_000_000;

  /** Answers `functionName` on `address` (`*` = any address). */
  on(address: string, functionName: string, handler: ReadHandler | unknown): this {
    this.reads.set(`${address.toLowerCase()}:${functionName}`, typeof handler === "function" ? (handler as ReadHandler) : () => handler);
    return this;
  }

  observeTransaction(_network: NetworkKey, hash: Hex): Promise<TxObservation> {
    return Promise.resolve(this.txs.get(hash.toLowerCase()) ?? { state: "not_found" });
  }
  call(network: NetworkKey, request: CallRequest): Promise<CallResult> {
    return Promise.resolve(this.callHandler(network, request));
  }
  read<const abi extends Abi, name extends ContractFunctionName<abi, "pure" | "view">>(
    _network: NetworkKey,
    request: { readonly address: Address; readonly abi: abi; readonly functionName: name; readonly args?: ContractFunctionArgs<abi, "pure" | "view", name> },
  ): Promise<DecodeFunctionResultReturnType<abi, name>> {
    const key = `${request.address.toLowerCase()}:${request.functionName}`;
    this.readLog.push(key);
    const handler = this.reads.get(key) ?? this.reads.get(`*:${request.functionName}`);
    if (!handler) return Promise.reject(new Error(`unexpected read ${key}`));
    try {
      return Promise.resolve(handler((request.args ?? []) as readonly unknown[]) as DecodeFunctionResultReturnType<abi, name>);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(100_000n);
  }
  simulate(network: NetworkKey, request: SimulationRequest): Promise<SimulatedCall[] | null> {
    return Promise.resolve(this.simulateHandler(network, request));
  }
  getBalance(_network: NetworkKey, address: Address): Promise<bigint> {
    return Promise.resolve(this.balances.get(address.toLowerCase()) ?? 0n);
  }
  getBlock(_network: NetworkKey, block: bigint | "latest" | Hex): Promise<EvmBlock | null> {
    if (typeof block === "string" && block.length === 66) return Promise.resolve(this.blocks.get(block.toLowerCase()) ?? null);
    const number = typeof block === "bigint" ? block : this.head;
    return Promise.resolve({ number, hash: pad(numberToHex(number), { size: 32 }), timestamp: this.headTime, baseFeePerGas: this.gas, sendCount: null, sendRoot: null, l1BlockNumber: null });
  }
  getLogs(network: NetworkKey, filter: LogFilter): Promise<EvmLog[]> {
    return Promise.resolve(this.logsHandler(network, filter));
  }
  gasPrice(): Promise<bigint> {
    return Promise.resolve(this.gas);
  }
  getStorageAt(_network: NetworkKey, address: Address, slot: Hex): Promise<Hex> {
    return Promise.resolve(this.storage.get(`${address.toLowerCase()}:${slot}`) ?? pad("0x0", { size: 32 }));
  }
  getCode(_network: NetworkKey, address: Address): Promise<Hex> {
    return Promise.resolve(this.codes.get(address.toLowerCase()) ?? "0x");
  }

  /** Records a landed transaction (the receipt a wallet broadcast would produce). */
  land(network: NetworkKey, tx: { readonly hash?: Hex; readonly to: Address; readonly data: Hex; readonly value?: bigint; readonly logs?: readonly EvmLog[]; readonly status?: "success" | "reverted"; readonly from?: Address }): Hex {
    const hash = (tx.hash ?? keccak256(toHex(`${tx.to}:${tx.data}:${this.txs.size}`))).toLowerCase() as Hex;
    this.txs.set(hash, {
      state: "landed",
      hash,
      status: tx.status ?? "success",
      from: (tx.from ?? OWNER).toLowerCase() as Address,
      to: tx.to.toLowerCase() as Address,
      input: tx.data,
      value: tx.value ?? 0n,
      chainId: (NETWORKS[network] as { chainId?: number }).chainId ?? null,
      nonce: this.txs.size,
      type: "0x2",
      blockNumber: this.head,
      blockTimestamp: this.headTime,
      logs: (tx.logs ?? []).map((log, index) => ({ ...log, transactionHash: hash, blockNumber: this.head, logIndex: index })),
    });
    return hash;
  }
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
const word = (address: string): Hex => pad(address.toLowerCase() as Hex, { size: 32 });

export function transferLog(token: string, from: string, to: string, amount: bigint): EvmLog {
  return { address: token.toLowerCase() as Address, topics: [TRANSFER, word(from), word(to)], data: pad(numberToHex(amount), { size: 32 }), blockNumber: null, transactionHash: null, logIndex: null };
}

export function rawLog(address: string, topics: readonly Hex[], data: Hex): EvmLog {
  return { address: address.toLowerCase() as Address, topics, data, blockNumber: null, transactionHash: null, logIndex: null };
}

export function abiWords(types: readonly string[], values: readonly unknown[]): Hex {
  return encodeAbiParameters(types.map((type) => ({ type })), values);
}

export const PERP_META: PerpMeta = { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }, { name: "HYPE", szDecimals: 2, maxLeverage: 10 }] };

export const SPOT_META: SpotMeta = {
  universe: [{ name: "@107", tokens: [150, 0], index: 107, isCanonical: false }],
  tokens: [
    { name: "USDC", szDecimals: 8, weiDecimals: 8, index: 0, tokenId: "0x6d1e7cde53ba9467b783cb7c530ce054", isCanonical: true, evmContract: null, fullName: null },
    { name: "HYPE", szDecimals: 2, weiDecimals: 8, index: 150, tokenId: "0x7317beb7cceed72ef0b346074cc8e7ab", isCanonical: false, evmContract: null, fullName: "Hyperliquid" },
  ],
};

export class FakeCore implements HyperCorePort {
  mids: Record<string, string> = { BTC: "100000", ETH: "4000", HYPE: "40", "@107": "40" };
  agents: ExtraAgent[] = [];
  meta() {
    return Promise.resolve(PERP_META);
  }
  spotMeta() {
    return Promise.resolve(SPOT_META);
  }
  allMids() {
    return Promise.resolve(this.mids);
  }
  orderStatus(): Promise<never> {
    return Promise.reject(new Error("unexpected orderStatus"));
  }
  userFillsByTime() {
    return Promise.resolve([]);
  }
  ledger() {
    return Promise.resolve([]);
  }
  extraAgents() {
    return Promise.resolve(this.agents);
  }
  clearinghouseState() {
    const summary = { accountValue: "1000", totalNtlPos: "0", totalRawUsd: "1000", totalMarginUsed: "0" };
    return Promise.resolve({ marginSummary: summary, crossMarginSummary: summary, crossMaintenanceMarginUsed: "0", withdrawable: "1000", assetPositions: [], time: 0 } as unknown as ClearinghouseState);
  }
  spotClearinghouseState(): Promise<never> {
    return Promise.reject(new Error("unexpected spotClearinghouseState"));
  }
  frontendOpenOrders() {
    return Promise.resolve([]);
  }
  /** Configured leverage per coin (activeAssetData); unknown coins reject (the Rule Book fails closed). */
  leverage: Record<string, number> = {};
  activeAssetData(_network: NetworkKey, _user: string, coin: string) {
    const value = this.leverage[coin];
    return value === undefined ? Promise.reject(new Error(`no leverage for ${coin}`)) : Promise.resolve({ leverage: { type: "cross", value } } as never);
  }
}

export interface Fixture {
  readonly evm: FakeEvm;
  readonly core: FakeCore;
  readonly clock: ManualClock;
  readonly deps: EngineDeps;
}

let counter = 0;

export function fixture(): Fixture {
  const evm = new FakeEvm();
  const core = new FakeCore();
  const clock = new ManualClock(1_800_000_000_000);
  evm.headTime = Math.floor(clock.now() / 1000) + 5;
  const seed = ++counter;
  const random = { getRandomValues: (array: Uint8Array) => array.map((_, index) => (index * 31 + seed) % 256) as Uint8Array };
  const deps: EngineDeps = {
    evm,
    core,
    prices: new ReferencePrices(core, clock),
    clock,
    log: createLogger({ level: "silent" }),
    networks: NETWORKS,
    nonces: new NonceSource(clock),
    random,
  };
  return { evm, core, clock, deps };
}

/** Storage key of `holder`'s balance in a mapping at `slot` (Solidity layout). */
export function balanceKey(holder: Address, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));
}
