/**
 * Alerts: CRUD per owner and the evaluator worker.
 *
 * The evaluator runs every 30 s and stays inside the HyperCore weight
 * budget: one `allMids` (weight 2) per pass for price alerts, one
 * `metaAndAssetCtxs` (weight 20) only when a funding alert exists, and one
 * `clearinghouseState` (weight 2) per watched account for liquidation
 * alerts, skipped when the remaining weight is under the reserve. Intent
 * step alerts listen to the intent event bus instead of polling.
 *
 * Firing: threshold crossed and the cooldown (default 15 min) elapsed. A
 * firing goes to the in-app feed, to Telegram when the owner linked a chat,
 * and to the owner's developer webhooks (`alert.fired`).
 */
import { ALERT_KINDS, type AlertChannel, type AlertFiring, type AlertInput, type AlertKind, type AlertView } from "@elyia/core/api/ops";
import type { NetworkKey } from "@elyia/core";
import type { IntentStreamEvent } from "@elyia/core/api/intents";
import type { AppContext } from "../../context.js";
import { hypercoreNetworkFor } from "../../config.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { perksFor } from "../herd/perks.js";
import { registerStats } from "../admin/stats.js";
import { randomHex } from "./auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "./docs.js";

export const EVALUATOR_INTERVAL_MS = 30_000;
export const DEFAULT_COOLDOWN_S = 900;
export const MAX_ALERTS_PER_OWNER = 50;
/** Weight kept for user-facing routes: the evaluator stops early below it. */
export const WEIGHT_RESERVE = 200;
const FIRING_TTL_MS = 30 * 24 * 60 * 60_000;

export interface AlertRecord {
  readonly id: string;
  readonly owner: string;
  readonly kind: AlertKind;
  readonly coin: string | null;
  readonly threshold: string | null;
  readonly intentId: string | null;
  readonly account: string | null;
  readonly channels: readonly AlertChannel[];
  readonly cooldownSeconds: number;
  readonly note: string | null;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  readonly fireCount: number;
}

export function alertView(ctx: AppContext, record: AlertRecord): AlertView {
  return { ...record, createdAt: new Date(record.createdAt).toISOString(), lastFiredAt: iso(record.lastFiredAt), network: hypercoreNetworkFor(ctx.config.mode) };
}

function alerts(ctx: AppContext) {
  return docs<AlertRecord>(ctx, PLATFORM_COLLECTIONS.alerts);
}

export function validateAlert(input: AlertInput): void {
  if (!ALERT_KINDS.includes(input.kind)) throw new ElyiaHttpError("INVALID_REQUEST", 400, "Unknown alert kind.");
  const needsCoin = input.kind.startsWith("price") || input.kind.startsWith("funding");
  if (needsCoin && !input.coin) throw new ElyiaHttpError("INVALID_REQUEST", 400, `${input.kind} needs a coin.`);
  if (input.kind !== "intent-step" && (input.threshold === undefined || !/^-?\d+(?:\.\d+)?$/u.test(input.threshold))) throw new ElyiaHttpError("INVALID_REQUEST", 400, `${input.kind} needs a numeric threshold.`);
  if (input.kind === "intent-step" && !input.intentId) throw new ElyiaHttpError("INVALID_REQUEST", 400, "intent-step needs an intentId.");
}

export async function createAlert(ctx: AppContext, owner: string, input: AlertInput): Promise<AlertRecord> {
  validateAlert(input);
  const max = Math.max(MAX_ALERTS_PER_OWNER, (await perksFor(ctx, owner)).alerts);
  const existing = await alerts(ctx).list({ prefix: `${owner}:`, limit: max + 1 });
  if (existing.length >= max) throw new ElyiaHttpError("ALERT_LIMIT", 409, `At most ${max} alerts${max > MAX_ALERTS_PER_OWNER ? " (Herd holder)" : ""}.`);
  const record: AlertRecord = {
    id: `alr_${randomHex(10)}`,
    owner,
    kind: input.kind,
    coin: input.coin ?? null,
    threshold: input.threshold ?? null,
    intentId: input.intentId ?? null,
    account: input.kind === "liquidation-distance-below" ? (input.account ?? owner).toLowerCase() : null,
    channels: input.channels && input.channels.length > 0 ? [...new Set(input.channels)] : ["feed", "telegram"],
    cooldownSeconds: Math.max(60, input.cooldownSeconds ?? DEFAULT_COOLDOWN_S),
    note: input.note ?? null,
    enabled: true,
    createdAt: ctx.clock.now(),
    lastFiredAt: null,
    fireCount: 0,
  };
  await alerts(ctx).put(`${owner}:${record.id}`, record);
  return record;
}

export async function listAlerts(ctx: AppContext, owner: string): Promise<AlertRecord[]> {
  return (await alerts(ctx).list({ prefix: `${owner}:`, limit: 200 })).map((doc) => doc.value);
}

export async function updateAlert(ctx: AppContext, owner: string, id: string, patch: { readonly enabled?: boolean; readonly threshold?: string; readonly cooldownSeconds?: number; readonly channels?: readonly AlertChannel[]; readonly note?: string }): Promise<AlertRecord> {
  const current = (await alerts(ctx).get(`${owner}:${id}`))?.value;
  if (!current) throw new ElyiaHttpError("NOT_FOUND", 404, "No such alert.");
  const next: AlertRecord = {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
    ...(patch.cooldownSeconds !== undefined ? { cooldownSeconds: Math.max(60, patch.cooldownSeconds) } : {}),
    ...(patch.channels ? { channels: [...new Set(patch.channels)] } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
  if (next.kind !== "intent-step") validateAlert({ kind: next.kind, ...(next.coin ? { coin: next.coin } : {}), ...(next.threshold ? { threshold: next.threshold } : {}) });
  await alerts(ctx).put(`${owner}:${id}`, next);
  return next;
}

export async function deleteAlert(ctx: AppContext, owner: string, id: string): Promise<boolean> {
  return alerts(ctx).delete(`${owner}:${id}`);
}

export async function feed(ctx: AppContext, owner: string, limit = 50): Promise<AlertFiring[]> {
  const rows = await docs<AlertFiring>(ctx, PLATFORM_COLLECTIONS.alertFirings).list({ prefix: `${owner}:`, limit: 1_000 });
  return rows.map((row) => row.value).reverse().slice(0, limit);
}

/* ------------------------------------------------------------ evaluation */

export interface MarketFacts {
  /** coin -> mid price. */
  readonly mids: ReadonlyMap<string, number> | null;
  /** coin -> hourly funding in percent. */
  readonly fundingPctHourly: ReadonlyMap<string, number> | null;
  /** account -> coin -> liquidation distance %. */
  readonly liquidation: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** The observed value when the alert's condition holds, else null (pure; tests drive it). */
export function crossing(alert: AlertRecord, facts: MarketFacts): { readonly observed: number; readonly coin: string | null } | null {
  const threshold = Number(alert.threshold);
  switch (alert.kind) {
    case "price-above":
    case "price-below": {
      const mid = alert.coin ? facts.mids?.get(alert.coin) : undefined;
      if (mid === undefined) return null;
      return (alert.kind === "price-above" ? mid > threshold : mid < threshold) ? { observed: mid, coin: alert.coin } : null;
    }
    case "funding-above":
    case "funding-below": {
      const rate = alert.coin ? facts.fundingPctHourly?.get(alert.coin) : undefined;
      if (rate === undefined) return null;
      return (alert.kind === "funding-above" ? rate > threshold : rate < threshold) ? { observed: rate, coin: alert.coin } : null;
    }
    case "liquidation-distance-below": {
      const positions = alert.account ? facts.liquidation.get(alert.account) : undefined;
      if (!positions) return null;
      for (const [coin, distance] of positions) {
        if ((!alert.coin || alert.coin === coin) && distance < threshold) return { observed: distance, coin };
      }
      return null;
    }
    case "intent-step":
      return null;
  }
}

export function cooledDown(alert: AlertRecord, now: number): boolean {
  return alert.lastFiredAt === null || now - alert.lastFiredAt >= alert.cooldownSeconds * 1000;
}

export function messageOf(alert: AlertRecord, observed: string, coin: string | null): { readonly en: string; readonly tr: string } {
  const subject = coin ?? alert.coin ?? "";
  switch (alert.kind) {
    case "price-above":
      return { en: `${subject} is above ${alert.threshold}: ${observed}.`, tr: `${subject} ${alert.threshold} üzerinde: ${observed}.` };
    case "price-below":
      return { en: `${subject} is below ${alert.threshold}: ${observed}.`, tr: `${subject} ${alert.threshold} altında: ${observed}.` };
    case "funding-above":
      return { en: `${subject} funding is above ${alert.threshold}%/h: ${observed}%/h.`, tr: `${subject} fonlaması saatlik %${alert.threshold} üzerinde: %${observed}.` };
    case "funding-below":
      return { en: `${subject} funding is below ${alert.threshold}%/h: ${observed}%/h.`, tr: `${subject} fonlaması saatlik %${alert.threshold} altında: %${observed}.` };
    case "liquidation-distance-below":
      return { en: `Your ${subject} rope is short: ${observed}% from liquidation (alert at ${alert.threshold}%).`, tr: `${subject} ipin kısaldı: tasfiyeye %${observed} (uyarı %${alert.threshold}).` };
    case "intent-step":
      return { en: `Intent ${alert.intentId}: ${observed}.`, tr: `Niyet ${alert.intentId}: ${observed}.` };
  }
}

export type AlertDelivery = (firing: AlertFiring, alert: AlertRecord) => Promise<readonly AlertChannel[]>;

declare module "../../bus.js" {
  interface ElyiaEvents {
    /** A firing for the Telegram outbox (ops/telegram delivers it when the owner linked a chat). */
    "ops.alert.delivery": { readonly firing: AlertFiring };
  }
}

export async function fire(ctx: AppContext, alert: AlertRecord, observed: string, coin: string | null): Promise<AlertFiring> {
  const now = ctx.clock.now();
  const delivered: AlertChannel[] = [];
  const firing: AlertFiring = { id: `fir_${randomHex(10)}`, alertId: alert.id, owner: alert.owner, kind: alert.kind, firedAt: new Date(now).toISOString(), observed, threshold: alert.threshold, message: messageOf(alert, observed, coin), delivered };
  if (alert.channels.includes("feed")) delivered.push("feed");
  if (alert.channels.includes("telegram")) {
    ctx.bus.emit("ops.alert.delivery", { firing });
    delivered.push("telegram");
  }
  if (alert.channels.includes("webhook")) delivered.push("webhook");
  await docs<AlertFiring>(ctx, PLATFORM_COLLECTIONS.alertFirings).put(`${alert.owner}:${String(now).padStart(15, "0")}:${firing.id}`, firing, { ttlMs: FIRING_TTL_MS });
  const collection = alerts(ctx);
  const doc = await collection.get(`${alert.owner}:${alert.id}`);
  if (doc) await collection.compareAndSet(doc.id, doc.version, { ...doc.value, lastFiredAt: now, fireCount: doc.value.fireCount + 1, ...(alert.kind === "intent-step" && /settled|failed|completed/u.test(observed) ? { enabled: false } : {}) });
  ctx.bus.emit("alert.fired", { owner: alert.owner, firing });
  return firing;
}

export interface EvaluatorState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  fired: number;
  unsubscribe: (() => void) | null;
}

/** One evaluator pass. Reads only what enabled alerts need. */
export async function evaluateOnce(ctx: AppContext, state: Pick<EvaluatorState, "fired">): Promise<number> {
  const all = (await alerts(ctx).list({ limit: 1_000 })).map((doc) => doc.value).filter((alert) => alert.enabled && alert.kind !== "intent-step");
  if (all.length === 0) return 0;
  const network = hypercoreNetworkFor(ctx.config.mode) as NetworkKey;
  const info = ctx.hyperliquid.info(network);
  const now = ctx.clock.now();
  let mids: Map<string, number> | null = null;
  let funding: Map<string, number> | null = null;
  const liquidation = new Map<string, Map<string, number>>();
  if (all.some((alert) => alert.kind.startsWith("price"))) {
    const raw = await info.allMids().catch(() => null);
    mids = raw ? new Map(Object.entries(raw).map(([coin, value]) => [coin, Number(value)])) : null;
  }
  if (all.some((alert) => alert.kind.startsWith("funding"))) {
    const contexts = await info.metaAndAssetCtxs().catch(() => null);
    if (contexts) {
      const [meta, ctxs] = contexts as unknown as [{ universe: Array<{ name: string }> }, Array<{ funding: string }>];
      funding = new Map(meta.universe.map((asset, index) => [asset.name, Number(ctxs[index]?.funding ?? NaN) * 100]));
    }
  }
  const accounts = [...new Set(all.filter((alert) => alert.kind === "liquidation-distance-below" && alert.account).map((alert) => alert.account as string))];
  for (const account of accounts) {
    if (info.remainingWeight < WEIGHT_RESERVE) break;
    const state = await info.clearinghouseState(account).catch(() => null);
    if (!state) continue;
    const positions = new Map<string, number>();
    for (const entry of (state as unknown as { assetPositions: Array<{ position: { coin: string; szi: string; liquidationPx: string | null; positionValue: string } }> }).assetPositions ?? []) {
      const position = entry.position;
      const size = Math.abs(Number(position.szi));
      if (!position.liquidationPx || size === 0) continue;
      const mark = Number(position.positionValue) / size;
      const liq = Number(position.liquidationPx);
      positions.set(position.coin, Math.round((Math.abs(mark - liq) / mark) * 10_000) / 100);
    }
    liquidation.set(account, positions);
  }
  const facts: MarketFacts = { mids, fundingPctHourly: funding, liquidation };
  let fired = 0;
  for (const alert of all) {
    if (!cooledDown(alert, now)) continue;
    const hit = crossing(alert, facts);
    if (!hit) continue;
    await fire(ctx, alert, String(Math.round(hit.observed * 1e6) / 1e6), hit.coin);
    fired += 1;
  }
  state.fired += fired;
  return fired;
}

/** Intent step alerts: driven by the engine's event bus. */
export function wireIntentAlerts(ctx: AppContext): () => void {
  return ctx.bus.on("intents.event", ({ intentId, event }: { readonly intentId: string; readonly event: IntentStreamEvent }) => {
    if (event.type !== "intent.step_updated" && event.type !== "intent.status_changed") return;
    const status = String((event.data as { status?: unknown }).status ?? "");
    if (!/awaiting-signature|settled|failed|completed|partially-completed/u.test(status)) return;
    void alerts(ctx)
      .list({ limit: 1_000 })
      .then(async (rows) => {
        for (const row of rows) {
          const alert = row.value;
          if (alert.enabled && alert.kind === "intent-step" && alert.intentId === intentId) {
            const step = (event.data as { stepId?: string }).stepId;
            await fire(ctx, alert, step ? `step ${step} ${status}` : status, null);
          }
        }
      })
      .catch(() => undefined);
  });
}

const evaluators = new WeakMap<AppContext, EvaluatorState>();

export function startEvaluator(ctx: AppContext, intervalMs = EVALUATOR_INTERVAL_MS): EvaluatorState {
  const existing = evaluators.get(ctx);
  if (existing) return existing;
  const state: EvaluatorState = { timer: null, running: false, lastRunAt: null, lastError: null, fired: 0, unsubscribe: wireIntentAlerts(ctx) };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    evaluateOnce(ctx, state)
      .then(() => {
        state.lastRunAt = ctx.clock.now();
        state.lastError = null;
      })
      .catch((error: unknown) => {
        state.lastError = error instanceof Error ? error.message.slice(0, 160) : "evaluation failed";
      })
      .finally(() => {
        state.running = false;
      });
  }, intervalMs);
  state.timer.unref();
  evaluators.set(ctx, state);
  registerStats(ctx, "alerts", async () => ({ running: true, lastRunAt: state.lastRunAt, lastError: state.lastError, pending: (await alerts(ctx).list({ limit: 1_000 })).filter((doc) => doc.value.enabled).length, note: `fired ${state.fired}` }));
  return state;
}

export function stopEvaluator(ctx: AppContext): void {
  const state = evaluators.get(ctx);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  state.unsubscribe?.();
  evaluators.delete(ctx);
}
