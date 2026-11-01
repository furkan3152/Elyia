/**
 * Labelled sample data for the portal while signed out (or while the API is
 * unreachable). Every place that draws it says "sample". No addresses here:
 * sample rows never show an address that could be mistaken for a real one.
 */
import type { ApiKeyView, UsageResponse, WebhookDelivery, WebhookView } from "@elyia/core/api/developers";
import { DEFAULT_KEY_QUOTAS } from "@elyia/core/api/developers";

const DAY = 86_400_000;

export function sampleKeys(now: number): ApiKeyView[] {
  const base = { quotas: DEFAULT_KEY_QUOTAS, rotatedAt: null };
  return [
    { ...base, id: "key_sample_prod", name: "Production", scopes: ["read", "plan", "execute-prepare"], last4: "x2Pa", createdAt: new Date(now - 40 * DAY).toISOString(), revokedAt: null, lastUsedAt: new Date(now - 2 * 60_000).toISOString() },
    { ...base, id: "key_sample_stage", name: "Staging", scopes: ["read", "plan", "execute-prepare", "webhooks"], last4: "mQ1c", createdAt: new Date(now - 20 * DAY).toISOString(), revokedAt: null, lastUsedAt: new Date(now - 3_600_000).toISOString() },
    { ...base, id: "key_sample_ci", name: "Old CI", scopes: ["read"], last4: "0aZt", createdAt: new Date(now - 90 * DAY).toISOString(), revokedAt: new Date(Date.UTC(2026, 9, 12)).toISOString(), lastUsedAt: new Date(Date.UTC(2026, 9, 12)).toISOString() },
  ];
}

const PLANS = [38, 44, 41, 52, 49, 61, 58, 55, 63, 70, 66, 74, 81, 60, 52, 47, 58, 61, 55, 49, 62, 68, 71, 66, 59, 64, 70, 73, 77, 80];

export function sampleUsage(now: number, days = 30): UsageResponse {
  const list = Array.from({ length: days }, (_, index) => {
    const day = new Date(now - index * DAY).toISOString().slice(0, 10);
    const plans = (PLANS[(PLANS.length - 1 - index + PLANS.length) % PLANS.length] ?? 50) * 15;
    return index === 0 ? { day, requests: 12_480, plans: 1_204, prepares: 1_620 } : { day, requests: plans * 10, plans, prepares: Math.round(plans * 0.9) };
  });
  return { developerId: "dev_sample", keys: [{ keyId: "key_sample_prod", name: "Production", quotas: DEFAULT_KEY_QUOTAS, days: list }], totals: list[0]! };
}

export function sampleWebhook(now: number): WebhookView {
  return { id: "wh_sample", url: "https://your-app.example/hooks/elyia", events: ["intent.step.settled", "intent.failed", "alert.fired"], networks: [], enabled: true, createdAt: new Date(now - 10 * DAY).toISOString(), secretLast4: "9f3c", failures: 0 };
}

export function sampleDeliveries(now: number): WebhookDelivery[] {
  return [
    { id: "d1", webhookId: "wh_sample", eventId: "evt_7f3a", eventType: "intent.step.settled", attempt: 1, status: "delivered", httpStatus: 200, durationMs: 84, error: null, at: new Date(now - 60_000).toISOString(), nextAttemptAt: null },
    { id: "d2", webhookId: "wh_sample", eventId: "evt_501a", eventType: "alert.fired", attempt: 1, status: "delivered", httpStatus: 200, durationMs: 91, error: null, at: new Date(now - 300_000).toISOString(), nextAttemptAt: null },
    { id: "d3", webhookId: "wh_sample", eventId: "evt_6c12", eventType: "intent.failed", attempt: 2, status: "retrying", httpStatus: 503, durationMs: 2_004, error: null, at: new Date(now - 600_000).toISOString(), nextAttemptAt: new Date(now + 25_000).toISOString() },
  ];
}

/** Shown in the reveal box while signed out: obviously not a key. */
export const SAMPLE_PLAIN_KEY = "ely_sample_shownOnceHashedAtRest";
