/**
 * The Elysium block poller behind the Sun (GET /v1/elysium/pulse and the SSE
 * block stream).
 *
 * Loop (never overlapping): eth_blockNumber about every 150 ms; new headers
 * are fetched in one JSON-RPC batch of at most 50; when more than 50 behind
 * (a stall, an outage) it jumps to the head instead of crawling. Every new
 * block is published on the bus as `elysium.block`, and a Pulse computed over
 * the rolling window (last ~60 blocks, wall-clock `seenAt`) as
 * `elysium.pulse` every second.
 *
 * Robustness: errors back off exponentially (honoring 429 Retry-After), the
 * RPC client fails over between endpoints, an endpoint whose head lags ours
 * is rejected and marked stale, and an endpoint census every minute marks
 * endpoints far behind the best head. Heights never go backwards.
 *
 * Lifecycle: a poller starts on the first `retain()` and stops `idleStopMs`
 * (30 s) after the last release; its last Pulse stays readable.
 */
import type { EvmNetwork, Network, NetworkKey, Pulse, PulseBlock } from "@elyia/core";
import type { EventBus } from "../bus.js";
import type { Clock } from "../clock.js";
import { ElyiaHttpError, networkUnavailable } from "../http/errors.js";
import type { FetchLike } from "../hyperliquid/info.js";
import type { Logger } from "../log.js";
import { computePulse, isRawBlockHeader, PulseWindow, refreshPulse, toPulseBlock, type RawBlockHeader } from "./pulseMath.js";
import { JsonRpcEndpoints, RpcError, type EndpointStatus } from "./rpc.js";

export interface PulseOptions {
  readonly pollMs: number;
  readonly minDelayMs: number;
  readonly maxBackoffMs: number;
  readonly maxBatch: number;
  /** Heights requested speculatively with each eth_blockNumber. */
  readonly maxSpeculative: number;
  readonly windowBlocks: number;
  readonly windowMaxAgeMs: number;
  readonly pulseEveryMs: number;
  readonly staleAfterMs: number;
  readonly idleStopMs: number;
  readonly censusEveryMs: number;
  /** An endpoint this many blocks behind the best known head is stale. */
  readonly staleLagBlocks: number;
  /** An endpoint answering a head this many blocks below ours is skipped for `behindCooldownMs`. */
  readonly behindToleranceBlocks: number;
  readonly behindCooldownMs: number;
  readonly recentBlocks: number;
}

export const DEFAULT_PULSE_OPTIONS: PulseOptions = Object.freeze({
  pollMs: 150,
  minDelayMs: 25,
  maxBackoffMs: 5_000,
  maxBatch: 50,
  maxSpeculative: 8,
  windowBlocks: 60,
  windowMaxAgeMs: 30_000,
  pulseEveryMs: 1_000,
  staleAfterMs: 5_000,
  idleStopMs: 30_000,
  censusEveryMs: 60_000,
  staleLagBlocks: 500,
  behindToleranceBlocks: 5,
  behindCooldownMs: 10_000,
  recentBlocks: 128,
});

export interface PollerStatus {
  readonly network: NetworkKey;
  readonly running: boolean;
  readonly subscribers: number;
  readonly head: number | null;
  readonly lastBlockAt: number | null;
  readonly consecutiveErrors: number;
  readonly jumps: number;
  readonly endpoints: readonly EndpointStatus[];
}

interface PollerDeps {
  readonly network: EvmNetwork;
  readonly rpc: JsonRpcEndpoints;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly log: Logger;
  readonly options: PulseOptions;
}

/** Blocks needed before the first pulse is published ahead of the 1 s timer (two samples are too noisy). */
const EARLY_PULSE_BLOCKS = 4;

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}

export class ElysiumPulsePoller {
  readonly network: EvmNetwork;
  private readonly rpc: JsonRpcEndpoints;
  private readonly bus: EventBus;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly options: PulseOptions;
  private readonly window: PulseWindow;
  private readonly recent: PulseBlock[] = [];
  private running = false;
  /** Bumped on every start/stop so a tick from a previous run cannot touch state. */
  private generation = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private pulseTimer: NodeJS.Timeout | null = null;
  private lastNumber: number | null = null;
  private lastBlockAt: number | null = null;
  private latestPulse: Pulse | null = null;
  private consecutiveErrors = 0;
  private jumps = 0;
  private lastCensusAt = 0;
  private censusRunning = false;
  private lastTickAt: number | null = null;

  constructor(deps: PollerDeps) {
    this.network = deps.network;
    this.rpc = deps.rpc;
    this.bus = deps.bus;
    this.clock = deps.clock;
    this.log = deps.log;
    this.options = deps.options;
    this.window = new PulseWindow(deps.options.windowBlocks, deps.options.windowMaxAgeMs);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.lastCensusAt = 0;
    this.lastTickAt = null;
    this.log.info("pulse poller started", { network: this.network.key });
    this.schedule(0);
    this.pulseTimer = setInterval(() => this.publishPulse(), this.options.pulseEveryMs);
    this.pulseTimer.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.tickTimer = null;
    this.pulseTimer = null;
    this.log.info("pulse poller stopped", { network: this.network.key });
  }

  /** The last Pulse with `healthy` re-evaluated now; kept after stop. */
  latest(): Pulse | null {
    return this.latestPulse ? refreshPulse(this.latestPulse, this.clock.now(), this.lastBlockAt, this.options.staleAfterMs) : null;
  }

  /** Recent blocks (ascending), optionally only those after `afterNumber`. */
  recentBlocks(afterNumber?: number): readonly PulseBlock[] {
    return afterNumber === undefined ? [...this.recent] : this.recent.filter((block) => block.number > afterNumber);
  }

  status(subscribers: number): PollerStatus {
    return {
      network: this.network.key,
      running: this.running,
      subscribers,
      head: this.lastNumber,
      lastBlockAt: this.lastBlockAt,
      consecutiveErrors: this.consecutiveErrors,
      jumps: this.jumps,
      endpoints: this.rpc.status(),
    };
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    const generation = this.generation;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.tick(generation);
    }, delayMs);
    this.tickTimer.unref();
  }

  /**
   * One poll, normally a single round trip: a JSON-RPC batch of
   * eth_blockNumber plus speculative eth_getBlockByNumber for the heights
   * expected since the last poll (nulls for heights not produced yet are
   * free). A follow-up batch fetches whatever the speculation missed, up to
   * `maxBatch`; beyond that the poller jumps to the head.
   */
  async tick(generation = this.generation): Promise<void> {
    const started = this.clock.now();
    let delay = this.options.pollMs;
    try {
      const known = this.lastNumber;
      // Cold start: run the census alongside the first batch, so a lagging preferred endpoint is caught before its answer is used.
      const coldCensus = known === null && this.rpc.size > 1 ? this.census(generation) : null;
      if (!coldCensus && this.rpc.size > 1 && started - this.lastCensusAt >= this.options.censusEveryMs) this.startCensus();
      const lag = this.options.staleLagBlocks;
      const speculative = known === null ? [] : this.speculativeHeights(known, started);
      const calls = [
        { method: "eth_blockNumber", params: [] as unknown[] },
        ...(known === null
          ? [{ method: "eth_getBlockByNumber", params: ["latest", false] as unknown[] }]
          : speculative.map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] as unknown[] }))),
      ];
      const [headHex, ...headers] = await this.rpc.batch<unknown>(calls, (values) => {
        const value = values[0];
        // An endpoint whose head is far below ours lags the chain: reject it and fail over.
        return typeof value === "string" && (known === null || Number.parseInt(value, 16) >= known - lag);
      });
      if (generation !== this.generation) return;
      const head = typeof headHex === "string" ? Number.parseInt(headHex, 16) : Number.NaN;
      if (!Number.isSafeInteger(head) || head < 0) throw new RpcError("invalid", "eth_blockNumber answered a non-number");
      const best = coldCensus ? await coldCensus : null;
      if (generation !== this.generation) return;
      if (best !== null && best - head > lag) {
        // Answered by an endpoint the census just marked stale: discard it and poll again at once.
        delay = 0;
      } else {
        if (known !== null && known - head > this.options.behindToleranceBlocks) {
          // Slightly behind (a lagging replica): use the answer, but ask another endpoint next time.
          const answered = this.rpc.lastAnswered;
          if (answered) this.rpc.markStale(answered, this.options.behindCooldownMs);
        }
        // Far behind: the speculative headers are old news (their seenAt would be wrong); jump instead.
        if (known === null || head - known <= this.options.maxBatch) this.ingestRun(headers, this.clock.now());
        await this.catchUp(head, generation);
      }
      this.lastTickAt = started;
      this.consecutiveErrors = 0;
    } catch (error) {
      if (generation !== this.generation) return;
      this.consecutiveErrors += 1;
      const rpcError = error instanceof RpcError ? error : null;
      const backoff = Math.min(this.options.maxBackoffMs, this.options.pollMs * 2 ** Math.min(this.consecutiveErrors, 10));
      delay = Math.max(backoff, rpcError?.retryAfterMs ?? 0);
      // First failure and then every 20th: an outage must not flood the log.
      if (this.consecutiveErrors === 1 || this.consecutiveErrors % 20 === 0) {
        this.log.warn("pulse poll failed", {
          network: this.network.key,
          kind: rpcError?.kind ?? "unexpected",
          consecutiveErrors: this.consecutiveErrors,
          ...(rpcError ? {} : { error: error instanceof Error ? error.message : String(error) }),
        });
      }
    }
    if (generation !== this.generation) return;
    const elapsed = this.clock.now() - started;
    this.schedule(Math.max(this.options.minDelayMs, delay - elapsed));
  }

  /** Heights after `known` that have probably appeared since the last poll (at least 2, at most `maxSpeculative`). */
  private speculativeHeights(known: number, now: number): number[] {
    const blockTimeMs = this.latestPulse?.blockTimeMs || this.network.blockTimeMs;
    const sinceLastTick = this.lastTickAt === null ? this.options.pollMs : now - this.lastTickAt;
    const expected = Math.ceil(sinceLastTick / Math.max(20, blockTimeMs)) + 1;
    const count = Math.max(2, Math.min(this.options.maxSpeculative, expected));
    return Array.from({ length: count }, (_, index) => known + 1 + index);
  }

  /** Ingests consecutive headers in order and stops at the first missing one. */
  private ingestRun(headers: readonly unknown[], seenAt: number): void {
    for (const raw of headers) {
      // A load-balanced endpoint may not have the newest block on every node yet: stop at the first gap, retry next tick.
      if (raw === null || !isRawBlockHeader(raw)) break;
      const number = Number.parseInt(raw.number, 16);
      if (this.lastNumber !== null && number <= this.lastNumber) continue;
      if (this.lastNumber !== null && number > this.lastNumber + 1) break;
      this.ingest(raw, seenAt);
    }
  }

  /** Fetches what the speculative batch missed, or jumps to the head when too far behind. */
  private async catchUp(head: number, generation: number): Promise<void> {
    const last = this.lastNumber;
    if (last !== null && head <= last) return;
    let numbers: number[];
    if (last === null || head - last > this.options.maxBatch) {
      if (last !== null) {
        this.jumps += 1;
        this.log.info("pulse jumped to head", { network: this.network.key, from: last, to: head });
      }
      numbers = [head];
    } else {
      numbers = [];
      for (let n = last + 1; n <= head; n += 1) numbers.push(n);
    }
    const headers = await this.rpc.batch<unknown>(numbers.map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] })));
    if (generation !== this.generation) return;
    const seenAt = this.clock.now();
    if (numbers.length === 1 && last !== null && numbers[0] !== last + 1) {
      // A jump: the window keeps its older entries (block time divides by the number span, so a gap is fine).
      const raw = headers[0];
      if (raw !== null && isRawBlockHeader(raw)) this.ingest(raw, seenAt);
      return;
    }
    this.ingestRun(headers, seenAt);
  }

  private ingest(raw: RawBlockHeader, seenAt: number): void {
    const block = toPulseBlock(this.network.key, raw, seenAt, { nitro: this.network.family === "elysium" });
    if (this.lastNumber !== null && block.number <= this.lastNumber) return;
    this.lastNumber = block.number;
    this.lastBlockAt = seenAt;
    this.window.add(block);
    this.recent.push(block);
    if (this.recent.length > this.options.recentBlocks) this.recent.splice(0, this.recent.length - this.options.recentBlocks);
    this.bus.emit("elysium.block", block);
    // The first pulse goes out as soon as a few blocks are in instead of waiting for the next second.
    if (!this.latestPulse && this.window.size >= EARLY_PULSE_BLOCKS) this.publishPulse();
  }

  /** Endpoint census in the background (it must not delay the poll). */
  private startCensus(): void {
    if (this.censusRunning) return;
    this.censusRunning = true;
    this.census(this.generation)
      .catch(() => undefined)
      .finally(() => {
        this.censusRunning = false;
      });
  }

  /** eth_blockNumber on every endpoint; marks those far behind the best head stale and returns that head (null if none answered). */
  private async census(generation: number): Promise<number | null> {
    this.lastCensusAt = this.clock.now();
    const heads = await this.rpc.headsByEndpoint();
    if (generation !== this.generation) return null;
    if (heads.every((entry) => entry.head === null)) return null;
    const best = Math.max(this.lastNumber ?? 0, ...heads.map((entry) => entry.head ?? 0));
    const alreadyStale = new Set(this.rpc.status().filter((endpoint) => endpoint.stale).map((endpoint) => endpoint.endpoint));
    for (const entry of heads) {
      if (entry.head !== null && best - entry.head > this.options.staleLagBlocks) {
        this.rpc.markStale(entry.endpoint);
        // Warn when an endpoint becomes stale; a persistently stale one is only re-confirmed at debug level.
        const fields = { network: this.network.key, endpoint: entry.endpoint, behind: best - entry.head };
        if (alreadyStale.has(entry.endpoint)) this.log.debug("rpc endpoint still lags the chain", fields);
        else this.log.warn("rpc endpoint lags the chain", fields);
      }
    }
    return best;
  }

  /**
   * Computes and publishes the pulse. The first one needs `minSamples`
   * blocks (default 4: two samples are too noisy); later ones publish
   * whatever the window measures.
   */
  publishPulse(minSamples = EARLY_PULSE_BLOCKS): Pulse | null {
    const now = this.clock.now();
    this.window.trim(now);
    const measured = computePulse({
      network: this.network.key,
      chainId: this.network.chainId,
      blocks: this.window.snapshot(),
      now,
      lastBlockAt: this.lastBlockAt,
      staleAfterMs: this.options.staleAfterMs,
    });
    const computed = measured && !this.latestPulse && measured.sampleBlocks < minSamples ? null : measured;
    // Not measurable right now (a quiet chain emptied the window): keep the last figures, flagged unhealthy.
    const pulse = computed ?? (this.latestPulse ? refreshPulse(this.latestPulse, now, this.lastBlockAt, this.options.staleAfterMs) : null);
    if (!pulse) return null;
    this.latestPulse = pulse;
    this.bus.emit("elysium.pulse", pulse);
    return pulse;
  }
}

/* ----------------------------------------------------------- service */

/** What routes need from the pulse (a seam for tests). */
export interface PulseFeed {
  /** The Elysium network of the configured mode. */
  readonly defaultNetwork: NetworkKey;
  /** Keeps the network's poller running until the returned release is called (then ~30 s more). */
  retain(network: NetworkKey): () => void;
  latest(network: NetworkKey): Pulse | null;
  recentBlocks(network: NetworkKey, afterNumber?: number): readonly PulseBlock[];
  /** A pulse no older than `maxAgeMs`, waiting up to `timeoutMs` for the poller to produce one. */
  waitForPulse(network: NetworkKey, options?: { readonly timeoutMs?: number; readonly maxAgeMs?: number }): Promise<Pulse | null>;
  status(): Partial<Record<NetworkKey, PollerStatus>>;
  close(): void;
}

export interface PulseServiceOptions {
  readonly networks: Readonly<Record<NetworkKey, Network>>;
  readonly defaultNetwork: NetworkKey;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly log: Logger;
  readonly fetch?: FetchLike;
  readonly options?: Partial<PulseOptions>;
}

interface Slot {
  readonly poller: ElysiumPulsePoller;
  subscribers: number;
  idleTimer: NodeJS.Timeout | null;
}

export class PulseService implements PulseFeed {
  readonly defaultNetwork: NetworkKey;
  private readonly deps: PulseServiceOptions;
  private readonly slots = new Map<NetworkKey, Slot>();
  private readonly options: PulseOptions;
  /** When each network last published (pulse `updatedAt`), to judge freshness. */
  private readonly lastPublishedAt = new Map<NetworkKey, number>();
  private readonly offPulse: () => void;

  constructor(deps: PulseServiceOptions) {
    this.deps = deps;
    this.defaultNetwork = deps.defaultNetwork;
    this.options = { ...DEFAULT_PULSE_OPTIONS, ...deps.options };
    this.offPulse = deps.bus.on("elysium.pulse", (pulse) => {
      this.lastPublishedAt.set(pulse.network, pulse.updatedAt);
    });
  }

  /** The Elysium network, or 400 / 503 when it is not one or cannot be polled. */
  private elysium(key: NetworkKey): EvmNetwork {
    const network = this.deps.networks[key];
    if (!network || network.vm !== "evm" || network.family !== "elysium") {
      throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${key} is not an Elysium network.`, { network: key });
    }
    if (network.rpcUrls.length === 0) {
      throw networkUnavailable(
        network.name,
        network.status === "prelaunch" ? "it has not launched publicly and no RPC endpoint is configured" : "no RPC endpoint is configured",
      );
    }
    return network;
  }

  private slot(key: NetworkKey): Slot {
    let slot = this.slots.get(key);
    if (!slot) {
      const network = this.elysium(key);
      const poller = new ElysiumPulsePoller({
        network,
        rpc: new JsonRpcEndpoints({ urls: network.rpcUrls, now: () => this.deps.clock.now(), ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}) }),
        bus: this.deps.bus,
        clock: this.deps.clock,
        log: this.deps.log.child({ component: "pulse", network: key }),
        options: this.options,
      });
      slot = { poller, subscribers: 0, idleTimer: null };
      this.slots.set(key, slot);
    }
    return slot;
  }

  retain(key: NetworkKey): () => void {
    const slot = this.slot(key);
    slot.subscribers += 1;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
    slot.poller.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      slot.subscribers = Math.max(0, slot.subscribers - 1);
      if (slot.subscribers > 0) return;
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.idleTimer = setTimeout(() => {
        slot.idleTimer = null;
        if (slot.subscribers === 0) slot.poller.stop();
      }, this.options.idleStopMs);
      slot.idleTimer.unref();
    };
  }

  latest(key: NetworkKey): Pulse | null {
    this.elysium(key);
    return this.slots.get(key)?.poller.latest() ?? null;
  }

  recentBlocks(key: NetworkKey, afterNumber?: number): readonly PulseBlock[] {
    this.elysium(key);
    return this.slots.get(key)?.poller.recentBlocks(afterNumber) ?? [];
  }

  async waitForPulse(key: NetworkKey, options: { readonly timeoutMs?: number; readonly maxAgeMs?: number } = {}): Promise<Pulse | null> {
    const maxAgeMs = options.maxAgeMs ?? this.options.pulseEveryMs * 2;
    const timeoutMs = options.timeoutMs ?? 2_500;
    // Polling a pulse keeps the poller warm for idleStopMs, like a short-lived subscriber.
    const release = this.retain(key);
    try {
      const poller = this.slot(key).poller;
      const current = poller.latest();
      const now = this.deps.clock.now();
      // `latest()` refreshes updatedAt, so freshness is judged by the poller's own last publication.
      if (current && poller.isRunning && now - (this.lastPublishedAt.get(key) ?? 0) <= maxAgeMs) return current;
      return await new Promise<Pulse | null>((resolve) => {
        const timer = setTimeout(() => {
          off();
          // A quiet chain may not have produced enough blocks for a first pulse: accept a two-sample one rather than nothing.
          resolve(poller.latest() ?? poller.publishPulse(2));
        }, timeoutMs);
        timer.unref();
        const off = this.deps.bus.on("elysium.pulse", (pulse) => {
          if (pulse.network !== key) return;
          clearTimeout(timer);
          off();
          resolve(pulse);
        });
      });
    } finally {
      release();
    }
  }

  status(): Partial<Record<NetworkKey, PollerStatus>> {
    const out: Partial<Record<NetworkKey, PollerStatus>> = {};
    for (const [key, slot] of this.slots) out[key] = slot.poller.status(slot.subscribers);
    return out;
  }

  close(): void {
    this.offPulse();
    for (const slot of this.slots.values()) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
      slot.poller.stop();
    }
  }
}
