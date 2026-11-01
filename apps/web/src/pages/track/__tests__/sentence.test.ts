import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../../../lib/apiErrors";
import { deviationLabel, isFakePrice } from "../flow/routeModel";
import { clarifyOf, examplesOf, plannerInput, readingOf, sentenceGradeOf, tagWarnings, withAnswer } from "../flow/sentence";

const NEEDS = {
  spec: "elyia.language/v1",
  locale: "en",
  status: "needs_input",
  goals: [{ t: "value", goal: { kind: "convert", op: "swap" } }],
  questions: [{ id: "g0.network", goal: 0, field: "network", reason: "NETWORK_AMBIGUOUS", prompt: "Swap on which network?", options: [{ id: "elysium", label: "Elysium", detail: "elysium-testnet", recommended: true }, { id: "hyperevm", label: "HyperEVM" }], allowsText: false, purpose: false }],
  pendingQuestions: 0,
  assumptions: [{ goal: 0, field: "recipient", label: "bona.ely is 0xe49D…", material: true }],
  chips: [{ text: "swap", kind: "verb", span: [0, 4], value: "swap" }],
  canonical: null,
  warnings: [{ code: "LOOKALIKE_USDC", message: "Only canonical USDC is routed." }],
  thread: "t.signed",
};

describe("sentences: the reader's answer", () => {
  it("reads a needs_input reply with its questions, options, notes and thread", () => {
    const reading = readingOf(NEEDS)!;
    assert.equal(reading.status, "needs_input");
    assert.equal(reading.questions[0]!.options.length, 2);
    assert.equal(reading.questions[0]!.options[0]!.recommended, true);
    assert.equal(reading.questions[0]!.purpose, false);
    assert.equal(reading.thread, "t.signed");
    assert.deepEqual(reading.goalKinds, ["swap"]);
    assert.equal(reading.assumptions[0]!.material, true);
    assert.equal(reading.warnings.length, 1);
  });
  it("refuses what is not a reading", () => {
    assert.equal(readingOf(null), null);
    assert.equal(readingOf({ status: "maybe" }), null);
  });
  it("plans what the reader's plan says: the words and the signed thread, never the canonical sentence", () => {
    const goals = [{ t: "value", goal: { kind: "convert", op: "swap" } }];
    const ready = readingOf({ ...NEEDS, status: "ready", questions: [], goals, canonical: "swap 1 HYPE to USDC on elysium", thread: "t.ready", plan: { text: "swap 1 HYPE to USDC", thread: "t.ready", goals } })!;
    assert.deepEqual(ready.plan, { text: "swap 1 HYPE to USDC", thread: "t.ready" });
    assert.deepEqual(plannerInput("swap 1 HYPE to USDC", ready, 1), { text: "swap 1 HYPE to USDC", thread: "t.ready" });
    const plain = readingOf({ ...NEEDS, status: "ready", questions: [], canonical: "swap 1 HYPE to USDC on elysium", thread: null, plan: { text: "swap 1 HYPE to USDC", thread: null, goals } })!;
    assert.deepEqual(plannerInput(" swap 1 HYPE to USDC ", plain, 0), { text: "swap 1 HYPE to USDC" });
    // A rule or a question (plan null): the words go so the planner says where they belong.
    const rule = readingOf({ ...NEEDS, status: "ready", questions: [], canonical: "alert me when ETH price above 4000", thread: null, plan: null })!;
    assert.equal(rule.plan, null);
    assert.deepEqual(plannerInput("alert me when ETH price above 4000", rule, 0), { text: "alert me when ETH price above 4000" });
    assert.equal(plannerInput("x", readingOf(NEEDS)!, 0), null);
  });
  it("falls back for a server without plan: ready thread, else the canonical sentence", () => {
    const threaded = readingOf({ ...NEEDS, status: "ready", questions: [], canonical: "swap 1 HYPE to USDC on elysium", thread: "t.ready" })!;
    assert.equal(threaded.plan, undefined);
    assert.deepEqual(plannerInput("swap 1 HYPE to USDC", threaded, 1), { text: "swap 1 HYPE to USDC", thread: "t.ready" });
    const old = readingOf({ ...NEEDS, status: "ready", questions: [], canonical: "swap 1 HYPE to USDC on elysium", thread: null })!;
    assert.deepEqual(plannerInput("swap 1 HYPE to USDC", old, 1), { text: "swap 1 HYPE to USDC on elysium" });
  });
  it("keeps one answer per question", () => {
    const answers = withAnswer(withAnswer([], { question: "g0.network", option: "hyperevm" }), { question: "g0.network", option: "elysium" });
    assert.deepEqual(answers, [{ question: "g0.network", option: "elysium" }]);
  });
  it("turns a planner 422 into questions and a refusal into examples", () => {
    const clarify = clarifyOf(new ApiError({ code: "INTENT_CLARIFY", message: "Swap on which network?", status: 422, details: { questions: [{ id: "g0.network", prompt: "Swap on which network?", field: "network" }], thread: null } }))!;
    assert.equal(clarify.questions[0]!.id, "g0.network");
    assert.equal(clarify.questions[0]!.allowsText, true);
    assert.equal(clarifyOf(new Error("x")), null);
    assert.deepEqual(examplesOf(new ApiError({ code: "INTENT_UNSUPPORTED", message: "no", details: { examples: ["a", 1, "b"] } })), ["a", "b"]);
  });
  it("grades from the words and the goals", () => {
    assert.equal(sentenceGradeOf("long ETH 12x"), 5);
    assert.equal(sentenceGradeOf("send 1 HYPE to bona.ely"), 1);
    assert.equal(sentenceGradeOf("swap 1 HYPE to USDC"), 2);
  });
});

describe("sentences: trail notes and the auction", () => {
  it("tags the planner's warnings, serious first", () => {
    const tagged = tagWarnings([
      "Elysium Testnet pool prices are test prices, not market prices; USD values use HyperCore mainnet reference mids.",
      "Fake price: Kalos V3's testnet pool pays 7,829% more than the reference price (HyperCore mainnet mids).",
      "cUSDC (0xf6b3…): Not in Elyia's verified token list for Elysium Testnet.",
      "3 known look-alikes of USDC exist on Elysium Testnet; the verified one is 0x7D29….",
    ]);
    assert.deepEqual(tagged.map((item) => item.tag), ["fake-price", "unverified", "lookalike", "testnet"]);
  });
  it("labels the deviation from the reference", () => {
    assert.equal(deviationLabel(782_855), "▲ +7,829% vs reference");
    assert.equal(deviationLabel(-9_878), "▼ −98.8% vs reference");
    assert.equal(deviationLabel(20), "at the reference");
    assert.equal(isFakePrice(782_855), true);
    assert.equal(isFakePrice(-120), false);
    assert.equal(isFakePrice(undefined), false);
  });
});
