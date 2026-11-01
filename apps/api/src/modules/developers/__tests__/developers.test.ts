import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { WEBHOOK_HEADERS, webhookSignedPayload } from "@elyia/core/api/developers";
import { createApp } from "../../../app.js";
import { createContext, type AppContext } from "../../../context.js";
import { serve, testConfig, waitFor, type Served } from "../../../__tests__/support.js";
import { MemoryStore } from "../../../store/memory.js";
import { issueToken } from "../../ops/auth/session.js";
import { sha256Hex } from "../../ops/auth/crypto.js";
import { routeScope } from "../gate.js";
import { setDeveloperServices, wireWebhookEvents } from "../index.js";
import { forgetKeyCache } from "../keys.js";

const DEV = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

let ctx: AppContext;
let server: Served;
let session: string;
const deliveries: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let receiverStatus = 200;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.url}${path}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  // MCP may answer as one SSE message: take its data line.
  const json = text.startsWith("event:") || text.startsWith("data:") ? (text.split("\n").find((line) => line.startsWith("data:")) ?? "data: null").slice(5) : text;
  return { status: response.status, headers: response.headers, body: (json ? JSON.parse(json) : null) as Record<string, unknown> };
}

before(async () => {
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore() });
  setDeveloperServices(ctx, {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (input) => {
      deliveries.push({ url: input.url, headers: { ...input.headers }, body: input.body });
      return { status: receiverStatus };
    },
    retryDelaysMs: [20, 40],
  });
  server = await serve(createApp(ctx));
  wireWebhookEvents(ctx);
  session = issueToken(ctx, { address: DEV }).token;
});

after(async () => {
  await server.close();
});

describe("developers: profile and API keys", () => {
  let plainKey = "";
  let keyId = "";

  it("needs a registered developer wallet", async () => {
    assert.equal((await call("GET", "/v1/developers/keys", undefined, { "Elyia-Session": session })).status, 403);
    const registered = await call("POST", "/v1/developers/register", { name: "Acme" }, { "Elyia-Session": session });
    assert.equal(registered.status, 201);
    assert.match(String(registered.body.id), /^dev_[0-9a-f]{20}$/u);
    const roles = await call("GET", "/v1/auth/session", undefined, { "Elyia-Session": session });
    assert.deepEqual(roles.body.roles, ["user", "developer"]);
  });

  it("shows the plain key once and stores only its hash", async () => {
    const created = await call("POST", "/v1/developers/keys", { name: "server", scopes: ["read", "plan"], quotas: { requestsPerMinute: 4, plansPerDay: 1 } }, { "Elyia-Session": session });
    assert.equal(created.status, 201);
    plainKey = String(created.body.plainKey);
    keyId = String((created.body.key as { id: string }).id);
    assert.match(plainKey, /^ely_[0-9A-Za-z]{40}$/u);
    const stored = JSON.stringify(await ctx.store.collection("api_keys").list({ limit: 100 }));
    assert.ok(!stored.includes(plainKey), "the plain key is never stored");
    assert.ok(stored.includes(sha256Hex(plainKey)));
    const list = await call("GET", "/v1/developers/keys", undefined, { "Elyia-Session": session });
    assert.ok(!JSON.stringify(list.body).includes(plainKey));
  });

  it("meters keyed requests, enforces scopes and quotas", async () => {
    const auth = { Authorization: `Bearer ${plainKey}` };
    assert.equal((await call("GET", "/v1/developers/usage", undefined, auth)).status, 200);
    const webhooks = await call("GET", "/v1/developers/webhooks", undefined, auth);
    assert.equal(webhooks.status, 403);
    assert.equal((webhooks.body.error as { code: string }).code, "KEY_SCOPE");
    // The 403 was refused before metering: this is the second metered request.
    const usage = await call("GET", "/v1/developers/usage?days=1", undefined, auth);
    assert.equal(((usage.body.totals as { requests: number }).requests), 2);
    let limited = await call("GET", "/v1/developers/usage", undefined, auth);
    for (let attempt = 0; attempt < 5 && limited.status !== 429; attempt += 1) limited = await call("GET", "/v1/developers/usage", undefined, auth);
    assert.equal(limited.status, 429);
    assert.equal((limited.body.error as { code: string }).code, "QUOTA_EXCEEDED");
    assert.ok(limited.headers.get("retry-after"));
    assert.equal((await call("GET", "/v1/developers/usage", undefined, { Authorization: "Bearer ely_" + "x".repeat(40) })).status, 401);
    assert.equal((await call("GET", "/v1/health", undefined, { Authorization: `Bearer ${plainKey}`, "Elyia-Key": "ely_" + "y".repeat(40) })).status, 401);
  });

  it("maps routes to scopes and metrics", () => {
    assert.deepEqual(routeScope("POST", "/intents"), { scope: "plan", metric: "plans" });
    assert.deepEqual(routeScope("POST", "/intents/int_1/steps/s1/prepare"), { scope: "execute-prepare", metric: "prepares" });
    assert.deepEqual(routeScope("GET", "/markets"), { scope: "read", metric: null });
  });

  it("rotates with a grace period and revokes at once", async () => {
    const rotated = await call("POST", `/v1/developers/keys/${keyId}/rotate`, {}, { "Elyia-Session": session });
    const fresh = String(rotated.body.plainKey);
    assert.notEqual(fresh, plainKey);
    forgetKeyCache();
    // A new minute window: both secrets work during the grace period.
    await ctx.store.counters("dev_rate").reset(`${keyId}:${Math.floor(Date.now() / 60_000)}`);
    assert.equal((await call("GET", "/v1/developers/fees", undefined, { Authorization: `Bearer ${fresh}` })).status, 200);
    assert.equal((await call("GET", "/v1/developers/fees", undefined, { Authorization: `Bearer ${plainKey}` })).status, 200);
    assert.equal((await call("DELETE", `/v1/developers/keys/${keyId}`, undefined, { "Elyia-Session": session })).status, 200);
    assert.equal((await call("GET", "/v1/developers/fees", undefined, { Authorization: `Bearer ${fresh}` })).status, 401);
    // A key cannot mint keys.
    const another = await call("POST", "/v1/developers/keys", { name: "k2" }, { "Elyia-Session": session });
    assert.equal((await call("POST", "/v1/developers/keys", { name: "k3" }, { Authorization: `Bearer ${String(another.body.plainKey)}` })).status, 403);
  });
});

describe("developers: webhooks", () => {
  let secret = "";
  let id = "";

  it("registers public HTTPS URLs only, shows the secret once", async () => {
    const refused = await call("POST", "/v1/developers/webhooks", { url: "http://hooks.example.com/x", events: ["alert.fired"] }, { "Elyia-Session": session });
    assert.equal(refused.status, 400);
    const created = await call("POST", "/v1/developers/webhooks", { url: "https://hooks.example.com/elyia", events: ["alert.fired", "intent.step.settled"] }, { "Elyia-Session": session });
    assert.equal(created.status, 201);
    secret = String(created.body.secret);
    id = String((created.body.webhook as { id: string }).id);
    assert.match(secret, /^whsec_/u);
    assert.ok(!JSON.stringify(await ctx.store.collection("webhooks").list({ limit: 10 })).includes(secret));
  });

  it("signs test deliveries with HMAC-SHA256 over t.body", async () => {
    const tested = await call("POST", `/v1/developers/webhooks/${id}/test`, {}, { "Elyia-Session": session });
    assert.equal((tested.body.delivery as { status: string }).status, "delivered");
    const sent = deliveries.at(-1);
    assert.ok(sent);
    const header = sent.headers[WEBHOOK_HEADERS.signature] as string;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/u.exec(header) ?? [];
    assert.equal(v1, createHmac("sha256", secret).update(webhookSignedPayload(Number(t), sent.body)).digest("hex"));
    assert.equal(sent.headers[WEBHOOK_HEADERS.webhookId], id);
  });

  it("delivers bus events with retries and logs every attempt", async () => {
    receiverStatus = 500;
    const before = deliveries.length;
    ctx.bus.emit("alert.fired", { owner: DEV, firing: { id: "fir_1" } });
    await waitFor(() => deliveries.length >= before + 3, 3_000);
    receiverStatus = 200;
    const log = await call("GET", `/v1/developers/webhooks/${id}/deliveries`, undefined, { "Elyia-Session": session });
    const statuses = (log.body.deliveries as Array<{ status: string; eventType: string }>).filter((entry) => entry.eventType === "alert.fired").map((entry) => entry.status);
    assert.ok(statuses.includes("retrying"));
    assert.ok(statuses.includes("failed"));
  });
});

describe("developers: integrator fee, widget, MCP", () => {
  it("caps the integrator fee and requires a recipient", async () => {
    assert.equal((await call("PUT", "/v1/developers/fees", { feeBps: 51, recipient: OTHER }, { "Elyia-Session": session })).status, 400);
    assert.equal((await call("PUT", "/v1/developers/fees", { feeBps: 20 }, { "Elyia-Session": session })).status, 400);
    const ok = await call("PUT", "/v1/developers/fees", { feeBps: 20, recipient: OTHER }, { "Elyia-Session": session });
    assert.equal(ok.body.feeBps, 20);
    assert.match(String((ok.body.disclosure as { en: string }).en), /0\.20%/u);
  });

  it("serves the public widget config", async () => {
    const me = await call("GET", "/v1/developers/me", undefined, { "Elyia-Session": session });
    const developerId = String((me.body.profile as { id: string }).id);
    await call("PUT", "/v1/developers/widget", { allowedOrigins: ["https://app.acme.xyz"], theme: { mode: "dark", accent: "#ff8800" } }, { "Elyia-Session": session });
    const widget = await call("GET", `/v1/widget/${developerId}`);
    assert.deepEqual(widget.body.allowedOrigins, ["https://app.acme.xyz"]);
    assert.equal((widget.body.fee as { feeBps: number }).feeBps, 20);
  });

  it("MCP: lists read-only tools and builds signing links", async () => {
    const headers = { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
    const init = await call("POST", "/v1/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, headers);
    assert.equal(init.status, 200);
    const list = await call("POST", "/v1/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, headers);
    const names = ((list.body.result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }).tools ?? []).map((tool) => tool.name);
    for (const name of ["get_networks", "get_markets", "get_portfolio", "plan_intent", "shield", "create_signing_link"]) assert.ok(names.includes(name), name);
    const link = await call("POST", "/v1/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_signing_link", arguments: { text: "swap 1 HYPE to USDC on Elysium" } } }, headers);
    const content = (link.body.result as { structuredContent: { url: string } }).structuredContent;
    assert.match(content.url, /\/app\?intent=swap%201%20HYPE/u);
    const networks = await call("POST", "/v1/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_networks", arguments: {} } }, headers);
    assert.ok(JSON.stringify(networks.body).includes("elysium-testnet"));
    assert.equal((await call("POST", "/v1/mcp", [{ jsonrpc: "2.0", id: 5, method: "tools/list" }], headers)).status, 400);
    assert.equal((await call("POST", "/v1/mcp", { jsonrpc: "2.0", id: 6, method: "tools/list" }, { ...headers, origin: "null" })).status, 403);
  });
});
