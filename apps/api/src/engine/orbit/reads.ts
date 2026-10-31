/**
 * Orbit reads shared by the bridge adapter: the delayed message a parent
 * transaction created (MessageDelivered + InboxMessageDelivered), the
 * L2->L1 message a withdrawal emitted (L2ToL1Tx), the rollup's confirmed
 * send count (BoLD: latestConfirmed -> AssertionCreated afterState ->
 * Elysium block -> sendCount), the confirm period and the outbox proof.
 * Confirmation is read once a minute per rollup, never per withdrawal.
 */
import { getEvmNetwork, type ElysiumBridgeContracts, type NetworkKey } from "@elyia/core";
import { decodeEventLog, type Address, type Hex } from "viem";
import { ARB_SYS_ABI, BRIDGE_ABI, INBOX_ABI, NODE_INTERFACE_ABI, OUTBOX_ABI, ROLLUP_ABI } from "../abis.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import type { EvmLog } from "../ports/evm.js";
import { eventsOf } from "../verify.js";

export const ARB_SYS_ADDRESS = "0x0000000000000000000000000000000000000064" as Address;
export const ARB_RETRYABLE_TX_ADDRESS = "0x000000000000000000000000000000000000006e" as Address;
export const NODE_INTERFACE_ADDRESS = "0x00000000000000000000000000000000000000c8" as Address;

const CONFIRMATION_TTL_MS = 60_000;
const PERIOD_TTL_MS = 10 * 60_000;

export interface OrbitPair {
  readonly elysium: NetworkKey;
  readonly parent: NetworkKey;
  readonly contracts: ElysiumBridgeContracts;
}

/** The Orbit contracts between an Elysium network and its HyperEVM parent. */
export function orbitPair(elysium: NetworkKey): OrbitPair {
  const network = getEvmNetwork(elysium);
  if (!network.elysiumBridge || !network.parent) throw engineError("BRIDGE_DISABLED", `${network.name} has no pinned bridge.`);
  return { elysium, parent: network.parent, contracts: network.elysiumBridge };
}

export interface DeliveredMessage {
  readonly messageIndex: bigint;
  readonly kind: number;
  readonly sender: Address;
  readonly baseFeeL1: bigint;
  readonly data: Hex;
}

/** Delayed messages in a parent receipt: Bridge.MessageDelivered joined with Inbox.InboxMessageDelivered by index. */
export function deliveredMessages(logs: readonly EvmLog[], pair: OrbitPair): DeliveredMessage[] {
  const delivered = eventsOf(logs, { address: pair.contracts.parent.bridge, abi: BRIDGE_ABI, eventName: "MessageDelivered" });
  const inbox = eventsOf(logs, { address: pair.contracts.parent.inbox, abi: INBOX_ABI, eventName: "InboxMessageDelivered" });
  const out: DeliveredMessage[] = [];
  for (const event of delivered) {
    const index = event.args.messageIndex as bigint;
    const data = inbox.find((entry) => (entry.args.messageNum as bigint) === index)?.args.data as Hex | undefined;
    if (data === undefined) continue;
    out.push({ messageIndex: index, kind: Number(event.args.kind), sender: event.args.sender as Address, baseFeeL1: event.args.baseFeeL1 as bigint, data });
  }
  return out;
}

export interface L2ToL1Message {
  readonly caller: Address;
  readonly destination: Address;
  readonly position: bigint;
  readonly arbBlockNum: bigint;
  readonly ethBlockNum: bigint;
  readonly timestamp: bigint;
  readonly callvalue: bigint;
  readonly data: Hex;
}

export function l2ToL1Messages(logs: readonly EvmLog[]): L2ToL1Message[] {
  return eventsOf(logs, { address: ARB_SYS_ADDRESS, abi: ARB_SYS_ABI, eventName: "L2ToL1Tx" }).map((event) => ({
    caller: event.args.caller as Address,
    destination: event.args.destination as Address,
    position: event.args.position as bigint,
    arbBlockNum: event.args.arbBlockNum as bigint,
    ethBlockNum: event.args.ethBlockNum as bigint,
    timestamp: event.args.timestamp as bigint,
    callvalue: event.args.callvalue as bigint,
    data: event.args.data as Hex,
  }));
}

export interface Confirmation {
  /** L2->L1 messages with position < sendCount are claimable. */
  readonly sendCount: bigint;
  readonly sendRoot: Hex;
  readonly blockHash: Hex;
  readonly readAt: number;
}

const confirmations = new Map<string, Confirmation>();
const periods = new Map<string, { readonly blocks: bigint; readonly at: number }>();

/** The latest confirmed assertion's send count (cached a minute per rollup). */
export async function confirmedSendCount(deps: EngineDeps, pair: OrbitPair): Promise<Confirmation> {
  const key = pair.contracts.parent.rollup.toLowerCase();
  const cached = confirmations.get(key);
  const now = deps.clock.now();
  if (cached && now - cached.readAt < CONFIRMATION_TTL_MS) return cached;
  const rollup = pair.contracts.parent.rollup as Address;
  const latest = await deps.evm.read(pair.parent, { address: rollup, abi: ROLLUP_ABI, functionName: "latestConfirmed" });
  const assertion = await deps.evm.read(pair.parent, { address: rollup, abi: ROLLUP_ABI, functionName: "getAssertion", args: [latest] });
  const logs = await deps.evm.getLogs(pair.parent, { address: rollup, fromBlock: assertion.createdAtBlock, toBlock: assertion.createdAtBlock });
  let blockHash: Hex | null = null;
  let sendRoot: Hex | null = null;
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: ROLLUP_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "AssertionCreated" || decoded.args.assertionHash.toLowerCase() !== latest.toLowerCase()) continue;
      const values = decoded.args.assertion.afterState.globalState.bytes32Vals;
      blockHash = values[0];
      sendRoot = values[1];
    } catch {
      // Other rollup events.
    }
  }
  if (!blockHash || !sendRoot) throw engineError("RPC_UNAVAILABLE", "The confirmed assertion could not be read from the rollup.");
  const block = await deps.evm.getBlock(pair.elysium, blockHash);
  if (!block || block.sendCount === null) throw engineError("RPC_UNAVAILABLE", "The confirmed Elysium block is not readable.");
  const confirmation: Confirmation = { sendCount: block.sendCount, sendRoot, blockHash, readAt: now };
  confirmations.set(key, confirmation);
  return confirmation;
}

/** Rollup confirm period in parent blocks (read on-chain, cached). */
export async function confirmPeriodBlocks(deps: EngineDeps, pair: OrbitPair): Promise<bigint> {
  const key = pair.contracts.parent.rollup.toLowerCase();
  const cached = periods.get(key);
  if (cached && deps.clock.now() - cached.at < PERIOD_TTL_MS) return cached.blocks;
  const blocks = await deps.evm.read(pair.parent, { address: pair.contracts.parent.rollup as Address, abi: ROLLUP_ABI, functionName: "confirmPeriodBlocks" });
  periods.set(key, { blocks, at: deps.clock.now() });
  return blocks;
}

/**
 * Seconds until a fresh withdrawal is claimable: the confirm period in
 * parent blocks (HyperEVM small blocks, about 1 s) plus the assertion cadence
 * (about 30 minutes observed on testnet).
 */
export function withdrawalSeconds(confirmBlocks: bigint): number {
  return Number(confirmBlocks) + 30 * 60;
}

export interface OutboxProof {
  readonly proof: readonly Hex[];
  readonly root: Hex;
}

export async function outboxProof(deps: EngineDeps, pair: OrbitPair, size: bigint, leaf: bigint): Promise<OutboxProof> {
  const [, root, proof] = await deps.evm.read(pair.elysium, { address: NODE_INTERFACE_ADDRESS, abi: NODE_INTERFACE_ABI, functionName: "constructOutboxProof", args: [size, leaf] });
  return { proof, root };
}

export async function outboxSpent(deps: EngineDeps, pair: OrbitPair, position: bigint): Promise<boolean> {
  const outbox = pair.contracts.parent.outbox;
  if (!outbox) throw engineError("BRIDGE_DISABLED", "This rollup's outbox is not pinned.");
  return deps.evm.read(pair.parent, { address: outbox as Address, abi: OUTBOX_ABI, functionName: "isSpent", args: [position] });
}

/** Test seam: forget cached confirmations and periods. */
export function clearOrbitCaches(): void {
  confirmations.clear();
  periods.clear();
}
