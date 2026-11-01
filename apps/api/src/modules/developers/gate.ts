/**
 * The API key gate, mounted first on /v1 (the developers module is the first
 * module). Requests without a key pass through untouched (public per-IP
 * limits still apply). A request with a key:
 *
 * 1. is authenticated (`Authorization: Bearer ely_...` or `Elyia-Key`;
 *    both present and different, unknown, revoked: 401);
 * 2. is checked against the scope its route needs (403 KEY_SCOPE);
 * 3. is metered and held to the key's quotas (per minute and per UTC day for
 *    requests, plans and prepares; 429 QUOTA_EXCEEDED with Retry-After);
 * 4. when it creates an intent, records the intent's owner (webhooks
 *    `intent.step.settled` / `intent.failed` go to that developer) and the
 *    developer's integrator fee for route cards.
 */
import type { Request, RequestHandler, Response } from "express";
import { API_KEY_HEADER, USAGE_METRICS, type ApiKeyScope, type UsageDay, type UsageMetric } from "@elyia/core/api/developers";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError, retryAfterHeader } from "../../http/errors.js";
import { perksFor } from "../herd/perks.js";
import { sendError } from "../../http/request.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { lookupKey, touchKey, type ApiKeyRecord } from "./keys.js";

export const USAGE_RETENTION_MS = 40 * 24 * 60 * 60_000;

export interface KeyContext {
  readonly key: ApiKeyRecord;
}

const keyed = new WeakMap<Request, KeyContext>();

export function keyOf(req: Request): KeyContext | null {
  return keyed.get(req) ?? null;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What a route needs (paths relative to /v1). */
export function routeScope(method: string, path: string): { readonly scope: ApiKeyScope; readonly metric: UsageMetric | null } {
  if (method === "POST" && (path === "/intents" || path === "/intents/parse")) return { scope: "plan", metric: path === "/intents" ? "plans" : null };
  if (method === "POST" && /^\/intents\/[^/]+\/steps\/[^/]+\/(?:prepare|submit)$/u.test(path)) return { scope: "execute-prepare", metric: path.endsWith("/prepare") ? "prepares" : null };
  if (method === "POST" && /^\/intents\/[^/]+\/stop$/u.test(path)) return { scope: "execute-prepare", metric: null };
  if (path.startsWith("/developers/webhooks")) return { scope: "webhooks", metric: null };
  return { scope: "read", metric: null };
}

function presented(req: Request): string | null {
  const auth = req.get("authorization")?.trim();
  const bearer = auth && /^Bearer\s+/iu.test(auth) ? auth.replace(/^Bearer\s+/iu, "").trim() : null;
  const header = req.get(API_KEY_HEADER)?.trim() || null;
  if (bearer && header && bearer !== header) throw new ElyiaHttpError("UNAUTHORIZED", 401, "Two different API keys were sent.");
  const value = header ?? (bearer && bearer.startsWith("ely_") ? bearer : null);
  if (value && value.length > 256) throw new ElyiaHttpError("UNAUTHORIZED", 401, "The API key is malformed.");
  return value;
}

function quotaError(metric: string, limit: number, seconds: number): ElyiaHttpError {
  return new ElyiaHttpError("QUOTA_EXCEEDED", 429, `This key's ${metric} quota (${limit}) is used up. Retry in ${seconds} s or raise the key's quota.`, { metric, limit }, { headers: retryAfterHeader(seconds) });
}

/** The key's quotas, multiplied for Herd holders (balanceOf on chain, cached; never from the client). */
export async function effectiveQuotas(ctx: AppContext, key: ApiKeyRecord): Promise<ApiKeyRecord["quotas"]> {
  const factor = Math.max(1, (await perksFor(ctx, key.owner)).developerQuotaMultiplier);
  if (factor === 1) return key.quotas;
  return { requestsPerDay: key.quotas.requestsPerDay * factor, plansPerDay: key.quotas.plansPerDay * factor, preparesPerDay: key.quotas.preparesPerDay * factor, requestsPerMinute: key.quotas.requestsPerMinute * factor };
}

async function meter(ctx: AppContext, record: ApiKeyRecord, metric: UsageMetric | null): Promise<void> {
  const key = { ...record, quotas: await effectiveQuotas(ctx, record) };
  const now = ctx.clock.now();
  const counters = ctx.store.counters("dev_usage");
  const minute = Math.floor(now / 60_000);
  const perMinute = await ctx.store.counters("dev_rate").increment(`${key.id}:${minute}`, 1, { ttlMs: 120_000 });
  if (perMinute > key.quotas.requestsPerMinute) throw quotaError("requests per minute", key.quotas.requestsPerMinute, 60 - Math.floor((now % 60_000) / 1000));
  const day = utcDay(now);
  const secondsToMidnight = Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now) / 1000));
  const requests = await counters.increment(`${key.id}:${day}:requests`, 1, { ttlMs: USAGE_RETENTION_MS });
  if (requests > key.quotas.requestsPerDay) throw quotaError("requests per day", key.quotas.requestsPerDay, secondsToMidnight);
  if (metric === "plans" || metric === "prepares") {
    const used = await counters.increment(`${key.id}:${day}:${metric}`, 1, { ttlMs: USAGE_RETENTION_MS });
    const limit = metric === "plans" ? key.quotas.plansPerDay : key.quotas.preparesPerDay;
    if (used > limit) throw quotaError(`${metric} per day`, limit, secondsToMidnight);
  }
}

export async function usageOf(ctx: AppContext, keyId: string, day: string): Promise<UsageDay> {
  const counters = ctx.store.counters("dev_usage");
  const [requests, plans, prepares] = await Promise.all(USAGE_METRICS.map((metric) => counters.get(`${keyId}:${day}:${metric}`)));
  return { day, requests: requests ?? 0, plans: plans ?? 0, prepares: prepares ?? 0 };
}

export interface IntentOwner {
  readonly intentId: string;
  readonly developerId: string;
  readonly keyId: string;
  readonly createdAt: number;
}

/** Records who created an intent with a key (webhook routing). */
function captureIntentOwner(ctx: AppContext, res: Response, key: ApiKeyRecord): void {
  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    const record = body as { intent?: { id?: unknown }; dryRun?: unknown } | null;
    const id = record?.intent?.id;
    if (typeof id === "string" && record?.dryRun === false && res.statusCode < 300) {
      const owner: IntentOwner = { intentId: id, developerId: key.developerId, keyId: key.id, createdAt: ctx.clock.now() };
      void docs<IntentOwner>(ctx, PLATFORM_COLLECTIONS.intentOwners)
        .put(id, owner, { ttlMs: 30 * 24 * 60 * 60_000 })
        .catch(() => undefined);
    }
    return original(body);
  };
}

export function developerGate(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const plain = presented(req);
      if (!plain) return;
      const key = await lookupKey(ctx, plain);
      if (!key) throw new ElyiaHttpError("UNAUTHORIZED", 401, "Unknown or revoked API key.");
      const { scope, metric } = routeScope(req.method, req.path);
      if (!key.scopes.includes(scope)) throw new ElyiaHttpError("KEY_SCOPE", 403, `This key lacks the "${scope}" scope this route needs.`, { scope, scopes: [...key.scopes] });
      await meter(ctx, key, metric);
      keyed.set(req, { key });
      touchKey(ctx, key);
      if (req.method === "POST" && req.path === "/intents") captureIntentOwner(ctx, res, key);
    })().then(
      () => next(),
      (error: unknown) => sendError(req, res, error),
    );
  };
}
