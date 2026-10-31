/**
 * Contract ABIs the engine encodes and decodes. Fragments are taken from the
 * Arbitrum Nitro / token-bridge sources (as shipped in @arbitrum/sdk 4.1),
 * Uniswap v3-periphery (SwapRouter v1 and SwapRouter02 / QuoterV2), Uniswap
 * V2 periphery, WETH9, Circle's CoreDepositWallet and the Kinetiq
 * StakingManager, each checked against deployed bytecode selectors on
 * 2026-10-29 (Elysium 99801, HyperEVM 998).
 */
import { erc20Abi, parseAbi } from "viem";

export { erc20Abi };

export const INBOX_ABI = parseAbi([
  "function depositEth() payable returns (uint256)",
  "function calculateRetryableSubmissionFee(uint256 dataLength, uint256 baseFee) view returns (uint256)",
  "event InboxMessageDelivered(uint256 indexed messageNum, bytes data)",
]);

export const BRIDGE_ABI = parseAbi([
  "event MessageDelivered(uint256 indexed messageIndex, bytes32 indexed beforeInboxAcc, address inbox, uint8 kind, address sender, bytes32 messageDataHash, uint256 baseFeeL1, uint64 timestamp)",
]);

export const L1_GATEWAY_ROUTER_ABI = parseAbi([
  "function getGateway(address token) view returns (address)",
  "function calculateL2TokenAddress(address l1Token) view returns (address)",
  "function outboundTransferCustomRefund(address token, address refundTo, address to, uint256 amount, uint256 maxGas, uint256 gasPriceBid, bytes data) payable returns (bytes)",
  "function outboundTransfer(address token, address to, uint256 amount, uint256 maxGas, uint256 gasPriceBid, bytes data) payable returns (bytes)",
]);

export const L1_GATEWAY_ABI = parseAbi([
  "function counterpartGateway() view returns (address)",
  "function getOutboundCalldata(address token, address from, address to, uint256 amount, bytes data) view returns (bytes)",
  "event DepositInitiated(address l1Token, address indexed from, address indexed to, uint256 indexed sequenceNumber, uint256 amount)",
]);

export const L2_GATEWAY_ROUTER_ABI = parseAbi([
  "function getGateway(address token) view returns (address)",
  "function calculateL2TokenAddress(address l1Token) view returns (address)",
  "function outboundTransfer(address l1Token, address to, uint256 amount, uint256 maxGas, uint256 gasPriceBid, bytes data) payable returns (bytes)",
]);

export const L2_GATEWAY_ABI = parseAbi([
  "event WithdrawalInitiated(address l1Token, address indexed from, address indexed to, uint256 indexed l2ToL1Id, uint256 exitNum, uint256 amount)",
  "event DepositFinalized(address indexed l1Token, address indexed from, address indexed to, uint256 amount)",
]);

export const ARB_SYS_ABI = parseAbi([
  "function withdrawEth(address destination) payable returns (uint256)",
  "function arbBlockNumber() view returns (uint256)",
  "event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)",
]);

export const ARB_RETRYABLE_TX_ABI = parseAbi([
  "function redeem(bytes32 ticketId) returns (bytes32)",
  "function getTimeout(bytes32 ticketId) view returns (uint256)",
  "function getLifetime() view returns (uint256)",
  "event TicketCreated(bytes32 indexed ticketId)",
  "event RedeemScheduled(bytes32 indexed ticketId, bytes32 indexed retryTxHash, uint64 indexed sequenceNum, uint64 donatedGas, address gasDonor, uint256 maxRefund, uint256 submissionFeeRefund)",
  "event Canceled(bytes32 indexed ticketId)",
]);

export const NODE_INTERFACE_ABI = parseAbi([
  "function estimateRetryableTicket(address sender, uint256 deposit, address to, uint256 l2CallValue, address excessFeeRefundAddress, address callValueRefundAddress, bytes data)",
  "function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)",
]);

export const OUTBOX_ABI = parseAbi([
  "function executeTransaction(bytes32[] proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block, uint256 l2Timestamp, uint256 value, bytes data)",
  "function isSpent(uint256 index) view returns (bool)",
  "function roots(bytes32 root) view returns (bytes32)",
  "event OutBoxTransactionExecuted(address indexed to, address indexed l2Sender, uint256 indexed zero, uint256 transactionIndex)",
]);

/** BoLD rollup (Elysium settles to HyperEVM with BoLD assertions). */
export const ROLLUP_ABI = [
  ...parseAbi([
    "function confirmPeriodBlocks() view returns (uint64)",
    "function latestConfirmed() view returns (bytes32)",
    "function getAssertion(bytes32 assertionHash) view returns ((uint64 firstChildBlock, uint64 secondChildBlock, uint64 createdAtBlock, bool isFirstChild, uint8 status, bytes32 configHash))",
  ]),
  {
    type: "event",
    name: "AssertionCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "assertionHash", type: "bytes32" },
      { indexed: true, name: "parentAssertionHash", type: "bytes32" },
      {
        indexed: false,
        name: "assertion",
        type: "tuple",
        components: [
          {
            name: "beforeStateData",
            type: "tuple",
            components: [
              { name: "prevPrevAssertionHash", type: "bytes32" },
              { name: "sequencerBatchAcc", type: "bytes32" },
              {
                name: "configData",
                type: "tuple",
                components: [
                  { name: "wasmModuleRoot", type: "bytes32" },
                  { name: "requiredStake", type: "uint256" },
                  { name: "challengeManager", type: "address" },
                  { name: "confirmPeriodBlocks", type: "uint64" },
                  { name: "nextInboxPosition", type: "uint64" },
                ],
              },
            ],
          },
          {
            name: "beforeState",
            type: "tuple",
            components: [
              { name: "globalState", type: "tuple", components: [{ name: "bytes32Vals", type: "bytes32[2]" }, { name: "u64Vals", type: "uint64[2]" }] },
              { name: "machineStatus", type: "uint8" },
              { name: "endHistoryRoot", type: "bytes32" },
            ],
          },
          {
            name: "afterState",
            type: "tuple",
            components: [
              { name: "globalState", type: "tuple", components: [{ name: "bytes32Vals", type: "bytes32[2]" }, { name: "u64Vals", type: "uint64[2]" }] },
              { name: "machineStatus", type: "uint8" },
              { name: "endHistoryRoot", type: "bytes32" },
            ],
          },
        ],
      },
      { indexed: false, name: "afterInboxBatchAcc", type: "bytes32" },
      { indexed: false, name: "inboxMaxCount", type: "uint256" },
      { indexed: false, name: "wasmModuleRoot", type: "bytes32" },
      { indexed: false, name: "requiredStake", type: "uint256" },
      { indexed: false, name: "challengeManager", type: "address" },
      { indexed: false, name: "confirmPeriodBlocks", type: "uint64" },
    ],
  },
] as const;

/** Kinetiq mirror bridge (selectors decoded from bytecode; official-docs §5.3). */
export const ELYSIUM_BRIDGE_FACTORY_ABI = parseAbi([
  "function createL2Wallet(address elysiumToken) returns (address)",
  "function expectedL1Mirror(address elysiumToken) view returns (address)",
  "function l2WalletFor(address elysiumToken) view returns (address)",
  "function predictL2Wallet(address elysiumToken) view returns (address)",
]);

export const ELYSIUM_MIRROR_FACTORY_ABI = parseAbi([
  "function createAndRegisterL1Mirror(address elysiumToken, string name, string symbol, uint8 decimals, (uint256,uint256,uint256,uint256,uint256,uint256,uint256,address) params) payable returns (address)",
  "function l1MirrorFor(address elysiumToken, string name, string symbol, uint8 decimals) view returns (address)",
]);

export const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const TRANSFER_EVENT_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/** Uniswap v3-periphery SwapRouter (v1, with deadline): Kalos V3 on Elysium. */
export const SWAP_ROUTER_V1_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
]);

/** Uniswap SwapRouter02 (no deadline in the struct; multicall with deadline): HyperSwap V3 on HyperEVM. */
export const SWAP_ROUTER_02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
]);

export const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const V3_FACTORY_ABI = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);

export const V3_POOL_ABI = parseAbi([
  "function factory() view returns (address)",
  "function liquidity() view returns (uint128)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);

/** Uniswap V2 router: Dex Da Costa on Elysium. */
export const V2_ROUTER_ABI = parseAbi([
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);

export const V2_FACTORY_ABI = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address)"]);

export const V2_PAIR_ABI = parseAbi([
  "function factory() view returns (address)",
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
]);

/** Circle CoreDepositWallet on HyperEVM (USDC -> HyperCore; dex 0 = perps, 4294967295 = spot). */
export const CORE_DEPOSIT_WALLET_ABI = parseAbi([
  "function deposit(uint256 amount, uint32 destinationDex)",
  "function token() view returns (address)",
  "function tokenSystemAddress() view returns (address)",
]);

/** HYPE system contract on HyperEVM: emits Received when native HYPE is sent to HyperCore. */
export const HYPE_SYSTEM_ABI = parseAbi(["event Received(address indexed user, uint256 amount)"]);

/** Kinetiq StakingManager (HyperEVM): `stake()` payable mints kHYPE to the sender. */
export const KINETIQ_STAKING_MANAGER_ABI = parseAbi([
  "function stake() payable",
  "function minStakeAmount() view returns (uint256)",
  "function maxStakeAmount() view returns (uint256)",
  "function stakingLimit() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function stakingPaused() view returns (bool)",
  "function withdrawalPaused() view returns (bool)",
  "function stakingAccountant() view returns (address)",
  "function unstakeFeeRate() view returns (uint256)",
  "function withdrawalDelay() view returns (uint256)",
]);

export const KINETIQ_ACCOUNTANT_ABI = parseAbi([
  "function HYPEToKHYPE(uint256 amount) view returns (uint256)",
  "function kHYPEToHYPE(uint256 amount) view returns (uint256)",
]);

/** ERC-4626 tokenized vault (stKALOS, Cheshire USDC vault). */
export const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);

/** Morpho-Blue style lending core (Elyra lending on Elysium testnet): supply / withdraw of the loan asset. */
export const MORPHO_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function supply(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)",
  "function withdraw(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
]);

/** Elysium Names (.ely): `resolve("bona")` -> owner address; `primaryNameOf(address)` -> "bona.ely". */
export const ELY_NAMES_ABI = parseAbi([
  "function resolve(string name) view returns (address)",
  "function primaryNameOf(address owner) view returns (string)",
]);

/** Uniswap v4 PoolKey and the Signal launch router / V4Quoter (Elysium testnet). */
export const SIGNAL_V4_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function buyNative(PoolKey key, uint256 amountOutMinimum, address recipient, address refundTo, uint256 deadline) payable",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
