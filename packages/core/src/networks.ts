// Network registry for Elyra. Addresses are pinned from on-chain reads
// (Conduit chain info, rollup getters, gateway router lookups).

export type NetworkKey =
  | "elysium-testnet"
  | "elysium-mainnet"
  | "hyperevm-testnet"
  | "hyperevm-mainnet"
  | "hypercore-testnet"
  | "hypercore-mainnet";

export type NetworkVm = "evm" | "hypercore";
export type NetworkFamily = "elysium" | "hyperevm" | "hypercore";
export type NetworkEnvironment = "testnet" | "mainnet";
/** live: usable now. prelaunch: deployed or announced but not public; Elyra keeps it read-only. */
export type NetworkStatus = "live" | "prelaunch";

export interface NativeCurrency {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface ElysiumBridgeContracts {
  /** Parent chain (HyperEVM) side of the Arbitrum Orbit rollup. */
  readonly parent: {
    readonly rollup: string;
    readonly bridge: string;
    readonly inbox: string;
    readonly sequencerInbox: string;
    readonly outbox: string | null;
    readonly l1GatewayRouter: string | null;
    readonly l1StandardGateway: string | null;
    readonly l1WhypeGateway: string | null;
    readonly l1CustomGateway: string | null;
    readonly mirrorFactory: string | null;
  };
  /** Elysium (child chain) side. */
  readonly child: {
    readonly l2GatewayRouter: string | null;
    readonly l2StandardGateway: string | null;
    readonly l2WhypeGateway: string | null;
    readonly l2CustomGateway: string | null;
    readonly bridgeFactory: string | null;
  };
  /** Rollup confirm period in parent blocks, as read on-chain. Read it live before showing ETAs. */
  readonly confirmPeriodBlocks: number | null;
}

export interface EvmNetwork {
  readonly key: NetworkKey;
  readonly vm: "evm";
  readonly family: Exclude<NetworkFamily, "hypercore">;
  readonly environment: NetworkEnvironment;
  readonly status: NetworkStatus;
  readonly name: string;
  readonly shortName: string;
  readonly chainId: number;
  readonly caip2: `eip155:${number}`;
  readonly nativeCurrency: NativeCurrency;
  /** Public RPC endpoints in preference order. Empty when none is public yet. */
  readonly rpcUrls: readonly string[];
  readonly wsUrls: readonly string[];
  readonly explorer: { readonly name: string; readonly url: string; readonly txPath: string; readonly addressPath: string } | null;
  /** Measured or documented block time in milliseconds. */
  readonly blockTimeMs: number;
  /** Max blocks per eth_getLogs query that public RPCs accept without an address filter. */
  readonly logRangeLimit: number;
  readonly parent: NetworkKey | null;
  readonly contracts: {
    readonly multicall3: string | null;
    readonly permit2: string | null;
    readonly wrappedNative: string | null;
  };
  readonly elysiumBridge: ElysiumBridgeContracts | null;
}

export interface HyperCoreNetwork {
  readonly key: NetworkKey;
  readonly vm: "hypercore";
  readonly family: "hypercore";
  readonly environment: NetworkEnvironment;
  readonly status: NetworkStatus;
  readonly name: string;
  readonly shortName: string;
  readonly caip2: `hypercore:${NetworkEnvironment}`;
  /** Value of `hyperliquidChain` in user-signed actions. */
  readonly hyperliquidChain: "Mainnet" | "Testnet";
  /** `source` field of the phantom agent for L1 actions. */
  readonly phantomAgentSource: "a" | "b";
  readonly apiUrl: string;
  readonly infoUrl: string;
  readonly exchangeUrl: string;
  readonly wsUrl: string;
  readonly appUrl: string;
  /** The HyperEVM network linked to this HyperCore. */
  readonly evm: NetworkKey;
}

export type Network = EvmNetwork | HyperCoreNetwork;

const ELYSIUM_TESTNET: EvmNetwork = {
  key: "elysium-testnet",
  vm: "evm",
  family: "elysium",
  environment: "testnet",
  status: "live",
  name: "Elysium Testnet",
  shortName: "Elysium",
  chainId: 99801,
  caip2: "eip155:99801",
  nativeCurrency: { symbol: "HYPE", name: "HYPE", decimals: 18 },
  rpcUrls: [
    "https://testnet-rpc.elysium.kinetiq.xyz",
    "https://rpc-elysium-testnet.t.conduit.xyz",
    "https://elysium-testnet-rpc.hypedexer.com",
  ],
  wsUrls: ["wss://elysium-testnet-rpc.hypedexer.com"],
  explorer: {
    name: "Elysium Testnet Explorer",
    url: "https://test-explorer.elysium.kinetiq.xyz",
    txPath: "/tx/",
    addressPath: "/address/",
  },
  blockTimeMs: 115,
  logRangeLimit: 2000,
  parent: "hyperevm-testnet",
  contracts: {
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    wrappedNative: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
  },
  elysiumBridge: {
    parent: {
      rollup: "0xEbf08e34941fd93a0Fc1cD89dbBF7447267039Df",
      bridge: "0x36dAbc3CEE2E1084B7d04c8015Ef68Cac78f4f37",
      inbox: "0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0",
      sequencerInbox: "0xb5B1a0AebfFeF819Ec3F8c39a17b5C4E70A001E3",
      outbox: "0x87391D602aaffB3Fe8051EcCDb75d6EEe8C31060",
      l1GatewayRouter: "0x1aAE2caD8B0249905492087EF230FcCEa3707C45",
      l1StandardGateway: "0x792487eF5E423104bec94e8c58E814e5E0450cEA",
      l1WhypeGateway: "0x494A1879e15739778b2059623C70e9C99A43870E",
      l1CustomGateway: "0x08922Faa84aC2a54aa3cFD3725b03ca256F52Da2",
      mirrorFactory: "0xcaDb9986F3727177d48FA07294E1730f9D19290b",
    },
    child: {
      l2GatewayRouter: "0x89659883a9d980925733B0A698F117AAb65ac718",
      l2StandardGateway: "0x30545d8b24185DdFe83E75aB6939f867b664e2E1",
      l2WhypeGateway: "0x1F8be963E0cf8315Fc703cF415bA642DfcAEeDEf",
      l2CustomGateway: "0x7255150a0340852Fe4B4B5657C5AcE6c09a4F959",
      bridgeFactory: "0xb94A38a4aC46970559E89E566f2486a3Fc56BE5a",
    },
    confirmPeriodBlocks: 10,
  },
};

const ELYSIUM_MAINNET: EvmNetwork = {
  key: "elysium-mainnet",
  vm: "evm",
  family: "elysium",
  environment: "mainnet",
  status: "prelaunch",
  name: "Elysium",
  shortName: "Elysium",
  chainId: 99901,
  caip2: "eip155:99901",
  nativeCurrency: { symbol: "HYPE", name: "HYPE", decimals: 18 },
  rpcUrls: [],
  wsUrls: [],
  explorer: null,
  blockTimeMs: 115,
  logRangeLimit: 2000,
  parent: "hyperevm-mainnet",
  contracts: {
    multicall3: null,
    permit2: null,
    wrappedNative: null,
  },
  elysiumBridge: {
    parent: {
      rollup: "0x508C173dFe5F737B3493195Bf785d71fA76fD217",
      bridge: "0x503D572157113fAaaD4DbeD2647Bb10b949216B6",
      inbox: "0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff",
      sequencerInbox: "0x7f3Ff53aecB87261206ad3bDc27A88b6D8420fa6",
      outbox: "0xeC6B106DfA14428FE5Eec2a4065a7be599f02728",
      l1GatewayRouter: null,
      l1StandardGateway: null,
      l1WhypeGateway: null,
      l1CustomGateway: null,
      mirrorFactory: null,
    },
    child: {
      l2GatewayRouter: null,
      l2StandardGateway: null,
      l2WhypeGateway: null,
      l2CustomGateway: null,
      bridgeFactory: null,
    },
    confirmPeriodBlocks: 483840,
  },
};

const HYPEREVM_TESTNET: EvmNetwork = {
  key: "hyperevm-testnet",
  vm: "evm",
  family: "hyperevm",
  environment: "testnet",
  status: "live",
  name: "HyperEVM Testnet",
  shortName: "HyperEVM",
  chainId: 998,
  caip2: "eip155:998",
  nativeCurrency: { symbol: "HYPE", name: "HYPE", decimals: 18 },
  rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
  wsUrls: [],
  explorer: { name: "Purrsec", url: "https://testnet.purrsec.com", txPath: "/tx/", addressPath: "/address/" },
  blockTimeMs: 1000,
  logRangeLimit: 50,
  parent: null,
  contracts: {
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    permit2: null,
    wrappedNative: "0x5555555555555555555555555555555555555555",
  },
  elysiumBridge: null,
};

const HYPEREVM_MAINNET: EvmNetwork = {
  key: "hyperevm-mainnet",
  vm: "evm",
  family: "hyperevm",
  environment: "mainnet",
  status: "live",
  name: "HyperEVM",
  shortName: "HyperEVM",
  chainId: 999,
  caip2: "eip155:999",
  nativeCurrency: { symbol: "HYPE", name: "HYPE", decimals: 18 },
  rpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
  wsUrls: [],
  explorer: { name: "HyperEVMScan", url: "https://hyperevmscan.io", txPath: "/tx/", addressPath: "/address/" },
  blockTimeMs: 1000,
  logRangeLimit: 50,
  parent: null,
  contracts: {
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    permit2: null,
    wrappedNative: "0x5555555555555555555555555555555555555555",
  },
  elysiumBridge: null,
};

const HYPERCORE_TESTNET: HyperCoreNetwork = {
  key: "hypercore-testnet",
  vm: "hypercore",
  family: "hypercore",
  environment: "testnet",
  status: "live",
  name: "HyperCore Testnet",
  shortName: "HyperCore",
  caip2: "hypercore:testnet",
  hyperliquidChain: "Testnet",
  phantomAgentSource: "b",
  apiUrl: "https://api.hyperliquid-testnet.xyz",
  infoUrl: "https://api.hyperliquid-testnet.xyz/info",
  exchangeUrl: "https://api.hyperliquid-testnet.xyz/exchange",
  wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
  appUrl: "https://app.hyperliquid-testnet.xyz",
  evm: "hyperevm-testnet",
};

const HYPERCORE_MAINNET: HyperCoreNetwork = {
  key: "hypercore-mainnet",
  vm: "hypercore",
  family: "hypercore",
  environment: "mainnet",
  status: "live",
  name: "HyperCore",
  shortName: "HyperCore",
  caip2: "hypercore:mainnet",
  hyperliquidChain: "Mainnet",
  phantomAgentSource: "a",
  apiUrl: "https://api.hyperliquid.xyz",
  infoUrl: "https://api.hyperliquid.xyz/info",
  exchangeUrl: "https://api.hyperliquid.xyz/exchange",
  wsUrl: "wss://api.hyperliquid.xyz/ws",
  appUrl: "https://app.hyperliquid.xyz",
  evm: "hyperevm-mainnet",
};

export const NETWORKS: Readonly<Record<NetworkKey, Network>> = Object.freeze({
  "elysium-testnet": ELYSIUM_TESTNET,
  "elysium-mainnet": ELYSIUM_MAINNET,
  "hyperevm-testnet": HYPEREVM_TESTNET,
  "hyperevm-mainnet": HYPEREVM_MAINNET,
  "hypercore-testnet": HYPERCORE_TESTNET,
  "hypercore-mainnet": HYPERCORE_MAINNET,
});

export const NETWORK_KEYS = Object.keys(NETWORKS) as readonly NetworkKey[];

/** HyperEVM system address that credits native HYPE on HyperCore. */
export const HYPE_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222";
/** HyperEVM CoreWriter (raw HyperCore actions from contracts). */
export const HYPEREVM_CORE_WRITER = "0x3333333333333333333333333333333333333333";
/** Arbitrum Nitro precompiles present on Elysium. */
export const ARB_SYS = "0x0000000000000000000000000000000000000064";
export const ARB_RETRYABLE_TX = "0x000000000000000000000000000000000000006E";
export const ARB_GAS_INFO = "0x000000000000000000000000000000000000006C";
export const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
/** Retryable tickets on Elysium expire after this many seconds (ArbRetryableTx.getLifetime()). */
export const ELYSIUM_RETRYABLE_LIFETIME_SECONDS = 604_800;

export function isNetworkKey(value: unknown): value is NetworkKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NETWORKS, value);
}

export function getNetwork(key: NetworkKey): Network {
  return NETWORKS[key];
}

export function getEvmNetwork(key: NetworkKey): EvmNetwork {
  const network = NETWORKS[key];
  if (network.vm !== "evm") throw new Error(`${key} is not an EVM network`);
  return network;
}

export function getHyperCoreNetwork(key: NetworkKey): HyperCoreNetwork {
  const network = NETWORKS[key];
  if (network.vm !== "hypercore") throw new Error(`${key} is not a HyperCore network`);
  return network;
}

export function evmNetworkByChainId(chainId: number): EvmNetwork | null {
  for (const network of Object.values(NETWORKS)) {
    if (network.vm === "evm" && network.chainId === chainId) return network;
  }
  return null;
}

export function networksFor(environment: NetworkEnvironment): Network[] {
  return Object.values(NETWORKS).filter((network) => network.environment === environment);
}

/** The three layers of one environment, in the order Elyra shows them. */
export function layersFor(environment: NetworkEnvironment): { elysium: EvmNetwork; hyperevm: EvmNetwork; hypercore: HyperCoreNetwork } {
  return environment === "testnet"
    ? { elysium: ELYSIUM_TESTNET, hyperevm: HYPEREVM_TESTNET, hypercore: HYPERCORE_TESTNET }
    : { elysium: ELYSIUM_MAINNET, hyperevm: HYPEREVM_MAINNET, hypercore: HYPERCORE_MAINNET };
}

/** System address on HyperEVM for a HyperCore spot token index (HYPE has its own address). */
export function spotSystemAddress(tokenIndex: number): string {
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 0xffffffff) {
    throw new Error(`invalid token index ${tokenIndex}`);
  }
  return `0x20${tokenIndex.toString(16).padStart(38, "0")}`;
}

export function explorerTxUrl(key: NetworkKey, hash: string): string | null {
  const network = NETWORKS[key];
  if (network.vm === "hypercore") return `${network.appUrl}/explorer/tx/${hash}`;
  return network.explorer ? `${network.explorer.url}${network.explorer.txPath}${hash}` : null;
}

export function explorerAddressUrl(key: NetworkKey, address: string): string | null {
  const network = NETWORKS[key];
  if (network.vm === "hypercore") return `${network.appUrl}/explorer/address/${address}`;
  return network.explorer ? `${network.explorer.url}${network.explorer.addressPath}${address}` : null;
}
