import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Router } from "express";
import { BaseError } from "viem";
import { z } from "zod";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { memoryLogger } from "../../log.js";
import { serve, testConfig, type Served } from "../../__tests__/support.js";
import { ElyiaHttpError, mapError, safeDetails, sanitizeUpstreamMessage } from "../errors.js";
import type { ApiModule } from "../router.js";
import { parseBody, parseQuery, queryInteger } from "../validate.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Routes that exercise the error contract. */
const probeModule: ApiModule = {
  name: "probe",
  register(router: Router) {
    router.get("/probe/ok", (_req, res) => {
      res.json({ ok: true });
    });
    router.get("/probe/typed", () => {
      throw new ElyiaHttpError("THING_MISSING", 404, "No such thing.", { thing: "x" });
    });
    router.get("/probe/async", async () => {
      await Promise.resolve();
      throw new ElyiaHttpError("CONFLICT", 409, "Busy.", undefined, { headers: { "Retry-After": "3" } });
    });
    router.get("/probe/crash", () => {
      throw new Error("secret internals at https://rpc.example.com/KEY123");
    });
    router.get("/probe/viem", () => {
      throw new BaseError("HTTP request failed. URL: https://rpc.example.com/KEY123");
    });
    router.get("/probe/query", (req, res) => {
      const query = parseQuery(req, z.object({ n: queryInteger(1, 10) }));
      res.json(query);
    });
    router.post("/probe/body", (req, res) => {
      const body = parseBody(req, z.object({ amount: z.string().regex(/^\d+$/u) }));
      res.status(201).json(body);
    });
  },
};

describe("app error contract", () => {
  let ctx: AppContext;
  let served: Served;
  const log = memoryLogger("debug");

  before(async () => {
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "1000", ELYIA_RATE_LIMIT_HEAVY: "2" }), { log });
    const heavy: ApiModule = {
      name: "heavy",
      register(router) {
        router.get("/probe/heavy", ctx.limits.heavy, (_req, res) => {
          res.json({ ok: true });
        });
      },
    };
    served = await serve(createApp(ctx, { modules: [probeModule, heavy] }));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${served.url}${path}`, init);
    const text = await response.text();
    return { response, text, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  }

  function assertEnvelope(body: Record<string, unknown> | null, code: string, requestId?: string) {
    assert.ok(body, "expected a JSON body");
    const error = body.error as Record<string, unknown>;
    assert.equal(error.code, code);
    assert.equal(typeof error.message, "string");
    assert.equal(typeof error.requestId, "string");
    if (requestId) assert.equal(error.requestId, requestId);
    assert.deepEqual(Object.keys(body), ["error"]);
  }

  it("serves liveness outside /v1", async () => {
    const { response, body } = await call("/health");
    assert.equal(response.status, 200);
    assert.equal(body?.status, "ok");
  });

  it("assigns a request id, echoes a valid incoming one, and sets security headers", async () => {
    const fresh = await call("/v1/probe/ok");
    assert.match(fresh.response.headers.get("x-request-id") ?? "", UUID);
    assert.equal(fresh.response.headers.get("cache-control"), "no-store");
    assert.equal(fresh.response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fresh.response.headers.get("x-powered-by"), null);
    const echoed = await call("/v1/probe/ok", { headers: { "x-request-id": "client-req-12345" } });
    assert.equal(echoed.response.headers.get("x-request-id"), "client-req-12345");
    const refused = await call("/v1/probe/ok", { headers: { "x-request-id": "bad id with spaces" } });
    assert.match(refused.response.headers.get("x-request-id") ?? "", UUID);
  });

  it("answers unknown routes with a 404 envelope", async () => {
    const v1 = await call("/v1/nope");
    assert.equal(v1.response.status, 404);
    assertEnvelope(v1.body, "NOT_FOUND", v1.response.headers.get("x-request-id") ?? undefined);
    const root = await call("/nope");
    assert.equal(root.response.status, 404);
    assertEnvelope(root.body, "NOT_FOUND");
  });

  it("serializes ElyiaHttpError with details and headers", async () => {
    const typed = await call("/v1/probe/typed");
    assert.equal(typed.response.status, 404);
    assertEnvelope(typed.body, "THING_MISSING");
    assert.deepEqual((typed.body?.error as Record<string, unknown>).details, { thing: "x" });
    const rejected = await call("/v1/probe/async");
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.response.headers.get("retry-after"), "3");
    assertEnvelope(rejected.body, "CONFLICT");
  });

  it("never leaks internals on unexpected errors", async () => {
    const crash = await call("/v1/probe/crash");
    assert.equal(crash.response.status, 500);
    assertEnvelope(crash.body, "INTERNAL_ERROR");
    assert.ok(!crash.text.includes("KEY123") && !crash.text.includes("internals"));
    assert.ok(log.lines.some((line) => line.msg === "unhandled error"), "the cause is logged for operators");
    const viem = await call("/v1/probe/viem");
    assert.equal(viem.response.status, 502);
    assertEnvelope(viem.body, "RPC_UNAVAILABLE");
    assert.ok(!viem.text.includes("rpc.example.com"));
    const upstream = log.lines.find((line) => line.msg === "upstream error");
    assert.ok(upstream && !String(upstream.upstream).includes("KEY123"), "upstream log lines are sanitized");
  });

  it("validates query and body with zod issues", async () => {
    const good = await call("/v1/probe/query?n=5");
    assert.deepEqual(good.body, { n: 5 });
    const bad = await call("/v1/probe/query?n=50");
    assert.equal(bad.response.status, 400);
    assertEnvelope(bad.body, "INVALID_REQUEST");
    const issues = ((bad.body?.error as Record<string, unknown>).details as { issues: Array<{ path: string }> }).issues;
    assert.equal(issues[0]?.path, "query.n");
    const repeated = await call("/v1/probe/query?n=1&n=2");
    assert.equal(repeated.response.status, 400);
    const body = await call("/v1/probe/body", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "12" }) });
    assert.equal(body.response.status, 201);
    const badBody = await call("/v1/probe/body", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: 12 }) });
    assert.equal(badBody.response.status, 400);
    assert.equal(((badBody.body?.error as Record<string, unknown>).details as { issues: Array<{ path: string }> }).issues[0]?.path, "body.amount");
  });

  it("guards request bodies: 400 bad JSON, 415 wrong type, 413 too large", async () => {
    const invalid = await call("/v1/probe/body", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    assert.equal(invalid.response.status, 400);
    assertEnvelope(invalid.body, "INVALID_JSON");
    const media = await call("/v1/probe/body", { method: "POST", headers: { "content-type": "text/plain" }, body: "amount=1" });
    assert.equal(media.response.status, 415);
    assertEnvelope(media.body, "UNSUPPORTED_MEDIA_TYPE");
    const large = await call("/v1/probe/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: "1", pad: "x".repeat(300 * 1024) }),
    });
    assert.equal(large.response.status, 413);
    assertEnvelope(large.body, "PAYLOAD_TOO_LARGE");
  });

  it("answers malformed percent-encoding with 400", async () => {
    const response = await call("/v1/probe/%E0%A4%A");
    assert.ok(response.response.status === 400 || response.response.status === 404);
    assert.ok(response.body?.error);
  });

  it("allows only configured CORS origins", async () => {
    const allowed = await call("/v1/probe/ok", { headers: { origin: "http://localhost:5173" } });
    assert.equal(allowed.response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.match(allowed.response.headers.get("access-control-expose-headers") ?? "", /X-Request-Id/u);
    const foreign = await call("/v1/probe/ok", { headers: { origin: "https://evil.example.com" } });
    assert.equal(foreign.response.status, 200);
    assert.equal(foreign.response.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(`${served.url}/v1/probe/body`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5174", "access-control-request-method": "POST", "access-control-request-headers": "content-type,elyia-session" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Elyia-Session/u);
  });

  it("rate-limits per IP with a 429 envelope and Retry-After", async () => {
    assert.equal((await call("/v1/probe/heavy")).response.status, 200);
    assert.equal((await call("/v1/probe/heavy")).response.status, 200);
    const limited = await call("/v1/probe/heavy");
    assert.equal(limited.response.status, 429);
    assertEnvelope(limited.body, "RATE_LIMITED");
    assert.match(limited.response.headers.get("retry-after") ?? "", /^\d+$/u);
    assert.ok(limited.response.headers.get("ratelimit-policy"), "draft-8 RateLimit headers are sent");
  });
});

describe("error helpers", () => {
  it("drops details that are not small plain JSON", () => {
    assert.deepEqual(safeDetails({ a: 1, b: ["x"] }), { a: 1, b: ["x"] });
    assert.equal(safeDetails({ big: "x".repeat(5_000) }), null);
    assert.equal(safeDetails({ n: 1n } as unknown), null);
    assert.equal(safeDetails({ date: new Date() }), null);
    assert.equal(safeDetails([1, 2]), null);
    const error = new ElyiaHttpError("BAD_THING", 400, "Bad.", { when: new Date() } as unknown as Record<string, unknown>);
    assert.equal(error.details, undefined);
  });

  it("normalizes codes and statuses", () => {
    const error = new ElyiaHttpError("not-a-code", 99, "x");
    assert.equal(error.code, "INTERNAL_ERROR");
    assert.equal(error.status, 500);
  });

  it("maps body-parser, zod and timeout errors", () => {
    assert.equal(mapError(Object.assign(new Error("x"), { type: "entity.too.large", status: 413 })).error.code, "PAYLOAD_TOO_LARGE");
    assert.equal(mapError(z.object({ a: z.string() }).safeParse({}).error).error.code, "INVALID_REQUEST");
    assert.equal(mapError(Object.assign(new Error("t"), { name: "TimeoutError" })).error.status, 504);
  });

  it("sanitizes upstream messages", () => {
    const text = sanitizeUpstreamMessage(`failed https://rpc.example.com/abc?key=1 api_key=SECRET 0x${"ab".repeat(40)}\nnext`);
    assert.ok(!text.includes("rpc.example.com") && !text.includes("SECRET") && !text.includes("abab"));
    assert.ok(!text.includes("\n"));
  });
});
