/**
 * Contract fragments the flow pages encode and decode in the browser. Taken
 * from the same sources as the API engine (Arbitrum Nitro, Uniswap
 * periphery, Circle CoreDepositWallet, Kinetiq StakingManager), each checked
 * against deployed bytecode on 2026-10-29.
 */
import { parseAbi } from "viem";

export const INBOX_ABI = parseAbi([
  "function depositEth() payable returns (uint256)",
  "event InboxMessageDelivered(uint256 indexed messageNum, bytes data)",
]);

export const BRIDGE_ABI = parseAbi([
  "event MessageDelivered(uint256 indexed messageIndex, bytes32 indexed beforeInboxAcc, address inbox, uint8 kind, address sender, bytes32 messageDataHash, uint256 baseFeeL1, uint64 timestamp)",
]);

export const ARB_SYS_ABI = parseAbi([
  "function withdrawEth(address destination) payable returns (uint256)",
  "event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)",
]);

export const ARB_RETRYABLE_TX_ABI = parseAbi([
  "function redeem(bytes32 ticketId) returns (bytes32)",
  "function getTimeout(bytes32 ticketId) view returns (uint256)",
]);

export const ROLLUP_PERIOD_ABI = parseAbi(["function confirmPeriodBlocks() view returns (uint64)"]);

export const CORE_DEPOSIT_WALLET_ABI = parseAbi(["function deposit(uint256 amount, uint32 destinationDex)"]);

export const KINETIQ_STAKING_ABI = parseAbi([
  "function stake() payable",
  "function minStakeAmount() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function stakingPaused() view returns (bool)",
]);

export const KINETIQ_ACCOUNTANT_ABI = parseAbi(["function HYPEToKHYPE(uint256 amount) view returns (uint256)", "function kHYPEToHYPE(uint256 amount) view returns (uint256)"]);

export const SWAP_ROUTER_V1_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

export const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const V2_ROUTER_ABI = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
