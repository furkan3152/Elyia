/**
 * viem chains for Elyia's EVM networks, built from @elyia/core's registry.
 * 99801/99901 are defined here with `defineChain` (viem's own "elysiumTestnet"
 * is a different chain, 1338). The chain objects handed to wallets carry only
 * the registry's public RPC URLs, so `wallet_addEthereumChain` never offers a
 * private endpoint.
 */
import { NETWORKS, type EvmNetwork, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";
import { defineChain, type Chain } from "viem";

export const EVM_NETWORK_KEYS = ["elysium-testnet", "hyperevm-testnet", "elysium-mainnet", "hyperevm-mainnet"] as const satisfies readonly NetworkKey[];
export type EvmNetworkKey = (typeof EVM_NETWORK_KEYS)[number];

export function evmNetwork(key: EvmNetworkKey): EvmNetwork {
  const network = NETWORKS[key];
  if (network.vm !== "evm") throw new Error(`${key} is not an EVM network`);
  return network;
}

export function chainFromNetwork(network: EvmNetwork): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: network.nativeCurrency.name, symbol: network.nativeCurrency.symbol, decimals: network.nativeCurrency.decimals },
    rpcUrls: { default: { http: [...network.rpcUrls], webSocket: network.wsUrls.length > 0 ? [...network.wsUrls] : undefined } },
    blockExplorers: network.explorer ? { default: { name: network.explorer.name, url: network.explorer.url } } : undefined,
    contracts: network.contracts.multicall3 ? { multicall3: { address: network.contracts.multicall3 as `0x${string}` } } : undefined,
    testnet: network.environment === "testnet",
  });
}

/** Every EVM chain Elyia knows, mainnets included (defined, not necessarily offered). */
export const DEFINED_CHAINS: Readonly<Record<EvmNetworkKey, Chain>> = Object.freeze({
  "elysium-testnet": chainFromNetwork(evmNetwork("elysium-testnet")),
  "hyperevm-testnet": chainFromNetwork(evmNetwork("hyperevm-testnet")),
  "elysium-mainnet": chainFromNetwork(evmNetwork("elysium-mainnet")),
  "hyperevm-mainnet": chainFromNetwork(evmNetwork("hyperevm-mainnet")),
});

/**
 * A network is offered to wallets only when it belongs to the current mode,
 * is live, and has a public RPC. Elysium mainnet is prelaunch with no public
 * RPC, so it is defined but never offered until the registry says otherwise.
 */
export function isWalletOffered(network: EvmNetwork, mode: NetworkEnvironment): boolean {
  return network.environment === mode && network.status === "live" && network.rpcUrls.length > 0;
}

/** Chains offered to wallets in `mode`, Elysium first (RainbowKit's initial chain). Never empty. */
export function walletChainKeys(mode: NetworkEnvironment): EvmNetworkKey[] {
  const offered = EVM_NETWORK_KEYS.filter((key) => isWalletOffered(evmNetwork(key), mode));
  if (offered.length > 0) return offered;
  // Testnet is always available; a mode with nothing offered falls back to it.
  return EVM_NETWORK_KEYS.filter((key) => isWalletOffered(evmNetwork(key), "testnet"));
}

export function walletChains(mode: NetworkEnvironment): readonly [Chain, ...Chain[]] {
  const chains = walletChainKeys(mode).map((key) => DEFINED_CHAINS[key]);
  const [first, ...rest] = chains;
  if (!first) throw new Error("No EVM chain is offered: the network registry has no live testnet");
  return [first, ...rest];
}
