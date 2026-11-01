import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hex } from "viem";
import { createApp } from "../../../app.js";
import { createContext, type AppContext } from "../../../context.js";
import { serve, testConfig, type Served } from "../../../__tests__/support.js";
import type { EvmPort, TxObservation } from "../../../engine/ports/evm.js";
import { MemoryStore } from "../../../store/memory.js";
import { cooledDown, createAlert, crossing, fire, feed, type AlertRecord } from "../alerts.js";
import { createLinkCode, linkOfChat } from "../auth/telegram.js";
import { issueToken } from "../auth/session.js";
import { createBot, escapeHtml } from "../telegram.js";
import { checkTrack, setTrackPort, trackerPass } from "../track.js";

const ADDRESS = "0x5e9ee1089755c3435139848e47e6635505d5a13a";
const HASH = `0x${"ab".repeat(32)}` as Hex;

let ctx: AppContext;
let server: Served;

before(async () => {
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), TELEGRAM_BOT_TOKEN: "123:test-token" }), { store: new MemoryStore() });
  server = await serve(createApp(ctx));
});

after(async () => {
  await server.close();
});

function alert(partial: Partial<AlertRecord>): AlertRecord {
  return { id: "alr_x", owner: ADDRESS, kind: "price-above", coin: "BTC", threshold: "100000", intentId: null, account: null, channels: ["feed"], cooldownSeconds: 900, note: null, enabled: true, createdAt: 0, lastFiredAt: null, fireCount: 0, ...partial };
}

describe("ops: alert evaluation", () => {
  const facts = { mids: new Map([["BTC", 101_000]]), fundingPctHourly: new Map([["HYPE", 0.02]]), liquidation: new Map([[ADDRESS, new Map([["HYPE", 4.2]])]]) };

  it("crosses price, funding and liquidation thresholds", () => {
    assert.deepEqual(crossing(alert({}), facts), { observed: 101_000, coin: "BTC" });
    assert.equal(crossing(alert({ kind: "price-below" }), facts), null);
    assert.ok(crossing(alert({ kind: "funding-above", coin: "HYPE", threshold: "0.01" }), facts));
    assert.equal(crossing(alert({ kind: "funding-below", coin: "HYPE", threshold: "0.01" }), facts), null);
    assert.deepEqual(crossing(alert({ kind: "liquidation-distance-below", coin: null, threshold: "5", account: ADDRESS }), facts), { observed: 4.2, coin: "HYPE" });
    assert.equal(crossing(alert({ coin: "ETH" }), facts), null, "unknown coin never fires");
  });

  it("respects the cooldown", () => {
    assert.equal(cooledDown(alert({ lastFiredAt: 1_000_000, cooldownSeconds: 900 }), 1_000_000 + 899_000), false);
    assert.equal(cooledDown(alert({ lastFiredAt: 1_000_000, cooldownSeconds: 900 }), 1_000_000 + 900_000), true);
  });

  it("fires into the feed, Telegram outbox and the alert.fired bus event", async () => {
    const created = await createAlert(ctx, ADDRESS, { kind: "price-above", coin: "BTC", threshold: "100000", channels: ["feed", "telegram"] });
    const outbox: unknown[] = [];
    const bus: unknown[] = [];
    const off1 = ctx.bus.on("ops.alert.delivery", (event) => outbox.push(event));
    const off2 = ctx.bus.on("alert.fired", (event) => bus.push(event));
    const firing = await fire(ctx, created, "101000", "BTC");
    off1();
    off2();
    assert.match(firing.message.en, /BTC is above 100000/u);
    assert.match(firing.message.tr, /üzerinde/u);
    assert.equal(outbox.length, 1);
    assert.equal(bus.length, 1);
    assert.equal((await feed(ctx, ADDRESS))[0]?.id, firing.id);
  });

  it("CRUD over HTTP needs a session and validates inputs", async () => {
    assert.equal((await fetch(`${server.url}/v1/alerts`)).status, 401);
    const token = issueToken(ctx, { address: ADDRESS }).token;
    const headers = { "content-type": "application/json", "Elyia-Session": token };
    const bad = await fetch(`${server.url}/v1/alerts`, { method: "POST", headers, body: JSON.stringify({ kind: "price-above" }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${server.url}/v1/alerts`, { method: "POST", headers, body: JSON.stringify({ kind: "liquidation-distance-below", threshold: "5" }) });
    assert.equal(ok.status, 201);
    const body = (await ok.json()) as { id: string; account: string };
    assert.equal(body.account, ADDRESS);
    const patched = await fetch(`${server.url}/v1/alerts/${body.id}`, { method: "PATCH", headers, body: JSON.stringify({ enabled: false }) });
    assert.equal(((await patched.json()) as { enabled: boolean }).enabled, false);
    assert.equal((await fetch(`${server.url}/v1/alerts/${body.id}`, { method: "DELETE", headers })).status, 200);
  });
});

describe("ops: transaction tracker", () => {
  let observation: TxObservation = { state: "pending" };
  before(() => {
    setTrackPort(ctx, { observeTransaction: async () => observation } as unknown as EvmPort);
  });

  it("tracks a pending tx, then confirms it with labelled logs", async () => {
    const created = await fetch(`${server.url}/v1/track`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "elysium-testnet", reference: HASH, label: "test" }) });
    assert.equal(created.status, 201);
    const view = (await created.json()) as { id: string; status: string; nextCheckAt: string | null };
    assert.equal(view.status, "pending");
    assert.ok(view.nextCheckAt);
    observation = {
      state: "landed",
      hash: HASH,
      status: "success",
      from: ADDRESS,
      to: "0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f",
      input: "0x",
      value: 0n,
      chainId: 99801,
      nonce: 1,
      type: "0x2",
      blockNumber: 123n,
      blockTimestamp: 1,
      logs: [{ address: "0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x", blockNumber: 123n, transactionHash: HASH, logIndex: 0 }],
    };
    const events: unknown[] = [];
    const off = ctx.bus.on("track.updated", (event) => events.push(event));
    // Make it due now.
    const record = (await ctx.store.collection("tracks").get(view.id))?.value as Record<string, unknown>;
    await ctx.store.collection("tracks").put(view.id, { ...record, nextCheckAt: 0 } as never);
    await trackerPass(ctx, { pending: 0 });
    off();
    const final = (await (await fetch(`${server.url}/v1/track/${view.id}`)).json()) as { status: string; detail: { blockNumber: string; toContract: string | null; logs: Array<{ event: string | null }> } };
    assert.equal(final.status, "confirmed");
    assert.equal(final.detail.blockNumber, "123");
    assert.match(final.detail.toContract ?? "", /Kalos/u);
    assert.equal(final.detail.logs[0]?.event, "Transfer");
    assert.equal(events.length, 1);
  });

  it("refuses references that do not fit the network", async () => {
    const response = await fetch(`${server.url}/v1/track`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "hypercore-testnet", reference: HASH }) });
    assert.equal(response.status, 400);
  });

  it("backs off between checks", async () => {
    const record = { id: "trk_x", kind: "evm-tx" as const, network: "elysium-testnet" as const, reference: HASH, label: null, status: "pending" as const, createdAt: ctx.clock.now(), updatedAt: 0, checks: 3, nextCheckAt: 0, detail: { blockNumber: null, from: null, to: null, toContract: null, logs: [], explorerUrl: null, note: null } };
    observation = { state: "pending" };
    const next = await checkTrack(ctx, record);
    assert.equal(next.checks, 4);
    assert.ok((next.nextCheckAt ?? 0) - ctx.clock.now() >= 5_000 * 16);
  });
});

describe("ops: Telegram bot", () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const botInfo = { id: 1, is_bot: true as const, first_name: "Elyia", username: "ElyiaBot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false };
  function update(text: string, chatId: number, languageCode = "en") {
    const command = text.split(" ")[0] as string;
    return { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" as const, first_name: "Ada" }, from: { id: chatId + 1, is_bot: false, first_name: "Ada", language_code: languageCode }, text, entities: [{ type: "bot_command" as const, offset: 0, length: command.length }] } };
  }
  const bot = () =>
    createBot(ctx, {
      botInfo: botInfo as never,
      transformers: [
        (async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
          calls.push({ method, payload });
          return { ok: true, result: { message_id: 2, date: 0, chat: { id: payload.chat_id, type: "private" }, text: "" } };
        }) as never,
      ],
    });

  it("links a chat with /start <code> and answers in Turkish", async () => {
    const instance = bot();
    const { code } = await createLinkCode(ctx, ADDRESS);
    await instance.handleUpdate(update(`/start ${code}`, 500, "tr") as never);
    const sent = calls.at(-1);
    assert.equal(sent?.method, "sendMessage");
    assert.match(String(sent?.payload.text), /bağlandı/u);
    assert.equal((await linkOfChat(ctx, 500))?.address, ADDRESS);
    // The code is single use.
    await instance.handleUpdate(update(`/start ${code}`, 501) as never);
    assert.match(String(calls.at(-1)?.payload.text), /unknown or already used/u);
  });

  it("asks unlinked chats to link, and escapes HTML", async () => {
    await bot().handleUpdate(update("/alerts", 900) as never);
    assert.match(String(calls.at(-1)?.payload.text), /not linked/u);
    assert.equal(calls.at(-1)?.payload.parse_mode, "HTML");
    assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  });

  it("is reported as not configured without a token", async () => {
    const plain = createContext(testConfig(), { store: new MemoryStore() });
    const served = await serve(createApp(plain));
    const status = (await (await fetch(`${served.url}/v1/telegram/status`)).json()) as { configured: boolean; mode: string };
    await served.close();
    assert.deepEqual([status.configured, status.mode], [false, "off"]);
  });
});
