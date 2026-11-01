/** The language reader request behind clarify choices (`POST /v1/intents/parse`). */
import type { LanguageAnswer, LanguageQuestion, ParseIntentResponse } from "@elyia/core/api/language";

import { apiPost } from "../../lib/api";

export interface ClarifyReading {
  readonly status: ParseIntentResponse["status"];
  readonly questions: readonly LanguageQuestion[];
  readonly thread: string | null;
  readonly canonical: string | null;
}

export async function readSentence(text: string, options: { readonly answers?: readonly LanguageAnswer[]; readonly thread?: string | null; readonly account?: string | null; readonly signal?: AbortSignal } = {}): Promise<ClarifyReading> {
  const response = await apiPost<ParseIntentResponse>(
    "/v1/intents/parse",
    {
      text: text.slice(0, 500),
      ...(options.answers && options.answers.length > 0 ? { answers: options.answers.slice(0, 12) } : {}),
      ...(options.thread ? { thread: options.thread } : {}),
      ...(options.account ? { account: options.account } : {}),
    },
    { signal: options.signal, timeoutMs: 10_000 },
  );
  return { status: response.status, questions: response.questions ?? [], thread: response.thread ?? null, canonical: response.canonical ?? null };
}
