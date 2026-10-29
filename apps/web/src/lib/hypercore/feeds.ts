/**
 * Live HyperCore feeds as external stores for React (useSyncExternalStore).
 *
 * A feed is one WebSocket subscription plus a reducer that folds its
 * messages into a value: "latest" keeps the newest message, "trades" keeps
 * the newest prints, "fills" / "fundings" / "twapHistory" merge a user feed's
 * snapshot with the updates that follow (de-duplicated, newest first).
 * Feeds are shared per (mode, kind, subscription): every component reading
 * the ETH book reads one store fed by one subscription.
 */
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { hyperCoreSocket } from "./runtime";
import { reduceFeed, type FeedKind } from "./feedReducers";
import { subscriptionFromKey, subscriptionKey, type Subscription } from "./wsRouting";

export type { FeedKind } from "./feedReducers";

export interface FeedSnapshot<T> {
  readonly value: T | null;
  /** Local time of the last message (ms); null until the first one. */
  readonly updatedAt: number | null;
}

class Feed {
  private snapshot: FeedSnapshot<unknown> = { value: null, updatedAt: null };
  private readonly listeners = new Set<() => void>();
  private leave: (() => void) | null = null;

  constructor(
    private readonly mode: NetworkEnvironment,
    private readonly kind: FeedKind,
    private readonly sub: Subscription,
  ) {}

  getSnapshot = (): FeedSnapshot<unknown> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.leave) {
      this.leave = hyperCoreSocket(this.mode).subscribe(this.sub, (data) => {
        this.snapshot = { value: reduceFeed(this.kind, this.snapshot.value, data), updatedAt: Date.now() };
        for (const notify of [...this.listeners]) notify();
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.leave) {
        this.leave();
        this.leave = null;
        // User feeds restart with a snapshot; keep market values so a quick remount shows the last book.
        if (this.kind !== "latest" && this.kind !== "trades") this.snapshot = { value: null, updatedAt: null };
      }
    };
  };
}

const feeds = new Map<string, Feed>();

function feedFor(mode: NetworkEnvironment, kind: FeedKind, key: string): Feed {
  const id = `${mode}|${kind}|${key}`;
  let feed = feeds.get(id);
  if (!feed) {
    feed = new Feed(mode, kind, subscriptionFromKey(key));
    feeds.set(id, feed);
  }
  return feed;
}

const EMPTY: FeedSnapshot<never> = Object.freeze({ value: null, updatedAt: null });
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** Safe key for a subscription (null when the subscription is absent or malformed). */
export function feedKey(sub: Subscription | null | undefined): string | null {
  if (!sub) return null;
  try {
    return subscriptionKey(sub);
  } catch {
    return null;
  }
}

/**
 * Live value of a HyperCore subscription. Pass null to read nothing (no
 * wallet yet, no market yet). The value type is the caller's promise about
 * the channel's data shape; parse defensively where it matters.
 */
export function useHyperCoreFeed<T>(mode: NetworkEnvironment, sub: Subscription | null, kind: FeedKind = "latest"): FeedSnapshot<T> {
  const key = feedKey(sub);
  const feed = useMemo(() => (key === null ? null : feedFor(mode, kind, key)), [mode, kind, key]);
  return useSyncExternalStore(feed ? feed.subscribe : noopSubscribe, feed ? (feed.getSnapshot as () => FeedSnapshot<T>) : (emptySnapshot as () => FeedSnapshot<T>), emptySnapshot as () => FeedSnapshot<T>);
}

/**
 * Calls `handler` for each message of a subscription (fills to pluck a
 * string, order updates to reconcile optimistic rows). The latest handler
 * is used without re-subscribing.
 */
export function useHyperCoreEvents(mode: NetworkEnvironment, sub: Subscription | null, handler: (data: unknown, channel: string) => void): void {
  const key = feedKey(sub);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (key === null) return undefined;
    return hyperCoreSocket(mode).subscribe(subscriptionFromKey(key), (data, channel) => handlerRef.current(data, channel));
  }, [mode, key]);
}

/** Live socket status for the connection badge. */
export function useSocketStatus(mode: NetworkEnvironment): ReturnType<ReturnType<typeof hyperCoreSocket>["getStatus"]> {
  const socket = hyperCoreSocket(mode);
  return useSyncExternalStore(socket.onStatus, socket.getStatus, socket.getStatus);
}
