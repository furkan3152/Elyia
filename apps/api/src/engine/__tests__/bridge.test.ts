/**
 * The canonical bridge through the service over fakes: depositEth (kind-12
 * message -> derived Elysium tx id -> settled when it lands), withdrawEth
 * (L2ToL1Tx position -> claim after confirmation through
 * Outbox.executeTransaction with a NodeInterface proof), and a retryable
 * whose auto-redeem failed (NEEDS_REDEEM -> ArbRetryableTx.redeem).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getEvmNetwork, type IntentGraph, type IntentStep } from "@elyia/core";
import { concatHex, decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, numberToHex, pad, type Address, type Hex } from "viem";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { testConfig } from "../../__tests__/support.js";
import { ARB_RETRYABLE_TX_ABI, ARB_SYS_ABI, BRIDGE_ABI, INBOX_ABI, OUTBOX_ABI, ROLLUP_ABI } from "../abis.js";
import { createEngine, type Engine } from "../index.js";
import { ARB_RETRYABLE_TX_ADDRESS, ARB_SYS_ADDRESS, clearOrbitCaches } from "../orbit/reads.js";
import { fixture, rawLog, type Fixture } from "./fakes.js";

const LIVE = { from: "0x1683ce24f61f40d0b140efdc78dc3fdcc7eb18fa", msgIdx: 1_872_777n, aliased: "0x2794CE24F61F40d0b140EFdc78dc3FdcC7EB2A0b", value: 99_990_893_300_000_000n, l2: "0x12675ff2443e751b84bf1af6dcf593ae9e9a64d37aac0c019729eca6d81639e1" } as const;
const PAIR = getEvmNetwork("elysium-testnet").elysiumBridge;
const ROLLUP = PAIR?.parent.rollup as Address;

describe("canonical bridge over fakes", () => {
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
    clearOrbitCaches();
    f = fixture();
    engine = createEngine(ctx, { deps: f.deps });
  });

  it("depositEth: verifies the kind-12 message, derives the live Elysium tx id and settles when it lands", async () => {
    f.evm.balances.set(LIVE.from, 10n ** 20n);
    const created = await engine.service.create({ actions: [{ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.0999908933" }], accounts: [`eip155:998:${LIVE.from}`], environment: "testnet", signer: "agent", dryRun: false, source: "structured" });
    const step = created.intent.steps[0] as IntentStep;
    assert.equal(step.route?.variant, "eth-deposit");
    assert.equal(step.settlement?.kind, "cross-network");
    const prepared = await engine.service.prepare(created.intent.id, "s1", {});
    const request = prepared.payload.requests[0] as { to: string; data: Hex; value: string };
    assert.equal(request.to, PAIR?.parent.inbox.toLowerCase());
    assert.equal(decodeFunctionData({ abi: INBOX_ABI, data: request.data }).functionName, "depositEth");
    assert.equal(request.value, LIVE.value.toString());

    const data = concatHex([LIVE.from as Hex, pad(numberToHex(LIVE.value), { size: 32 })]);
    const delivered = rawLog(
      PAIR?.parent.bridge as string,
      encodeEventTopics({ abi: BRIDGE_ABI, eventName: "MessageDelivered", args: { messageIndex: LIVE.msgIdx, beforeInboxAcc: pad("0x01", { size: 32 }) } }) as Hex[],
      encodeAbiParameters([{ type: "address" }, { type: "uint8" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [PAIR?.parent.inbox as Address, 12, LIVE.aliased, keccak256(data), 100_000_000n, 1_800_000_000n]),
    );
    const inbox = rawLog(PAIR?.parent.inbox as string, encodeEventTopics({ abi: INBOX_ABI, eventName: "InboxMessageDelivered", args: { messageNum: LIVE.msgIdx } }) as Hex[], encodeAbiParameters([{ type: "bytes" }], [data]));
    const hash = f.evm.land("hyperevm-testnet", { from: LIVE.from, to: request.to as Address, data: request.data, value: LIVE.value, logs: [delivered, inbox] });
    const submitted = await engine.service.submit(created.intent.id, "s1", [hash]);
    assert.equal(submitted.step.status, "settling");
    assert.equal(submitted.step.settlement?.trackingId, LIVE.l2);

    // The derived Elysium deposit transaction lands: the poller settles the step.
    f.evm.land("elysium-testnet", { hash: LIVE.l2, from: LIVE.aliased.toLowerCase() as Address, to: LIVE.from, data: "0x", value: LIVE.value });
    const progressed = await engine.service.progress(created.intent.id);
    assert.equal(progressed.graph.steps[0]?.status, "settled");
    assert.equal((await engine.service.journey(created.intent.id)).status, "completed");
  });

  it("withdrawEth: L2ToL1Tx position, then the claim step proves and executes it on the Outbox", async () => {
    const owner = "0x00000000000000000000000000000000000e1a1a";
    f.evm.balances.set(owner, 10n ** 20n);
    f.evm.on(ROLLUP, "confirmPeriodBlocks", 10n);
    const created = await engine.service.create({ actions: [{ kind: "bridge", network: "elysium-testnet", toNetwork: "hyperevm-testnet", from: "HYPE", amount: "0.2" }], accounts: [`eip155:99801:${owner}`], environment: "testnet", signer: "agent", dryRun: false, source: "structured" });
    assert.deepEqual(created.intent.steps.map((step) => [step.kind, step.network]), [["bridge", "elysium-testnet"], ["claim", "hyperevm-testnet"]]);
    const prepared = await engine.service.prepare(created.intent.id, "s1", {});
    const request = prepared.payload.requests[0] as { to: string; data: Hex };
    assert.equal(request.to, ARB_SYS_ADDRESS);
    const withdraw = decodeFunctionData({ abi: ARB_SYS_ABI, data: request.data });
    assert.equal(String(withdraw.args[0]).toLowerCase(), owner);
    const l2ToL1 = rawLog(
      ARB_SYS_ADDRESS,
      encodeEventTopics({ abi: ARB_SYS_ABI, eventName: "L2ToL1Tx", args: { destination: owner as Address, hash: 7n, position: 859_640n } }) as Hex[],
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }], [owner as Address, 20_000_000n, 30_000_000n, 1_800_000_000n, 2n * 10n ** 17n, "0x"]),
    );
    const hash = f.evm.land("elysium-testnet", { to: ARB_SYS_ADDRESS, data: request.data, value: 2n * 10n ** 17n, logs: [l2ToL1] });
    const submitted = await engine.service.submit(created.intent.id, "s1", [hash]);
    assert.equal(submitted.step.status, "settling");
    assert.equal(submitted.step.settlement?.trackingId, "859640");

    // Not confirmed yet: the claim refuses.
    const assertion = pad("0xaa", { size: 32 });
    const elysiumBlock = pad("0xbb", { size: 32 });
    let sendCount = 859_640n;
    f.evm.on(ROLLUP, "latestConfirmed", assertion).on(ROLLUP, "getAssertion", { firstChildBlock: 0n, secondChildBlock: 0n, createdAtBlock: 77n, isFirstChild: true, status: 2, configHash: assertion });
    const event = ROLLUP_ABI.find((item) => "name" in item && item.name === "AssertionCreated") as { readonly inputs: readonly { readonly indexed?: boolean }[] };
    const state = { globalState: { bytes32Vals: [elysiumBlock, pad("0xcc", { size: 32 })], u64Vals: [0n, 0n] }, machineStatus: 1, endHistoryRoot: assertion };
    const values = [{ beforeStateData: { prevPrevAssertionHash: assertion, sequencerBatchAcc: assertion, configData: { wasmModuleRoot: assertion, requiredStake: 0n, challengeManager: owner, confirmPeriodBlocks: 10n, nextInboxPosition: 0n } }, beforeState: state, afterState: state }, assertion, 0n, assertion, 0n, owner, 10n];
    f.evm.logsHandler = () => [rawLog(ROLLUP, encodeEventTopics({ abi: ROLLUP_ABI, eventName: "AssertionCreated", args: { assertionHash: assertion, parentAssertionHash: assertion } }) as Hex[], encodeAbiParameters(event.inputs.filter((input) => !input.indexed) as never, values as never))];
    f.evm.blocks.set(elysiumBlock, { number: 5n, hash: elysiumBlock, timestamp: 1, baseFeePerGas: null, sendCount, sendRoot: null, l1BlockNumber: null });
    f.evm.on(PAIR?.parent.outbox as string, "isSpent", false);
    const polled = await engine.service.progress(created.intent.id);
    assert.equal(polled.graph.steps[0]?.status, "settling");
    await assert.rejects(engine.service.prepare(created.intent.id, "s2", {}), (error: { code?: string }) => error.code === "STEP_NOT_READY" || error.code === "WITHDRAWAL_NOT_CLAIMABLE");

    // Confirmed: the withdrawal settles as claimable and the claim carries the outbox proof.
    sendCount = 859_700n;
    clearOrbitCaches();
    f.evm.blocks.set(elysiumBlock, { number: 5n, hash: elysiumBlock, timestamp: 1, baseFeePerGas: null, sendCount, sendRoot: null, l1BlockNumber: null });
    f.evm.on("0x00000000000000000000000000000000000000c8", "constructOutboxProof", [pad("0x01", { size: 32 }), pad("0x02", { size: 32 }), [pad("0x03", { size: 32 })]]);
    const confirmed = await engine.service.progress(created.intent.id);
    assert.equal(confirmed.graph.steps[0]?.status, "settled");
    assert.equal(confirmed.graph.steps[0]?.settlement?.state, "claimable");
    const claim = await engine.service.prepare(created.intent.id, "s2", {});
    const execute = decodeFunctionData({ abi: OUTBOX_ABI, data: (claim.payload.requests[0] as { data: Hex }).data });
    assert.equal(execute.functionName, "executeTransaction");
    assert.equal(execute.args[1], 859_640n);
    assert.equal(String(execute.args[3]).toLowerCase(), owner);
    assert.equal(execute.args[7], 2n * 10n ** 17n);
  });

  it("a retryable whose auto-redeem failed becomes NEEDS_REDEEM with a redeem follow-up; the redeem calls ArbRetryableTx.redeem", async () => {
    const owner = "0x00000000000000000000000000000000000e1a1a";
    const ticket = pad("0x7777", { size: 32 });
    const step = {
      id: "s1", index: 0, kind: "bridge", title: "Bridge 2 USDC", network: "hyperevm-testnet", chain: "eip155:998", account: `eip155:998:${owner}`, protocol: "elysium-canonical-bridge", mode: "wallet",
      inputs: [{ asset: "eip155:998/erc20:0x2B3370eE501B4a559b57D449569354196457D8Ab", symbol: "USDC", decimals: 6, expected: "2000000" }],
      outputs: [{ asset: "eip155:99801/erc20:0x7D29d8047B905000459c0E80c34a26CeedcB47b2", symbol: "USDC", decimals: 6, expected: "2000000" }],
      dependsOn: [], status: "settling", route: { variant: "erc20-deposit", slippageBps: 0, params: { to: owner } }, settlement: { kind: "cross-network", trackingId: ticket, state: "queued" }, evidence: [],
    } as unknown as IntentStep;
    const graph = { steps: [step] } as unknown as IntentGraph;
    // The ticket landed on Elysium, without a RedeemScheduled event (the auto-redeem ran out of gas).
    f.evm.land("elysium-testnet", { hash: ticket, to: ARB_RETRYABLE_TX_ADDRESS, data: "0x" });
    f.evm.callHandler = (_network, request) => (request.to === ARB_RETRYABLE_TX_ADDRESS ? { ok: true, data: pad(numberToHex(1_800_604_800n), { size: 32 }) } : { ok: false, revertData: null, message: "?" });
    const adapter = engine.registry.forStep(step);
    const polled = await adapter.poll?.(step, graph, f.clock.now());
    assert.equal(polled?.status, "settling");
    assert.ok(polled && polled.status === "settling");
    assert.equal(polled.settlement?.state, "needs-redeem");
    assert.equal(polled.followUp?.route.variant, "retryable-redeem");
    assert.equal(polled.followUp?.key, `redeem:${ticket}`);

    const redeemStep = { ...step, id: "s2", kind: "claim", network: "elysium-testnet", chain: "eip155:99801", account: `eip155:99801:${owner}`, inputs: [], outputs: [], status: "ready", route: polled.followUp?.route } as unknown as IntentStep;
    const payload = await engine.registry.forStep(redeemStep).prepare({ graph, step: redeemStep, amount: 0n, now: f.clock.now(), expiresAt: 0, signatureChainId: 99801 });
    const redeem = decodeFunctionData({ abi: ARB_RETRYABLE_TX_ABI, data: (payload.requests[0] as { data: Hex }).data });
    assert.equal(redeem.functionName, "redeem");
    assert.equal(redeem.args[0], ticket);
    // A ticket that no longer exists is skipped, never re-sent.
    f.evm.callHandler = () => ({ ok: false, revertData: null, message: "NoTicketWithID" });
    const gone = await engine.registry.forStep(redeemStep).prepare({ graph, step: redeemStep, amount: 0n, now: f.clock.now(), expiresAt: 0, signatureChainId: 99801 });
    assert.ok(gone.skip);
  });
});
