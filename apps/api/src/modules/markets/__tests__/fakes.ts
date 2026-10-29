/**
 * Test fakes for the ledger modules (markets + portfolio): recorded fixtures, a
 * HyperCore info endpoint that answers by request type, a hand-driven
 * WebSocket and an EVM reader. Not a test file (the runner picks up *.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORKS } from "@elyia/core";
import type { EvmChains, TokenBalance } from "../../../chains/evm.js";
import type { SocketLike } from "../../../hyperliquid/ws.js";
import { json, type FakeHandler } from "../../../__tests__/support.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A recorded fixture of this area (`markets/__tests__/fixtures` or `portfolio/__tests__/fixtures`). */
export function fixture<T = unknown>(name: string, area: "markets" | "portfolio" = "markets"): T {
  const dir = area === "markets" ? join(HERE, "fixtures") : join(HERE, "..", "..", "portfolio", "__tests__", "fixtures");
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

export const TESTNET_INFO = (NETWORKS["hypercore-testnet"] as { infoUrl: string }).infoUrl;
export const MAINNET_INFO = (NETWORKS["hypercore-mainnet"] as { infoUrl: string }).infoUrl;

export type InfoBody = { readonly type: string } & Record<string, unknown>;
export type InfoAnswer = (body: InfoBody) => unknown;

/**
 * An info endpoint: `answers[type]` is a value or a function of the body;
 * unknown types answer 422 like HyperCore does for bodies it cannot parse.
 */
export function infoEndpoint(answers: Record<string, unknown>, calls: InfoBody[] = []): FakeHandler {
  return (body) => {
    const request = body as InfoBody;
    calls.push(request);
    if (!(request.type in answers)) return new Response("Failed to deserialize the JSON body into the target type", { status: 422 });
    const answer = answers[request.type];
    return json(typeof answer === "function" ? (answer as InfoAnswer)(request) : answer);
  };
}

/** The recorded testnet market answers (meta, spot, dexes, book, trades, candles, fundings). */
export function testnetMarketAnswers(): Record<string, unknown> {
  const metaCtxs = fixture<[unknown, unknown]>("testnet-meta-ctxs.json");
  const spotCtxs = fixture<[unknown, unknown]>("testnet-spot-ctxs.json");
  return {
    meta: metaCtxs[0],
    metaAndAssetCtxs: metaCtxs,
    spotMeta: spotCtxs[0],
    spotMetaAndAssetCtxs: spotCtxs,
    perpDexs: fixture("testnet-perp-dexs.json"),
    allPerpMetas: fixture("testnet-all-perp-metas.json"),
    predictedFundings: fixture("testnet-predicted-fundings.json"),
    l2Book: fixture("testnet-l2book-btc.json"),
    recentTrades: fixture("testnet-trades-btc.json"),
    candleSnapshot: fixture("testnet-candles-btc.json"),
    allMids: {},
  };
}

/** The recorded mainnet reference answers (mids and spot meta). */
export function mainnetReferenceAnswers(): Record<string, unknown> {
  return { allMids: fixture("mainnet-mids.json"), spotMeta: fixture("mainnet-spotmeta.json") };
}

type Listener = (event: never) => void;

/** A WebSocket stand-in that opens on the next tick and records what was sent. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    setTimeout(() => this.open(), 0);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: unknown) => void)(event);
  }

  send(data: string): void {
    if (this.readyState === 1) this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code });
  }

  open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.emit("open", {});
  }

  message(channel: string, data: unknown): void {
    this.emit("message", { data: JSON.stringify({ channel, data }) });
  }

  subscriptions(): unknown[] {
    return this.sent.filter((frame) => frame.method === "subscribe").map((frame) => frame.subscription);
  }
}

export function socketFactory(): { readonly sockets: FakeSocket[]; readonly create: (url: string) => SocketLike } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    create: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

/** Balances by network and token address (lower case; "native" for gas). */
export type FakeBalances = Partial<Record<string, Record<string, bigint | null>>>;

/** The part of EvmChains the ledger uses: availability, Multicall3 balances and one readContract (kHYPE rate). */
export function fakeChains(balances: FakeBalances, options: { readonly khypeUnits?: bigint; readonly failNetworks?: readonly string[] } = {}): EvmChains {
  const fake = {
    isAvailable: (key: string) => NETWORKS[key as keyof typeof NETWORKS]?.vm === "evm" && (NETWORKS[key as keyof typeof NETWORKS] as { rpcUrls: readonly string[] }).rpcUrls.length > 0,
    unavailableReason: (key: string) => (fake.isAvailable(key) ? null : "it has not launched publicly and no RPC endpoint is configured"),
    getBalances: async (key: string, owner: string, tokens: readonly string[]) => {
      if (options.failNetworks?.includes(key)) throw new Error("rpc down");
      const table = balances[key] ?? {};
      return {
        network: key,
        owner,
        blockNumber: 123n,
        balances: tokens.map((token): TokenBalance => ({ token: token as TokenBalance["token"], balance: token.toLowerCase() in table ? (table[token.toLowerCase()] ?? null) : 0n })),
      };
    },
    client: () => ({ readContract: async () => options.khypeUnits ?? 1_027_270_350_152_241_821n }),
  };
  return fake as unknown as EvmChains;
}
