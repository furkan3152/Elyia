/**
 * Browser fallback for the pulse: polls Elysium's public JSON-RPC directly
 * (the endpoints send `Access-Control-Allow-Origin: *`) when the Elyia API
 * cannot be reached, so the Sun keeps living. One small batched request per
 * poll; a gap between polls is filled with one more batch (newest 8 blocks).
 *
 * Endpoint hygiene, mirroring the API: an endpoint that answers far below the
 * best head seen is stale (one public Elysium endpoint has been observed
 * millions of blocks behind) and is skipped for five minutes; rate limits slow
 * the poll down and rotate to the next endpoint.
 */
import type { NetworkKey } from "@elyia/core/networks";
import type { PulseBlock } from "@elyia/core/pulse";

import { isRateLimited, missingBlockNumbers, rpcBlockToPulseBlock } from "./rpcBlock";

export interface RpcPollerOptions {
  readonly network: NetworkKey;
  readonly urls: readonly string[];
  readonly onBlocks: (blocks: readonly PulseBlock[]) => void;
  readonly onHealth?: (health: RpcHealth) => void;
  readonly intervalMs?: number;
}

export type RpcHealth = "ok" | "degraded" | "down";

const CALL_TIMEOUT_MS = 2_500;
const MAX_INTERVAL_MS = 4_000;
const STALE_LAG_BLOCKS = 500;
const STALE_SKIP_MS = 5 * 60_000;
const MAX_GAP_FILL = 8;
const DOWN_AFTER_FAILURES = 6;

interface Endpoint {
  readonly url: string;
  skipUntil: number;
}

class RpcFailure extends Error {
  constructor(
    readonly rateLimited: boolean,
    message: string,
  ) {
    super(message);
  }
}

async function batch(url: string, calls: ReadonlyArray<{ method: string; params: readonly unknown[] }>): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params }))),
      signal: controller.signal,
      credentials: "omit",
    });
    if (response.status === 429) throw new RpcFailure(true, "rate limited");
    if (!response.ok) throw new RpcFailure(false, `HTTP ${response.status}`);
    const body: unknown = await response.json();
    const items = Array.isArray(body) ? body : [body];
    const byId = new Map<number, unknown>();
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as { id?: unknown; result?: unknown; error?: unknown };
      if (record.error !== undefined) throw new RpcFailure(isRateLimited(record.error), "rpc error");
      if (typeof record.id === "number") byId.set(record.id, record.result);
    }
    return calls.map((_, index) => byId.get(index + 1) ?? null);
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    throw new RpcFailure(false, error instanceof Error ? error.message : "transport error");
  } finally {
    clearTimeout(timer);
  }
}

export class ElysiumRpcPoller {
  private readonly endpoints: Endpoint[];
  private readonly baseInterval: number;
  private interval: number;
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastNumber: number | null = null;
  private bestHead = 0;
  private failures = 0;
  private health: RpcHealth = "ok";

  constructor(private readonly options: RpcPollerOptions) {
    this.endpoints = options.urls.map((url) => ({ url, skipUntil: 0 }));
    this.baseInterval = options.intervalMs ?? 250;
    this.interval = this.baseInterval;
  }

  start(): void {
    if (this.running || this.endpoints.length === 0) {
      if (this.endpoints.length === 0) this.setHealth("down");
      return;
    }
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setHealth(health: RpcHealth) {
    if (this.health === health) return;
    this.health = health;
    this.options.onHealth?.(health);
  }

  private endpoint(now: number): Endpoint | null {
    for (let offset = 0; offset < this.endpoints.length; offset += 1) {
      const candidate = this.endpoints[(this.cursor + offset) % this.endpoints.length]!;
      if (candidate.skipUntil <= now) {
        this.cursor = (this.cursor + offset) % this.endpoints.length;
        return candidate;
      }
    }
    return null;
  }

  private rotate() {
    this.cursor = (this.cursor + 1) % this.endpoints.length;
  }

  private schedule(delay: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), Math.max(0, delay));
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const startedAt = Date.now();
    const endpoint = this.endpoint(startedAt);
    if (!endpoint) {
      // Every endpoint is cooling down: wait for the first to come back.
      const wake = Math.min(...this.endpoints.map((candidate) => candidate.skipUntil)) - startedAt;
      this.setHealth("down");
      this.schedule(Math.min(Math.max(wake, 1_000), 30_000));
      return;
    }
    try {
      const [latestRaw] = await batch(endpoint.url, [{ method: "eth_getBlockByNumber", params: ["latest", false] }]);
      const seenAt = Date.now();
      const latest = rpcBlockToPulseBlock(latestRaw, this.options.network, seenAt);
      if (!latest) throw new RpcFailure(false, "malformed block");
      if (this.bestHead - latest.number > STALE_LAG_BLOCKS) {
        endpoint.skipUntil = seenAt + STALE_SKIP_MS;
        this.rotate();
        this.schedule(0);
        return;
      }
      this.bestHead = Math.max(this.bestHead, latest.number);
      const blocks: PulseBlock[] = [];
      const gap = missingBlockNumbers(this.lastNumber, latest.number - 1, MAX_GAP_FILL - 1);
      if (this.lastNumber !== null && gap.length > 0) {
        const raws = await batch(
          endpoint.url,
          gap.map((n) => ({ method: "eth_getBlockByNumber", params: [`0x${n.toString(16)}`, false] })),
        );
        // Gap blocks were revealed by the same poll as `latest`: they share its discovery time,
        // never a later one (a later stamp would make an older block look younger than its successor).
        for (const raw of raws) {
          const block = rpcBlockToPulseBlock(raw, this.options.network, seenAt);
          if (block) blocks.push(block);
        }
      }
      if (this.lastNumber === null || latest.number > this.lastNumber) blocks.push(latest);
      if (blocks.length > 0) {
        this.lastNumber = Math.max(this.lastNumber ?? 0, ...blocks.map((block) => block.number));
        this.options.onBlocks(blocks);
      }
      this.failures = 0;
      this.interval = Math.max(this.baseInterval, Math.round(this.interval * 0.8));
      this.setHealth("ok");
    } catch (error) {
      this.failures += 1;
      const rateLimited = error instanceof RpcFailure && error.rateLimited;
      this.interval = Math.min(MAX_INTERVAL_MS, rateLimited ? this.interval * 2 : this.interval + 250);
      this.rotate();
      this.setHealth(this.failures >= DOWN_AFTER_FAILURES ? "down" : "degraded");
    }
    this.schedule(this.interval - (Date.now() - startedAt));
  }
}
