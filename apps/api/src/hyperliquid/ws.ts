/**
 * One shared Hyperliquid WebSocket per HyperCore network, fanned out to any
 * number of in-process listeners.
 *
 * - `subscribe(subscription, listener)` refcounts identical subscriptions:
 *   the first listener sends `subscribe` upstream, the last one leaving sends
 *   `unsubscribe`. The socket opens on the first subscription and closes
 *   after an idle grace period once none are left.
 * - Messages are routed by channel plus the identifying fields HL echoes in
 *   the payload (coin, interval, user). Subscription options HL does not echo
 *   (l2Book nSigFigs/mantissa, userFills aggregateByTime, allMids dex) cannot
 *   be told apart, so a second variant of the same route is refused with 409
 *   WS_SUBSCRIPTION_CONFLICT rather than mis-delivered.
 * - Stateful channels (books, mids, bbo, contexts) replay their last message
 *   to a listener that joins an existing subscription.
 * - Reconnects with exponential backoff and jitter and resubscribes
 *   everything; `{"method":"ping"}` every 50 s (HL closes idle sockets after
 *   60 s) and a watchdog forces a reconnect when nothing arrives for too long.
 * - At most `maxSubscriptions` distinct subscriptions (HL allows 1000 per IP).
 */
import { ElyiaHttpError } from "../http/errors.js";
import type { Logger } from "../log.js";
import type { WsDataFor, WsSubscription } from "./types.js";

export const WS_PING_INTERVAL_MS = 50_000;
export const WS_IDLE_CLOSE_MS = 30_000;
export const WS_MAX_SUBSCRIPTIONS = 500;
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/** The part of the WHATWG WebSocket API this module uses (Node 22's global WebSocket satisfies it). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { readonly code?: number }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

export interface HyperliquidWsOptions {
  readonly url: string;
  readonly log?: Logger;
  readonly createSocket?: SocketFactory;
  readonly maxSubscriptions?: number;
  readonly pingIntervalMs?: number;
  readonly idleCloseMs?: number;
  readonly backoffInitialMs?: number;
  readonly backoffMaxMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
}

export type WsListener<S extends WsSubscription = WsSubscription> = (data: WsDataFor<S>, channel: string) => void;

interface Entry {
  readonly key: string;
  readonly route: string;
  readonly subscription: WsSubscription;
  readonly listeners: Set<WsListener<never>>;
  last: { readonly data: unknown; readonly channel: string } | null;
}

export interface WsStatus {
  readonly state: "idle" | "connecting" | "open" | "reconnecting" | "closed";
  readonly subscriptions: number;
  readonly listeners: number;
  readonly lastMessageAt: number | null;
  readonly reconnects: number;
}

/** Channels whose latest message is a complete state (safe to replay to late joiners). */
const STATEFUL_TYPES: ReadonlySet<string> = new Set(["allMids", "l2Book", "bbo", "activeAssetCtx", "activeAssetData", "candle", "webData2"]);

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Canonical identity of a subscription (sorted keys, lowercase user). */
export function subscriptionKey(subscription: WsSubscription): string {
  const record: Record<string, unknown> = { ...subscription };
  if (typeof record.user === "string") record.user = record.user.toLowerCase();
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .sort();
  return JSON.stringify(keys.map((key) => [key, record[key]]));
}

/** The route a subscription's messages arrive on (only fields HL echoes in the payload). */
export function routeOfSubscription(subscription: WsSubscription): string {
  switch (subscription.type) {
    case "trades":
    case "l2Book":
    case "bbo":
    case "activeAssetCtx":
      return `${subscription.type}|${subscription.coin}`;
    case "candle":
      return `candle|${subscription.coin}|${subscription.interval}`;
    case "activeAssetData":
      return `activeAssetData|${subscription.user.toLowerCase()}|${subscription.coin}`;
    case "userFills":
    case "userFundings":
    case "userNonFundingLedgerUpdates":
    case "webData2":
    case "userTwapSliceFills":
    case "userTwapHistory":
      return `${subscription.type}|${subscription.user.toLowerCase()}`;
    case "allMids":
    case "orderUpdates":
    case "userEvents":
    case "notification":
      return subscription.type;
    default:
      return (subscription as { type: string }).type;
  }
}

/** The route of an incoming message, or null for control and unroutable messages. */
export function routeOfMessage(channel: string, data: unknown): string | null {
  const record = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  switch (channel) {
    case "trades": {
      const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
      const coin = text(first?.coin);
      return coin ? `trades|${coin}` : null;
    }
    case "l2Book":
    case "bbo":
      return text(record.coin) ? `${channel}|${text(record.coin)}` : null;
    case "activeAssetCtx":
    case "activeSpotAssetCtx":
      return text(record.coin) ? `activeAssetCtx|${text(record.coin)}` : null;
    case "candle":
      return text(record.s) && text(record.i) ? `candle|${text(record.s)}|${text(record.i)}` : null;
    case "activeAssetData":
      return lower(record.user) && text(record.coin) ? `activeAssetData|${lower(record.user)}|${text(record.coin)}` : null;
    case "userFills":
    case "userFundings":
    case "userNonFundingLedgerUpdates":
    case "webData2":
    case "userTwapSliceFills":
    case "userTwapHistory":
      return lower(record.user) ? `${channel}|${lower(record.user)}` : null;
    case "allMids":
    case "orderUpdates":
    case "notification":
      return channel;
    case "user":
      return "userEvents";
    case "pong":
    case "subscriptionResponse":
    case "error":
      return null;
    default:
      return channel;
  }
}

export class HyperliquidWs {
  private readonly url: string;
  private readonly log: Logger | undefined;
  private readonly createSocket: SocketFactory;
  private readonly maxSubscriptions: number;
  private readonly pingIntervalMs: number;
  private readonly idleCloseMs: number;
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private readonly entries = new Map<string, Entry>();
  private readonly routes = new Map<string, Entry>();
  private socket: SocketLike | null = null;
  private state: WsStatus["state"] = "idle";
  private attempts = 0;
  private reconnects = 0;
  private lastMessageAt: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private closedForGood = false;

  constructor(options: HyperliquidWsOptions) {
    this.url = options.url;
    this.log = options.log;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.maxSubscriptions = options.maxSubscriptions ?? WS_MAX_SUBSCRIPTIONS;
    this.pingIntervalMs = options.pingIntervalMs ?? WS_PING_INTERVAL_MS;
    this.idleCloseMs = options.idleCloseMs ?? WS_IDLE_CLOSE_MS;
    this.backoffInitialMs = options.backoffInitialMs ?? BACKOFF_INITIAL_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? BACKOFF_MAX_MS;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /**
   * Adds a listener; returns its idempotent unsubscribe function. Throws 409
   * WS_SUBSCRIPTION_CONFLICT for an indistinguishable variant of an active
   * route and 503 WS_SUBSCRIPTION_LIMIT when the subscription cap is reached.
   */
  subscribe<S extends WsSubscription>(subscription: S, listener: WsListener<S>): () => void {
    if (this.closedForGood) throw new ElyiaHttpError("HYPERLIQUID_UNAVAILABLE", 502, "The Hyperliquid feed is shut down.");
    const key = subscriptionKey(subscription);
    let entry = this.entries.get(key);
    if (!entry) {
      const route = routeOfSubscription(subscription);
      const existing = this.routes.get(route);
      if (existing) {
        throw new ElyiaHttpError("WS_SUBSCRIPTION_CONFLICT", 409, "A different variant of this Hyperliquid subscription is already active.", {
          type: subscription.type,
        });
      }
      if (this.entries.size >= this.maxSubscriptions) {
        throw new ElyiaHttpError("WS_SUBSCRIPTION_LIMIT", 503, "The Hyperliquid feed is at its subscription limit. Try again later.");
      }
      entry = { key, route, subscription, listeners: new Set(), last: null };
      this.entries.set(key, entry);
      this.routes.set(route, entry);
      this.sendSubscription("subscribe", subscription);
    }
    const wrapped: WsListener<never> = (data, channel) => (listener as WsListener<never>)(data, channel);
    entry.listeners.add(wrapped);
    this.cancelIdleClose();
    this.ensureConnected();

    const replay = entry.last;
    if (replay && STATEFUL_TYPES.has(subscription.type)) {
      queueMicrotask(() => {
        if (entry.listeners.has(wrapped)) this.deliver(wrapped, replay.data, replay.channel);
      });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.entries.get(key);
      if (!current) return;
      current.listeners.delete(wrapped);
      if (current.listeners.size === 0) {
        this.entries.delete(key);
        this.routes.delete(current.route);
        this.sendSubscription("unsubscribe", current.subscription);
        if (this.entries.size === 0) this.scheduleIdleClose();
      }
    };
  }

  /** The last message of an active stateful subscription (e.g. the current book). */
  last<S extends WsSubscription>(subscription: S): WsDataFor<S> | null {
    const entry = this.entries.get(subscriptionKey(subscription));
    return entry?.last && STATEFUL_TYPES.has(subscription.type) ? (entry.last.data as WsDataFor<S>) : null;
  }

  status(): WsStatus {
    let listeners = 0;
    for (const entry of this.entries.values()) listeners += entry.listeners.size;
    return { state: this.state, subscriptions: this.entries.size, listeners, lastMessageAt: this.lastMessageAt, reconnects: this.reconnects };
  }

  /** Closes the socket for good (shutdown). Pending listeners stop receiving. */
  close(): void {
    this.closedForGood = true;
    this.clearTimers();
    this.entries.clear();
    this.routes.clear();
    this.state = "closed";
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, "shutdown");
      } catch {
        // Already closing.
      }
    }
  }

  /* --------------------------------------------------------- internals */

  private ensureConnected(): void {
    if (this.socket || this.reconnectTimer || this.closedForGood) return;
    this.connect();
  }

  private connect(): void {
    this.state = this.reconnects > 0 || this.attempts > 0 ? "reconnecting" : "connecting";
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch (error) {
      this.log?.warn("hyperliquid ws connect failed", { error: error instanceof Error ? error.message : String(error) });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.state = "open";
      this.lastMessageAt = this.now();
      for (const entry of this.entries.values()) this.write({ method: "subscribe", subscription: entry.subscription });
      this.startPing();
      this.log?.info("hyperliquid ws open", { url: this.url, subscriptions: this.entries.size });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.onMessage(event.data);
    });
    socket.addEventListener("error", () => {
      // A close event always follows; reconnection happens there.
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (this.closedForGood) return;
      if (this.entries.size === 0) {
        this.state = "idle";
        return;
      }
      this.log?.warn("hyperliquid ws closed", { code: event.code ?? null, subscriptions: this.entries.size });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedForGood) return;
    this.state = "reconnecting";
    const exp = Math.min(this.backoffMaxMs, this.backoffInitialMs * 2 ** Math.min(this.attempts, 16));
    // Full jitter in [exp/2, exp]: many processes restarting together do not reconnect in lockstep.
    const delay = Math.round(exp / 2 + (exp / 2) * this.random());
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedForGood || this.entries.size === 0) {
        this.state = "idle";
        return;
      }
      this.reconnects += 1;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private onMessage(raw: unknown): void {
    this.lastMessageAt = this.now();
    let message: { channel?: unknown; data?: unknown };
    try {
      message = JSON.parse(typeof raw === "string" ? raw : String(raw)) as { channel?: unknown; data?: unknown };
    } catch {
      this.log?.debug("hyperliquid ws non-json message");
      return;
    }
    const channel = typeof message.channel === "string" ? message.channel : "";
    if (channel === "pong") return;
    if (channel === "subscriptionResponse") {
      // A healthy round trip: the connection is stable, so the next drop starts from the shortest backoff.
      this.attempts = 0;
      return;
    }
    if (channel === "error") {
      this.log?.warn("hyperliquid ws error message", { message: String(message.data).slice(0, 200) });
      return;
    }
    const route = routeOfMessage(channel, message.data);
    if (!route) return;
    const entry = this.routes.get(route);
    if (!entry) return;
    entry.last = { data: message.data, channel };
    for (const listener of [...entry.listeners]) this.deliver(listener, message.data, channel);
  }

  private deliver(listener: WsListener<never>, data: unknown, channel: string): void {
    try {
      (listener as (data: unknown, channel: string) => void)(data, channel);
    } catch (error) {
      this.log?.error("hyperliquid ws listener failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private sendSubscription(method: "subscribe" | "unsubscribe", subscription: WsSubscription): void {
    // While disconnected nothing is sent: `open` resubscribes the current set.
    this.write({ method, subscription });
  }

  private write(payload: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      this.log?.warn("hyperliquid ws send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      const silentFor = this.now() - (this.lastMessageAt ?? 0);
      if (silentFor > this.pingIntervalMs * 2) {
        // No pong, no data: the connection is dead even if TCP has not noticed.
        this.log?.warn("hyperliquid ws watchdog reconnect", { silentMs: silentFor });
        try {
          socket.close(4000, "watchdog");
        } catch {
          // Ignored: close handling below covers it.
        }
        return;
      }
      this.write({ method: "ping" });
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.entries.size > 0) return;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      const socket = this.socket;
      this.socket = null;
      this.stopPing();
      this.state = "idle";
      this.attempts = 0;
      if (socket) {
        try {
          socket.close(1000, "idle");
        } catch {
          // Already closing.
        }
      }
    }, this.idleCloseMs);
    this.idleTimer.unref?.();
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearTimers(): void {
    this.cancelIdleClose();
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
