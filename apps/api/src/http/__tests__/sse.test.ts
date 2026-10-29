import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { parseSse, readSse, serve, waitFor, type Served } from "../../__tests__/support.js";
import { silentLogger } from "../../log.js";
import { StreamSlots } from "../limits.js";
import { errorHandler, requestContext } from "../request.js";
import { formatSseComment, formatSseEvent, openSse, type SseStream } from "../sse.js";
import { systemClock } from "../../clock.js";

describe("SSE framing", () => {
  it("writes id, event and JSON data, ending with a blank line", () => {
    assert.equal(formatSseEvent({ event: "block", id: 42, data: { n: 1 } }), 'id: 42\nevent: block\ndata: {"n":1}\n\n');
  });

  it("splits multi-line string data into several data lines", () => {
    assert.equal(formatSseEvent({ data: "a\nb\r\nc" }), "data: a\ndata: b\ndata: c\n\n");
  });

  it("keeps event names and ids on one line", () => {
    const frame = formatSseEvent({ event: "x\ninjected: y", id: "1\n2", data: null });
    assert.equal(frame, "id: 1 2\nevent: x injected: y\ndata: null\n\n");
    assert.equal(parseSse(frame).length, 1);
  });

  it("formats retry and comments", () => {
    assert.equal(formatSseEvent({ retry: 3000, data: "x" }), "retry: 3000\ndata: x\n\n");
    assert.equal(formatSseComment("hb\nnext"), ": hb next\n\n");
  });
});

describe("openSse", () => {
  let served: Served;
  const slots = new StreamSlots(2, 100);
  const streams: SseStream[] = [];
  let closes = 0;

  before(async () => {
    const app = express();
    app.use(requestContext(silentLogger, systemClock));
    app.get("/stream", (req, res) => {
      const stream = openSse(req, res, { slots, heartbeatMs: 20, maxDurationMs: Number(req.query.life ?? 60_000), retryMs: 1234 });
      streams.push(stream);
      stream.onClose(() => {
        closes += 1;
      });
      stream.send("hello", { at: 1 }, 7);
    });
    app.use(errorHandler(silentLogger));
    served = await serve(app);
  });

  after(async () => {
    await served.close();
  });

  it("sends headers, retry, events and heartbeats", async () => {
    const result = await readSse(`${served.url}/stream`, (messages) => messages.length >= 1, { timeoutMs: 2_000 });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type") ?? "", /^text\/event-stream/u);
    assert.equal(result.headers.get("cache-control"), "no-store, no-transform");
    assert.equal(result.headers.get("x-accel-buffering"), "no");
    assert.ok(result.raw.startsWith("retry: 1234\n\n"));
    assert.deepEqual(result.messages[0], { event: "hello", data: '{"at":1}', id: "7" });
    const later = await readSse(`${served.url}/stream`, () => false, { timeoutMs: 120 });
    assert.match(later.raw, /: hb /u, "heartbeat comments keep the connection alive");
  });

  it("cleans up once when the client disconnects and releases the slot", async () => {
    const before = closes;
    await readSse(`${served.url}/stream`, (messages) => messages.length >= 1);
    await waitFor(() => closes === before + 1);
    await waitFor(() => slots.count === 0);
    const last = streams[streams.length - 1];
    assert.ok(last?.closed);
    assert.equal(last?.send("late", {}), false, "writes after close are refused");
  });

  it("refuses with 429 TOO_MANY_STREAMS before writing SSE headers", async () => {
    const controllers = [new AbortController(), new AbortController()];
    const open = await Promise.all(controllers.map((controller) => fetch(`${served.url}/stream`, { signal: controller.signal })));
    await waitFor(() => slots.count === 2);
    const refused = await fetch(`${served.url}/stream`);
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get("retry-after"), "30");
    const body = (await refused.json()) as { error: { code: string } };
    assert.equal(body.error.code, "TOO_MANY_STREAMS");
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(open.map((response) => response.body?.cancel()));
    await waitFor(() => slots.count === 0);
  });

  it("ends the stream at its maximum lifetime", async () => {
    const result = await readSse(`${served.url}/stream?life=60`, () => false, { timeoutMs: 1_000 });
    assert.match(result.raw, /stream lifetime reached/u);
    await waitFor(() => slots.count === 0);
  });

  it("ends every open stream on closeAll (shutdown)", async () => {
    const reading = readSse(`${served.url}/stream`, () => false, { timeoutMs: 3_000 });
    await waitFor(() => slots.count === 1);
    assert.equal(slots.closeAll(), 1);
    const result = await reading;
    assert.equal(result.messages[0]?.event, "hello");
    await waitFor(() => slots.count === 0);
    assert.equal(slots.closeAll(), 0, "closed streams are no longer tracked");
  });

  it("exposes Last-Event-ID for resumption", async () => {
    await readSse(`${served.url}/stream`, (messages) => messages.length >= 1, { headers: { "last-event-id": "123" } });
    assert.equal(streams[streams.length - 1]?.lastEventId, "123");
  });
});

describe("StreamSlots", () => {
  it("caps per client and in total, releasing idempotently", () => {
    const slots = new StreamSlots(2, 3);
    const a1 = slots.tryAcquire("a");
    const a2 = slots.tryAcquire("a");
    assert.ok(a1 && a2);
    assert.equal(slots.tryAcquire("a"), null);
    const b1 = slots.tryAcquire("b");
    assert.ok(b1);
    assert.equal(slots.tryAcquire("c"), null, "total cap");
    a1();
    a1();
    assert.equal(slots.count, 2);
    assert.ok(slots.tryAcquire("c"));
  });
});
