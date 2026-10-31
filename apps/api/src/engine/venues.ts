/**
 * Venue pins the execution adapters use, per network. Every address was
 * read back on-chain on 2026-10-29 (research critic §3.4, engine probes):
 * router `factory()` / `WETH9()` / `WETH()`, pool `factory()`, factory
 * `getPool` / `getPair`, and bytecode selectors. Adapters re-check the
 * factory link of every pool they quote, so a look-alike pool never routes.
 *
 * These venues are not (yet) rows of the core protocol registry; their ids
 * are stable engine ids and requests can name them with `params.venue`.
 */
import type { NetworkKey } from "@elyia/core";
import type { Address, Hex } from "viem";

/** Live state of a venue as Elyia executes it. */
export type VenueStatus = "live" | "read-only" | "unavailable";

/** Common facts every venue row carries (GET /v1/venues). */
export interface VenueFacts {
  /** Research census id (elysium-protocols.json) the venue belongs to. */
  readonly census: string;
  /**
   * Served only when the request names the venue (`protocol` / `params.venue`).
   * Such venues trade app-specific tokens that are not in the verified registry;
   * naming them is what allows those tokens to resolve (unverified).
   */
  readonly explicitOnly?: boolean;
}

export interface V3Venue extends VenueFacts {
  readonly id: string;
  readonly label: string;
  readonly network: NetworkKey;
  readonly dialect: "router01" | "router02";
  readonly router: Address;
  readonly factory: Address;
  readonly quoter: Address | null;
  /** The router's own wrapped native (WETH9()). Native HYPE routes only through it. */
  readonly wrappedNative: Address;
  /** True when `wrappedNative` is the canonical WHYPE of the network (then WHYPE pools serve native HYPE). */
  readonly canonicalWrapped: boolean;
  readonly feeTiers: readonly number[];
  readonly evidence: string;
}

export interface V2Venue extends VenueFacts {
  readonly id: string;
  readonly label: string;
  readonly network: NetworkKey;
  readonly router: Address;
  readonly factory: Address;
  readonly wrappedNative: Address;
  readonly canonicalWrapped: boolean;
  /** LP fee in basis points (Uniswap V2: 30). */
  readonly feeBps: number;
  readonly evidence: string;
}

/** Kalos V3 on Elysium testnet: v3-periphery SwapRouter v1 (deadline in the struct, multicall(bytes[])). */
export const KALOS_V3: V3Venue = {
  id: "kalos-v3",
  census: "kalos-v3",
  label: "Kalos V3",
  network: "elysium-testnet",
  dialect: "router01",
  router: "0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f",
  factory: "0x520bf060f58cee054f725877279328f5f73a7893",
  // QuoterV2 0x2b55…9149: factory() = 0x520b…7893 and WETH9() = canonical WHYPE (read back 2026-10-31).
  quoter: "0x2b555398ac8baf5d4b541ef12e565ef312739149",
  wrappedNative: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234",
  canonicalWrapped: true,
  feeTiers: [100, 500, 3000, 10000, 20000],
  evidence: "router factory() = 0x520b…7893 and WETH9() = canonical WHYPE 0xCD57…F234; WHYPE/USDC 2% pool 0x591a…b05c factory() = 0x520b…; QuoterV2 0x2b55…9149 factory() = 0x520b…, WETH9() = WHYPE; eth_simulateV1 1 HYPE -> 20,412 USDC (2026-10-29)",
};

/** HyperSwap V3 on HyperEVM testnet: SwapRouter02 (multicall(uint256,bytes[])) + QuoterV2. Its WETH9 is not 0x5555. */
export const HYPERSWAP_V3: V3Venue = {
  id: "hyperswap-v3",
  census: "hyperswap",
  label: "HyperSwap V3",
  network: "hyperevm-testnet",
  dialect: "router02",
  router: "0x51c5958ffb3e326f8d7aa945948159f1ff27e14a",
  factory: "0x22b0768972bb7f1f5ea7a8740bb8f94b32483826",
  quoter: "0x7fed8993828a61a5985f384cee8bdd42177aa263",
  wrappedNative: "0xadcb2f358eae6492f61a5f87eb8893d09391d160",
  canonicalWrapped: false,
  feeTiers: [100, 500, 3000, 10000],
  evidence: "router factory() = 0x22B0…3826, WETH9() = 0xADcb…d160 (\"Wrapped Ether\", not WHYPE 0x5555); quoter factory() = 0x22B0…; selectors exactInputSingle(SwapRouter02), multicall(uint256,bytes[]), unwrapWETH9, QuoterV2 quoteExactInputSingle present (2026-10-29)",
};

/** Dex Da Costa (Uniswap V2) on Elysium testnet. Its WETH is NOT canonical WHYPE. */
export const DEX_DA_COSTA: V2Venue = {
  id: "dex-da-costa",
  census: "dex-da-costa",
  label: "Dex Da Costa",
  network: "elysium-testnet",
  router: "0x72d435b8030a5195bdb7594edea1ff315b9994c7",
  factory: "0xfa456ad175f0bdb9285960720b4b6e8f25deb3f9",
  wrappedNative: "0xff5681eb95bbacfbb334f80fcdbc31fb59f22332",
  canonicalWrapped: false,
  feeBps: 30,
  evidence: "router WETH() = 0xfF56…2332 (\"Wrapped Ether\"), factory() = 0xFa45…b3f9; getPair(WETH, USDC) = 0xfb3a…746a; eth_simulateV1 1 HYPE -> 19,507 USDC (2026-10-29)",
};

/**
 * PerpMe V3 (v1 stack) on Elysium testnet: v3-periphery SwapRouter v1 + QuoterV2. Its WETH9 is
 * PerpMe's own "WHYPE" 0x757a…f9b0 (a look-alike of canonical WHYPE), so native HYPE routes only
 * into PerpMe's launch pools of that token. Launch tokens are not in the verified registry: the
 * venue is explicit-only (name it to trade a launch token by address).
 */
export const PERPME_V3: V3Venue = {
  id: "perpme",
  census: "perpme",
  label: "PerpMe V3",
  network: "elysium-testnet",
  dialect: "router01",
  router: "0xd218817cfcca3ae397de3a6e66889d4fb4b9e2d1",
  factory: "0x1186defcaf121da6e773425fec0814608798e792",
  quoter: "0x2a2b7645839e55a1683e7fd64436aeed5ed2793c",
  wrappedNative: "0x757a34dd7b411546c6dd8f510b52e4381102f9b0",
  canonicalWrapped: false,
  // feeAmountTickSpacing: 500 -> 10, 3000 -> 60, 10000 -> 200, 20000 -> 400 (100 not enabled).
  feeTiers: [500, 3000, 10000, 20000],
  explicitOnly: true,
  evidence: "router factory() = 0x1186…e792, WETH9() = 0x757a…f9b0 (symbol WHYPE, not canonical); QuoterV2 0x2A2b…793C factory() = 0x1186…, WETH9() = 0x757a…; census sim 0.01 HYPE -> 53,112 PERPME (2026-10-31)",
};

export const V3_VENUES: readonly V3Venue[] = [KALOS_V3, HYPERSWAP_V3, PERPME_V3];

/**
 * HexSwap (Uniswap V2 style) on Elysium testnet. Its wrapped native is `wrappedNative()` =
 * 0x8FEd…2d64 ("WNATIVE"); its pairs hold its own test tokens (HEX, a look-alike "USDT").
 * Explicit-only: never a route for real USDT.
 */
export const HEXSWAP: V2Venue = {
  id: "hexswap",
  census: "hexswap",
  label: "HexSwap",
  network: "elysium-testnet",
  router: "0x9d02c1d684389d021bf2cf73d1ba7c4652ab1f15",
  factory: "0xf5269ec7452b71aa79e5ea9d2defbceef76d2c92",
  wrappedNative: "0x8feda963aa318dc94403a413aa94271588b92d64",
  canonicalWrapped: false,
  feeBps: 30,
  explicitOnly: true,
  evidence: "router factory() = 0xf526…2c92, wrappedNative() = 0x8FEd…2d64 (WNATIVE); allPairs: HEX/WNATIVE, WNATIVE/USDT(test), LMOCK/WHYPE (2026-10-31); census sim swapExactETHForTokens HYPE -> tUSDT ok",
};

export const V2_VENUES: readonly V2Venue[] = [DEX_DA_COSTA, HEXSWAP];

/** Kinetiq StakingManager per HyperEVM network (testnet identity INFERRED: the sole kHYPE MINTER_ROLE holder). */
export const KINETIQ_STAKING: Readonly<Partial<Record<NetworkKey, { readonly manager: Address; readonly kHYPE: Address; readonly accountant: Address; readonly identity: "verified" | "inferred" }>>> = Object.freeze({
  "hyperevm-testnet": {
    manager: "0x9e4ce62b9d9a0792c56990cbea4d0a116a8a9216",
    kHYPE: "0x25ce769757c418c58e623742a43b6f65aebfef22",
    accountant: "0x78b1f56988e1fc1bb6c214e8e71dc0f43fe3df87",
    identity: "inferred",
  },
});

/** Circle CoreDepositWallet per HyperEVM network (testnet: spotMeta USDC evmContract; token() = 998 USDC). */
export const CORE_DEPOSIT_WALLET: Readonly<Partial<Record<NetworkKey, Address>>> = Object.freeze({
  "hyperevm-testnet": "0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206",
});
/** CoreDepositWallet `destinationDex`: 0 = perps (USDC margin), uint32 max = spot. */
export const CORE_DEX_PERPS = 0;
export const CORE_DEX_SPOT = 4_294_967_295;

/**
 * ERC-4626 vaults Elyia deposits into and redeems from (exact asset approval, `deposit(assets, receiver)`,
 * `redeem(shares, receiver, owner)`; quotes from `previewDeposit` / `previewRedeem`, verified by the
 * vault's Deposit / Withdraw events). Each pin's `asset()` is re-read at plan time and must match.
 */
export interface VaultVenue extends VenueFacts {
  readonly id: string;
  readonly label: string;
  readonly network: NetworkKey;
  readonly vault: Address;
  readonly shareSymbol: string;
  readonly shareDecimals: number;
  readonly asset: Address;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly warnings: readonly string[];
  readonly evidence: string;
}

/** Kalos stKALOS: KALOS staking vault (24-decimal shares, a 6-decimal offset). */
export const STKALOS_VAULT: VaultVenue = {
  id: "kalos-stkalos",
  census: "kalos-stkalos",
  label: "Kalos stKALOS",
  network: "elysium-testnet",
  vault: "0xa7531d7be19f29b991d97eaa17b034715a835e35",
  shareSymbol: "stKALOS",
  shareDecimals: 24,
  asset: "0x8a2201953af29e8be7700bcb53da3ce5cad18726",
  assetSymbol: "KALOS",
  assetDecimals: 18,
  explicitOnly: true,
  warnings: ["KALOS and stKALOS are Kalos's own testnet tokens (not in Elyia's verified list); stKALOS volume is bot-dominated."],
  evidence: "asset() = KALOS 0x8a22…8726, decimals() = 24; deposit/redeem/previewDeposit/previewRedeem in bytecode; census totalAssets 104.1M (2026-10-31)",
};

/** Cheshire USDC vault (ERC-4626 over canonical bridged USDC; brand known only from on-chain names). */
export const CHESHIRE_USDC_VAULT: VaultVenue = {
  id: "cheshire",
  census: "cheshire",
  label: "Cheshire USDC vault",
  network: "elysium-testnet",
  vault: "0xf6b3bc8b51641037ea8c7621bd8e0ed600752d4b",
  shareSymbol: "cUSDC",
  shareDecimals: 6,
  asset: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2",
  assetSymbol: "USDC",
  assetDecimals: 6,
  explicitOnly: true,
  warnings: ["Cheshire has no public website or audit; its vault holds very little (about 1.7 USDC). Treat it as an experiment."],
  evidence: "asset() = canonical USDC 0x7D29…47b2, decimals() = 6, name \"Cheshire USDC Morpho Vault\"; ERC-4626 selectors in bytecode (2026-10-31). Its wHYPE vault is NOT listed: its asset is Dex Da Costa's WETH 0xfF56…, a look-alike of WHYPE.",
};

export const VAULT_VENUES: readonly VaultVenue[] = [STKALOS_VAULT, CHESHIRE_USDC_VAULT];

/** A Morpho-Blue style market, pinned by id; the params must hash to the id (keccak256(abi.encode(params))). */
export interface LendingMarket {
  readonly id: Hex;
  readonly loanToken: Address;
  readonly loanSymbol: string;
  readonly loanDecimals: number;
  readonly collateralToken: Address;
  readonly collateralSymbol: string;
  readonly oracle: Address;
  readonly irm: Address;
  readonly lltv: bigint;
}

export interface LendingVenue extends VenueFacts {
  readonly id: string;
  readonly label: string;
  readonly network: NetworkKey;
  readonly core: Address;
  readonly markets: readonly LendingMarket[];
  readonly warnings: readonly string[];
  readonly evidence: string;
}

/**
 * "Elyra" isolated lending (useelyra.xyz; a third party, not Elyia) on Elysium testnet: a Morpho-Blue
 * style core without `idToMarketParams`. Market params were decoded from live `supply` transactions
 * and each hashes to the Supply event's market id; `market(id)` answers. Supply / withdraw of the loan
 * asset only (lending, no borrowing).
 */
export const ELYRA_LENDING: LendingVenue = {
  id: "elyra-lending",
  census: "elyra-lending",
  label: "Elyra lending (useelyra.xyz)",
  network: "elysium-testnet",
  core: "0x9e4a4632985cbfc13c7143f121ff0f99a0445bd1",
  explicitOnly: true,
  markets: [
    {
      id: "0xfe865cb12a83956acc72046f1cac4a4e0309655e2cb799b0214f1901fe895644",
      loanToken: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2",
      loanSymbol: "USDC",
      loanDecimals: 6,
      collateralToken: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234",
      collateralSymbol: "WHYPE",
      oracle: "0xc7927d427089c7f3c3db9a4464aa159cbc96525f",
      irm: "0xd29b7f39d2a4816bbe3e1ae203af1c96b9d5bf61",
      lltv: 770_000_000_000_000_000n,
    },
    {
      id: "0xae6045f0dcc8d24c8e02250d960a4d38540f31df1c46bf7a3008eaac973b89b5",
      loanToken: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234",
      loanSymbol: "WHYPE",
      loanDecimals: 18,
      collateralToken: "0x7d29d8047b905000459c0e80c34a26ceedcb47b2",
      collateralSymbol: "USDC",
      oracle: "0x84c682039310e88913ea37232cf55b186a2808e1",
      irm: "0xd29b7f39d2a4816bbe3e1ae203af1c96b9d5bf61",
      lltv: 770_000_000_000_000_000n,
    },
  ],
  warnings: ["\"Elyra\" lending is a third-party app (useelyra.xyz), not Elyia. Its contracts are unaudited testnet deployments; liquidity can be fully borrowed, which blocks withdrawals until borrowers repay."],
  evidence: "supply txs 0x035d…3e16 (USDC/WHYPE) and 0x56e1…c2a7 (WHYPE/USDC) decoded; keccak256(abi.encode(params)) = the Supply event ids 0xfe86…5644 / 0xae60…89b5; market(id) answers (2026-10-31)",
};

export const LENDING_VENUES: readonly LendingVenue[] = [ELYRA_LENDING];

/** Elysium Names (.ely) per network: `resolve(label)` answers the owner (zero when unregistered). Testnet names do not carry to mainnet. */
export const ELY_NAMES: Readonly<Partial<Record<NetworkKey, Address>>> = Object.freeze({
  "elysium-testnet": "0x13a130b336400409c956df042c128238f1486ddd",
});
export const ELY_NAMES_EVIDENCE = "ElyNames 0x13A1…6ddD: resolve(\"bona\") = 0xe49D…175e, resolve(\"bona.ely\") = 0x0 (labels only), primaryNameOf(0xe49D…) = \"bona.ely\" (2026-10-31)";

/**
 * Signal launch pools (Uniswap v4 copy, not official Uniswap) on Elysium testnet: launch tokens
 * paired with canonical WHYPE, fee 0, tick spacing 200, SignalV4Hook. Elyia buys only, through the
 * launch router's `buyNative(PoolKey, amountOutMinimum, recipient, refundTo, deadline)` (it wraps
 * msg.value into canonical WHYPE); quotes from the V4Quoter. The pool key is derived from the token
 * and must quote, or the route is refused.
 */
export const SIGNAL_V4 = {
  id: "signal",
  census: "signal",
  label: "Signal launch pools",
  network: "elysium-testnet" as NetworkKey,
  launchRouter: "0x1ec9a7e83fbfb67b478632d0a759ec64840780b4" as Address,
  quoter: "0x5b696d10d3c16e2b09eed28fd82593723b32c023" as Address,
  poolManager: "0x889a96eedb1df35a012d7e48baf7f9c780f1243b" as Address,
  hook: "0xda605da70bff4b32a9b379c614a6d9e4a09baaec" as Address,
  wrappedNative: "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234" as Address,
  fee: 0,
  tickSpacing: 200,
  explicitOnly: true,
  evidence: "live buyNative tx 0x07f5…42b1 decoded: PoolKey(token 0x8aa6…3Baf, WHYPE, fee 0, tickSpacing 200, hook 0xDa60…AAEC), min 1, recipient = refundTo = sender, deadline; V4Quoter quoteExactInputSingle(zeroForOne=false, 0.01 HYPE) = 1,591.25 tokens (2026-10-31)",
} as const;
