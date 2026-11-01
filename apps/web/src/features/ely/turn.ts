/**
 * One Ely turn, folded from the chat stream's events (pure). The reducer
 * keeps every event's arrival time so the view can pace them (timeline.ts):
 * the deterministic planner answers in one burst, and the conversation
 * should still read as Ely surveying, then talking, then laying the card.
 */
import type { LanguageQuestion } from "@elyia/core/api/language";
import type { Proposal, RouteCard } from "@elyia/core/api/agent";

import type { ElyEvent } from "./events";

export interface Reading {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly at: number;
  /** null while the call is in flight. */
  readonly ok: boolean | null;
  readonly summary: string | null;
  readonly settledAt: number | null;
}

export interface TurnCard {
  readonly proposalId: string | null;
  readonly card: RouteCard;
  readonly at: number;
}

/**
 * The reader's questions for a turn that ended asking. They arrive in the
 * chat stream's `clarify` event (`via: "chat"`: the answers go back to
 * /v1/agent/chat); an older API without that event is asked through
 * /v1/intents/parse after the turn (`via: "reader"`).
 */
export interface ClarifyState {
  readonly status: "loading" | "ready" | "none";
  readonly via: "chat" | "reader";
  /** The sentence the questions are about (chat clarify: sent back with the answers). */
  readonly sentence: string | null;
  readonly at: number;
  readonly questions: readonly LanguageQuestion[];
  /** The reader's signed answer thread. */
  readonly thread: string | null;
  /** question id -> option id (or typed text, prefixed "text:"). */
  readonly picked: Readonly<Record<string, string>>;
  /** What was sent once every question was answered (the canonical sentence, or the picked labels). */
  readonly sent: string | null;
}

export interface UserTurn {
  readonly kind: "user";
  readonly id: string;
  readonly text: string;
  readonly at: number;
}

export interface ElyTurn {
  readonly kind: "ely";
  readonly id: string;
  readonly startedAt: number;
  readonly mode: "ai" | "deterministic" | null;
  readonly model: string | null;
  readonly readings: readonly Reading[];
  readonly text: string;
  /** Arrival of the first token. */
  readonly textAt: number | null;
  readonly notes: readonly { readonly text: string; readonly at: number }[];
  readonly drafts: readonly { readonly kind: string; readonly at: number }[];
  readonly proposals: readonly Proposal[];
  readonly cards: readonly TurnCard[];
  readonly doneAt: number | null;
  readonly stopReason: string | null;
  /** The server's thread id (signed-in turns are stored there). */
  readonly serverThreadId: string | null;
  readonly error: { readonly code: string; readonly message: string; readonly at: number } | null;
  readonly clarify: ClarifyState | null;
}

export type Turn = UserTurn | ElyTurn;

export function newElyTurn(id: string, at: number): ElyTurn {
  return { kind: "ely", id, startedAt: at, mode: null, model: null, readings: [], text: "", textAt: null, notes: [], drafts: [], proposals: [], cards: [], doneAt: null, stopReason: null, serverThreadId: null, error: null, clarify: null };
}

/** Folds one stream event into the turn. Events after `done` or an error are ignored. */
export function applyEvent(turn: ElyTurn, event: ElyEvent, at: number): ElyTurn {
  if (turn.doneAt !== null || turn.error !== null) return turn;
  switch (event.type) {
    case "thread":
      return { ...turn, mode: event.data.mode, model: event.data.model, serverThreadId: event.data.threadId ?? turn.serverThreadId };
    case "token":
      if (event.data.text === "") return turn;
      return { ...turn, text: turn.text + event.data.text, textAt: turn.textAt ?? at };
    case "tool_call":
      if (turn.readings.some((reading) => reading.id === event.data.id)) return turn;
      return { ...turn, readings: [...turn.readings, { id: event.data.id, name: event.data.name, input: event.data.input, at, ok: null, summary: null, settledAt: null }] };
    case "tool_result": {
      const known = turn.readings.some((reading) => reading.id === event.data.id);
      const settled = (reading: Reading): Reading => ({ ...reading, ok: event.data.ok, summary: event.data.summary, settledAt: at });
      return {
        ...turn,
        readings: known
          ? turn.readings.map((reading) => (reading.id === event.data.id ? settled(reading) : reading))
          : [...turn.readings, settled({ id: event.data.id, name: event.data.name, input: null, at, ok: null, summary: null, settledAt: null })],
      };
    }
    case "proposal":
      return { ...turn, proposals: [...turn.proposals.filter((proposal) => proposal.id !== event.data.id), event.data] };
    case "route_card":
      return { ...turn, cards: [...turn.cards, { proposalId: event.data.proposalId, card: event.data.card, at }] };
    case "note": {
      const draft = /^draft:([a-z-]+)$/u.exec(event.data.text);
      if (draft) return { ...turn, drafts: [...turn.drafts, { kind: draft[1]!, at }] };
      return { ...turn, notes: [...turn.notes, { text: event.data.text, at }] };
    }
    case "clarify": {
      const questions = event.data.questions.filter((question) => question.options.length > 0 || question.allowsText);
      return { ...turn, clarify: { status: questions.length > 0 ? "ready" : "none", via: "chat", sentence: event.data.sentence, at, questions, thread: event.data.thread, picked: {}, sent: null } };
    }
    case "done":
      return {
        ...turn,
        // The tokens are the text; `done.text` covers a turn whose tokens were lost.
        text: turn.text.trim() === "" ? event.data.text : turn.text,
        textAt: turn.textAt ?? (event.data.text ? at : null),
        doneAt: at,
        stopReason: event.data.stopReason,
        serverThreadId: event.data.threadId || turn.serverThreadId,
        readings: turn.readings.map((reading) => (reading.settledAt === null ? { ...reading, ok: false, summary: "no answer", settledAt: at } : reading)),
      };
    case "error":
      return { ...turn, error: { code: event.data.code, message: event.data.message, at } };
  }
}

/** The stream closed without `done` (network drop, server restart): say so instead of spinning forever. */
export function interrupted(turn: ElyTurn, at: number, message = "The connection to Ely dropped before the answer finished. Nothing was proposed or signed."): ElyTurn {
  if (turn.doneAt !== null || turn.error !== null) return turn;
  return { ...turn, error: { code: "STREAM_CLOSED", message, at } };
}

/** The route card a turn produced (the last one), with its proposal when one was made. */
export function primaryCard(turn: ElyTurn): { readonly card: RouteCard; readonly proposal: Proposal | null; readonly at: number } | null {
  const last = turn.cards.at(-1);
  if (last) return { card: last.card, proposal: last.proposalId ? (turn.proposals.find((proposal) => proposal.id === last.proposalId) ?? null) : null, at: last.at };
  const proposal = [...turn.proposals].reverse().find((entry) => entry.card !== null);
  return proposal?.card ? { card: proposal.card, proposal, at: turn.doneAt ?? turn.startedAt } : null;
}

/**
 * A turn that ended in a question (no card, no proposal) and whose stream
 * sent no `clarify` event: an older API, so the reader is asked for options.
 */
export function endsAsking(turn: ElyTurn): boolean {
  return turn.clarify === null && turn.doneAt !== null && turn.error === null && turn.cards.length === 0 && turn.proposals.length === 0 && /\?\s*$/u.test(turn.text.trim());
}

/** Planning tools: a route card is coming, so the panel can open on "Surveying the route…". */
export const PLANNING_TOOLS: ReadonlySet<string> = new Set(["plan_intent", "propose_intent"]);

export function planning(turn: ElyTurn): boolean {
  return turn.readings.some((reading) => PLANNING_TOOLS.has(reading.name));
}
