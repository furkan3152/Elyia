import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readText } from "../reader.js";
import { factsFor, loadCorpus, readCase, scoreCorpus } from "./harness.js";

const corpus = loadCorpus();

describe("language eval corpus", () => {
  it("is large and bilingual enough to mean something", () => {
    assert.ok(corpus.cases.length >= 260, `${corpus.cases.length} cases`);
    assert.ok(corpus.cases.filter((item) => item.locale === "tr").length >= 90);
    assert.equal(new Set(corpus.cases.map((item) => item.id)).size, corpus.cases.length, "case ids are unique");
  });

  it("reads >= 95% exactly and never plans the wrong thing", () => {
    const score = scoreCorpus(corpus);
    const wrong = score.results.filter((result) => result.wrongPlan).map((result) => `${result.id} ${result.text}: want ${result.want}, got ${result.got}`);
    assert.deepEqual(wrong, [], "wrong plans");
    const misses = score.results.filter((result) => !result.exact).map((result) => `${result.id} ${result.text}: want ${result.want}, got ${result.got}`);
    assert.ok(score.exact / score.total >= 0.95, `exact ${score.exact}/${score.total}\n${misses.join("\n")}`);
  });

  it("is deterministic (two passes agree)", () => {
    const first = corpus.cases.map((item) => JSON.stringify(readCase(corpus, item)));
    const second = corpus.cases.map((item) => JSON.stringify(readCase(corpus, item)));
    assert.deepEqual(first, second);
  });

  it("re-reads every canonical sentence to exactly the same goals", () => {
    let checked = 0;
    for (const item of corpus.cases) {
      const reading = readCase(corpus, item);
      if (reading.status !== "ready" || reading.canonical === null) continue;
      const again = readText(reading.canonical, { locale: "en", facts: factsFor(corpus, item), resolvedNames: new Map(Object.entries(item.names ?? {})) });
      assert.equal(again.status, "ready", `${item.id}: "${reading.canonical}" -> ${again.status}`);
      assert.deepEqual(again.goals, reading.goals, `${item.id}: "${reading.canonical}"`);
      checked += 1;
    }
    assert.ok(checked > 200);
  });

  it("never asks more than two questions in a turn and keeps chips on the typed text", () => {
    for (const item of corpus.cases) {
      const reading = readCase(corpus, item);
      assert.ok(reading.questions.length <= 2, item.id);
      for (const chip of reading.chips) assert.equal(item.text.slice(chip.span[0], chip.span[1]), chip.text, `${item.id} chip ${chip.text}`);
      for (const question of reading.questions) {
        if (question.purpose) assert.ok(question.options.every((option) => option.recommended !== true), `${item.id}: purpose question recommends`);
      }
    }
  });
});
