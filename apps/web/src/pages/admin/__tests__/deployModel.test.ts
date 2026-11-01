import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { elyiaRouterArtifact, elysiumTestnetDeployManifest } from "@elyia/core/contracts/index";

import { campsDone, compareRuntimeCode, deployReducer, predictAddress, resolveArgs, stampOf, stripMetadata, walletPhase, type DeployPreview, type DeployState } from "../deployModel";
import { clampFee, confirmPhrase, phraseMatches, protocolFeeCap, setProtocolFeeData, pauseData } from "../routerModel";

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const preview: DeployPreview = { contract: "ElyOrders", network: "elysium-testnet", chainId: 99801, from: OWNER, nonce: 0, predicted: "0x5FbDB2315678afecb367f032d93F642f64180aa3", data: "0x60", gas: 100n, gasPriceWei: 1n, args: [], simulatedSize: 10, simulationError: null, matchesServerPlan: null };
const receipt = { hash: "0xabc", blockNumber: "1", address: preview.predicted, gasUsed: "90" };

describe("deploy state machine", () => {
  it("walks the five camps in order and stamps only proven steps", () => {
    let state: DeployState = { phase: "idle" };
    const seen: number[] = [campsDone(state)];
    for (const event of [{ type: "preview" }, { type: "previewed", preview }, { type: "sign" }, { type: "sent", hash: "0xabc" }, { type: "mined", receipt }, { type: "checked", code: { verdict: "immutables", differing: 20 } }, { type: "recorded", at: "2026-11-01T00:00:00Z" }] as const) {
      state = deployReducer(state, event);
      seen.push(campsDone(state));
    }
    assert.deepEqual(seen, [0, 0, 1, 1, 2, 3, 4, 5]);
    assert.equal(state.phase, "done");
    assert.equal(stampOf(state, null), "Verified");
    assert.equal(walletPhase(state), "confirmed");
  });

  it("ignores events out of order", () => {
    const idle: DeployState = { phase: "idle" };
    assert.equal(deployReducer(idle, { type: "sent", hash: "0x1" }), idle);
    const ready = deployReducer(deployReducer(idle, { type: "preview" }), { type: "previewed", preview });
    assert.equal(deployReducer(ready, { type: "mined", receipt }), ready);
  });

  it("fails into the right camp, keeps the earlier stamps, and a bytecode mismatch never records", () => {
    const signing = deployReducer(deployReducer(deployReducer({ phase: "idle" }, { type: "preview" }), { type: "previewed", preview }), { type: "sign" });
    const rejected = deployReducer(signing, { type: "fail", error: "User rejected" });
    assert.equal(rejected.phase, "failed");
    assert.equal(rejected.phase === "failed" && rejected.camp, "sign");
    assert.equal(campsDone(rejected), 1);
    assert.equal(walletPhase(rejected), "failed");
    // retry signing from the failure keeps the same preview
    assert.equal(deployReducer(rejected, { type: "sign" }).phase, "signing");
    const verifying = deployReducer(deployReducer(signing, { type: "sent", hash: "0x1" }), { type: "mined", receipt });
    const mismatch = deployReducer(verifying, { type: "checked", code: { verdict: "mismatch", reason: "size" } });
    assert.equal(mismatch.phase, "failed");
    assert.equal(mismatch.phase === "failed" && mismatch.camp, "bytecode");
    assert.equal(deployReducer(mismatch, { type: "recorded", at: "x" }).phase, "failed");
    assert.equal(stampOf(verifying, null), "Deployed");
    assert.equal(stampOf(signing, null), "Deploying");
    assert.equal(stampOf({ phase: "idle" }, "0x1"), "Verified");
    assert.equal(deployReducer(mismatch, { type: "reset" }).phase, "idle");
  });
});

describe("constructor arguments from the manifest", () => {
  const [router, factory, orders] = elysiumTestnetDeployManifest.order;
  it("fills $OWNER with the wallet and keeps the manifest's fixed values", () => {
    const resolved = resolveArgs(router.constructor, OWNER, {});
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.values[0], OWNER);
      assert.equal(resolved.values[1], "0x000000000022D473030F116dDEE9F6B43aC78BA3");
      assert.equal((resolved.values[2] as unknown[]).length, 11);
    }
    assert.deepEqual(resolveArgs(factory.constructor, OWNER, {}), { ok: true, values: [], shown: [] });
  });
  it("never invents the router address for ElyOrders", () => {
    const missing = resolveArgs(orders.constructor, OWNER, {});
    assert.equal(missing.ok, false);
    const ok = resolveArgs(orders.constructor, OWNER, { ElyiaRouter: "0x5FbDB2315678afecb367f032d93F642f64180aa3" });
    assert.equal(ok.ok && ok.values[0], "0x5FbDB2315678afecb367f032d93F642f64180aa3");
    assert.equal(resolveArgs(router.constructor, null, {}).ok, false);
  });
  it("predicts the CREATE address from deployer and nonce", () => {
    assert.equal(predictAddress(OWNER, 0), "0x5FbDB2315678afecb367f032d93F642f64180aa3");
    assert.equal(predictAddress(OWNER, 1), "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  });
});

describe("bytecode check", () => {
  const meta = "a264" + "11".repeat(0x30) + "0032";
  it("strips the CBOR metadata", () => {
    assert.equal(stripMetadata("0x6001" + "a1" + "0001"), "6001");
  });
  it("accepts exact code and immutables in zero-filled slots, refuses anything else", () => {
    const art = "0x6080" + "0000" + "5b" + meta;
    assert.deepEqual(compareRuntimeCode("0x6080" + "0000" + "5b" + meta, art), { verdict: "exact", differing: 0 });
    assert.deepEqual(compareRuntimeCode("0x6080" + "abcd" + "5b" + meta.replace(/11/gu, "22"), art), { verdict: "immutables", differing: 2 });
    assert.equal(compareRuntimeCode("0x6081" + "0000" + "5b" + meta, art).verdict, "mismatch");
    assert.equal(compareRuntimeCode("0x6080" + "5b" + meta, art).verdict, "mismatch");
    assert.equal(compareRuntimeCode("0x", art).verdict, "mismatch");
    assert.equal(compareRuntimeCode(elyiaRouterArtifact.deployedBytecode, elyiaRouterArtifact.deployedBytecode).verdict, "exact");
  });
});

describe("router controls", () => {
  it("caps the protocol fee at the router's own limit", () => {
    assert.equal(protocolFeeCap({ MAX_PROTOCOL_FEE_BPS: "30" }), 30);
    assert.equal(protocolFeeCap({ MAX_PROTOCOL_FEE_BPS: null }), 30);
    assert.equal(protocolFeeCap(undefined), 30);
    assert.equal(clampFee(45, 30), 30);
    assert.equal(clampFee(-2, 30), 0);
    assert.equal(clampFee(7.6, 30), 8);
  });
  it("needs the exact typed phrase to pause", () => {
    assert.equal(confirmPhrase("pause", 99801), "PAUSE 99801");
    assert.equal(phraseMatches("  pause   99801 ", "PAUSE 99801"), true);
    assert.equal(phraseMatches("PAUSE 998", "PAUSE 99801"), false);
    assert.equal(confirmPhrase("unpause", 998), "RESUME 998");
  });
  it("encodes setProtocolFee and pause with the router ABI", () => {
    const data = setProtocolFeeData(elyiaRouterArtifact.abi as never, 5, OWNER);
    assert.ok(data.startsWith("0x"));
    assert.equal(data.length, 2 + 8 + 64 * 2);
    assert.equal(pauseData(elyiaRouterArtifact.abi as never, "pause").length, 10);
  });
});
