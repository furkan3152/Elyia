/**
 * Clarify (pure + one request): when Ely ends a turn with a question, the
 * language reader (`POST /v1/intents/parse`) is asked the same sentence; its
 * questions come back with options, shown as choice chips. Answers go back
 * with the reader's signed thread; once the reading is `ready`, its
 * canonical sentence (which re-reads to the same goals) is what Ely is sent
 * next. Purpose questions (amounts, sides, recipients) are only ever
 * answered by the person: nothing is pre-picked.
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
