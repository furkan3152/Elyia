import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { LanguageExamplesResponse, ParseIntentResponse } from "@elyia/core/api/language";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { routedFetch, serve, testConfig, type Served } from "../../__tests__/support.js";

describe("language routes", () => {
  let ctx: AppContext;
  let served: Served;

  before(async () => {
    // No upstream answers: facts fall back (static markets, no prices, names unresolved) and the reader still works.
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_SESSION_SECRET: "x".repeat(32) }), { fetch: routedFetch({}) });
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const parse = async (body: unknown) => {
    const response = await fetch(`${served.url}/v1/intents/parse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as ParseIntentResponse & { error?: { code: string } } };
  };

  it("reads a ready sentence with chips and a canonical sentence", async () => {
    const { status, body } = await parse({ text: "swap 10 HYPE to USDC on kalos" });
    assert.equal(status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.spec, "elyia.language/v1");
    assert.equal(body.canonical, "swap 10 HYPE to USDC on kalos on elysium");
    assert.ok(body.chips.length >= 4);
    assert.equal(body.thread, null);
    assert.equal((body as unknown as Record<string, unknown>).usedAnswers, undefined, "internal fields stay internal");
  });

  it("asks, then accepts the answer with the signed thread", async () => {
    const first = await parse({ text: "go long eth", answers: [{ question: "g0.leverage", option: "3" }] });
    assert.equal(first.body.status, "needs_input");
    assert.equal(first.body.questions[0]?.reason, "AMOUNT_MISSING");
    assert.ok(first.body.thread);
    const second = await parse({ text: "go long eth", thread: first.body.thread, answers: [{ question: "g0.size", text: "0.1" }] });
    assert.equal(second.body.status, "ready");
    assert.equal(second.body.canonical, "long 0.1 ETH 3x cross");
  });

  it("uses client context for balance-aware questions", async () => {
    const { body } = await parse({ text: "swap 100 HYPE to USDC on elysium", context: { balances: [{ network: "elysium-testnet", symbol: "HYPE", amount: "5" }] } });
    assert.equal(body.questions[0]?.reason, "AMOUNT_EXCEEDS_BALANCE");
  });

  it("reads Turkish", async () => {
    const { body } = await parse({ text: "tüm pozisyonları kapat" });
    assert.equal(body.locale, "tr");
    assert.equal(body.canonical, "close all positions");
  });

  it("validates the body", async () => {
    assert.equal((await parse({})).status, 400);
    assert.equal((await parse({ text: "x".repeat(501) })).status, 400);
    assert.equal((await parse({ text: "hi", answers: [{ question: "q", option: "a", text: "b" }] })).status, 400);
    assert.equal((await parse({ text: "hi", extra: true })).status, 400);
  });

  it("serves examples per locale", async () => {
    const response = await fetch(`${served.url}/v1/language/examples?locale=tr`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as LanguageExamplesResponse;
    assert.equal(body.locale, "tr");
    assert.equal(body.categories.length, 6);
    assert.match(response.headers.get("cache-control") ?? "", /public/u);
    assert.equal((await fetch(`${served.url}/v1/language/examples?locale=de`)).status, 400);
  });
});
