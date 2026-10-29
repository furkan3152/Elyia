import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { ElyiaHttpError } from "../../http/errors.js";
import { HyperliquidWs, routeOfMessage, routeOfSubscription, subscriptionKey, type SocketLike } from "../ws.js";

type Listener = (event: never) => void;

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  closed: { code?: number; reason?: string } | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: unknown) => void)(event);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    this.closed = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
    this.serverClose(code ?? 1000);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  serverClose(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code });
  }

  subscribes(): unknown[] {
    return this.sent.filter((frame) => frame.method === "subscribe").map((frame) => frame.subscription);
  }

  unsubscribes(): unknown[] {
    return this.sent.filter((frame) => frame.method === "unsubscribe").map((frame) => frame.subscription);
  }
}

function setup(options: { maxSubscriptions?: number; idleCloseMs?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const ws = new HyperliquidWs({
    url: "wss://api.hyperliquid-testnet.xyz/ws",
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    pingIntervalMs: 50_000,
    idleCloseMs: options.idleCloseMs ?? 30_000,
    backoffInitialMs: 500,
    backoffMaxMs: 30_000,
    random: () => 1,
    ...(options.maxSubscriptions !== undefined ? { maxSubscriptions: options.maxSubscriptions } : {}),
  });
  const current = () => sockets[sockets.length - 1] as FakeSocket;
  return { ws, sockets, current };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("Hyperliquid WS routing keys", () => {
  it("keys subscriptions canonically", () => {
    assert.equal(
      subscriptionKey({ type: "userFills", user: "0xABC" }),
      subscriptionKey({ user: "0xabc", type: "userFills" } as never),
    );
    assert.notEqual(subscriptionKey({ type: "l2Book", coin: "ETH" }), subscriptionKey({ type: "l2Book", coin: "ETH", nSigFigs: 3 }));
  });

  it("routes messages by channel and echoed fields", () => {
    assert.equal(routeOfSubscription({ type: "trades", coin: "ETH" }), routeOfMessage("trades", [{ coin: "ETH", px: "1" }]));
    assert.equal(routeOfSubscription({ type: "l2Book", coin: "@1", nSigFigs: 2 }), routeOfMessage("l2Book", { coin: "@1", levels: [[], []] }));
    assert.equal(routeOfSubscription({ type: "candle", coin: "BTC", interval: "1m" }), routeOfMessage("candle", { s: "BTC", i: "1m", o: "1" }));
    assert.equal(routeOfSubscription({ type: "activeAssetCtx", coin: "PURR/USDC" }), routeOfMessage("activeSpotAssetCtx", { coin: "PURR/USDC", ctx: {} }));
    assert.equal(routeOfSubscription({ type: "userFills", user: "0xAbC" }), routeOfMessage("userFills", { user: "0xabc", fills: [] }));
    assert.equal(routeOfSubscription({ type: "userEvents", user: "0x1" }), routeOfMessage("user", { fills: [] }));
    assert.equal(routeOfSubscription({ type: "allMids" }), routeOfMessage("allMids", { mids: {} }));
    assert.equal(routeOfMessage("pong", undefined), null);
    assert.equal(routeOfMessage("subscriptionResponse", {}), null);
    assert.equal(routeOfMessage("trades", []), null);
    assert.notEqual(routeOfMessage("trades", [{ coin: "BTC" }]), routeOfMessage("trades", [{ coin: "ETH" }]));
  });
});

describe("HyperliquidWs", () => {
  afterEach(() => {
    mock.timers.reset();
  });

  it("opens lazily and sends one upstream subscription per distinct subscription", () => {
    const { ws, sockets, current } = setup();
    assert.equal(sockets.length, 0);
    const offA = ws.subscribe({ type: "trades", coin: "ETH" }, () => undefined);
    const offB = ws.subscribe({ type: "trades", coin: "ETH" }, () => undefined);
    ws.subscribe({ type: "trades", coin: "BTC" }, () => undefined);
    assert.equal(sockets.length, 1);
    current().open();
    assert.deepEqual(current().subscribes(), [
      { type: "trades", coin: "ETH" },
      { type: "trades", coin: "BTC" },
    ]);
    offA();
    assert.deepEqual(current().unsubscribes(), [], "one listener remains on ETH");
    offB();
    offB();
    assert.deepEqual(current().unsubscribes(), [{ type: "trades", coin: "ETH" }]);
    assert.equal(ws.status().subscriptions, 1);
    ws.close();
  });

  it("delivers each message only to the listeners of its route", () => {
    const { ws, current } = setup();
    const eth: unknown[] = [];
    const btc: unknown[] = [];
    const books: unknown[] = [];
    ws.subscribe({ type: "trades", coin: "ETH" }, (data) => eth.push(data));
    ws.subscribe({ type: "trades", coin: "BTC" }, (data) => btc.push(data));
    ws.subscribe({ type: "l2Book", coin: "ETH" }, (data) => books.push(data));
    current().open();
    current().message({ channel: "trades", data: [{ coin: "ETH", px: "2300" }] });
    current().message({ channel: "trades", data: [{ coin: "SOL", px: "100" }] });
    current().message({ channel: "l2Book", data: { coin: "ETH", time: 1, levels: [[], []] } });
    current().message({ channel: "pong" });
    current().message({ channel: "error", data: "Already subscribed" });
    assert.equal(eth.length, 1);
    assert.equal(btc.length, 0);
    assert.equal(books.length, 1);
    ws.close();
  });

  it("isolates a throwing listener", () => {
    const { ws, current } = setup();
    const seen: unknown[] = [];
    ws.subscribe({ type: "allMids" }, () => {
      throw new Error("boom");
    });
    ws.subscribe({ type: "allMids" }, (data) => seen.push(data));
    current().open();
    current().message({ channel: "allMids", data: { mids: { BTC: "1" } } });
    assert.equal(seen.length, 1);
    ws.close();
  });

  it("replays the last state of stateful channels to late joiners", async () => {
    const { ws, current } = setup();
    ws.subscribe({ type: "l2Book", coin: "ETH" }, () => undefined);
    current().open();
    current().message({ channel: "l2Book", data: { coin: "ETH", time: 5, levels: [[], []] } });
    const late: unknown[] = [];
    ws.subscribe({ type: "l2Book", coin: "ETH" }, (data) => late.push(data));
    await flush();
    assert.deepEqual(late, [{ coin: "ETH", time: 5, levels: [[], []] }]);
    assert.deepEqual(ws.last({ type: "l2Book", coin: "ETH" }), { coin: "ETH", time: 5, levels: [[], []] });
    // Trades are events, not state: no replay.
    ws.subscribe({ type: "trades", coin: "ETH" }, () => undefined);
    current().message({ channel: "trades", data: [{ coin: "ETH" }] });
    const lateTrades: unknown[] = [];
    ws.subscribe({ type: "trades", coin: "ETH" }, (data) => lateTrades.push(data));
    await flush();
    assert.equal(lateTrades.length, 0);
    ws.close();
  });

  it("refuses indistinguishable variants of an active route", () => {
    const { ws } = setup();
    ws.subscribe({ type: "l2Book", coin: "ETH" }, () => undefined);
    assert.throws(
      () => ws.subscribe({ type: "l2Book", coin: "ETH", nSigFigs: 3 }, () => undefined),
      (error: unknown) => error instanceof ElyiaHttpError && error.code === "WS_SUBSCRIPTION_CONFLICT" && error.status === 409,
    );
    ws.subscribe({ type: "l2Book", coin: "BTC", nSigFigs: 3 }, () => undefined);
    ws.close();
  });

  it("enforces the subscription cap", () => {
    const { ws } = setup({ maxSubscriptions: 2 });
    ws.subscribe({ type: "bbo", coin: "A" }, () => undefined);
    ws.subscribe({ type: "bbo", coin: "B" }, () => undefined);
    ws.subscribe({ type: "bbo", coin: "A" }, () => undefined);
    assert.throws(() => ws.subscribe({ type: "bbo", coin: "C" }, () => undefined), { code: "WS_SUBSCRIPTION_LIMIT" });
    ws.close();
  });

  it("reconnects with backoff and resubscribes the current set", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { ws, sockets, current } = setup();
    const offBtc = ws.subscribe({ type: "trades", coin: "BTC" }, () => undefined);
    ws.subscribe({ type: "trades", coin: "ETH" }, () => undefined);
    current().open();
    offBtc();
    current().serverClose(1006);
    assert.equal(ws.status().state, "reconnecting");
    assert.equal(sockets.length, 1);
    mock.timers.tick(499);
    assert.equal(sockets.length, 1);
    mock.timers.tick(1);
    assert.equal(sockets.length, 2, "first retry after 500 ms");
    current().open();
    assert.deepEqual(current().subscribes(), [{ type: "trades", coin: "ETH" }], "only live subscriptions are restored");
    // Repeated failures back off exponentially.
    current().serverClose();
    mock.timers.tick(999);
    assert.equal(sockets.length, 2);
    mock.timers.tick(1);
    assert.equal(sockets.length, 3, "second retry after 1 s");
    assert.equal(ws.status().reconnects, 2);
    ws.close();
  });

  it("pings every interval and reconnects when the socket goes silent", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let now = 0;
    const sockets: FakeSocket[] = [];
    const ws = new HyperliquidWs({
      url: "wss://example",
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      now: () => now,
      random: () => 1,
    });
    ws.subscribe({ type: "allMids" }, () => undefined);
    sockets[0]?.open();
    now = 50_000;
    mock.timers.tick(50_000);
    assert.deepEqual(sockets[0]?.sent.at(-1), { method: "ping" });
    sockets[0]?.message({ channel: "pong" });
    now = 200_000;
    mock.timers.tick(50_000);
    assert.equal(sockets[0]?.closed?.reason, "watchdog");
    mock.timers.tick(500);
    assert.equal(sockets.length, 2, "a silent socket is replaced");
    ws.close();
  });

  it("closes the idle socket after the grace period and reopens on demand", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { ws, sockets, current } = setup({ idleCloseMs: 1_000 });
    const off = ws.subscribe({ type: "allMids" }, () => undefined);
    current().open();
    off();
    mock.timers.tick(999);
    assert.equal(current().closed, null);
    mock.timers.tick(1);
    assert.equal(current().closed?.reason, "idle");
    assert.equal(ws.status().state, "idle");
    ws.subscribe({ type: "allMids" }, () => undefined);
    assert.equal(sockets.length, 2);
    ws.close();
    assert.equal(ws.status().state, "closed");
    assert.throws(() => ws.subscribe({ type: "allMids" }, () => undefined));
  });
});
