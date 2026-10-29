import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEvmNetwork, NETWORKS, type EvmNetwork } from "@elyia/core";
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  type Hex,
  type Transport,
} from "viem";
import { loadConfig } from "../../config.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { ARBSYS_ABI, defineEvmChain, EvmChains, MULTICALL3_READS_ABI } from "../evm.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x7D29d8047B905000459c0E80c34a26CeedcB47b2";
const PURR = "0x5688c9Ca58435Ee982c16cCBE05eAC6993e32Bdd";

interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

/** An EIP-1193 transport answering multicall, block and receipt reads. */
function fakeTransport(calls: RpcCall[], options: { failToken?: string } = {}): Transport {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const list = (params ?? []) as unknown[];
      calls.push({ method, params: list });
      if (method === "eth_chainId") return "0x185d9";
      if (method === "eth_call") {
        const call = list[0] as { to: string; data: Hex };
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
        assert.equal(decoded.functionName, "aggregate3");
        const inner = decoded.args[0] as ReadonlyArray<{ target: string; callData: Hex }>;
        const results = inner.map((entry) => {
          if (options.failToken && entry.target.toLowerCase() === options.failToken.toLowerCase()) {
            return { success: false, returnData: "0x" as Hex };
          }
          if (entry.target.toLowerCase() === "0x0000000000000000000000000000000000000064") {
            const fn = decodeFunctionData({ abi: ARBSYS_ABI, data: entry.callData });
            assert.equal(fn.functionName, "arbBlockNumber");
            return { success: true, returnData: encodeFunctionResult({ abi: ARBSYS_ABI, functionName: "arbBlockNumber", result: 18_000_000n }) };
          }
          if (entry.target.toLowerCase() === call.to.toLowerCase()) {
            const fn = decodeFunctionData({ abi: MULTICALL3_READS_ABI, data: entry.callData });
            if (fn.functionName === "getBlockNumber") {
              return { success: true, returnData: encodeFunctionResult({ abi: MULTICALL3_READS_ABI, functionName: "getBlockNumber", result: 68_000_000n }) };
            }
            assert.equal(fn.functionName, "getEthBalance");
            return { success: true, returnData: encodeFunctionResult({ abi: MULTICALL3_READS_ABI, functionName: "getEthBalance", result: 5n * 10n ** 18n }) };
          }
          const erc = decodeFunctionData({ abi: erc20Abi, data: entry.callData });
          assert.equal(erc.functionName, "balanceOf");
          const balance = entry.target.toLowerCase() === USDC.toLowerCase() ? 1_234_567n : 42n;
          return { success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: balance }) };
        });
        return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
      }
      if (method === "eth_getBlockByNumber") {
        return {
          number: "0x112a880",
          hash: `0x${"ab".repeat(32)}`,
          parentHash: `0x${"cd".repeat(32)}`,
          timestamp: "0x6ae34ada",
          gasUsed: "0x59095",
          gasLimit: "0x4000000000000",
          baseFeePerGas: "0x5f5e100",
          l1BlockNumber: "0x410aaf9",
          transactions: ["0x01", "0x02"],
          logsBloom: `0x${"00".repeat(256)}`,
          miner: "0xa4b000000000000000000073657175656e636572",
          mixHash: `0x${"00".repeat(32)}`,
          nonce: "0x0000000000000000",
          receiptsRoot: `0x${"00".repeat(32)}`,
          sha3Uncles: `0x${"00".repeat(32)}`,
          size: "0x3cb",
          stateRoot: `0x${"00".repeat(32)}`,
          transactionsRoot: `0x${"00".repeat(32)}`,
          difficulty: "0x1",
          extraData: "0x",
          uncles: [],
        };
      }
      if (method === "eth_getTransactionReceipt") return null;
      throw new Error(`unexpected ${method}`);
    },
  }, { retryCount: 0 });
}

describe("defineEvmChain", () => {
  it("defines Elysium testnet from the registry (not viem's unrelated elysiumTestnet)", () => {
    const chain = defineEvmChain(getEvmNetwork("elysium-testnet"));
    assert.equal(chain.id, 99_801);
    assert.equal(chain.nativeCurrency.symbol, "HYPE");
    assert.equal(chain.nativeCurrency.decimals, 18);
    assert.equal(chain.contracts?.multicall3?.address, "0xcA11bde05977b3631167028862bE2a173976CA11");
    assert.equal(chain.testnet, true);
    assert.deepEqual(chain.rpcUrls.default.http, [...getEvmNetwork("elysium-testnet").rpcUrls]);
  });

  it("defines prelaunch Elysium mainnet with only its verified contracts", () => {
    const chain = defineEvmChain(getEvmNetwork("elysium-mainnet"));
    assert.equal(chain.id, 99_901);
    assert.equal(chain.contracts?.multicall3?.address, "0xcA11bde05977b3631167028862bE2a173976CA11");
    assert.equal(chain.blockExplorers, undefined);
  });
});

describe("EvmChains", () => {
  it("answers NETWORK_UNAVAILABLE for Elysium mainnet without an RPC, and serves it once configured", () => {
    const chains = new EvmChains(NETWORKS);
    assert.equal(chains.isAvailable("elysium-mainnet"), false);
    assert.throws(
      () => chains.client("elysium-mainnet"),
      (error: unknown) => error instanceof ElyiaHttpError && error.code === "NETWORK_UNAVAILABLE" && error.status === 503 && /not launched publicly/u.test(error.message),
    );
    const configured = new EvmChains(loadConfig({ ELYSIUM_MAINNET_RPC_URL: "https://mainnet-rpc.example.com" }).networks);
    assert.equal(configured.isAvailable("elysium-mainnet"), true);
    assert.equal(configured.client("elysium-mainnet").chain?.id, 99_901);
  });

  it("refuses HyperCore keys as non-EVM", () => {
    const chains = new EvmChains(NETWORKS);
    assert.throws(() => chains.client("hypercore-testnet"), { code: "NETWORK_NOT_SUPPORTED", status: 400 });
    assert.equal(chains.isAvailable("hypercore-testnet"), false);
  });

  it("reads the chain's own height via Multicall3 on a non-Nitro chain", async () => {
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport([]) });
    const result = await chains.getBalances("hyperevm-testnet", OWNER, ["native"]);
    assert.equal(result.blockNumber, 68_000_000n);
  });

  it("reads native and ERC-20 balances in one multicall with its block number (ArbSys height on Elysium)", async () => {
    const calls: RpcCall[] = [];
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport(calls) });
    const result = await chains.getBalances("elysium-testnet", OWNER, ["native", USDC, PURR]);
    assert.equal(result.blockNumber, 18_000_000n);
    assert.deepEqual(result.balances, [
      { token: "native", balance: 5n * 10n ** 18n },
      { token: USDC, balance: 1_234_567n },
      { token: PURR, balance: 42n },
    ]);
    assert.equal(calls.filter((call) => call.method === "eth_call").length, 1, "one round trip");
    assert.equal(result.owner, OWNER);
  });

  it("isolates a failing token read", async () => {
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport([], { failToken: PURR }) });
    const result = await chains.getBalances("elysium-testnet", OWNER, [USDC, PURR]);
    assert.deepEqual(
      result.balances.map((entry) => entry.balance),
      [1_234_567n, null],
    );
  });

  it("validates balance inputs before any read", async () => {
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport([]) });
    await assert.rejects(chains.getBalances("elysium-testnet", "0x123", ["native"]), { code: "INVALID_ADDRESS" });
    await assert.rejects(chains.getBalances("elysium-testnet", OWNER, ["0xnope"]), { code: "INVALID_ADDRESS" });
    await assert.rejects(chains.getBalances("elysium-testnet", OWNER, new Array(101).fill("native")), { code: "INVALID_REQUEST" });
    await assert.rejects(chains.getBalances("elysium-mainnet", OWNER, ["native"]), { code: "NETWORK_UNAVAILABLE" });
  });

  it("normalizes block headers, including Nitro's l1BlockNumber", async () => {
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport([]) });
    const header = await chains.getBlockHeader("elysium-testnet");
    assert.equal(header.number, 0x112a880n);
    assert.equal(header.l1BlockNumber, 0x410aaf9n);
    assert.equal(header.baseFeePerGas, 100_000_000n);
    assert.equal(header.transactionCount, 2);
    assert.equal(header.network, "elysium-testnet");
  });

  it("returns null for an unknown receipt and validates the hash", async () => {
    const chains = new EvmChains(NETWORKS, { transport: () => fakeTransport([]) });
    assert.equal(await chains.getTxReceipt("elysium-testnet", `0x${"aa".repeat(32)}`), null);
    await assert.rejects(chains.getTxReceipt("elysium-testnet", "0x1234"), { code: "INVALID_REQUEST" });
  });

  it("falls back to parallel reads where the registry has no Multicall3", async () => {
    const calls: RpcCall[] = [];
    const base = getEvmNetwork("elysium-mainnet");
    const network = {
      ...base,
      rpcUrls: ["https://mainnet.example.com"],
      contracts: { ...base.contracts, multicall3: null },
    } as EvmNetwork;
    const transport = custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        calls.push({ method, params: (params ?? []) as unknown[] });
        if (method === "eth_getBalance") return "0x10";
        if (method === "eth_call") return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 7n });
        throw new Error(`unexpected ${method}`);
      },
    }, { retryCount: 0 });
    const chains = new EvmChains({ ...NETWORKS, "elysium-mainnet": network }, { transport: () => transport });
    const result = await chains.getBalances("elysium-mainnet", OWNER, ["native", USDC]);
    assert.equal(result.blockNumber, null);
    assert.deepEqual(
      result.balances.map((entry) => entry.balance),
      [16n, 7n],
    );
  });
});
