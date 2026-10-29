/**
 * Token registry per EVM network (Elysium, HyperEVM). An entry binds a
 * symbol to exactly one on-chain identity per network; symbols are never
 * resolved across networks by name. Only registry tokens are "verified":
 * the Elysium docs warn that look-alike tokens exist, so anything else is
 * shown as unverified, and a stranger reusing a registry symbol or name is
 * flagged as a look-alike.
 *
 * Every pin was read back on-chain on 2026-10-29 (`name()`, `symbol()`,
 * `decimals()` by `eth_call`; canonical pairs by
 * `L2GatewayRouter(0x8965…c718).calculateL2TokenAddress(l1)` on Elysium
 * testnet; HyperCore links from the info API `spotMeta`
 * `tokens[].evmContract`). The `evidence` field of each entry says which.
 */
import {
  erc20AssetId,
  isEvmAddress,
  nativeAssetId,
  parseAssetId,
  sameAddress,
  type AssetId,
  type EvmAddress,
} from "./caip.js";
import { NETWORKS, spotSystemAddress, HYPE_SYSTEM_ADDRESS, type NetworkKey } from "./networks.js";

export type TokenKind = "native" | "erc20";
/** canonical: Orbit token gateways; mirror: the Elysium mirror bridge; native: HYPE as gas on both chains. */
export type BridgeRoute = "canonical" | "mirror" | "native";
/** Economic identity across networks (pricing, "same asset" checks). Tokens of one group are 1:1. */
export type TokenGroup = "HYPE" | "USDC" | "USDT" | "USDH" | "BTC" | "ETH";
export type TokenTag =
  | "gas"
  | "stablecoin"
  | "wrapped"
  | "liquid-staking"
  | "governance"
  | "test"
  | "canonical-bridged"
  | "core-linked"
  | "btc"
  | "eth"
  /** A real contract that is not the canonical asset its name suggests (app-specific test stables). Never priced as that asset. */
  | "non-canonical";

export interface TokenCounterpart {
  readonly network: NetworkKey;
  /** null for the native gas asset. */
  readonly address: EvmAddress | null;
}

export interface TokenBridge {
  readonly route: BridgeRoute;
  readonly counterpart: TokenCounterpart;
}

/** The HyperCore spot token an EVM token is linked to (`spotMeta.tokens[]`). */
export interface CoreTokenLink {
  readonly name: string;
  readonly index: number;
  /** 16-byte token id; spotSend's `token` field is `${name}:${tokenId}`. */
  readonly tokenId: `0x${string}`;
  readonly weiDecimals: number;
  readonly szDecimals: number;
  /** `evm decimals = weiDecimals + evmExtraWeiDecimals`; transfers must divide exactly. */
  readonly evmExtraWeiDecimals: number;
}

export interface TokenDescriptor {
  readonly id: AssetId;
  readonly network: NetworkKey;
  /** ERC-20 contract (EIP-55); null for the native gas asset. */
  readonly address: EvmAddress | null;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly kind: TokenKind;
  readonly group?: TokenGroup;
  /** Other spellings of this same token on its network only (`USDT` for USDT0). */
  readonly aliases?: readonly string[];
  readonly bridge?: TokenBridge;
  readonly coreToken?: CoreTokenLink;
  readonly tags: readonly TokenTag[];
  /** How the pin was verified. */
  readonly evidence: string;
}

const READ_BACK = "name/symbol/decimals read by eth_call on 2026-10-29";
const CANONICAL_PAIR = "L2GatewayRouter.calculateL2TokenAddress(l1) on Elysium testnet = this token (2026-10-29)";

function native(network: NetworkKey, extra: Partial<TokenDescriptor> = {}): TokenDescriptor {
  const chain = NETWORKS[network];
  if (chain.vm !== "evm") throw new Error(`${network} has no native gas token`);
  return {
    id: nativeAssetId(network),
    network,
    address: null,
    symbol: chain.nativeCurrency.symbol,
    name: chain.nativeCurrency.name,
    decimals: chain.nativeCurrency.decimals,
    kind: "native",
    group: "HYPE",
    tags: ["gas"],
    evidence: "native gas asset of the chain (networks.ts)",
    ...extra,
  };
}

interface Erc20Input {
  readonly network: NetworkKey;
  readonly address: EvmAddress;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly tags: readonly TokenTag[];
  readonly evidence: string;
  readonly group?: TokenGroup;
  readonly aliases?: readonly string[];
  readonly bridge?: TokenBridge;
  readonly coreToken?: CoreTokenLink;
}

function erc20(input: Erc20Input): TokenDescriptor {
  return { ...input, id: erc20AssetId(input.network, input.address), kind: "erc20" };
}

const canonical = (network: NetworkKey, address: EvmAddress): TokenBridge => ({ route: "canonical", counterpart: { network, address } });

/* HyperCore testnet spot tokens, from `spotMeta` (https://api.hyperliquid-testnet.xyz/info, 2026-10-29). */
const CORE_TESTNET = {
  HYPE: { name: "HYPE", index: 1105, tokenId: "0x7317beb7cceed72ef0b346074cc8e7ab", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: 10 },
  PURR: { name: "PURR", index: 1, tokenId: "0xc4bf3f870c0e9465323c0b6ed28096c2", weiDecimals: 5, szDecimals: 0, evmExtraWeiDecimals: 13 },
  USDH: { name: "USDH", index: 1452, tokenId: "0x471fd4480bb9943a1fe080ab0d4ff36c", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: -2 },
  KNTQ: { name: "KNTQ", index: 3167, tokenId: "0xadecde63e61eae4c95ee521bdfcc07a9", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: 10 },
} as const satisfies Record<string, CoreTokenLink>;

/* HyperCore mainnet spot tokens, from `spotMeta` (https://api.hyperliquid.xyz/info, 2026-10-29). */
const CORE_MAINNET = {
  HYPE: { name: "HYPE", index: 150, tokenId: "0x0d01dc56dcaaca66ad901c959b4011ec", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: 10 },
  PURR: { name: "PURR", index: 1, tokenId: "0xc1fb593aeffbeb02f85e0308e9956a90", weiDecimals: 5, szDecimals: 0, evmExtraWeiDecimals: 13 },
  KHYPE: { name: "KHYPE", index: 121, tokenId: "0xbc8a22f25703a03101630ce6b09f4baa", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: 10 },
  KNTQ: { name: "KNTQ", index: 124, tokenId: "0xbd31bd605c0a1b82c72aae3587f9061f", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: 10 },
  UBTC: { name: "UBTC", index: 197, tokenId: "0x8f254b963e8468305d409b33aa137c67", weiDecimals: 10, szDecimals: 5, evmExtraWeiDecimals: -2 },
  UETH: { name: "UETH", index: 221, tokenId: "0xe1edd30daaf5caac3fe63569e24748da", weiDecimals: 9, szDecimals: 4, evmExtraWeiDecimals: 9 },
  USDT0: { name: "USDT0", index: 268, tokenId: "0x25faedc3f054130dbb4e4203aca63567", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: -2 },
  USDH: { name: "USDH", index: 360, tokenId: "0x54e00a5988577cb0b0c9ab0cb6ef7f4b", weiDecimals: 8, szDecimals: 2, evmExtraWeiDecimals: -2 },
} as const satisfies Record<string, CoreTokenLink>;

/* Elysium testnet token addresses (canonical-bridged from HyperEVM testnet). */
const ELY = {
  WHYPE: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
  USDC: "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
  PURR: "0x5688c9Ca58435Ee982c16cCBE05eAC6993e32Bdd",
  tKNTQ: "0x3ac6B0cE3d014215017fA36BB5D2574e5583B82f",
  USDH: "0x9B2bb045e96C7850aFF0C6107eDc425D6b5A0B51",
  kHYPE: "0xe26Eb188447eA470cBfdC6f770183e77345554dc",
  KNTQ: "0x9856148d9CAcf40F12BCAA9357ca016Ba5B0ED19",
  USDT0: "0xC7757202144dF3154e42196766d258B952DC7deE",
} as const satisfies Record<string, EvmAddress>;

/* HyperEVM testnet (998) token addresses: the L1 side of the Elysium testnet bridge. */
const HEVM = {
  WHYPE: "0x5555555555555555555555555555555555555555",
  USDC: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  PURR: "0xa9056c15938f9aff34CD497c722Ce33dB0C2fD57",
  tKNTQ: "0x818db119325707aed5e94111A090b96DcF0EEe7A",
  USDH: "0x22222245c52C817f95b74664AE8546B490222222",
  kHYPE: "0x25Ce769757c418c58e623742A43b6f65aEBfeF22",
  KNTQ: "0xf57E4E34091F471cb1f465606deD2bFB5e0B1D32",
  USDT0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
} as const satisfies Record<string, EvmAddress>;

/*
 * More Elysium testnet tokens, read back on 99801 and 998
 * (name/symbol/decimals; the L2 address is
 * `L2GatewayRouter.calculateL2TokenAddress(l1)` and the token's
 * `l1Address()` points back).
 */
const ELY_MORE = {
  UETH: "0x3EF0cdeF58ddc22E46E6b22A214F0402D317EB7b",
  kmHYPE: "0x0eef2bf799Cb2dfE86E56f2B2768eed76b973b8A",
} as const satisfies Record<string, EvmAddress>;

const HEVM_MORE = {
  UETH: "0x5a1A1339ad9e52B7a4dF78452D5c18e8690746f3",
  kmHYPE: "0x6a3886EB829b3C1a91ba44BbD7154D1DD34aCfAe",
} as const satisfies Record<string, EvmAddress>;

/* HyperCore testnet UETH (`spotMeta` token 1242, evmContract = HEVM_MORE.UETH, 2026-10-29). */
const CORE_TESTNET_UETH = {
  name: "UETH", index: 1242, tokenId: "0xe4371d8166f362d6578725f11e0a14f3", weiDecimals: 9, szDecimals: 4, evmExtraWeiDecimals: 9,
} as const satisfies CoreTokenLink;

/*
 * Elysium MAINNET (99901) canonical tokens. L1-anchored: the L2
 * address is `L1GatewayRouter(0x5D24…68c0).calculateL2TokenAddress(l1)` read on
 * HyperEVM mainnet, and the L1 token's name/symbol/decimals were read on
 * https://rpc.hyperliquid.xyz/evm (2026-10-29). The 99901 side itself has no
 * keyless official RPC; its metadata was only seen through an untrusted relay.
 */
const ELY_MAINNET = {
  WHYPE: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
  USDC: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65",
  kHYPE: "0x248888D396A546A69A188f3Deb476964e581E9d0",
  KNTQ: "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0",
  USDH: "0x87E904A076fb98eEd283AE3e3410507ce95A9326",
  UBTC: "0xE9C29585EAe4B9a55b02a9605AEa892B40d972E8",
  UETH: "0x7A66A75fe41Bc26867C17fe1bc7D1C076EBd4eCd",
} as const satisfies Record<string, EvmAddress>;

const L1_ANCHORED =
  "L1-anchored: L1GatewayRouter(0x5D24…68c0).calculateL2TokenAddress(l1) on HyperEVM mainnet = this address, and the L1 token's name/symbol/decimals read by eth_call (2026-10-29); the standard gateway deploys the L2 token with the L1 metadata";

export const TOKENS: readonly TokenDescriptor[] = Object.freeze([
  /* ------------------------------------------------------ Elysium testnet */
  native("elysium-testnet", { bridge: { route: "native", counterpart: { network: "hyperevm-testnet", address: null } } }),
  erc20({
    network: "elysium-testnet", address: ELY.WHYPE, symbol: "WHYPE", name: "WHYPE", decimals: 18, group: "HYPE",
    tags: ["wrapped", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.WHYPE),
    evidence: `${READ_BACK}; ${CANONICAL_PAIR} (WHYPE gateway 0x1F8b…EDEf); deployed with the token bridge`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.USDC, symbol: "USDC", name: "USDC", decimals: 6, group: "USDC",
    tags: ["stablecoin", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.USDC),
    evidence: `${READ_BACK}; ${CANONICAL_PAIR}; l1Address() = 0x2B33…D8Ab`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.PURR, symbol: "PURR", name: "PURR", decimals: 18,
    tags: ["canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.PURR), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.tKNTQ, symbol: "tKNTQ", name: "Test KNTQ", decimals: 18,
    tags: ["test", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.tKNTQ), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.USDH, symbol: "USDH", name: "USDH", decimals: 6, group: "USDH",
    tags: ["stablecoin", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.USDH), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.kHYPE, symbol: "kHYPE", name: "Kinetiq Staked HYPE", decimals: 18,
    tags: ["liquid-staking", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.kHYPE), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.KNTQ, symbol: "KNTQ", name: "Kinetiq Governance Token", decimals: 18,
    tags: ["governance", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.KNTQ), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY.USDT0, symbol: "USDT0", name: "USD₮0", decimals: 6, group: "USDT", aliases: ["USD₮0", "USDT"],
    tags: ["stablecoin", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM.USDT0), evidence: `${READ_BACK}; ${CANONICAL_PAIR}`,
  }),

  /* ----------------------------------------------------- HyperEVM testnet */
  native("hyperevm-testnet", {
    tags: ["gas", "core-linked"],
    bridge: { route: "native", counterpart: { network: "elysium-testnet", address: null } },
    coreToken: CORE_TESTNET.HYPE,
    evidence: "native gas asset; spotMeta HYPE index 1105 (evmContract 0x0…0, extra wei decimals 10); system address 0x2222…2222",
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.WHYPE, symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, group: "HYPE",
    tags: ["wrapped"], bridge: canonical("elysium-testnet", ELY.WHYPE), evidence: `${READ_BACK}; Elysium WHYPE gateway l1Weth()`,
  }),
  erc20({
    // Not the Core-linked USDC: testnet spotMeta links Core USDC to 0x0B80…C206, a contract without ERC-20 metadata.
    network: "hyperevm-testnet", address: HEVM.USDC, symbol: "USDC", name: "USDC", decimals: 6, group: "USDC",
    tags: ["stablecoin"], bridge: canonical("elysium-testnet", ELY.USDC), evidence: `${READ_BACK}; canonical L1 token of Elysium USDC`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.PURR, symbol: "PURR", name: "PURR", decimals: 18,
    tags: ["core-linked"], bridge: canonical("elysium-testnet", ELY.PURR), coreToken: CORE_TESTNET.PURR,
    evidence: `${READ_BACK}; spotMeta PURR index 1 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.tKNTQ, symbol: "tKNTQ", name: "Test KNTQ", decimals: 18,
    tags: ["test"], bridge: canonical("elysium-testnet", ELY.tKNTQ), evidence: `${READ_BACK}; not linked in testnet spotMeta`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.USDH, symbol: "USDH", name: "USDH", decimals: 6, group: "USDH",
    tags: ["stablecoin", "core-linked"], bridge: canonical("elysium-testnet", ELY.USDH), coreToken: CORE_TESTNET.USDH,
    evidence: `${READ_BACK}; spotMeta USDH index 1452 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.kHYPE, symbol: "kHYPE", name: "Kinetiq Staked HYPE", decimals: 18,
    tags: ["liquid-staking"], bridge: canonical("elysium-testnet", ELY.kHYPE), evidence: `${READ_BACK}; not linked in testnet spotMeta`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.KNTQ, symbol: "KNTQ", name: "Kinetiq Governance Token", decimals: 18,
    tags: ["governance", "core-linked"], bridge: canonical("elysium-testnet", ELY.KNTQ), coreToken: CORE_TESTNET.KNTQ,
    evidence: `${READ_BACK}; spotMeta KNTQ index 3167 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM.USDT0, symbol: "USDT0", name: "USD₮0", decimals: 6, group: "USDT", aliases: ["USD₮0", "USDT"],
    tags: ["stablecoin"], bridge: canonical("elysium-testnet", ELY.USDT0), evidence: `${READ_BACK}; not linked in testnet spotMeta`,
  }),

  /* ----------------------------------------------------- HyperEVM mainnet */
  native("hyperevm-mainnet", {
    tags: ["gas", "core-linked"],
    bridge: { route: "native", counterpart: { network: "elysium-mainnet", address: null } },
    coreToken: CORE_MAINNET.HYPE,
    evidence: "native gas asset; spotMeta HYPE index 150 (8 wei decimals; moves through system address 0x2222…2222)",
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0x5555555555555555555555555555555555555555", symbol: "WHYPE", name: "Wrapped HYPE",
    decimals: 18, group: "HYPE", tags: ["wrapped"], bridge: canonical("elysium-mainnet", ELY_MAINNET.WHYPE), evidence: READ_BACK,
  }),
  erc20({
    // Circle's USDC on HyperEVM. Core USDC is linked to 0x6B9E…0A24, not to this contract.
    network: "hyperevm-mainnet", address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", symbol: "USDC", name: "USDC",
    decimals: 6, group: "USDC", tags: ["stablecoin"], bridge: canonical("elysium-mainnet", ELY_MAINNET.USDC), evidence: `${READ_BACK}; not the Core-linked USDC contract`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", symbol: "USDT0", name: "USD₮0",
    decimals: 6, group: "USDT", aliases: ["USD₮0", "USDT"], tags: ["stablecoin", "core-linked"], coreToken: CORE_MAINNET.USDT0,
    evidence: `${READ_BACK}; spotMeta USDT0 index 268 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0x111111a1a0667d36bD57c0A9f569b98057111111", symbol: "USDH", name: "USDH",
    decimals: 6, group: "USDH", tags: ["stablecoin", "core-linked"], coreToken: CORE_MAINNET.USDH, bridge: canonical("elysium-mainnet", ELY_MAINNET.USDH),
    evidence: `${READ_BACK}; spotMeta USDH index 360 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0xfD739d4e423301CE9385c1fb8850539D657C296D", symbol: "kHYPE", name: "Kinetiq Staked HYPE",
    decimals: 18, tags: ["liquid-staking", "core-linked"], coreToken: CORE_MAINNET.KHYPE, bridge: canonical("elysium-mainnet", ELY_MAINNET.kHYPE),
    evidence: `${READ_BACK}; Kinetiq docs contract table; spotMeta KHYPE index 121 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0x000000000000780555bD0BCA3791f89f9542c2d6", symbol: "KNTQ", name: "Kinetiq Governance Token",
    decimals: 18, tags: ["governance", "core-linked"], coreToken: CORE_MAINNET.KNTQ, bridge: canonical("elysium-mainnet", ELY_MAINNET.KNTQ),
    evidence: `${READ_BACK}; spotMeta KNTQ index 124 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", symbol: "UBTC", name: "Unit Bitcoin",
    decimals: 8, group: "BTC", tags: ["btc", "core-linked"], coreToken: CORE_MAINNET.UBTC, bridge: canonical("elysium-mainnet", ELY_MAINNET.UBTC),
    evidence: `${READ_BACK}; spotMeta UBTC index 197 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0xBe6727B535545C67d5cAa73dEa54865B92CF7907", symbol: "UETH", name: "Unit Ethereum",
    decimals: 18, group: "ETH", tags: ["eth", "core-linked"], coreToken: CORE_MAINNET.UETH, bridge: canonical("elysium-mainnet", ELY_MAINNET.UETH),
    evidence: `${READ_BACK}; spotMeta UETH index 221 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-mainnet", address: "0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E", symbol: "PURR", name: "Purr",
    decimals: 18, tags: ["core-linked"], coreToken: CORE_MAINNET.PURR,
    evidence: `${READ_BACK}; spotMeta PURR index 1 evmContract = this address`,
  }),

  /* ------------------------------------------------------ Elysium mainnet */
  // Canonical token-bridge set registered by the creator on Oct 19; re-check on launch day.
  native("elysium-mainnet", {
    bridge: { route: "native", counterpart: { network: "hyperevm-mainnet", address: null } },
    evidence: "native gas asset of the chain (networks.ts); deposited 1:1 through the pinned mainnet Inbox 0xce59…2cff",
  }),

  /* ------------------------------------------------- more testnet tokens */
  erc20({
    network: "elysium-testnet", address: ELY_MORE.UETH, symbol: "UETH", name: "Unit Ethereum", decimals: 18, group: "ETH",
    tags: ["eth", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM_MORE.UETH),
    evidence: `${READ_BACK} on 99801 and 998; ${CANONICAL_PAIR}; l1Address() = 0x5a1A…46f3`,
  }),
  erc20({
    network: "elysium-testnet", address: ELY_MORE.kmHYPE, symbol: "kmHYPE", name: "kMarkets LST", decimals: 18,
    tags: ["liquid-staking", "canonical-bridged"], bridge: canonical("hyperevm-testnet", HEVM_MORE.kmHYPE),
    evidence: `${READ_BACK} on 99801 and 998; ${CANONICAL_PAIR}; l1Address() = 0x6a38…cfAe`,
  }),
  // App-specific test stables on Elysium testnet: unbacked, not canonical USDC, never priced as USDC.
  // Mock USDC 0xcC62…54d9 calls itself "USDC" and stays out on purpose: it is a look-alike of canonical USDC.
  erc20({
    network: "elysium-testnet", address: "0x852043605E2F2F326F6Bed69E5e5Baf970366473", symbol: "tUSDC", name: "Test USDC", decimals: 6,
    tags: ["test", "non-canonical"], evidence: `${READ_BACK}; Reactor Perps collateral; unbacked test stable`,
  }),
  erc20({
    network: "elysium-testnet", address: "0xa4CE6e6C719f7FB524230C367948039b078683E4", symbol: "Oxy-USDC", name: "Oxy USDC", decimals: 6,
    tags: ["test", "non-canonical"], evidence: `${READ_BACK}; Oxley quote asset; unbacked test stable`,
  }),
  erc20({
    network: "elysium-testnet", address: "0x3A3a8e3D34BB815cc211976C17ccf3376C97d750", symbol: "PLUMBUSD", name: "Plumbline Demo Dollar", decimals: 6,
    tags: ["test", "non-canonical"], evidence: `${READ_BACK}; Plumbline demo stable; unbacked test stable`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM_MORE.UETH, symbol: "UETH", name: "Unit Ethereum", decimals: 18, group: "ETH",
    tags: ["eth", "core-linked"], bridge: canonical("elysium-testnet", ELY_MORE.UETH), coreToken: CORE_TESTNET_UETH,
    evidence: `${READ_BACK}; spotMeta UETH index 1242 evmContract = this address`,
  }),
  erc20({
    network: "hyperevm-testnet", address: HEVM_MORE.kmHYPE, symbol: "kmHYPE", name: "kMarkets LST", decimals: 18,
    tags: ["liquid-staking"], bridge: canonical("elysium-testnet", ELY_MORE.kmHYPE), evidence: `${READ_BACK}; canonical L1 token of Elysium kmHYPE`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.WHYPE, symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, group: "HYPE",
    tags: ["wrapped", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0x5555555555555555555555555555555555555555"),
    evidence: `${L1_ANCHORED} (WETH gateway 0x4ADe…91EB); networks.ts wrappedNative`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.USDC, symbol: "USDC", name: "USDC", decimals: 6, group: "USDC",
    tags: ["stablecoin", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0xb88339CB7199b77E23DB6E890353E22632Ba630f"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.kHYPE, symbol: "kHYPE", name: "Kinetiq Staked HYPE", decimals: 18,
    tags: ["liquid-staking", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0xfD739d4e423301CE9385c1fb8850539D657C296D"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.KNTQ, symbol: "KNTQ", name: "Kinetiq Governance Token", decimals: 18,
    tags: ["governance", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0x000000000000780555bD0BCA3791f89f9542c2d6"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.USDH, symbol: "USDH", name: "USDH", decimals: 6, group: "USDH",
    tags: ["stablecoin", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0x111111a1a0667d36bD57c0A9f569b98057111111"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.UBTC, symbol: "UBTC", name: "Unit Bitcoin", decimals: 8, group: "BTC",
    tags: ["btc", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
  erc20({
    network: "elysium-mainnet", address: ELY_MAINNET.UETH, symbol: "UETH", name: "Unit Ethereum", decimals: 18, group: "ETH",
    tags: ["eth", "canonical-bridged"], bridge: canonical("hyperevm-mainnet", "0xBe6727B535545C67d5cAa73dEa54865B92CF7907"),
    evidence: `${L1_ANCHORED} (standard gateway 0xd97B…122c)`,
  }),
]);

const BY_ID = new Map<string, TokenDescriptor>(TOKENS.map((token) => [token.id.toLowerCase(), token]));

export function getToken(id: string): TokenDescriptor | null {
  return BY_ID.get(id.toLowerCase()) ?? null;
}

export function tokensFor(network: NetworkKey): TokenDescriptor[] {
  return TOKENS.filter((token) => token.network === network);
}

export function nativeToken(network: NetworkKey): TokenDescriptor | null {
  return TOKENS.find((token) => token.network === network && token.kind === "native") ?? null;
}

export function tokenByAddress(network: NetworkKey, address: string): TokenDescriptor | null {
  if (!isEvmAddress(address)) return null;
  return TOKENS.find((token) => token.network === network && token.address !== null && sameAddress(token.address, address)) ?? null;
}

/**
 * Finds a registry token on one network by address, symbol or alias. Symbols
 * are case-insensitive; an exact symbol always beats an alias (`USDT` is the
 * alias of USDT0). Never looks at other networks.
 */
export function findToken(network: NetworkKey, symbolOrAddress: string): TokenDescriptor | null {
  const wanted = symbolOrAddress.trim();
  if (wanted.startsWith("0x")) return tokenByAddress(network, wanted);
  const parsed = parseAssetId(wanted);
  if (parsed) return parsed.network.key === network ? getToken(wanted) : null;
  const upper = wanted.toUpperCase();
  const candidates = tokensFor(network);
  return (
    candidates.find((token) => token.symbol.toUpperCase() === upper) ??
    candidates.find((token) => (token.aliases ?? []).some((alias) => alias.toUpperCase() === upper)) ??
    null
  );
}

/** The other side of a token's bridge route, when the registry lists it. */
export function counterpartToken(token: TokenDescriptor): TokenDescriptor | null {
  const counterpart = token.bridge?.counterpart;
  if (!counterpart) return null;
  return counterpart.address === null ? nativeToken(counterpart.network) : tokenByAddress(counterpart.network, counterpart.address);
}

/** The registry token on a HyperEVM network linked to HyperCore spot token `index`. */
export function tokenForCoreIndex(network: NetworkKey, index: number): TokenDescriptor | null {
  return TOKENS.find((token) => token.network === network && token.coreToken?.index === index) ?? null;
}

/**
 * HyperEVM address a linked token is sent to so HyperCore credits it
 * (`0x2222…2222` for HYPE, `0x20…<index>` for other spot tokens). Null for unlinked tokens.
 */
export function coreSystemAddress(token: TokenDescriptor): string | null {
  if (!token.coreToken) return null;
  return token.kind === "native" ? HYPE_SYSTEM_ADDRESS : spotSystemAddress(token.coreToken.index);
}

/* ------------------------------------------------------------- look-alikes */

/** Visually confusable characters folded before comparing names (Cyrillic, Greek, ₮, digits). */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S", "Т": "T", "Х": "X", "У": "Y",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  "₮": "T", "0": "O", "1": "I",
});

/** Upper-case, NFKC, confusables folded, non-alphanumerics removed: "USD₮0" and "usdt0" both fold to "USDTO". */
export function foldTokenName(value: string): string {
  let out = "";
  for (const char of value.normalize("NFKC").toUpperCase()) {
    const folded = CONFUSABLES[char] ?? char;
    if (/[A-Z0-9]/u.test(folded)) out += folded;
  }
  return out;
}

export type TokenTrust =
  | { readonly status: "verified"; readonly token: TokenDescriptor }
  | { readonly status: "lookalike"; readonly lookalikeOf: TokenDescriptor; readonly warning: string }
  | { readonly status: "unverified"; readonly warning: string };

/**
 * Verdict for a token met on a network (a pool, a balance, a paste): a
 * registry address is verified; an unknown address whose symbol or name
 * folds to a registry token's is a look-alike; anything else is unverified.
 */
export function assessToken(input: { readonly network: NetworkKey; readonly address: string; readonly symbol?: string; readonly name?: string }): TokenTrust {
  const listed = tokenByAddress(input.network, input.address);
  if (listed) return { status: "verified", token: listed };
  const names = [input.symbol, input.name].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map(foldTokenName);
  const lookalikeOf = names.length === 0
    ? undefined
    : tokensFor(input.network).find((token) => {
        const own = [token.symbol, token.name, ...(token.aliases ?? [])].map(foldTokenName);
        return names.some((name) => name.length > 0 && own.includes(name));
      });
  if (lookalikeOf) {
    const where = lookalikeOf.address ?? "the native gas asset";
    return {
      status: "lookalike",
      lookalikeOf,
      warning: `This token calls itself ${input.symbol ?? input.name} but is not ${lookalikeOf.symbol} (${where}). Look-alike tokens exist on ${NETWORKS[input.network].name}: check the address before trading it.`,
    };
  }
  return { status: "unverified", warning: `Not in Elyia's verified token list for ${NETWORKS[input.network].name}. Check the address before trading it.` };
}
