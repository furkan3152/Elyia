import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHyperCoreNetwork } from "@elyia/core";
import { json } from "../../__tests__/support.js";
import { ManualClock } from "../../clock.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { canonicalJson, HyperliquidInfoClient, type FetchLike } from "../info.js";
import { WeightBudget } from "../weights.js";

const network = getHyperCoreNetwork("hypercore-testnet");

interface Harness {
  readonly client: HyperliquidInfoClient;
  readonly clock: ManualClock;
  readonly budget: WeightBudget;
  readonly bodies: unknown[];
  readonly waits: number[];
}

function harness(respond: (body: Record<string, unknown>, call: number) => Response | Promise<Response>, limit = 1_000): Harness {
  const clock = new ManualClock();
  const budget = new WeightBudget(limit, clock);
  const bodies: unknown[] = [];
  const waits: number[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    assert.equal(url, network.infoUrl);
    assert.equal(init.method, "POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    return respond(body, bodies.length);
  };
  const client = new HyperliquidInfoClient({
    network,
    budget,
    clock,
    fetch: fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { client, clock, budget, bodies, waits };
}

describe("HyperliquidInfoClient", () => {
  it("posts typed requests and caches per type", async () => {
    const h = harness((body) => json(body.type === "allMids" ? { BTC: "100000.0" } : { universe: [], marginTables: [] }));
    assert.deepEqual(await h.client.allMids(), { BTC: "100000.0" });
    assert.deepEqual(await h.client.allMids(), { BTC: "100000.0" });
    assert.equal(h.client.calls, 1, "second read is served from the 1 s cache");
    h.clock.advance(1_000);
    await h.client.allMids();
    assert.equal(h.client.calls, 2, "allMids expires after 1 s");
    await h.client.meta();
    h.clock.advance(59_000);
    await h.client.meta();
    assert.equal(h.client.calls, 3, "meta is cached for 60 s");
    h.clock.advance(1_000);
    await h.client.meta();
    assert.equal(h.client.calls, 4);
    assert.deepEqual(h.bodies[0], { type: "allMids" });
  });

  it("keys the cache by the whole request, not just the type", async () => {
    const h = harness((body) => json({ coin: body.coin, time: 1, levels: [[], []] }));
    const eth = await h.client.l2Book("ETH");
    const btc = await h.client.l2Book("BTC");
    assert.equal(eth?.coin, "ETH");
    assert.equal(btc?.coin, "BTC");
    assert.equal(h.client.calls, 2);
    await h.client.l2Book("ETH");
    assert.equal(h.client.calls, 2);
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: undefined } }), '{"a":{"d":2},"b":1}');
  });

  it("deduplicates concurrent identical requests into one upstream call", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness(async () => {
      await gate;
      return json({ marginSummary: {}, assetPositions: [] });
    });
    const user = "0x0000000000000000000000000000000000000001";
    const reads = Promise.all([h.client.clearinghouseState(user), h.client.clearinghouseState(user), h.client.clearinghouseState(user)]);
    release();
    const [a, b, c] = await reads;
    assert.equal(h.client.calls, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("does not cache when asked not to, but still dedupes", async () => {
    const h = harness(() => json({ time: 1, specialStatuses: null }));
    await h.client.exchangeStatus({ cacheMs: 0 });
    await h.client.exchangeStatus({ cacheMs: 0 });
    assert.equal(h.client.calls, 2);
  });

  it("retries 5xx with backoff, then succeeds", async () => {
    const h = harness((_body, call) => (call < 3 ? new Response("oops", { status: 502 }) : json({ ok: 1 })));
    assert.deepEqual(await h.client.request({ type: "predictedFundings" }), { ok: 1 });
    assert.equal(h.client.calls, 3);
    assert.deepEqual(h.waits, [250, 750]);
  });

  it("retries transport errors", async () => {
    const h = harness((_body, call) => {
      if (call === 1) throw new TypeError("fetch failed");
      return json([]);
    });
    assert.deepEqual(await h.client.userFills("0x0000000000000000000000000000000000000001"), []);
    assert.equal(h.client.calls, 2);
  });

  it("maps persistent 429 to PROVIDER_RATE_LIMITED with Retry-After", async () => {
    const h = harness(() => new Response("slow down", { status: 429, headers: { "retry-after": "1" } }));
    await assert.rejects(h.client.allMids(), (error: unknown) => {
      assert.ok(error instanceof ElyiaHttpError);
      assert.equal(error.code, "PROVIDER_RATE_LIMITED");
      assert.equal(error.status, 503);
      assert.equal(error.headers?.["Retry-After"], "1");
      return true;
    });
    assert.equal(h.client.calls, 3, "two retries");
    assert.deepEqual(h.waits, [1_000, 1_000], "Retry-After is honored when short");
  });

  it("stops retrying when Retry-After is too long", async () => {
    const h = harness(() => new Response("", { status: 429, headers: { "retry-after": "30" } }));
    await assert.rejects(h.client.allMids(), { code: "PROVIDER_RATE_LIMITED" });
    assert.equal(h.client.calls, 1);
  });

  it("maps persistent 5xx to HYPERLIQUID_UNAVAILABLE without upstream text", async () => {
    const h = harness(() => new Response("internal details", { status: 500 }));
    await assert.rejects(h.client.allMids(), (error: unknown) => {
      assert.ok(error instanceof ElyiaHttpError);
      assert.equal(error.code, "HYPERLIQUID_UNAVAILABLE");
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes("internal details"));
      return true;
    });
  });

  it("maps a refused request (4xx) to HYPERLIQUID_REJECTED without retrying", async () => {
    const h = harness(() => new Response("Failed to deserialize the JSON body into the target type", { status: 422 }));
    await assert.rejects(h.client.clearinghouseState("nope"), (error: unknown) => {
      assert.ok(error instanceof ElyiaHttpError);
      assert.equal(error.code, "HYPERLIQUID_REJECTED");
      assert.equal(error.status, 422);
      assert.match(error.message, /Failed to deserialize/u);
      return true;
    });
    assert.equal(h.client.calls, 1);
  });

  it("maps a timeout to UPSTREAM_TIMEOUT without retrying", async () => {
    const h = harness(() => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await assert.rejects(h.client.allMids(), { code: "UPSTREAM_TIMEOUT" });
    assert.equal(h.client.calls, 1);
  });

  it("refuses before the upstream call when the weight budget is spent", async () => {
    // 40 weight per minute: two 20-weight requests fit, the third does not.
    const h = harness(() => json({ universe: [] }), 40);
    await h.client.request({ type: "spotMeta" }, { cacheMs: 0 });
    await h.client.request({ type: "spotMeta" }, { cacheMs: 0 });
    await assert.rejects(h.client.request({ type: "spotMeta" }, { cacheMs: 0 }), (error: unknown) => {
      assert.ok(error instanceof ElyiaHttpError);
      assert.equal(error.code, "PROVIDER_RATE_LIMITED");
      assert.ok(Number(error.headers?.["Retry-After"]) >= 1);
      return true;
    });
    assert.equal(h.client.calls, 2, "the refused request never reached Hyperliquid");
    h.clock.advance(61_000);
    await h.client.request({ type: "spotMeta" }, { cacheMs: 0 });
    assert.equal(h.client.calls, 3, "the budget refills after a minute");
  });

  it("charges per-item weight after the response", async () => {
    const fills = Array.from({ length: 2_000 }, (_, index) => ({ tid: index }));
    const h = harness(() => json(fills));
    await h.client.userFills("0x0000000000000000000000000000000000000001");
    // 20 base + 2000 / 20 per-item.
    assert.equal(h.budget.used(), 120);
  });
});
