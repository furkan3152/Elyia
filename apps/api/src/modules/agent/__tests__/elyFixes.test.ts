/**
 * Fixes from the Ely quality battery and the fork end-to-end run:
 * HyperCore orders plan (dry run) without a browser key, the Rule Book is
 * readable and named with its limits, every holding reaches the model, the
 * Shield rule of proposal explanations is enforced in code, symbols resolve
 * for Shield, prices say what they are, and the stream keeps its newlines.
 * Planned over the engine fakes: no RPC, no broadcast, nothing signed.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { DEFAULT_RULE_BOOK } from "@elyia/core";
import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import { testConfig } from "../../../__tests__/support.js";
import { createEngine, setEngine, type Engine } from "../../../engine/index.js";
import { fixture, OWNER, type Fixture } from "../../../engine/__tests__/fakes.js";
import { quotaError } from "../../developers/gate.js";
import { MemoryStore } from "../../../store/memory.js";
import { readText } from "../../../language/reader.js";
import { chatTurn } from "../chat.js";
import { movesOf, unreadableText } from "../deterministic.js";
import { goalsToActions } from "../../../engine/planner/goals.js";
import type { GoalItem } from "@elyia/core";
import { computeInsights } from "../insights.js";
import { SYSTEM_PROMPT } from "../llm.js";
import { defaultMemory } from "../memory.js";
import { planActions, routeCardOf } from "../perception.js";
import { createProposal, decide } from "../proposals.js";
import { AGENT_TOOLS, compactSnapshot, priceBasisOf, ruleBookSummary, runAgentTool, shieldTarget, unsupportedSafetyClaim, type ToolContext } from "../tools.js";

const owner = OWNER.toLowerCase();
const AGENT = "0x000000000000000000000000000000000000a9e7";
const BTC_LONG = [{ kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "0.001", leverage: { value: 5 } }] as const;
const BTC_BIG = [{ kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "0.5" }] as const;

function tools(ctx: AppContext, extra: Partial<ToolContext> = {}): ToolContext {
  return { ctx, owner, address: owner, integratorFee: null, proposals: [], drafts: [], cards: [], userRecipients: new Set<string>(), calls: [], ...extra };
}

describe("ely fixes: HyperCore orders plan without a browser key (dry run only)", () => {
  let ctx: AppContext;
  let f: Fixture;
  let engine: Engine;
  before(() => {
    ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore() });
  });
  after(async () => {
    await closeContext(ctx);
  });
  beforeEach(() => {
    f = fixture();
    engine = createEngine(ctx, { deps: f.deps });
    setEngine(ctx, engine);
  });

  it("a dry run with no key on record shows an approve-a-key step first and still gets the Rule Book verdict", async () => {
    const plan = await planActions(ctx, owner, BTC_LONG as never);
    assert.deepEqual(plan.intent.steps.map((step) => step.kind), ["agent", "leverage", "order"]);
    assert.match(plan.intent.steps[0]?.title ?? "", /Approve a trade-only key/u);
    assert.ok(plan.intent.steps[2]?.dependsOn.includes("s1"));
    assert.ok(["allow", "confirm"].includes(plan.policy.decision), plan.policy.decision);
    const card = routeCardOf(plan);
    assert.equal(card.steps.length, 3);
  });

  it("a dry run uses the owner's approved web key on record (no approve step)", async () => {
    f.core.agents = [{ name: `elyia-web valid_until ${f.clock.now() + 10 * 86_400_000}`, address: AGENT, validUntil: f.clock.now() + 10 * 86_400_000 }];
    const plan = await planActions(ctx, owner, BTC_LONG as never);
    assert.deepEqual(plan.intent.steps.map((step) => step.kind), ["leverage", "order"]);
    assert.equal(plan.intent.steps[1]?.agent?.address, AGENT);
  });

  it("the stored plan stays strict: no key, no intent", async () => {
    await assert.rejects(planActions(ctx, owner, BTC_LONG as never, { dryRun: false }), (error: { code?: string }) => error.code === "AGENT_KEY_REQUIRED");
  });

  it("a perp order over the Rule Book's notional limit is denied with the rule id and limit on the card", async () => {
    const card = routeCardOf(await planActions(ctx, owner, BTC_BIG as never));
    assert.equal(card.policy.decision, "deny");
    const detail = card.policy.details?.find((entry) => entry.rule === "trading.maxNotionalUsd");
    assert.ok(detail, JSON.stringify(card.policy));
    assert.equal(Number(detail.limit), 10_000);
    assert.equal(card.policy.reasons.length, card.policy.details?.length);
  });

  it("a signed-in proposal of an order gets a card; approving it needs the browser key", async () => {
    const proposal = await createProposal(ctx, owner, { origin: "chat", title: "Long BTC", explanation: "test", actions: BTC_LONG as never });
    assert.ok(proposal.card, JSON.stringify(proposal.planError));
    assert.equal(proposal.planError, null);
    await assert.rejects(decide(ctx, owner, proposal.id, "approve"), (error: { code?: string }) => error.code === "AGENT_KEY_REQUIRED");
    const approved = await decide(ctx, owner, proposal.id, "approve", "wallet", { agent: AGENT });
    assert.equal(approved.proposal.status, "approved");
    assert.ok(approved.next?.intentId.startsWith("int_"));
  });

  it("a cancel without a market cancels every open order", async () => {
    f.core.frontendOpenOrders = () => Promise.resolve([{ coin: "BTC", oid: 11 }, { coin: "ETH", oid: 12 }] as never);
    const plan = await planActions(ctx, owner, [{ kind: "cancel", network: "hypercore-testnet" }]);
    const cancels = plan.intent.steps.filter((step) => step.kind === "cancel");
    assert.deepEqual(cancels.map((step) => step.cancel?.oid), [11, 12]);
    f.core.frontendOpenOrders = () => Promise.resolve([]);
    await assert.rejects(planActions(ctx, owner, [{ kind: "cancel", network: "hypercore-testnet" }]), /no open orders/u);
  });

  it("a reduce-only stop stays de-risking (never blocked) with the approve-a-key step in front", async () => {
    const summary = { accountValue: "1000", totalNtlPos: "0", totalRawUsd: "1000", totalMarginUsed: "0" };
    f.core.clearinghouseState = () => Promise.resolve({ marginSummary: summary, crossMarginSummary: summary, crossMaintenanceMarginUsed: "0", withdrawable: "1000", assetPositions: [{ type: "oneWay", position: { coin: "BTC", szi: "0.5", entryPx: "100000", positionValue: "50000", leverage: { type: "cross", value: 5 } } }], time: 0 } as never);
    f.core.frontendOpenOrders = () => Promise.resolve(Array.from({ length: 60 }, (_, index) => ({ coin: "BTC", oid: index })) as never);
    const plan = await planActions(ctx, owner, [{ kind: "order", network: "hypercore-testnet", market: "BTC", stopLoss: "90000", params: { protect: true } }]);
    assert.equal(plan.intent.steps[0]?.kind, "agent");
    assert.equal(plan.policy.derisking, true);
    assert.equal(plan.policy.decision, "allow");
  });

  it("the reader's \"cancel all my orders\" compiles to a cancel without a market", () => {
    const reading = readText("cancel all my open orders", { locale: "en" });
    assert.equal(reading.status, "ready", JSON.stringify(reading.questions));
    assert.deepEqual(goalsToActions(movesOf(reading.goals as GoalItem[]), "testnet"), [{ kind: "cancel", network: "hypercore-testnet" }]);
  });

  it("plan_intent and get_rule_book through the tool runner", async () => {
    const tc = tools(ctx, { owner: "anonymous" });
    const planned = await runAgentTool("plan_intent", { actions: BTC_BIG }, tc);
    assert.equal(planned.ok, true, planned.content);
    assert.match(planned.content, /trading\.maxNotionalUsd/u);
    const book = await runAgentTool("get_rule_book", {}, tc);
    assert.equal(book.ok, true, book.content);
    const data = (JSON.parse(book.content) as { data: ReturnType<typeof ruleBookSummary> }).data;
    assert.equal(data.caps.perIntentUsd, "25000");
    assert.equal(data.trading.maxNotionalUsd, "10000");
    assert.equal(data.trading.maxLeverage, 20);
    assert.equal(data.confirm.leverageAbove, 10);
    assert.equal(data.recipients.mode, "any");
    assert.match(data.note, /exchange limit, not a Rule Book rule/u);
    assert.deepEqual(tc.calls, ["plan_intent", "get_rule_book"]);
  });
});

describe("ely fixes: what the model sees", () => {
  let ctx: AppContext;
  before(() => {
    ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore(), fetch: async () => { throw new Error("offline"); } });
  });
  after(async () => {
    await closeContext(ctx);
  });

  function bigSnapshot(): PortfolioSnapshot {
    const line = (asset: string, amount: string, usd: number | null) => ({ id: asset, layer: "hypercore", account: "spot", network: "hypercore-testnet", asset, assetId: null, amount, priceUsd: null, usd, underlying: asset, underlyingAmount: Number(amount), locked: null, note: null });
    const lines = [line("USDC", "1000", 1000), ...Array.from({ length: 30 }, (_, index) => line(`T${index}`, "1", null)), line("GREAT", "500000.0073297", null), line("PURR", "5000", 593.27), line("ZERO", "0", null)];
    return {
      address: owner,
      mode: "testnet",
      pricing: { label: "reference" },
      totals: { netWorthUsd: 1593.27, byLayer: {}, unrealizedPnlUsd: 0 },
      layers: [{ layer: "hypercore", status: "ok", lines }],
      positions: [],
      exposure: [],
      notes: [],
    } as unknown as PortfolioSnapshot;
  }

  it("lists every holding: priced first, then each unpriced one as { symbol, amount, layer }", () => {
    const compact = compactSnapshot(bigSnapshot());
    assert.deepEqual(compact.holdings.map((entry) => entry.asset), ["USDC", "PURR"]);
    assert.equal(compact.unpricedHoldings.length, 31, "nothing is cut");
    assert.deepEqual(compact.unpricedHoldings.at(-1), { symbol: "GREAT", amount: "500000.0073297", layer: "hypercore" });
    assert.equal(compact.holdingsComplete, true);
    assert.ok(!compact.unpricedHoldings.some((entry) => entry.symbol === "ZERO"), "zero lines are left out");
  });

  it("narrows to one asset", () => {
    const compact = compactSnapshot(bigSnapshot(), { asset: "great" });
    assert.equal(compact.holdings.length, 0);
    assert.deepEqual(compact.unpricedHoldings, [{ symbol: "GREAT", amount: "500000.0073297", layer: "hypercore" }]);
    assert.equal(compact.linesForAsset, 1);
    assert.equal(compactSnapshot(bigSnapshot(), { asset: "NOPE" }).linesForAsset, 0);
  });

  it("labels HyperCore prices: testnet-mark on testnet", () => {
    assert.equal(priceBasisOf(ctx), "testnet-mark");
    const market = AGENT_TOOLS.find((tool) => tool.name === "get_market");
    assert.match(market?.description ?? "", /priceBasis/u);
  });

  it("describes size in base units and offers a USD notional", () => {
    const plan = AGENT_TOOLS.find((tool) => tool.name === "plan_intent");
    const action = (plan?.input_schema.properties.actions as { items: { properties: Record<string, { description?: string }> } }).items.properties;
    assert.match(action.size?.description ?? "", /base units/iu);
    assert.match(action.size?.description ?? "", /never USD/u);
    assert.match(action.params?.description ?? "", /notionalUsd/u);
  });

  it("resolves Shield targets by symbol through the registry, and refuses what it cannot pin", () => {
    const usdc = shieldTarget("elysium-testnet", "usdc");
    assert.ok(usdc.ok && /^0x[0-9a-f]{40}$/iu.test(usdc.address), JSON.stringify(usdc));
    assert.equal(shieldTarget("elysium-testnet", "NOTATOKEN").ok, false);
    const native = shieldTarget("elysium-testnet", "HYPE");
    assert.ok(!native.ok && native.code === "TOKEN_NATIVE");
    const address = "0x1111111111111111111111111111111111111111";
    assert.deepEqual(shieldTarget("elysium-testnet", address), { ok: true, address, symbol: null });
  });

  it("refuses a proposal explanation that claims a Shield or safety result without assess_token this turn", async () => {
    assert.equal(unsupportedSafetyClaim("Shield checks reported no problems.", []), true);
    assert.equal(unsupportedSafetyClaim("Güvenlik kontrolü temiz.", []), true);
    assert.equal(unsupportedSafetyClaim("Shield checks reported no problems.", ["assess_token"]), false);
    assert.equal(unsupportedSafetyClaim("Stakes 100 KALOS for stKALOS at the vault's rate.", []), false);
    const tc = tools(ctx);
    const refused = await runAgentTool("propose_intent", { title: "Stake KALOS", explanation: "Stake 100 KALOS. Shield checks reported no problems.", actions: [{ kind: "stake", network: "elysium-testnet", from: "KALOS", amount: "100" }] }, tc);
    assert.equal(refused.ok, false);
    assert.match(refused.content, /EXPLANATION_UNSUPPORTED/u);
    assert.equal(tc.proposals.length, 0);
  });

  it("tells a signed-out turn to stop at plan_intent", async () => {
    const outcome = await runAgentTool("propose_intent", { title: "Swap", explanation: "Swap 1 HYPE", actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }] }, tools(ctx, { owner: "anonymous" }));
    assert.match(outcome.content, /NOT_OWNER/u);
    assert.match(outcome.content, /stop at plan_intent/u);
  });

  it("keeps the system prompt frozen and carries the battery rules", () => {
    for (const rule of [/signed_in=no, stop at plan_intent/u, /exchange limit, not a Rule Book rule/u, /base units of the coin/u, /testnet mark/u, /never \$0/u, /assess_token ran this turn/u, /"siz"/u, /vague/u, /names or labels/u, /get_rule_book/u]) assert.match(SYSTEM_PROMPT, rule);
    assert.ok(!/\d{4}-\d{2}-\d{2}/u.test(SYSTEM_PROMPT));
  });

  it("never calls Cheshire verified", () => {
    const snapshot = { address: owner, mode: "testnet", pricing: { label: "reference" }, totals: { netWorthUsd: 500 }, layers: [{ layer: "elysium", status: "ok", lines: [{ layer: "elysium", account: "wallet", network: "elysium-testnet", asset: "USDC", amount: "500", usd: 500, underlying: "USD" }] }], positions: [], exposure: [], notes: [] } as unknown as PortfolioSnapshot;
    const idle = computeInsights({ snapshot, memory: defaultMemory(owner), triggers: new Map(), history: null, funding: [], environment: "testnet" }).insights.find((insight) => insight.kind === "idle-cash");
    assert.ok(idle);
    assert.match(idle.explanation.en, /the only executable ERC-4626 USDC venue on Elysium · unaudited/u);
    assert.doesNotMatch(`${idle.explanation.en} ${idle.explanation.tr}`, /verified|doğrulanmış/u);
  });

  it("streams the newline between tool rounds as a token", async () => {
    let round = 0;
    const client = {
      beta: {
        messages: {
          stream() {
            round += 1;
            const current = round;
            const handlers: Array<(text: string) => void> = [];
            return {
              on(event: string, handler: (text: string) => void) {
                if (event === "text") handlers.push(handler);
                return this;
              },
              async finalMessage() {
                if (current === 1) {
                  for (const handler of handlers) handler("Reading the Rule Book.");
                  return { stop_reason: "tool_use", content: [{ type: "text", text: "Reading the Rule Book." }, { type: "tool_use", id: "tu_1", name: "get_rule_book", input: {} }] };
                }
                for (const handler of handlers) handler("The per-intent cap is 25,000 USD.");
                return { stop_reason: "end_turn", content: [{ type: "text", text: "The per-intent cap is 25,000 USD." }] };
              },
            };
          },
        },
      },
    };
    const llmCtx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_AGENT_MODEL: "test-model" }), { store: new MemoryStore() });
    const tokens: string[] = [];
    const done = await chatTurn({ ctx: llmCtx, owner: null, address: owner, message: "what is my cap?", threadId: null, locale: "en", integratorFee: null, emit: (event, data) => (event === "token" ? tokens.push((data as { text: string }).text) : undefined), client: client as never });
    assert.equal(tokens.join(""), done.text);
    assert.ok(tokens.includes("\n"));
    await closeContext(llmCtx);
  });

  it("answers an unknown word kindly, in English and Turkish", () => {
    const en = readText("swap 1 HYPE to USDC frobnicate", { locale: "en" });
    assert.equal(en.status, "unreadable");
    const text = unreadableText(en, "en");
    assert.doesNotMatch(text, /unknown word:/u);
    assert.match(text, /didn't recognise "frobnicate"/u);
    assert.match(text, /Could you say it another way\?/u);
    const tr = readText("1 HYPE'ı USDC'ye çevir zırtapozlu", { locale: "tr" });
    const trText = unreadableText(tr, "tr");
    assert.doesNotMatch(trText, /unknown word:/u);
    assert.match(trText, /tanımadım/u);
    assert.match(trText, /yazar mısınız/u);
  });

  it("asks where a bridge starts when only HyperCore balances are known", () => {
    const hypercoreOnly = readText("bridge 0.5 HYPE to hyperevm", { locale: "en", facts: { balances: [{ network: "hypercore-testnet", symbol: "HYPE", amount: "10" }], balanceNetworks: ["hypercore-testnet"] } });
    assert.equal(hypercoreOnly.status, "needs_input");
    assert.ok(hypercoreOnly.questions.some((question) => question.id === "g0.source"));
    const elysium = readText("bridge 0.5 HYPE to hyperevm", { locale: "en", facts: { balances: [{ network: "elysium-testnet", symbol: "HYPE", amount: "3" }], balanceNetworks: ["hypercore-testnet", "elysium-testnet", "hyperevm-testnet"] } });
    assert.equal(elysium.status, "ready", JSON.stringify(elysium.questions));
    assert.match(JSON.stringify(elysium.goals), /elysium-testnet/u);
  });

  it("states the same wait in a quota error's message and Retry-After header", () => {
    const error = quotaError("plans per day", 5, 47_764);
    assert.equal(error.headers?.["Retry-After"], "47764");
    assert.match(error.message, /in 47764 s/u);
  });

  it("speaks to the user as \"siz\" in Turkish server text", async () => {
    const events: string[] = [];
    const done = await chatTurn({ ctx, owner: null, address: owner, message: "yardım", threadId: null, locale: "tr", integratorFee: null, emit: (event) => events.push(event) });
    assert.match(done.text, /Portföyünüzü/u);
    assert.match(done.text, /Deneyin:/u);
    assert.doesNotMatch(done.text, /Portföyünü |Dene:/u);
  });

  it("summarises the default Rule Book", () => {
    const summary = ruleBookSummary(DEFAULT_RULE_BOOK);
    assert.deepEqual(summary.confirm.when, ["external-recipient", "unlisted-asset"]);
    assert.equal(summary.unpriced.defaultMax, "1000");
  });
});
