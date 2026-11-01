/**
 * Ask Ely's conversation store: threads (persisted in this browser), the
 * active one, and the streaming side effects. A turn keeps streaming when
 * you leave the page; coming back shows where it got to. Sending never
 * signs anything: Ely answers with readings, text and route cards; the
 * wallet signs a card only when the person presses its button.
 */
import { create } from "zustand";

import { ApiError, describeError } from "../../lib/api";
import { allAnswered, answersOf } from "./clarify";
import { readSentence } from "./clarifyApi";
import { streamChat } from "./client";
import { THREADS_KEY, parseThreads, serializeThreads, serverThreadOf, titleFor, upsertThread, type ChatThread } from "./threads";
import { applyEvent, endsAsking, interrupted, newElyTurn, type ElyTurn, type Turn } from "./turn";

function uid(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/gu, "").slice(0, 16) : Math.random().toString(16).slice(2, 18);
  return `${prefix}_${random}`;
}

function load(): ChatThread[] {
  try {
    return typeof localStorage === "undefined" ? [] : parseThreads(localStorage.getItem(THREADS_KEY));
  } catch {
    return [];
  }
}

interface ChatState {
  readonly threads: readonly ChatThread[];
  readonly activeId: string | null;
  /** Thread ids with a turn streaming. */
  readonly live: Readonly<Record<string, true>>;
  setActive(id: string | null): void;
  remove(id: string): void;
}

export const useChatStore = create<ChatState>()((set) => ({
  threads: load(),
  activeId: null,
  live: {},
  setActive(id) {
    set({ activeId: id });
  },
  remove(id) {
    controllers.get(id)?.abort();
    set((state) => ({ threads: state.threads.filter((thread) => thread.id !== id), activeId: state.activeId === id ? null : state.activeId }));
  },
}));

const controllers = new Map<string, AbortController>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useChatStore.subscribe((state, previous) => {
  if (state.threads === previous.threads) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(THREADS_KEY, serializeThreads(useChatStore.getState().threads));
    } catch {
      // quota or private mode: the conversation lives in memory only
    }
  }, 400);
});

function patchThread(threadId: string, fn: (thread: ChatThread) => ChatThread) {
  useChatStore.setState((state) => {
    const thread = state.threads.find((entry) => entry.id === threadId);
    if (!thread) return state;
    return { threads: upsertThread(state.threads, fn(thread)) };
  });
}

function patchTurn(threadId: string, turnId: string, fn: (turn: ElyTurn) => ElyTurn) {
  patchThread(threadId, (thread) => ({ ...thread, turns: thread.turns.map((turn) => (turn.kind === "ely" && turn.id === turnId ? fn(turn) : turn)) }));
}

export function activeThread(state: Pick<ChatState, "threads" | "activeId">): ChatThread | null {
  return state.activeId ? (state.threads.find((thread) => thread.id === state.activeId) ?? null) : null;
}

export interface SendContext {
  /** The wallet the conversation is about (connected, watched, or the labelled sample). */
  readonly address: string;
  /** Session token for that wallet, when signed in (proposals and stored threads). */
  readonly session: string | null;
}

/** Starts a new thread when none is active. Returns the thread id. */
export function sendMessage(text: string, context: SendContext): string | null {
  const message = text.trim().slice(0, 2_000);
  if (!message) return null;
  const state = useChatStore.getState();
  let thread = activeThread(state);
  const now = Date.now();
  if (thread && state.live[thread.id]) return thread.id;
  if (!thread) {
    thread = { id: uid("t"), title: titleFor(message), createdAt: now, updatedAt: now, address: context.address.toLowerCase(), turns: [] };
  }
  const user: Turn = { kind: "user", id: uid("u"), text: message, at: now };
  const ely = newElyTurn(uid("e"), now);
  const serverThread = context.session ? serverThreadOf(thread) : null;
  const next: ChatThread = { ...thread, updatedAt: now, address: thread.address ?? context.address.toLowerCase(), turns: [...thread.turns, user, ely] };
  const threadId = next.id;
  useChatStore.setState((current) => ({ threads: upsertThread(current.threads, next), activeId: threadId, live: { ...current.live, [threadId]: true } }));

  const controller = new AbortController();
  controllers.set(threadId, controller);
  void (async () => {
    try {
      await streamChat({
        request: { message, address: context.address, ...(serverThread ? { threadId: serverThread } : {}) },
        session: context.session,
        signal: controller.signal,
        onEvent: (event) => patchTurn(threadId, ely.id, (turn) => applyEvent(turn, event, Date.now())),
      });
      patchTurn(threadId, ely.id, (turn) => interrupted(turn, Date.now()));
    } catch (error) {
      const aborted = controller.signal.aborted;
      const why = aborted
        ? "Stopped. Nothing was proposed or signed."
        : error instanceof ApiError && error.code === "NETWORK_ERROR"
          ? "Ely could not reach the Elyia API. Check your connection, or that the API is running; nothing was sent."
          : describeError(error);
      patchTurn(threadId, ely.id, (turn) => interrupted(turn, Date.now(), why));
    } finally {
      controllers.delete(threadId);
      useChatStore.setState((current) => {
        const live = { ...current.live };
        delete live[threadId];
        return { live };
      });
    }
    const finished = useChatStore.getState().threads.find((entry) => entry.id === threadId)?.turns.find((turn): turn is ElyTurn => turn.kind === "ely" && turn.id === ely.id);
    if (finished && endsAsking(finished)) void askReader(threadId, ely.id, message, context.address);
  })();
  return threadId;
}

/** Stops the streaming turn of a thread. */
export function stopThread(threadId: string): void {
  controllers.get(threadId)?.abort();
}

async function askReader(threadId: string, turnId: string, sentence: string, account: string) {
  patchTurn(threadId, turnId, (turn) => ({ ...turn, clarify: { status: "loading", at: Date.now(), questions: [], thread: null, picked: {}, sent: null } }));
  try {
    const reading = await readSentence(sentence, { account });
    const questions = reading.status === "needs_input" ? reading.questions.filter((question) => question.options.length > 0 || question.allowsText) : [];
    patchTurn(threadId, turnId, (turn) => ({ ...turn, clarify: { status: questions.length > 0 ? "ready" : "none", at: Date.now(), questions, thread: reading.thread, picked: {}, sent: null } }));
  } catch {
    patchTurn(threadId, turnId, (turn) => ({ ...turn, clarify: { status: "none", at: Date.now(), questions: [], thread: null, picked: {}, sent: null } }));
  }
}

function sentenceBefore(thread: ChatThread, turnId: string): string | null {
  const index = thread.turns.findIndex((turn) => turn.id === turnId);
  for (let i = index - 1; i >= 0; i -= 1) {
    const turn = thread.turns[i]!;
    if (turn.kind === "user") return turn.text;
  }
  return null;
}

/**
 * One tapped choice (option id, or "text:<typed>"). When every open question
 * has an answer the reader reads the sentence again; once ready, its
 * canonical sentence is sent to Ely as the next message.
 */
export async function answerClarify(threadId: string, turnId: string, questionId: string, value: string, context: SendContext): Promise<void> {
  patchTurn(threadId, turnId, (turn) => (turn.clarify ? { ...turn, clarify: { ...turn.clarify, picked: { ...turn.clarify.picked, [questionId]: value } } } : turn));
  const thread = useChatStore.getState().threads.find((entry) => entry.id === threadId);
  const turn = thread?.turns.find((entry): entry is ElyTurn => entry.kind === "ely" && entry.id === turnId);
  const clarify = turn?.clarify;
  if (!thread || !clarify || clarify.sent || !allAnswered(clarify.questions, clarify.picked)) return;
  const sentence = sentenceBefore(thread, turnId);
  if (!sentence) return;
  try {
    const reading = await readSentence(sentence, { answers: answersOf(clarify.questions, clarify.picked), thread: clarify.thread, account: context.address });
    if (reading.status === "ready" && reading.canonical) {
      patchTurn(threadId, turnId, (entry) => (entry.clarify ? { ...entry, clarify: { ...entry.clarify, sent: reading.canonical } } : entry));
      sendMessage(reading.canonical, context);
      return;
    }
    if (reading.status === "needs_input" && reading.questions.length > 0) {
      // The next questions (the reader asks at most two at a time); earlier answers ride in its thread.
      patchTurn(threadId, turnId, (entry) => (entry.clarify ? { ...entry, clarify: { ...entry.clarify, questions: reading.questions, thread: reading.thread, picked: {}, at: Date.now() } } : entry));
      return;
    }
    patchTurn(threadId, turnId, (entry) => ({ ...entry, notes: [...entry.notes, { text: "The reader could not finish the sentence with those answers. Type it again in your own words.", at: Date.now() }] }));
  } catch (error) {
    patchTurn(threadId, turnId, (entry) => ({ ...entry, notes: [...entry.notes, { text: `The reader is not answering (${describeError(error)}). Type the details instead.`, at: Date.now() }] }));
  }
}
