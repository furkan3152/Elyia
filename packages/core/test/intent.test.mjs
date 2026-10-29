import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ERROR_CATALOG,
  REVIEW_FAILURE_CODES,
  STEP_STATUSES,
  assertStepPath,
  assertStepTransition,
  bindingView,
  buildJourney,
  canTransitionStep,
  createEventBus,
  deriveIntentStatus,
  describeError,
  edgesFromSteps,
  errorCatalogRows,
  errorEnvelope,
  errorStatus,
  formatCloidReference,
  formatEvmReference,
  formatNonceReference,
  fundedFlow,
  gasReserveUnits,
  hypercore as hc,
  isIntentId,
  isRetryableError,
  l1RequestConsistent,
  newIntentId,
  parentCredit,
  parseReference,
  quoteBinding,
  readySteps,
  referenceClaimKey,
  referenceFitsNetwork,
  reserveTooLarge,
  resolveErrorCode,
  stepFailure,
  stepTransitionProblem,
  topologicalOrder,
  unlockableSteps,
  userSignedRequestConsistent,
  validateIntentGraph,
  validateIntentRequest,
  validateRule,
  validateTradeGoal,
} from "../dist/index.js";
import { AGENT, HYPE_ELY, OTHER, USER, accounts, sampleGraph, step } from "./fixtures.mjs";

/* ------------------------------------------------------------- lifecycle */

test("transition table: forward paths, retries and terminal states", () => {
  assert.equal(canTransitionStep("blocked", "ready"), true);
  assert.equal(canTransitionStep("ready", "preparing"), true);
  assert.equal(canTransitionStep("preparing", "awaiting-signature"), true);
  assert.equal(canTransitionStep("awaiting-signature", "submitted"), true);
  assert.equal(canTransitionStep("submitted", "settling"), true);
  assert.equal(canTransitionStep("settling", "settled"), true);
  assert.equal(canTransitionStep("submitted", "settled"), true, "same-network steps settle at once");
  for (const terminal of ["settled", "skipped", "stopped"]) {
    for (const to of STEP_STATUSES) if (to !== terminal) assert.equal(canTransitionStep(terminal, to), false, `${terminal} -> ${to}`);
  }
  // In-flight steps cannot be stopped: they are followed to settlement.
  for (const from of ["preparing", "submitted", "settling"]) assert.equal(canTransitionStep(from, "stopped"), false, from);
  assert.equal(canTransitionStep("blocked", "submitted"), false, "nothing is submitted before it is prepared");
  assert.throws(() => assertStepTransition({ status: "settled" }, "ready"), { name: "StepTransitionError" });
});

test("failure guards: retry only retryable failures; review failures settle only on evidence", () => {
  const retryable = { status: "failed", failure: stepFailure("TRANSACTION_REVERTED") };
  const review = { status: "failed", failure: stepFailure("OUTCOME_UNKNOWN") };
  const final = { status: "failed", failure: { code: "STEP_INVALID", message: "x", retryable: false } };
  assert.equal(stepTransitionProblem(retryable, "ready"), null);
  assert.match(stepTransitionProblem(review, "ready"), /review/u);
  assert.match(stepTransitionProblem(final, "ready"), /retryable/u);
  assert.equal(stepTransitionProblem(review, "settled"), null, "late evidence may settle a step under review");
  assert.match(stepTransitionProblem(retryable, "settled"), /review/u);
  assert.equal(stepTransitionProblem(retryable, "stopped"), null);
  assertStepPath(retryable, ["ready", "preparing", "awaiting-signature", "submitted"]);
  assert.throws(() => assertStepPath(review, ["ready"]));
});

test("deriveIntentStatus", () => {
  const s = (status, failure) => ({ status, ...(failure ? { failure } : {}) });
  assert.equal(deriveIntentStatus([s("settled"), s("settled")]), "completed");
  assert.equal(deriveIntentStatus([s("settled"), s("skipped")]), "partially-completed");
  assert.equal(deriveIntentStatus([s("settled"), s("stopped")]), "partially-completed");
  assert.equal(deriveIntentStatus([s("stopped"), s("stopped")]), "stopped");
  assert.equal(deriveIntentStatus([s("skipped"), s("skipped")]), "cancelled");
  assert.equal(deriveIntentStatus([s("settled"), s("failed", stepFailure("OUTCOME_UNKNOWN"))]), "needs-review");
  assert.equal(deriveIntentStatus([s("blocked"), s("failed", stepFailure("TRANSACTION_REVERTED"))]), "failed");
  assert.equal(deriveIntentStatus([s("settled"), s("failed", stepFailure("ORDER_REJECTED"))]), "partially-completed");
  assert.equal(deriveIntentStatus([s("settling"), s("blocked")]), "settling");
  assert.equal(deriveIntentStatus([s("awaiting-signature"), s("blocked")]), "executing");
  assert.equal(deriveIntentStatus([s("ready"), s("blocked")], "2026-10-29T12:30:00Z", Date.parse("2026-10-29T12:00:00Z")), "planned");
  assert.equal(deriveIntentStatus([s("ready"), s("blocked")], "2026-10-29T12:30:00Z", Date.parse("2026-10-29T13:00:00Z")), "expired");
  // A resting order (settling) keeps an intent alive past its plan expiry.
  assert.equal(deriveIntentStatus([s("settled"), s("settling")], "2026-10-29T12:30:00Z", Date.parse("2026-11-09T00:00:00Z")), "settling");
  assert.equal(deriveIntentStatus([]), "failed");
});

test("ready steps fan out; stopped parents never unlock children", () => {
  const steps = [step({ id: "s1", status: "settled" }), step({ id: "s2", index: 1, status: "blocked", dependsOn: ["s1"] }), step({ id: "s3", index: 2, status: "blocked", dependsOn: ["s1"] })];
  assert.deepEqual(readySteps(steps).map((entry) => entry.id), ["s2", "s3"]);
  assert.deepEqual(unlockableSteps(steps), ["s2", "s3"]);
  const stopped = [step({ id: "s1", status: "stopped" }), step({ id: "s2", index: 1, status: "blocked", dependsOn: ["s1"] })];
  assert.deepEqual(readySteps(stopped), []);
  assert.deepEqual(topologicalOrder([step({ id: "s2", dependsOn: ["s1"] }), step({ id: "s1" })]).map((entry) => entry.id), ["s1", "s2"]);
  assert.throws(() => topologicalOrder([step({ id: "s1", dependsOn: ["s2"] }), step({ id: "s2", dependsOn: ["s1"] })]), /cycle/u);
  assert.deepEqual(edgesFromSteps([step({ id: "s2", dependsOn: ["s1", "s0"], funding: { from: "s1", portionBps: 5000 } })]), [
    { from: "s1", to: "s2", kind: "funds" },
    { from: "s0", to: "s2", kind: "orders" },
  ]);
});

test("validateIntentGraph: the sample is valid; lane mixing and misplaced steps are caught", () => {
  assert.deepEqual(validateIntentGraph(sampleGraph()), []);
  const mixed = sampleGraph();
  const broken = { ...mixed, steps: [{ ...mixed.steps[0], settlement: { kind: "cross-network", destinationNetwork: "elysium-mainnet" } }, ...mixed.steps.slice(1)] };
  assert.ok(validateIntentGraph(broken).some((issue) => /mainnet and testnet/u.test(issue.message)));
  const wrongAccount = { ...mixed, steps: [{ ...mixed.steps[0], account: accounts.elysium }, ...mixed.steps.slice(1)] };
  assert.ok(validateIntentGraph(wrongAccount).some((issue) => /account must be/u.test(issue.message)));
  const evmOrder = { ...mixed, steps: [...mixed.steps.slice(0, 2), { ...mixed.steps[2], network: "elysium-testnet", chain: "eip155:99801", account: accounts.elysium }] };
  assert.ok(validateIntentGraph(evmOrder).some((issue) => /run on HyperCore/u.test(issue.message)));
  const noSnapshot = { ...mixed, steps: [...mixed.steps.slice(0, 2), { ...mixed.steps[2], order: undefined }] };
  assert.ok(validateIntentGraph(noSnapshot).some((issue) => /order snapshot/u.test(issue.message)));
  const unknownDep = { ...mixed, steps: [mixed.steps[0], { ...mixed.steps[1], dependsOn: ["s9"] }, mixed.steps[2]] };
  assert.ok(validateIntentGraph(unknownDep).some((issue) => /Unknown dependency s9/u.test(issue.message)));
  const mainnetAccount = { ...mixed, accounts: [`eip155:99901:${USER}`] };
  assert.ok(validateIntentGraph(mainnetAccount).some((issue) => /other environment/u.test(issue.message)));
});

test("intent ids", () => {
  const id = newIntentId();
  assert.equal(isIntentId(id), true);
  assert.notEqual(id, newIntentId());
  assert.equal(isIntentId("int_123"), false);
});

/* -------------------------------------------------------------- bindings */

const evmRequest = {
  vm: "evm",
  network: "hyperevm-testnet",
  chainId: 998,
  from: "0x5E9EE1089755c3435139848e47e6635505d5a13a",
  to: "0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0",
  data: "0x439370B1",
  value: "20000000000000000000",
  description: "Deposit 20 HYPE to Elysium",
};

function l1Request(overrides = {}) {
  const action = hc.orderAction([hc.orderWire({ asset: 3, isBuy: true, price: "80048", size: "0.01", kind: { limit: { tif: "Ioc" } }, cloid: hc.cloidFromInt(1) })]);
  const nonce = 1793280000000;
  const expiresAfter = nonce + 90_000;
  return {
    vm: "hypercore",
    network: "hypercore-testnet",
    kind: "l1-action",
    signer: "agent",
    from: USER,
    agent: AGENT,
    action,
    nonce: String(nonce),
    expiresAfter,
    connectionId: hc.actionHash(action, null, nonce, expiresAfter),
    description: "Long 0.01 BTC",
    ...overrides,
  };
}

function userSignedRequest() {
  const action = hc.usdClassTransferAction({ hyperliquidChain: "Testnet", signatureChainId: "0x185d9" }, { amount: "200", toPerp: true, nonce: 1793280000103 });
  return { vm: "hypercore", network: "hypercore-testnet", kind: "user-signed", signer: "wallet", from: USER, action, typedData: hc.typedDataForUserAction(action), nonce: "1793280000103", description: "Move 200 USDC to perps" };
}

test("quote bindings: deterministic, case-insensitive, sensitive to every security field", () => {
  const binding = quoteBinding([evmRequest]);
  assert.match(binding, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(quoteBinding([{ ...evmRequest, from: evmRequest.from.toLowerCase(), data: evmRequest.data.toLowerCase() }]), binding, "case never changes a binding");
  assert.equal(quoteBinding([{ ...evmRequest, description: "other words" }]), binding, "descriptions are not security fields");
  for (const change of [{ to: OTHER }, { value: "20000000000000000001" }, { chainId: 99801 }, { data: "0x439370b2" }, { from: OTHER }]) {
    assert.notEqual(quoteBinding([{ ...evmRequest, ...change }]), binding, JSON.stringify(change));
  }
  assert.notEqual(quoteBinding([evmRequest, evmRequest]), binding, "request count is bound");
  const l1 = l1Request();
  assert.equal(bindingView(l1).kind, "l1");
  assert.equal(bindingView(l1).chain, "Testnet");
  assert.notEqual(quoteBinding([l1]), quoteBinding([l1Request({ expiresAfter: l1.expiresAfter + 1 })]));
  assert.notEqual(quoteBinding([l1]), quoteBinding([l1Request({ agent: OTHER })]));
  const user = userSignedRequest();
  assert.equal(bindingView(user).primaryType, "HyperliquidTransaction:UsdClassTransfer");
  assert.equal(bindingView(user).signatureChainId, 99801);
});

test("engine guards: request payloads must be internally consistent", () => {
  const l1 = l1Request();
  assert.equal(l1RequestConsistent(l1), true);
  assert.equal(l1RequestConsistent({ ...l1, nonce: String(Number(l1.nonce) + 1) }), false);
  assert.equal(l1RequestConsistent({ ...l1, vaultAddress: OTHER }), false);
  assert.equal(l1RequestConsistent({ ...l1, action: hc.cancelAction([{ asset: 3, oid: 1 }]) }), false);
  const user = userSignedRequest();
  assert.equal(userSignedRequestConsistent(user), true);
  assert.equal(userSignedRequestConsistent({ ...user, nonce: "1" }), false);
  assert.equal(userSignedRequestConsistent({ ...user, typedData: { ...user.typedData, message: { ...user.typedData.message, toPerp: false } } }), false);
  assert.equal(userSignedRequestConsistent({ ...user, network: "hypercore-mainnet" }), false, "a Testnet action on a mainnet step is refused");
});

/* ------------------------------------------------------------ references */

test("references: strict formats, VM fit and global claim keys", () => {
  const hash = `0x${"AB".repeat(32)}`;
  assert.equal(formatEvmReference(hash), hash.toLowerCase());
  const cloid = formatCloidReference("0x5E9EE1089755c3435139848e47e6635505d5a13a", "0x0000000000000000000000000000BEEF");
  assert.equal(cloid, "hc:cloid:0x5e9ee1089755c3435139848e47e6635505d5a13a:0x0000000000000000000000000000beef");
  const nonce = formatNonceReference(AGENT, 1793280000000);
  assert.equal(nonce, `hc:nonce:${AGENT}:1793280000000`);
  assert.deepEqual(parseReference(cloid), { kind: "hc-cloid", user: USER, cloid: "0x0000000000000000000000000000beef" });
  assert.deepEqual(parseReference(nonce), { kind: "hc-nonce", signer: AGENT, nonce: "1793280000000" });
  assert.equal(parseReference(hash)?.kind, "evm-tx");
  for (const bad of ["hc:cloid:0x1234:0x00", `hc:nonce:${AGENT}:0`, `hc:nonce:${AGENT}:-1`, `HC:nonce:${AGENT}:1`, `hc:nonce:${AGENT}:18446744073709551616`, "0x1234", `hc:oid:${AGENT}:1`]) {
    assert.equal(parseReference(bad), null, bad);
  }
  assert.throws(() => formatNonceReference(AGENT, 0));
  assert.equal(referenceFitsNetwork(parseReference(hash), "elysium-testnet"), true);
  assert.equal(referenceFitsNetwork(parseReference(hash), "hypercore-testnet"), false);
  assert.equal(referenceFitsNetwork(parseReference(cloid), "hypercore-testnet"), true);
  assert.equal(referenceClaimKey("hypercore-testnet", parseReference(cloid)), "hypercore:testnet:cloid:0x5e9ee1089755c3435139848e47e6635505d5a13a:0x0000000000000000000000000000beef");
  assert.equal(referenceClaimKey("hypercore-testnet", parseReference(nonce)), `hypercore:testnet:nonce:${AGENT}:1793280000000`);
  assert.equal(referenceClaimKey("elysium-testnet", parseReference(hash)), `eip155:99801:tx:${hash.toLowerCase()}`);
});

/* --------------------------------------------------------------- journey */

test("journey: stops in order, the person's turn, ETAs and explorer links", () => {
  const graph = sampleGraph();
  const hash = `0x${"cd".repeat(32)}`;
  const settling = {
    ...graph,
    steps: [
      { ...graph.steps[0], status: "settling", references: [hash], evidence: [{ kind: "receipt", network: "hyperevm-testnet", observedAt: "2026-10-29T12:00:00.000Z" }] },
      { ...graph.steps[1], status: "awaiting-signature" },
      graph.steps[2],
    ],
  };
  const journey = buildJourney(settling, Date.parse("2026-10-29T12:00:10.000Z"));
  assert.equal(journey.spec, "elyia.journey/v1");
  assert.deepEqual(journey.stops.map((stop) => stop.phase), ["in-flight", "your-turn", "waiting"]);
  assert.equal(journey.stops[0].eta, "2026-10-29T12:01:00.000Z");
  assert.equal(journey.stops[1].signer, "agent");
  assert.equal(journey.next, "sign");
  assert.equal(journey.current, "s1");
  assert.equal(journey.status, "settling");
  assert.deepEqual(journey.stops[0].explorerUrls, [`https://testnet.purrsec.com/tx/${hash}`]);
  const review = { ...graph, steps: [{ ...graph.steps[0], status: "failed", failure: stepFailure("OUTCOME_UNKNOWN") }, graph.steps[1], graph.steps[2]] };
  assert.equal(buildJourney(review).next, "review");
  const done = { ...graph, steps: graph.steps.map((entry) => ({ ...entry, status: "settled" })) };
  const finished = buildJourney(done);
  assert.deepEqual([finished.next, finished.done, finished.total, finished.current, finished.status], ["none", 3, 3, null, "completed"]);
});

/* ------------------------------------------------------------------ flow */

test("funded flow: shares round down, gas reserve kept, third parties capped, own accounts not", () => {
  const parent = step({ id: "s1", outputs: [{ ...HYPE_ELY, expected: "1000", minimum: "900" }], status: "settled" });
  const child = step({ id: "s2", index: 1, dependsOn: ["s1"], inputs: [{ ...HYPE_ELY, expected: "500" }], funding: { from: "s1", portionBps: 5000, gasReserve: "10" } });
  const graph = sampleGraph({ steps: [parent, child], edges: edgesFromSteps([parent, child]) });
  const credit = parentCredit(graph, child);
  assert.deepEqual(credit, { expected: 1000n, worst: 900n, certainty: "quoted" });
  const flow = fundedFlow(graph, child, credit);
  assert.deepEqual(flow.spends, { expected: 490n, worst: 440n });
  assert.deepEqual(flow.kept, { expected: 510n, worst: 460n });
  const observed = { ...parent, actualOutputs: [{ ...HYPE_ELY, expected: "1200" }] };
  assert.deepEqual(parentCredit(sampleGraph({ steps: [observed, child], edges: edgesFromSteps([observed, child]) }), child), { expected: 1200n, worst: 1200n, certainty: "observed" });
  // Paying someone else: never more than planned input x (1 + slippage).
  const payout = { ...child, recipient: `eip155:99801:${OTHER}`, funding: { from: "s1", portionBps: 10_000 } };
  const capped = fundedFlow(sampleGraph({ steps: [parent, payout], edges: edgesFromSteps([parent, payout]) }), payout, { expected: 2000n, worst: 2000n, certainty: "quoted" }, { slippageBps: 100 });
  assert.equal(capped.spends.expected, 505n);
  // The same 0x address on another layer is the user, not a third party.
  const ownCore = { ...payout, recipient: `hypercore:testnet:${USER}` };
  assert.equal(fundedFlow(sampleGraph({ steps: [parent, ownCore], edges: edgesFromSteps([parent, ownCore]) }), ownCore, { expected: 2000n, worst: 2000n, certainty: "quoted" }).spends.expected, 2000n);
  assert.equal(gasReserveUnits(4458n), 9000n);
  assert.equal(reserveTooLarge(25n, 100n), true);
  assert.equal(reserveTooLarge(24n, 100n), false);
});

/* ---------------------------------------------------------------- errors */

test("error catalog: well formed, families resolve, envelopes in plain words", () => {
  for (const row of errorCatalogRows()) {
    assert.match(row.code, /^[A-Z][A-Z0-9_]+$/u);
    assert.ok(row.title.length > 3 && row.message.length > 15, row.code);
    assert.ok(!/eip155:8453|solana|base58|kletia/iu.test(row.message), `${row.code} mentions another product`);
  }
  assert.equal(resolveErrorCode("HYPERLIQUID_UNAVAILABLE"), "PROVIDER_UNAVAILABLE");
  assert.equal(resolveErrorCode("RPC_REJECTED"), "PROVIDER_REJECTED");
  assert.equal(resolveErrorCode("no such code"), null);
  assert.equal(describeError("HYPERLIQUID_UNAVAILABLE")?.retryable, true);
  assert.equal(errorStatus("INTENT_NOT_FOUND"), 404);
  assert.equal(errorStatus("OUTCOME_UNKNOWN"), 500, "step-only codes are not API statuses");
  assert.equal(isRetryableError("UNKNOWN_THING", 503), true);
  assert.equal(isRetryableError("QUOTE_MOVED"), false);
  assert.deepEqual(errorEnvelope("RATE_LIMITED", { requestId: "req_1" }), { error: { code: "RATE_LIMITED", message: ERROR_CATALOG.RATE_LIMITED.message, requestId: "req_1" } });
  for (const code of REVIEW_FAILURE_CODES) assert.deepEqual([stepFailure(code).retryable, stepFailure(code).review], [false, true], code);
  assert.equal(stepFailure("TRANSACTION_REVERTED").retryable, true);
  assert.equal(stepFailure("ORDER_REJECTED").retryable, true);
  assert.equal(stepFailure("STEP_INVALID").retryable, false);
});

/* ----------------------------------------------------------------- goals */

test("trade goals and rules validate numbers, bounds and unattended caps", () => {
  const long = { kind: "open", market: { coin: "ETH", kind: "perp" }, side: "long", size: { t: "margin", usd: "200" }, leverage: { x: 5 }, sl: { kind: "sl", px: { t: "offset", pct: "3", from: "entry", dir: "below" }, exec: "market" }, confidence: "exact" };
  assert.deepEqual(validateTradeGoal(long), []);
  assert.ok(validateTradeGoal({ ...long, leverage: { x: 1.5 } }).some((issue) => /whole number/u.test(issue.message)));
  assert.ok(validateTradeGoal({ ...long, market: { coin: "HYPE", kind: "spot" } }).some((issue) => /Spot has no leverage/u.test(issue.message)));
  assert.ok(validateTradeGoal({ ...long, size: undefined }).some((issue) => /size/u.test(issue.message)));
  assert.ok(validateTradeGoal({ kind: "twap", market: { coin: "BTC", kind: "perp" }, side: "buy", size: { t: "base", value: "1" }, twap: { minutes: 2 }, confidence: "exact" }).some((issue) => /TWAP/u.test(issue.message)));
  assert.deepEqual(validateTradeGoal({ kind: "close", market: { all: true }, confidence: "exact" }), []);
  const dca = { when: { t: "every", seconds: 86_400 }, then: [{ t: "trade", goal: { kind: "order", market: { coin: "HYPE", kind: "spot" }, side: "buy", size: { t: "base", value: "10" }, confidence: "exact" } }], limits: { maxUsdPerRun: "500" }, execution: "agent", confidence: "exact" };
  assert.deepEqual(validateRule(dca), []);
  assert.ok(validateRule({ ...dca, limits: {} }).some((issue) => /per-run USD cap/u.test(issue.message)), "unattended rules must be capped");
  assert.ok(validateRule({ ...dca, when: { t: "every", seconds: 5 } }).some((issue) => /once a minute/u.test(issue.message)));
  assert.deepEqual(validateRule({ ...dca, when: { metric: "funding", subject: { coin: "BTC", kind: "perp" }, op: "<", value: "-0.0013", unit: "pct", period: "1h" }, execution: "signEachRun", limits: {} }), []);
});

/* -------------------------------------------------------------- requests */

test("validateIntentRequest: one environment, CAIP-10 accounts, strict amounts", () => {
  const ok = validateIntentRequest({ text: "bridge 20 HYPE to Elysium", accounts: [accounts.hyperevm, accounts.elysium] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.environment, "testnet");
  const structured = validateIntentRequest({
    accounts: [accounts.hypercore],
    actions: [
      { kind: "leverage", network: "hypercore-testnet", market: "BTC", leverage: { value: 5 } },
      { kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "0.01", after: [0] },
    ],
  });
  assert.equal(structured.ok, true);
  const issues = (body) => (validateIntentRequest(body).ok ? [] : validateIntentRequest(body).issues.map((issue) => issue.path));
  assert.deepEqual(issues({ accounts: [accounts.elysium] }), ["text"]);
  assert.ok(issues({ text: "x", accounts: [`eip155:99901:${USER}`] }).includes("accounts[0]"), "mainnet account in a testnet intent");
  assert.ok(issues({ accounts: [accounts.elysium], actions: [{ kind: "swap", network: "elysium-testnet", amount: "1,5" }] }).includes("actions[0].amount"));
  assert.ok(issues({ accounts: [accounts.elysium], actions: [{ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-mainnet", amount: "1" }] }).includes("actions[0].toNetwork"));
  assert.ok(issues({ accounts: [accounts.hypercore], actions: [{ kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "1", leverage: { value: 2.5 } }] }).includes("actions[0].leverage"));
  assert.ok(issues({ accounts: [accounts.hypercore], actions: [{ kind: "order", network: "hypercore-testnet", market: "BTC", side: "long", size: "1", after: [0] }] }).includes("actions[0].after"));
  assert.ok(issues({ text: "x", accounts: [accounts.elysium], extra: 1 }).includes("extra"));
  assert.ok(issues({ text: "x", accounts: [accounts.elysium], constraints: { avoidProtocols: ["nope"] } }).includes("constraints.avoidProtocols"));
});

/* ---------------------------------------------------------------- events */

test("event bus isolates listener errors", () => {
  const errors = [];
  const bus = createEventBus((error) => errors.push(error));
  const seen = [];
  bus.on("intent.created", () => {
    throw new Error("boom");
  });
  bus.on("intent.created", (payload) => seen.push(payload.intentId));
  bus.onAny((type) => seen.push(type));
  bus.once("network.selected", (payload) => seen.push(payload.network));
  bus.emit("intent.created", { intentId: "int_1", status: "planned", title: "t" });
  bus.emit("network.selected", { network: "elysium-testnet" });
  bus.emit("network.selected", { network: "hyperevm-testnet" });
  assert.deepEqual(seen, ["int_1", "intent.created", "elysium-testnet", "network.selected", "network.selected"]);
  assert.equal(errors.length, 1);
});
