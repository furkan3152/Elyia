/**
 * Tokens without a reference price through the engine (owner decision
 * 2026-11-01): on testnet KALOS / stKALOS plan and prepare within the Rule
 * Book's token cap, with "unpriced" notes on the policy summary, the intent,
 * the quotes and the prepare warnings; over the cap, under a `deny` book and
 * on mainnet they are refused. A price that merely cannot be read (an
 * oracle outage) still fails closed.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { DEFAULT_RULE_BOOK, nativeAssetId, validateRuleBook, type IntentGraph, type RuleBook } from "@elyia/core";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { testConfig } from "../../__tests__/support.js";
import { createEngine, type Engine } from "../index.js";
import type { RuleBookSource } from "../policy.js";
import { ReferencePrices } from "../prices.js";
import { STKALOS_VAULT } from "../venues.js";
import { fixture, OWNER, type Fixture } from "./fakes.js";

const ACCOUNT = `eip155:99801:${OWNER}` as const;
const KALOS = STKALOS_VAULT.asset;

function book(rules: Record<string, unknown>): RuleBook {
  const result = validateRuleBook({ schema: "elyia.rulebook/v1", ...rules });
  assert.ok(result.ok, JSON.stringify(result.issues));
  return result.value;
}

const fixed = (rules: RuleBook): RuleBookSource => ({ forOwner: () => Promise.resolve(rules) });

describe("unpriced tokens", () => {
  let ctx: AppContext;
  let f: Fixture;
  const engineWith = (books?: RuleBookSource): Engine => createEngine(ctx, { deps: f.deps, ...(books ? { ruleBooks: books } : {}) });

  before(() => {
    ctx = createContext(testConfig());
  });
  after(async () => {
    await closeContext(ctx);
  });
  beforeEach(() => {
    f = fixture();
    f.evm.on(STKALOS_VAULT.vault, "asset", KALOS).on(STKALOS_VAULT.vault, "previewDeposit", (args: readonly unknown[]) => (args[0] as bigint) * 10n ** 6n);
    f.evm.on("*", "allowance", 0n).on(KALOS, "balanceOf", 10n ** 24n);
  });

  const deposit = (engine: Engine, amount: string) =>
    engine.service.create({ actions: [{ kind: "deposit", network: "elysium-testnet", from: "KALOS", amount, protocol: "kalos-stkalos" }], accounts: [ACCOUNT], environment: "testnet", signer: "agent", dryRun: false, source: "structured" });

  it("reference sources: native HYPE and stables yes; KALOS, stKALOS, launch tokens no", () => {
    assert.equal(ReferencePrices.hasReference(nativeAssetId("elysium-testnet")), true, "native HYPE");
    assert.equal(ReferencePrices.hasReference("eip155:99801/erc20:0x7d29d8047b905000459c0e80c34a26ceedcb47b2"), true, "USDC");
    assert.equal(ReferencePrices.hasReference(`eip155:99801/erc20:${KALOS}`), false);
    assert.equal(ReferencePrices.hasReference(`eip155:99801/erc20:${STKALOS_VAULT.vault}`), false);
    assert.equal(ReferencePrices.hasReference("eip155:99801/erc20:0x8aa6f0835805ca99f370634415d502ec5c603baf"), false, "an unlisted launch token");
  });

  it("plans and prepares a KALOS -> stKALOS deposit on testnet under the default book, labelled unpriced", async () => {
    const engine = engineWith();
    const created = await deposit(engine, "10");
    assert.equal(created.policy.decision, "allow", JSON.stringify(created.policy.reasons));
    assert.equal(created.policy.notionalUsd, "0.00");
    const notes = created.policy.unpriced ?? [];
    assert.deepEqual(notes.map((note) => [note.symbol, note.role, note.status, note.cap, note.amountText]), [
      ["KALOS", "input", "allowed", "1000", "10"],
      ["stKALOS", "output", "allowed", null, "10"],
    ]);
    assert.ok(created.intent.warnings.some((warning) => warning === "Unpriced: KALOS has no reference price (testnet only, capped at 1000 KALOS per intent); USD totals leave it out."));
    assert.match(created.quotes[0]?.note ?? "", /unpriced: stKALOS has no reference price/u);
    const prepared = await engine.service.prepare(created.intent.id, "s1", { confirmed: true });
    assert.equal(prepared.payload.requests.length, 2, "approve + deposit");
    assert.ok(prepared.warnings.some((warning) => warning.startsWith("Unpriced: KALOS")));
    assert.equal(prepared.policy.decision, "allow");
  });

  it("refuses above the token cap, and under a book that denies unpriced tokens", async () => {
    await assert.rejects(deposit(engineWith(), "1500"), (error: { code?: string; message?: string }) => error.code === "POLICY_DENIED" && /1500 KALOS is above the 1000 KALOS cap/u.test(error.message ?? ""));
    const roomy = engineWith(fixed(book({ ...DEFAULT_RULE_BOOK, unpriced: { tokens: [{ asset: "KALOS", max: "5000" }] } })));
    assert.equal((await deposit(roomy, "1500")).policy.decision, "allow", "a per-token cap overrides the default");
    await assert.rejects(deposit(engineWith(fixed(book({ unpriced: { testnet: "deny" } }))), "1"), (error: { code?: string }) => error.code === "POLICY_DENIED");
  });

  it("on mainnet an unpriced token is refused whatever the book says", async () => {
    const engine = engineWith();
    const planned = await engine.service.create({ actions: [{ kind: "deposit", network: "elysium-testnet", from: "KALOS", amount: "1", protocol: "kalos-stkalos" }], accounts: [ACCOUNT], environment: "testnet", signer: "agent", dryRun: true, source: "structured" });
    // The same graph moved to HyperEVM mainnet (no Elyia venue there: the gate is evaluated directly).
    const mainnet = JSON.parse(JSON.stringify(planned.intent).replaceAll("eip155:99801", "eip155:999").replaceAll("elysium-testnet", "hyperevm-mainnet")) as IntentGraph;
    const loose = book({ networks: { environments: ["mainnet", "testnet"] }, unpriced: { testnet: "cap", defaultMax: "1000000000" } });
    const result = await createEngine(ctx, { deps: f.deps, ruleBooks: fixed(loose) }).gate.evaluate(mainnet, { stage: "plan", stored: true, owner: OWNER });
    assert.equal(result.evaluation.decision, "deny");
    assert.equal(result.evaluation.reasons[0]?.rule, "assets.unpriced");
    assert.ok(result.summary.unpriced?.every((note) => note.status === "refused" && note.network === "hyperevm-mainnet"));
  });

  it("an oracle outage is not 'unpriced': HYPE without a readable price fails closed", async () => {
    f.core.allMids = () => Promise.reject(new Error("Hyperliquid is down"));
    const engine = engineWith();
    await assert.rejects(
      engine.service.create({ actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "WHYPE", amount: "0.5" }], accounts: [ACCOUNT], environment: "testnet", signer: "agent", dryRun: false, source: "structured" }),
      (error: { code?: string }) => error.code === "POLICY_FACTS_UNAVAILABLE",
    );
  });
});
