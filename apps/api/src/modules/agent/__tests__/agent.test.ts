import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hypercore } from "@elyia/core";
import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import type { Proposal } from "@elyia/core/api/agent";
import { recoverTypedDataAddress, type Hex } from "viem";
import { createApp } from "../../../app.js";
import { createContext, type AppContext } from "../../../context.js";
import { parseSse, serve, testConfig, type Served } from "../../../__tests__/support.js";
import { MemoryStore } from "../../../store/memory.js";
import { issueToken } from "../../ops/auth/session.js";
import { chatTurn } from "../chat.js";
import { commandOf, movesOf } from "../deterministic.js";
import { agentActions, recipientsIn, runAgentTool } from "../tools.js";
import { goalsToActions } from "../../../engine/planner/goals.js";
import { readText } from "../../../language/reader.js";
import type { GoalItem } from "@elyia/core";
import { computeInsights, priceText, shocks } from "../insights.js";
import { keeperGuard, keeperOf, openKeeperKey, prepareKeeper, revokeKeeper, sealedKeyAddress, setKill, signWithKey, tradeOnlyReducing, type KeeperRecord } from "../keeper.js";
import { defaultMemory, memoryOf } from "../memory.js";

const OWNER = "0x5e9ee1089755c3435139848e47e6635505d5a13a";

function snapshotFixture(): PortfolioSnapshot {
  const line = (layer: "hypercore" | "hyperevm" | "elysium", account: "perp" | "spot" | "wallet", asset: string, amount: string, usd: number | null) => ({ id: `${layer}:${asset}`, layer, account, network: layer === "elysium" ? "elysium-testnet" : layer === "hyperevm" ? "hyperevm-testnet" : "hypercore-testnet", asset, assetId: null, amount, priceUsd: null, usd, underlying: asset, underlyingAmount: Number(amount), locked: null, note: null }) as const;
  return {
    address: OWNER,
    mode: "testnet",
    generatedAt: 0,
    pricing: { source: "hypercore-mainnet-reference", label: "reference", time: 0, khypeToHype: null },
    totals: { netWorthUsd: 2_000, byLayer: { hypercore: 1_000, hyperevm: 0, elysium: 1_000 }, unpricedLines: 0, unrealizedPnlUsd: 12.5, grossPerpNotionalUsd: 1_000 },
    layers: [
      { layer: "elysium", status: "ok", totalUsd: 1_000, unpricedLines: 0, sources: [], lines: [line("elysium", "wallet", "HYPE", "0.01", 0.4), line("elysium", "wallet", "USDC", "500", 500), line("elysium", "wallet", "KALOS", "3", 0.5)] },
      { layer: "hyperevm", status: "ok", totalUsd: 0, unpricedLines: 0, sources: [], lines: [line("hyperevm", "wallet", "HYPE", "2", 80)] },
      { layer: "hypercore", status: "ok", totalUsd: 1_000, unpricedLines: 0, sources: [], lines: [] },
    ],
    positions: [
      { id: "|HYPE", dex: "", coin: "HYPE", side: "long", size: "25", szi: "25", entryPx: "38", markPx: 40, positionValue: 1_000, unrealizedPnl: 50, roePct: 10, leverage: { type: "isolated", value: 5 }, maxLeverage: 10, liquidationPx: "38.4", liquidationDistancePct: 4, liquidationRisk: "danger", marginUsed: 200, fundingSinceOpen: 0, fundingAllTime: 0, positionValueUsd: 1_000 },
    ],
    accounts: [],
    exposure: [
      { underlying: "HYPE", perp: 25, spot: 2.01, lst: 0, net: 27.01, priceUsd: 40, netUsd: 1_080.4, isCash: false },
      { underlying: "USD", perp: 0, spot: 900, lst: 0, net: 900, priceUsd: 1, netUsd: 900, isCash: true },
    ],
    dexes: [],
    notes: [],
  } as unknown as PortfolioSnapshot;
}

let ctx: AppContext;
let server: Served;

before(async () => {
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_KEEPER_SECRET: "k".repeat(40) }), { store: new MemoryStore() });
  server = await serve(createApp(ctx));
});

after(async () => {
  await server.close();
});

describe("agent: deterministic insights", () => {
  const memory = { ...defaultMemory(OWNER), targetMix: { weights: { HYPE: 30, USD: 70 }, bandPct: 5 } };
  const { insights } = computeInsights({ snapshot: snapshotFixture(), memory, triggers: new Map(), history: null, funding: [{ coin: "BTC", aprPct: 22, openInterestUsd: 5e9, markPx: 100_000 }], environment: "testnet" });
  const byKind = (kind: string) => insights.find((insight) => insight.kind === kind);

  it("guards a position close to liquidation with a 25% reduce-only", () => {
    const guard = byKind("liquidation-guard");
    assert.equal(guard?.severity, "act");
    assert.deepEqual(guard?.actions[0], { kind: "order", network: "hypercore-testnet", market: "HYPE", params: { reduce: true, portionBps: 2_500 } });
  });

  it("auto-protects with a stop inside half the liquidation distance", () => {
    const protect = byKind("auto-protect");
    // mark 40, liq 38.4: half the distance is 2% -> stop 39.2 (tighter than the balanced 8%).
    assert.equal(protect?.figures.stopPx, "39.2");
    assert.deepEqual(protect?.actions[0], { kind: "order", network: "hypercore-testnet", market: "HYPE", stopLoss: "39.2", params: { protect: true } });
  });

  it("rebalances toward the target mix in one route card", () => {
    const rebalance = byKind("rebalance");
    assert.ok(rebalance);
    assert.equal(rebalance.figures.HYPEPct, 54.02);
    // Only 0.01 HYPE sits on Elysium above a 0.05 floor: nothing to swap there, said honestly.
    assert.equal(rebalance.actions.length, 0);
    assert.match(rebalance.explanation.en, /HyperCore trade/u);
  });

  it("tops up gas, sweeps idle USDC, flags dust and paper-harvests funding", () => {
    assert.deepEqual(byKind("gas-top-up")?.actions[0], { kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.1000" });
    assert.equal(byKind("idle-cash")?.actions[0]?.protocol, "cheshire");
    assert.equal(byKind("idle-cash")?.figures.apyPct, null, "no APY is promised");
    assert.equal(byKind("dust-sweep")?.figures.lines, 1);
    const harvest = byKind("funding-harvest");
    assert.equal(harvest?.paper, true);
    assert.equal(harvest?.actions.length, 0);
  });

  it("runs what-if shocks with liquidations", () => {
    const down20 = shocks(snapshotFixture()).find((shock) => shock.underlying === "HYPE" && shock.movePct === -20);
    assert.equal(down20?.pnlUsd, -216.08);
    assert.deepEqual(down20?.liquidated, ["HYPE"]);
    assert.equal(priceText(39.1234567), "39.123");
  });
});

describe("agent: deterministic grammar", () => {
  it("reads portfolio commands in English and Turkish", () => {
    assert.deepEqual(commandOf("what's my HYPE exposure?"), { id: "exposure", underlying: "HYPE" });
    assert.deepEqual(commandOf("what if HYPE drops 20%?"), { id: "shock", underlying: "HYPE", movePct: -20 });
    assert.deepEqual(commandOf("HYPE %15 düşerse ne olur"), { id: "shock", underlying: "HYPE", movePct: -15 });
    assert.equal(commandOf("pozisyonlarımı koru")?.id, "protect");
    assert.equal(commandOf("explain my pnl")?.id, "pnl");
    assert.equal(commandOf("swap 1 HYPE to USDC"), null);
  });
});

describe("agent: chained moves", () => {
  const facts = { now: Date.UTC(2026, 9, 31) };
  const compile = (text: string) => goalsToActions(movesOf(readText(text, { facts }).goals as GoalItem[]), "testnet");

  it("plans a multi-step sentence: the language reader's chain passes the plan_intent schema", () => {
    for (const text of ["Bridge 20 HYPE to Elysium and swap half to USDC", "20 HYPE'ı Elysium'a köprüle ve yarısını USDC'ye çevir"]) {
      const actions = compile(text);
      assert.equal(actions.length, 2, text);
      assert.deepEqual(actions[1]?.after, [0]);
      assert.equal(actions[1]?.amount, "max");
      assert.equal(actions[1]?.params?.portionBps, 5_000);
      const parsed = agentActions.safeParse(actions);
      assert.ok(parsed.success, parsed.success ? text : JSON.stringify(parsed.error.issues));
    }
  });

  it("accepts every action the reader compiles for its own examples (no key the schema drops)", () => {
    for (const text of ["swap 10 HYPE to USDC on kalos", "long 0.5 ETH at 10x", "buy 100 HYPE spot limit 25", "stake 100 HYPE", "twap buy 10 HYPE over 30 minutes"]) {
      const reading = readText(text, { facts });
      if (reading.status !== "ready") continue;
      const parsed = agentActions.safeParse(compile(text));
      assert.ok(parsed.success, `${text}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
    }
  });

  it("rejects a chain that points forwards or at itself", async () => {
    const bad = [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "max", after: [0] }];
    assert.equal(agentActions.safeParse(bad).success, false);
    const tools = { ctx, owner: OWNER, address: OWNER, integratorFee: null, proposals: [], drafts: [], cards: [], userRecipients: new Set<string>() };
    const outcome = await runAgentTool("plan_intent", { actions: bad }, tools);
    assert.equal(outcome.ok, false);
    assert.match(outcome.summary, /earlier action/u);
  });

  it("compiles a send to a typed address into a transfer the schema accepts (EN and TR)", () => {
    const to = "0x1111111111111111111111111111111111111111";
    for (const text of [`send 1 HYPE to ${to} on Elysium`, `${to} adresine Elysium'da 1 HYPE gönder`]) {
      const actions = compile(text);
      assert.equal(actions.length, 1, text);
      assert.equal(actions[0]?.kind, "transfer");
      assert.equal(actions[0]?.recipient?.toLowerCase(), to);
      const parsed = agentActions.safeParse(actions);
      assert.ok(parsed.success, parsed.success ? text : JSON.stringify(parsed.error.issues));
    }
  });

  it("only sends to recipients the user typed, never ones from tool output", async () => {
    assert.deepEqual([...recipientsIn(["Send 2 HYPE to 0xAbCdEf0000000000000000000000000000000001 and 1 to bona.ely"])], ["0xabcdef0000000000000000000000000000000001", "bona.ely"]);
    const stranger = "0x2222222222222222222222222222222222222222";
    const tools = { ctx, owner: OWNER, address: OWNER, integratorFee: null, proposals: [], drafts: [], cards: [], userRecipients: new Set<string>() };
    const outcome = await runAgentTool("plan_intent", { actions: [{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "1", recipient: stranger }] }, tools);
    assert.match(outcome.content, /RECIPIENT_NOT_FROM_USER/u);
    const proposed = await runAgentTool("propose_intent", { title: "Send", explanation: "Send 1 HYPE", actions: [{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "1", recipient: stranger }] }, tools);
    assert.match(proposed.content, /RECIPIENT_NOT_FROM_USER/u);
    assert.equal(tools.proposals.length, 0);
  });

  it("re-points chain links when a question sits between the moves", () => {
    const value = (after?: number) => ({ t: "value", goal: { kind: "convert", ...(after === undefined ? {} : { chain: { after } }) } }) as unknown as GoalItem;
    const moves = movesOf([value(), { t: "query", goal: {} } as unknown as GoalItem, value(0), value(1)]);
    assert.equal(moves.length, 3);
    assert.deepEqual((moves[1] as { goal: { chain?: { after: number } } }).goal.chain, { after: 0 });
    assert.equal((moves[2] as { goal: { chain?: unknown } }).goal.chain, undefined, "a link to a non-move is dropped");
  });
});

describe("agent: keeper", () => {
  let record: KeeperRecord;

  it("refuses without ELYIA_KEEPER_SECRET", async () => {
    const plain = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore() });
    const served = await serve(createApp(plain));
    const token = issueToken(plain, { address: OWNER }).token;
    const response = await fetch(`${served.url}/v1/agent/keeper/prepare`, { method: "POST", headers: { "content-type": "application/json", "Elyia-Session": token }, body: "{}" });
    const body = (await response.json()) as { error: { code: string } };
    await served.close();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "KEEPER_NOT_CONFIGURED");
  });

  it("prepares a named, expiring key and returns only the address and typed data", async () => {
    const response = await prepareKeeper(ctx, OWNER, { realm: "hypercore", days: 7, limits: { maxOrderUsd: 100, maxDailyUsd: 300 } });
    assert.match(response.agentName, /^elyia-keeper valid_until \d+$/u);
    assert.equal(response.sign.kind, "hypercore-approve-agent");
    const text = JSON.stringify(response);
    record = (await keeperOf(ctx, OWNER)) as KeeperRecord;
    const key = openKeeperKey(ctx, record);
    assert.ok(!text.includes(key.slice(2)), "the key never leaves the server");
    assert.ok(!JSON.stringify(record).includes(key.slice(2)), "the key is encrypted at rest");
    assert.equal(sealedKeyAddress(ctx, record), response.agentAddress);
    assert.equal(record.limits.reduceOnly, true);
  });

  it("signs HyperCore L1 actions the exchange attributes to the agent", async () => {
    const action = hypercore.orderAction([hypercore.orderWire({ asset: 135, isBuy: false, price: "39", size: "1", reduceOnly: true, kind: { limit: { tif: "Gtc" } } })]);
    const { typedData } = hypercore.l1ActionTypedData({ action, nonce: Date.now(), expiresAfter: Date.now() + 60_000, isMainnet: false });
    const signature = await signWithKey(openKeeperKey(ctx, record), typedData);
    const { EIP712Domain: _domain, ...types } = typedData.types as Record<string, unknown>;
    const signer = await recoverTypedDataAddress({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message, signature: signature as Hex } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
    assert.equal(signer.toLowerCase(), record.agentAddress);
  });

  it("guards every execution", () => {
    const now = Date.now();
    const active: KeeperRecord = { ...record, state: "active" };
    const protect = { actions: [{ kind: "order" as const, network: "hypercore-testnet" as const, market: "HYPE", stopLoss: "39", params: { protect: true } }], card: { notionalUsd: "80" } } as unknown as Proposal;
    const verdict = (rec: KeeperRecord | null, proposal: Proposal, killed = false) => keeperGuard(rec, proposal, { now, killed });
    assert.equal(verdict(active, protect).ok, true);
    assert.equal(verdict(record, protect).ok, false, "prepared, not active");
    assert.equal(verdict(active, protect, true).ok, false, "kill switch");
    assert.equal(verdict({ ...active, validUntil: now - 1 }, protect).ok, false, "expired");
    assert.equal(verdict({ ...active, sealedKey: null }, protect).ok, false, "key deleted");
    assert.equal(verdict(active, { ...protect, card: { notionalUsd: "150" } } as Proposal).ok, false, "per-order cap");
    assert.equal(verdict({ ...active, spent: { day: new Date(now).toISOString().slice(0, 10), usd: 250 } }, protect).ok, false, "daily cap");
    assert.equal(verdict({ ...active, limits: { ...active.limits, coins: ["BTC"] } }, protect).ok, false, "coin allowlist");
    const open = { actions: [{ kind: "order", network: "hypercore-testnet", market: "HYPE", side: "long", size: "1" }], card: { notionalUsd: "40" } } as unknown as Proposal;
    assert.equal(tradeOnlyReducing(open), false);
    assert.equal(verdict(active, open).ok, false, "new risk is never the keeper's");
    const swap = { actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }], card: { notionalUsd: "40" } } as unknown as Proposal;
    assert.equal(verdict(active, swap).ok, false, "EVM moves are wallet-signed");
    const withdraw = { actions: [{ kind: "transfer", network: "hypercore-testnet", from: "USDC", amount: "1", recipient: "0x0000000000000000000000000000000000000001" }], card: { notionalUsd: "1" } } as unknown as Proposal;
    assert.equal(verdict(active, withdraw).ok, false, "never a transfer");
  });

  it("revokes by deleting key material and returns the on-chain revoke", async () => {
    await setKill(ctx, OWNER, true);
    const revoked = await revokeKeeper(ctx, OWNER);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.revokeOnChain?.kind, "hypercore-approve-agent");
    const after = (await keeperOf(ctx, OWNER)) as KeeperRecord;
    assert.equal(after.sealedKey, null);
    assert.equal(after.state, "revoked");
    await setKill(ctx, OWNER, false);
  });
});

describe("agent: chat", () => {
  it("runs a Claude tool loop through a fake client and turns tool calls into events", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let round = 0;
    const fakeClient = {
      beta: {
        messages: {
          stream(params: Record<string, unknown>) {
            calls.push(params);
            round += 1;
            const first = round === 1;
            const handlers: Array<(text: string) => void> = [];
            return {
              on(event: string, handler: (text: string) => void) {
                if (event === "text") handlers.push(handler);
                return this;
              },
              async finalMessage() {
                if (first) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "remember", input: { riskProfile: "careful", goals: ["keep 30% in stables"] } }] };
                for (const handler of handlers) handler("Saved: careful profile.");
                return { stop_reason: "end_turn", content: [{ type: "text", text: "Saved: careful profile." }] };
              },
            };
          },
        },
      },
    };
    const events: Array<{ event: string; data: unknown }> = [];
    const llmCtx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_AGENT_MODEL: "test-model", ELYIA_AGENT_SERVER_FALLBACK: "1" }), { store: ctx.store });
    const done = await chatTurn({ ctx: llmCtx, owner: OWNER, address: OWNER, message: "I am careful, keep 30% in stables", threadId: null, locale: "en", integratorFee: null, emit: (event, data) => events.push({ event, data }), client: fakeClient as never });
    assert.equal(done.text, "Saved: careful profile.");
    assert.deepEqual(events.map((entry) => entry.event), ["thread", "tool_call", "tool_result", "token", "done"]);
    assert.equal((await memoryOf(ctx, OWNER)).riskProfile, "careful");
    const first = calls[0] as { model: string; fallbacks?: string; betas?: string[]; tools: Array<{ name: string }>; system: Array<{ text: string }> };
    assert.equal(first.model, "test-model");
    assert.equal(first.fallbacks, "default");
    assert.ok(first.tools.every((tool) => !/sign|send|withdraw|transfer/u.test(tool.name)), "no tool signs or moves funds");
    assert.ok(!/\d{4}-\d{2}-\d{2}/u.test(first.system[0]?.text ?? ""), "the system prompt is frozen");
    assert.ok(done.threadId.startsWith("thr_"));
  });

  it("ends a question turn with a structured clarify event, and reads the answers it is sent back", async () => {
    const offline = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore(), fetch: async () => { throw new Error("offline"); } });
    const local = await serve(createApp(offline));
    try {
      const post = async (body: unknown) => parseSse(await (await fetch(`${local.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).text());
      const first = await post({ message: "swap 10 HYPE", address: OWNER });
      const names = first.map((message) => message.event);
      assert.ok(names.indexOf("clarify") >= 0 && names.indexOf("clarify") < names.indexOf("done"), names.join(","));
      const clarify = JSON.parse(first.find((message) => message.event === "clarify")?.data ?? "{}") as { sentence: string; thread: string | null; threadId: string | null; questions: Array<{ id: string; options: Array<{ id: string }> }> };
      assert.equal(clarify.sentence, "swap 10 HYPE");
      assert.equal(clarify.threadId, null, "anonymous chats are not stored");
      assert.equal(clarify.thread, null, "no answers yet: nothing to sign");
      assert.deepEqual(clarify.questions.map((question) => question.id), ["g0.want.asset", "g0.network"]);
      assert.ok(clarify.questions.every((question) => question.options.length > 0));
      // The text still carries the prompts for clients that ignore the event.
      assert.match((JSON.parse(first.at(-1)?.data ?? "{}") as { text: string }).text, /which token\?/u);

      // One answer: the reader keeps it in its thread and asks only what is left.
      const second = await post({ message: "swap 10 HYPE", address: OWNER, clarify: { answers: [{ question: "g0.want.asset", option: "USDC" }] } });
      const next = JSON.parse(second.find((message) => message.event === "clarify")?.data ?? "{}") as { thread: string | null; questions: Array<{ id: string }> };
      assert.deepEqual(next.questions.map((question) => question.id), ["g0.network"]);
      assert.ok(next.thread, "the reader's signed thread carries the first answer");
      assert.ok(!second.some((message) => message.event === "tool_call"), "nothing is planned while a question is open");

      const bad = await fetch(`${local.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "swap 10 HYPE", address: OWNER, clarify: { answers: [{ question: "g0.network", option: "a", text: "b" }] } }) });
      assert.equal(bad.status, 400);
    } finally {
      await local.close();
    }
  });

  it("streams a deterministic answer over SSE without a model", async () => {
    const response = await fetch(`${server.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "help", address: OWNER }) });
    const messages = parseSse(await response.text());
    assert.equal(messages[0]?.event, "thread");
    assert.equal((JSON.parse(messages[0]?.data ?? "{}") as { mode: string }).mode, "deterministic");
    assert.ok(messages.some((message) => message.event === "token"));
    assert.equal(messages.at(-1)?.event, "done");
  });
});
