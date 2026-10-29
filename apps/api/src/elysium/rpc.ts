/**
 * Minimal JSON-RPC client over several endpoints of one chain, for the hot
 * Elysium poll loop (viem's fallback transport cannot reject a lagging
 * endpoint). Endpoints are tried in preference order; a failing endpoint
 * cools down (exponential, per endpoint) and the next one is used, and the
 * preferred one is retried once its cooldown ends. A caller can reject an
 * answer (`accept`), which marks that endpoint stale (it lags the chain) and
 * moves on: one of the public Elysium endpoints has been observed millions
 * of blocks behind the others.
 */
import type { FetchLike } from "../hyperliquid/info.js";

export const RPC_CALL_TIMEOUT_MS = 2_500;
const COOLDOWN_BASE_MS = 500;
const COOLDOWN_MAX_MS = 30_000;
export const STALE_COOLDOWN_MS = 5 * 60_000;

export type RpcErrorKind = "rate_limited" | "http" | "timeout" | "transport" | "rpc" | "invalid" | "stale";

export class RpcError extends Error {
  constructor(
    readonly kind: RpcErrorKind,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

interface Endpoint {
  readonly url: string;
  /** scheme://host only: endpoint paths may carry API keys. */
  readonly label: string;
  failures: number;
  cooldownUntil: number;
  staleUntil: number;
  lastLatencyMs: number | null;
  lastError: RpcErrorKind | null;
}

export interface EndpointStatus {
  readonly endpoint: string;
  readonly available: boolean;
  readonly stale: boolean;
  readonly failures: number;
  readonly lastLatencyMs: number | null;
  readonly lastError: RpcErrorKind | null;
}

export interface JsonRpcEndpointsOptions {
  readonly urls: readonly string[];
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** scheme://host[:port] of an endpoint URL (never its path or query). */
export function endpointLabel(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid-url";
  }
}

function isRateLimitRpcError(error: { code?: unknown; message?: unknown }): boolean {
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return error.code === -32005 || error.code === 429 || message.includes("rate limit") || message.includes("too many requests");
}

interface RpcResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

export class JsonRpcEndpoints {
  private readonly endpoints: Endpoint[];
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private nextId = 1;
  private lastAnsweredLabel: string | null = null;

  constructor(options: JsonRpcEndpointsOptions) {
    if (options.urls.length === 0) throw new TypeError("JsonRpcEndpoints needs at least one URL");
    this.endpoints = options.urls.map((url) => ({
      url,
      label: endpointLabel(url),
      failures: 0,
      cooldownUntil: 0,
      staleUntil: 0,
      lastLatencyMs: null,
      lastError: null,
    }));
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? RPC_CALL_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.endpoints.length;
  }

  /** Label of the endpoint that answered the last successful call or batch. */
  get lastAnswered(): string | null {
    return this.lastAnsweredLabel;
  }

  /** Label of the endpoint the next call would use. */
  get active(): string {
    return this.order()[0]?.label ?? "none";
  }

  status(): EndpointStatus[] {
    const now = this.now();
    return this.endpoints.map((endpoint) => ({
      endpoint: endpoint.label,
      available: endpoint.cooldownUntil <= now && endpoint.staleUntil <= now,
      stale: endpoint.staleUntil > now,
      failures: endpoint.failures,
      lastLatencyMs: endpoint.lastLatencyMs,
      lastError: endpoint.lastError,
    }));
  }

  /** Healthy endpoints in preference order, then the rest by how soon they recover. */
  private order(): Endpoint[] {
    const now = this.now();
    const ready = this.endpoints.filter((endpoint) => endpoint.cooldownUntil <= now && endpoint.staleUntil <= now);
    const waiting = this.endpoints
      .filter((endpoint) => !ready.includes(endpoint))
      .sort((a, b) => Math.max(a.cooldownUntil, a.staleUntil) - Math.max(b.cooldownUntil, b.staleUntil));
    return [...ready, ...waiting];
  }

  private fail(endpoint: Endpoint, error: RpcError): void {
    endpoint.failures += 1;
    endpoint.lastError = error.kind;
    const backoff = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** Math.min(endpoint.failures - 1, 10));
    endpoint.cooldownUntil = this.now() + Math.max(backoff, error.retryAfterMs ?? 0);
  }

  private succeed(endpoint: Endpoint, latencyMs: number): void {
    endpoint.failures = 0;
    endpoint.lastError = null;
    endpoint.cooldownUntil = 0;
    endpoint.lastLatencyMs = latencyMs;
  }

  /** Marks an endpoint (by URL or label) as lagging the chain; it is skipped while others are healthy. */
  markStale(urlOrLabel: string, ms = STALE_COOLDOWN_MS): void {
    for (const endpoint of this.endpoints) {
      if (endpoint.url === urlOrLabel || endpoint.label === urlOrLabel) {
        endpoint.staleUntil = this.now() + ms;
        endpoint.lastError = "stale";
      }
    }
  }

  private async post(endpoint: Endpoint, body: unknown): Promise<unknown> {
    const started = this.now();
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RpcError(timedOut ? "timeout" : "transport", timedOut ? "RPC timeout" : "RPC transport failure");
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      const header = response.headers.get("retry-after");
      const seconds = header && /^\d{1,5}$/u.test(header.trim()) ? Number(header.trim()) : null;
      throw new RpcError("rate_limited", "RPC rate limited", seconds === null ? 2_000 : seconds * 1000);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RpcError("http", `RPC HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new RpcError("invalid", "RPC answered with invalid JSON");
    }
    endpoint.lastLatencyMs = this.now() - started;
    return parsed;
  }

  private itemResult(item: RpcResponse | undefined): unknown {
    if (!item || typeof item !== "object") throw new RpcError("invalid", "RPC response missing");
    if (item.error) {
      if (isRateLimitRpcError(item.error)) throw new RpcError("rate_limited", "RPC rate limited", 2_000);
      throw new RpcError("rpc", `RPC error ${typeof item.error.code === "number" ? item.error.code : ""}`.trim());
    }
    if (!("result" in item)) throw new RpcError("invalid", "RPC response without result");
    return item.result;
  }

  /**
   * One call, trying endpoints in order until one answers (and `accept`
   * approves the answer). Throws the last RpcError when none does.
   */
  async call<T>(method: string, params: readonly unknown[] = [], accept?: (value: T) => boolean): Promise<T> {
    const [value] = await this.run<T>([{ method, params }], accept ? (values) => accept(values[0] as T) : undefined);
    return value as T;
  }

  /**
   * Several calls in one HTTP request (a JSON-RPC batch), results in call
   * order. `accept` may reject an endpoint's answers (it is marked stale and
   * the next endpoint is tried).
   */
  async batch<T>(calls: readonly RpcCall[], accept?: (values: readonly T[]) => boolean): Promise<T[]> {
    if (calls.length === 0) return [];
    return this.run<T>(calls, accept);
  }

  /** eth_blockNumber on every endpoint in parallel (endpoint census); null where it failed. */
  async headsByEndpoint(): Promise<Array<{ readonly endpoint: string; readonly head: number | null }>> {
    return Promise.all(
      this.endpoints.map(async (endpoint) => {
        try {
          const value = this.itemResult((await this.post(endpoint, { jsonrpc: "2.0", id: this.nextId++, method: "eth_blockNumber", params: [] })) as RpcResponse);
          return { endpoint: endpoint.label, head: typeof value === "string" ? Number.parseInt(value, 16) : null };
        } catch {
          return { endpoint: endpoint.label, head: null };
        }
      }),
    );
  }

  private async run<T>(calls: readonly RpcCall[], accept?: (values: readonly T[]) => boolean): Promise<T[]> {
    let lastError: RpcError = new RpcError("transport", "no RPC endpoint answered");
    for (const endpoint of this.order()) {
      const ids = calls.map(() => this.nextId++);
      const single = calls.length === 1;
      const body = single
        ? { jsonrpc: "2.0", id: ids[0], method: calls[0]?.method, params: calls[0]?.params ?? [] }
        : calls.map((call, index) => ({ jsonrpc: "2.0", id: ids[index], method: call.method, params: call.params }));
      try {
        const started = this.now();
        const parsed = await this.post(endpoint, body);
        let values: T[];
        if (single) {
          values = [this.itemResult(parsed as RpcResponse) as T];
        } else {
          if (!Array.isArray(parsed)) throw new RpcError("invalid", "RPC batch answered with a non-array");
          const byId = new Map<unknown, RpcResponse>();
          for (const item of parsed as RpcResponse[]) byId.set(item?.id, item);
          values = ids.map((id) => this.itemResult(byId.get(id)) as T);
        }
        if (accept && !accept(values)) {
          this.markStale(endpoint.url);
          lastError = new RpcError("stale", "RPC endpoint lags the chain");
          continue;
        }
        this.succeed(endpoint, this.now() - started);
        this.lastAnsweredLabel = endpoint.label;
        return values;
      } catch (error) {
        const rpcError = error instanceof RpcError ? error : new RpcError("transport", "RPC failure");
        this.fail(endpoint, rpcError);
        lastError = rpcError;
      }
    }
    throw lastError;
  }
}
