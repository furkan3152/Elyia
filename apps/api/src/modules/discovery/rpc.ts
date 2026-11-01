/**
 * The chain reads discovery needs, behind one small port (fakes in tests):
 * head, bytecode sizes in batches, address-filtered logs, storage, raw calls
 * and ERC-20 metadata. The live implementation goes through the shared viem
 * clients (`ctx.chains`), so every read uses the configured RPC fallbacks.
 *
 * Bytecode sizes are read for up to CODE_SIZE_BATCH addresses per request
 * with a deployless `eth_call` (no `to`): 40 bytes of init code copy the
 * appended address words to memory, replace each with EXTCODESIZE and return
 * them. One request instead of one eth_getCode per address, and only 32
 * bytes per contract instead of its whole bytecode.
 */
import type { NetworkKey } from "@elyia/core";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import type { EvmChains } from "../../chains/evm.js";

/** Addresses per deployless EXTCODESIZE call (returned data stays far below the 24 KB code limit). */
export const CODE_SIZE_BATCH = 150;
/** Addresses per address-filtered eth_getLogs request. */
export const LOG_ADDRESS_BATCH = 100;
/** The public Elysium RPC refuses wider eth_getLogs ranges. */
export const MAX_LOG_BLOCKS = 2_000;

/**
 * PUSH2 0x28 CODESIZE SUB DUP1 PUSH2 0x28 PUSH1 0 CODECOPY PUSH1 0
 * loop: JUMPDEST DUP2 DUP2 LT ISZERO PUSH2 end JUMPI DUP1 MLOAD EXTCODESIZE DUP2 MSTORE PUSH1 32 ADD PUSH2 loop JUMP
 * end: JUMPDEST POP PUSH1 0 RETURN
 */
export const CODE_SIZES_INITCODE: Hex = "0x6100283803806100286000396000"
  + "5b81811015610023578051" + "3b8152602001" + "61000e56" + "5b506000f3" as Hex;

export interface DiscoveryLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: number;
  readonly transactionHash: Hex;
  readonly logIndex: number;
}

export interface TokenMetadata {
  readonly name: string | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly totalSupply: bigint | null;
}

export interface DiscoveryRpc {
  /** A network the server can read (EVM with at least one RPC endpoint). */
  available(network: NetworkKey): boolean;
  head(network: NetworkKey): Promise<number>;
  /** Bytecode size per address, null where the read failed. */
  codeSizes(network: NetworkKey, addresses: readonly string[]): Promise<(number | null)[]>;
  getCode(network: NetworkKey, address: string): Promise<Hex>;
  getStorageAt(network: NetworkKey, address: string, slot: Hex): Promise<Hex>;
  /** Logs of `addresses` in [fromBlock, toBlock] (callers keep the range within MAX_LOG_BLOCKS). */
  logs(network: NetworkKey, filter: { readonly addresses: readonly string[]; readonly fromBlock: number; readonly toBlock: number; readonly topics?: readonly (Hex | readonly Hex[] | null)[] }): Promise<DiscoveryLog[]>;
  /** eth_call; null when it reverts. */
  call(network: NetworkKey, request: { readonly to: string; readonly data: Hex }): Promise<Hex | null>;
  tokenMetadata(network: NetworkKey, address: string): Promise<TokenMetadata>;
}

/** The word-encoded argument tail of the EXTCODESIZE init code. */
export function codeSizesCalldata(addresses: readonly string[]): Hex {
  return `${CODE_SIZES_INITCODE}${addresses.map((address) => address.slice(2).toLowerCase().padStart(64, "0")).join("")}` as Hex;
}

export function decodeCodeSizes(result: Hex, count: number): (number | null)[] {
  const body = result.slice(2);
  return Array.from({ length: count }, (_, index) => {
    const word = body.slice(index * 64, index * 64 + 64);
    return word.length === 64 ? Number(BigInt(`0x${word}`)) : null;
  });
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const ERC20_STRING_BYTES32 = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }, { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }] as const;

/** Printable text of a bytes32 symbol (old ERC-20s). */
function bytes32Text(value: Hex): string | null {
  const text = Buffer.from(value.slice(2), "hex").toString("utf8").replace(/\0+$/u, "");
  return /^[\p{L}\p{N}\p{P}\p{S} ]{1,64}$/u.test(text) ? text : null;
}

/** Clean, bounded on-chain text (token names are attacker-controlled). */
export function cleanTokenText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 64);
  return text.length > 0 ? text : null;
}

export class ViemDiscoveryRpc implements DiscoveryRpc {
  constructor(private readonly chains: EvmChains) {}

  available(network: NetworkKey): boolean {
    return this.chains.isAvailable(network);
  }

  async head(network: NetworkKey): Promise<number> {
    return Number(await this.chains.client(network).getBlockNumber({ cacheTime: 1_000 }));
  }

  async codeSizes(network: NetworkKey, addresses: readonly string[]): Promise<(number | null)[]> {
    const client = this.chains.client(network);
    const out: (number | null)[] = [];
    for (const batch of chunks(addresses, CODE_SIZE_BATCH)) {
      try {
        const { data } = await client.call({ data: codeSizesCalldata(batch) });
        out.push(...(data ? decodeCodeSizes(data, batch.length) : batch.map(() => null)));
      } catch {
        out.push(...batch.map(() => null));
      }
    }
    return out;
  }

  getCode(network: NetworkKey, address: string): Promise<Hex> {
    return this.chains.client(network).getCode({ address: address as Address }).then((code) => code ?? "0x");
  }

  getStorageAt(network: NetworkKey, address: string, slot: Hex): Promise<Hex> {
    return this.chains.client(network).getStorageAt({ address: address as Address, slot }).then((value) => value ?? "0x");
  }

  async logs(network: NetworkKey, filter: Parameters<DiscoveryRpc["logs"]>[1]): Promise<DiscoveryLog[]> {
    if (filter.toBlock - filter.fromBlock + 1 > MAX_LOG_BLOCKS) throw new RangeError(`At most ${MAX_LOG_BLOCKS} blocks per eth_getLogs request.`);
    const client = this.chains.client(network);
    const out: DiscoveryLog[] = [];
    for (const batch of chunks(filter.addresses, LOG_ADDRESS_BATCH)) {
      const params: Record<string, unknown> = {
        address: batch.map((address) => address.toLowerCase()),
        fromBlock: `0x${filter.fromBlock.toString(16)}`,
        toBlock: `0x${filter.toBlock.toString(16)}`,
        ...(filter.topics ? { topics: filter.topics } : {}),
      };
      const logs = (await client.request({ method: "eth_getLogs", params: [params] } as never)) as readonly { address: string; topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex }[];
      for (const log of logs) {
        out.push({ address: log.address.toLowerCase(), topics: log.topics, data: log.data, blockNumber: Number(BigInt(log.blockNumber)), transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)) });
      }
    }
    return out;
  }

  async call(network: NetworkKey, request: { readonly to: string; readonly data: Hex }): Promise<Hex | null> {
    try {
      const { data } = await this.chains.client(network).call({ to: request.to as Address, data: request.data });
      return data ?? "0x";
    } catch {
      return null;
    }
  }

  async tokenMetadata(network: NetworkKey, address: string): Promise<TokenMetadata> {
    const token = address as Address;
    const read = async <T>(functionName: "name" | "symbol" | "decimals" | "totalSupply"): Promise<T | null> => {
      const data = await this.call(network, { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName }) });
      if (!data || data === "0x") return null;
      try {
        return decodeFunctionResult({ abi: erc20Abi, functionName, data }) as T;
      } catch {
        if (functionName === "name" || functionName === "symbol") {
          try {
            return bytes32Text(decodeFunctionResult({ abi: ERC20_STRING_BYTES32, functionName, data })) as T;
          } catch {
            return null;
          }
        }
        return null;
      }
    };
    const [name, symbol, decimals, totalSupply] = await Promise.all([read<string>("name"), read<string>("symbol"), read<number>("decimals"), read<bigint>("totalSupply")]);
    return {
      name: cleanTokenText(name),
      symbol: cleanTokenText(symbol),
      decimals: typeof decimals === "number" && decimals >= 0 && decimals <= 77 ? decimals : null,
      totalSupply: typeof totalSupply === "bigint" ? totalSupply : null,
    };
  }
}
