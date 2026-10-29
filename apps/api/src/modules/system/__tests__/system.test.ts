import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NETWORKS, PROTOCOLS, TOKENS, type Network, type Pulse, type PulseBlock } from "@elyia/core";
import { createApp } from "../../../app.js";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import type { FakeHandler } from "../../../__tests__/support.js";
import { FakeChain, json, readSse, routedFetch, serve, testConfig, type Served } from "../../../__tests__/support.js";
import { filterProtocols, filterTokens } from "../registry.js";

interface FakeWorld {
  readonly elysium: FakeChain;
  readonly stale: FakeChain;
  readonly routes: Record<string, FakeHandler>;
  infoCalls: number;
}

/** Every registry endpoint answered by a fake; the last Elysium testnet endpoint lags millions of blocks. */
function fakeWorld(): FakeWorld {
  const elysium = new FakeChain(18_000_000, 99_801);
  const stale = new FakeChain(10_000_000, 99_801);
  const world: FakeWorld = { elysium, stale, routes: {}, infoCalls: 0 };
  for (const network of Object.values(NETWORKS) as Network[]) {
    if (network.vm === "hypercore") {
      world.routes[network.infoUrl] = () => {
        world.infoCalls += 1;
        return json({ time: Date.now(), specialStatuses: null });
      };
      continue;
    }
    network.rpcUrls.forEach((url, index) => {
      if (network.key === "elysium-testnet") {
        world.routes[url] = index === network.rpcUrls.length - 1 ? stale.handler : elysium.handler;
      } else {
        world.routes[url] = new FakeChain(1_000, network.chainId).handler;
      }
    });
  }
  return world;
}

describe("system module", () => {
  let ctx: AppContext;
  let served: Served;
  let world: FakeWorld;
  let ticker: NodeJS.Timeout;

  before(async () => {
    world = fakeWorld();
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000" }), {
      fetch: routedFetch(world.routes),
      pulseOptions: { pollMs: 5, pulseEveryMs: 25, idleStopMs: 60 },
    });
    served = await serve(createApp(ctx));
    // One new Elysium block every 8 ms.
    ticker = setInterval(() => world.elysium.advance(1), 8);
  });

  after(async () => {
    clearInterval(ticker);
    await served.close();
    await closeContext(ctx);
  });

  async function get(path: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${served.url}${path}`, { headers });
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  it("GET /v1/health reports version, mode, uptime and each dependency, cached", async () => {
    const { response, body } = await get("/v1/health");
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "elyia-api");
    assert.equal(body.mode, "testnet");
    assert.match(String(body.version), /^\d+\.\d+\.\d+/u);
    assert.equal(typeof body.uptimeSeconds, "number");
    const dependencies = body.dependencies as { store: { kind: string; ok: boolean }; networks: Array<Record<string, unknown>> };
    assert.deepEqual(dependencies.store.kind, "memory");
    assert.equal(dependencies.store.ok, true);
    assert.deepEqual(
      dependencies.networks.map((network) => network.network),
      ["elysium-testnet", "hyperevm-testnet", "hypercore-testnet"],
    );
    const elysium = dependencies.networks[0] as { reachable: boolean; head: number; endpoints: Array<{ endpoint: string; ok: boolean; problem?: string }> };
    assert.equal(elysium.reachable, true);
    assert.ok(elysium.head >= 18_000_000);
    assert.equal(elysium.endpoints.length, 2);
    assert.equal(elysium.endpoints[1]?.problem, "stale", "an endpoint millions of blocks behind is flagged");
    for (const endpoint of elysium.endpoints) assert.equal(new URL(endpoint.endpoint).pathname, "/", "only scheme://host is reported");
    assert.equal((body.features as Record<string, string>).agent, "deterministic");
    const before = world.infoCalls;
    await get("/v1/health");
    assert.equal(world.infoCalls, before, "probes are cached for 15 s");
  });

  it("GET /v1/networks lists the registry with live status and never leaks overrides", async () => {
    const { response, body } = await get("/v1/networks");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /public/u);
    const networks = body.networks as Array<Record<string, unknown>>;
    assert.equal(networks.length, 6);
    const byKey = Object.fromEntries(networks.map((network) => [network.key, network]));
    assert.equal((byKey["elysium-testnet"]?.live as { reachable: boolean }).reachable, true);
    assert.equal(byKey["elysium-testnet"]?.enabled, true);
    assert.equal(byKey["elysium-mainnet"]?.enabled, false);
    const mainnet = byKey["elysium-mainnet"]?.live as { reachable: boolean; note: string };
    assert.equal(mainnet.reachable, false);
    assert.match(mainnet.note, /Not launched publicly/u);
    assert.equal(byKey["elysium-mainnet"]?.rpcConfigured, false);
    const filtered = await get("/v1/networks?environment=mainnet");
    assert.equal((filtered.body.networks as unknown[]).length, 3);
    const invalid = await get("/v1/networks?environment=devnet");
    assert.equal(invalid.response.status, 400);
  });

  it("GET /v1/protocols and /v1/tokens serve the core registries", async () => {
    const protocols = await get("/v1/protocols");
    assert.equal(protocols.response.status, 200);
    assert.match(protocols.response.headers.get("cache-control") ?? "", /max-age=60/u);
    assert.equal(protocols.body.count, PROTOCOLS.length);
    assert.deepEqual(protocols.body.protocols, JSON.parse(JSON.stringify(PROTOCOLS)), "rows exactly as core defines them");
    const onElysium = await get("/v1/protocols?network=elysium-testnet");
    const rows = onElysium.body.protocols as Array<{ deployments: Array<{ network: string }> }>;
    assert.ok(rows.every((row) => row.deployments.some((deployment) => deployment.network === "elysium-testnet")));
    const tokens = await get("/v1/tokens?network=elysium-testnet");
    assert.equal(tokens.response.status, 200);
    assert.equal(tokens.body.network, "elysium-testnet");
    const list = tokens.body.tokens as Array<{ network: string; symbol: string }>;
    assert.ok(list.length > 0);
    assert.ok(list.every((token) => token.network === "elysium-testnet"));
    const modeTokens = await get("/v1/tokens");
    assert.equal(modeTokens.body.count, TOKENS.filter((token) => NETWORKS[token.network].environment === "testnet").length);
    const bad = await get("/v1/tokens?network=solana");
    assert.equal(bad.response.status, 400);
    assert.equal((bad.body.error as { code: string }).code, "INVALID_REQUEST");
  });

  it("filters registry rows by network, environment and mode", () => {
    const testnet = filterProtocols(PROTOCOLS, { environment: "testnet" });
    assert.ok(testnet.every((row) => row.deployments.some((deployment) => NETWORKS[deployment.network].environment === "testnet")));
    assert.equal(filterProtocols(PROTOCOLS, {}).length, PROTOCOLS.length);
    assert.ok(filterTokens(TOKENS, undefined, "mainnet").every((token) => NETWORKS[token.network].environment === "mainnet"));
    assert.ok(filterTokens(TOKENS, "hyperevm-testnet", "mainnet").every((token) => token.network === "hyperevm-testnet"));
  });

  it("GET /v1/elysium/pulse returns a measured Pulse", async () => {
    const { response, body } = await get("/v1/elysium/pulse");
    assert.equal(response.status, 200);
    const pulse = body as unknown as Pulse;
    assert.equal(pulse.network, "elysium-testnet");
    assert.equal(pulse.chainId, 99_801);
    assert.ok(pulse.head >= 18_000_000);
    assert.ok(pulse.blockTimeMs > 0);
    assert.ok(pulse.tps >= 0);
    assert.equal(pulse.gasPriceGwei, 0.1);
    assert.equal(pulse.l1BlockNumber, 68_000_000);
    assert.equal(pulse.healthy, true);
    assert.ok(pulse.sampleBlocks >= 2);
  });

  it("refuses networks that cannot be polled with clear errors", async () => {
    const mainnet = await get("/v1/elysium/pulse?network=elysium-mainnet");
    assert.equal(mainnet.response.status, 503);
    assert.equal((mainnet.body.error as { code: string }).code, "NETWORK_UNAVAILABLE");
    const evm = await get("/v1/elysium/pulse?network=hyperevm-testnet");
    assert.equal(evm.response.status, 400);
    assert.equal((evm.body.error as { code: string }).code, "NETWORK_NOT_SUPPORTED");
    const stream = await get("/v1/elysium/blocks/stream?network=elysium-mainnet");
    assert.equal(stream.response.status, 503, "the stream fails as JSON before any SSE header");
    assert.match(stream.response.headers.get("content-type") ?? "", /application\/json/u);
  });

  it("GET /v1/elysium/blocks/stream sends the last pulse at once, then blocks in order", async () => {
    // The poller is warm from the previous test: a pulse exists.
    const result = await readSse(`${served.url}/v1/elysium/blocks/stream`, (messages) => messages.filter((message) => message.event === "block").length >= 5);
    assert.equal(result.status, 200);
    assert.match(result.raw, /^retry: 3000\n\n/u);
    assert.equal(result.messages[0]?.event, "pulse", "the last pulse is the first event");
    const pulse = JSON.parse(result.messages[0]?.data ?? "{}") as Pulse;
    assert.equal(pulse.network, "elysium-testnet");
    const blocks = result.messages.filter((message) => message.event === "block");
    const parsed = blocks.map((message) => JSON.parse(message.data) as PulseBlock);
    for (const [index, block] of parsed.entries()) {
      assert.equal(blocks[index]?.id, String(block.number), "the SSE id is the block number");
      assert.equal(block.network, "elysium-testnet");
      assert.equal(block.txCount, 2);
      assert.equal(typeof block.seenAt, "number");
      if (index > 0) assert.equal(block.number, (parsed[index - 1] as PulseBlock).number + 1, "consecutive heights");
    }
  });

  it("replays buffered blocks after Last-Event-ID", async () => {
    const recent = ctx.pulse.recentBlocks("elysium-testnet");
    const from = recent[recent.length - 5] as PulseBlock;
    const result = await readSse(`${served.url}/v1/elysium/blocks/stream`, (messages) => messages.filter((message) => message.event === "block").length >= 3, {
      headers: { "last-event-id": String(from.number) },
    });
    const first = result.messages.find((message) => message.event === "block");
    assert.equal(first?.id, String(from.number + 1), "resumes right after the last seen block");
  });
});

describe("system module when every dependency is down", () => {
  it("GET /v1/health answers 503 with status down", async () => {
    const ctx = createContext(testConfig(), { fetch: routedFetch({}) });
    const served = await serve(createApp(ctx));
    try {
      const response = await fetch(`${served.url}/v1/health`);
      assert.equal(response.status, 503);
      const body = (await response.json()) as { status: string; dependencies: { networks: Array<{ reachable: boolean; endpoints: Array<{ problem?: string }> }> } };
      assert.equal(body.status, "down");
      assert.ok(body.dependencies.networks.every((network) => !network.reachable));
      assert.equal(body.dependencies.networks[0]?.endpoints[0]?.problem, "unreachable");
      const pulse = await fetch(`${served.url}/v1/elysium/pulse`);
      assert.equal(pulse.status, 503);
      assert.equal(((await pulse.json()) as { error: { code: string } }).error.code, "PULSE_UNAVAILABLE");
      assert.ok(pulse.headers.get("retry-after"));
    } finally {
      await served.close();
      await closeContext(ctx);
    }
  });
});
