/**
 * Developer webhooks: registrations, HMAC-signed delivery with retries and
 * backoff, a delivery log and a test fire.
 *
 * - URLs must be public HTTPS (SSRF guard at registration and again at
 *   connect time through `guardedLookup`, so DNS rebinding is refused).
 * - The signing secret `whsec_...` is shown once and stored sealed
 *   (AES-256-GCM, AAD = webhook id) because the server must sign with it.
 * - Delivery: POST JSON, 5 s timeout, redirects not followed, the response
 *   body never read. Retries after 1 s, 5 s, 25 s and 125 s; a webhook is
 *   paused after 20 consecutive failures. At least once: receivers dedupe
 *   by `Elyia-Event-Id`.
 * - Headers: `Elyia-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`,
 *   `Elyia-Event-Id`, `Elyia-Event-Type`, `Elyia-Webhook-Id`, `Elyia-Delivery-Attempt`.
 */
import { request as httpsRequest } from "node:https";
import {
  MAX_WEBHOOKS_PER_DEVELOPER,
  WEBHOOK_HEADERS,
  WEBHOOK_RETRY_DELAYS_MS,
  webhookSignedPayload,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookView,
} from "@elyia/core/api/developers";
import type { NetworkKey } from "@elyia/core";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { assertPublicUrl, guardedLookup, type HostResolver } from "../../http/netguard.js";
import { hmacHex, open, purposeKey, randomBase62, randomHex, seal } from "../ops/auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";

export const WEBHOOK_TIMEOUT_MS = 5_000;
export const PAUSE_AFTER_FAILURES = 20;
const DELIVERY_LOG_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_IN_FLIGHT = 100;

export interface WebhookRecord {
  readonly id: string;
  readonly developerId: string;
  readonly url: string;
  readonly events: readonly WebhookEventType[];
  readonly networks: readonly NetworkKey[];
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly secretSealed: string;
  readonly secretLast4: string;
  readonly failures: number;
}

export type WebhookTransport = (input: { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string; readonly timeoutMs: number }) => Promise<{ readonly status: number }>;

/** HTTPS POST with the connect-time SSRF guard; never follows redirects, never reads the body. */
export const httpsTransport: WebhookTransport = ({ url, headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: guardedLookup, agent: false, timeout: timeoutMs }, (response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0 });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(body);
  });

export function webhookView(record: WebhookRecord): WebhookView {
  return {
    id: record.id,
    url: record.url,
    events: record.events,
    networks: record.networks,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt).toISOString(),
    secretLast4: record.secretLast4,
    failures: record.failures,
  };
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${hmacHex(secret, webhookSignedPayload(timestamp, body))}`;
}

interface Job {
  readonly webhookId: string;
  readonly developerId: string;
  readonly event: WebhookEvent;
  readonly attempt: number;
}

export interface WebhookServiceOptions {
  readonly transport?: WebhookTransport;
  readonly resolveHost?: HostResolver;
  /** Retry delays (tests shorten them). */
  readonly retryDelaysMs?: readonly number[];
}

export class WebhookService {
  private readonly transport: WebhookTransport;
  private readonly retryDelays: readonly number[];
  private readonly timers = new Set<NodeJS.Timeout>();
  private inFlight = 0;
  private stopped = false;
  delivered = 0;
  failed = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly options: WebhookServiceOptions = {},
  ) {
    this.transport = options.transport ?? httpsTransport;
    this.retryDelays = options.retryDelaysMs ?? WEBHOOK_RETRY_DELAYS_MS;
  }

  private collection() {
    return docs<WebhookRecord>(this.ctx, PLATFORM_COLLECTIONS.webhooks);
  }

  private secretKey(): Buffer {
    return purposeKey(this.ctx, "webhook-seal");
  }

  get pending(): number {
    return this.timers.size + this.inFlight;
  }

  async list(developerId: string): Promise<WebhookRecord[]> {
    return (await this.collection().list({ prefix: `${developerId}:`, limit: 100 })).map((doc) => doc.value);
  }

  async get(developerId: string, id: string): Promise<WebhookRecord> {
    const doc = await this.collection().get(`${developerId}:${id}`);
    if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such webhook.");
    return doc.value;
  }

  async create(developerId: string, input: { readonly url: string; readonly events: readonly WebhookEventType[]; readonly networks: readonly NetworkKey[] }): Promise<{ readonly record: WebhookRecord; readonly secret: string }> {
    const url = await assertPublicUrl(input.url, "body.url", this.options.resolveHost);
    if ((await this.list(developerId)).length >= MAX_WEBHOOKS_PER_DEVELOPER) {
      throw new ElyiaHttpError("WEBHOOK_LIMIT", 409, `At most ${MAX_WEBHOOKS_PER_DEVELOPER} webhooks per developer.`);
    }
    const id = `wh_${randomHex(12)}`;
    const secret = `whsec_${randomBase62(32)}`;
    const record: WebhookRecord = {
      id,
      developerId,
      url: url.href,
      events: [...new Set(input.events)],
      networks: input.networks,
      enabled: true,
      createdAt: this.ctx.clock.now(),
      secretSealed: seal(this.secretKey(), secret, `webhook:${id}`),
      secretLast4: secret.slice(-4),
      failures: 0,
    };
    await this.collection().put(`${developerId}:${id}`, record);
    return { record, secret };
  }

  async update(developerId: string, id: string, patch: { readonly enabled?: boolean; readonly events?: readonly WebhookEventType[] }): Promise<WebhookRecord> {
    const current = await this.get(developerId, id);
    const next: WebhookRecord = { ...current, ...(patch.enabled !== undefined ? { enabled: patch.enabled, failures: patch.enabled ? 0 : current.failures } : {}), ...(patch.events ? { events: [...new Set(patch.events)] } : {}) };
    await this.collection().put(`${developerId}:${id}`, next);
    return next;
  }

  async remove(developerId: string, id: string): Promise<boolean> {
    return this.collection().delete(`${developerId}:${id}`);
  }

  async deliveries(developerId: string, id: string, limit = 50): Promise<WebhookDelivery[]> {
    await this.get(developerId, id);
    const rows = await docs<WebhookDelivery>(this.ctx, PLATFORM_COLLECTIONS.webhookDeliveries).list({ prefix: `${id}:`, limit: 1_000 });
    return rows
      .map((row) => row.value)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit);
  }

  /** Sends one `webhook.test` event now (one attempt, logged like any delivery). */
  async test(developerId: string, id: string): Promise<WebhookDelivery> {
    const record = await this.get(developerId, id);
    const event: WebhookEvent = { id: `evt_${randomHex(16)}`, type: "webhook.test", createdAt: new Date(this.ctx.clock.now()).toISOString(), data: { message: "Test delivery from Elyia.", webhookId: id } };
    return this.attempt(record, { webhookId: id, developerId, event, attempt: 1 }, false);
  }

  /** Queues `event` to every enabled webhook of `developerId` subscribed to its type. */
  async publish(developerId: string, event: WebhookEvent, filter?: (record: WebhookRecord) => boolean): Promise<number> {
    if (this.stopped) return 0;
    const targets = (await this.list(developerId)).filter((record) => record.enabled && record.events.includes(event.type as WebhookEventType) && (!filter || filter(record)));
    for (const record of targets) void this.attempt(record, { webhookId: record.id, developerId, event, attempt: 1 }, true).catch(() => undefined);
    return targets.length;
  }

  /** Every developer with a webhook subscribed to `type` (for broadcast events such as launch.new). */
  async subscribers(type: WebhookEventType): Promise<WebhookRecord[]> {
    const rows = await this.collection().list({ limit: 1_000 });
    return rows.map((row) => row.value).filter((record) => record.enabled && record.events.includes(type));
  }

  private async attempt(record: WebhookRecord, job: Job, retry: boolean): Promise<WebhookDelivery> {
    const started = this.ctx.clock.now();
    const body = JSON.stringify(job.event);
    const timestamp = Math.floor(started / 1000);
    let httpStatus: number | null = null;
    let error: string | null = null;
    this.inFlight += 1;
    try {
      if (this.inFlight > MAX_IN_FLIGHT) throw new Error("delivery queue is full");
      const secret = open(this.secretKey(), record.secretSealed, `webhook:${record.id}`);
      const response = await this.transport({
        url: record.url,
        body,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "user-agent": "Elyia-Webhooks/1",
          [WEBHOOK_HEADERS.signature]: signatureHeader(secret, timestamp, body),
          [WEBHOOK_HEADERS.eventId]: job.event.id,
          [WEBHOOK_HEADERS.eventType]: job.event.type,
          [WEBHOOK_HEADERS.webhookId]: record.id,
          [WEBHOOK_HEADERS.attempt]: String(job.attempt),
        },
      });
      httpStatus = response.status;
      if (response.status < 200 || response.status >= 300) error = `HTTP ${response.status}`;
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;
      error = code === "EURLFORBIDDEN" ? "host resolves to a non-public address" : cause instanceof Error ? cause.message.slice(0, 120) : "delivery failed";
    } finally {
      this.inFlight -= 1;
    }
    const ok = error === null;
    const delay = retry && !ok ? this.retryDelays[job.attempt - 1] : undefined;
    const now = this.ctx.clock.now();
    const delivery: WebhookDelivery = {
      id: `dlv_${randomHex(10)}`,
      webhookId: record.id,
      eventId: job.event.id,
      eventType: job.event.type,
      attempt: job.attempt,
      status: ok ? "delivered" : delay !== undefined ? "retrying" : "failed",
      httpStatus,
      durationMs: now - started,
      error,
      at: new Date(now).toISOString(),
      nextAttemptAt: delay !== undefined ? iso(now + delay) : null,
    };
    await docs<WebhookDelivery>(this.ctx, PLATFORM_COLLECTIONS.webhookDeliveries)
      .put(`${record.id}:${String(now).padStart(15, "0")}:${delivery.id}`, delivery, { ttlMs: DELIVERY_LOG_TTL_MS })
      .catch(() => undefined);
    if (ok) this.delivered += 1;
    else this.failed += 1;
    await this.recordOutcome(record, ok);
    if (delay !== undefined && !this.stopped) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.collection()
          .get(`${record.developerId}:${record.id}`)
          .then((doc) => (doc && doc.value.enabled ? this.attempt(doc.value, { ...job, attempt: job.attempt + 1 }, true) : null))
          .catch(() => undefined);
      }, delay);
      timer.unref();
      this.timers.add(timer);
    }
    return delivery;
  }

  private async recordOutcome(record: WebhookRecord, ok: boolean): Promise<void> {
    const collection = this.collection();
    const doc = await collection.get(`${record.developerId}:${record.id}`).catch(() => null);
    if (!doc) return;
    const failures = ok ? 0 : doc.value.failures + 1;
    if (failures === doc.value.failures) return;
    await collection.compareAndSet(doc.id, doc.version, { ...doc.value, failures, enabled: failures >= PAUSE_AFTER_FAILURES ? false : doc.value.enabled }).catch(() => null);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
