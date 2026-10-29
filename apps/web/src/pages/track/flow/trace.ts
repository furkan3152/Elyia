/**
 * Tracing a transaction across the layers from the browser, on the public
 * RPCs (CORS open): find the receipt on Elysium or HyperEVM, then follow
 * what it started.
 *
 * - a HyperEVM receipt with an Orbit delayed message: the ascent. A HYPE
 *   deposit (kind 12) lands as an Elysium tx whose id is computed from the
 *   message; an ERC-20 deposit (kind 9) lands as a retryable ticket that may
 *   need a manual redeem (5 of 6 live testnet tickets did);
 * - an Elysium receipt with an L2ToL1Tx: the descent. Its claim opens once
 *   the rollup confirms (confirmPeriodBlocks + the assertion cadence);
 * - anything else: a plain receipt on its layer.
 */
import { getEvmNetwork, layersFor, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";
import type { Hex, PublicClient, TransactionReceipt } from "viem";

import { ARB_RETRYABLE_TX_ABI, ROLLUP_PERIOD_ABI } from "./abis";
import { ARB_RETRYABLE_TX, childIdOf, deliveredMessages, ticketState, withdrawalMessages, withdrawalSeconds, type TicketState } from "./orbit";

export type ClientFor = (network: NetworkKey) => PublicClient | undefined;

export interface FoundReceipt {
  readonly network: NetworkKey;
  readonly receipt: TransactionReceipt;
  readonly timestamp: number;
}

export type Trace =
  | { readonly kind: "not-found"; readonly hash: Hex; readonly searched: readonly NetworkKey[] }
  | { readonly kind: "plain"; readonly found: FoundReceipt }
  | {
      readonly kind: "ascent";
      readonly found: FoundReceipt;
      readonly child: { readonly kind: "deposit" | "ticket"; readonly id: Hex };
      /** The Elysium receipt of the child id, once it exists. */
      readonly landed: FoundReceipt | null;
      readonly ticket: TicketState | null;
      readonly ticketTimeout: number | null;
    }
  | {
      /** A retryable ticket pasted by its id (the ticket's own tx on Elysium). */
      readonly kind: "ticket";
      readonly found: FoundReceipt;
      readonly ticket: TicketState;
      readonly ticketTimeout: number | null;
    }
  | {
      readonly kind: "descent";
      readonly found: FoundReceipt;
      readonly destination: string;
      readonly value: bigint;
      readonly position: bigint;
      /** Unix seconds the claim is expected to open. */
      readonly claimableAt: number;
      readonly confirmBlocks: number;
    };

/** keccak256("TicketCreated(bytes32)"). */
export const TICKET_CREATED = "0x7c793cced5743dc5f531bbe2bfb5a9fa3f40adef29231e6ab165c08a29e3dd89";

export const HASH = /^0x[0-9a-fA-F]{64}$/u;

async function receiptOn(client: PublicClient | undefined, network: NetworkKey, hash: Hex): Promise<FoundReceipt | null> {
  if (!client) return null;
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return null;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  return { network, receipt, timestamp: block ? Number(block.timestamp) : 0 };
}

/** Follows one transaction hash through the layers. */
export async function traceHash(hash: Hex, mode: NetworkEnvironment, clientFor: ClientFor, nowSec: number = Math.floor(Date.now() / 1000)): Promise<Trace> {
  const layers = layersFor(mode);
  const elysium = getEvmNetwork(layers.elysium.key);
  const parent = getEvmNetwork(layers.hyperevm.key);
  const [onElysium, onParent] = await Promise.all([receiptOn(clientFor(elysium.key), elysium.key, hash), receiptOn(clientFor(parent.key), parent.key, hash)]);

  if (onParent && elysium.elysiumBridge) {
    const bridge = elysium.elysiumBridge.parent;
    const message = deliveredMessages(onParent.receipt.logs, { bridge: bridge.bridge, inbox: bridge.inbox })[0];
    const child = message ? childIdOf(message, elysium.chainId) : null;
    if (child) {
      const client = clientFor(elysium.key);
      const landed = await receiptOn(client, elysium.key, child.id);
      let ticket: TicketState | null = null;
      let ticketTimeout: number | null = null;
      if (child.kind === "ticket" && client) {
        const timeout = await client.readContract({ address: ARB_RETRYABLE_TX, abi: ARB_RETRYABLE_TX_ABI, functionName: "getTimeout", args: [child.id] }).catch(() => null);
        ticketTimeout = timeout !== null ? Number(timeout) : null;
        ticket = ticketState({ created: landed !== null, stillHeld: timeout !== null, timeoutSec: ticketTimeout, createdAtSec: landed?.timestamp ?? null, nowSec });
      }
      return { kind: "ascent", found: onParent, child, landed, ticket, ticketTimeout };
    }
  }

  if (onElysium) {
    const withdrawal = withdrawalMessages(onElysium.receipt.logs)[0];
    if (withdrawal) {
      const client = clientFor(parent.key);
      const rollup = elysium.elysiumBridge?.parent.rollup as Hex | undefined;
      const live = rollup && client ? await client.readContract({ address: rollup, abi: ROLLUP_PERIOD_ABI, functionName: "confirmPeriodBlocks" }).catch(() => null) : null;
      const confirmBlocks = live !== null && live !== undefined ? Number(live) : (elysium.elysiumBridge?.confirmPeriodBlocks ?? 0);
      const start = Number(withdrawal.timestamp) || onElysium.timestamp;
      return { kind: "descent", found: onElysium, destination: withdrawal.destination, value: withdrawal.callvalue, position: withdrawal.position, claimableAt: start + withdrawalSeconds(confirmBlocks), confirmBlocks };
    }
    // A ticket's id is its own creation tx: TicketCreated(ticketId) in the receipt.
    const created = onElysium.receipt.logs.some((log) => log.address.toLowerCase() === ARB_RETRYABLE_TX && log.topics[0] === TICKET_CREATED && log.topics[1]?.toLowerCase() === hash.toLowerCase());
    if (created) {
      const client = clientFor(elysium.key);
      const timeout = client ? await client.readContract({ address: ARB_RETRYABLE_TX, abi: ARB_RETRYABLE_TX_ABI, functionName: "getTimeout", args: [hash] }).catch(() => null) : null;
      const ticketTimeout = timeout !== null ? Number(timeout) : null;
      return { kind: "ticket", found: onElysium, ticket: ticketState({ created: true, stillHeld: timeout !== null, timeoutSec: ticketTimeout, createdAtSec: onElysium.timestamp, nowSec }), ticketTimeout };
    }
    return { kind: "plain", found: onElysium };
  }
  if (onParent) return { kind: "plain", found: onParent };
  return { kind: "not-found", hash, searched: [elysium.key, parent.key] };
}

/** True while the trace may still change (poll again). */
export function traceMoving(trace: Trace, nowSec: number): boolean {
  switch (trace.kind) {
    case "not-found":
      return true;
    case "plain":
      return false;
    case "ascent":
      return trace.landed === null || trace.ticket === "created" || trace.ticket === "needs-redeem";
    case "ticket":
      return trace.ticket === "created" || trace.ticket === "needs-redeem";
    case "descent":
      return nowSec < trace.claimableAt;
  }
}

/** What to call the query input. */
export type TrackQuery = { readonly kind: "intent"; readonly id: string } | { readonly kind: "journey"; readonly id: string } | { readonly kind: "hash"; readonly hash: Hex } | { readonly kind: "address"; readonly address: string } | { readonly kind: "unknown"; readonly text: string };

export function parseTrackQuery(raw: string): TrackQuery {
  const text = raw.trim();
  if (/^int_[0-9a-f]{32}$/u.test(text)) return { kind: "intent", id: text };
  if (/^j_[0-9A-Za-z_]{4,40}$/u.test(text)) return { kind: "journey", id: text };
  if (HASH.test(text)) return { kind: "hash", hash: text.toLowerCase() as Hex };
  if (/^0x[0-9a-fA-F]{40}$/u.test(text)) return { kind: "address", address: text.toLowerCase() };
  return { kind: "unknown", text };
}
