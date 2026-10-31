/**
 * Arbitrum Orbit (Elysium) message math: address aliasing, the L2
 * transaction ids of delayed messages and retryable fee sizing. Pure
 * functions, ported from @arbitrum/sdk 4.1 and verified on Elysium testnet:
 * the kind-12 (ETH/HYPE deposit) id matched 3 of 3 live deposits and the
 * kind-9 (retryable) id 6 of 6 live tickets (critic §3.5.4, telegram-tracking §10.2).
 */
import { concatHex, getAddress, hexToBigInt, keccak256, numberToHex, pad, sliceHex, toRlp, type Address, type Hex } from "viem";

/** Bridge message kinds (Nitro `Messages.sol`). */
export const L1_MESSAGE_KIND = Object.freeze({ submitRetryable: 9, ethDeposit: 12 });

const ALIAS_OFFSET = 0x1111000000000000000000000000000000001111n;
const ADDRESS_SPACE = 1n << 160n;

/** The L2 sender of a message sent by an L1 contract: `address + 0x1111…1111` (mod 2^160). */
export function applyL1ToL2Alias(address: string): Address {
  const value = (hexToBigInt(address as Hex) + ALIAS_OFFSET) % ADDRESS_SPACE;
  return getAddress(pad(numberToHex(value), { size: 20 }));
}

export function undoL1ToL2Alias(address: string): Address {
  const value = (hexToBigInt(address as Hex) - ALIAS_OFFSET + ADDRESS_SPACE) % ADDRESS_SPACE;
  return getAddress(pad(numberToHex(value), { size: 20 }));
}

/** RLP integer: minimal big-endian, empty for zero. */
function rlpInt(value: bigint): Hex {
  return value === 0n ? "0x" : numberToHex(value);
}

function messageIndex32(value: bigint): Hex {
  return pad(value === 0n ? "0x00" : numberToHex(value), { size: 32 });
}

export interface EthDepositData {
  readonly to: Address;
  readonly value: bigint;
}

/** Kind 12 inbox data: `abi.encodePacked(destination, value)`. */
export function parseEthDepositData(data: Hex): EthDepositData {
  if ((data.length - 2) / 2 !== 52) throw new Error("An ETH deposit message carries 52 bytes (address + uint256).");
  return { to: getAddress(sliceHex(data, 0, 20)), value: hexToBigInt(sliceHex(data, 20, 52)) };
}

/**
 * L2 transaction hash of a kind-12 deposit (tx type 0x64):
 * `keccak256(0x64 || rlp([chainId, msgIdx (32 bytes), sender, to, value]))`,
 * where `sender` is `MessageDelivered.sender` as emitted (already aliased by the Inbox).
 */
export function ethDepositTxId(childChainId: number | bigint, messageIndex: bigint, sender: string, data: Hex): Hex {
  const { to, value } = parseEthDepositData(data);
  return keccak256(concatHex(["0x64", toRlp([rlpInt(BigInt(childChainId)), messageIndex32(messageIndex), getAddress(sender), to, rlpInt(value)])]));
}

export interface RetryableData {
  readonly to: Address;
  readonly l2CallValue: bigint;
  readonly deposit: bigint;
  readonly maxSubmissionCost: bigint;
  readonly excessFeeRefundAddress: Address;
  readonly callValueRefundAddress: Address;
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly data: Hex;
}

/** Kind 9 inbox data: nine 32-byte words then the call data. */
export function parseRetryableData(data: Hex): RetryableData {
  const word = (index: number): Hex => sliceHex(data, index * 32, (index + 1) * 32);
  const address = (index: number): Address => getAddress(`0x${word(index).slice(26)}`);
  const length = Number(hexToBigInt(word(8)));
  return {
    to: address(0),
    l2CallValue: hexToBigInt(word(1)),
    deposit: hexToBigInt(word(2)),
    maxSubmissionCost: hexToBigInt(word(3)),
    excessFeeRefundAddress: address(4),
    callValueRefundAddress: address(5),
    gasLimit: hexToBigInt(word(6)),
    maxFeePerGas: hexToBigInt(word(7)),
    data: length > 0 ? sliceHex(data, 9 * 32, 9 * 32 + length) : "0x",
  };
}

/** L2 ticket id of a kind-9 retryable (tx type 0x69); `sender` and `baseFeeL1` come from `MessageDelivered`. */
export function retryableTicketId(childChainId: number | bigint, messageIndex: bigint, sender: string, baseFeeL1: bigint, data: Hex): Hex {
  const ticket = parseRetryableData(data);
  const zero = "0x0000000000000000000000000000000000000000";
  return keccak256(
    concatHex([
      "0x69",
      toRlp([
        rlpInt(BigInt(childChainId)),
        messageIndex32(messageIndex),
        getAddress(sender),
        rlpInt(baseFeeL1),
        rlpInt(ticket.deposit),
        rlpInt(ticket.maxFeePerGas),
        rlpInt(ticket.gasLimit),
        ticket.to === zero ? "0x" : ticket.to,
        rlpInt(ticket.l2CallValue),
        ticket.callValueRefundAddress,
        rlpInt(ticket.maxSubmissionCost),
        ticket.excessFeeRefundAddress,
        ticket.data,
      ]),
    ]),
  );
}

/* ----------------------------------------------------------- retryable fees */

/** Headroom on the submission fee (it follows the parent base fee at execution): +300%, as the Arbitrum SDK. */
export const SUBMISSION_FEE_HEADROOM_PCT = 300;
/** Headroom on the estimated L2 gas: +50% (most live Elysium testnet tickets were not auto-redeemed). */
export const RETRYABLE_GAS_HEADROOM_PCT = 50;
/** The L2 gas price bid is twice the current price, and at least 0.2 gwei (Elysium's base fee floor is 0.1 gwei). */
export const GAS_PRICE_BID_MULTIPLIER = 2n;
export const MIN_GAS_PRICE_BID_WEI = 200_000_000n;

export interface RetryableFees {
  readonly maxSubmissionCost: bigint;
  readonly maxGas: bigint;
  readonly gasPriceBid: bigint;
  /** `msg.value` of the parent transaction: submission + gas (plus any L2 call value). */
  readonly value: bigint;
}

function withHeadroom(value: bigint, percent: number): bigint {
  return (value * BigInt(100 + percent) + 99n) / 100n;
}

/**
 * Sizes a retryable from the Inbox submission fee, the NodeInterface gas
 * estimate and the L2 gas price. Unused gas is refunded to the excess fee
 * refund address (the user), so the headroom costs nothing when not needed.
 */
export function retryableFees(input: { readonly submissionFee: bigint; readonly gasEstimate: bigint; readonly l2GasPrice: bigint; readonly l2CallValue?: bigint }): RetryableFees {
  if (input.submissionFee < 0n || input.gasEstimate <= 0n || input.l2GasPrice <= 0n) throw new Error("Retryable fee inputs must be positive.");
  const maxSubmissionCost = withHeadroom(input.submissionFee, SUBMISSION_FEE_HEADROOM_PCT);
  const maxGas = withHeadroom(input.gasEstimate, RETRYABLE_GAS_HEADROOM_PCT);
  const bid = input.l2GasPrice * GAS_PRICE_BID_MULTIPLIER;
  const gasPriceBid = bid < MIN_GAS_PRICE_BID_WEI ? MIN_GAS_PRICE_BID_WEI : bid;
  return { maxSubmissionCost, maxGas, gasPriceBid, value: maxSubmissionCost + maxGas * gasPriceBid + (input.l2CallValue ?? 0n) };
}
