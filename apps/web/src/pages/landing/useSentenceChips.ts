import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../lib/api";
import { apiChips, sentenceChips, type SentenceChip } from "./model";

export interface SentenceReading {
  readonly chips: readonly SentenceChip[];
  /** "api" once POST /v1/intents/parse answered for this text, "local" otherwise. */
  readonly source: "api" | "local";
}

/** Set once the parse endpoint says it does not exist, so we stop asking this session. */
let parseUnavailable = false;

/**
 * Chips for the sentence being typed: local hints at once, replaced by the
 * API's own reading (POST /v1/intents/parse) when it answers within ~1.5 s.
 * Never blocks typing or Enter.
 */
export function useSentenceChips(text: string): SentenceReading {
  const local = useMemo(() => sentenceChips(text), [text]);
  const [remote, setRemote] = useState<{ readonly text: string; readonly chips: SentenceChip[] } | null>(null);
  useEffect(() => {
    const trimmed = text.trim();
    if (parseUnavailable || trimmed.length < 3) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiFetch<unknown>("/v1/intents/parse", { method: "POST", body: { text: trimmed.slice(0, 500) }, signal: controller.signal, timeoutMs: 1_500 })
        .then((body) => {
          const chips = apiChips(body);
          if (chips && chips.length > 0) setRemote({ text, chips });
        })
        .catch((error: unknown) => {
          const status = (error as { status?: number }).status;
          const code = (error as { code?: string }).code;
          if (status === 404 || code === "NOT_FOUND" || code === "NETWORK_ERROR") parseUnavailable = true;
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text]);
  if (remote && remote.text === text) return { chips: remote.chips, source: "api" };
  return { chips: local, source: "local" };
}
