/**
 * Wire contract of the developer platform: API keys with scopes, quotas and
 * usage metering, signed webhooks, integrator fees, the embeddable widget and
 * the MCP endpoint. Import as `@elyia/core/api/developers`.
 *
 * Keys are shown once (`plainKey`) and stored hashed. Requests send them as
 * `Authorization: Bearer ely_...` (or the `Elyia-Key` header). A key can plan
 * and prepare unsigned payloads; nothing the platform offers can sign or
 * move funds.
 */
import type { NetworkKey } from "../networks.js";

export const DEVELOPERS_API_VERSION = "elyia.api.developers/v1" as const;

export const API_KEY_HEADER = "Elyia-Key" as const;
/** Key prefixes: live keys plan on the server's mode; the prefix only names the key's purpose. */
export const API_KEY_PREFIX = "ely_" as const;

export const API_KEY_SCOPES = Object.freeze(["read", "plan", "execute-prepare", "webhooks"] as const);
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const USAGE_METRICS = Object.freeze(["requests", "plans", "prepares"] as const);
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface KeyQuotas {
  /** Per UTC day. */
  readonly requestsPerDay: number;
  readonly plansPerDay: number;
  readonly preparesPerDay: number;
  /** Burst limit per minute. */
  readonly requestsPerMinute: number;
}

export const DEFAULT_KEY_QUOTAS: KeyQuotas = Object.freeze({ requestsPerDay: 50_000, plansPerDay: 5_000, preparesPerDay: 2_000, requestsPerMinute: 300 });
export const MAX_KEY_QUOTAS: KeyQuotas = Object.freeze({ requestsPerDay: 1_000_000, plansPerDay: 100_000, preparesPerDay: 50_000, requestsPerMinute: 3_000 });
export const MAX_KEYS_PER_DEVELOPER = 10;

export interface DeveloperProfile {
  readonly id: string;
  readonly address: string;
  readonly name: string | null;
  readonly createdAt: string;
}

/** POST /v1/developers/register. */
export interface RegisterDeveloperRequest {
  readonly name?: string;
}

export interface ApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly quotas: KeyQuotas;
  /** Last four characters of the secret, to tell keys apart. */
  readonly last4: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

/** POST /v1/developers/keys. */
export interface CreateKeyRequest {
  readonly name: string;
  readonly scopes?: readonly ApiKeyScope[];
  readonly quotas?: Partial<KeyQuotas>;
}

export interface CreateKeyResponse {
  readonly key: ApiKeyView;
  /** Shown once; Elyia stores only its SHA-256. */
  readonly plainKey: string;
}

export interface ApiKeyListResponse {
  readonly keys: readonly ApiKeyView[];
}

/** GET /v1/developers/usage?days=1..30. */
export interface UsageDay {
  readonly day: string;
  readonly requests: number;
  readonly plans: number;
  readonly prepares: number;
}

export interface KeyUsage {
  readonly keyId: string;
  readonly name: string;
  readonly quotas: KeyQuotas;
  readonly days: readonly UsageDay[];
}

export interface UsageResponse {
  readonly developerId: string;
  readonly keys: readonly KeyUsage[];
  readonly totals: UsageDay;
}

/* ------------------------------------------------------------- webhooks */

export const WEBHOOK_EVENT_TYPES = Object.freeze(["intent.step.settled", "intent.failed", "alert.fired", "launch.new"] as const);
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Delivery headers. The signature is `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. */
export const WEBHOOK_HEADERS = Object.freeze({
  signature: "Elyia-Signature",
  eventId: "Elyia-Event-Id",
  eventType: "Elyia-Event-Type",
  webhookId: "Elyia-Webhook-Id",
  attempt: "Elyia-Delivery-Attempt",
} as const);
/** Receivers should refuse signatures older than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const WEBHOOK_RETRY_DELAYS_MS = Object.freeze([1_000, 5_000, 25_000, 125_000] as const);
export const MAX_WEBHOOKS_PER_DEVELOPER = 10;

/** The string a webhook signature covers. */
export function webhookSignedPayload(timestamp: number, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export interface WebhookEvent<T = unknown> {
  readonly id: string;
  readonly type: WebhookEventType | "webhook.test";
  readonly createdAt: string;
  readonly data: T;
}

export interface WebhookView {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEventType[];
  /** For `launch.new`: networks to follow (default the mode's Elysium). */
  readonly networks: readonly NetworkKey[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly secretLast4: string;
  /** Consecutive failed deliveries (the webhook is paused at 20). */
  readonly failures: number;
}

/** POST /v1/developers/webhooks. */
export interface CreateWebhookRequest {
  readonly url: string;
  readonly events: readonly WebhookEventType[];
  readonly networks?: readonly NetworkKey[];
}

export interface CreateWebhookResponse {
  readonly webhook: WebhookView;
  /** `whsec_...`, shown once. */
  readonly secret: string;
}

export interface WebhookListResponse {
  readonly webhooks: readonly WebhookView[];
}

export interface WebhookDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly attempt: number;
  readonly status: "delivered" | "failed" | "retrying";
  readonly httpStatus: number | null;
  readonly durationMs: number | null;
  /** Short reason, never the receiver's body. */
  readonly error: string | null;
  readonly at: string;
  readonly nextAttemptAt: string | null;
}

export interface WebhookDeliveriesResponse {
  readonly deliveries: readonly WebhookDelivery[];
}

/* ------------------------------------------------- integrator fee, widget */

/** Integrator fee cap (basis points). The router enforces its own cap on chain as well. */
export const MAX_INTEGRATOR_FEE_BPS = 50;

export interface IntegratorFeeConfig {
  readonly feeBps: number;
  /** Receives the fee through ElyiaRouter's integrator fee path. */
  readonly recipient: string | null;
  readonly updatedAt: string | null;
  /** Shown to end users on every route card that carries it. */
  readonly disclosure: { readonly en: string; readonly tr: string };
}

export interface WidgetTheme {
  readonly mode: "light" | "dark" | "auto";
  /** `#rrggbb`. */
  readonly accent: string | null;
  readonly radius: "pixel" | "soft";
  readonly locale: "en" | "tr" | "auto";
}

export interface WidgetConfig {
  readonly developerId: string;
  readonly allowedOrigins: readonly string[];
  readonly theme: WidgetTheme;
  /** Networks the widget offers (subset of the mode's). */
  readonly networks: readonly NetworkKey[];
  readonly fee: IntegratorFeeConfig;
  readonly updatedAt: string | null;
}

/* ------------------------------------------------------------------ MCP */

export const MCP_TOOL_NAMES = Object.freeze([
  "get_networks",
  "get_markets",
  "get_market",
  "get_portfolio",
  "get_protocols",
  "get_venues",
  "plan_intent",
  "get_intent",
  "shield",
  "create_signing_link",
] as const);
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
