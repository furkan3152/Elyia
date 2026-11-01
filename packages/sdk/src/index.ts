/**
 * @elyia/sdk: a typed client for the Elyia public API.
 *
 *   const elyia = new ElyiaClient({ apiKey: process.env.ELYIA_API_KEY });
 *   const plan = await elyia.plan({ accounts: [`eip155:99801:${address}`], actions: [...] , dryRun: true });
 *
 * Elyia never signs. `prepare` returns unsigned payloads; your user's wallet
 * signs them and `submit` hands back only the references (tx hashes,
 * HyperCore cloids/nonces), which the server verifies on chain.
 */
import type { CreateIntentBody, CreateIntentResponse, IntentStreamEvent, PrepareStepBody, PrepareStepResponse, StopIntentResponse, SubmitStepResponse, VenuesResponse } from "@elyia/core/api/intents";
import type { ProtocolListResponse, ShieldReport } from "@elyia/core/api/discovery";
import type { PortfolioMode, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import type { ParseIntentResponse } from "@elyia/core/api/language";
import type { InsightsResponse } from "@elyia/core/api/agent";
import type { ApiKeyListResponse, UsageResponse, WidgetConfig } from "@elyia/core/api/developers";
import type { ContractsConfigResponse } from "@elyia/core/api/admin";
import type { IntentGraph, Journey, NetworkKey } from "@elyia/core";
import { readSse, type SseMessage } from "./sse.js";

export { readSse, type SseMessage } from "./sse.js";
export { signWebhookPayload, verifyWebhook, WebhookSignatureError } from "./webhooks.js";
export const ELYIA_SDK_VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://api.elyia.app";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ElyiaClientOptions {
  /** API base URL (no trailing /v1). */
  readonly baseUrl?: string;
  /** `ely_...` key from the developer portal (server-side only: never ship it to a browser). */
  readonly apiKey?: string;
  /** A wallet session token (`Elyia-Session`), for user-scoped routes. */
  readonly session?: string;
  readonly fetch?: FetchLike;
  /** Per-request timeout in ms (default 30 s; streams are not timed out). */
  readonly timeoutMs?: number;
  /** Retries for 429 / 503 with Retry-After (default 2). */
  readonly retries?: number;
}

/** The API's error envelope as an exception. */
export class ElyiaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ElyiaApiError";
  }
}

export interface PlanInput extends Omit<CreateIntentBody, "dryRun"> {
  readonly dryRun?: boolean;
}

export interface ChatEvent {
  readonly event: string;
  readonly data: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ElyiaClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ElyiaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      ...(this.options.session ? { "Elyia-Session": this.options.session } : {}),
      ...extra,
    };
  }

  /** One JSON request with the error envelope mapped to ElyiaApiError and bounded retries on 429/503. */
  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) search.set(key, String(value));
    const url = `${this.baseUrl}/v1${path}${search.size > 0 ? `?${search.toString()}` : ""}`;
    const retries = this.options.retries ?? 2;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method,
        headers: this.headers(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
      if ((response.status === 429 || response.status === 503) && attempt < retries) {
        const after = Number(response.headers.get("retry-after") ?? "1");
        await sleep(Math.min(10, Number.isFinite(after) ? after : 1) * 1000);
        continue;
      }
      const text = await response.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        const error = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } } | null)?.error;
        throw new ElyiaApiError(response.status, error?.code ?? "HTTP_ERROR", error?.message ?? `HTTP ${response.status}`, error?.details ?? null, error?.requestId ?? null);
      }
      return json as T;
    }
  }

  private async *stream(method: string, path: string, body?: unknown, signal?: AbortSignal): AsyncGenerator<SseMessage> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1${path}`, {
      method,
      headers: this.headers({ accept: "text/event-stream", ...(body !== undefined ? { "content-type": "application/json" } : {}) }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) {
      const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new ElyiaApiError(response.status, json?.error?.code ?? "HTTP_ERROR", json?.error?.message ?? `HTTP ${response.status}`, null, null);
    }
    yield* readSse(response.body, signal);
  }

  /* ------------------------------------------------------------ intents */

  /** Reads a sentence (EN/TR) into goals and questions. Never plans or signs. */
  parse(text: string, options: { readonly locale?: "en" | "tr"; readonly thread?: string } = {}): Promise<ParseIntentResponse> {
    return this.request("POST", "/intents/parse", { text, ...options });
  }

  /** Plans an intent through the venue auction and the Rule Book (stored unless `dryRun`). */
  plan(input: PlanInput): Promise<CreateIntentResponse> {
    return this.request("POST", "/intents", input, input.dryRun ? { dryRun: true } : undefined);
  }

  intent(id: string): Promise<IntentGraph> {
    return this.request("GET", `/intents/${encodeURIComponent(id)}`);
  }

  journey(id: string): Promise<Journey> {
    return this.request("GET", `/intents/${encodeURIComponent(id)}/journey`);
  }

  /** Unsigned requests for one step: hand them to the user's wallet. */
  prepare(intentId: string, stepId: string, body: PrepareStepBody = {}): Promise<PrepareStepResponse> {
    return this.request("POST", `/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/prepare`, body);
  }

  /** References only (tx hashes, `hc:cloid:...`, `hc:nonce:...`), verified on chain. */
  submit(intentId: string, stepId: string, references: readonly string[]): Promise<SubmitStepResponse> {
    return this.request("POST", `/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/submit`, { references });
  }

  stop(intentId: string): Promise<StopIntentResponse> {
    return this.request("POST", `/intents/${encodeURIComponent(intentId)}/stop`, {});
  }

  /** Live intent events (snapshot first, then created / step_updated / status_changed). */
  async *journeyStream(intentId: string, signal?: AbortSignal): AsyncGenerator<IntentStreamEvent | { readonly type: "intent.snapshot"; readonly data: IntentGraph }> {
    for await (const message of this.stream("GET", `/intents/${encodeURIComponent(intentId)}/stream`, undefined, signal)) {
      yield message.event === "intent.snapshot" ? { type: "intent.snapshot", data: message.data as IntentGraph } : (message.data as IntentStreamEvent);
    }
  }

  /* ------------------------------------------------------------- reads */

  venues(query: { readonly network?: NetworkKey; readonly kind?: string; readonly status?: "live" | "read-only" | "unavailable" } = {}): Promise<VenuesResponse> {
    return this.request("GET", "/venues", undefined, query);
  }

  protocols(query: { readonly network?: NetworkKey; readonly kind?: string; readonly q?: string; readonly executable?: boolean; readonly view?: "full" | "summary" } = {}): Promise<ProtocolListResponse> {
    return this.request("GET", "/protocols", undefined, query);
  }

  portfolio(address: string, mode?: PortfolioMode): Promise<PortfolioSnapshot> {
    return this.request("GET", `/portfolio/${encodeURIComponent(address)}`, undefined, { mode });
  }

  shield(token: string, network?: NetworkKey): Promise<ShieldReport> {
    return this.request("GET", `/discovery/shield/${encodeURIComponent(token)}`, undefined, { network });
  }

  insights(address: string): Promise<InsightsResponse> {
    return this.request("GET", `/agent/insights/${encodeURIComponent(address)}`);
  }

  contracts(network?: NetworkKey): Promise<ContractsConfigResponse> {
    return this.request("GET", "/config/contracts", undefined, { network });
  }

  widget(developerId: string): Promise<WidgetConfig> {
    return this.request("GET", `/widget/${encodeURIComponent(developerId)}`);
  }

  /* ------------------------------------------------------- developers */

  usage(days = 7): Promise<UsageResponse> {
    return this.request("GET", "/developers/usage", undefined, { days });
  }

  keys(): Promise<ApiKeyListResponse> {
    return this.request("GET", "/developers/keys");
  }

  /* --------------------------------------------------------------- Ely */

  /** Chat with Ely (SSE): thread, token, tool_call, tool_result, proposal, route_card, note, done, error. */
  async *chat(input: { readonly message: string; readonly address?: string; readonly threadId?: string; readonly locale?: "en" | "tr" }, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    for await (const message of this.stream("POST", "/agent/chat", input, signal)) yield { event: message.event, data: message.data };
  }
}
