/**
 * HyperCore WebSocket subscriptions and message routing (pure).
 *
 * The socket multiplexes many subscriptions; HyperCore pushes
 * `{channel, data}` messages without echoing the subscription, so each
 * message is matched back to subscriptions by its channel and the fields the
 * data carries (coin, interval, user, dex). User feeds whose data has no user
 * field (`orderUpdates`, `userEvents` on channel "user") go to every
 * subscription of that type; the terminal follows one account at a time.
 *
 * Known channels (HyperCore docs, verified on testnet 2026-10-29): allMids,
 * l2Book, trades, candle, activeAssetCtx (spot coins answer on
 * activeSpotAssetCtx), activeAssetData, allDexsAssetCtxs, orderUpdates,
 * user (userEvents), userFills, userFundings, webData3, clearinghouseState,
 * allDexsClearinghouseState, openOrders, spotState, twapStates,
 * userTwapHistory, userTwapSliceFills. `webData2` is dead: use webData3.
 */
import type { CandleInterval } from "@elyia/core/hypercore/info";

export type Subscription =
  | { readonly type: "allMids"; readonly dex?: string }
  | { readonly type: "l2Book"; readonly coin: string; readonly nSigFigs?: 2 | 3 | 4 | 5 | null; readonly mantissa?: 2 | 5 | null }
  | { readonly type: "trades"; readonly coin: string }
  | { readonly type: "candle"; readonly coin: string; readonly interval: CandleInterval }
  | { readonly type: "activeAssetCtx"; readonly coin: string }
  | { readonly type: "activeAssetData"; readonly user: string; readonly coin: string }
  | { readonly type: "allDexsAssetCtxs" }
  | { readonly type: "orderUpdates"; readonly user: string }
  | { readonly type: "userEvents"; readonly user: string }
  | { readonly type: "userFills"; readonly user: string; readonly aggregateByTime?: boolean }
  | { readonly type: "userFundings"; readonly user: string }
  | { readonly type: "webData3"; readonly user: string }
  | { readonly type: "clearinghouseState"; readonly user: string; readonly dex?: string }
  | { readonly type: "allDexsClearinghouseState"; readonly user: string }
  | { readonly type: "openOrders"; readonly user: string; readonly dex?: string }
  | { readonly type: "spotState"; readonly user: string }
  | { readonly type: "twapStates"; readonly user: string; readonly dex?: string }
  | { readonly type: "userTwapHistory"; readonly user: string }
  | { readonly type: "userTwapSliceFills"; readonly user: string };

export type SubscriptionType = Subscription["type"];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

/** Subscription types that follow one account (HyperCore allows 10 unique users per IP across them). */
export const USER_SUBSCRIPTION_TYPES: ReadonlySet<SubscriptionType> = new Set([
  "activeAssetData",
  "orderUpdates",
  "userEvents",
  "userFills",
  "userFundings",
  "webData3",
  "clearinghouseState",
  "allDexsClearinghouseState",
  "openOrders",
  "spotState",
  "twapStates",
  "userTwapHistory",
  "userTwapSliceFills",
]);

/**
 * Canonical form: users lower-cased, optional fields removed when they hold
 * their default (empty dex, null grouping, false aggregation). Throws on a
 * malformed address so a typo never opens a feed for nobody.
 */
export function normalizeSubscription(sub: Subscription): Subscription {
  if ("user" in sub) {
    if (!ADDRESS.test(sub.user)) throw new Error(`Not an address: ${sub.user}`);
  }
  switch (sub.type) {
    case "allMids":
      return sub.dex ? { type: "allMids", dex: sub.dex } : { type: "allMids" };
    case "l2Book": {
      const nSigFigs = sub.nSigFigs ?? null;
      const mantissa = nSigFigs === 5 ? (sub.mantissa ?? null) : null;
      return {
        type: "l2Book",
        coin: sub.coin,
        ...(nSigFigs !== null ? { nSigFigs } : {}),
        ...(mantissa !== null ? { mantissa } : {}),
      };
    }
    case "trades":
    case "activeAssetCtx":
      return { type: sub.type, coin: sub.coin };
    case "candle":
      return { type: "candle", coin: sub.coin, interval: sub.interval };
    case "activeAssetData":
      return { type: "activeAssetData", user: sub.user.toLowerCase(), coin: sub.coin };
    case "allDexsAssetCtxs":
      return { type: "allDexsAssetCtxs" };
    case "userFills":
      return sub.aggregateByTime ? { type: "userFills", user: sub.user.toLowerCase(), aggregateByTime: true } : { type: "userFills", user: sub.user.toLowerCase() };
    case "clearinghouseState":
    case "openOrders":
    case "twapStates":
      return sub.dex ? { type: sub.type, user: sub.user.toLowerCase(), dex: sub.dex } : { type: sub.type, user: sub.user.toLowerCase() };
    default:
      return { type: sub.type, user: sub.user.toLowerCase() } as Subscription;
  }
}

/** One string per distinct subscription: the canonical JSON (also how feeds are cached). */
export function subscriptionKey(sub: Subscription): string {
  const normal = normalizeSubscription(sub) as unknown as Record<string, unknown>;
  const ordered = Object.fromEntries(Object.keys(normal).sort().map((key) => [key, normal[key]]));
  return JSON.stringify(ordered);
}

/** The subscription a key was made from. */
export function subscriptionFromKey(key: string): Subscription {
  return normalizeSubscription(JSON.parse(key) as Subscription);
}

/** What goes on the wire in `{"method":"subscribe","subscription":…}`. */
export function wireSubscription(sub: Subscription): Record<string, unknown> {
  return { ...(normalizeSubscription(sub) as unknown as Record<string, unknown>) };
}

/** Subscription type a channel's messages belong to, or null for control channels. */
export function channelSubscriptionType(channel: string): SubscriptionType | null {
  switch (channel) {
    case "user":
      return "userEvents";
    case "activeSpotAssetCtx":
      return "activeAssetCtx";
    case "subscriptionResponse":
    case "pong":
    case "error":
    case "post":
      return null;
    default:
      return (KNOWN_TYPES as ReadonlySet<string>).has(channel) ? (channel as SubscriptionType) : null;
  }
}

const KNOWN_TYPES: ReadonlySet<SubscriptionType> = new Set<SubscriptionType>([
  "allMids",
  "l2Book",
  "trades",
  "candle",
  "activeAssetCtx",
  "activeAssetData",
  "allDexsAssetCtxs",
  "orderUpdates",
  "userEvents",
  "userFills",
  "userFundings",
  "webData3",
  "clearinghouseState",
  "allDexsClearinghouseState",
  "openOrders",
  "spotState",
  "twapStates",
  "userTwapHistory",
  "userTwapSliceFills",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function lower(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

/**
 * True when a message on `channel` with `data` belongs to `sub`. When the
 * data does not say which subscription it answers (no coin or user field),
 * every subscription of the channel's type matches.
 */
export function subscriptionMatches(sub: Subscription, channel: string, data: unknown): boolean {
  const type = channelSubscriptionType(channel);
  if (type === null || type !== sub.type) return false;
  const body = record(data);
  switch (sub.type) {
    case "allMids": {
      // A builder dex's mids say which dex they are; the first dex's carry no dex (or "").
      const dex = typeof body?.dex === "string" ? body.dex : "";
      return dex === (sub.dex ?? "");
    }
    case "allDexsAssetCtxs":
    case "orderUpdates":
    case "userEvents":
      return true;
    case "l2Book":
    case "activeAssetCtx":
      return body !== null && body.coin === sub.coin;
    case "trades": {
      if (!Array.isArray(data)) return false;
      const first = record(data[0]);
      return first === null || first.coin === sub.coin;
    }
    case "candle":
      return body !== null && body.s === sub.coin && body.i === sub.interval;
    case "activeAssetData":
      return body !== null && lower(body.user) === sub.user.toLowerCase() && body.coin === sub.coin;
    case "webData3": {
      const state = record(body?.userState);
      const user = lower(state?.user);
      return user === null || user === sub.user.toLowerCase();
    }
    case "clearinghouseState":
    case "openOrders":
    case "twapStates": {
      if (body === null) return false;
      const user = lower(body.user);
      const dex = typeof body.dex === "string" ? body.dex : "";
      return (user === null || user === sub.user.toLowerCase()) && dex === (sub.dex ?? "");
    }
    default: {
      const user = lower(body?.user);
      return user === null || user === sub.user.toLowerCase();
    }
  }
}
