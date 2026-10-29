import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NETWORKS,
  NETWORK_KEYS,
  evmNetworkByChainId,
  explorerAddressUrl,
  explorerTxUrl,
  getEvmNetwork,
  getHyperCoreNetwork,
  isChecksumAddressValid,
  isEvmAddress,
  layersFor,
  networkByCaip2,
  networksFor,
  resolveNetwork,
  sameEnvironment,
  signatureChainIdHex,
  spotSystemAddress,
} from "../dist/index.js";

test("six networks with unique CAIP-2 ids and chain ids", () => {
  assert.equal(NETWORK_KEYS.length, 6);
  const caip = new Set(Object.values(NETWORKS).map((network) => network.caip2));
  assert.equal(caip.size, 6);
  const chainIds = Object.values(NETWORKS).filter((network) => network.vm === "evm").map((network) => network.chainId);
  assert.deepEqual(chainIds.sort((a, b) => a - b), [998, 999, 99801, 99901]);
  for (const network of Object.values(NETWORKS)) assert.equal(networkByCaip2(network.caip2), network);
});

test("every pinned address is a checksum-valid EVM address", () => {
  const walk = (value, path) => {
    if (typeof value === "string" && value.startsWith("0x") && value.length === 42) {
      assert.ok(isEvmAddress(value), path);
      assert.ok(isChecksumAddressValid(value), `${path} checksum`);
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    }
  };
  walk(NETWORKS, "NETWORKS");
});

test("Elysium testnet facts match the pinned address book", () => {
  const elysium = getEvmNetwork("elysium-testnet");
  assert.equal(elysium.chainId, 99801);
  assert.equal(elysium.parent, "hyperevm-testnet");
  assert.equal(elysium.nativeCurrency.symbol, "HYPE");
  assert.equal(elysium.contracts.wrappedNative, "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234");
  assert.equal(elysium.elysiumBridge?.child.l2GatewayRouter, "0x89659883a9d980925733B0A698F117AAb65ac718");
  assert.equal(elysium.elysiumBridge?.parent.inbox, "0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0");
  const mainnet = getEvmNetwork("elysium-mainnet");
  assert.equal(mainnet.status, "prelaunch");
  assert.deepEqual(mainnet.rpcUrls, [], "no public mainnet RPC is published");
  assert.equal(mainnet.elysiumBridge?.parent.l1GatewayRouter, "0x5D24f760DD7664b4214bDD4B04a3f62B9edd68c0", "mainnet token bridge from the L1AtomicTokenBridgeCreator");
  assert.equal(mainnet.elysiumBridge?.child.l2GatewayRouter, "0x61EbbC3A29f1970aF2Ce862bA9c5364832E14d17");
  assert.equal(mainnet.contracts.wrappedNative, "0xbA876237B0F021A6c6D852d6c26E107997cC5E81");
  assert.equal(mainnet.elysiumBridge?.parent.l1CustomGateway, null, "the mainnet mirror gateway is still unknown");
  assert.ok(!elysium.rpcUrls.some((url) => url.includes("hypedexer")), "the stale Hypedexer RPC is not used");
  assert.throws(() => getEvmNetwork("hypercore-testnet"));
  assert.equal(getHyperCoreNetwork("hypercore-testnet").phantomAgentSource, "b");
  assert.equal(getHyperCoreNetwork("hypercore-mainnet").hyperliquidChain, "Mainnet");
});

test("resolveNetwork: keys, CAIP-2, chain ids and aliases within one environment", () => {
  assert.equal(resolveNetwork("elysium-testnet")?.key, "elysium-testnet");
  assert.equal(resolveNetwork("eip155:998")?.key, "hyperevm-testnet");
  assert.equal(resolveNetwork(99801)?.key, "elysium-testnet");
  assert.equal(resolveNetwork("0x185d9")?.key, "elysium-testnet");
  assert.equal(resolveNetwork("999")?.key, "hyperevm-mainnet");
  assert.equal(resolveNetwork("Elysium")?.key, "elysium-testnet");
  assert.equal(resolveNetwork("core")?.key, "hypercore-testnet");
  assert.equal(resolveNetwork("elysium", "mainnet")?.key, "elysium-mainnet");
  assert.equal(resolveNetwork("solana"), null);
  assert.equal(resolveNetwork(1), null);
  assert.equal(evmNetworkByChainId(1338), null, "viem's elysiumTestnet (1338) is a different chain");
});

test("environments never mix and layers come in threes", () => {
  assert.equal(sameEnvironment("elysium-testnet", "hypercore-testnet"), true);
  assert.equal(sameEnvironment("elysium-testnet", "hyperevm-mainnet"), false);
  assert.equal(networksFor("testnet").length, 3);
  const layers = layersFor("testnet");
  assert.deepEqual([layers.elysium.key, layers.hyperevm.key, layers.hypercore.key], ["elysium-testnet", "hyperevm-testnet", "hypercore-testnet"]);
});

test("signatureChainId hex, spot system addresses and explorer links", () => {
  assert.equal(signatureChainIdHex(99801), "0x185d9");
  assert.equal(signatureChainIdHex(998), "0x3e6");
  assert.throws(() => signatureChainIdHex(0));
  assert.equal(spotSystemAddress(1105), "0x2000000000000000000000000000000000000451");
  assert.equal(spotSystemAddress(0), "0x2000000000000000000000000000000000000000");
  assert.throws(() => spotSystemAddress(-1));
  const hash = `0x${"ab".repeat(32)}`;
  assert.equal(explorerTxUrl("elysium-testnet", hash), `https://test-explorer.elysium.kinetiq.xyz/tx/${hash}`);
  assert.equal(explorerTxUrl("elysium-mainnet", hash), null);
  assert.equal(explorerAddressUrl("hypercore-testnet", "0x5e9ee1089755c3435139848e47e6635505d5a13a"), "https://app.hyperliquid-testnet.xyz/explorer/address/0x5e9ee1089755c3435139848e47e6635505d5a13a");
});
