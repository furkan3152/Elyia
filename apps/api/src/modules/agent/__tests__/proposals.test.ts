/**
 * Proposal -> intent linking: approving a proposal through the wallet stores
 * one intent and links it back; approving again (the route card's Sign after
 * a reload) returns that same intent; the intent's final status marks the
 * proposal executed or failed. Planned over the engine fakes: no RPC, no
 * broadcast, nothing signed.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { IntentStreamEvent } from "@elyia/core/api/intents";
import { encodeAbiParameters } from "viem";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import { testConfig } from "../../../__tests__/support.js";
import { createEngine, setEngine } from "../../../engine/index.js";
import { fixture, OWNER, type Fixture } from "../../../engine/__tests__/fakes.js";
import { DEX_DA_COSTA, KALOS_V3 } from "../../../engine/venues.js";
import { MemoryStore } from "../../../store/memory.js";
import { createProposal, decide, proposalOf, proposalOutcome, settleProposalOf, wireProposalOutcomes } from "../proposals.js";

const owner = OWNER.toLowerCase();
const POOL = "0x591aa2ec4275135c640d07f9eaa35cdad52ab05c";
const ZERO = "0x0000000000000000000000000000000000000000";
const ACTIONS = [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01" }] as const;

/** One Kalos WHYPE/USDC pool quoting 95 USDC (the engine tests' fixture); no Dex Da Costa pair. */
function markets(f: Fixture): void {
  f.evm.on(KALOS_V3.factory, "getPool", (args: readonly unknown[]) => (args[2] === 20_000 ? POOL : ZERO));
  f.evm.on(POOL, "factory", KALOS_V3.factory).on(POOL, "liquidity", 10n ** 20n);
  f.evm.on("*", "allowance", 0n);
  f.evm.callHandler = (_network, request) => {
    if (request.to.toLowerCase() === KALOS_V3.quoter) return { ok: true, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }], [95_000_000n, 0n, 0, 0n]) };
    return { ok: false, revertData: null, message: "unexpected call" };
  };
  f.evm.on(DEX_DA_COSTA.factory, "getPair", ZERO);
  f.evm.balances.set(OWNER, 10n ** 20n);
}

describe("agent: proposals link to the intent the wallet signs", () => {
  let ctx: AppContext;
  before(() => {
    ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40) }), { store: new MemoryStore() });
  });
  after(async () => {
    await closeContext(ctx);
  });
  beforeEach(() => {
    const f = fixture();
    markets(f);
    setEngine(ctx, createEngine(ctx, { deps: f.deps }));
  });

  const propose = () => createProposal(ctx, owner, { origin: "chat", title: "Swap 0.01 HYPE", explanation: "test", actions: ACTIONS as never });

  it("approve stores one intent, links it, and a second approve returns the same intent", async () => {
    const proposal = await propose();
    assert.ok(proposal.card, JSON.stringify(proposal.planError));
    assert.equal(proposal.status, "pending");
    const first = await decide(ctx, owner, proposal.id, "approve");
    assert.equal(first.proposal.status, "approved");
    assert.ok(first.next?.intentId.startsWith("int_"));
    assert.equal(first.proposal.intentId, first.next?.intentId);
    const again = await decide(ctx, owner, proposal.id, "approve");
    assert.equal(again.next?.intentId, first.next?.intentId, "no second intent");
    assert.equal(again.next?.firstStepId, first.next?.firstStepId);
    assert.equal((await proposalOf(ctx, owner, proposal.id)).intentId, first.next?.intentId);
    await assert.rejects(decide(ctx, owner, proposal.id, "reject"), (error: { code?: string }) => error.code === "PROPOSAL_CLOSED");
  });

  it("the linked intent's final status closes the proposal (bus wiring), once", async () => {
    const off = wireProposalOutcomes(ctx);
    try {
      const proposal = await propose();
      const { next } = await decide(ctx, owner, proposal.id, "approve");
      const intentId = next!.intentId;
      const event = { id: "1", type: "intent.status_changed", at: new Date(0).toISOString(), data: { status: "completed" } } as unknown as IntentStreamEvent;
      ctx.bus.emit("intents.event", { intentId, event });
      for (let i = 0; i < 50 && (await proposalOf(ctx, owner, proposal.id)).status !== "executed"; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal((await proposalOf(ctx, owner, proposal.id)).status, "executed");
      // A later "failed" for the same intent does not rewrite an executed proposal.
      assert.equal((await settleProposalOf(ctx, intentId, "failed"))?.status, "executed");
      // An unknown intent touches nothing.
      assert.equal(await settleProposalOf(ctx, "int_" + "0".repeat(32), "completed"), null);
    } finally {
      off();
    }
  });

  it("maps intent statuses to proposal outcomes", () => {
    assert.equal(proposalOutcome("completed"), "executed");
    for (const status of ["failed", "expired", "stopped", "cancelled"]) assert.equal(proposalOutcome(status), "failed");
    for (const status of ["planned", "executing", "settling", "partially-completed", "needs-review"]) assert.equal(proposalOutcome(status), null);
  });
});
