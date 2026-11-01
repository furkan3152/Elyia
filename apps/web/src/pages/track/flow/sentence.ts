/**
 * Sentences (pure): what the language reader (POST /v1/intents/parse) and
 * the planner (POST /v1/intents with `text`) answer, turned into what the
 * route card and its clarify panel show.
 *
 * The round trip, fail closed at every turn:
 * 1. parse the sentence: live chips, and either `ready`, `needs_input`
 *    (questions with options), `unreadable` or `control`;
 * 2. answers go back to parse with the signed `thread` of the previous turn;
 *    the reader re-reads the same words with the answers;
 * 3. once `ready`, the reader's `plan` says what the planner takes: the
 *    typed words with the signed thread of the answers (the planner re-reads
 *    them to the same goals), never a re-planned canonical sentence; a dry
 *    run: nothing stored, nothing signed.
 *
 * A planner `422 INTENT_CLARIFY` (it re-reads everything) becomes questions
 * too, so the panel never shows a dead end.
 */
import type { LanguageAnswer, LanguageAssumption, LanguageChip, LanguageQuestion, LanguageWarning, ParseIntentResponse } from "@elyia/core/api/language";

import { ApiError } from "../../../lib/apiErrors";
import { gradeFor, type Grade } from "../../../topo/geometry/conditions";

export type { LanguageAnswer, LanguageQuestion };

/** The parts of a reading the web shows (validated loosely: the API may add fields). */
export interface SentenceReading {
  readonly status: ParseIntentResponse["status"];
  readonly locale: string;
  readonly chips: readonly LanguageChip[];
  readonly questions: readonly LanguageQuestion[];
  readonly pendingQuestions: number;
  readonly assumptions: readonly LanguageAssumption[];
  readonly warnings: readonly LanguageWarning[];
  readonly canonical: string | null;
  readonly thread: string | null;
  readonly examples: readonly string[];
  /** Goal kinds ("convert", "relocate", "trade" …), for the first grade. */
  readonly goalKinds: readonly string[];
  /**
   * What POST /v1/intents takes for a ready reading (`ParseIntentResponse.plan`):
   * the words and the signed answers. null: not plannable as an intent;
   * undefined: the server predates `plan`.
   */
  readonly plan?: { readonly text: string; readonly thread: string | null } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES = new Set(["ready", "needs_input", "unreadable", "control"]);

function questionOf(raw: unknown): LanguageQuestion | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.prompt !== "string") return null;
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((option) => (isRecord(option) && typeof option.id === "string" && typeof option.label === "string" ? [{ id: option.id, label: option.label, ...(typeof option.detail === "string" ? { detail: option.detail } : {}), ...(option.recommended === true ? { recommended: true } : {}) }] : []))
    : [];
  return {
    id: raw.id,
    goal: typeof raw.goal === "number" ? raw.goal : -1,
    field: typeof raw.field === "string" ? raw.field : "",
    reason: (typeof raw.reason === "string" ? raw.reason : "AMOUNT_MISSING") as LanguageQuestion["reason"],
    prompt: raw.prompt,
    options: options.slice(0, 8),
    allowsText: raw.allowsText === true || options.length === 0,
    ...(typeof raw.placeholder === "string" ? { placeholder: raw.placeholder } : {}),
    purpose: raw.purpose !== false,
  };
}

/** A parse response, read defensively; null when it is not one. */
export function readingOf(body: unknown): SentenceReading | null {
  if (!isRecord(body) || typeof body.status !== "string" || !STATUSES.has(body.status)) return null;
  const chips = Array.isArray(body.chips)
    ? body.chips.flatMap((chip) => (isRecord(chip) && typeof chip.text === "string" && typeof chip.kind === "string" && Array.isArray(chip.span) ? [chip as unknown as LanguageChip] : []))
    : [];
  const questions = Array.isArray(body.questions) ? body.questions.flatMap((question) => questionOf(question) ?? []) : [];
  const assumptions = Array.isArray(body.assumptions)
    ? body.assumptions.flatMap((item) => (isRecord(item) && typeof item.label === "string" ? [{ goal: typeof item.goal === "number" ? item.goal : -1, field: typeof item.field === "string" ? item.field : "", label: item.label, material: item.material === true }] : []))
    : [];
  const warnings = Array.isArray(body.warnings) ? body.warnings.flatMap((item) => (isRecord(item) && typeof item.message === "string" ? [{ code: typeof item.code === "string" ? item.code : "NOTE", message: item.message }] : [])) : [];
  const goalKinds = Array.isArray(body.goals)
    ? body.goals.flatMap((goal) => {
        if (!isRecord(goal)) return [];
        const inner = isRecord(goal.goal) ? goal.goal : null;
        const kind = inner && typeof inner.kind === "string" ? inner.kind : typeof goal.t === "string" ? goal.t : null;
        const op = inner && typeof inner.op === "string" ? inner.op : null;
        return kind ? [op ?? kind] : [];
      })
    : [];
  return {
    status: body.status as SentenceReading["status"],
    locale: typeof body.locale === "string" ? body.locale : "en",
    chips,
    questions,
    pendingQuestions: typeof body.pendingQuestions === "number" ? body.pendingQuestions : 0,
    assumptions,
    warnings,
    canonical: typeof body.canonical === "string" ? body.canonical : null,
    thread: typeof body.thread === "string" ? body.thread : null,
    examples: Array.isArray(body.examples) ? body.examples.filter((item): item is string => typeof item === "string").slice(0, 5) : [],
    goalKinds,
    ...(body.plan === null ? { plan: null } : isRecord(body.plan) && typeof body.plan.text === "string" ? { plan: { text: body.plan.text, thread: typeof body.plan.thread === "string" ? body.plan.thread : null } } : {}),
  };
}

/** The questions of a planner `422 INTENT_CLARIFY` (id, prompt, field only: answered as text unless parse gives options). */
export function clarifyOf(error: unknown): { readonly questions: readonly LanguageQuestion[]; readonly thread: string | null; readonly message: string } | null {
  if (!(error instanceof ApiError) || error.code !== "INTENT_CLARIFY") return null;
  const details = error.details ?? {};
  const questions = Array.isArray(details.questions) ? details.questions.flatMap((question) => questionOf(question) ?? []) : [];
  return { questions, thread: typeof details.thread === "string" ? details.thread : null, message: error.message };
}

/** Examples the planner sent with a refusal (`INTENT_UNSUPPORTED`). */
export function examplesOf(error: unknown): string[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details?.examples)) return [];
  return (error.details.examples as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 4);
}

/** What the planner is sent for a sentence: its words and, when questions were answered, the signed thread. */
export interface PlannerInput {
  readonly text: string;
  readonly thread?: string;
}

/**
 * What the planner should read once the reader says `ready`: the reader's
 * `plan` (the typed words + the signed thread of the answers: the planner
 * re-reads them to the same goals). Readings that are not one-off moves
 * (`plan: null`: rules, questions) still go as words so the planner explains
 * where they belong. A server without `plan` gets the words with the ready
 * thread, or, without one, the canonical sentence (answers folded in).
 */
export function plannerInput(text: string, reading: SentenceReading, answered: number): PlannerInput | null {
  if (reading.status !== "ready") return null;
  const words = text.trim();
  if (reading.plan) return { text: reading.plan.text, ...(reading.plan.thread ? { thread: reading.plan.thread } : {}) };
  if (answered === 0) return { text: words };
  if (reading.thread) return { text: words, thread: reading.thread };
  if (reading.plan === null) return null;
  return reading.canonical ? { text: reading.canonical } : null;
}

/** Answers keep one entry per question (a new answer replaces the old one). */
export function withAnswer(answers: readonly LanguageAnswer[], answer: LanguageAnswer): LanguageAnswer[] {
  return [...answers.filter((item) => item.question !== answer.question), answer].slice(-12);
}

/* ------------------------------------------------------- trail notes */

export type WarningTag = "fake-price" | "unpriced" | "lookalike" | "unverified" | "mispriced" | "testnet" | "third-party" | "note";

export interface TaggedWarning {
  readonly text: string;
  readonly tag: WarningTag;
  /** Worth Ely's worried face (money could be lost or misread). */
  readonly serious: boolean;
}

const RULES: ReadonlyArray<{ readonly tag: WarningTag; readonly test: RegExp; readonly serious: boolean }> = [
  { tag: "fake-price", test: /fake price|more than the reference|less than the reference/iu, serious: true },
  { tag: "lookalike", test: /look-?alike|imitat|never routes/iu, serious: true },
  { tag: "mispriced", test: /mispriced/iu, serious: true },
  { tag: "unpriced", test: /unpriced|no (?:reference )?price|not priced|capped/iu, serious: true },
  { tag: "unverified", test: /not (?:in elyia's )?verified|unverified|not a verified token/iu, serious: true },
  { tag: "third-party", test: /third-party|unaudited|no public website|experiment|inferred/iu, serious: false },
  { tag: "testnet", test: /test prices|testnet tokens|testnet pool/iu, serious: false },
];

export const WARNING_LABEL: Readonly<Record<WarningTag, string>> = {
  "fake-price": "fake testnet price",
  unpriced: "unpriced token",
  lookalike: "look-alike",
  unverified: "unverified token",
  mispriced: "pools disagree",
  testnet: "testnet prices",
  "third-party": "third party",
  note: "note",
};

/** Planner warnings with a tag each, the serious ones first (stable within a tag). */
export function tagWarnings(warnings: readonly string[]): TaggedWarning[] {
  const tagged = [...new Set(warnings)].map((text) => {
    const rule = RULES.find((item) => item.test.test(text));
    return { text, tag: rule?.tag ?? "note", serious: rule?.serious ?? false };
  });
  return tagged.sort((a, b) => Number(b.serious) - Number(a.serious));
}

/* ------------------------------------------------------------ grade */

const PERP = /\b(long|short|perps?|twap|leverage)\b/iu;

/** A first grade from the words and the reader's goal kinds (the Rule Book grades the real plan). */
export function sentenceGradeOf(text: string, goalKinds: readonly string[] = []): Grade {
  const lev = /(\d+(?:\.\d+)?)\s*[x×]\b/iu.exec(text);
  const leverage = lev ? Number(lev[1]) : undefined;
  if (PERP.test(text) || leverage !== undefined || goalKinds.includes("trade")) return gradeFor({ kind: "perp", leverage });
  if (goalKinds.some((kind) => kind === "stake" || kind === "unstake") || /\b(stake|unstake|stakele)\b/iu.test(text)) return gradeFor({ kind: "stake" });
  if (goalKinds.includes("deliver") || /\bsend\b|\bgönder/iu.test(text)) return gradeFor({ kind: "send" });
  return gradeFor({ kind: "swap" });
}

/** Turkish or English, from the reader when it answered. */
export function looksTurkish(text: string): boolean {
  return /[çğıöşü]|'(?:ta|te|da|de|ı|i|u|ü|yi|yı|ye|ya)\b/iu.test(text);
}
