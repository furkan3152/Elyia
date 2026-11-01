import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ElyiaApiError, ElyiaClient, signWebhookPayload, verifyWebhook, WebhookSignatureError } from "../src/index.js";
import { parseBlock } from "../src/sse.js";

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return Object.assign(fn, { calls });
}

describe("@elyia/sdk client", () => {
  it("sends the key, builds URLs and maps the error envelope", async () => {
    const fetch = fakeFetch((url) =>
      url.includes("/venues")
        ? new Response(JSON.stringify({ venues: [], priceSource: "reference:hypercore-mainnet-mids", executableProtocols: [] }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: "INTENT_CLARIFY", message: "Which venue?", requestId: "req_1" } }), { status: 422 }),
    );
    const client = new ElyiaClient({ baseUrl: "http://api.test/", apiKey: "ely_test", fetch, retries: 0 });
    const venues = await client.venues({ network: "elysium-testnet" });
    assert.deepEqual(venues.venues, []);
    assert.equal(fetch.calls[0]?.url, "http://api.test/v1/venues?network=elysium-testnet");
    assert.equal((fetch.calls[0]?.init.headers as Record<string, string>).authorization, "Bearer ely_test");
    await assert.rejects(client.plan({ accounts: [], actions: [], dryRun: true }), (error: unknown) => error instanceof ElyiaApiError && error.code === "INTENT_CLARIFY" && error.status === 422 && error.requestId === "req_1");
    assert.match(fetch.calls[1]?.url ?? "", /\/v1\/intents\?dryRun=true$/u);
  });

  it("retries 429 with Retry-After", async () => {
    let count = 0;
    const fetch = fakeFetch(() => (count++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const client = new ElyiaClient({ baseUrl: "http://api.test", fetch });
    assert.deepEqual(await client.request("GET", "/health"), { ok: true });
    assert.equal(count, 2);
  });

  it("streams chat events over POST SSE", async () => {
    const body = "event: thread\ndata: {\"threadId\":\"thr_1\"}\n\n: ping\n\nevent: token\ndata: {\"text\":\"Hi\"}\n\nevent: done\ndata: {\"text\":\"Hi\"}\n\n";
    const fetch = fakeFetch(() => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const client = new ElyiaClient({ baseUrl: "http://api.test", fetch });
    const events: string[] = [];
    for await (const event of client.chat({ message: "hi", address: "0x0000000000000000000000000000000000000001" })) events.push(event.event);
    assert.deepEqual(events, ["thread", "token", "done"]);
    assert.deepEqual(parseBlock("data: plain"), { event: "message", data: "plain", id: null });
    assert.equal(parseBlock(": comment"), null);
  });
});

describe("@elyia/sdk webhooks", () => {
  it("verifies fresh signatures and refuses tampering and replays", async () => {
    const secret = "whsec_test";
    const rawBody = JSON.stringify({ id: "evt_1", type: "alert.fired", createdAt: "2026-11-01T00:00:00Z", data: {} });
    const now = 1_800_000_000_000;
    const t = Math.floor(now / 1000);
    const header = `t=${t},v1=${await signWebhookPayload(secret, t, rawBody)}`;
    const event = await verifyWebhook({ secret, rawBody, signatureHeader: header, now });
    assert.equal(event.type, "alert.fired");
    await assert.rejects(verifyWebhook({ secret, rawBody: rawBody.replace("evt_1", "evt_2"), signatureHeader: header, now }), WebhookSignatureError);
    await assert.rejects(verifyWebhook({ secret, rawBody, signatureHeader: header, now: now + 600_000 }), WebhookSignatureError);
    await assert.rejects(verifyWebhook({ secret, rawBody, signatureHeader: null, now }), WebhookSignatureError);
  });
});
