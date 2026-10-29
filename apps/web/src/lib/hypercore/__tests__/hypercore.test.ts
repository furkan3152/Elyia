import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { explainExchangeError, postExchange, readOutcomes } from "../exchangeClient";
import { cacheTtlMs, InfoClient, InfoError, infoKey, infoWeight } from "../infoClient";
import { bookGroupings, change24h, ctxsByDexFrom, filterMarkets, findMarket, formatCountdown, formatPx, fundingApr, hip3MarketsFrom, msToNextFunding, openInterestUsd, perpMarketsFrom, priceDecimals, spotMarketsFrom } from "../marketCatalog";
import { mergeNewestFirst, reduceFeed } from "../feedReducers";
import { HyperCoreSocket, type TimerApi } from "../wsClient";
import { channelSubscriptionType, normalizeSubscription, subscriptionKey, subscriptionMatches, type Subscription } from "../wsRouting";

const USER = "0x4547B9E33F07965711F67D0BE2423939A4E33AF5";

describe("WebSocket message routing", () => {
  it("normalizes subscriptions and keys them canonically", () => {
    assert.deepEqual(normalizeSubscription({ type: "userFills", user: USER }), { type: "userFills", user: USER.toLowerCase().replace("0X", "0x") });
    assert.deepEqual(normalizeSubscription({ type: "l2Book", coin: "BTC", nSigFigs: null, mantissa: 5 }), { type: "l2Book", coin: "BTC" }, "mantissa only travels with nSigFigs 5");
    assert.deepEqual(normalizeSubscription({ type: "l2Book", coin: "BTC", nSigFigs: 5, mantissa: 2 }), { type: "l2Book", coin: "BTC", nSigFigs: 5, mantissa: 2 });
    assert.deepEqual(normalizeSubscription({ type: "openOrders", user: USER, dex: "" }), { type: "openOrders", user: USER.toLowerCase() });
    assert.equal(subscriptionKey({ type: "candle", interval: "1m", coin: "ETH" } as Subscription), subscriptionKey({ type: "candle", coin: "ETH", interval: "1m" }));
    assert.throws(() => normalizeSubscription({ type: "webData3", user: "0x123" }), /Not an address/u);
  });

  it("maps channels to subscription types (spot ctx and user events included)", () => {
    assert.equal(channelSubscriptionType("activeSpotAssetCtx"), "activeAssetCtx");
    assert.equal(channelSubscriptionType("user"), "userEvents");
    assert.equal(channelSubscriptionType("pong"), null);
    assert.equal(channelSubscriptionType("subscriptionResponse"), null);
    assert.equal(channelSubscriptionType("webData2"), null);
  });

  it("matches messages back to the right subscription", () => {
    const user = USER.toLowerCase();
    assert.ok(subscriptionMatches({ type: "l2Book", coin: "BTC" }, "l2Book", { coin: "BTC", levels: [[], []], time: 1 }));
    assert.ok(!subscriptionMatches({ type: "l2Book", coin: "ETH" }, "l2Book", { coin: "BTC", levels: [[], []], time: 1 }));
    assert.ok(subscriptionMatches({ type: "trades", coin: "BTC" }, "trades", [{ coin: "BTC", px: "1" }]));
    assert.ok(!subscriptionMatches({ type: "trades", coin: "ETH" }, "trades", [{ coin: "BTC", px: "1" }]));
    assert.ok(subscriptionMatches({ type: "candle", coin: "BTC", interval: "1m" }, "candle", { s: "BTC", i: "1m" }));
    assert.ok(!subscriptionMatches({ type: "candle", coin: "BTC", interval: "15m" }, "candle", { s: "BTC", i: "1m" }));
    assert.ok(subscriptionMatches({ type: "activeAssetCtx", coin: "@1035" }, "activeSpotAssetCtx", { coin: "@1035", ctx: {} }));
    assert.ok(subscriptionMatches({ type: "clearinghouseState", user }, "clearinghouseState", { dex: "", user, clearinghouseState: {} }));
    assert.ok(!subscriptionMatches({ type: "clearinghouseState", user, dex: "xyz" }, "clearinghouseState", { dex: "", user, clearinghouseState: {} }));
    assert.ok(subscriptionMatches({ type: "userFills", user }, "userFills", { isSnapshot: true, user: USER, fills: [] }));
    assert.ok(!subscriptionMatches({ type: "userFills", user: "0x1111111111111111111111111111111111111111" }, "userFills", { user, fills: [] }));
    assert.ok(subscriptionMatches({ type: "webData3", user }, "webData3", { userState: { user } }));
    assert.ok(subscriptionMatches({ type: "activeAssetData", user, coin: "BTC" }, "activeAssetData", { user, coin: "BTC" }));
    // Feeds without a user field go to every subscription of their type.
    assert.ok(subscriptionMatches({ type: "orderUpdates", user }, "orderUpdates", [{ order: {} }]));
    assert.ok(subscriptionMatches({ type: "userEvents", user }, "user", { fills: [] }));
    assert.ok(!subscriptionMatches({ type: "userEvents", user }, "userFills", { fills: [] }));
    // allMids of a builder dex carry their dex; the first dex's do not.
    assert.ok(subscriptionMatches({ type: "allMids" }, "allMids", { mids: { BTC: "1" } }));
    assert.ok(!subscriptionMatches({ type: "allMids" }, "allMids", { dex: "xyz", mids: { "xyz:TSLA": "1" } }));
    assert.ok(subscriptionMatches({ type: "allMids", dex: "xyz" }, "allMids", { dex: "xyz", mids: {} }));
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(channel: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ channel, data }) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function fakeTimers() {
  let now = 0;
  let id = 0;
  const tasks = new Map<number, { at: number; run: () => void; every?: number }>();
  const api: TimerApi = {
    setTimeout: (run, ms) => {
      id += 1;
      tasks.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle) => void tasks.delete(handle as number),
    setInterval: (run, ms) => {
      id += 1;
      tasks.set(id, { at: now + ms, run, every: ms });
      return id;
    },
    clearInterval: (handle) => void tasks.delete(handle as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, task] = next;
      now = task.at;
      if (task.every) task.at += task.every;
      else tasks.delete(key);
      task.run();
    }
    now = end;
  };
  return { api, advance, now: () => now };
}

describe("HyperCore socket", () => {
  const setup = () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const socket = new HyperCoreSocket({ url: "wss://test/ws", createSocket: (url) => new FakeSocket(url), timers: timers.api, now: timers.now, random: () => 0.5, unsubscribeGraceMs: 1_000, idleCloseMs: 5_000 });
    return { socket, timers };
  };

  it("reference-counts subscriptions and routes messages", () => {
    const { socket, timers } = setup();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = socket.subscribe({ type: "trades", coin: "BTC" }, (data) => a.push(data));
    const offB = socket.subscribe({ type: "trades", coin: "BTC" }, (data) => b.push(data));
    const eth: unknown[] = [];
    socket.subscribe({ type: "trades", coin: "ETH" }, (data) => eth.push(data));
    const ws = FakeSocket.instances[0]!;
    assert.equal(FakeSocket.instances.length, 1, "one connection for everything");
    assert.equal(socket.getStatus(), "connecting");
    ws.open();
    assert.equal(socket.getStatus(), "open");
    assert.deepEqual(ws.sent, [
      { method: "subscribe", subscription: { type: "trades", coin: "BTC" } },
      { method: "subscribe", subscription: { type: "trades", coin: "ETH" } },
    ], "two listeners of one feed share one subscription");
    ws.push("trades", [{ coin: "BTC", px: "1" }]);
    ws.push("subscriptionResponse", { method: "subscribe" });
    ws.push("pong", null);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(eth.length, 0);
    offA();
    timers.advance(2_000);
    assert.equal(ws.sent.length, 2, "still one listener left: no unsubscribe");
    offB();
    offB();
    timers.advance(999);
    assert.equal(ws.sent.length, 2, "unsubscribe waits for the grace period");
    timers.advance(2);
    assert.deepEqual(ws.sent.at(-1), { method: "unsubscribe", subscription: { type: "trades", coin: "BTC" } });
    assert.equal(socket.subscriptionCount, 1);
  });

  it("a quick re-subscribe within the grace period keeps the feed", () => {
    const { socket, timers } = setup();
    const off = socket.subscribe({ type: "allMids" }, () => undefined);
    FakeSocket.instances[0]!.open();
    off();
    timers.advance(500);
    socket.subscribe({ type: "allMids" }, () => undefined);
    timers.advance(5_000);
    assert.deepEqual(FakeSocket.instances[0]!.sent, [{ method: "subscribe", subscription: { type: "allMids" } }]);
  });

  it("books leave at once (their messages do not carry the grouping)", () => {
    const { socket } = setup();
    const off = socket.subscribe({ type: "l2Book", coin: "BTC", nSigFigs: 4 }, () => undefined);
    const ws = FakeSocket.instances[0]!;
    ws.open();
    off();
    assert.deepEqual(ws.sent.at(-1), { method: "unsubscribe", subscription: { type: "l2Book", coin: "BTC", nSigFigs: 4 } });
  });

  it("reconnects with backoff and re-subscribes; pings and drops a silent connection", () => {
    const { socket, timers } = setup();
    const got: unknown[] = [];
    socket.subscribe({ type: "userFills", user: USER }, (data) => got.push(data));
    socket.subscribe({ type: "l2Book", coin: "ETH" }, () => undefined);
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.drop();
    assert.equal(socket.getStatus(), "reconnecting");
    timers.advance(2_000);
    assert.equal(FakeSocket.instances.length, 2);
    const second = FakeSocket.instances[1]!;
    second.open();
    assert.deepEqual(second.sent.map((message) => (message as { subscription: { type: string } }).subscription.type).sort(), ["l2Book", "userFills"]);
    second.push("userFills", { isSnapshot: true, user: USER.toLowerCase(), fills: [] });
    assert.equal(got.length, 1);
    timers.advance(30_000);
    assert.deepEqual(second.sent.at(-1), { method: "ping" });
    second.push("pong", null);
    timers.advance(60_000);
    assert.ok(!second.closed, "pings keep a quiet connection");
    timers.advance(40_000);
    assert.ok(second.closed, "65 s without any message closes the socket");
    timers.advance(20_000);
    assert.equal(FakeSocket.instances.length, 3, "and a new one opens");
  });

  it("closes itself after the last subscription leaves", () => {
    const { socket, timers } = setup();
    const off = socket.subscribe({ type: "trades", coin: "BTC" }, () => undefined);
    FakeSocket.instances[0]!.open();
    off();
    timers.advance(1_100);
    timers.advance(5_100);
    assert.ok(FakeSocket.instances[0]!.closed);
    assert.equal(socket.getStatus(), "idle");
  });

  it("isolates a throwing listener", () => {
    const { socket } = setup();
    const seen: unknown[] = [];
    const original = console.error;
    console.error = () => undefined;
    try {
      socket.subscribe({ type: "allMids" }, () => {
        throw new Error("boom");
      });
      socket.subscribe({ type: "allMids" }, (data) => seen.push(data));
      FakeSocket.instances[0]!.open();
      FakeSocket.instances[0]!.push("allMids", { mids: { BTC: "1" } });
    } finally {
      console.error = original;
    }
    assert.equal(seen.length, 1);
  });
});

describe("feed reducers", () => {
  it("merge user feeds newest first, replacing on snapshots", () => {
    const first = reduceFeed("fills", null, { isSnapshot: true, fills: [{ time: 1, tid: 1 }, { time: 3, tid: 3 }] }) as { time: number }[];
    assert.deepEqual(first.map((fill) => fill.time), [3, 1]);
    const next = reduceFeed("fills", first, { fills: [{ time: 5, tid: 5 }, { time: 3, tid: 3 }] }) as { time: number }[];
    assert.deepEqual(next.map((fill) => fill.time), [5, 3, 1], "duplicates dropped");
    const snapshot = reduceFeed("fills", next, { isSnapshot: true, fills: [{ time: 9, tid: 9 }] }) as { time: number }[];
    assert.deepEqual(snapshot.map((fill) => fill.time), [9]);
    assert.equal(mergeNewestFirst([], Array.from({ length: 100 }, (_, index) => ({ time: index })), 10).length, 10);
    const trades = reduceFeed("trades", null, [{ time: 2, tid: 1, coin: "BTC" }]) as unknown[];
    assert.equal((reduceFeed("trades", trades, [{ time: 3, tid: 2, coin: "BTC" }]) as unknown[]).length, 2);
  });
});

describe("info client", () => {
  const makeFetch = (answer: (body: Record<string, unknown>) => unknown, calls: Record<string, unknown>[]) =>
    (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      calls.push(body);
      return new Response(JSON.stringify(answer(body)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

  it("weighs requests like HyperCore", () => {
    assert.equal(infoWeight({ type: "l2Book", coin: "BTC" }), 2);
    assert.equal(infoWeight({ type: "clearinghouseState", user: USER }), 2);
    assert.equal(infoWeight({ type: "userRole", user: USER }), 60);
    assert.equal(infoWeight({ type: "metaAndAssetCtxs" }), 20);
    assert.equal(cacheTtlMs({ type: "extraAgents", user: USER }), 0);
    assert.equal(infoKey({ b: 1, a: { d: 2, c: undefined }, type: "x" }), '{"a":{"d":2},"b":1,"type":"x"}');
  });

  it("caches fresh answers and shares in-flight requests", async () => {
    const calls: Record<string, unknown>[] = [];
    let now = 0;
    const client = new InfoClient({ url: "https://x/info", fetch: makeFetch((body) => ({ echo: body.type }), calls), now: () => now });
    const [a, b] = await Promise.all([client.post({ type: "meta" }), client.post({ type: "meta" })]);
    assert.deepEqual(a, { echo: "meta" });
    assert.equal(a, b);
    assert.equal(calls.length, 1, "identical requests in flight share one fetch");
    await client.post({ type: "meta" });
    assert.equal(calls.length, 1, "fresh cache hit");
    now += 11 * 60_000;
    await client.post({ type: "meta" });
    assert.equal(calls.length, 2, "expired");
    await client.post({ type: "meta" }, { force: true });
    assert.equal(calls.length, 3);
    assert.deepEqual(client.peek({ type: "meta" }), { echo: "meta" });
    client.invalidate((body) => body.type === "meta");
    assert.equal(client.peek({ type: "meta" }), undefined);
  });

  it("paces by weight and refuses to queue too long", async () => {
    const calls: Record<string, unknown>[] = [];
    let now = 0;
    const waits: number[] = [];
    const client = new InfoClient({
      url: "https://x/info",
      fetch: makeFetch(() => ({ ok: true }), calls),
      now: () => now,
      budgetPerMinute: 60,
      maxQueueMs: 30_000,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });
    // 60 weight per minute: three 20-weight requests use it all, the fourth waits ~20 s.
    for (let index = 0; index < 4; index += 1) await client.post({ type: "userFees", user: USER, n: index }, { ttlMs: 0 });
    assert.equal(calls.length, 4);
    assert.equal(waits.length, 1);
    assert.ok(Math.abs(waits[0]! - 20_000) < 1);
    // A burst that would wait beyond maxQueueMs fails in plain words instead of piling up.
    await assert.rejects(Promise.all(Array.from({ length: 6 }, (_, index) => client.post({ type: "userFees", user: USER, m: index }, { ttlMs: 0 }))), (error: unknown) => error instanceof InfoError && error.code === "LOCAL_BUDGET");
  });

  it("maps HTTP failures to plain-words errors after one backed-off retry", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let hits = 0;
    const client = new InfoClient({ url: "https://x/info", sleep, fetch: (async () => ((hits += 1), new Response("slow down", { status: 429 }))) as unknown as typeof fetch });
    await assert.rejects(client.post({ type: "allMids" }), (error: unknown) => error instanceof InfoError && error.code === "RATE_LIMITED" && error.retryable);
    assert.equal(hits, 2, "one retry");
    assert.ok(waits.includes(600), "after the base backoff");
    const broken = new InfoClient({ url: "https://x/info", sleep, fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch });
    await assert.rejects(broken.post({ type: "allMids" }), /Could not reach HyperCore/u);
    let calls = 0;
    const flaky = new InfoClient({
      url: "https://x/info",
      sleep,
      fetch: (async () => ((calls += 1), calls === 1 ? new Response("down", { status: 502 }) : new Response(JSON.stringify({ BTC: "1" }), { status: 200 }))) as unknown as typeof fetch,
    });
    assert.deepEqual(await flaky.post({ type: "allMids" }), { BTC: "1" });
    let bad = 0;
    const badRequest = new InfoClient({ url: "https://x/info", sleep, fetch: (async () => ((bad += 1), new Response("nope", { status: 422 }))) as unknown as typeof fetch });
    await assert.rejects(badRequest.post({ type: "allMids" }), (error: unknown) => error instanceof InfoError && error.code === "HTTP" && !error.retryable);
    assert.equal(bad, 1, "a 4xx is never retried");
  });
});

describe("exchange replies and errors", () => {
  it("explains HyperCore's common errors with the fix", () => {
    assert.equal(explainExchangeError("Must deposit before performing actions. User: 0x5c67").code, "NO_DEPOSIT");
    assert.equal(explainExchangeError("User or API Wallet 0x5c675217711f31e82ec5b974fb6b55a66032b400 does not exist.").code, "AGENT_UNKNOWN");
    assert.equal(explainExchangeError("Order must have minimum value of $10.").code, "MIN_NOTIONAL");
    assert.equal(explainExchangeError("Price must be divisible by tick size. asset=4").code, "TICK");
    assert.equal(explainExchangeError("Insufficient margin to place order. asset=4").code, "MARGIN");
    assert.equal(explainExchangeError("Reduce only order would increase position. asset=4").code, "REDUCE_ONLY");
    assert.equal(explainExchangeError("Post only order would have immediately matched, bbo was 2300@2301. asset=4").code, "ALO_CROSS");
    assert.equal(explainExchangeError("Order could not immediately match against any resting orders. asset=4").code, "IOC_NO_MATCH");
    assert.equal(explainExchangeError("Order was never placed, already canceled, or filled. asset=4").code, "MISSING_ORDER");
    assert.equal(explainExchangeError("Invalid nonce: duplicate nonce").code, "NONCE");
    const unknown = explainExchangeError("Something new");
    assert.equal(unknown.code, "UNKNOWN");
    assert.equal(unknown.message, "Something new");
  });

  it("reads per-order outcomes in batch order", () => {
    const outcomes = readOutcomes({
      status: "ok",
      response: { type: "order", data: { statuses: [{ resting: { oid: 7 } }, { filled: { totalSz: "0.1", avgPx: "2300.5", oid: 8 } }, { error: "Order must have minimum value of $10." }, "waitingForTrigger"] } },
    });
    assert.deepEqual(outcomes.map((outcome) => outcome.kind), ["resting", "filled", "error", "waiting"]);
    assert.equal(outcomes[2]?.kind === "error" ? outcomes[2].error.code : null, "MIN_NOTIONAL");
    assert.deepEqual(readOutcomes({ status: "err", response: "Must deposit before performing actions." }).map((outcome) => outcome.kind), ["error"]);
    assert.deepEqual(readOutcomes({ status: "ok", response: { type: "cancel", data: { statuses: ["success", { error: "Order was never placed, already canceled, or filled." }] } } }).map((outcome) => outcome.kind), ["success", "error"]);
    assert.deepEqual(readOutcomes({ status: "ok", response: { type: "twapOrder", data: { status: { running: { twapId: 42 } } } } }), [{ kind: "running", twapId: 42 }]);
    assert.deepEqual(readOutcomes({ status: "ok", response: { type: "default" } }), [{ kind: "success" }]);
  });

  it("posts the signed body and surfaces delivery failures", async () => {
    let sent = "";
    const reply = await postExchange("https://x/exchange", { action: { type: "noop" }, nonce: 1, signature: { r: "0x1", s: "0x2", v: 27 } } as never, (async (_url: string, init?: { body?: string }) => {
      sent = init?.body ?? "";
      return new Response(JSON.stringify({ status: "err", response: "Must deposit before performing actions." }), { status: 200 });
    }) as unknown as typeof fetch);
    assert.equal(JSON.parse(sent).nonce, 1);
    assert.equal(reply.status, "err");
    await assert.rejects(postExchange("https://x/exchange", {} as never, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch), /did not reach HyperCore/u);
    await assert.rejects(postExchange("https://x/exchange", {} as never, (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch), (error: unknown) => (error as { code?: string }).code === "HTTP");
  });
});

describe("market catalogue", () => {
  const meta = {
    universe: [
      { name: "SOL", szDecimals: 2, maxLeverage: 10 },
      { name: "MATIC", szDecimals: 1, maxLeverage: 50, isDelisted: true },
      { name: "BTC", szDecimals: 5, maxLeverage: 40 },
      { name: "HYPE", szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: "strictIsolated" },
    ],
  };
  const ctx = (mark: string, vlm: string, prev = mark) => ({ funding: "0.0000125", openInterest: "100", prevDayPx: prev, dayNtlVlm: vlm, premium: "0", oraclePx: mark, markPx: mark, midPx: mark, impactPxs: null, dayBaseVlm: "1" });
  const perps = perpMarketsFrom([meta, [ctx("110", "1000"), ctx("1", "0"), ctx("80000", "5000000", "78000"), ctx("40", "300000")]] as never);
  const spot = spotMarketsFrom([
    {
      tokens: [
        { name: "USDC", szDecimals: 8, weiDecimals: 8, index: 0, tokenId: "0x0", isCanonical: true, evmContract: null, fullName: null },
        { name: "PURR", szDecimals: 0, weiDecimals: 5, index: 1, tokenId: "0x1", isCanonical: true, evmContract: null, fullName: null },
        { name: "HYPE", szDecimals: 2, weiDecimals: 8, index: 1105, tokenId: "0x2", isCanonical: false, evmContract: null, fullName: null },
      ],
      universe: [
        { name: "PURR/USDC", tokens: [1, 0], index: 0, isCanonical: true },
        { name: "@1035", tokens: [1105, 0], index: 1035, isCanonical: false },
        { name: "@1200", tokens: [1105, 0], index: 1200, isCanonical: false },
      ],
    },
    [{ coin: "@1035", prevDayPx: "150", dayNtlVlm: "1132390", markPx: "160", midPx: "158.9", circulatingSupply: "1", totalSupply: "1", dayBaseVlm: "1" }],
  ] as never);

  it("builds perps with asset ids, isolated-only flags and contexts", () => {
    const btc = findMarket(perps, "btc")!;
    assert.equal(btc.asset, 2);
    assert.equal(btc.kind, "perp");
    assert.ok(Math.abs((change24h(btc.ctx) ?? 0) - (80000 / 78000 - 1)) < 1e-12);
    assert.equal(openInterestUsd(btc.ctx), 8_000_000);
    assert.equal(findMarket(perps, "HYPE")?.onlyIsolated, true);
    assert.ok(Math.abs((fundingApr(0.0000125) ?? 0) - 0.1095) < 1e-12);
  });

  it("builds spot pairs with readable slugs and unique fallbacks", () => {
    const hype = findMarket(spot, "HYPE-USDC")!;
    assert.equal(hype.coin, "@1035");
    assert.equal(hype.asset, 11035);
    assert.equal(hype.isSpot, true);
    assert.equal(findMarket(spot, "@1200")?.slug, "@1200", "a second HYPE/USDC pair keeps its book coin");
    assert.equal(findMarket(spot, "PURR/USDC")?.asset, 10000);
  });

  it("builds HIP-3 markets with builder asset ids and live contexts", () => {
    const metas = [null, { universe: [{ name: "xyz:TSLA", szDecimals: 2, maxLeverage: 5 }] }];
    const dexs = [null, { name: "xyz" }];
    const ctxs = ctxsByDexFrom({ ctxs: [["xyz", [ctx("250", "900000")]]] });
    const hip3 = hip3MarketsFrom(metas as never, dexs, ctxs);
    assert.equal(hip3[0]?.asset, 110000);
    assert.equal(hip3[0]?.base, "TSLA");
    assert.equal(hip3[0]?.dex, "xyz");
    assert.equal(hip3[0]?.ctx?.markPx, 250);
    assert.equal(findMarket(hip3, "xyz:tsla")?.coin, "xyz:TSLA");
  });

  it("filters, searches and sorts by volume with favorites", () => {
    assert.deepEqual(filterMarkets(perps, { tab: "perp" }).map((market) => market.coin), ["BTC", "HYPE", "SOL"], "delisted dropped, by volume");
    assert.deepEqual(filterMarkets(perps, { tab: "perp", query: "so" }).map((market) => market.coin), ["SOL"]);
    assert.deepEqual(filterMarkets(perps, { tab: "favorites", favorites: new Set(["SOL"]) }).map((market) => market.coin), ["SOL"]);
    assert.deepEqual(filterMarkets(perps, { tab: "perp", favorites: new Set(["SOL"]) }).map((market) => market.coin)[0], "SOL");
  });

  it("formats prices at the market's precision and offers book groupings", () => {
    assert.equal(priceDecimals(3342.7, 4, false), 1);
    assert.equal(priceDecimals(80432, 5, false), 0);
    assert.equal(priceDecimals(0.012345, 0, false), 6);
    assert.equal(formatPx(3342.7, { szDecimals: 4, isSpot: false }), "3,342.7");
    assert.deepEqual(bookGroupings(80432, 5, false).map((option) => option.step), [1, 2, 5, 10, 100, 1000]);
    assert.deepEqual(bookGroupings(2317.95, 4, false).map((option) => option.label), ["0.1", "0.2", "0.5", "1", "10", "100"]);
    assert.deepEqual(bookGroupings(80432, 5, false)[3], { step: 10, label: "10", nSigFigs: 4, mantissa: null });
  });

  it("counts down to the hourly funding", () => {
    assert.equal(msToNextFunding(Date.UTC(2026, 9, 29, 14, 18, 48)), (41 * 60 + 12) * 1000);
    assert.equal(formatCountdown((41 * 60 + 12) * 1000), "41:12");
    assert.equal(formatCountdown(3_725_000), "1:02:05");
  });
});
