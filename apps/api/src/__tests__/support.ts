/**
 * Test harness: config, an ephemeral HTTP server, a URL-routed fake fetch, a
 * simulated Elysium JSON-RPC chain and an SSE reader. Not a test file itself
 * (the runner only picks up *.test.ts).
 */
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { loadConfig, type Config } from "../config.js";
import type { FetchLike } from "../hyperliquid/info.js";

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: "test", ELYIA_LOG_LEVEL: "silent", ...env });
}

export interface Served {
  readonly url: string;
  close(): Promise<void>;
}

export async function serve(app: Express): Promise<Served> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export type FakeHandler = (body: unknown, init: RequestInit, url: string) => Response | Promise<Response>;

/** A fetch that dispatches on URL prefix; unknown URLs fail like a network error. */
export function routedFetch(routes: Record<string, FakeHandler>): FetchLike & { readonly calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (input, init) => {
    calls.push(input);
    const signal = init.signal;
    if (signal?.aborted) throw signal.reason;
    const prefix = Object.keys(routes)
      .filter((candidate) => input.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (!prefix) throw new TypeError(`fetch failed: no fake route for ${input}`);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    return (routes[prefix] as FakeHandler)(body, init, input);
  };
  return Object.assign(fn, { calls });
}

interface RpcRequest {
  readonly id: unknown;
  readonly method: string;
  readonly params?: readonly unknown[];
}

/**
 * A simulated Nitro chain behind a JSON-RPC endpoint: `advance(n)` produces
 * blocks with one ArbOS internal tx plus `userTxs` user txs each.
 */
export class FakeChain {
  head: number;
  chainId: number;
  userTxs = 2;
  gasUsed = 100_000;
  baseFeeWei = 100_000_000n;
  l1Block = 68_000_000;
  requests: RpcRequest[] = [];
  /** Set to make the endpoint fail: an HTTP status, or "reset" for a transport error. */
  failure: number | "reset" | null = null;

  constructor(head = 1_000, chainId = 99_801) {
    this.head = head;
    this.chainId = chainId;
  }

  advance(blocks = 1): void {
    this.head += blocks;
  }

  header(number: number): Record<string, unknown> | null {
    if (number > this.head || number < 0) return null;
    return {
      number: `0x${number.toString(16)}`,
      hash: `0x${number.toString(16).padStart(64, "0")}`,
      parentHash: `0x${(number - 1).toString(16).padStart(64, "0")}`,
      timestamp: `0x${(1_800_000_000 + Math.floor(number / 8)).toString(16)}`,
      gasUsed: `0x${this.gasUsed.toString(16)}`,
      baseFeePerGas: `0x${this.baseFeeWei.toString(16)}`,
      l1BlockNumber: `0x${this.l1Block.toString(16)}`,
      transactions: Array.from({ length: 1 + this.userTxs }, (_, index) => `0x${(number * 10 + index).toString(16).padStart(64, "0")}`),
    };
  }

  private answer(request: RpcRequest): Record<string, unknown> {
    this.requests.push(request);
    const base = { jsonrpc: "2.0", id: request.id };
    switch (request.method) {
      case "eth_chainId":
        return { ...base, result: `0x${this.chainId.toString(16)}` };
      case "eth_blockNumber":
        return { ...base, result: `0x${this.head.toString(16)}` };
      case "eth_getBlockByNumber": {
        const tag = request.params?.[0];
        const number = tag === "latest" ? this.head : typeof tag === "string" ? Number.parseInt(tag, 16) : -1;
        return { ...base, result: this.header(number) };
      }
      default:
        return { ...base, error: { code: -32601, message: "method not found" } };
    }
  }

  handler: FakeHandler = (body) => {
    if (this.failure === "reset") throw new TypeError("fetch failed");
    if (typeof this.failure === "number") return new Response("upstream down", { status: this.failure });
    if (Array.isArray(body)) return json((body as RpcRequest[]).map((request) => this.answer(request)));
    return json(this.answer(body as RpcRequest));
  };
}

export interface SseMessage {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
  readonly retry?: number;
}

/** Parses an SSE text stream into messages (comments dropped). */
export function parseSse(text: string): SseMessage[] {
  const out: SseMessage[] = [];
  for (const chunk of text.split("\n\n")) {
    if (!chunk.trim()) continue;
    let event = "message";
    const data: string[] = [];
    let id: string | undefined;
    let retry: number | undefined;
    let any = false;
    for (const line of chunk.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /u, "");
      any = true;
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
      else if (field === "retry") retry = Number(value);
    }
    // As in EventSource, a block without data lines (e.g. only `retry:`) dispatches no event.
    if (any && data.length > 0) out.push({ event, data: data.join("\n"), ...(id !== undefined ? { id } : {}), ...(retry !== undefined ? { retry } : {}) });
  }
  return out;
}

/** Reads an SSE response until `until(messages)` is true or the timeout passes, then aborts. */
export async function readSse(
  url: string,
  until: (messages: SseMessage[]) => boolean,
  options: { readonly timeoutMs?: number; readonly headers?: Record<string, string> } = {},
): Promise<{ readonly status: number; readonly headers: Headers; readonly messages: SseMessage[]; readonly raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  const response = await fetch(url, { signal: controller.signal, headers: options.headers ?? {} });
  let raw = "";
  let messages: SseMessage[] = [];
  try {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      messages = parseSse(raw.slice(0, raw.lastIndexOf("\n\n") + 2));
      if (until(messages)) break;
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { status: response.status, headers: response.headers, messages, raw };
}

export async function waitFor(condition: () => boolean, timeoutMs = 2_000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
