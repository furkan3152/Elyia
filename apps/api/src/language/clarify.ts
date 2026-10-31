/**
 * Questions instead of refusals. A frame that meets a slot only the person
 * can fill calls `ask(...)`: if the request already answers that question
 * (by its deterministic id) the answer comes back; otherwise the question is
 * recorded and the frame continues with a partial reading.
 *
 * Purpose questions (the person's goal) never carry a recommendation;
 * means questions may recommend one option.
 */
import { LANGUAGE_LIMITS, PURPOSE_REASONS, type LanguageAnswer, type LanguageAssumption, type LanguageOption, type LanguageQuestion, type LanguageReason, type LanguageWarning } from "@elyia/core/api/language";
import type { Locale } from "./numbers.js";

export interface AskSpec {
  readonly id: string;
  readonly goal: number;
  readonly field: string;
  readonly reason: LanguageReason;
  readonly prompt: { readonly en: string; readonly tr: string };
  readonly options: ReadonlyArray<{ readonly id: string; readonly en: string; readonly tr: string; readonly detail?: { readonly en: string; readonly tr: string }; readonly recommended?: boolean }>;
  readonly allowsText?: boolean;
  readonly placeholder?: { readonly en: string; readonly tr: string };
}

export type Answer = { readonly option: string; readonly text?: undefined } | { readonly option?: undefined; readonly text: string };

const PURPOSE = new Set<LanguageReason>(PURPOSE_REASONS);

export class Clarifier {
  readonly questions: LanguageQuestion[] = [];
  readonly warnings: LanguageWarning[] = [];
  readonly assumptions: LanguageAssumption[] = [];
  /** Answers that matched a question asked this turn (they go into the thread). */
  readonly used = new Map<string, LanguageAnswer>();
  private readonly answers: ReadonlyMap<string, LanguageAnswer>;

  constructor(readonly locale: Locale, answers: readonly LanguageAnswer[]) {
    this.answers = new Map(answers.map((answer) => [answer.question, answer]));
  }

  /** The answer to `spec.id` if one was given and is valid; otherwise records the question and returns null. */
  ask(spec: AskSpec): Answer | null {
    const given = this.answers.get(spec.id);
    if (given) {
      if (given.option !== undefined && spec.options.some((option) => option.id === given.option)) {
        this.used.set(spec.id, given);
        return { option: given.option };
      }
      if (given.text !== undefined && spec.allowsText && given.text.trim().length > 0) {
        this.used.set(spec.id, given);
        return { text: given.text.trim() };
      }
    }
    if (!this.questions.some((question) => question.id === spec.id)) this.questions.push(this.render(spec));
    return null;
  }

  /** Records an answer that turned out unusable (a typed amount that does not parse): the question is asked again. */
  reject(spec: AskSpec, message: { readonly en: string; readonly tr: string }): void {
    this.used.delete(spec.id);
    this.warn("ANSWER_INVALID", message);
    if (!this.questions.some((question) => question.id === spec.id)) this.questions.push(this.render(spec));
  }

  warn(code: string, message: { readonly en: string; readonly tr: string }, span?: readonly [number, number]): void {
    if (this.warnings.some((warning) => warning.code === code && warning.message === message[this.locale])) return;
    this.warnings.push({ code, message: message[this.locale], ...(span ? { span } : {}) });
  }

  assume(goal: number, field: string, label: { readonly en: string; readonly tr: string }, material: boolean): void {
    if (this.assumptions.some((entry) => entry.goal === goal && entry.field === field)) return;
    this.assumptions.push({ goal, field, label: label[this.locale], material });
  }

  private render(spec: AskSpec): LanguageQuestion {
    const purpose = PURPOSE.has(spec.reason);
    const options: LanguageOption[] = spec.options.slice(0, LANGUAGE_LIMITS.maxOptions).map((option) => ({
      id: option.id,
      label: option[this.locale],
      ...(option.detail ? { detail: option.detail[this.locale] } : {}),
      ...(option.recommended && !purpose ? { recommended: true } : {}),
    }));
    return {
      id: spec.id,
      goal: spec.goal,
      field: spec.field,
      reason: spec.reason,
      prompt: spec.prompt[this.locale],
      options,
      allowsText: spec.allowsText === true,
      ...(spec.placeholder ? { placeholder: spec.placeholder[this.locale] } : {}),
      purpose,
    };
  }
}

/** Both-locale text helper. */
export function t(en: string, tr: string): { readonly en: string; readonly tr: string } {
  return { en, tr };
}
