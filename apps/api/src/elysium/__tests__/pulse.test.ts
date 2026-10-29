import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEvmNetwork, NETWORKS, type Pulse, type PulseBlock } from "@elyia/core";
import { EventBus } from "../../bus.js";
import { ManualClock } from "../../clock.js";
import { silentLogger } from "../../log.js";
import { FakeChain, routedFetch, waitFor } from "../../__tests__/support.js";
import { DEFAULT_PULSE_OPTIONS, ElysiumPulsePoller, PulseService, type PulseOptions } from "../pulse.js";
import { JsonRpcEndpoints } from "../rpc.js";

const network = getEvmNetwork("elysium-testnet");

function harness(urls: Record<string, FakeChain>, options: Partial<PulseOptions> = {}) {
  const clock = new ManualClock(1_800_000_000_000);
  const bus = new EventBus();
  const blocks: PulseBlock[] = [];
  const pulses: Pulse[] = [];
  bus.on("elysium.block", (block) => blocks.push(block));
  bus.on("elysium.pulse", (pulse) => pulses.push(pulse));
  const fetchImpl = routedFetch(Object.fromEntries(Object.entries(urls).map(([url, chain]) => [url, chain.handler])));
  const rpc = new JsonRpcEndpoints({ urls: Object.keys(urls), fetch: fetchImpl, now: () => clock.now() });
  const poller = new ElysiumPulsePoller({
    network: { ...network, rpcUrls: Object.keys(urls) },
    rpc,
    bus,
    clock,
    log: silentLogger,
    options: { ...DEFAULT_PULSE_OPTIONS, ...options },
  });
  return { clock, bus, blocks, pulses, poller, rpc, fetch: fetchImpl };
}

describe("ElysiumPulsePoller", () => {
  it("starts at the head and then follows every block in order", async () => {
    const chain = new FakeChain(5_000);
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [5_000],
    );
    chain.advance(1);
    h.clock.advance(115);
    await h.poller.tick();
    chain.advance(5);
    h.clock.advance(575);
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [5_000, 5_001, 5_002, 5_003, 5_004, 5_005, 5_006],
    );
    // No new block: nothing emitted, nothing re-emitted.
    await h.poller.tick();
    assert.equal(h.blocks.length, 7);
    assert.equal(h.blocks[1]?.txCount, 2, "user transactions only");
    assert.equal(h.blocks[1]?.network, "elysium-testnet");
  });

  it("fetches the head and the next heights in one round trip when keeping up", async () => {
    const chain = new FakeChain(100);
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    const before = h.fetch.calls.length;
    chain.advance(2);
    h.clock.advance(150);
    await h.poller.tick();
    assert.equal(h.fetch.calls.length - before, 1, "speculative batch covered both new blocks");
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [100, 101, 102],
    );
  });

  it("jumps to the head when more than maxBatch behind", async () => {
    const chain = new FakeChain(1_000);
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    chain.advance(500);
    h.clock.advance(60_000);
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [1_000, 1_500],
    );
    assert.equal(h.poller.status(0).jumps, 1);
    const batches = chain.requests.filter((request) => request.method === "eth_getBlockByNumber");
    assert.ok(batches.length < 20, "never crawls hundreds of blocks");
  });

  it("publishes a measured pulse from wall-clock arrivals", async () => {
    const chain = new FakeChain(2_000);
    chain.userTxs = 3;
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    for (let index = 0; index < 20; index += 1) {
      chain.advance(1);
      h.clock.advance(115);
      await h.poller.tick();
    }
    const pulse = h.poller.publishPulse();
    assert.ok(pulse);
    assert.equal(pulse.head, 2_020);
    assert.equal(pulse.blockTimeMs, 115);
    assert.equal(pulse.tps, Math.round(3 * (1000 / 115) * 100) / 100);
    assert.equal(pulse.gasPriceGwei, 0.1);
    assert.equal(pulse.healthy, true);
    assert.equal(pulse.sampleBlocks, 21);
    assert.equal(h.pulses.at(-1), pulse);
    // The chain stops: the pulse turns unhealthy but keeps its last figures.
    h.clock.advance(6_000);
    const quiet = h.poller.publishPulse();
    assert.equal(quiet?.healthy, false);
    assert.equal(quiet?.head, 2_020);
  });

  it("holds back a first pulse measured from too few blocks", async () => {
    const chain = new FakeChain(10);
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    chain.advance(1);
    h.clock.advance(120);
    await h.poller.tick();
    assert.equal(h.poller.publishPulse(), null, "two samples are too noisy for the first pulse");
    const forced = h.poller.publishPulse(2);
    assert.equal(forced?.sampleBlocks, 2);
    assert.equal(forced?.blockTimeMs, 120);
  });

  it("publishes the first pulse as soon as a few blocks are in", async () => {
    const chain = new FakeChain(10);
    const h = harness({ "https://rpc-a.test": chain });
    for (let index = 0; index < 4; index += 1) {
      await h.poller.tick();
      chain.advance(1);
      h.clock.advance(120);
    }
    assert.equal(h.pulses.length, 1);
    assert.equal(h.pulses[0]?.sampleBlocks, 4);
  });

  it("fails over when the preferred endpoint is down and never goes backwards", async () => {
    const a = new FakeChain(3_000);
    const b = new FakeChain(3_000);
    const h = harness({ "https://rpc-a.test": a, "https://rpc-b.test": b });
    await h.poller.tick();
    a.failure = 503;
    a.advance(2);
    b.advance(2);
    h.clock.advance(230);
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [3_000, 3_001, 3_002],
    );
    assert.equal(h.rpc.status()[0]?.available, false, "the failing endpoint cools down");
    // An endpoint that answers an older head is not followed backwards.
    a.failure = null;
    a.head = 2_990;
    h.clock.advance(60_000);
    b.advance(1);
    await h.poller.tick();
    assert.ok(h.blocks.every((block, index) => index === 0 || block.number > (h.blocks[index - 1] as PulseBlock).number));
    assert.equal(h.rpc.status()[0]?.stale, true, "an endpoint 12 blocks behind is skipped for a while");
    h.clock.advance(150);
    await h.poller.tick();
    assert.equal(h.blocks.at(-1)?.number, 3_003, "the healthy endpoint is used next");
  });

  it("detects a lagging endpoint on cold start and follows the healthy one", async () => {
    const stale = new FakeChain(10_000);
    const healthy = new FakeChain(18_000_000);
    const h = harness({ "https://stale.test": stale, "https://healthy.test": healthy });
    await h.poller.tick();
    assert.equal(h.blocks.length, 0, "the stale answer is discarded");
    assert.equal(h.rpc.status()[0]?.stale, true);
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [18_000_000],
    );
  });

  it("rejects an endpoint that falls far behind mid-run", async () => {
    const a = new FakeChain(50_000);
    const b = new FakeChain(50_000);
    const h = harness({ "https://rpc-a.test": a, "https://rpc-b.test": b });
    await h.poller.tick();
    a.head = 40_000;
    b.advance(1);
    h.clock.advance(150);
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [50_000, 50_001],
    );
    assert.equal(h.rpc.status()[0]?.stale, true);
  });

  it("backs off after errors and recovers", async () => {
    const chain = new FakeChain(1);
    chain.failure = "reset";
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    await h.poller.tick();
    assert.equal(h.poller.status(0).consecutiveErrors, 2);
    chain.failure = null;
    h.clock.advance(60_000);
    await h.poller.tick();
    assert.equal(h.poller.status(0).consecutiveErrors, 0);
    assert.equal(h.blocks.length, 1);
  });

  it("stops at the first header an endpoint cannot serve yet", async () => {
    const chain = new FakeChain(700);
    const h = harness({ "https://rpc-a.test": chain });
    await h.poller.tick();
    chain.advance(3);
    const original = chain.header.bind(chain);
    // The node behind the load balancer has 701 but not 702 yet.
    chain.header = (number: number) => (number === 702 ? null : original(number));
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [700, 701],
    );
    chain.header = original;
    await h.poller.tick();
    assert.deepEqual(
      h.blocks.map((block) => block.number),
      [700, 701, 702, 703],
    );
  });
});

describe("PulseService", () => {
  function service(chain: FakeChain, options: Partial<PulseOptions> = {}, networks = NETWORKS) {
    const bus = new EventBus();
    const fetchImpl = routedFetch({ "https://testnet-rpc.elysium.kinetiq.xyz": chain.handler });
    const pulse = new PulseService({
      networks: {
        ...networks,
        // One endpoint keeps the test free of census traffic.
        "elysium-testnet": { ...getEvmNetwork("elysium-testnet"), rpcUrls: ["https://testnet-rpc.elysium.kinetiq.xyz"] },
      },
      defaultNetwork: "elysium-testnet",
      bus,
      clock: { now: () => Date.now() },
      log: silentLogger,
      fetch: fetchImpl,
      options: { pollMs: 5, pulseEveryMs: 20, idleStopMs: 40, ...options },
    });
    return { pulse, bus };
  }

  it("starts on the first retain and stops after the idle period, keeping the last pulse", async () => {
    const chain = new FakeChain(100);
    const timer = setInterval(() => chain.advance(1), 4);
    const { pulse } = service(chain);
    try {
      assert.equal(pulse.status()["elysium-testnet"], undefined, "nothing runs before a subscriber");
      const release = pulse.retain("elysium-testnet");
      const second = pulse.retain("elysium-testnet");
      await waitFor(() => pulse.latest("elysium-testnet") !== null);
      assert.equal(pulse.status()["elysium-testnet"]?.running, true);
      assert.equal(pulse.status()["elysium-testnet"]?.subscribers, 2);
      release();
      release();
      second();
      assert.equal(pulse.status()["elysium-testnet"]?.running, true, "still running during the grace period");
      await waitFor(() => pulse.status()["elysium-testnet"]?.running === false, 1_000);
      assert.ok(pulse.latest("elysium-testnet"), "the last pulse stays readable");
      assert.ok(pulse.recentBlocks("elysium-testnet").length > 0);
    } finally {
      clearInterval(timer);
      pulse.close();
    }
  });

  it("waits for a fresh pulse on demand", async () => {
    const chain = new FakeChain(100);
    const timer = setInterval(() => chain.advance(1), 4);
    const { pulse } = service(chain);
    try {
      const value = await pulse.waitForPulse("elysium-testnet", { timeoutMs: 2_000 });
      assert.ok(value);
      assert.equal(value.network, "elysium-testnet");
      assert.ok(value.head >= 100);
    } finally {
      clearInterval(timer);
      pulse.close();
    }
  });

  it("refuses networks it cannot poll", () => {
    const { pulse } = service(new FakeChain());
    assert.throws(() => pulse.retain("hyperevm-testnet"), { code: "NETWORK_NOT_SUPPORTED", status: 400 });
    assert.throws(() => pulse.retain("hypercore-testnet"), { code: "NETWORK_NOT_SUPPORTED" });
    // Elysium mainnet has no public RPC before launch.
    assert.throws(() => pulse.retain("elysium-mainnet"), { code: "NETWORK_UNAVAILABLE", status: 503 });
    assert.throws(() => pulse.latest("elysium-mainnet"), { code: "NETWORK_UNAVAILABLE" });
    pulse.close();
  });
});
