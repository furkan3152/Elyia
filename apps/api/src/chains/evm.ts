/**
 * viem public clients per EVM network of the (config-extended) core registry.
 *
 * - Chains are defined with `defineChain` from the registry (Elysium 99801 /
 *   99901 are not viem's `elysiumTestnet`, which is an unrelated chain 1338).
 * - Transport: viem `fallback` across the network's rpcUrls (overrides first),
 *   each with a timeout and its own retry count.
 * - Reads made in the same tick are batched through Multicall3 when the
 *   registry lists one for the network.
 * - A network without any RPC endpoint (Elysium mainnet before launch, unless
 *   ELYSIUM_MAINNET_RPC_URL is set) answers 503 NETWORK_UNAVAILABLE; a
 *   HyperCore key answers 400 NETWORK_NOT_SUPPORTED. Neither ever crashes.
 */
import { ARB_SYS, type EvmNetwork, type Network, type NetworkKey } from "@elyia/core";
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  fallback,
  http,
  isAddress,
  parseAbi,
  TransactionReceiptNotFoundError,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
} from "viem";
import { ElyiaHttpError, networkUnavailable } from "../http/errors.js";

/** Multicall3 helpers read alongside token balances (viem's bundled multicall3 ABI lacks getBlockNumber). */
export const MULTICALL3_READS_ABI = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);

/**
 * On Nitro chains (Elysium) Solidity's `block.number`, which Multicall3's
 * getBlockNumber returns, is the parent-chain block; the chain's own height
 * comes from the ArbSys precompile.
 */
export const ARBSYS_ABI = parseAbi(["function arbBlockNumber() view returns (uint256)"]);

export const RPC_TIMEOUT_MS = 6_000;
export const RPC_RETRY_COUNT = 1;
export const MAX_BALANCE_TOKENS = 100;

export type NativeToken = "native";
export type BalanceToken = NativeToken | Address;
export type BlockSelector = bigint | number | "latest" | "safe" | "finalized";

export interface TokenBalance {
  readonly token: BalanceToken;
  /** Raw integer balance, or null when that read failed (the others still count). */
  readonly balance: bigint | null;
}

export interface BalancesResult {
  readonly network: NetworkKey;
  readonly owner: Address;
  /** This chain's block the multicall executed at (its own height, also on Nitro chains), when known. */
  readonly blockNumber: bigint | null;
  readonly balances: readonly TokenBalance[];
}

export interface BlockHeader {
  readonly network: NetworkKey;
  readonly number: bigint;
  readonly hash: Hash;
  readonly parentHash: Hash;
  /** Seconds. */
  readonly timestamp: bigint;
  readonly gasUsed: bigint;
  readonly gasLimit: bigint;
  readonly baseFeePerGas: bigint | null;
  /** Every transaction in the block (on Nitro chains this includes the ArbOS internal transaction). */
  readonly transactionCount: number;
  /** Arbitrum Nitro: parent-chain block number recorded in the header (null elsewhere). */
  readonly l1BlockNumber: bigint | null;
}

export function defineEvmChain(network: EvmNetwork): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: { default: { http: [...network.rpcUrls] } },
    ...(network.explorer ? { blockExplorers: { default: { name: network.explorer.name, url: network.explorer.url } } } : {}),
    ...(network.contracts.multicall3 ? { contracts: { multicall3: { address: network.contracts.multicall3 as Address } } } : {}),
    testnet: network.environment === "testnet",
  });
}

export interface EvmChainsOptions {
  readonly timeoutMs?: number;
  readonly retryCount?: number;
  /** Replaces the HTTP fallback transport (tests). */
  readonly transport?: (network: EvmNetwork) => Transport;
}

export class EvmChains {
  private readonly clients = new Map<NetworkKey, PublicClient>();
  private readonly chains = new Map<NetworkKey, Chain>();

  constructor(
    private readonly networks: Readonly<Record<NetworkKey, Network>>,
    private readonly options: EvmChainsOptions = {},
  ) {}

  /** The EVM network, or 400 NETWORK_NOT_SUPPORTED for a HyperCore key. */
  network(key: NetworkKey): EvmNetwork {
    const network = this.networks[key];
    if (!network || network.vm !== "evm") {
      throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${key} is not an EVM network.`, { network: key });
    }
    return network;
  }

  isAvailable(key: NetworkKey): boolean {
    const network = this.networks[key];
    return network?.vm === "evm" && network.rpcUrls.length > 0;
  }

  /** Why a network cannot be read, or null when it can. */
  unavailableReason(key: NetworkKey): string | null {
    const network = this.network(key);
    if (network.rpcUrls.length > 0) return null;
    return network.status === "prelaunch"
      ? "it has not launched publicly and no RPC endpoint is configured"
      : "no RPC endpoint is configured";
  }

  chain(key: NetworkKey): Chain {
    let chain = this.chains.get(key);
    if (!chain) {
      chain = defineEvmChain(this.network(key));
      this.chains.set(key, chain);
    }
    return chain;
  }

  client(key: NetworkKey): PublicClient {
    const existing = this.clients.get(key);
    if (existing) return existing;
    const network = this.network(key);
    const reason = this.unavailableReason(key);
    if (reason) throw networkUnavailable(network.name, reason);
    const chain = this.chain(key);
    const transport =
      this.options.transport?.(network) ??
      fallback(
        network.rpcUrls.map((url) => http(url, { timeout: this.options.timeoutMs ?? RPC_TIMEOUT_MS, retryCount: this.options.retryCount ?? RPC_RETRY_COUNT })),
        { retryCount: 0 },
      );
    const client = createPublicClient({
      chain,
      transport,
      batch: network.contracts.multicall3 ? { multicall: { wait: 16 } } : undefined,
    }) as PublicClient;
    this.clients.set(key, client);
    return client;
  }

  /**
   * Native and ERC-20 balances of `owner` in one Multicall3 round trip (with
   * the block number it ran at). A failed token read yields `balance: null`
   * for that token only. Without Multicall3 the reads run in parallel.
   */
  async getBalances(key: NetworkKey, owner: string, tokens: readonly BalanceToken[]): Promise<BalancesResult> {
    if (!isAddress(owner, { strict: false })) {
      throw new ElyiaHttpError("INVALID_ADDRESS", 400, "owner must be a 0x-prefixed 20-byte hex address.");
    }
    if (tokens.length > MAX_BALANCE_TOKENS) {
      throw new ElyiaHttpError("INVALID_REQUEST", 400, `At most ${MAX_BALANCE_TOKENS} tokens per balance read.`);
    }
    for (const token of tokens) {
      if (token !== "native" && !isAddress(token, { strict: false })) {
        throw new ElyiaHttpError("INVALID_ADDRESS", 400, "tokens must be \"native\" or 0x-prefixed 20-byte hex addresses.");
      }
    }
    const network = this.network(key);
    const client = this.client(key);
    const account = owner.toLowerCase() as Address;
    const multicall3 = network.contracts.multicall3 as Address | null;

    if (!multicall3) {
      const balances = await Promise.all(
        tokens.map(async (token): Promise<TokenBalance> => {
          try {
            const balance =
              token === "native"
                ? await client.getBalance({ address: account })
                : await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
            return { token, balance };
          } catch {
            return { token, balance: null };
          }
        }),
      );
      return { network: key, owner: account, blockNumber: null, balances };
    }

    const contracts = [
      network.family === "elysium"
        ? ({ address: ARB_SYS as Address, abi: ARBSYS_ABI, functionName: "arbBlockNumber" } as const)
        : ({ address: multicall3, abi: MULTICALL3_READS_ABI, functionName: "getBlockNumber" } as const),
      ...tokens.map((token) =>
        token === "native"
          ? ({ address: multicall3, abi: MULTICALL3_READS_ABI, functionName: "getEthBalance", args: [account] } as const)
          : ({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] } as const),
      ),
    ];
    const results = await client.multicall({ contracts, allowFailure: true, multicallAddress: multicall3 });
    const [head, ...rest] = results;
    return {
      network: key,
      owner: account,
      blockNumber: head?.status === "success" ? (head.result as bigint) : null,
      balances: tokens.map((token, index) => {
        const result = rest[index];
        return { token, balance: result?.status === "success" ? (result.result as bigint) : null };
      }),
    };
  }

  async getBlockHeader(key: NetworkKey, block: BlockSelector = "latest"): Promise<BlockHeader> {
    const client = this.client(key);
    const raw =
      typeof block === "string"
        ? await client.getBlock({ blockTag: block })
        : await client.getBlock({ blockNumber: BigInt(block) });
    if (raw.number === null || raw.hash === null) {
      throw new ElyiaHttpError("NOT_FOUND", 404, "That block is not available yet.");
    }
    const l1 = (raw as { l1BlockNumber?: unknown }).l1BlockNumber;
    return {
      network: key,
      number: raw.number,
      hash: raw.hash,
      parentHash: raw.parentHash,
      timestamp: raw.timestamp,
      gasUsed: raw.gasUsed,
      gasLimit: raw.gasLimit,
      baseFeePerGas: raw.baseFeePerGas ?? null,
      transactionCount: raw.transactions.length,
      l1BlockNumber: typeof l1 === "string" && /^0x[0-9a-f]+$/iu.test(l1) ? BigInt(l1) : typeof l1 === "bigint" ? l1 : null,
    };
  }

  /** The receipt, or null while the transaction is unknown or pending. */
  async getTxReceipt(key: NetworkKey, hash: string): Promise<TransactionReceipt | null> {
    if (!/^0x[0-9a-fA-F]{64}$/u.test(hash)) {
      throw new ElyiaHttpError("INVALID_REQUEST", 400, "hash must be a 0x-prefixed 32-byte hex transaction hash.");
    }
    try {
      return await this.client(key).getTransactionReceipt({ hash: hash as Hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }
}
