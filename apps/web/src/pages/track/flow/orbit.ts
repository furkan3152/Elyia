/**
 * Arbitrum Orbit (Elysium) message math and reads, in the browser.
 *
 * The math is the same as the API engine's (ported from @arbitrum/sdk 4.1):
 * the kind-12 id matched 3 of 3 live HYPE deposits and the kind-9 id 6 of 6
 * live retryable tickets on Elysium testnet. The web app cannot import the
 * API, so it keeps its own copy; `flow.test.ts` pins it to a live deposit.
 */
import { concatHex, decodeEventLog, getAddress, hexToBigInt, keccak256, numberToHex, pad, sliceHex, toRlp, type Address, type Hex, type Log } from "viem";

import { ARB_SYS_ABI, BRIDGE_ABI, INBOX_ABI } from "./abis";

export const L1_MESSAGE_KIND = Object.freeze({ submitRetryable: 9, ethDeposit: 12 });
export const ARB_SYS = "0x0000000000000000000000000000000000000064" as Address;
export const ARB_RETRYABLE_TX = "0x000000000000000000000000000000000000006e" as Address;

function rlpInt(value: bigint): Hex {
  return value === 0n ? "0x" : numberToHex(value);
}

function messageIndex32(value: bigint): Hex {
  return pad(value === 0n ? "0x00" : numberToHex(value), { size: 32 });
}

/** Kind 12 inbox data: `abi.encodePacked(destination, value)`. */
export function parseEthDepositData(data: Hex): { readonly to: Address; readonly value: bigint } {
  if ((data.length - 2) / 2 !== 52) throw new Error("An ETH deposit message carries 52 bytes (address + uint256).");
  return { to: getAddress(sliceHex(data, 0, 20)), value: hexToBigInt(sliceHex(data, 20, 52)) };
}

/** L2 tx hash of a kind-12 deposit (type 0x64). `sender` is MessageDelivered.sender as emitted. */
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

/** Kind 9 inbox data: nine 32-byte words, then the call data. */
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

/** L2 ticket id of a kind-9 retryable (type 0x69). */
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

export interface DeliveredMessage {
  readonly messageIndex: bigint;
  readonly kind: number;
  readonly sender: Address;
  readonly baseFeeL1: bigint;
  readonly data: Hex;
  readonly timestamp: bigint;
}

type ReceiptLog = Pick<Log, "address" | "data" | "topics">;

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Delayed messages in a HyperEVM receipt: Bridge.MessageDelivered joined with Inbox.InboxMessageDelivered by index. */
export function deliveredMessages(logs: readonly ReceiptLog[], contracts: { readonly bridge: string; readonly inbox: string }): DeliveredMessage[] {
  const delivered: Omit<DeliveredMessage, "data">[] = [];
  const bodies = new Map<bigint, Hex>();
  for (const log of logs) {
    if (log.topics.length === 0) continue;
    try {
      if (sameAddress(log.address, contracts.bridge)) {
        const event = decodeEventLog({ abi: BRIDGE_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (event.eventName === "MessageDelivered") {
          delivered.push({ messageIndex: event.args.messageIndex, kind: Number(event.args.kind), sender: event.args.sender, baseFeeL1: event.args.baseFeeL1, timestamp: event.args.timestamp });
        }
      } else if (sameAddress(log.address, contracts.inbox)) {
        const event = decodeEventLog({ abi: INBOX_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (event.eventName === "InboxMessageDelivered") bodies.set(event.args.messageNum, event.args.data);
      }
    } catch {
      // Other events of the same contracts.
    }
  }
  return delivered.flatMap((message) => {
    const data = bodies.get(message.messageIndex);
    return data === undefined ? [] : [{ ...message, data }];
  });
}

export interface WithdrawalMessage {
  readonly destination: Address;
  readonly position: bigint;
  readonly callvalue: bigint;
  readonly timestamp: bigint;
  readonly ethBlockNum: bigint;
}

/** L2->L1 messages (withdrawals) in an Elysium receipt. */
export function withdrawalMessages(logs: readonly ReceiptLog[]): WithdrawalMessage[] {
  const out: WithdrawalMessage[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, ARB_SYS) || log.topics.length === 0) continue;
    try {
      const event = decodeEventLog({ abi: ARB_SYS_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName === "L2ToL1Tx") out.push({ destination: event.args.destination, position: event.args.position, callvalue: event.args.callvalue, timestamp: event.args.timestamp, ethBlockNum: event.args.ethBlockNum });
    } catch {
      // Not an L2ToL1Tx.
    }
  }
  return out;
}

/** The Elysium id a delivered message lands as: a deposit tx (kind 12) or a retryable ticket (kind 9). */
export function childIdOf(message: DeliveredMessage, childChainId: number): { readonly kind: "deposit" | "ticket"; readonly id: Hex } | null {
  if (message.kind === L1_MESSAGE_KIND.ethDeposit) return { kind: "deposit", id: ethDepositTxId(childChainId, message.messageIndex, message.sender, message.data) };
  if (message.kind === L1_MESSAGE_KIND.submitRetryable) return { kind: "ticket", id: retryableTicketId(childChainId, message.messageIndex, message.sender, message.baseFeeL1, message.data) };
  return null;
}

/**
 * Seconds from a withdrawal until its claim opens: the confirm period in
 * HyperEVM blocks (small blocks, about 1 s) plus the assertion cadence
 * (about 30 minutes observed on testnet). Same rule as the API engine.
 */
export function withdrawalSeconds(confirmPeriodBlocks: number): number {
  return confirmPeriodBlocks + 30 * 60;
}

/** ArbRetryableTx.getLifetime() on Elysium (core ELYSIUM_RETRYABLE_LIFETIME_SECONDS). */
export const TICKET_LIFETIME_SEC = 604_800;

export type TicketState ="unknown" | "created" | "needs-redeem" | "redeemed" | "expired";

/**
 * Where a retryable ticket stands, from three facts: the ticket's creation
 * receipt on Elysium, whether ArbRetryableTx still holds it (getTimeout
 * answers) and how long ago it was created. A ticket that still exists a
 * minute after creation was not auto-redeemed: it needs one redeem
 * transaction before its timeout (7 days).
 */
export function ticketState(input: { readonly created: boolean; readonly stillHeld: boolean; readonly timeoutSec: number | null; readonly createdAtSec: number | null; readonly nowSec: number }): TicketState {
  if (!input.created) return "unknown";
  // A ticket leaves ArbRetryableTx when it is redeemed or when it expires (7 days unredeemed).
  if (!input.stillHeld) return input.createdAtSec !== null && input.nowSec - input.createdAtSec > TICKET_LIFETIME_SEC ? "expired" : "redeemed";
  if (input.timeoutSec !== null && input.timeoutSec < input.nowSec) return "expired";
  if (input.createdAtSec !== null && input.nowSec - input.createdAtSec > 60) return "needs-redeem";
  return "created";
}
