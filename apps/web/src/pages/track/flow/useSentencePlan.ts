/**
 * A sentence, read and planned: the language reader for live chips and
 * questions (POST /v1/intents/parse, answers and the signed thread sent back
 * each turn), then the planner's dry run of the reading (POST /v1/intents
 * with the reader's `plan`: the words + the signed thread of the answers). One hook for the deck, ⌘K, the landing route card, the
 * Guide and the send ticket. Nothing here signs.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiPost } from "../../../lib/api";
import { plannerInput, readingOf, sentenceGradeOf, withAnswer, type LanguageAnswer, type LanguageQuestion, type SentenceReading } from "./sentence";
import { useFlowPlan, type FlowAsk } from "./useFlowPlan";

export interface SentencePlan {
  /** The reader's latest reading (null while the first one is on its way, or when the reader is offline). */
  readonly reading: SentenceReading | null;
  readonly readingPending: boolean;
  /** Chips of the latest reading that answered (kept while the next one is read, so the row never flickers). */
  readonly chips: SentenceReading["chips"];
  /** The reader could not be reached: chips stay local, the planner is asked directly. */
  readonly readerOffline: boolean;
  /** What the planner is asked to plan (null until the reading is ready). */
  readonly ask: FlowAsk | null;
  readonly plan: ReturnType<typeof useFlowPlan>;
  readonly answers: readonly LanguageAnswer[];
  readonly answer: (answer: LanguageAnswer) => void;
  readonly resetAnswers: () => void;
}

const NO_ANSWERS: readonly LanguageAnswer[] = [];
const NO_CHIPS: SentenceReading["chips"] = [];

export interface SentencePlanOptions {
  /** Connected (or watched) 0x address: balance-aware questions and a plan for that account. */
  readonly account?: string | null;
  /** Read only (chips + questions): skip the planner (⌘K before Enter, the landing card while typing). */
  readonly planner?: boolean;
  /** Debounce before the reader is asked, ms. */
  readonly delayMs?: number;
}

export function useSentencePlan(text: string, options: SentencePlanOptions = {}): SentencePlan {
  const { account = null, planner = true, delayMs = 320 } = options;
  const trimmed = text.trim().slice(0, 500);
  const [settled, setSettled] = useState(trimmed);
  // Answers belong to the sentence they answered: new words start a new conversation.
  const [answered, setAnswered] = useState<{ readonly text: string; readonly list: readonly LanguageAnswer[] }>({ text: trimmed, list: [] });
  const answers = answered.text === settled ? answered.list : NO_ANSWERS;
  // The signed thread of the last turn (it carries earlier answers, never the words), per sentence.
  const thread = useRef<{ text: string; token: string | null }>({ text: settled, token: null });

  useEffect(() => {
    if (delayMs === 0) {
      const frame = window.requestAnimationFrame(() => setSettled(trimmed));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setSettled(trimmed), delayMs);
    return () => window.clearTimeout(timer);
  }, [trimmed, delayMs]);

  const read = useQuery({
    queryKey: ["intent-parse", settled, answers, account?.toLowerCase() ?? null],
    queryFn: async ({ signal }) => {
      const token = thread.current.text === settled && answers.length > 0 ? thread.current.token : null;
      const body = await apiPost<unknown>(
        "/v1/intents/parse",
        { text: settled, ...(answers.length > 0 ? { answers } : {}), ...(token ? { thread: token } : {}), ...(account && /^0x[0-9a-fA-F]{40}$/u.test(account) ? { account } : {}) },
        { signal, timeoutMs: 8_000 },
      );
      const reading = readingOf(body);
      if (!reading) throw new ApiError({ code: "INVALID_RESPONSE", message: "The language reader sent something Elyia could not read." });
      if (reading.thread) thread.current = { text: settled, token: reading.thread };
      return { text: settled, reading };
    },
    enabled: settled.length >= 3,
    retry: 0,
    staleTime: 60_000,
    // While the next words are read, the last chips stay (never trusted for the plan: see `reading`).
    placeholderData: keepPreviousData,
  });

  const offline = read.isError && read.error instanceof ApiError && (read.error.code === "NETWORK_ERROR" || read.error.code === "TIMEOUT" || read.error.status === 404);
  const fresh = read.data && read.data.text === settled && !read.isPlaceholderData ? read.data.reading : null;
  const reading = settled.length >= 3 ? fresh : null;
  const chips = trimmed.length >= 3 ? (read.data?.reading.chips ?? NO_CHIPS) : NO_CHIPS;
  const input = reading ? plannerInput(settled, reading, answers.length) : offline && settled.length >= 3 ? { text: settled } : null;
  const sendText = input?.text ?? null;
  const sendThread = input?.thread ?? null;
  const goalKinds = reading?.goalKinds;
  const ask: FlowAsk | null = useMemo(() => {
    if (!planner || !sendText) return null;
    // The key carries the answers (not the token, which is re-signed every turn) so a new answer re-plans.
    return { key: `text:${sendText}|${JSON.stringify(answers)}`, sentence: settled, grade: sentenceGradeOf(settled, goalKinds ?? []), actions: [], text: sendText, ...(sendThread ? { thread: sendThread } : {}) };
  }, [planner, sendText, sendThread, settled, goalKinds, answers]);
  const plan = useFlowPlan(ask, account);

  return {
    reading,
    readingPending: read.isFetching,
    chips,
    readerOffline: offline,
    ask,
    plan,
    answers,
    answer: (next) => setAnswered((previous) => ({ text: settled, list: withAnswer(previous.text === settled ? previous.list : [], next) })),
    resetAnswers: () => {
      thread.current = { text: settled, token: null };
      setAnswered({ text: settled, list: [] });
    },
  };
}

/** Questions to show now: the reader's (with options) first, else the planner's own 422. */
export function openQuestions(sentence: SentencePlan): readonly LanguageQuestion[] {
  if (sentence.reading?.status === "needs_input") return sentence.reading.questions;
  if (sentence.plan.data?.kind === "clarify") return sentence.plan.data.questions;
  return [];
}

