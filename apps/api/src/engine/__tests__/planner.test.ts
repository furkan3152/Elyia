/**
 * Planner graphs for the spec's example sentences (as structured actions),
 * HyperCore trade payloads (cloid, tick rounding, expiresAfter, agent
 * insertion) and the HTTP surface (/v1/venues, /v1/intents, journey, SSE).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { createApp } from "../../app.js";
import { serve, testConfig, type Served } from "../../__tests__/support.js";
import type { VenuesResponse } from "@elyia/core/api/intents";
import { createEngine, setEngine, type Engine } from "../index.js";
import { normalizeActions, GAS_RESERVE_WEI } from "../planner/normalize.js";
import { fixture, OWNER, type Fixture } from "./fakes.js";

const AGENT = "0x000000000000000000000000000000000000a9e7";

describe("planner and HyperCore payloads", () => {
  let ctx: AppContext;
  let f: Fixture;
  let engine: Engine;
  before(() => {
    ctx = createContext(testConfig());
  });
  after(async () => {
    await closeContext(ctx);
  });
  beforeEach(() => {
    f = fixture();
    engine = createEngine(ctx, { deps: f.deps });
  });

  it('"bridge 10 HYPE to Elysium and stake half": stakes 5 on HyperEVM first, then bridges the other 5 and the kHYPE', async () => {
    const normalized = await normalizeActions(f.deps, "testnet", OWNER, [
      { kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "10" },
      { kind: "stake", network: "elysium-testnet", amount: "max", params: { portionBps: 5_000 } },
    ]);
    assert.deepEqual(normalized.actions.map((action) => [action.kind, action.network, action.destination, action.from, action.amount.t === "exact" ? action.amount.value : action.amount.t]), [
      ["stake", "hyperevm-testnet", "hyperevm-testnet", "HYPE", "5"],
      ["bridge", "hyperevm-testnet", "elysium-testnet", "HYPE", "5"],
      ["bridge", "hyperevm-testnet", "elysium-testnet", "kHYPE", "previous"],
    ]);
    assert.deepEqual(normalized.actions[2]?.after, [0]);
    assert.ok(normalized.warnings.some((warning) => warning.includes("Kinetiq staking runs on HyperEVM")));
  });

  it('"get me on Elysium with 100 USDC and swap to USDC": spot buy -> spotSend 0x2222 -> depositEth (gas kept) -> swap', async () => {
    const normalized = await normalizeActions(f.deps, "testnet", OWNER, [{ kind: "bridge", network: "hypercore-testnet", toNetwork: "elysium-testnet", from: "USDC", to: "USDC", amount: "100" }]);
    assert.deepEqual(normalized.actions.map((action) => [action.kind, action.network, action.destination]), [
      ["order", "hypercore-testnet", "hypercore-testnet"],
      ["link", "hypercore-testnet", "hyperevm-testnet"],
      ["bridge", "hyperevm-testnet", "elysium-testnet"],
      ["swap", "elysium-testnet", "elysium-testnet"],
    ]);
    assert.equal(normalized.actions[0]?.params.quoteAmount, "100");
    assert.equal(normalized.actions[2]?.gasReserve, GAS_RESERVE_WEI);
    assert.equal(normalized.actions[3]?.params.arrivalGas, "0.05");
  });

  it("Elysium -> HyperCore goes through HyperEVM (withdraw, then link); vault and lending actions need a named venue", async () => {
    const normalized = await normalizeActions(f.deps, "testnet", OWNER, [{ kind: "bridge", network: "elysium-testnet", toNetwork: "hypercore-testnet", from: "HYPE", amount: "1" }]);
    assert.deepEqual(normalized.actions.map((action) => [action.kind, action.destination]), [["bridge", "hyperevm-testnet"], ["link", "hypercore-testnet"]]);
    await assert.rejects(normalizeActions(f.deps, "testnet", OWNER, [{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "1" }]), (error: { code?: string }) => error.code === "INTENT_CLARIFY");
    const all = await normalizeActions(f.deps, "testnet", OWNER, [{ kind: "withdraw", network: "elysium-testnet", to: "USDC", amount: "max", protocol: "elyra-lending" }]);
    assert.equal(all.actions[0]?.params.all, true);
    await assert.rejects(normalizeActions(f.deps, "testnet", OWNER, [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }, { kind: "swap", network: "elysium-mainnet", from: "USDC", to: "HYPE", amount: "max" }]), (error: { code?: string }) => error.code === "CAPITAL_LANE_MIXED");
  });

  it("a market long inserts approveAgent first, then an IOC order at mid + slippage on the tick, with a cloid and expiresAfter", async () => {
    f.core.agents = [];
    const created = await engine.service.create({ actions: [{ kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "0.001", leverage: { value: 5 } }], accounts: [`eip155:99801:${OWNER}`], environment: "testnet", signer: "agent", agent: AGENT, dryRun: false, source: "structured" });
    assert.deepEqual(created.intent.steps.map((step) => step.kind), ["agent", "leverage", "order"]);
    assert.ok(created.intent.steps[1]?.dependsOn.includes("s1") && created.intent.steps[2]?.dependsOn.includes("s1"));
    const order = created.intent.steps[2];
    assert.equal(order?.order?.tif, "Ioc");
    // mid 100,000 + 50 bps = 100,500 (5 significant figures).
    assert.equal(order?.order?.limitPx, "100500");
    assert.match(order?.order?.cloid ?? "", /^0x[0-9a-f]{32}$/u);

    const approve = await engine.service.prepare(created.intent.id, "s1", {});
    const approval = approve.payload.requests[0] as { kind: string; action: { type: string; agentAddress: string; agentName: string } };
    assert.equal(approval.kind, "user-signed");
    assert.equal(approval.action.type, "approveAgent");
    assert.equal(approval.action.agentAddress.toLowerCase(), AGENT);
    assert.match(approval.action.agentName, /^elyia-web/u);
  });

  it("an order prepared for an approved agent carries the wire action, the cloid and a 90 s expiry", async () => {
    f.core.leverage = { ETH: 3 };
    f.core.agents = [{ name: "elyia-web valid_until 1802592000000", address: AGENT, validUntil: f.clock.now() + 10 * 24 * 3_600_000 }];
    const created = await engine.service.create({ actions: [{ kind: "order", network: "hypercore-testnet", market: "ETH", side: "short", size: "0.01", price: "4123.456" }], accounts: [`eip155:99801:${OWNER}`], environment: "testnet", signer: "agent", agent: AGENT, dryRun: false, source: "structured" });
    assert.deepEqual(created.intent.steps.map((step) => step.kind), ["order"]);
    const step = created.intent.steps[0];
    // A sell limit never rounds more aggressive: 4123.456 -> 4123.5 (5 significant figures, rounded up).
    assert.equal(step?.order?.limitPx, "4123.5");
    const prepared = await engine.service.prepare(created.intent.id, "s1", {});
    const request = prepared.payload.requests[0] as unknown as { kind: string; signer: string; agent: string; expiresAfter: number; nonce: string; cloids: string[]; connectionId: string; action: { type: string; orders: { a: number; b: boolean; p: string; s: string; r: boolean; t: unknown; c: string }[]; grouping: string } };
    assert.equal(request.kind, "l1-action");
    assert.equal(request.signer, "agent");
    assert.equal(request.agent, AGENT);
    assert.equal(request.action.type, "order");
    assert.deepEqual(request.action.orders[0], { a: 1, b: false, p: "4123.5", s: "0.01", r: false, t: { limit: { tif: "Gtc" } }, c: prepared.intent.steps[0]?.order?.cloid });
    assert.equal(request.expiresAfter, f.clock.now() + 90_000);
    assert.equal(request.cloids[0], prepared.intent.steps[0]?.order?.cloid);
    assert.match(request.connectionId, /^0x[0-9a-f]{64}$/u);
  });
});

describe("HTTP surface", () => {
  let ctx: AppContext;
  let served: Served;
  let f: Fixture;
  before(async () => {
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_RATE_LIMIT_HEAVY: "10000" }));
    f = fixture();
    setEngine(ctx, createEngine(ctx, { deps: f.deps }));
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("GET /v1/venues lists every executable venue with network, kind and status, filterable", async () => {
    const all = (await (await fetch(`${served.url}/v1/venues`)).json()) as VenuesResponse;
    assert.equal(all.priceSource, "reference:hypercore-mainnet-mids");
    const live = new Set(all.venues.filter((venue) => venue.status === "live").map((venue) => venue.id));
    for (const id of ["kalos-v3", "dex-da-costa", "perpme", "hexswap", "hyperswap-v3", "signal", "kalos-stkalos", "cheshire", "elyra-lending", "elysium-canonical-bridge", "elysium-mirror-bridge", "hyperevm-core-link", "hypercore-perps", "kinetiq", "wrapped-hype", "evm-transfer", "elysium-names"]) assert.ok(live.has(id), id);
    const dex = (await (await fetch(`${served.url}/v1/venues?kind=dex&network=elysium-testnet`)).json()) as VenuesResponse;
    assert.ok(dex.venues.length >= 4 && dex.venues.every((venue) => venue.kind === "dex" && venue.network === "elysium-testnet"));
    assert.equal((await fetch(`${served.url}/v1/venues?kind=bogus`)).status, 400);
  });

  it("GET /v1/venues gives every swap venue a pair it holds liquidity for (not HYPE/USDC for all)", async () => {
    const all = (await (await fetch(`${served.url}/v1/venues?kind=dex`)).json()) as VenuesResponse;
    const probe = (id: string) => all.venues.find((venue) => venue.id === id)?.probe;
    for (const id of ["kalos-v3", "dex-da-costa", "perpme", "hexswap", "hyperswap-v3"]) assert.ok(probe(id), id);
    assert.equal(probe("perpme")?.pair, "HYPE/PERPME");
    assert.equal(probe("perpme")?.verified, false);
    assert.match(probe("perpme")?.to ?? "", /^0x[0-9a-f]{40}$/u);
    assert.equal(probe("hexswap")?.toSymbol, "HEX");
    assert.equal(probe("kalos-v3")?.pair, "HYPE/USDC");
    assert.equal(probe("hyperswap-v3")?.liquid, false, "HyperSwap testnet pools read empty");
    for (const venue of all.venues.filter((entry) => entry.probe)) assert.match(venue.probe!.checked, /^\d{4}-\d{2}-\d{2}$/u, venue.id);
  });

  it("POST /v1/intents (structured, dry run and stored), GET the graph and journey, and the SSE snapshot", async () => {
    f.evm.balances.set(OWNER, 10n ** 20n);
    const body = { accounts: [`eip155:99801:${OWNER}`], actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "WHYPE", amount: "0.5" }] };
    const dry = await fetch(`${served.url}/v1/intents?dryRun=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(dry.status, 200);
    const stored = await fetch(`${served.url}/v1/intents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(stored.status, 201);
    const { intent } = (await stored.json()) as { intent: { id: string; steps: { protocol: string }[] } };
    assert.equal(intent.steps[0]?.protocol, "wrapped-hype");
    assert.equal((await fetch(`${served.url}/v1/intents/${intent.id}`)).status, 200);
    const journey = (await (await fetch(`${served.url}/v1/intents/${intent.id}/journey`)).json()) as { intentId: string };
    assert.equal(journey.intentId, intent.id);
    const controller = new AbortController();
    const stream = await fetch(`${served.url}/v1/intents/${intent.id}/stream`, { signal: controller.signal });
    assert.equal(stream.headers.get("content-type")?.startsWith("text/event-stream"), true);
    const reader = stream.body?.getReader();
    const chunk = await reader?.read();
    controller.abort();
    assert.match(new TextDecoder().decode(chunk?.value), /event: intent\.snapshot/u);
  });

  it("POST /v1/intents with text goes to the language reader (or answers TEXT_NOT_SUPPORTED_YET without one)", async () => {
    const response = await fetch(`${served.url}/v1/intents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accounts: [`eip155:99801:${OWNER}`], text: "wrap 0.1 HYPE", dryRun: true }) });
    const json = (await response.json()) as { error?: { code: string } };
    assert.ok(response.status === 200 || (response.status >= 400 && response.status < 500), String(response.status));
    if (json.error) assert.notEqual(json.error.code, "INTERNAL");
  });
});
