/**
 * The eval harness: reads every corpus case against the fixture facts and
 * scores it. exact = the expected status and shapes (or, for a question,
 * the expected reason among the questions); wrong plan = a ready reading
 * where a question, a refusal or a different reading was expected.
 * Asking is never a wrong plan.
 */
import { readFileSync } from "node:fs";
import type { LanguageAnswer } from "@elyia/core/api/language";
import type { ReaderFacts } from "../frames/common.js";
import { readText, type Reading } from "../reader.js";
import { shapeOf } from "../shape.js";

export interface CorpusCase {
  readonly id: string;
  readonly text: string;
  readonly locale: "en" | "tr";
  readonly facts?: string;
  readonly answers?: readonly LanguageAnswer[];
  readonly names?: Readonly<Record<string, string>>;
  readonly expect: { readonly status: "ready" | "needs_input" | "unreadable" | "control"; readonly shapes?: readonly string[]; readonly reason?: string };
}

export interface Corpus {
  readonly fixtures: { readonly base: Partial<ReaderFacts>; readonly overlays: Readonly<Record<string, Partial<ReaderFacts>>> };
  readonly cases: readonly CorpusCase[];
}

export interface CaseResult {
  readonly id: string;
  readonly text: string;
  readonly exact: boolean;
  readonly wrongPlan: boolean;
  readonly got: string;
  readonly want: string;
}

export function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(new URL("./fixtures/corpus.json", import.meta.url), "utf8")) as Corpus;
}

export function factsFor(corpus: Corpus, item: CorpusCase): Partial<ReaderFacts> {
  return { ...corpus.fixtures.base, ...(item.facts ? corpus.fixtures.overlays[item.facts] : {}) };
}

export function readCase(corpus: Corpus, item: CorpusCase): Reading {
  return readText(item.text, {
    locale: item.locale,
    facts: factsFor(corpus, item),
    answers: item.answers ?? [],
    resolvedNames: new Map(Object.entries(item.names ?? {})),
  });
}

function describe(reading: Reading): string {
  if (reading.status === "ready") return `ready [${reading.goals.map(shapeOf).join(" | ")}]`;
  if (reading.status === "needs_input") return `needs_input [${reading.questions.map((question) => question.reason).join(",")}${reading.pendingQuestions ? ` +${reading.pendingQuestions}` : ""}]`;
  if (reading.status === "unreadable") return `unreadable (${reading.warnings.map((warning) => warning.code).join(",")})`;
  return reading.status;
}

export function scoreCase(corpus: Corpus, item: CorpusCase): CaseResult {
  const reading = readCase(corpus, item);
  const expect = item.expect;
  const want = expect.status === "ready" ? `ready [${(expect.shapes ?? []).join(" | ")}]` : expect.status === "needs_input" ? `needs_input [${expect.reason}]` : expect.status;
  const got = describe(reading);
  let exact = reading.status === expect.status;
  if (exact && expect.status === "ready") exact = JSON.stringify(reading.goals.map(shapeOf)) === JSON.stringify(expect.shapes ?? []);
  if (exact && expect.status === "needs_input") exact = reading.questions.some((question) => question.reason === expect.reason);
  const wrongPlan = reading.status === "ready" && !exact;
  return { id: item.id, text: item.text, exact, wrongPlan, got, want };
}

export interface Score {
  readonly total: number;
  readonly exact: number;
  readonly wrongPlans: number;
  readonly turkish: number;
  readonly results: readonly CaseResult[];
}

export function scoreCorpus(corpus: Corpus = loadCorpus()): Score {
  const results = corpus.cases.map((item) => scoreCase(corpus, item));
  return {
    total: results.length,
    exact: results.filter((result) => result.exact).length,
    wrongPlans: results.filter((result) => result.wrongPlan).length,
    turkish: corpus.cases.filter((item) => item.locale === "tr").length,
    results,
  };
}
