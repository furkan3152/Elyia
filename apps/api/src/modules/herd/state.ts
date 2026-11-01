/**
 * Herd platform state in the document store: settings, the admin audit log
 * and the WL tasks (seeded with the spec's three tasks on first use).
 */
import { DEFAULT_HERD_SETTINGS, type HerdAuditEntry, type HerdSettings, type HerdTask, type HerdTaskInput } from "@elyia/core/api/herd";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { randomHex } from "../ops/auth/crypto.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";

const AUDIT_TTL_MS = 400 * 24 * 60 * 60_000;

/** Every admin action lands here (and nothing else writes it). */
export async function audit(ctx: AppContext, by: string, action: string, detail: string): Promise<void> {
  const at = ctx.clock.now();
  const entry: HerdAuditEntry = { at: new Date(at).toISOString(), by: by.toLowerCase(), action, detail: detail.slice(0, 600) };
  await docs<HerdAuditEntry>(ctx, PLATFORM_COLLECTIONS.herdAudit).put(`${String(at).padStart(15, "0")}:${randomHex(4)}`, entry, { ttlMs: AUDIT_TTL_MS });
}

export async function auditLog(ctx: AppContext, limit = 100): Promise<HerdAuditEntry[]> {
  const rows: HerdAuditEntry[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await docs<HerdAuditEntry>(ctx, PLATFORM_COLLECTIONS.herdAudit).list({ limit: 1_000, ...(after ? { after } : {}) });
    rows.push(...page.map((row) => row.value));
    if (page.length < 1_000) break;
    after = page[page.length - 1]!.id;
  }
  return rows.reverse().slice(0, limit);
}

/* ------------------------------------------------------------ settings */

export async function herdSettings(ctx: AppContext): Promise<HerdSettings> {
  const doc = (await docs<HerdSettings>(ctx, PLATFORM_COLLECTIONS.herdSettings).get("global"))?.value;
  return { ...DEFAULT_HERD_SETTINGS, updatedAt: null, updatedBy: null, ...(doc ?? {}) };
}

export async function updateSettings(ctx: AppContext, by: string, patch: Partial<Pick<HerdSettings, "applicationsOpen" | "reapplyLimit" | "moveLimit">>): Promise<HerdSettings> {
  const current = await herdSettings(ctx);
  const next: HerdSettings = { ...current, ...patch, updatedAt: new Date(ctx.clock.now()).toISOString(), updatedBy: by };
  await docs<HerdSettings>(ctx, PLATFORM_COLLECTIONS.herdSettings).put("global", next);
  await audit(ctx, by, "settings", Object.entries(patch).map(([key, value]) => `${key}=${String(value)}`).join(", "));
  return next;
}

/* --------------------------------------------------------------- tasks */

/** The spec's tasks. URLs stay null here: the owner's links come from config (never invented). */
export const DEFAULT_TASKS: readonly (HerdTaskInput & { readonly id: string })[] = [
  { id: "task_share_card", kind: "share-card", label: "Share your WL application card on X", description: "Post your card (download it on this page) from your own X account, then paste the post's link.", required: true, points: 4, verification: "manual", evidence: "tweet-url", order: 1 },
  { id: "task_follow_x", kind: "follow-x", label: "Follow Elyia on X", description: "Follow the profile with the X handle you enter above.", required: true, points: 3, verification: "manual", evidence: "x-handle", order: 2 },
  { id: "task_engage_post", kind: "engage-post", label: "Engage with our post", description: "Reply to or quote the post, then paste the link to your reply or quote.", required: true, points: 3, verification: "manual", evidence: "tweet-url", order: 3 },
];

function taskOf(id: string, input: HerdTaskInput, at: number): HerdTask {
  return {
    id,
    kind: input.kind,
    label: input.label,
    description: input.description ?? null,
    url: input.url ?? null,
    required: input.required ?? true,
    points: input.points ?? 0,
    verification: input.verification ?? "manual",
    evidence: input.evidence ?? "none",
    active: input.active ?? true,
    order: input.order ?? 100,
    updatedAt: new Date(at).toISOString(),
  };
}

export async function listTasks(ctx: AppContext, options: { readonly activeOnly?: boolean } = {}): Promise<HerdTask[]> {
  const collection = docs<HerdTask>(ctx, PLATFORM_COLLECTIONS.herdTasks);
  let rows = (await collection.list({ limit: 200 })).map((row) => row.value);
  if (rows.length === 0 && (await collection.get("__seeded")) === null) {
    for (const task of DEFAULT_TASKS) await collection.compareAndSet(task.id, null, taskOf(task.id, task, ctx.clock.now()));
    await collection.put("__seeded", { seeded: true } as never);
    rows = (await collection.list({ limit: 200 })).map((row) => row.value);
  }
  rows = rows.filter((task) => typeof task.kind === "string");
  return rows.filter((task) => !options.activeOnly || task.active).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The task's link: its own, else the owner's configured profile / first engagement post, else null ("not configured"). */
export function taskUrl(ctx: AppContext, task: HerdTask): string | null {
  if (task.url) return task.url;
  if (task.kind === "follow-x") return ctx.config.herd.xProfileUrl;
  if (task.kind === "engage-post") return ctx.config.herd.engagementPostUrls[0] ?? null;
  return null;
}

export async function createTask(ctx: AppContext, by: string, input: HerdTaskInput): Promise<HerdTask> {
  const id = `task_${randomHex(6)}`;
  const task = taskOf(id, input, ctx.clock.now());
  await listTasks(ctx);
  await docs<HerdTask>(ctx, PLATFORM_COLLECTIONS.herdTasks).put(id, task);
  await audit(ctx, by, "task.create", `${id} ${task.kind} "${task.label}" ${task.points} pts ${task.required ? "required" : "optional"} ${task.verification}`);
  return task;
}

export async function updateTask(ctx: AppContext, by: string, id: string, patch: Partial<HerdTaskInput>): Promise<HerdTask> {
  const collection = docs<HerdTask>(ctx, PLATFORM_COLLECTIONS.herdTasks);
  await listTasks(ctx);
  const current = (await collection.get(id))?.value;
  if (!current || typeof current.kind !== "string") throw new ElyiaHttpError("NOT_FOUND", 404, "No such task.");
  const next: HerdTask = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: new Date(ctx.clock.now()).toISOString() } as HerdTask;
  await collection.put(id, next);
  await audit(ctx, by, "task.update", `${id} ${Object.keys(patch).join(", ")}`);
  return next;
}

export async function deleteTask(ctx: AppContext, by: string, id: string): Promise<boolean> {
  await listTasks(ctx);
  const removed = await docs<HerdTask>(ctx, PLATFORM_COLLECTIONS.herdTasks).delete(id);
  if (removed) await audit(ctx, by, "task.delete", id);
  return removed;
}
