/**
 * One shared live pulse per network for the whole app: the landing Sun, the
 * top-bar heartbeat and /elysium read the same connection.
 *
 * Source order: the Elyia API's SSE block stream first. When it cannot be
 * reached (no event within a few seconds, or the stream gives up), the
 * browser polls Elysium's public RPC directly (rpcPoller.ts) and computes the
 * pulse itself; every 30 s it tries the API again and switches back as soon
 * as the API delivers. Sources pause while the tab is hidden and stop a few
 * seconds after the last subscriber leaves.
 */
import { NETWORKS, type NetworkKey } from "@elyia/core/networks";
import { PULSE_EVENTS, type Pulse, type PulseBlock } from "@elyia/core/pulse";

import { apiUrl } from "../api";
import { openEventStream, type EventStream } from "../sse";
import { appendBlock, computePulse, isStale, MIN_BROWSER_SPAN_MS, parsePulse, parsePulseBlock, RECENT_BLOCKS } from "./model";
import { ElysiumRpcPoller, type RpcHealth } from "./rpcPoller";

export type PulseStatus = "connecting" | "live" | "fallback" | "stale" | "offline";
export type PulseSourceKind = "api" | "rpc";

export interface PulseSnapshot {
  readonly network: NetworkKey;
  readonly status: PulseStatus;
  readonly source: PulseSourceKind | null;
  readonly pulse: Pulse | null;
  readonly head: PulseBlock | null;
  /** Ascending, newest last (about the last 14 s). */
  readonly recent: readonly PulseBlock[];
  /** Local wall clock when the newest block arrived. */
  readonly lastBlockAt: number | null;
}

/** Imperative block feed for visuals that react per block without re-rendering (the Sun). */
export interface BlockFeed {
  subscribe(listener: (block: PulseBlock) => void): () => void;
}

const API_FIRST_EVENT_MS = 4_000;
const API_RETRY_MS = 30_000;
const STOP_GRACE_MS = 5_000;
const RPC_PULSE_EVERY_MS = 1_000;

type StreamEvents = { block: PulseBlock; pulse: Pulse };

export class PulseHub {
  readonly feed: BlockFeed;
  private snapshot: PulseSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly blockListeners = new Set<(block: PulseBlock) => void>();
  private refs = 0;
  private active = false;
  private stream: EventStream | null = null;
  private poller: ElysiumRpcPoller | null = null;
  private rpcHealth: RpcHealth = "ok";
  private apiDelivered = false;
  private firstEventTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastRpcPulseAt = 0;
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.pauseSources();
    else if (this.refs > 0) this.startSources();
  };

  constructor(readonly network: NetworkKey) {
    this.snapshot = { network, status: "connecting", source: null, pulse: null, head: null, recent: [], lastBlockAt: null };
    this.feed = { subscribe: (listener) => this.onBlock(listener) };
  }

  getSnapshot = (): PulseSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onBlock(listener: (block: PulseBlock) => void): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  /** Keeps the sources running while held; release when done. */
  retain(): () => void {
    this.refs += 1;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.active) this.activate();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs === 0) this.stopTimer = setTimeout(() => this.deactivate(), STOP_GRACE_MS);
    };
  }

  private activate() {
    this.active = true;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    this.healthTimer = setInterval(() => this.refreshStatus(), 1_000);
    if (typeof document === "undefined" || document.visibilityState !== "hidden") this.startSources();
  }

  private deactivate() {
    this.active = false;
    this.stopTimer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.pauseSources();
  }

  private startSources() {
    if (this.stream || this.poller) return;
    this.openApi();
  }

  private closeStream() {
    const stream = this.stream;
    this.stream = null;
    stream?.close();
  }

  private pauseSources() {
    this.closeStream();
    this.poller?.stop();
    this.poller = null;
    for (const timer of [this.firstEventTimer, this.retryTimer]) if (timer) clearTimeout(timer);
    this.firstEventTimer = null;
    this.retryTimer = null;
  }

  private openApi() {
    this.apiDelivered = false;
    this.closeStream();
    let stream: EventStream | null = null;
    stream = openEventStream<StreamEvents>({
      url: apiUrl("/v1/elysium/blocks/stream", { network: this.network }),
      // Event names are PULSE_EVENTS.block and PULSE_EVENTS.pulse.
      parsers: { block: parsePulseBlock, pulse: parsePulse },
      maxAttempts: 2,
      backoff: { baseMs: 1_000, maxMs: 4_000 },
      onEvent: (name, value) => {
        if (this.stream !== stream) return;
        if (!this.apiDelivered) {
          this.apiDelivered = true;
          if (this.firstEventTimer) clearTimeout(this.firstEventTimer);
          this.firstEventTimer = null;
          if (this.poller) {
            this.poller.stop();
            this.poller = null;
          }
        }
        if (name === PULSE_EVENTS.block) this.addBlocks([value as PulseBlock], "api");
        else this.setPulse(value as Pulse, "api");
      },
      onStateChange: (state) => {
        // Only the current stream may trigger the fallback (a replaced one closes silently).
        if (state !== "closed" || this.stream !== stream) return;
        this.stream = null;
        if (this.active) this.startFallback();
      },
    });
    if (this.stream === null && stream.state !== "closed") this.stream = stream;
    if (this.firstEventTimer) clearTimeout(this.firstEventTimer);
    this.firstEventTimer = setTimeout(() => {
      this.firstEventTimer = null;
      if (!this.apiDelivered && this.active) this.startFallback();
    }, API_FIRST_EVENT_MS);
  }

  private startFallback() {
    if (!this.poller) {
      const network = NETWORKS[this.network];
      const urls = network.vm === "evm" ? network.rpcUrls : [];
      this.poller = new ElysiumRpcPoller({
        network: this.network,
        urls,
        onBlocks: (blocks) => this.addBlocks(blocks, "rpc"),
        onHealth: (health) => {
          this.rpcHealth = health;
          this.refreshStatus();
        },
      });
      this.poller.start();
    }
    // The API probe reopens on the retry timer; it never competes with the poller.
    if (!this.apiDelivered) this.closeStream();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.active && !this.apiDelivered) this.openApi();
    }, API_RETRY_MS);
    this.refreshStatus();
  }

  private addBlocks(blocks: readonly PulseBlock[], source: PulseSourceKind) {
    let recent = this.snapshot.recent;
    const added: PulseBlock[] = [];
    for (const block of blocks) {
      const result = appendBlock(recent, block);
      if (result.added) {
        recent = result.recent;
        added.push(block);
      }
    }
    if (added.length === 0) return;
    const now = Date.now();
    let pulse = this.snapshot.pulse;
    if (source === "rpc" && now - this.lastRpcPulseAt >= RPC_PULSE_EVERY_MS) {
      const network = NETWORKS[this.network];
      // Polled arrivals come in bursts: measure over the whole buffer (~15 s), not the API's 40-block window.
      const computed = computePulse(recent, { network: this.network, chainId: network.vm === "evm" ? network.chainId : 0, now }, RECENT_BLOCKS, MIN_BROWSER_SPAN_MS);
      if (computed) {
        pulse = computed;
        this.lastRpcPulseAt = now;
      }
    }
    const head = recent[recent.length - 1] ?? null;
    this.update({ recent, head, lastBlockAt: now, source, pulse });
    for (const block of added) for (const listener of [...this.blockListeners]) listener(block);
  }

  private setPulse(pulse: Pulse, source: PulseSourceKind) {
    this.update({ pulse, source });
  }

  private refreshStatus() {
    this.update({});
  }

  private statusFor(next: Omit<PulseSnapshot, "status">): PulseStatus {
    const now = Date.now();
    if (next.lastBlockAt === null) {
      return this.poller && this.rpcHealth === "down" ? "offline" : "connecting";
    }
    if (isStale(next.lastBlockAt, now)) return this.poller && this.rpcHealth === "down" && !this.apiDelivered ? "offline" : "stale";
    return next.source === "rpc" ? "fallback" : "live";
  }

  private update(patch: Partial<Omit<PulseSnapshot, "status" | "network">>) {
    const merged = { ...this.snapshot, ...patch };
    const status = this.statusFor(merged);
    const changed = status !== this.snapshot.status || Object.keys(patch).some((key) => patch[key as keyof typeof patch] !== this.snapshot[key as keyof PulseSnapshot]);
    if (!changed) return;
    this.snapshot = { ...merged, status };
    for (const listener of [...this.listeners]) listener();
  }
}

const hubs = new Map<NetworkKey, PulseHub>();

export function getPulseHub(network: NetworkKey = "elysium-testnet"): PulseHub {
  let hub = hubs.get(network);
  if (!hub) {
    hub = new PulseHub(network);
    hubs.set(network, hub);
  }
  return hub;
}
