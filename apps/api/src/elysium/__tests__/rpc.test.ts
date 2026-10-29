import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ManualClock } from "../../clock.js";
import { FakeChain, json, routedFetch } from "../../__tests__/support.js";
import { endpointLabel, JsonRpcEndpoints, RpcError } from "../rpc.js";

describe("JsonRpcEndpoints", () => {
  it("prefers the first endpoint and fails over on errors", async () => {
    const clock = new ManualClock(0);
    const a = new FakeChain(10);
    const b = new FakeChain(10);
    const rpc = new JsonRpcEndpoints({ urls: ["https://a.test/key123", "https://b.test"], fetch: routedFetch({ "https://a.test": a.handler, "https://b.test": b.handler }), now: () => clock.now() });
    assert.equal(await rpc.call("eth_blockNumber"), "0xa");
    assert.equal(a.requests.length, 1);
    a.failure = 500;
    assert.equal(await rpc.call("eth_blockNumber"), "0xa");
    assert.equal(b.requests.length, 1, "b answered while a failed");
    assert.equal(rpc.active, "https://b.test", "a cools down");
    a.failure = null;
    await rpc.call("eth_blockNumber");
    assert.equal(b.requests.length, 2, "a is still cooling down");
    clock.advance(600);
    await rpc.call("eth_blockNumber");
    assert.equal(a.requests.length, 1 + 0 + 1, "a is preferred again after its cooldown");
    assert.equal(rpc.status()[0]?.endpoint, "https://a.test", "labels never include the path (it may hold a key)");
  });

  it("batches calls and returns results in call order, matched by id", async () => {
    const chain = new FakeChain(20);
    const reversed = routedFetch({
      "https://a.test": async (body, init, url) => {
        const response = (await chain.handler(body, init, url)) as Response;
        const items = (await response.json()) as unknown[];
        return json([...items].reverse());
      },
    });
    const rpc = new JsonRpcEndpoints({ urls: ["https://a.test"], fetch: reversed });
    const [head, chainId] = await rpc.batch<string>([
      { method: "eth_blockNumber", params: [] },
      { method: "eth_chainId", params: [] },
    ]);
    assert.equal(head, "0x14");
    assert.equal(chainId, "0x185d9");
    assert.deepEqual(await rpc.batch([]), []);
  });

  it("treats a JSON-RPC error as an endpoint failure", async () => {
    const rpc = new JsonRpcEndpoints({ urls: ["https://a.test"], fetch: routedFetch({ "https://a.test": () => json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "header not found" } }) }) });
    await assert.rejects(rpc.call("eth_getBlockByNumber", ["0x1", false]), (error: unknown) => error instanceof RpcError && error.kind === "rpc");
  });

  it("recognizes rate limiting (HTTP 429 and JSON-RPC -32005) and honors Retry-After", async () => {
    const clock = new ManualClock(0);
    const http = new JsonRpcEndpoints({ urls: ["https://a.test"], now: () => clock.now(), fetch: routedFetch({ "https://a.test": () => new Response("", { status: 429, headers: { "retry-after": "7" } }) }) });
    await assert.rejects(http.call("eth_blockNumber"), (error: unknown) => error instanceof RpcError && error.kind === "rate_limited" && error.retryAfterMs === 7_000);
    assert.equal(http.status()[0]?.available, false);
    clock.advance(7_000);
    assert.equal(http.status()[0]?.available, true);
    const rpcLimited = new JsonRpcEndpoints({ urls: ["https://a.test"], fetch: routedFetch({ "https://a.test": () => json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit exceeded" } }) }) });
    await assert.rejects(rpcLimited.call("eth_blockNumber"), (error: unknown) => error instanceof RpcError && error.kind === "rate_limited");
  });

  it("marks an endpoint stale when its answer is rejected and uses the next one", async () => {
    const lagging = new FakeChain(5);
    const current = new FakeChain(500);
    const rpc = new JsonRpcEndpoints({ urls: ["https://lag.test", "https://ok.test"], fetch: routedFetch({ "https://lag.test": lagging.handler, "https://ok.test": current.handler }) });
    const head = await rpc.call<string>("eth_blockNumber", [], (value) => Number.parseInt(value, 16) >= 400);
    assert.equal(head, "0x1f4");
    assert.equal(rpc.status()[0]?.stale, true);
    assert.equal(rpc.active, "https://ok.test");
    await assert.rejects(
      rpc.call<string>("eth_blockNumber", [], () => false),
      (error: unknown) => error instanceof RpcError && error.kind === "stale",
    );
  });

  it("reports each endpoint's head in a census", async () => {
    const rpc = new JsonRpcEndpoints({
      urls: ["https://a.test", "https://b.test", "https://down.test"],
      fetch: routedFetch({ "https://a.test": new FakeChain(10).handler, "https://b.test": new FakeChain(12).handler }),
    });
    assert.deepEqual(await rpc.headsByEndpoint(), [
      { endpoint: "https://a.test", head: 10 },
      { endpoint: "https://b.test", head: 12 },
      { endpoint: "https://down.test", head: null },
    ]);
  });

  it("maps timeouts and invalid JSON", async () => {
    // AbortSignal.timeout does not hold the event loop open; a server always has other handles.
    const keepAlive = setTimeout(() => undefined, 1_000);
    const slow = new JsonRpcEndpoints({
      urls: ["https://a.test"],
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(slow.call("eth_blockNumber"), (error: unknown) => error instanceof RpcError && error.kind === "timeout");
    const garbage = new JsonRpcEndpoints({ urls: ["https://a.test"], fetch: routedFetch({ "https://a.test": () => new Response("<html>", { status: 200 }) }) });
    await assert.rejects(garbage.call("eth_blockNumber"), (error: unknown) => error instanceof RpcError && error.kind === "invalid");
    assert.equal(endpointLabel("https://rpc.example.com/secret?key=1"), "https://rpc.example.com");
    assert.throws(() => new JsonRpcEndpoints({ urls: [] }));
    clearTimeout(keepAlive);
  });
});
