/**
 * Ely's memory per owner: goals, risk profile, target mix, gas floor, dust
 * threshold, locale; conversation threads; and the agent feed.
 */
import type { AgentMemory, FeedEntry, ThreadMessage, ThreadView } from "@elyia/core/api/agent";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { randomHex } from "../ops/auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";

export const MAX_THREAD_MESSAGES = 60;
const FEED_TTL_MS = 30 * 24 * 60 * 60_000;

export function defaultMemory(owner: string): AgentMemory {
  return { owner, goals: [], riskProfile: "balanced", targetMix: null, gasFloorHype: "0.05", dustUsd: 1, locale: "en", updatedAt: null };
}

interface MemoryDoc extends Omit<AgentMemory, "updatedAt"> {
  readonly updatedAt: number | null;
}

export async function memoryOf(ctx: AppContext, owner: string): Promise<AgentMemory> {
  const doc = (await docs<MemoryDoc>(ctx, PLATFORM_COLLECTIONS.agentMemory).get(`memory:${owner}`))?.value;
  return doc ? { ...defaultMemory(owner), ...doc, updatedAt: iso(doc.updatedAt) } : defaultMemory(owner);
}

export async function updateMemory(ctx: AppContext, owner: string, patch: Partial<Omit<AgentMemory, "owner" | "updatedAt">>): Promise<AgentMemory> {
  const current = await memoryOf(ctx, owner);
  if (patch.targetMix) {
    const total = Object.values(patch.targetMix.weights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 100) > 0.5) throw new ElyiaHttpError("INVALID_REQUEST", 400, `Target mix weights must sum to 100 (got ${total}).`);
  }
  const next: MemoryDoc = { ...current, ...patch, owner, goals: (patch.goals ?? current.goals).slice(0, 10), updatedAt: ctx.clock.now() };
  await docs<MemoryDoc>(ctx, PLATFORM_COLLECTIONS.agentMemory).put(`memory:${owner}`, next);
  return { ...next, updatedAt: iso(next.updatedAt) };
}

/* -------------------------------------------------------------- threads */

interface ThreadDoc {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ThreadMessage[];
}

function threadView(doc: ThreadDoc): ThreadView {
  return { id: doc.id, owner: doc.owner, title: doc.title, createdAt: new Date(doc.createdAt).toISOString(), updatedAt: new Date(doc.updatedAt).toISOString(), messages: doc.messages };
}

export async function threadOf(ctx: AppContext, owner: string, id: string): Promise<ThreadView | null> {
  const doc = (await docs<ThreadDoc>(ctx, PLATFORM_COLLECTIONS.agentThreads).get(`${owner}:${id}`))?.value;
  return doc ? threadView(doc) : null;
}

export async function listThreads(ctx: AppContext, owner: string): Promise<ThreadView[]> {
  return (await docs<ThreadDoc>(ctx, PLATFORM_COLLECTIONS.agentThreads).list({ prefix: `${owner}:`, limit: 200 })).map((doc) => threadView(doc.value)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function appendToThread(ctx: AppContext, owner: string, threadId: string | null, messages: readonly ThreadMessage[]): Promise<ThreadView> {
  const collection = docs<ThreadDoc>(ctx, PLATFORM_COLLECTIONS.agentThreads);
  const now = ctx.clock.now();
  const id = threadId ?? `thr_${randomHex(10)}`;
  const current = (await collection.get(`${owner}:${id}`))?.value;
  const first = messages.find((message) => message.role === "user")?.text ?? "Conversation";
  const doc: ThreadDoc = {
    id,
    owner,
    title: current?.title ?? first.slice(0, 60),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    messages: [...(current?.messages ?? []), ...messages].slice(-MAX_THREAD_MESSAGES),
  };
  await collection.put(`${owner}:${id}`, doc);
  return threadView(doc);
}

export async function deleteThread(ctx: AppContext, owner: string, id: string): Promise<boolean> {
  return docs<ThreadDoc>(ctx, PLATFORM_COLLECTIONS.agentThreads).delete(`${owner}:${id}`);
}

/* ----------------------------------------------------------------- feed */

export async function addFeed(ctx: AppContext, owner: string, entry: Omit<FeedEntry, "id" | "at">): Promise<FeedEntry> {
  const at = ctx.clock.now();
  const full: FeedEntry = { ...entry, id: `fd_${randomHex(8)}`, at: new Date(at).toISOString() };
  await docs<FeedEntry>(ctx, PLATFORM_COLLECTIONS.agentFeed).put(`${owner}:${String(at).padStart(15, "0")}:${full.id}`, full, { ttlMs: FEED_TTL_MS });
  return full;
}

export async function feedOf(ctx: AppContext, owner: string, limit = 50): Promise<FeedEntry[]> {
  const rows = await docs<FeedEntry>(ctx, PLATFORM_COLLECTIONS.agentFeed).list({ prefix: `${owner}:`, limit: 1_000 });
  return rows.map((row) => row.value).reverse().slice(0, limit);
}
