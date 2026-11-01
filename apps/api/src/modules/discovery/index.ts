/**
 * Discovery: the protocol registry as this server runs it, its live on-chain
 * check, address lookups, flagged tokens, the launch radar, Shield and the
 * Elysium ecosystem stats.
 *
 *   GET /protocols                    registry rows + counts (network, kind, category, status, executable, tag, q, view)
 *   GET /protocols/live               bytecode presence + recent activity per protocol (cached 10 min)
 *   GET /protocols/:id                one row
 *   GET /addresses/:address/protocols registry contracts at an address (+ flagged token)
 *   GET /tokens/flagged               look-alike and suspicious tokens
 *   GET /discovery/launches           launch radar (JSON)
 *   GET /discovery/launches/stream    launch radar (SSE: launch, status)
 *   GET /discovery/shield/:token      Shield token report
 *   GET /elysium/stats                ecosystem figures, labelled
 *
 * Contract types: @elyia/core/api/discovery. Reads only; nothing is signed.
 */
import { PULSE_WAIT_MS } from "../system/elysium.js";
import { flaggedToken, flaggedTokensFor, NETWORKS, protocolsTouching, protocolSummary, type NetworkKey } from "@elyia/core";
import type {
  AddressLookupResponse,
  FlaggedTokenListResponse,
  LaunchesResponse,
  ProtocolDetailResponse,
  ProtocolListResponse,
  ProtocolSummary,
} from "@elyia/core/api/discovery";
import { LAUNCH_STREAM_EVENTS } from "@elyia/core/api/discovery";
import type { ProtocolDescriptor } from "@elyia/core";
import { z } from "zod";
import { elysiumNetworkFor } from "../../config.js";
import type { AppContext } from "../../context.js";
import { createEngine, type Engine } from "../../engine/index.js";
import { ChainsEvmPort } from "../../engine/ports/evm.js";
import { ElyiaHttpError, networkUnavailable, notFound } from "../../http/errors.js";
import { cachePublicly } from "../../http/request.js";
import type { ApiModule } from "../../http/router.js";
import { openSse } from "../../http/sse.js";
import { evmAddress, parseParams, parseQuery, queryInteger } from "../../http/validate.js";
import { environment, networkKey } from "../system/query.js";
import { FundedAccountPort } from "./fundedPort.js";
import { LaunchRadar } from "./launches.js";
import { LiveChecker } from "./live.js";
import { filterRegistry, liveRegistry, registryCounts, type LiveRegistry } from "./registry.js";
import { ViemDiscoveryRpc, type DiscoveryRpc } from "./rpc.js";
import { Shield, SHIELD_ACCOUNT, SHIELD_FUNDS } from "./shield.js";
import { elysiumStats } from "./stats.js";

export interface Discovery {
  readonly rpc: DiscoveryRpc;
  readonly registry: LiveRegistry;
  readonly live: LiveChecker;
  readonly shield: Shield;
  /** The radar of a network (created on first use, started by the module's start hook or the first request). */
  radar(network: NetworkKey): LaunchRadar;
  stopAll(): void;
}

export interface DiscoveryOptions {
  readonly rpc?: DiscoveryRpc;
  readonly registry?: LiveRegistry;
  /** The engine Shield plans with (default: one whose EVM port funds SHIELD_ACCOUNT). */
  readonly shieldEngine?: () => Engine;
  readonly radarPollMs?: number;
}

const instances = new WeakMap<AppContext, Discovery>();

export function createDiscovery(ctx: AppContext, options: DiscoveryOptions = {}): Discovery {
  const rpc = options.rpc ?? new ViemDiscoveryRpc(ctx.chains);
  let registry: LiveRegistry | null = options.registry ?? null;
  const rows = () => (registry ??= liveRegistry(ctx)).rows;
  // Measured block time when the pulse runs, else the registry's nominal one.
  const blockTimeMs = (network: NetworkKey) => {
    const entry = NETWORKS[network];
    if (entry.vm !== "evm") return null;
    // The pulse only polls Elysium networks (it rejects the others).
    return (entry.family === "elysium" ? ctx.pulse.latest(network)?.blockTimeMs : undefined) ?? entry.blockTimeMs;
  };
  const live = new LiveChecker({ rpc, clock: ctx.clock, rows, blockTimeMs });
  let engine: Engine | null = null;
  const shieldEngine = options.shieldEngine ?? (() => (engine ??= createEngine(ctx, { deps: { evm: new FundedAccountPort(new ChainsEvmPort(ctx.chains, ctx.clock), SHIELD_ACCOUNT, SHIELD_FUNDS) } })));
  const shield = new Shield({ rpc, clock: ctx.clock, log: ctx.log.child({ component: "shield" }), engine: shieldEngine });
  const radars = new Map<NetworkKey, LaunchRadar>();
  return {
    rpc,
    get registry() {
      return (registry ??= liveRegistry(ctx));
    },
    live,
    shield,
    radar(network) {
      let radar = radars.get(network);
      if (!radar) {
        radar = new LaunchRadar({ network, rpc, clock: ctx.clock, log: ctx.log.child({ component: "launch-radar" }), rows, ...(options.radarPollMs ? { pollMs: options.radarPollMs } : {}) });
        radars.set(network, radar);
      }
      return radar;
    },
    stopAll() {
      for (const radar of radars.values()) radar.stop();
    },
  };
}

/** The context's discovery services (created on first use). */
export function discoveryFor(ctx: AppContext): Discovery {
  let discovery = instances.get(ctx);
  if (!discovery) {
    discovery = createDiscovery(ctx);
    instances.set(ctx, discovery);
  }
  return discovery;
}

/** Installs prebuilt discovery services for a context (tests). */
export function setDiscovery(ctx: AppContext, discovery: Discovery): void {
  instances.set(ctx, discovery);
}

/* ---------------------------------------------------------------- schemas */

const kind = z.string().trim().min(1).max(32).regex(/^[a-z-]+$/u);
const booleanText = z.enum(["true", "false"], { errorMap: () => ({ message: "Expected true or false." }) });

export const protocolsQuerySchema = z.object({
  network: networkKey.optional(),
  environment: environment.optional(),
  kind: kind.optional(),
  category: kind.optional(),
  status: z.enum(["live-mainnet", "live-testnet", "announced-mainnet", "unknown", "deprecated"]).optional(),
  executable: booleanText.optional(),
  tag: z.string().trim().min(1).max(48).regex(/^[a-z0-9-]+$/u).optional(),
  q: z.string().trim().min(2, "Search with at least 2 characters.").max(64).optional(),
  view: z.enum(["full", "summary"]).optional(),
});

const networkQuery = z.object({ network: networkKey.optional() });
const idParams = z.object({ id: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/u, "Unknown protocol id.") });
const addressParams = z.object({ address: evmAddress });
const tokenParams = z.object({ token: evmAddress });
const launchesQuery = z.object({
  network: networkKey.optional(),
  protocol: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/u).optional(),
  kind: z.enum(["v2-pair", "v3-pool", "v4-pool", "launchpad-event"]).optional(),
  limit: queryInteger(1, 300).optional(),
});

/* ----------------------------------------------------------------- routes */

function evmNetwork(ctx: AppContext, network: NetworkKey | undefined): NetworkKey {
  const key = network ?? elysiumNetworkFor(ctx.config.mode);
  if (NETWORKS[key].vm !== "evm") throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${key} is not an EVM network: discovery reads EVM contracts.`, { network: key });
  return key;
}

function readable(discovery: Discovery, network: NetworkKey): void {
  if (!discovery.rpc.available(network)) throw networkUnavailable(NETWORKS[network].name, NETWORKS[network].status === "prelaunch" ? "it has not launched publicly and no RPC endpoint is configured" : "no RPC endpoint is configured");
}

function knownKind(value: string | undefined, field: string): void {
  if (value === undefined) return;
  // Validated against the registry's own vocabulary: an unknown filter is a 400, never an empty list.
  const kinds = ["bridge", "perps", "spot-orderbook", "dex", "aggregator", "lending", "cdp", "liquid-staking", "staking", "vault", "launchpad", "prediction", "oracle", "infra", "wallet", "indexer", "analytics", "game", "tools", "nft", "rwa", "names", "otc", "stablecoin"];
  if (!kinds.includes(value)) throw new ElyiaHttpError("INVALID_REQUEST", 400, `Unknown ${field} ${value}.`, { allowed: kinds });
}

export const discoveryModule: ApiModule = {
  name: "discovery",
  register(router, ctx) {
    const discovery = () => discoveryFor(ctx);

    router.get("/protocols", (req, res) => {
      const query = parseQuery(req, protocolsQuerySchema);
      knownKind(query.kind, "kind");
      knownKind(query.category, "category");
      const { registry } = discovery();
      const rows = filterRegistry(registry.rows, {
        ...(query.network ? { network: query.network } : {}),
        ...(query.environment ? { environment: query.environment } : {}),
        ...(query.kind ? { kind: query.kind as ProtocolDescriptor["kind"] } : {}),
        ...(query.category ? { category: query.category as ProtocolDescriptor["kind"] } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.executable ? { executable: query.executable === "true" } : {}),
        ...(query.tag ? { tag: query.tag } : {}),
        ...(query.q ? { q: query.q } : {}),
      });
      const base = { count: rows.length, counts: registryCounts(rows), total: registry.rows.length, executableIds: registry.executableIds };
      cachePublicly(res, 60);
      if (query.view === "summary") {
        const body: ProtocolListResponse<ProtocolSummary> = { ...base, protocols: rows.map(protocolSummary) };
        res.json(body);
        return;
      }
      const body: ProtocolListResponse = { ...base, protocols: rows };
      res.json(body);
    });

    router.get("/protocols/live", ctx.limits.heavy, async (req, res) => {
      const query = parseQuery(req, networkQuery);
      const network = evmNetwork(ctx, query.network);
      const body = await discovery().live.check(network);
      cachePublicly(res, 60);
      res.json(body);
    });

    router.get("/protocols/:id", (req, res) => {
      const { id } = parseParams(req, idParams);
      const protocol = discovery().registry.byId(id);
      if (!protocol) throw notFound(`No protocol ${id} in the registry (see GET /v1/protocols).`);
      cachePublicly(res, 60);
      const body: ProtocolDetailResponse = { protocol };
      res.json(body);
    });

    router.get("/addresses/:address/protocols", (req, res) => {
      const { address } = parseParams(req, addressParams);
      const query = parseQuery(req, networkQuery);
      const registry = discovery().registry;
      const touches = protocolsTouching(address, query.network).map((touch) => ({
        protocolId: touch.protocol.id,
        protocolName: registry.byId(touch.protocol.id)?.name ?? touch.protocol.name,
        network: touch.network,
        deploymentStatus: touch.deploymentStatus,
        contract: touch.contract,
      }));
      const networks: NetworkKey[] = query.network ? [query.network] : (Object.keys(NETWORKS) as NetworkKey[]).filter((key) => NETWORKS[key].vm === "evm");
      const flagged = networks.map((network) => flaggedToken(network, address)).find((row) => row !== null) ?? null;
      cachePublicly(res, 60);
      const body: AddressLookupResponse = { address, protocols: touches, flaggedToken: flagged };
      res.json(body);
    });

    router.get("/tokens/flagged", (req, res) => {
      const query = parseQuery(req, networkQuery);
      const tokens = flaggedTokensFor(query.network);
      cachePublicly(res, 300);
      const body: FlaggedTokenListResponse = { count: tokens.length, tokens };
      res.json(body);
    });

    router.get("/discovery/launches", (req, res) => {
      const query = parseQuery(req, launchesQuery);
      const network = evmNetwork(ctx, query.network);
      const radar = discovery().radar(network);
      radar.start();
      const body: LaunchesResponse = {
        ...radar.status(),
        launches: radar.list({ ...(query.protocol ? { protocol: query.protocol } : {}), ...(query.kind ? { kind: query.kind } : {}), limit: query.limit ?? 50 }),
      };
      cachePublicly(res, 5);
      res.json(body);
    });

    router.get("/discovery/launches/stream", (req, res) => {
      const query = parseQuery(req, launchesQuery);
      const network = evmNetwork(ctx, query.network);
      readable(discovery(), network);
      const radar = discovery().radar(network);
      radar.start();
      const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
      if (stream.closed) return;
      // Replay what is buffered (oldest first), then follow; `Last-Event-ID` resumes after a launch id.
      const buffered = radar.list({ limit: query.limit ?? 20, ...(query.protocol ? { protocol: query.protocol } : {}), ...(query.kind ? { kind: query.kind } : {}) }).reverse();
      const resumeAt = stream.lastEventId ? buffered.findIndex((launch) => launch.id === stream.lastEventId) : -1;
      stream.send(LAUNCH_STREAM_EVENTS.status, radar.status());
      for (const launch of buffered.slice(resumeAt + 1)) stream.send(LAUNCH_STREAM_EVENTS.launch, launch, launch.id);
      const off = radar.subscribe((launch) => {
        if ((query.protocol && launch.protocolId !== query.protocol) || (query.kind && launch.kind !== query.kind)) return;
        stream.send(LAUNCH_STREAM_EVENTS.launch, launch, launch.id);
      });
      stream.onClose(off);
    });

    router.get("/discovery/shield/:token", ctx.limits.heavy, async (req, res) => {
      const { token } = parseParams(req, tokenParams);
      const query = parseQuery(req, networkQuery);
      const network = evmNetwork(ctx, query.network);
      readable(discovery(), network);
      const report = await discovery().shield.inspect(network, token);
      cachePublicly(res, 30);
      res.json(report);
    });

    router.get("/elysium/stats", async (req, res) => {
      const query = parseQuery(req, networkQuery);
      const network = query.network ?? elysiumNetworkFor(ctx.config.mode);
      if (NETWORKS[network].family !== "elysium") throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${network} is not an Elysium network.`, { network });
      const services = discovery();
      const available = services.rpc.available(network);
      const pulse = available ? await ctx.pulse.waitForPulse(network, { timeoutMs: PULSE_WAIT_MS }).catch(() => ctx.pulse.latest(network)) : null;
      const live = services.live.peek(network);
      // Warm the cache for the next caller (one check per 10 minutes at most).
      if (!live && available) void services.live.check(network).catch(() => undefined);
      const radar = available ? services.radar(network) : null;
      radar?.start();
      const body = elysiumStats({ network, now: ctx.clock.now(), pulse, rows: services.registry.rows, live, radar: radar ? { ...radar.status(), seen: radar.count() } : null });
      // Never cache a reply without chain figures: the next caller should get a fresh pulse.
      if (pulse) cachePublicly(res, 15);
      else res.setHeader("Cache-Control", "no-store");
      res.json(body);
    });
  },
  start(ctx) {
    const network = elysiumNetworkFor(ctx.config.mode);
    const discovery = discoveryFor(ctx);
    if (discovery.rpc.available(network)) discovery.radar(network).start();
  },
  stop(ctx) {
    instances.get(ctx)?.stopAll();
  },
};
