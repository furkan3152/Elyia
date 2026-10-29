/**
 * HyperCore endpoints for the network mode the user chose (testnet by
 * default; mainnet only once the ui store allows it). Pure: everything comes
 * from @elyia/core's network registry.
 */
import { layersFor, type HyperCoreNetwork, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";

export interface HyperCoreEndpoints {
  readonly mode: NetworkEnvironment;
  readonly network: HyperCoreNetwork;
  readonly networkKey: NetworkKey;
  readonly infoUrl: string;
  readonly exchangeUrl: string;
  readonly wsUrl: string;
  /** The official app (explorer links, the testnet faucet). */
  readonly appUrl: string;
  readonly isMainnet: boolean;
  readonly hyperliquidChain: "Mainnet" | "Testnet";
}

const cache = new Map<NetworkEnvironment, HyperCoreEndpoints>();

export function hyperCoreEndpoints(mode: NetworkEnvironment): HyperCoreEndpoints {
  const known = cache.get(mode);
  if (known) return known;
  const network = layersFor(mode).hypercore;
  const endpoints: HyperCoreEndpoints = Object.freeze({
    mode,
    network,
    networkKey: network.key,
    infoUrl: network.infoUrl,
    exchangeUrl: network.exchangeUrl,
    wsUrl: network.wsUrl,
    appUrl: network.appUrl,
    isMainnet: network.environment === "mainnet",
    hyperliquidChain: network.hyperliquidChain,
  });
  cache.set(mode, endpoints);
  return endpoints;
}

/** Explorer link for an L1 transaction hash or an account. */
export function hyperCoreExplorerUrl(mode: NetworkEnvironment, kind: "tx" | "address", value: string): string {
  return `${hyperCoreEndpoints(mode).appUrl}/explorer/${kind}/${value}`;
}
