/**
 * One HyperCore WebSocket per network mode, shared by the whole app.
 *
 * - Subscriptions are reference counted: the first listener sends
 *   `subscribe`, the last one leaving sends `unsubscribe` (after a short grace
 *   so a re-render does not churn the server; the order book unsubscribes at
 *   once because its messages do not say which grouping they carry).
 * - Reconnects with jittered exponential backoff and re-subscribes every
 *   live subscription; user feeds then restart with a snapshot.
 * - Heartbeat: `{"method":"ping"}` every 30 s (HyperCore closes a connection
 *   after 60 s of client silence) and a forced reconnect when nothing at all
 *   arrives for 65 s.
 * - Closes itself a while after the last subscription leaves.
 *
 * The WebSocket constructor, timers and clock are injectable for tests.
 */
import { backoffDelay } from "../backoff";
import { normalizeSubscription, subscriptionKey, subscriptionMatches, wireSubscription, channelSubscriptionType, type Subscription, type SubscriptionType } from "./wsRouting";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting";

export type MessageListener = (data: unknown, channel: string) => void;

interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SocketOptions {
  readonly url: string;
  readonly createSocket?: WebSocketFactory;
  readonly timers?: TimerApi;
  readonly now?: () => number;
  readonly pingMs?: number;
  readonly staleMs?: number;
  readonly unsubscribeGraceMs?: number;
  readonly idleCloseMs?: number;
  readonly random?: () => number;
}

const OPEN = 1;

interface Entry {
  readonly key: string;
  readonly sub: Subscription;
  readonly listeners: Set<MessageListener>;
  /** Sent to the server on the current connection. */
  live: boolean;
  /** Pending unsubscribe timer. */
  leaving: unknown;
}

const browserTimers: TimerApi = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export class HyperCoreSocket {
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly timers: TimerApi;
  private readonly now: () => number;
  private readonly pingMs: number;
  private readonly staleMs: number;
  private readonly graceMs: number;
  private readonly idleCloseMs: number;
  private readonly random: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly byType = new Map<SubscriptionType, Set<Entry>>();
  private readonly statusListeners = new Set<() => void>();
  private socket: WebSocketLike | null = null;
  private status: SocketStatus = "idle";
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeat: unknown = null;
  private idleTimer: unknown = null;
  private lastMessageAt = 0;
  /** Messages received since construction (diagnostics, tests). */
  received = 0;

  constructor(options: SocketOptions) {
    this.url = options.url;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => Date.now());
    this.pingMs = options.pingMs ?? 30_000;
    this.staleMs = options.staleMs ?? 65_000;
    this.graceMs = options.unsubscribeGraceMs ?? 1_500;
    this.idleCloseMs = options.idleCloseMs ?? 20_000;
    this.random = options.random ?? Math.random;
  }

  getStatus = (): SocketStatus => this.status;

  onStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  /** Number of distinct live subscriptions (diagnostics, tests). */
  get subscriptionCount(): number {
    return this.entries.size;
  }

  /** Starts (or joins) a subscription; returns the function that leaves it. */
  subscribe(input: Subscription, listener: MessageListener): () => void {
    const sub = normalizeSubscription(input);
    const key = subscriptionKey(sub);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, sub, listeners: new Set(), live: false, leaving: null };
      this.entries.set(key, entry);
      let group = this.byType.get(sub.type);
      if (!group) {
        group = new Set();
        this.byType.set(sub.type, group);
      }
      group.add(entry);
    }
    if (entry.leaving !== null) {
      this.timers.clearTimeout(entry.leaving);
      entry.leaving = null;
    }
    entry.listeners.add(listener);
    this.cancelIdleClose();
    this.ensureConnected();
    if (!entry.live) this.sendSubscribe(entry);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.leave(key, listener);
    };
  }

  /** Closes the connection and forgets every subscription. */
  close(): void {
    for (const entry of this.entries.values()) if (entry.leaving !== null) this.timers.clearTimeout(entry.leaving);
    this.entries.clear();
    this.byType.clear();
    this.teardown();
    this.setStatus("idle");
  }

  private leave(key: string, listener: MessageListener): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0) return;
    const drop = () => {
      entry.leaving = null;
      if (entry.listeners.size > 0) return;
      this.entries.delete(key);
      this.byType.get(entry.sub.type)?.delete(entry);
      if (entry.live) this.send({ method: "unsubscribe", subscription: wireSubscription(entry.sub) });
      entry.live = false;
      if (this.entries.size === 0) this.scheduleIdleClose();
    };
    // A book's messages do not say which grouping they carry: leave at once so the next one starts clean.
    if (entry.sub.type === "l2Book" || this.graceMs <= 0) drop();
    else entry.leaving = this.timers.setTimeout(drop, this.graceMs);
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener();
  }

  private ensureConnected(): void {
    if (this.socket || this.reconnectTimer !== null) return;
    this.connect();
  }

  private connect(): void {
    this.reconnectTimer = null;
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.lastMessageAt = this.now();
      this.setStatus("open");
      for (const entry of this.entries.values()) {
        entry.live = false;
        if (entry.listeners.size > 0 || entry.leaving !== null) this.sendSubscribe(entry);
      }
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = this.now();
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      // onclose follows and handles the reconnect.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      for (const entry of this.entries.values()) entry.live = false;
      if (this.entries.size > 0) this.scheduleReconnect();
      else this.setStatus("idle");
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.attempt += 1;
    this.setStatus("reconnecting");
    const delay = backoffDelay(this.attempt, { baseMs: 800, maxMs: 15_000, minMs: 300 }, this.random);
    this.reconnectTimer = this.timers.setTimeout(() => this.connect(), delay);
  }

  private teardown(): void {
    this.stopHeartbeat();
    this.cancelIdleClose();
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.attempt = 0;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "done");
      } catch {
        // Already closed.
      }
    }
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = null;
      if (this.entries.size === 0) {
        this.teardown();
        this.setStatus("idle");
      }
    }, this.idleCloseMs);
  }

  private cancelIdleClose(): void {
    if (this.idleTimer !== null) {
      this.timers.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = this.timers.setInterval(() => {
      if (!this.socket) return;
      if (this.now() - this.lastMessageAt > this.staleMs) {
        // Silent for too long: drop the connection and let onclose reconnect.
        const socket = this.socket;
        this.socket = null;
        this.stopHeartbeat();
        try {
          socket.close(4000, "stale");
        } catch {
          // Ignore.
        }
        for (const entry of this.entries.values()) entry.live = false;
        this.scheduleReconnect();
        return;
      }
      this.send({ method: "ping" });
    }, this.pingMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      this.timers.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private sendSubscribe(entry: Entry): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    entry.live = true;
    this.send({ method: "subscribe", subscription: wireSubscription(entry.sub) });
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // A failed send surfaces as a close; the reconnect re-sends subscriptions.
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: { channel?: unknown; data?: unknown };
    try {
      message = JSON.parse(raw) as { channel?: unknown; data?: unknown };
    } catch {
      return;
    }
    const channel = typeof message.channel === "string" ? message.channel : null;
    if (!channel) return;
    this.received += 1;
    const type = channelSubscriptionType(channel);
    if (type === null) return;
    const group = this.byType.get(type);
    if (!group || group.size === 0) return;
    for (const entry of [...group]) {
      if (entry.listeners.size === 0 || !subscriptionMatches(entry.sub, channel, message.data)) continue;
      for (const listener of [...entry.listeners]) {
        try {
          listener(message.data, channel);
        } catch (error) {
          // One faulty consumer must not starve the others.
          if (typeof console !== "undefined") console.error("[elyia] HyperCore feed listener failed", error);
        }
      }
    }
  }
}
