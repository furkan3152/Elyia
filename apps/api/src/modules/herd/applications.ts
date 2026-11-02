/**
 * WL applications. Rules:
 * - one application per wallet; the wallet is the SIWE session's address;
 * - an X handle belongs to one wallet at a time (case-insensitive);
 * - rate limits per wallet (6/h) and per coarse network hash (60/day);
 * - a rejected applicant may re-apply `reapplyLimit` times (default 1);
 * - a wallet change is two-step: the old wallet starts a move, the new
 *   wallet accepts it (`moveLimit` per application, default 1, refused once
 *   the old wallet minted);
 * - IP and device signals are stored only as keyed hashes (coarse: IPv4 /24,
 *   IPv6 /48) and only surface as sybil flags.
 */
import { DEFAULT_HERD_SETTINGS, HERD_APPLICATION_STATUSES, normalizeXHandle, parseXStatusUrl, type HerdApplication, type HerdApplicationStatus, type HerdApplicationsQuery, type HerdApplicationsResponse, type HerdApplyRequest, type HerdMeResponse, type HerdTask, type HerdTaskCheck, type HerdUsageScore } from "@elyia/core/api/herd";
import { keccak256, toHex } from "viem";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError, retryAfterHeader, retryAfterSeconds } from "../../http/errors.js";
import { hmacHex, purposeKey, randomHex } from "../ops/auth/crypto.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { herdNetwork, herdRecord, mintedBy } from "./chain.js";
import { herdSettings, listTasks, audit } from "./state.js";
import { scoreFromFacts, sybilFlags, usageFacts, type UsageFacts } from "./score.js";

export interface ApplicationDoc extends HerdApplication {
  readonly ipHash: string | null;
  readonly deviceHash: string | null;
  readonly moves: number;
  readonly facts: UsageFacts | null;
}

interface HandleDoc {
  readonly wallet: string;
  readonly previous: readonly string[];
}

interface SeenDoc {
  readonly wallets: readonly string[];
}

interface MoveDoc {
  readonly from: string;
  readonly to: string;
  readonly expiresAt: number;
}

export const MOVE_TTL_MS = 30 * 60_000;
/** Attempts per wallet per hour, and per coarse network hash per day (shared networks: generous, and flagged instead). */
export const APPLY_LIMITS = { perWalletHour: 6, perNetworkDay: 60 };

const applications = (ctx: AppContext) => docs<ApplicationDoc>(ctx, PLATFORM_COLLECTIONS.herdApplications);
const handles = (ctx: AppContext) => docs<HandleDoc>(ctx, PLATFORM_COLLECTIONS.herdHandles);
const seen = (ctx: AppContext) => docs<SeenDoc>(ctx, PLATFORM_COLLECTIONS.herdSeen);
const moves = (ctx: AppContext) => docs<MoveDoc>(ctx, PLATFORM_COLLECTIONS.herdMoves);

export function referralOf(wallet: string): string {
  return keccak256(toHex(wallet.toLowerCase())).slice(2, 10);
}

/** IPv4 /24 or IPv6 /48, then a keyed hash: coarse and not reversible without the server secret. */
export function coarseIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const value = ip.replace(/^::ffff:/u, "");
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(value)) return value.split(".").slice(0, 3).join(".");
  if (value.includes(":")) return value.split(":").slice(0, 3).join(":");
  return value;
}

function hashSignal(ctx: AppContext, kind: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return hmacHex(purposeKey(ctx, `herd-${kind}`), value).slice(0, 32);
}

export function view(doc: ApplicationDoc): HerdApplication {
  const { ipHash: _ip, deviceHash: _device, moves: _moves, facts: _facts, ...rest } = doc;
  return rest;
}

/* ---------------------------------------------------------- evidence */

export function checkEvidence(task: HerdTask, raw: string | undefined, handle: string): HerdTaskCheck {
  const evidence = raw?.trim() ? raw.trim().slice(0, 400) : null;
  if (task.evidence === "none") return { taskId: task.id, evidence: null, state: "submitted", detail: null };
  if (task.evidence === "x-handle") return { taskId: task.id, evidence: `@${handle}`, state: "submitted", detail: task.verification === "manual" ? "An admin reviews it." : null };
  if (!evidence) return { taskId: task.id, evidence: null, state: "missing", detail: "Not provided." };
  if (task.evidence === "tweet-url") {
    const post = parseXStatusUrl(evidence);
    if (!post) return { taskId: task.id, evidence, state: "failed", detail: "Expected a link to an X post (https://x.com/<you>/status/<id>)." };
    if (post.handle !== handle) return { taskId: task.id, evidence, state: "failed", detail: `The post is by @${post.handle}, not by @${handle}.` };
    return { taskId: task.id, evidence, state: "submitted", detail: task.verification === "manual" ? "An admin reviews it." : null };
  }
  if (task.evidence === "post-url") {
    if (!/^https:\/\/[^\s]+$/u.test(evidence)) return { taskId: task.id, evidence, state: "failed", detail: "Expected an https link." };
    return { taskId: task.id, evidence, state: "submitted", detail: null };
  }
  return { taskId: task.id, evidence, state: "submitted", detail: null };
}

function taskPoints(tasks: readonly HerdTask[], checks: readonly HerdTaskCheck[]): { points: number; max: number } {
  let points = 0;
  let max = 0;
  for (const task of tasks) {
    max += task.points;
    const check = checks.find((entry) => entry.taskId === task.id);
    if (check && (check.state === "submitted" || check.state === "verified")) points += task.points;
  }
  return { points, max };
}

/* --------------------------------------------------------------- score */

async function nonceOf(ctx: AppContext, wallet: string): Promise<number | null> {
  const network = herdNetwork(ctx);
  if (!ctx.chains.isAvailable(network)) return null;
  try {
    return await ctx.chains.client(network).getTransactionCount({ address: wallet as `0x${string}` });
  } catch {
    return null;
  }
}

async function sharedCount(ctx: AppContext, key: string | null, wallet: string): Promise<number> {
  if (!key) return 0;
  return ((await seen(ctx).get(key))?.value.wallets ?? []).filter((other) => other !== wallet).length;
}

async function remember(ctx: AppContext, key: string | null, wallet: string): Promise<void> {
  if (!key) return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await seen(ctx).get(key);
    const wallets = current?.value.wallets ?? [];
    if (wallets.includes(wallet)) return;
    if (await seen(ctx).compareAndSet(key, current?.version ?? null, { wallets: [...wallets, wallet].slice(-200) })) return;
  }
}

export async function scoreApplication(ctx: AppContext, doc: Pick<ApplicationDoc, "wallet" | "tasks" | "ipHash" | "deviceHash" | "xHandle" | "movedFrom" | "flagsCleared">, tasks?: readonly HerdTask[]): Promise<{ score: HerdUsageScore; flags: ApplicationDoc["flags"]; facts: UsageFacts }> {
  const active = tasks ?? (await listTasks(ctx, { activeOnly: true }));
  const facts = await usageFacts(ctx, doc.wallet, taskPoints(active, doc.tasks));
  const handleDoc = doc.xHandle ? (await handles(ctx).get(doc.xHandle))?.value : null;
  const flags = sybilFlags({
    nonce: await nonceOf(ctx, doc.wallet),
    sharedIp: await sharedCount(ctx, doc.ipHash ? `ip:${doc.ipHash}` : null, doc.wallet),
    sharedDevice: await sharedCount(ctx, doc.deviceHash ? `dev:${doc.deviceHash}` : null, doc.wallet),
    handleReused: Boolean(handleDoc?.previous.some((wallet) => wallet !== doc.wallet && wallet !== doc.movedFrom)),
    usage: facts,
    movedFrom: doc.movedFrom,
  });
  return { score: scoreFromFacts(facts, ctx.clock.now(), flags, doc.flagsCleared), flags, facts };
}

/* --------------------------------------------------------------- apply */

async function limit(ctx: AppContext, key: string, max: number, windowMs: number, what: string): Promise<void> {
  const window = Math.floor(ctx.clock.now() / windowMs);
  const count = await ctx.store.counters("herd_limits").increment(`${key}:${window}`, 1, { ttlMs: windowMs * 2 });
  if (count > max) {
    const seconds = retryAfterSeconds(((window + 1) * windowMs - ctx.clock.now()) / 1000, 86_400);
    throw new ElyiaHttpError("RATE_LIMITED", 429, `Too many ${what}. Retry in ${seconds} s.`, { max }, { headers: retryAfterHeader(seconds, 86_400) });
  }
}

async function claimHandle(ctx: AppContext, handle: string, wallet: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await handles(ctx).get(handle);
    if (current && current.value.wallet && current.value.wallet !== wallet) throw new ElyiaHttpError("X_HANDLE_TAKEN", 409, `@${handle} is already on another wallet's application. One X account, one application.`);
    if (current?.value.wallet === wallet) return;
    const previous = current?.value.previous ?? [];
    if (await handles(ctx).compareAndSet(handle, current?.version ?? null, { wallet, previous: [...new Set([...previous, wallet])].slice(-20) })) return;
  }
  throw new ElyiaHttpError("CONFLICT", 409, "The handle changed while applying. Retry.");
}

async function releaseHandle(ctx: AppContext, handle: string, wallet: string): Promise<void> {
  const current = await handles(ctx).get(handle);
  if (current?.value.wallet === wallet) await handles(ctx).put(handle, { wallet: "", previous: current.value.previous });
}

export interface ApplyInput extends HerdApplyRequest {
  readonly sessionWallet: string;
  readonly ip: string | null;
}

export async function apply(ctx: AppContext, input: ApplyInput): Promise<HerdApplication> {
  const wallet = input.sessionWallet.toLowerCase();
  if (input.wallet.toLowerCase() !== wallet) throw new ElyiaHttpError("WALLET_MISMATCH", 403, "Apply with the wallet you signed in with. To use another wallet, sign in with it (or move your application).");
  const settings = await herdSettings(ctx);
  if (!settings.applicationsOpen) throw new ElyiaHttpError("APPLICATIONS_CLOSED", 409, "WL applications are closed right now.");
  const ipKey = coarseIp(input.ip);
  const ipHash = hashSignal(ctx, "ip", ipKey);
  await limit(ctx, `w:${wallet}`, APPLY_LIMITS.perWalletHour, 3_600_000, "application attempts from this wallet");
  if (ipHash) await limit(ctx, `ip:${ipHash}`, APPLY_LIMITS.perNetworkDay, 86_400_000, "application attempts from this network");
  const handle = normalizeXHandle(input.xHandle);
  if (!handle) throw new ElyiaHttpError("INVALID_REQUEST", 400, "Enter your X handle (letters, digits and _, up to 15).");
  const tasks = await listTasks(ctx, { activeOnly: true });
  const checks = tasks.map((task) => checkEvidence(task, input.evidence[task.id], handle));
  const missing = tasks.filter((task, index) => task.required && checks[index]!.state !== "submitted" && checks[index]!.state !== "verified");
  if (missing.length > 0) throw new ElyiaHttpError("TASKS_INCOMPLETE", 400, `Finish the required tasks: ${missing.map((task) => task.label).join("; ")}.`, { tasks: checks.filter((check) => check.state !== "submitted").map((check) => ({ taskId: check.taskId, detail: check.detail })) });

  const existing = (await applications(ctx).get(wallet)) ?? null;
  const current = existing?.value ?? null;
  let attempts = current?.attempts ?? 1;
  let status: HerdApplicationStatus = current?.status ?? "pending";
  if (current?.status === "approved") throw new ElyiaHttpError("ALREADY_APPROVED", 409, "You are already approved. Nothing to change.");
  if (current?.status === "rejected") {
    const left = settings.reapplyLimit - (current.attempts - 1);
    if (left <= 0) throw new ElyiaHttpError("REAPPLY_LIMIT", 409, settings.reapplyLimit === 0 ? "Re-applying after a rejection is not allowed." : `You already re-applied ${settings.reapplyLimit === 1 ? "once" : `${settings.reapplyLimit} times`}. This application stays rejected.`);
    attempts += 1;
    status = "pending";
  }
  await claimHandle(ctx, handle, wallet);
  if (current && current.xHandle !== handle) await releaseHandle(ctx, current.xHandle, wallet);

  const deviceHash = hashSignal(ctx, "device", input.device ?? null);
  await remember(ctx, ipHash ? `ip:${ipHash}` : null, wallet);
  await remember(ctx, deviceHash ? `dev:${deviceHash}` : null, wallet);
  const now = new Date(ctx.clock.now()).toISOString();
  const draft = { wallet, tasks: checks, ipHash: ipHash ?? current?.ipHash ?? null, deviceHash: deviceHash ?? current?.deviceHash ?? null, xHandle: handle, movedFrom: current?.movedFrom ?? null, flagsCleared: current?.flagsCleared ?? false };
  const scored = await scoreApplication(ctx, draft, tasks);
  const referredBy = input.referredBy && /^[0-9a-f]{8}$/u.test(input.referredBy) && input.referredBy !== referralOf(wallet) ? input.referredBy : (current?.referredBy ?? null);
  const doc: ApplicationDoc = {
    id: current?.id ?? `app_${randomHex(10)}`,
    ...draft,
    status,
    score: scored.score,
    flags: scored.flags,
    facts: scored.facts,
    notes: current?.notes ?? [],
    attempts,
    referral: referralOf(wallet),
    referredBy,
    moves: current?.moves ?? 0,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    decidedAt: status === "pending" ? null : (current?.decidedAt ?? null),
    decidedBy: status === "pending" ? null : (current?.decidedBy ?? null),
  };
  const written = await applications(ctx).compareAndSet(wallet, existing?.version ?? null, doc);
  if (!written) throw new ElyiaHttpError("CONFLICT", 409, "Your application changed meanwhile. Reload and retry.");
  return view(doc);
}

/* ------------------------------------------------------------------ me */

const scoreCache = new WeakMap<AppContext, Map<string, { at: number; score: HerdUsageScore }>>();

export async function liveScore(ctx: AppContext, wallet: string): Promise<HerdUsageScore> {
  let cache = scoreCache.get(ctx);
  if (!cache) {
    cache = new Map();
    scoreCache.set(ctx, cache);
  }
  const hit = cache.get(wallet);
  if (hit && ctx.clock.now() - hit.at < 30_000) return hit.score;
  const tasks = await listTasks(ctx, { activeOnly: true });
  const facts = await usageFacts(ctx, wallet, { points: 0, max: tasks.reduce((sum, task) => sum + task.points, 0) });
  const score = scoreFromFacts(facts, ctx.clock.now());
  cache.set(wallet, { at: ctx.clock.now(), score });
  return score;
}

export async function applicationOf(ctx: AppContext, wallet: string): Promise<ApplicationDoc | null> {
  return (await applications(ctx).get(wallet.toLowerCase()))?.value ?? null;
}

export async function me(ctx: AppContext, wallet: string, onList: HerdMeResponse["onList"]): Promise<HerdMeResponse> {
  const owner = wallet.toLowerCase();
  const settings = await herdSettings(ctx);
  const doc = await applicationOf(ctx, owner);
  const move = (await moves(ctx).get(owner))?.value ?? null;
  const score = doc?.score ?? (await liveScore(ctx, owner));
  const reapplyLeft = doc?.status === "rejected" ? Math.max(0, settings.reapplyLimit - (doc.attempts - 1)) : settings.reapplyLimit;
  let canApply = settings.applicationsOpen;
  let reason: string | null = settings.applicationsOpen ? null : "Applications are closed right now.";
  if (doc?.status === "approved") [canApply, reason] = [false, "You are approved."];
  else if (doc?.status === "rejected" && reapplyLeft <= 0) [canApply, reason] = [false, "This application was rejected and the re-application limit is used."];
  return {
    wallet: owner,
    application: doc ? view(doc) : null,
    score,
    canApply,
    reason,
    reapplyLeft,
    onList,
    pendingMove: move && move.expiresAt > ctx.clock.now() ? { to: move.to, expiresAt: new Date(move.expiresAt).toISOString() } : null,
  };
}

/* --------------------------------------------------------- wallet move */

export async function startMove(ctx: AppContext, from: string, to: string): Promise<{ to: string; expiresAt: string }> {
  const owner = from.toLowerCase();
  const target = to.toLowerCase();
  if (owner === target) throw new ElyiaHttpError("INVALID_REQUEST", 400, "That is the same wallet.");
  const doc = await applicationOf(ctx, owner);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "This wallet has no application to move.");
  const settings = await herdSettings(ctx);
  if (doc.moves >= settings.moveLimit) throw new ElyiaHttpError("MOVE_LIMIT", 409, `This application was already moved ${doc.moves === 1 ? "once" : `${doc.moves} times`}.`);
  if (await applicationOf(ctx, target)) throw new ElyiaHttpError("TARGET_HAS_APPLICATION", 409, "The new wallet already has its own application.");
  const network = herdNetwork(ctx);
  const record = await herdRecord(ctx, network);
  if (record && (await mintedBy(ctx, network, record.address, owner)) === true) throw new ElyiaHttpError("ALREADY_MINTED", 409, "This wallet already minted: its WL spot is used and cannot move.");
  const expiresAt = ctx.clock.now() + MOVE_TTL_MS;
  await moves(ctx).put(owner, { from: owner, to: target, expiresAt }, { ttlMs: MOVE_TTL_MS });
  return { to: target, expiresAt: new Date(expiresAt).toISOString() };
}

export async function acceptMove(ctx: AppContext, newWallet: string, from: string): Promise<HerdApplication> {
  const target = newWallet.toLowerCase();
  const owner = from.toLowerCase();
  const move = (await moves(ctx).get(owner))?.value;
  if (!move || move.to !== target || move.expiresAt <= ctx.clock.now()) throw new ElyiaHttpError("NO_MOVE", 404, "No pending move from that wallet to this one. Start it from the old wallet first (it expires after 30 minutes).");
  const existing = await applications(ctx).get(owner);
  if (!existing) throw new ElyiaHttpError("NOT_FOUND", 404, "The old wallet's application is gone.");
  if (await applicationOf(ctx, target)) throw new ElyiaHttpError("TARGET_HAS_APPLICATION", 409, "This wallet already has its own application.");
  const now = new Date(ctx.clock.now()).toISOString();
  const doc: ApplicationDoc = {
    ...existing.value,
    wallet: target,
    movedFrom: owner,
    moves: existing.value.moves + 1,
    referral: referralOf(target),
    updatedAt: now,
    notes: [...existing.value.notes, { at: now, by: target, text: `Moved from ${owner} by the applicant (both wallets signed in).` }],
    flags: [...existing.value.flags.filter((flag) => flag.code !== "wallet-moved"), { code: "wallet-moved", severity: "info", detail: `Moved from ${owner}.` }],
  };
  if (!(await applications(ctx).compareAndSet(target, null, doc))) throw new ElyiaHttpError("CONFLICT", 409, "This wallet got an application meanwhile.");
  await applications(ctx).delete(owner);
  await moves(ctx).delete(owner);
  const handle = await handles(ctx).get(doc.xHandle);
  if (handle) await handles(ctx).put(doc.xHandle, { wallet: target, previous: [...new Set([...handle.value.previous, target])] });
  await audit(ctx, target, "application.move", `${doc.id} ${owner} -> ${target} (status ${doc.status}${doc.status === "approved" ? "; rebuild and publish the WL root" : ""})`);
  return view(doc);
}

/* -------------------------------------------------------------- admin */

export async function allApplications(ctx: AppContext): Promise<ApplicationDoc[]> {
  const out: ApplicationDoc[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await applications(ctx).list({ limit: 1_000, ...(after ? { after } : {}) });
    out.push(...page.map((row) => row.value));
    if (page.length < 1_000) break;
    after = page[page.length - 1]!.id;
  }
  return out;
}

function tasksDone(doc: ApplicationDoc): boolean {
  return doc.tasks.every((task) => task.state === "submitted" || task.state === "verified");
}

export async function listApplications(ctx: AppContext, query: HerdApplicationsQuery): Promise<HerdApplicationsResponse> {
  const all = await allApplications(ctx);
  const counts = Object.fromEntries(HERD_APPLICATION_STATUSES.map((status) => [status, all.filter((doc) => doc.status === status).length])) as Record<HerdApplicationStatus, number>;
  const q = query.q?.toLowerCase().replace(/^@/u, "");
  const filtered = all.filter(
    (doc) =>
      (!query.status || doc.status === query.status) &&
      (query.minScore === undefined || doc.score.score >= query.minScore) &&
      (query.flagged === undefined || (doc.flags.some((flag) => flag.severity !== "info") && !doc.flagsCleared) === query.flagged) &&
      (query.tasksDone === undefined || tasksDone(doc) === query.tasksDone) &&
      (!q || doc.wallet.includes(q) || doc.xHandle.includes(q) || doc.id === q),
  );
  const sort = query.sort ?? "score";
  filtered.sort((a, b) => (sort === "score" ? b.score.score - a.score.score : 0) || (sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.createdAt.localeCompare(b.createdAt)) || a.wallet.localeCompare(b.wallet));
  const start = query.cursor ? Number(query.cursor) || 0 : 0;
  const size = query.limit ?? 100;
  const page = filtered.slice(start, start + size);
  return {
    applications: page.map(view),
    counts: { ...counts, total: all.length, flagged: all.filter((doc) => doc.flags.some((flag) => flag.severity !== "info") && !doc.flagsCleared).length },
    nextCursor: start + size < filtered.length ? String(start + size) : null,
  };
}

async function byId(ctx: AppContext, id: string): Promise<ApplicationDoc | null> {
  if (/^0x[0-9a-f]{40}$/u.test(id)) return applicationOf(ctx, id);
  return (await allApplications(ctx)).find((doc) => doc.id === id) ?? null;
}

async function save(ctx: AppContext, doc: ApplicationDoc): Promise<void> {
  await applications(ctx).put(doc.wallet, doc);
}

export async function decide(ctx: AppContext, by: string, ids: readonly string[], status: HerdApplicationStatus, note?: string): Promise<{ updated: number; missing: string[] }> {
  const all = await allApplications(ctx);
  const index = new Map(all.flatMap((doc) => [[doc.id, doc] as const, [doc.wallet, doc] as const]));
  const now = new Date(ctx.clock.now()).toISOString();
  const missing: string[] = [];
  let updated = 0;
  for (const id of ids) {
    const doc = index.get(id.toLowerCase()) ?? index.get(id);
    if (!doc) {
      missing.push(id);
      continue;
    }
    await save(ctx, { ...doc, status, decidedAt: now, decidedBy: by, updatedAt: now, notes: note ? [...doc.notes, { at: now, by, text: note.slice(0, 500) }] : doc.notes });
    updated += 1;
  }
  await audit(ctx, by, `applications.${status}`, `${updated} application(s)${note ? ` · note: ${note.slice(0, 120)}` : ""}: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ` +${ids.length - 20}` : ""}`);
  return { updated, missing };
}

export async function addNote(ctx: AppContext, by: string, id: string, text: string): Promise<HerdApplication> {
  const doc = await byId(ctx, id);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such application.");
  const now = new Date(ctx.clock.now()).toISOString();
  const next = { ...doc, notes: [...doc.notes, { at: now, by, text: text.slice(0, 500) }], updatedAt: now };
  await save(ctx, next);
  await audit(ctx, by, "application.note", `${doc.id} (${doc.wallet})`);
  return view(next);
}

export async function setFlagsCleared(ctx: AppContext, by: string, id: string, cleared: boolean): Promise<HerdApplication> {
  const doc = await byId(ctx, id);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such application.");
  const next: ApplicationDoc = { ...doc, flagsCleared: cleared, score: scoreFromFacts(doc.facts ?? (await usageFacts(ctx, doc.wallet, { points: 0, max: 0 })), ctx.clock.now(), doc.flags, cleared), updatedAt: new Date(ctx.clock.now()).toISOString() };
  await save(ctx, next);
  await audit(ctx, by, cleared ? "application.flags.clear" : "application.flags.restore", `${doc.id} (${doc.wallet})`);
  return view(next);
}

export async function rescore(ctx: AppContext, by: string, ids?: readonly string[]): Promise<number> {
  const tasks = await listTasks(ctx, { activeOnly: true });
  const all = await allApplications(ctx);
  const wanted = ids && ids.length > 0 ? new Set(ids.map((id) => id.toLowerCase())) : null;
  let count = 0;
  for (const doc of all) {
    if (wanted && !wanted.has(doc.id) && !wanted.has(doc.wallet)) continue;
    const scored = await scoreApplication(ctx, doc, tasks);
    await save(ctx, { ...doc, score: scored.score, flags: scored.flags, facts: scored.facts });
    count += 1;
  }
  await audit(ctx, by, "applications.rescore", `${count} application(s)`);
  return count;
}

/** Approved WL wallets (the WL Merkle list). */
export async function approvedWallets(ctx: AppContext): Promise<string[]> {
  return (await allApplications(ctx)).filter((doc) => doc.status === "approved").map((doc) => doc.wallet).sort();
}

export { DEFAULT_HERD_SETTINGS };
