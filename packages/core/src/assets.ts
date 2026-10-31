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
  toChecksumAddress,
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
  | "non-canonical"
  /** A protocol's own token (KALOS); test value only on testnets. */
  | "protocol-token"
  /** ERC-4626 vault share (stKALOS). */
  | "vault-share";

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
  // Protocol tokens the census found in use (2026-10-31): Kalos V3 pools quote KALOS against canonical WHYPE and USDC.
  erc20({
    network: "elysium-testnet", address: "0x8a2201953AF29e8BE7700bcB53dA3ce5caD18726", symbol: "KALOS", name: "KALOS", decimals: 18,
    tags: ["protocol-token", "test"],
    evidence: "name/symbol/decimals read by eth_call on 2026-10-31 (eth_getCode 1785 B); token0 of the Kalos V3 KALOS/WHYPE pools (factory 0x520b…7893); asset() of stKALOS",
  }),
  erc20({
    network: "elysium-testnet", address: "0xa7531D7bE19f29B991d97eaA17b034715a835e35", symbol: "stKALOS", name: "Staked KALOS", decimals: 24,
    tags: ["vault-share", "test"],
    evidence: "name/symbol/decimals read by eth_call on 2026-10-31 (eth_getCode 5915 B; 24 decimals: ERC-4626 decimals offset); asset() = KALOS 0x8a22…8726 and totalAssets() read by eth_call (census)",
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

/* ---------------------------------------------- flagged (known) tokens */

/** lookalike: copies a registry token's name or symbol; suspicious: imitates a brand, or is otherwise risky to show as authentic. */
export type FlagTag = "lookalike" | "suspicious" | "mock" | "impersonation" | "deprecated";

export const FLAG_TAGS: readonly FlagTag[] = Object.freeze(["lookalike", "suspicious", "mock", "impersonation", "deprecated"]);

/**
 * A real contract the census flagged (2026-10-31): a wrapped-HYPE, USDC,
 * kHYPE or test-token look-alike, or a brand impersonation (NFT copies of
 * blue chips, a Franklin Templeton product name). Never routable, never
 * priced as what it imitates; listed so every surface can warn by address.
 */
export interface FlaggedToken {
  readonly id: AssetId;
  readonly network: NetworkKey;
  /** EIP-55. */
  readonly address: EvmAddress;
  readonly standard: "erc20" | "erc721";
  /** As read on chain; null when the contract has no such getter. */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  /** What it imitates, in words ("WHYPE", "Bored Ape Yacht Club"). */
  readonly imitates: string;
  /** The registry token symbol on the same network it imitates, when there is one. */
  readonly imitatesSymbol?: string;
  /** Registry protocol that deployed or uses it. */
  readonly protocol?: string;
  readonly tags: readonly FlagTag[];
  readonly reason: string;
  readonly evidence: string;
}

function flag(input: Omit<FlaggedToken, "id">): FlaggedToken {
  return { ...input, id: erc20AssetId(input.network, input.address) };
}

export const FLAGGED_TOKENS: readonly FlaggedToken[] = Object.freeze([
  flag({ network: "elysium-testnet", address: "0xfAF33d5c9244eBA93E7Ee811583E580b4614867e", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "signal", tags: ["lookalike"], reason: "Wrapped-native deployed by the Signal deployer; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2041 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x757a34dd7b411546C6dd8f510B52e4381102f9B0", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "perpme", tags: ["lookalike"], reason: "PerpMe router WETH9; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2116 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x41051f27c609dB70af05b7128f15155Dc8E49Ac7", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "kalos-v3", tags: ["lookalike"], reason: "Kalos' own wrapped HYPE (second router); not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 1789 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xe44b27113D4b947c0B1bDf4a93878D0e115f4bdD", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "cloak", tags: ["lookalike"], reason: "Cloak's wrapped HYPE; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 1740 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xA5b72796E5bf80443DC134F3c8a1cc97dcCC39B9", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "marketlab", tags: ["lookalike"], reason: "MarketLab's wrapped HYPE; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2495 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xfF5681eB95bBaCfbB334F80fCDBc31fB59F22332", standard: "erc20", symbol: "WETH", name: "Wrapped Ether", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "dex-da-costa", tags: ["lookalike"], reason: "Dex Da Costa router WETH (\"Wrapped Ether\" wrapping HYPE); not canonical WHYPE 0xCD57…F234; Cheshire's \"wHYPE\" vault holds it", evidence: "eth_getCode 1871 B and name \"Wrapped Ether\", symbol \"WETH\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x8FEdA963AA318dC94403A413AA94271588B92d64", standard: "erc20", symbol: "WNATIVE", name: "Wrapped Native", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "hexswap", tags: ["lookalike"], reason: "HexSwap wrapped native; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2045 B and name \"Wrapped Native\", symbol \"WNATIVE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x517F12D5D17C4755FbDf988Fe9Cc24334c3314c7", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Calls itself Wrapped HYPE; not canonical WHYPE 0xCD57…F234; no issuer identified", evidence: "eth_getCode 2948 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xD20b24f05930f114100D108a481c4eC022F40DaA", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "chainzy", tags: ["lookalike"], reason: "Calls itself Wrapped HYPE (used by Chainzy); not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 3845 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xbdfe22e261e721d040e2ee4eb5eab5F4e65B2965", standard: "erc721", symbol: null, name: null, decimals: null, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "unbranded-v3-0xd230", tags: ["lookalike"], reason: "WETH9 of the unbranded V3 stack 0xd230…; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 11153 B and name null, symbol null read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xB74118A15E65757DA3f3365cC7357Dd7b9b6b926", standard: "erc20", symbol: "WNATIVE", name: "Wrapped Native", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Wrapped Native; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2045 B and name \"Wrapped Native\", symbol \"WNATIVE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x6C00e2CdB399FCE17E4BEfb1c13DfBD40E4b9eb8", standard: "erc20", symbol: "WNATIVE", name: "Wrapped Native", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Wrapped Native; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2045 B and name \"Wrapped Native\", symbol \"WNATIVE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x80d94D0b1c51b3AaDa498b995e5Fe488272FcaCf", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "elypad", tags: ["lookalike"], reason: "Elypad's wrapped native (Conduit-verified source); not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 1989 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x6081fCBEaE55d6A781c17CfA43b3095aDEa8E955", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Calls itself Wrapped HYPE; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 3804 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xe28DF26994d1449755f8fAd867c545877CD4dA3B", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Calls itself Wrapped HYPE; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 3914 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xf4ee3103c2f380be0364a4B87a7C6A8B2cD3B1e4", standard: "erc20", symbol: "wHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "Calls itself wHYPE; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 2520 B and name \"Wrapped HYPE\", symbol \"wHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x9cD0a6Aa10F92998E07b45a03da4063F0A11b0b8", standard: "erc20", symbol: "WETH", name: "Wrapped Ether", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", tags: ["lookalike"], reason: "\"Wrapped Ether\" on a HYPE-gas chain; not canonical WHYPE 0xCD57…F234", evidence: "eth_getCode 3204 B and name \"Wrapped Ether\", symbol \"WETH\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-mainnet", address: "0xaeb7eDE82165BB12Ea5c0C80ce8c0a0d05bCe6af", standard: "erc20", symbol: "WHYPE", name: "Wrapped HYPE", decimals: 18, imitates: "WHYPE", imitatesSymbol: "WHYPE", protocol: "supercolony", tags: ["lookalike"], reason: "Supercolony's own Wrapped HYPE on the private mainnet; not canonical WHYPE 0xbA87…5E81", evidence: "eth_getCode 1789 B and name \"Wrapped HYPE\", symbol \"WHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x1Fa390BE3732E758cd4Ffb2B18234803320c7a8c", standard: "erc20", symbol: "kHYPE", name: "Kinetiq Staked HYPE (Elara testnet)", decimals: 18, imitates: "kHYPE", imitatesSymbol: "kHYPE", protocol: "elara-khype-vault", tags: ["lookalike","mock","suspicious"], reason: "\"Kinetiq Staked HYPE (Elara testnet)\" reuses Kinetiq's name and symbol; not Kinetiq's kHYPE 0xe26E…54dc; backs the Elara kHYPE Vault", evidence: "eth_getCode 2792 B and name \"Kinetiq Staked HYPE (Elara testnet)\", symbol \"kHYPE\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xe83c3630CaB1c3d1d3B19A1F6eE393618C690C7b", standard: "erc20", symbol: "USDC", name: "Test USDC", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", protocol: "neuriio", tags: ["lookalike","mock"], reason: "\"Test USDC\" (Neuriio quote token), unbacked; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 3562 B and name \"Test USDC\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xcC6252d121Ba670e32Fad87f473201c810bF54d9", standard: "erc20", symbol: "USDC", name: "Mock USDC (testnet, no dollar backing)", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "\"Mock USDC (testnet, no dollar backing)\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2695 B and name \"Mock USDC (testnet, no dollar backing)\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x34bc28dEE50b9fC156F8539D5f8335eCD479a84c", standard: "erc20", symbol: "USDC", name: "Mock USDC (testnet, no dollar backing)", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "\"Mock USDC (testnet, no dollar backing)\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2695 B and name \"Mock USDC (testnet, no dollar backing)\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x4b4fb5C5794F0c821464956374cC5872D5F0f140", standard: "erc20", symbol: "USDC", name: "Mock USDC (testnet, no dollar backing)", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "\"Mock USDC (testnet, no dollar backing)\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2695 B and name \"Mock USDC (testnet, no dollar backing)\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x388Eb6C41075A87096f763F1A4aa37eac0887cab", standard: "erc20", symbol: "USDC", name: "Mock USD Coin", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "\"Mock USD Coin\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 3845 B and name \"Mock USD Coin\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x306eB30576814505df6cb0B35e4F4bfbACEeD54c", standard: "erc20", symbol: "mUSDC", name: "Mock USDC (Elysium testnet)", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "mUSDC mock; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2018 B and name \"Mock USDC (Elysium testnet)\", symbol \"mUSDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xEAfc63BB36613919D4b2497Ce7bB02Da204AD352", standard: "erc20", symbol: "MUSDC", name: "Mock USDC", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "MUSDC mock; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 3271 B and name \"Mock USDC\", symbol \"MUSDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x7C9a5b65f749d2a9670614E2b358cFbB2ce0e967", standard: "erc20", symbol: "USDC", name: "USD Coin (Stoa test)", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", protocol: "stoa", tags: ["lookalike","mock"], reason: "\"USD Coin (Stoa test)\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2178 B and name \"USD Coin (Stoa test)\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x4B71068aE625373ACe4B9D38AabD102463AB7650", standard: "erc20", symbol: "USDC", name: "USDC Test Token", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"USDC Test Token\" mock; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 3884 B and name \"USDC Test Token\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0x4B71068aE625373ACe4B9D38AabD102463AB7650", standard: "erc20", symbol: "USDC", name: "USDC Test Token", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"USDC Test Token\" mock (same address on 998); not canonical USDC 0x2B33…D8Ab", evidence: "eth_getCode 3884 B and name \"USDC Test Token\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xB8FCcFeaAfe68f2b8364FEffad5bF20E72261597", standard: "erc20", symbol: "USDC", name: "USDC Test Token", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", tags: ["lookalike","mock"], reason: "\"USDC Test Token\" with symbol USDC; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 835 B and name \"USDC Test Token\", symbol \"USDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x7f2fd233911c4078D04C56d9d8E8F844672d8393", standard: "erc20", symbol: "tUSDC", name: "Elysium Paper Test USD", decimals: 6, imitates: "USDC", imitatesSymbol: "USDC", protocol: "klash", tags: ["lookalike","mock"], reason: "Klash \"Elysium Paper Test USD\" (tUSDC), unbacked; not canonical USDC 0x7D29…47b2", evidence: "eth_getCode 2524 B and name \"Elysium Paper Test USD\", symbol \"tUSDC\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xBD48f69E2d7709b8A3b5595305193069E64Afc3E", standard: "erc20", symbol: "USDT", name: "Tether USD", decimals: 6, imitates: "USDT0", imitatesSymbol: "USDT0", protocol: "hexswap", tags: ["lookalike","mock"], reason: "HexSwap test \"Tether USD\" (USDT); not USD₮0 0xC775…7deE", evidence: "eth_getCode 2456 B and name \"Tether USD\", symbol \"USDT\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xF04e426488A8679D6888ec9FB4922a98Dd2c17b0", standard: "erc20", symbol: "USDT", name: "Tether USD", decimals: 6, imitates: "USDT0", imitatesSymbol: "USDT0", protocol: "hexswap", tags: ["lookalike","mock"], reason: "HexSwap test \"Tether USD\" (USDT); not USD₮0 0xC775…7deE", evidence: "eth_getCode 2456 B and name \"Tether USD\", symbol \"USDT\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xb256D6267473e644eeC13f10ABFfFaE3589E7d9D", standard: "erc20", symbol: "USDT", name: "USDT Test Token", decimals: 6, imitates: "USDT0", imitatesSymbol: "USDT0", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"USDT Test Token\" mock; not USD₮0 0xC775…7deE", evidence: "eth_getCode 3884 B and name \"USDT Test Token\", symbol \"USDT\", decimals 6 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xB3cb5Bdb35A96cE535CF6710AA11DADEdaD7D6B7", standard: "erc20", symbol: "BTC", name: "Bitcoin", decimals: 18, imitates: "BTC", protocol: "hexswap", tags: ["lookalike","mock"], reason: "HexSwap test \"Bitcoin\" (BTC); no BTC is bridged to Elysium testnet", evidence: "eth_getCode 2456 B and name \"Bitcoin\", symbol \"BTC\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x1371F36937ac81A1c18EBacC27BE95BDfeE2C79D", standard: "erc20", symbol: "BTC", name: "Bitcoin", decimals: 18, imitates: "BTC", protocol: "hexswap", tags: ["lookalike","mock"], reason: "HexSwap test \"Bitcoin\" (BTC); no BTC is bridged to Elysium testnet", evidence: "eth_getCode 2456 B and name \"Bitcoin\", symbol \"BTC\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xe22611B5707826ABc6AD37074f99519642571D53", standard: "erc20", symbol: "NEST", name: "Nest Test Token", decimals: 18, imitates: "NEST", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Nest Test Token\" mock; not Nest's token", evidence: "eth_getCode 3884 B and name \"Nest Test Token\", symbol \"NEST\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x7eDd34d6Cc349b68Beec26d5E8891D338d7f99a2", standard: "erc20", symbol: "KNTQ", name: "Kinetiq Test Token", decimals: 18, imitates: "KNTQ", imitatesSymbol: "KNTQ", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Kinetiq Test Token\" mock; not KNTQ 0x9856…ED19", evidence: "eth_getCode 3884 B and name \"Kinetiq Test Token\", symbol \"KNTQ\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xa912405b35A50Ea7147FaEbd4C3C46f2aC84a922", standard: "erc20", symbol: "PURR", name: "Purr Test Token", decimals: 18, imitates: "PURR", imitatesSymbol: "PURR", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Purr Test Token\" mock; not PURR 0x5688…2Bdd", evidence: "eth_getCode 3884 B and name \"Purr Test Token\", symbol \"PURR\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x5C297c771fe9768F3EE5d69d29B50A722165e903", standard: "erc20", symbol: "SIGNAL", name: "Signal Test Token", decimals: 18, imitates: "SIGNAL", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Signal Test Token\" mock; not Signal's token", evidence: "eth_getCode 3884 B and name \"Signal Test Token\", symbol \"SIGNAL\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x4BE28040449D5FD7836EA8e0aC9103A444909f7A", standard: "erc20", symbol: "PERPME", name: "PerpMe Test Token", decimals: 18, imitates: "PERPME", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"PerpMe Test Token\" mock; not PerpMe's token", evidence: "eth_getCode 3884 B and name \"PerpMe Test Token\", symbol \"PERPME\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0xe22611B5707826ABc6AD37074f99519642571D53", standard: "erc20", symbol: "NEST", name: "Nest Test Token", decimals: 18, imitates: "NEST", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Nest Test Token\" mock (same address on 998)", evidence: "eth_getCode 3884 B and name \"Nest Test Token\", symbol \"NEST\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0x7eDd34d6Cc349b68Beec26d5E8891D338d7f99a2", standard: "erc20", symbol: "KNTQ", name: "Kinetiq Test Token", decimals: 18, imitates: "KNTQ", imitatesSymbol: "KNTQ", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Kinetiq Test Token\" mock (same address on 998); not KNTQ 0xf57E…1D32", evidence: "eth_getCode 3884 B and name \"Kinetiq Test Token\", symbol \"KNTQ\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0xa912405b35A50Ea7147FaEbd4C3C46f2aC84a922", standard: "erc20", symbol: "PURR", name: "Purr Test Token", decimals: 18, imitates: "PURR", imitatesSymbol: "PURR", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Purr Test Token\" mock (same address on 998); not PURR 0xa905…fD57", evidence: "eth_getCode 3884 B and name \"Purr Test Token\", symbol \"PURR\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0x5C297c771fe9768F3EE5d69d29B50A722165e903", standard: "erc20", symbol: "SIGNAL", name: "Signal Test Token", decimals: 18, imitates: "SIGNAL", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"Signal Test Token\" mock (same address on 998)", evidence: "eth_getCode 3884 B and name \"Signal Test Token\", symbol \"SIGNAL\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "hyperevm-testnet", address: "0x4BE28040449D5FD7836EA8e0aC9103A444909f7A", standard: "erc20", symbol: "PERPME", name: "PerpMe Test Token", decimals: 18, imitates: "PERPME", protocol: "elypact", tags: ["lookalike","mock"], reason: "Elypact \"PerpMe Test Token\" mock (same address on 998)", evidence: "eth_getCode 3884 B and name \"PerpMe Test Token\", symbol \"PERPME\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xD7988a624b03D2b1D3567359aF57f03464953237", standard: "erc20", symbol: "YLDEX", name: "Franklin ClearBridge Enhanced In", decimals: 18, imitates: "Franklin Templeton / ClearBridge", protocol: "yldex-franklin-lookalike", tags: ["suspicious","impersonation"], reason: "\"Franklin ClearBridge Enhanced In\" (YLDEX) imitates a Franklin Templeton product name; no issuer found", evidence: "eth_getCode 15104 B and name \"Franklin ClearBridge Enhanced In\", symbol \"YLDEX\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xE82aA3f5f26BaEA08Ee0C38C165debAC54742278", standard: "erc721", symbol: "DAI", name: "DAIMONS", decimals: null, imitates: "DAI", tags: ["suspicious","impersonation"], reason: "\"DAIMONS\" uses the symbol DAI", evidence: "eth_getCode 22684 B and name \"DAIMONS\", symbol \"DAI\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xecB6091a66d9DCf7A288D7C8a030A5cEDB13FcF6", standard: "erc721", symbol: "APE", name: "Bored Apes Yacht Club", decimals: null, imitates: "Bored Ape Yacht Club", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Bored Ape Yacht Club, minted by the KALOS deployer for the Kalos marketplace; not the real collection", evidence: "eth_getCode 22684 B and name \"Bored Apes Yacht Club\", symbol \"APE\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xf5A5A4792490436eB2838385CC82e481609c92bD", standard: "erc721", symbol: "PUNK", name: "Crypto Punks", decimals: null, imitates: "CryptoPunks", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after CryptoPunks, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Crypto Punks\", symbol \"PUNK\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xD0E627cd8E3197503cC1283FdB7F97fB3d6C5D95", standard: "erc721", symbol: "AZUKI", name: "Azuki", decimals: null, imitates: "Azuki", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Azuki, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Azuki\", symbol \"AZUKI\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xD9FCb57FCA2323845921260175F2b35422a1f458", standard: "erc721", symbol: "PUDGY", name: "Pudgy Penguins", decimals: null, imitates: "Pudgy Penguins", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Pudgy Penguins, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Pudgy Penguins\", symbol \"PUDGY\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x2A4dd6691F0Ca33d961e67cBBB969F668c9B70f8", standard: "erc721", symbol: "DEGOD", name: "DeGods", decimals: null, imitates: "DeGods", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after DeGods, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"DeGods\", symbol \"DEGOD\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x29061d3603ecdD2677F7eEFeF9F3F2ef5b8A771D", standard: "erc721", symbol: "MAPE", name: "Mutant Ape Yacht Club", decimals: null, imitates: "Mutant Ape Yacht Club", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Mutant Ape Yacht Club, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Mutant Ape Yacht Club\", symbol \"MAPE\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x46571e5B8CdF2F7693684FdDBb6D01Ec1D8b10Df", standard: "erc721", symbol: "OTHR", name: "Otherdeed for Otherside", decimals: null, imitates: "Otherdeed for Otherside", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Otherdeed, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Otherdeed for Otherside\", symbol \"OTHR\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xc4bfCB3b06b7de56E63E358EFd41432f82183bEd", standard: "erc721", symbol: "MILADY", name: "Milady Maker", decimals: null, imitates: "Milady Maker", protocol: "kalos-marketplace", tags: ["suspicious","impersonation"], reason: "Collection named after Milady Maker, minted by the KALOS deployer; not the real collection", evidence: "eth_getCode 22684 B and name \"Milady Maker\", symbol \"MILADY\" read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x0aB767D838C059ff8F8d01799478E5eE5F09039C", standard: "erc721", symbol: "MILADY", name: "Milady Maker", decimals: null, imitates: "Milady Maker", tags: ["suspicious","impersonation"], reason: "Another contract named Milady Maker; not the real collection", evidence: "eth_getCode 4321 B and name \"Milady Maker\", symbol \"MILADY\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0xaeC35586B8a6C1F71B313966570Ee2DDC96542B6", standard: "erc721", symbol: "MILADY", name: "Milady Maker", decimals: null, imitates: "Milady Maker", tags: ["suspicious","impersonation"], reason: "Another contract named Milady Maker; not the real collection", evidence: "eth_getCode 15104 B and name \"Milady Maker\", symbol \"MILADY\", decimals 18 read by eth_call on 2026-10-31" }),
  flag({ network: "elysium-testnet", address: "0x245bFe8c6c2429f6a7743d53377Ae39b98500459", standard: "erc20", symbol: "ELYS", name: "Elysium Test Token", decimals: 18, imitates: "Elysium gas (HYPE)", protocol: "elys-faucet-token", tags: ["suspicious","deprecated"], reason: "\"Elysium Test Token\" (ELYS) from a community faucet that went offline; ELYS is not HYPE, Elysium's gas asset", evidence: "eth_getCode 5280 B and name \"Elysium Test Token\", symbol \"ELYS\", decimals 18 read by eth_call on 2026-10-31" }),
]);

export interface FlaggedTokenIssue {
  readonly address: string;
  readonly message: string;
}

/** Checks flagged rows against the registry: checksummed, unique, never a registry token, imitation resolvable. */
export function validateFlaggedTokens(rows: readonly FlaggedToken[], tokens: readonly TokenDescriptor[] = TOKENS): FlaggedTokenIssue[] {
  const issues: FlaggedTokenIssue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const fail = (message: string) => issues.push({ address: `${row.network}:${row.address}`, message });
    if (!isEvmAddress(row.address) || toChecksumAddress(row.address) !== row.address) fail("address must be EIP-55 checksummed");
    const key = `${row.network}|${row.address.toLowerCase()}`;
    if (seen.has(key)) fail("listed twice");
    seen.add(key);
    if (tokens.some((token) => token.network === row.network && token.address !== null && sameAddress(token.address, row.address))) fail("a registry token cannot be flagged");
    if (!row.tags.includes("lookalike") && !row.tags.includes("suspicious")) fail("tag it lookalike or suspicious");
    for (const tag of row.tags) if (!FLAG_TAGS.includes(tag)) fail(`unknown tag ${tag}`);
    if (row.imitatesSymbol !== undefined && !tokens.some((token) => token.network === row.network && token.symbol === row.imitatesSymbol)) fail(`imitates ${row.imitatesSymbol}, which is not a registry token on ${row.network}`);
    if (row.standard === "erc20" && row.decimals === null) fail("an ERC-20 needs decimals");
    if (!row.reason.trim() || !row.evidence.trim() || !row.imitates.trim()) fail("reason, evidence and imitates are required");
  }
  return issues;
}

{
  const issues = validateFlaggedTokens(FLAGGED_TOKENS);
  if (issues.length > 0) throw new Error(`Invalid flagged tokens: ${issues.map((issue) => `${issue.address}: ${issue.message}`).join("; ")}`);
}

const FLAGGED_BY_KEY = new Map(FLAGGED_TOKENS.map((row) => [`${row.network}|${row.address.toLowerCase()}`, row]));

/** The flagged entry for an address on a network, or null. */
export function flaggedToken(network: NetworkKey, address: string): FlaggedToken | null {
  if (!isEvmAddress(address)) return null;
  return FLAGGED_BY_KEY.get(`${network}|${address.toLowerCase()}`) ?? null;
}

export function flaggedTokensFor(network?: NetworkKey): FlaggedToken[] {
  return FLAGGED_TOKENS.filter((row) => network === undefined || row.network === network);
}

function flagWarning(row: FlaggedToken): string {
  const what = row.symbol ?? row.name ?? "This contract";
  return `${what} (${row.address}) is a known ${row.tags.includes("lookalike") ? "look-alike" : "suspicious token"}: ${row.reason}. Elyia never routes or prices it.`;
}

export type TokenTrust =
  | { readonly status: "verified"; readonly token: TokenDescriptor }
  | { readonly status: "lookalike"; readonly lookalikeOf: TokenDescriptor; readonly warning: string; readonly flagged?: FlaggedToken }
  | { readonly status: "unverified"; readonly warning: string; readonly flagged?: FlaggedToken };

/**
 * Verdict for a token met on a network (a pool, a balance, a paste): a
 * registry address is verified; a flagged address carries its census
 * warning (a look-alike of the registry token it imitates, or an unverified
 * suspicious token); an unknown address whose symbol or name folds to a
 * registry token's is a look-alike; anything else is unverified.
 */
export function assessToken(input: { readonly network: NetworkKey; readonly address: string; readonly symbol?: string; readonly name?: string }): TokenTrust {
  const listed = tokenByAddress(input.network, input.address);
  if (listed) return { status: "verified", token: listed };
  const known = flaggedToken(input.network, input.address);
  if (known) {
    const imitated = known.imitatesSymbol === undefined ? null : tokensFor(input.network).find((token) => token.symbol === known.imitatesSymbol) ?? null;
    return imitated
      ? { status: "lookalike", lookalikeOf: imitated, warning: `${flagWarning(known)} The verified ${imitated.symbol} is ${imitated.address ?? "the native gas asset"}.`, flagged: known }
      : { status: "unverified", warning: flagWarning(known), flagged: known };
  }
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

export interface TokenResolution {
  /** The registry token (routable), or null. */
  readonly token: TokenDescriptor | null;
  /** Set when the query is the address of a flagged token. */
  readonly flagged: FlaggedToken | null;
  /** Why nothing routable was found, or what to watch out for. */
  readonly warning: string | null;
}

/**
 * `findToken` with warnings: a flagged address resolves to no token and its
 * census warning; a symbol that look-alikes reuse ("WHYPE", "USDC") resolves
 * to the registry token with a reminder to check the address.
 */
export function resolveToken(network: NetworkKey, symbolOrAddress: string): TokenResolution {
  const wanted = symbolOrAddress.trim();
  const token = findToken(network, wanted);
  if (token) {
    const copies = token.address === null ? 0 : FLAGGED_TOKENS.filter((row) => row.network === network && row.imitatesSymbol === token.symbol).length;
    const byAddress = wanted.startsWith("0x");
    return {
      token,
      flagged: null,
      warning: copies > 0 && !byAddress ? `${copies} known look-alike${copies === 1 ? "" : "s"} of ${token.symbol} exist on ${NETWORKS[network].name}; the verified one is ${token.address}.` : null,
    };
  }
  const known = wanted.startsWith("0x") ? flaggedToken(network, wanted) : null;
  if (known) return { token: null, flagged: known, warning: flagWarning(known) };
  return { token: null, flagged: null, warning: null };
}
