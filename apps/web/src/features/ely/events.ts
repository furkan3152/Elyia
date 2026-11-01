/**
 * The chat stream's events (`POST /v1/agent/chat`, contract in
 * @elyia/core/api/agent), validated before they reach the reducer: a
 * malformed or unknown event is dropped, never half-applied. Route cards and
 * proposals are checked for the fields the UI reads; everything they show is
 * rendered as text, never as markup.
 */
import { CHAT_STREAM_EVENTS, type ChatDoneEvent, type ChatThreadEvent, type ChatToolCallEvent, type ChatToolResultEvent, type Proposal, type RouteCard } from "@elyia/core/api/agent";

export interface RouteCardEvent {
  readonly proposalId: string | null;
  readonly card: RouteCard;
}

export interface NoteEvent {
  readonly text: string;
  /** Alert or automation drafts the turn produced (`draft:<kind>` notes). */
  readonly draft?: unknown;
}

export interface StreamErrorEvent {
  readonly code: string;
  readonly message: string;
}

export type ElyEvent =
  | { readonly type: "thread"; readonly data: ChatThreadEvent }
  | { readonly type: "token"; readonly data: { readonly text: string } }
  | { readonly type: "tool_call"; readonly data: ChatToolCallEvent }
  | { readonly type: "tool_result"; readonly data: ChatToolResultEvent }
  | { readonly type: "proposal"; readonly data: Proposal }
  | { readonly type: "route_card"; readonly data: RouteCardEvent }
  | { readonly type: "note"; readonly data: NoteEvent }
  | { readonly type: "done"; readonly data: ChatDoneEvent }
  | { readonly type: "error"; readonly data: StreamErrorEvent };

type Rec = Readonly<Record<string, unknown>>;

const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isArr = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A route card with every field the UI reads in the right shape. */
export function isRouteCard(value: unknown): value is RouteCard {
  if (!isRec(value) || !isStr(value.title)) return false;
  if (!isArr(value.steps) || !value.steps.every((step) => isRec(step) && isStr(step.network) && isStr(step.protocol) && isStr(step.title))) return false;
  if (!isArr(value.outputs) || !value.outputs.every((row) => isRec(row) && isStr(row.symbol) && isStr(row.expected) && isStr(row.minimum))) return false;
  if (!isArr(value.venues) || !value.venues.every((row) => isRec(row) && isStr(row.protocol) && isStr(row.expected) && typeof row.winner === "boolean")) return false;
  if (!strOrNull(value.feesUsd) || !strOrNull(value.notionalUsd)) return false;
  if (!isRec(value.policy) || !isStr(value.policy.decision) || !isArr(value.policy.reasons)) return false;
  if (!isArr(value.warnings) || !value.warnings.every(isStr)) return false;
  if (!(value.estimatedSeconds === null || typeof value.estimatedSeconds === "number")) return false;
  return true;
}

export function isProposal(value: unknown): value is Proposal {
  if (!isRec(value)) return false;
  return isStr(value.id) && isStr(value.title) && isStr(value.explanation) && isArr(value.actions) && value.actions.every(isRec) && (value.card === null || isRouteCard(value.card)) && isStr(value.status) && isStr(value.expiresAt);
}

/** Parses one SSE message (event name + JSON text) into a typed event, or null. */
export function parseElyEvent(name: string, raw: string): ElyEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(data)) return null;
  switch (name) {
    case CHAT_STREAM_EVENTS.thread:
      if (!strOrNull(data.threadId) || (data.mode !== "ai" && data.mode !== "deterministic")) return null;
      return { type: "thread", data: { threadId: data.threadId as string, mode: data.mode, model: isStr(data.model) ? data.model : null } };
    case CHAT_STREAM_EVENTS.token:
      return isStr(data.text) ? { type: "token", data: { text: data.text } } : null;
    case CHAT_STREAM_EVENTS.toolCall:
      return isStr(data.id) && isStr(data.name) ? { type: "tool_call", data: { id: data.id, name: data.name, input: data.input ?? null } } : null;
    case CHAT_STREAM_EVENTS.toolResult:
      return isStr(data.id) && isStr(data.name) && typeof data.ok === "boolean" ? { type: "tool_result", data: { id: data.id, name: data.name, ok: data.ok, summary: isStr(data.summary) ? data.summary : "" } } : null;
    case CHAT_STREAM_EVENTS.proposal:
      return isProposal(data) ? { type: "proposal", data } : null;
    case CHAT_STREAM_EVENTS.routeCard:
      return strOrNull(data.proposalId ?? null) && isRouteCard(data.card) ? { type: "route_card", data: { proposalId: (data.proposalId as string | null | undefined) ?? null, card: data.card } } : null;
    case CHAT_STREAM_EVENTS.note:
      return isStr(data.text) ? { type: "note", data: { text: data.text, ...(data.draft !== undefined ? { draft: data.draft } : {}) } } : null;
    case CHAT_STREAM_EVENTS.done:
      return isStr(data.text) ? { type: "done", data: { threadId: isStr(data.threadId) ? data.threadId : "", text: data.text, proposals: isArr(data.proposals) ? data.proposals.filter(isStr) : [], stopReason: isStr(data.stopReason) ? data.stopReason : "end_turn" } } : null;
    case CHAT_STREAM_EVENTS.error:
      return { type: "error", data: { code: isStr(data.code) ? data.code : "AGENT_FAILED", message: isStr(data.message) ? data.message : "Ely could not finish this turn." } };
    default:
      return null;
  }
}
