// Wire shapes for the live Elysium pulse (GET /v1/elysium/pulse and the SSE block stream).

import type { NetworkKey } from "./networks.js";

/** One Elysium block as streamed by `GET /v1/elysium/blocks/stream` (`event: block`). */
export interface PulseBlock {
  readonly network: NetworkKey;
  readonly number: number;
  readonly hash: string;
  /** Block timestamp in seconds (Nitro timestamps have 1 s resolution). */
  readonly timestamp: number;
  readonly txCount: number;
  readonly gasUsed: string;
  readonly baseFeeGwei: number;
  /** Parent (HyperEVM) block number recorded by Nitro in the header. */
  readonly l1BlockNumber: number | null;
  /** Server wall clock (ms since epoch) when the block was first seen. */
  readonly seenAt: number;
}

/** Rolling chain health (`GET /v1/elysium/pulse`, and `event: pulse` on the stream about once per second). */
export interface Pulse {
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly head: number;
  /** Mean block interval over the sample window, measured on the wall clock. */
  readonly blockTimeMs: number;
  /** Transactions per second over the sample window. */
  readonly tps: number;
  readonly gasPriceGwei: number;
  /** Gas used per second over the sample window. */
  readonly gasPerSecond: number;
  readonly l1BlockNumber: number | null;
  readonly sampleBlocks: number;
  readonly updatedAt: number;
  /** false when the poller has not seen a new block for several seconds. */
  readonly healthy: boolean;
}

/** SSE event names on the block stream. */
export const PULSE_EVENTS = { block: "block", pulse: "pulse" } as const;
