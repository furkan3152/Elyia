import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoalItem } from "@elyia/core";
import { validateLanguageGoals } from "@elyia/core";
import { goalsToActions } from "../../engine/planner/goals.js";
import { goalItemSchema } from "../../modules/intents/schemas.js";
import { chipsFor, examplesFor, readIntent } from "../index.js";
import { readText } from "../reader.js";
import { shapeOf } from "../shape.js";
import { ThreadSigner } from "../thread.js";

const NOW = Date.UTC(2026, 9, 31);
const facts = { now: NOW };

describe("reader", () => {
  it("asks instead of guessing, then reads the answered sentence", () => {
    const first = readText("long ETH 5x with 200 USDC, stop at -3%", { facts });
    assert.equal(first.status, "needs_input");
    assert.deepEqual(first.questions.map((question) => question.reason), ["STOP_BASIS"]);
    assert.equal(first.questions[0]?.purpose, true);
    assert.equal(first.canonical, null);
    const second = readText("long ETH 5x with 200 USDC, stop at -3%", { facts, answers: [{ question: "g0.sl.basis", option: "margin" }] });
    assert.equal(second.status, "ready");
    assert.deepEqual(second.goals.map(shapeOf), ["open long ETH perp margin:200 x5 cross sl:-0.6%entry"]);
    assert.ok(second.assumptions.some((entry) => entry.field === "sl.price" && entry.material));
    assert.equal(second.canonical, "long ETH with $200 margin 5x cross sl 0.6% below entry");
  });

  it("ignores an answer to a question that was not asked, and an invalid option", () => {
    const reading = readText("go long eth", { facts, answers: [{ question: "g0.leverage", option: "999" }, { question: "g7.nothing", option: "x" }] });
    assert.equal(reading.status, "needs_input");
    assert.equal(reading.usedAnswers.length, 0);
  });

  it("re-asks a typed answer that does not parse", () => {
    const reading = readText("swap HYPE to USDC on kalos", { facts, answers: [{ question: "g0.amount", text: "lots" }] });
    assert.equal(reading.status, "needs_input");
    assert.ok(reading.warnings.some((warning) => warning.code === "ANSWER_INVALID"));
  });

  it("reads composites with chains in both languages identically", () => {
    const en = readText("bridge 20 HYPE to Elysium and swap half to USDC", { facts });
    const tr = readText("20 HYPE'ı Elysium'a köprüle ve yarısını USDC'ye çevir", { facts });
    assert.equal(tr.locale, "tr");
    assert.deepEqual(tr.goals, en.goals);
    assert.deepEqual(validateLanguageGoals(en.goals), []);
  });

  it("is fail closed: unknown words, negations and secrets read nothing", () => {
    for (const text of ["swap 10 HYPE to USDC on kalos and flibber", "don't close my long", "here is my seed phrase", `my key 0x${"ab".repeat(32)}`]) {
      const reading = readText(text, { facts });
      assert.equal(reading.status, "unreadable", text);
      assert.deepEqual(reading.goals, []);
    }
    const secret = readText(`0x${"cd".repeat(32)}`, { facts });
    assert.ok(!JSON.stringify(secret).includes("cdcdcdcd"), "a secret is never echoed");
  });

  it("treats a bare cancel as a thread control", () => {
    assert.equal(readText("cancel", { facts }).status, "control");
    assert.equal(readText("iptal", { facts }).control, "cancel");
  });

  it("produces goals the engine accepts and compiles", () => {
    for (const text of ["swap 10 HYPE to USDC on kalos", "bridge 20 HYPE to Elysium and swap half to USDC", "long 0.5 ETH at 10x", "buy 100 HYPE spot limit 25", "stake 100 HYPE", "close all positions"]) {
      const reading = readText(text, { facts });
      assert.equal(reading.status, "ready", text);
      for (const goal of reading.goals) assert.ok(goalItemSchema.safeParse(goal).success, `${text}: ${JSON.stringify(goal)}`);
      if (text !== "close all positions") assert.ok(goalsToActions(reading.goals as GoalItem[], "testnet").length > 0, text);
    }
    const swap = goalsToActions(readText("swap 10 HYPE to USDC on kalos", { facts }).goals as GoalItem[], "testnet");
    assert.deepEqual(swap, [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "10", protocol: "kalos-v3" }]);
  });

  it("marks automations and questions as not plannable for the engine's text path", () => {
    assert.match(readText("alert me when ETH > 4000", { facts }).unsupported ?? "", /Elysium Agent/u);
    assert.equal(readText("show my positions", { facts }).status, "ready");
  });

  it("builds bounded rules: a cap derived from the body, runs from the sentence", () => {
    const reading = readText("every day buy 10 HYPE spot, 30 times", { facts: { ...facts, prices: { HYPE: "40" } } });
    assert.equal(reading.status, "ready");
    const goal = reading.goals[0];
    assert.equal(goal?.t, "rule");
    if (goal?.t !== "rule") return;
    assert.deepEqual(goal.rule.limits, { maxRuns: 30, maxUsdPerRun: "410" });
    assert.equal(goal.rule.execution, "agent");
    assert.equal(reading.priceSource, "reference:hypercore-mainnet-mids");
  });
});

describe("readIntent", () => {
  it("resolves .ely names through the resolver and reads again", async () => {
    const calls: string[] = [];
    const result = await readIntent("send 10 HYPE to bona.ely", { facts, resolveName: async (name) => (calls.push(name), "0xe49D0d8CF01Ea366D804CC84738A768F0b8b175e") });
    assert.deepEqual(calls, ["bona.ely"]);
    assert.deepEqual(result.goals.map(shapeOf), ["send 10 HYPE @elysium to:0xe49d0d8cf01ea366d804cc84738a768f0b8b175e"]);
    const missing = await readIntent("send 10 HYPE to nobody.ely", { facts, resolveName: async () => null });
    assert.equal(missing.questions[0]?.reason, "RECIPIENT_UNRESOLVED");
  });

  it("carries earlier answers in a signed thread", async () => {
    const signer = new ThreadSigner("test-secret");
    const text = "go long eth";
    const first = await readIntent(text, { facts, signer, now: NOW });
    assert.equal(first.thread, null, "nothing answered yet");
    const second = await readIntent(text, { facts, signer, now: NOW, answers: [{ question: "g0.leverage", option: "3" }] });
    assert.equal(second.status, "needs_input");
    assert.ok(second.thread);
    const third = await readIntent(text, { facts, signer, now: NOW + 1_000, thread: second.thread as string, answers: [{ question: "g0.size", text: "0.1" }] });
    assert.equal(third.status, "ready");
    assert.deepEqual(third.goals.map(shapeOf), ["open long ETH perp base:0.1 x3 cross"]);
    const forged = await readIntent(text, { facts, signer: new ThreadSigner("other"), now: NOW, thread: second.thread as string, answers: [{ question: "g0.size", text: "0.1" }] });
    assert.equal(forged.status, "needs_input", "a thread signed by someone else is ignored");
  });

  it("chips are fast, span-exact and need no facts", () => {
    const text = "ETH'de 5x long aç 200 USDC ile";
    const chips = chipsFor(text);
    assert.deepEqual(chips.map((chip) => chip.kind), ["market", "leverage", "side", "verb", "amount", "asset"]);
    for (const chip of chips) assert.equal(text.slice(chip.span[0], chip.span[1]), chip.text);
  });

  it("serves curated examples that read as advertised", () => {
    for (const locale of ["en", "tr"] as const) {
      const examples = examplesFor(locale);
      assert.equal(examples.categories.length, 6);
      for (const category of examples.categories) {
        assert.ok(category.examples.length >= 2);
        for (const example of category.examples) assert.notEqual(example.status, "unreadable", `${locale}: ${example.text}`);
      }
    }
  });
});
