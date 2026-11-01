/**
 * Clarify (pure): when Ely ends a turn with a question, the chat stream's
 * `clarify` event carries the language reader's questions with options,
 * shown as choice chips. The answers go back to Ely with the same sentence
 * and the reader's signed thread, in one chat request. (An older API sends
 * no event; then `/v1/intents/parse` is asked, and its canonical sentence is
 * sent once ready.) Purpose questions (amounts, sides, recipients) are only
 * ever answered by the person: nothing is pre-picked.
 */
import type { LanguageAnswer, LanguageQuestion } from "@elyia/core/api/language";

/** `picked` (question id -> option id, or "text:<typed>") as reader answers, for the questions still open. */
export function answersOf(questions: readonly LanguageQuestion[], picked: Readonly<Record<string, string>>): LanguageAnswer[] {
  const out: LanguageAnswer[] = [];
  for (const question of questions) {
    const value = picked[question.id];
    if (value === undefined) continue;
    if (value.startsWith("text:")) out.push({ question: question.id, text: value.slice(5).slice(0, 80) });
    else out.push({ question: question.id, option: value });
  }
  return out;
}

/** Every open question has an answer. */
export function allAnswered(questions: readonly LanguageQuestion[], picked: Readonly<Record<string, string>>): boolean {
  return questions.length > 0 && questions.every((question) => picked[question.id] !== undefined);
}

/** A short label for a choice: the option's label, or the typed text. */
export function pickedLabel(question: LanguageQuestion, value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value.startsWith("text:")) return value.slice(5);
  return question.options.find((option) => option.id === value)?.label ?? value;
}

/** The picked answers as one short line for the user's bubble ("USDC · Elysium"). */
export function pickedSummary(questions: readonly LanguageQuestion[], picked: Readonly<Record<string, string>>): string {
  return questions
    .map((question) => pickedLabel(question, picked[question.id]))
    .filter((label): label is string => Boolean(label))
    .join(" · ");
}
