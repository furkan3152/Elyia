/**
 * Ask Ely's threads in this browser (pure helpers + parse). Threads live in
 * localStorage so a conversation survives a reload without an account; a
 * signed-in turn also carries the server's thread id so Ely keeps the
 * history server side. Parsing is strict and fails soft: a malformed entry
 * is dropped, never half-loaded.
 */
import { isProposal, isRouteCard } from "./events";
import { newElyTurn, type ElyTurn, type Turn } from "./turn";

export const THREADS_KEY = "elyia.ely.threads.v1";
export const MAX_THREADS = 30;
export const MAX_TURNS = 60;

export interface ChatThread {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The wallet the conversation is about (null: none yet). */
  readonly address: string | null;
  readonly turns: readonly Turn[];
}

/** A short title from the first message: whole words, at most `max` characters. */
export function titleFor(text: string, max = 44): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean || "New climb";
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/u, "")}…`;
}

/** The server thread id of the latest turn that has one (send it with the next message). */
export function serverThreadOf(thread: ChatThread): string | null {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index]!;
    if (turn.kind === "ely" && turn.serverThreadId) return turn.serverThreadId;
  }
  return null;
}

/** Newest first, capped. */
export function upsertThread(list: readonly ChatThread[], thread: ChatThread): ChatThread[] {
  const rest = list.filter((entry) => entry.id !== thread.id);
  return [{ ...thread, turns: thread.turns.slice(-MAX_TURNS) }, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
}

export interface ThreadGroup {
  readonly label: string;
  readonly threads: readonly ChatThread[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayStart(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Today / Yesterday / "Oct 29", newest first; `query` filters by title or any user message. */
export function groupThreads(list: readonly ChatThread[], now: number, query = ""): ThreadGroup[] {
  const q = query.trim().toLowerCase();
  const today = dayStart(now);
  const yesterday = dayStart(today - 1);
  const groups = new Map<string, ChatThread[]>();
  for (const thread of [...list].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (q && !thread.title.toLowerCase().includes(q) && !thread.turns.some((turn) => turn.kind === "user" && turn.text.toLowerCase().includes(q))) continue;
    const start = dayStart(thread.updatedAt);
    const date = new Date(thread.updatedAt);
    const label = start >= today ? "Today" : start >= yesterday ? "Yesterday" : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
  return [...groups.entries()].map(([label, threads]) => ({ label, threads }));
}

/* ------------------------------------------------------------ parsing */

type Rec = Readonly<Record<string, unknown>>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const str = (value: unknown): value is string => typeof value === "string";

function parseTurn(raw: unknown): Turn | null {
  if (!isRec(raw) || !str(raw.id)) return null;
  if (raw.kind === "user") return str(raw.text) && num(raw.at) ? { kind: "user", id: raw.id, text: raw.text.slice(0, 2_000), at: raw.at } : null;
  if (raw.kind !== "ely" || !num(raw.startedAt)) return null;
  const base = newElyTurn(raw.id, raw.startedAt);
  const readings = Array.isArray(raw.readings)
    ? raw.readings.filter((r): r is Rec => isRec(r) && str(r.id) && str(r.name) && num(r.at)).map((r) => ({ id: r.id as string, name: r.name as string, input: r.input ?? null, at: r.at as number, ok: typeof r.ok === "boolean" ? r.ok : false, summary: str(r.summary) ? r.summary : null, settledAt: num(r.settledAt) ? r.settledAt : (r.at as number) }))
    : [];
  const cards = Array.isArray(raw.cards) ? raw.cards.filter((c): c is Rec => isRec(c) && isRouteCard(c.card) && num(c.at)).map((c) => ({ proposalId: str(c.proposalId) ? c.proposalId : null, card: c.card as ElyTurn["cards"][number]["card"], at: c.at as number })) : [];
  const proposals = Array.isArray(raw.proposals) ? raw.proposals.filter(isProposal) : [];
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((n): n is Rec => isRec(n) && str(n.text) && num(n.at)).map((n) => ({ text: n.text as string, at: n.at as number })) : [];
  const drafts = Array.isArray(raw.drafts) ? raw.drafts.filter((n): n is Rec => isRec(n) && str(n.kind) && num(n.at)).map((n) => ({ kind: n.kind as string, at: n.at as number })) : [];
  const error = isRec(raw.error) && str(raw.error.message) ? { code: str(raw.error.code) ? raw.error.code : "AGENT_FAILED", message: raw.error.message, at: num(raw.error.at) ? raw.error.at : raw.startedAt } : null;
  const clarify =
    isRec(raw.clarify) && Array.isArray(raw.clarify.questions) && (raw.clarify.status === "ready" || raw.clarify.status === "none")
      ? {
          status: raw.clarify.status as "ready" | "none",
          at: num(raw.clarify.at) ? raw.clarify.at : raw.startedAt,
          questions: raw.clarify.questions.filter((q): q is Rec => isRec(q) && str(q.id) && str(q.prompt) && Array.isArray(q.options)) as never[],
          thread: str(raw.clarify.thread) ? raw.clarify.thread : null,
          picked: isRec(raw.clarify.picked) ? (Object.fromEntries(Object.entries(raw.clarify.picked).filter(([, v]) => str(v))) as Record<string, string>) : {},
          sent: str(raw.clarify.sent) ? raw.clarify.sent : null,
        }
      : null;
  const doneAt = num(raw.doneAt) ? raw.doneAt : null;
  return {
    ...base,
    mode: raw.mode === "ai" || raw.mode === "deterministic" ? raw.mode : null,
    model: str(raw.model) ? raw.model : null,
    readings,
    text: str(raw.text) ? raw.text.slice(0, 20_000) : "",
    textAt: num(raw.textAt) ? raw.textAt : null,
    notes,
    drafts,
    proposals,
    cards,
    // A turn saved mid-stream (tab closed) is shown as interrupted.
    doneAt,
    stopReason: str(raw.stopReason) ? raw.stopReason : null,
    serverThreadId: str(raw.serverThreadId) ? raw.serverThreadId : null,
    error: error ?? (doneAt === null ? { code: "STREAM_CLOSED", message: "This answer was interrupted before it finished. Nothing was proposed or signed.", at: raw.startedAt } : null),
    clarify,
  };
}

export function parseThreads(raw: string | null): ChatThread[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: ChatThread[] = [];
  for (const entry of data) {
    if (!isRec(entry) || !str(entry.id) || !str(entry.title) || !num(entry.createdAt) || !num(entry.updatedAt) || !Array.isArray(entry.turns)) continue;
    const turns = entry.turns.map(parseTurn).filter((turn): turn is Turn => turn !== null);
    out.push({ id: entry.id, title: entry.title.slice(0, 120), createdAt: entry.createdAt, updatedAt: entry.updatedAt, address: str(entry.address) && /^0x[0-9a-f]{40}$/u.test(entry.address) ? entry.address : null, turns });
  }
  return out.slice(0, MAX_THREADS);
}

/** What is written to storage: the clarify "loading" state is never persisted. */
export function serializeThreads(list: readonly ChatThread[]): string {
  return JSON.stringify(list.map((thread) => ({ ...thread, turns: thread.turns.map((turn) => (turn.kind === "ely" && turn.clarify?.status === "loading" ? { ...turn, clarify: null } : turn)) })));
}
