/**
 * Discovery over fakes: the executable registry equals the engine adapters,
 * the listing filters, the batched EXTCODESIZE call, the live check (cache,
 * missing contracts, unreadable logs), the launch radar (decoding, windows of
 * at most 2,000 blocks, dedupe, proving launchpad tokens, subscribers),
 * Shield (registry, look-alikes, bytecode, proxy, owner, simulated buy and
 * sell, never "safe"), the stats labels and every HTTP route.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { FLAGGED_TOKENS, PROTOCOLS, TOKENS, type NetworkKey, type Pulse } from "@elyia/core";
import type { ElysiumStatsResponse, LaunchesResponse, ProtocolListResponse, ProtocolLiveResponse, ProtocolSummary, ShieldReport } from "@elyia/core/api/discovery";
import { encodeAbiParameters, pad, type Hex } from "viem";
import { createApp } from "../../../app.js";
import { ManualClock } from "../../../clock.js";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import { engineFor, type Engine } from "../../../engine/index.js";
import { activeProtocolIds } from "../../../engine/registry.js";
import type { PulseFeed } from "../../../elysium/pulse.js";
import { createLogger } from "../../../log.js";
import { readSse, serve, testConfig, type Served } from "../../../__tests__/support.js";
import { createDiscovery, setDiscovery } from "../index.js";
import { decodeLaunch, LaunchRadar, launchSources, TOPICS, type LaunchSource } from "../launches.js";
import { LiveChecker, LIVE_CACHE_MS } from "../live.js";
import { ENGINE_ONLY_IDS, filterRegistry, liveRegistry, registryFrom } from "../registry.js";
import { codeSizesCalldata, CODE_SIZES_INITCODE, decodeCodeSizes, MAX_LOG_BLOCKS, type DiscoveryLog, type DiscoveryRpc, type TokenMetadata } from "../rpc.js";
import { cloneTarget, privilegedIn, Shield, SHIELD_ACCOUNT } from "../shield.js";
import { elysiumStats } from "../stats.js";

const NET: NetworkKey = "elysium-testnet";
const KALOS_FACTORY = "0x520bf060f58cee054f725877279328f5f73a7893";
const SIGNAL_POOL_MANAGER = "0x889a96eedb1df35a012d7e48baf7f9c780f1243b";
const BUNNY_LAUNCHPAD = "0x3c4f47959101557eed9bc4ae8d8d986ae8d3e5b1";
const WHYPE = "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234";
const USDC = "0x7d29d8047b905000459c0e80c34a26ceedcb47b2";
const NEW_TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER_TOKEN = "0x2222222222222222222222222222222222222223";
const USER = "0x3333333333333333333333333333333333333334";
const POOL = "0x4444444444444444444444444444444444444445";

const word = (address: string): Hex => pad(address as Hex, { size: 32 }).toLowerCase() as Hex;

class FakeRpc implements DiscoveryRpc {
  headBlock = 20_000_000;
  sizes = new Map<string, number>();
  logsFor: (filter: { fromBlock: number; toBlock: number; addresses: readonly string[] }) => DiscoveryLog[] = () => [];
  logRanges: { from: number; to: number; addresses: number }[] = [];
  codeCalls = 0;
  metaCalls = 0;
  failLogs = false;
  meta = new Map<string, TokenMetadata>();
  code = new Map<string, Hex>();
  storage = new Map<string, Hex>();
  calls = new Map<string, Hex | null>();
  available(network: NetworkKey) {
    return network !== "elysium-mainnet";
  }
  head() {
    return Promise.resolve(this.headBlock);
  }
  codeSizes(_network: NetworkKey, addresses: readonly string[]) {
    this.codeCalls += 1;
    return Promise.resolve(addresses.map((address) => this.sizes.get(address.toLowerCase()) ?? 100));
  }
  getCode(_network: NetworkKey, address: string) {
    return Promise.resolve(this.code.get(address.toLowerCase()) ?? "0x");
  }
  getStorageAt(_network: NetworkKey, address: string, slot: Hex) {
    return Promise.resolve(this.storage.get(`${address.toLowerCase()}:${slot}`) ?? (`0x${"0".repeat(64)}` as Hex));
  }
  logs(_network: NetworkKey, filter: { readonly addresses: readonly string[]; readonly fromBlock: number; readonly toBlock: number }) {
    assert.ok(filter.toBlock - filter.fromBlock + 1 <= MAX_LOG_BLOCKS, "never more than 2,000 blocks per request");
    this.logRanges.push({ from: filter.fromBlock, to: filter.toBlock, addresses: filter.addresses.length });
    if (this.failLogs) return Promise.reject(new Error("range too large"));
    return Promise.resolve(this.logsFor(filter).filter((log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock));
  }
  call(_network: NetworkKey, request: { readonly to: string; readonly data: Hex }) {
    return Promise.resolve(this.calls.get(`${request.to.toLowerCase()}:${request.data}`) ?? null);
  }
  tokenMetadata(_network: NetworkKey, address: string) {
    this.metaCalls += 1;
    return Promise.resolve(this.meta.get(address.toLowerCase()) ?? { name: null, symbol: null, decimals: null, totalSupply: null });
  }
}

function log(address: string, topics: readonly Hex[], data: Hex, blockNumber: number, logIndex = 0): DiscoveryLog {
  return { address, topics, data, blockNumber, transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex, logIndex };
}

const silent = createLogger({ level: "silent" });

describe("discovery: registry", () => {
  let ctx: AppContext;
  before(() => {
    ctx = createContext(testConfig());
  });
  after(async () => {
    await closeContext(ctx);
  });

  it("the executable rows are exactly the engine adapters' registry ids", () => {
    const adapters = activeProtocolIds(engineFor(ctx).registry.adapters).filter((id) => !ENGINE_ONLY_IDS.has(id)).sort();
    const registry = liveRegistry(ctx);
    assert.deepEqual([...registry.executableIds].sort(), adapters);
    assert.deepEqual(PROTOCOLS.filter((row) => row.executable).map((row) => row.id).sort(), adapters, "core's static flags agree with the running engine");
    for (const id of adapters) assert.ok(registry.byId(id), `${id} is a registry row`);
    assert.ok(adapters.includes("hyperswap-v3") && adapters.includes("signal"));
  });

  it("filters by network, kind, category, status, executable, tag and text", () => {
    const { rows } = registryFrom(["kalos-v3", "hyperswap-v3"]);
    assert.deepEqual(filterRegistry(rows, { executable: true }).map((row) => row.id), ["hyperswap-v3", "kalos-v3"]);
    assert.ok(filterRegistry(rows, { kind: "dex", network: NET }).every((row) => row.kind === "dex"));
    assert.equal(filterRegistry(rows, { category: "launchpad" }).length, filterRegistry(rows, { kind: "launchpad" }).length + filterRegistry(rows, { kind: "nft" }).length);
    assert.deepEqual(filterRegistry(rows, { q: "hyperswap" }).map((row) => row.id), ["hyperswap-v3"]);
    assert.deepEqual(filterRegistry(rows, { q: "0x51C5958FFB3E326F8D7AA945948159F1FF27E14A" }).map((row) => row.id), ["hyperswap-v3"], "contract addresses are searchable, any case");
    assert.deepEqual(filterRegistry(rows, { q: "kalos v3 swaprouter" }).map((row) => row.id).includes("kalos-v3"), true, "every word must match");
    assert.deepEqual(filterRegistry(rows, { status: "deprecated" }).map((row) => row.id), ["elys-faucet-token"]);
    assert.ok(filterRegistry(rows, { environment: "mainnet" }).every((row) => row.deployments.some((deployment) => !deployment.network.endsWith("testnet"))));
  });
});

describe("discovery: batched bytecode sizes", () => {
  it("encodes the address words after the 40-byte init code and decodes one word per address", () => {
    assert.equal((CODE_SIZES_INITCODE.length - 2) / 2, 40);
    const data = codeSizesCalldata([KALOS_FACTORY, USDC]);
    assert.equal(data.length, 2 + 80 + 128);
    assert.ok(data.endsWith(USDC.slice(2)));
    const result = `0x${(12070).toString(16).padStart(64, "0")}${"0".repeat(64)}` as Hex;
    assert.deepEqual(decodeCodeSizes(result, 2), [12070, 0]);
    assert.deepEqual(decodeCodeSizes("0x", 1), [null]);
  });
});

describe("discovery: live check", () => {
  it("counts presence and recent logs per protocol, caches 10 minutes, and says what it could not read", async () => {
    const rpc = new FakeRpc();
    const clock = new ManualClock();
    rpc.sizes.set(KALOS_FACTORY, 0);
    rpc.logsFor = () => [log(SIGNAL_POOL_MANAGER, [TOPICS.v4Initialize], "0x", rpc.headBlock - 5), log(SIGNAL_POOL_MANAGER, ["0x01" as Hex], "0x", rpc.headBlock - 3)];
    const checker = new LiveChecker({ rpc, clock, rows: () => PROTOCOLS, blockTimeMs: () => 115 });
    const first: ProtocolLiveResponse = await checker.check(NET);
    assert.equal(first.network, NET);
    assert.equal(first.window?.blocks, MAX_LOG_BLOCKS);
    assert.equal(first.window?.approxSeconds, 230);
    const signal = first.protocols.find((row) => row.protocolId === "signal");
    assert.equal(signal?.recentLogs, 2);
    assert.equal(signal?.active, true);
    assert.equal(signal?.lastActivityBlock, rpc.headBlock - 3);
    assert.equal(first.protocols[0]?.protocolId, "signal", "most active first");
    const kalos = first.protocols.find((row) => row.protocolId === "kalos-v3");
    assert.deepEqual(kalos?.missing, [KALOS_FACTORY]);
    assert.equal(kalos?.active, false);
    assert.ok(first.totals.contracts > 100 && first.totals.missing === 1);
    assert.ok(rpc.logRanges.every((range) => range.addresses <= first.totals.contracts));
    const calls = rpc.codeCalls;
    await checker.check(NET);
    assert.equal(rpc.codeCalls, calls, "served from the cache");
    clock.advance(LIVE_CACHE_MS);
    rpc.failLogs = true;
    const refreshed = await checker.check(NET);
    assert.equal(rpc.codeCalls, calls + 1);
    assert.equal(refreshed.protocols.find((row) => row.protocolId === "signal")?.active, null, "unknown, not inactive");
    assert.ok(refreshed.notes.some((note) => /could not be read/u.test(note)));
    const mainnet = await checker.check("elysium-mainnet");
    assert.equal(mainnet.head, null);
    assert.ok(mainnet.notes[0]?.includes("no RPC endpoint"));
    assert.ok(mainnet.protocols.every((row) => row.unknown === row.contracts && row.active === null));
  });
});

describe("discovery: launch radar", () => {
  const sources = launchSources(PROTOCOLS, NET);
  const source = (address: string) => sources.find((entry) => entry.address === address) as LaunchSource;

  it("watches registry factories and launchpads only", () => {
    assert.ok(sources.length >= 40);
    assert.ok(source(KALOS_FACTORY)?.amm);
    assert.ok(source(SIGNAL_POOL_MANAGER)?.amm);
    assert.equal(source(BUNNY_LAUNCHPAD)?.amm, false);
    assert.ok(!sources.some((entry) => /bridge|wallet/iu.test(entry.role)), "no bridge or wallet factories");
  });

  it("decodes V2, V3 and V4 creations and launchpad events", () => {
    const v3 = decodeLaunch(log(KALOS_FACTORY, [TOPICS.v3PoolCreated, word(NEW_TOKEN), word(WHYPE), word("0x0000000000000000000000000000000000002710")], encodeAbiParameters([{ type: "int24" }, { type: "address" }], [200, POOL]), 1), source(KALOS_FACTORY));
    assert.deepEqual(v3, { kind: "v3-pool", pool: POOL, tokens: [NEW_TOKEN, WHYPE], unproven: false });
    const dexFactory = sources.find((entry) => entry.protocolId === "dex-da-costa") as LaunchSource;
    const v2 = decodeLaunch(log(dexFactory.address, [TOPICS.v2PairCreated, word(NEW_TOKEN), word(USDC)], encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [POOL, 7n]), 1), dexFactory);
    assert.equal(v2?.kind, "v2-pair");
    assert.equal(v2?.pool, POOL);
    const id = `0x${"ab".repeat(32)}` as Hex;
    const v4 = decodeLaunch(log(SIGNAL_POOL_MANAGER, [TOPICS.v4Initialize, id, word("0x0000000000000000000000000000000000000000"), word(NEW_TOKEN)], "0x", 1), source(SIGNAL_POOL_MANAGER));
    assert.deepEqual(v4, { kind: "v4-pool", pool: id, tokens: [NEW_TOKEN], unproven: false }, "native HYPE (zero address) is dropped");
    assert.equal(decodeLaunch(log(KALOS_FACTORY, ["0x01" as Hex, word(NEW_TOKEN)], "0x", 1), source(KALOS_FACTORY)), null, "an AMM factory's other events are not launches");
    const pad1 = decodeLaunch(log(BUNNY_LAUNCHPAD, ["0x02" as Hex, word(NEW_TOKEN), word(USER)], "0x", 1), source(BUNNY_LAUNCHPAD));
    assert.deepEqual(pad1, { kind: "launchpad-event", pool: null, tokens: [NEW_TOKEN, USER], unproven: true });
  });

  it("scans in windows of at most 2,000 blocks, dedupes, proves launchpad tokens and notifies subscribers", async () => {
    const rpc = new FakeRpc();
    const clock = new ManualClock();
    const head = rpc.headBlock;
    rpc.meta.set(NEW_TOKEN, { name: "New Token", symbol: "NEW", decimals: 18, totalSupply: 10n ** 27n });
    rpc.meta.set(OTHER_TOKEN, { name: "Other", symbol: "OTH", decimals: 18, totalSupply: 1n });
    rpc.sizes.set(USER, 0);
    const events = [
      log(KALOS_FACTORY, [TOPICS.v3PoolCreated, word(NEW_TOKEN), word(WHYPE), word("0x0000000000000000000000000000000000002710")], encodeAbiParameters([{ type: "int24" }, { type: "address" }], [200, POOL]), head - 4_500),
      log(BUNNY_LAUNCHPAD, ["0x02" as Hex, word(OTHER_TOKEN), word(USER)], "0x", head - 100),
      log(BUNNY_LAUNCHPAD, ["0x02" as Hex, word(OTHER_TOKEN), word(USER)], "0x", head - 90, 1),
      log(BUNNY_LAUNCHPAD, ["0x03" as Hex, word(USER)], "0x", head - 80, 2),
    ];
    rpc.logsFor = () => events;
    const radar = new LaunchRadar({ network: NET, rpc, clock, log: silent, rows: () => PROTOCOLS });
    const heard: string[] = [];
    const off = radar.subscribe((launch) => heard.push(launch.kind));
    await radar.tick();
    assert.deepEqual(rpc.logRanges.map((range) => range.to - range.from + 1), [2_000, 2_000, 2_000], "backfill: three full windows");
    assert.equal(rpc.logRanges[2]?.to, head);
    const launches = radar.list();
    assert.deepEqual(launches.map((launch) => launch.kind), ["launchpad-event", "v3-pool"], "newest first; the repeat and the EOA-only event are dropped");
    const pool = launches[1];
    assert.equal(pool?.protocolId, "kalos-v3");
    assert.deepEqual(pool?.tokens.map((token) => [token.symbol, token.verified]), [["NEW", false], ["WHYPE", true]], "launch token first, verified quote last");
    assert.equal(launches[0]?.tokens[0]?.symbol, "OTH");
    assert.deepEqual(heard, ["v3-pool", "launchpad-event"]);
    // Next tick: only the new blocks, and no duplicates.
    rpc.headBlock += 300;
    rpc.logRanges = [];
    await radar.tick();
    assert.deepEqual(rpc.logRanges, [{ from: head + 1, to: head + 300, addresses: sources.length }]);
    assert.equal(radar.list().length, 2);
    off();
    const status = radar.status();
    assert.equal(status.scannedThrough, head + 300);
    assert.equal(status.windowBlocks, 2_000);
    assert.equal(status.running, false);
    radar.start();
    assert.equal(radar.running, true);
    radar.stop();
    assert.equal(radar.running, false);
  });

  it("flags a look-alike token named by a new pool", async () => {
    const lookalike = FLAGGED_TOKENS.find((row) => row.network === NET && row.standard === "erc20") as (typeof FLAGGED_TOKENS)[number];
    const rpc = new FakeRpc();
    rpc.logsFor = () => [log(KALOS_FACTORY, [TOPICS.v3PoolCreated, word(lookalike.address.toLowerCase()), word(USDC), word("0x0000000000000000000000000000000000000bb8")], encodeAbiParameters([{ type: "int24" }, { type: "address" }], [60, POOL]), rpc.headBlock - 1)];
    const radar = new LaunchRadar({ network: NET, rpc, clock: new ManualClock(), log: silent, rows: () => PROTOCOLS });
    await radar.tick();
    assert.equal(radar.list()[0]?.tokens[0]?.flagged?.address, lookalike.address);
  });
});

/* ------------------------------------------------------------------ shield */

const OWNER_CALL = (token: string) => `${token}:0x8da5cb5b`;
const PLAIN_TOKEN_CODE = "0x6080604052" as Hex;
const MINTABLE_CODE = "0x608060405263a9059cbb6340c10f19" as Hex;

/** An engine stub: dry-run plans for the buy and the sell, prepared requests, and a scripted eth_simulateV1. */
function stubEngine(simulate: (calls: number) => { status: "success" | "reverted"; logs: { address: string; topics: Hex[]; data: Hex }[]; error?: string }[] | null, plans = true): Engine {
  const clock = new ManualClock();
  const step = (from: string, to: string, expected: string) => ({ id: "s1", kind: "swap", inputs: [{ asset: from, expected }], outputs: [{ asset: to, expected, minimum: (BigInt(expected) * 99n / 100n).toString() }] });
  let planned = 0;
  return {
    deps: { clock, evm: { simulate: (_network: NetworkKey, request: { calls: unknown[] }) => Promise.resolve(simulate(request.calls.length)?.map((call) => ({ ...call, returnData: "0x", gasUsed: 100_000n })) ?? null) } },
    service: {
      create: () => {
        planned += 1;
        if (!plans) return Promise.reject(Object.assign(new Error("no pool"), { code: "ROUTE_UNAVAILABLE" }));
        return Promise.resolve({ intent: { steps: [planned % 2 === 1 ? step("native", NEW_TOKEN, "1000000000000000000000") : step(NEW_TOKEN, "native", "10000000000000000")] } });
      },
    },
    registry: { forStep: () => ({ prepare: () => Promise.resolve({ requests: [{ from: SHIELD_ACCOUNT, to: POOL, data: "0x01", value: "0" }] }) }) },
  } as unknown as Engine;
}

const transfer = (token: string, from: string, to: string, amount: bigint) => ({ address: token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex, word(from), word(to)], data: pad(`0x${amount.toString(16)}` as Hex, { size: 32 }) });

describe("discovery: Shield", () => {
  const shieldWith = (rpc: FakeRpc, engine: Engine) => new Shield({ rpc, clock: new ManualClock(), log: silent, engine: () => engine });

  it("knows the selectors and clone shapes it reports", () => {
    assert.deepEqual(privilegedIn(MINTABLE_CODE), ["mint(address,uint256)"]);
    assert.equal(cloneTarget(`0x363d3d373d3d3d363d73${"ab".repeat(20)}5af43d82803e903d91602b57fd5bf3` as Hex), `0x${"ab".repeat(20)}`);
    assert.equal(cloneTarget(PLAIN_TOKEN_CODE), null);
  });

  it("a verified token is 'verified', a look-alike 'flagged', nothing at the address 'danger'; never 'safe'", async () => {
    const rpc = new FakeRpc();
    const engine = stubEngine(() => null);
    rpc.code.set(USDC, PLAIN_TOKEN_CODE);
    rpc.meta.set(USDC, { name: "USD Coin", symbol: "USDC", decimals: 6, totalSupply: 10n ** 12n });
    const verified = await shieldWith(rpc, engine).inspect(NET, USDC);
    assert.equal(verified.verdict, "verified");
    assert.equal(verified.simulation, null);
    const lookalike = FLAGGED_TOKENS.find((row) => row.network === NET && row.tags.includes("lookalike")) as (typeof FLAGGED_TOKENS)[number];
    rpc.code.set(lookalike.address.toLowerCase(), PLAIN_TOKEN_CODE);
    const flagged = await shieldWith(rpc, engine).inspect(NET, lookalike.address);
    assert.equal(flagged.verdict, "flagged");
    assert.equal(flagged.checks.find((check) => check.id === "lookalike")?.status, "fail");
    const empty = await shieldWith(rpc, engine).inspect(NET, USER);
    assert.equal(empty.verdict, "danger");
    assert.equal(empty.checks.find((check) => check.id === "bytecode")?.status, "fail");
    for (const report of [verified, flagged, empty]) assert.notEqual(report.verdict as string, "safe");
    assert.match(verified.disclaimer, /not an audit/u);
  });

  it("an unverified token whose simulated buy and sell work, renounced, no privileges: 'no-red-flags'", async () => {
    const rpc = new FakeRpc();
    rpc.code.set(NEW_TOKEN, PLAIN_TOKEN_CODE);
    rpc.meta.set(NEW_TOKEN, { name: "New Token", symbol: "NEW", decimals: 18, totalSupply: 10n ** 27n });
    rpc.calls.set(OWNER_CALL(NEW_TOKEN), `0x${"0".repeat(64)}` as Hex);
    const engine = stubEngine(() => [
      { status: "success", logs: [transfer(NEW_TOKEN, POOL, SHIELD_ACCOUNT, 1_000n * 10n ** 18n)] },
      { status: "success", logs: [transfer(NEW_TOKEN, SHIELD_ACCOUNT, POOL, 990n * 10n ** 18n)] },
    ]);
    const report: ShieldReport = await shieldWith(rpc, engine).inspect(NET, NEW_TOKEN);
    assert.equal(report.verdict, "no-red-flags", JSON.stringify(report.checks));
    assert.equal(report.owner.renounced, true);
    assert.equal(report.simulation?.method, "eth_simulateV1");
    assert.equal(report.simulation?.buy.ok, true);
    assert.equal(report.simulation?.buy.taxBps, 0);
    assert.equal(report.simulation?.sell?.ok, true);
    assert.match(report.summary, /not a guarantee/u);
  });

  it("a sell that reverts after a working buy is a possible honeypot: 'danger'", async () => {
    const rpc = new FakeRpc();
    rpc.code.set(NEW_TOKEN, MINTABLE_CODE);
    rpc.meta.set(NEW_TOKEN, { name: "Trap", symbol: "TRAP", decimals: 18, totalSupply: 1n });
    rpc.calls.set(OWNER_CALL(NEW_TOKEN), word(USER));
    const engine = stubEngine(() => [
      { status: "success", logs: [transfer(NEW_TOKEN, POOL, SHIELD_ACCOUNT, 1_000n * 10n ** 18n)] },
      { status: "reverted", logs: [], error: "TRANSFER_FROM_FAILED" },
    ]);
    const report = await shieldWith(rpc, engine).inspect(NET, NEW_TOKEN);
    assert.equal(report.verdict, "danger");
    assert.equal(report.checks.find((check) => check.id === "sell")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "privileges")?.status, "fail");
    assert.equal(report.owner.address, USER);
  });

  it("a heavy buy tax fails; an EIP-1967 proxy warns; no route leaves the simulation skipped ('caution', not safe)", async () => {
    const rpc = new FakeRpc();
    rpc.code.set(NEW_TOKEN, PLAIN_TOKEN_CODE);
    rpc.meta.set(NEW_TOKEN, { name: "Tax", symbol: "TAX", decimals: 18, totalSupply: 1n });
    const taxed = await shieldWith(rpc, stubEngine(() => [{ status: "success", logs: [transfer(NEW_TOKEN, POOL, SHIELD_ACCOUNT, 700n * 10n ** 18n)] }, { status: "success", logs: [] }])).inspect(NET, NEW_TOKEN);
    assert.equal(taxed.simulation?.buy.taxBps, 3_000);
    assert.equal(taxed.verdict, "danger");
    rpc.storage.set(`${OTHER_TOKEN}:0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`, word(POOL));
    rpc.code.set(OTHER_TOKEN, PLAIN_TOKEN_CODE);
    rpc.code.set(POOL, PLAIN_TOKEN_CODE);
    rpc.meta.set(OTHER_TOKEN, { name: "Proxy", symbol: "PRX", decimals: 18, totalSupply: 1n });
    const proxied = await shieldWith(rpc, stubEngine(() => null, false)).inspect(NET, OTHER_TOKEN);
    assert.deepEqual(proxied.bytecode.proxy, { kind: "eip1967", implementation: POOL, admin: null });
    assert.equal(proxied.checks.find((check) => check.id === "route")?.status, "warn");
    assert.equal(proxied.checks.find((check) => check.id === "buy")?.status, "skipped");
    assert.equal(proxied.verdict, "caution");
  });
});

describe("discovery: stats", () => {
  it("labels every figure: measured, estimate or registry", () => {
    const pulse: Pulse = { network: NET, chainId: 99801, head: 20_000_000, blockTimeMs: 115, tps: 12.5, gasPriceGwei: 0.1, gasPerSecond: 1, l1BlockNumber: 1, sampleBlocks: 100, updatedAt: 0, healthy: true };
    const stats: ElysiumStatsResponse = elysiumStats({ network: NET, now: 0, pulse, rows: PROTOCOLS, live: null, radar: null });
    assert.deepEqual(stats.chain.blocksPerDay, { value: 751_304, basis: "estimate", source: "86,400 s / measured block time" });
    assert.equal(stats.chain.txPerDay.value, 1_080_000);
    assert.equal(stats.chain.head.basis, "measured");
    assert.equal(stats.ecosystem.protocols.basis, "registry");
    assert.ok((stats.ecosystem.protocols.value ?? 0) >= 90);
    assert.equal(stats.activity.activeProtocols.value, null, "no live check: null, not zero");
    const blind = elysiumStats({ network: NET, now: 0, pulse: null, rows: PROTOCOLS, live: null, radar: null });
    assert.equal(blind.chain.tps.value, null);
  });
});

/* -------------------------------------------------------------------- HTTP */

describe("discovery: HTTP", () => {
  let ctx: AppContext;
  let served: Served;
  let rpc: FakeRpc;
  const pulse: PulseFeed = {
    defaultNetwork: NET,
    retain: () => () => undefined,
    // Like the real pulse: only Elysium networks are polled.
    latest: (network) => {
      if (!network.startsWith("elysium")) throw new Error(`${network} is not an Elysium network.`);
      return null;
    },
    recentBlocks: () => [],
    waitForPulse: () => Promise.resolve(null),
    status: () => ({}),
    close: () => undefined,
  };
  const get = async (path: string) => {
    const response = await fetch(`${served.url}${path}`);
    return { response, body: (await response.json()) as Record<string, unknown> };
  };

  before(async () => {
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_RATE_LIMIT_HEAVY: "10000" }), { pulse });
    rpc = new FakeRpc();
    rpc.meta.set(NEW_TOKEN, { name: "New Token", symbol: "NEW", decimals: 18, totalSupply: 1n });
    rpc.logsFor = () => [log(KALOS_FACTORY, [TOPICS.v3PoolCreated, word(NEW_TOKEN), word(WHYPE), word("0x0000000000000000000000000000000000002710")], encodeAbiParameters([{ type: "int24" }, { type: "address" }], [200, POOL]), rpc.headBlock - 10)];
    setDiscovery(ctx, createDiscovery(ctx, { rpc, shieldEngine: () => stubEngine(() => null, false), radarPollMs: 60_000 }));
    served = await serve(createApp(ctx));
  });
  after(async () => {
    setDiscovery(ctx, createDiscovery(ctx, { rpc }));
    await served.close();
    await closeContext(ctx);
  });

  it("GET /v1/protocols lists, filters, counts and reports what executes", async () => {
    const all = await get("/v1/protocols");
    assert.equal(all.response.status, 200);
    const body = all.body as unknown as ProtocolListResponse;
    assert.equal(body.count, PROTOCOLS.length);
    assert.equal(body.total, PROTOCOLS.length);
    assert.ok(body.executableIds.includes("hyperswap-v3"));
    assert.equal(Object.values(body.counts.byKind).reduce((sum, count) => sum + count, 0), PROTOCOLS.length);
    const dex = (await get("/v1/protocols?network=hyperevm-testnet&kind=dex&executable=true&view=summary")).body as unknown as ProtocolListResponse<ProtocolSummary>;
    assert.deepEqual(dex.protocols.map((row) => row.id), ["hyperswap-v3"]);
    assert.equal(dex.counts.byKind.dex, 1);
    assert.equal(((await get("/v1/protocols?q=signal")).body.protocols as { id: string }[])[0]?.id, "signal");
    assert.equal((await get("/v1/protocols?kind=spaceship")).response.status, 400);
    assert.equal((await get("/v1/protocols?status=alive")).response.status, 400);
    assert.equal((await get("/v1/protocols?q=a")).response.status, 400);
    const one = await get("/v1/protocols/hyperswap-v3");
    assert.equal((one.body.protocol as { executable: boolean }).executable, true);
    assert.equal((await get("/v1/protocols/nope")).response.status, 404);
  });

  it("GET /v1/protocols/live, /v1/addresses/:address/protocols and /v1/tokens/flagged", async () => {
    const live = await get("/v1/protocols/live?network=elysium-testnet");
    assert.equal(live.response.status, 200);
    assert.equal((live.body as unknown as ProtocolLiveResponse).cacheSeconds, 600);
    assert.equal((await get("/v1/protocols/live?network=hypercore-testnet")).response.status, 400);
    const hyperevm = (await get("/v1/protocols/live?network=hyperevm-testnet")).body as unknown as ProtocolLiveResponse;
    assert.deepEqual([hyperevm.window?.blocks, hyperevm.window?.approxSeconds], [50, 50], "HyperEVM RPC limit (50 blocks), nominal 1 s blocks where no pulse runs");
    assert.ok(hyperevm.protocols.some((row) => row.protocolId === "hyperswap-v3"));
    const touches = await get("/v1/addresses/0x752F6816BC514E1EEFF852B2EADCD96F6C0F9F3F/protocols");
    assert.equal((touches.body.protocols as { protocolId: string }[])[0]?.protocolId, "kalos-v3");
    const lookalike = FLAGGED_TOKENS[0] as (typeof FLAGGED_TOKENS)[number];
    assert.equal(((await get(`/v1/addresses/${lookalike.address}/protocols`)).body.flaggedToken as { address: string }).address, lookalike.address);
    assert.equal((await get("/v1/addresses/0x123/protocols")).response.status, 400);
    const flagged = await get("/v1/tokens/flagged?network=elysium-testnet");
    assert.equal(flagged.body.count, FLAGGED_TOKENS.filter((row) => row.network === NET).length);
    assert.ok(TOKENS.length > 0);
  });

  it("GET /v1/discovery/launches and its SSE stream", async () => {
    const first = (await get("/v1/discovery/launches")).body as unknown as LaunchesResponse;
    assert.equal(first.network, NET);
    assert.equal(first.running, true);
    // The first scan runs in the background: wait for it.
    let launches = first.launches;
    for (let attempt = 0; attempt < 50 && launches.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      launches = ((await get("/v1/discovery/launches?kind=v3-pool")).body as unknown as LaunchesResponse).launches;
    }
    assert.equal(launches[0]?.tokens[0]?.symbol, "NEW");
    const stream = await readSse(`${served.url}/v1/discovery/launches/stream`, (messages) => messages.some((message) => message.event === "launch"));
    assert.equal(stream.status, 200);
    assert.equal(stream.messages[0]?.event, "status");
    assert.ok(stream.messages.some((message) => message.event === "launch" && message.id === launches[0]?.id));
    assert.equal((await get("/v1/discovery/launches?kind=rocket")).response.status, 400);
    assert.equal((await fetch(`${served.url}/v1/discovery/launches/stream?network=elysium-mainnet`)).status, 503);
  });

  it("GET /v1/discovery/shield/:token and /v1/elysium/stats", async () => {
    rpc.code.set(NEW_TOKEN, PLAIN_TOKEN_CODE);
    const shield = await get(`/v1/discovery/shield/${NEW_TOKEN}?network=elysium-testnet`);
    assert.equal(shield.response.status, 200);
    assert.ok(["caution", "unknown"].includes(shield.body.verdict as string), String(shield.body.verdict));
    assert.equal((await get("/v1/discovery/shield/0xnope")).response.status, 400);
    assert.equal((await get(`/v1/discovery/shield/${NEW_TOKEN}?network=elysium-mainnet`)).response.status, 503);
    const stats = await get("/v1/elysium/stats");
    assert.equal(stats.response.status, 200);
    assert.equal((stats.body as unknown as ElysiumStatsResponse).ecosystem.protocols.basis, "registry");
    assert.equal((await get("/v1/elysium/stats?network=hyperevm-testnet")).response.status, 400);
  });

  it("GET /v1/health and /v1/venues report what the engine executes", async () => {
    const health = await get("/v1/health");
    const registry = health.body.registry as { executable: number; executableIds: string[] };
    assert.equal(registry.executable, liveRegistry(ctx).executableIds.length);
    assert.ok(registry.executableIds.includes("signal"));
    const venues = await get("/v1/venues");
    assert.deepEqual(venues.body.executableProtocols, liveRegistry(ctx).executableIds);
    const rows = venues.body.venues as { id: string; status: string }[];
    assert.ok(!rows.some((row) => liveRegistry(ctx).executableIds.includes(row.id) && row.status === "read-only"), "an executed protocol is never listed read-only");
  });
});
