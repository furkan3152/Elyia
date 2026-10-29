/**
 * Dependency probes for GET /v1/health and GET /v1/networks: every RPC
 * endpoint of every EVM network (eth_chainId must match the registry, plus
 * eth_blockNumber), Hyperliquid info reachability per HyperCore network, and
 * the store. Results are cached 15 s and concurrent callers share one probe
 * round; probes never throw and never return provider text or endpoint
 * paths (only scheme://host, since paths can carry API keys).
 */
import type { Network, NetworkKey } from "@elyia/core";
import type { Clock } from "../clock.js";
import { endpointLabel } from "../elysium/rpc.js";
import type { HyperliquidClients } from "../hyperliquid/index.js";
import type { FetchLike } from "../hyperliquid/info.js";
import type { Store } from "../store/types.js";

export const HEALTH_CACHE_MS = 15_000;
export const PROBE_TIMEOUT_MS = 4_000;
/** An endpoint this many blocks behind the best endpoint of its network is reported stale. */
export const STALE_LAG_BLOCKS = 500;

export interface RpcProbe {
  readonly endpoint: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly head: number | null;
  /** Set when ok is false: a short reason in Elyia's words. */
  readonly problem?: "timeout" | "unreachable" | "chain_mismatch" | "stale" | "invalid_response";
}

export interface NetworkProbe {
  readonly network: NetworkKey;
  readonly kind: "evm" | "hypercore";
  /** At least one endpoint answered correctly. */
  readonly reachable: boolean;
  readonly head: number | null;
  readonly latencyMs: number | null;
  /** Why nothing is probed (e.g. no RPC endpoint before launch). */
  readonly note?: string;
  readonly endpoints: readonly RpcProbe[];
}

export interface StoreProbe {
  readonly kind: Store["kind"];
  readonly ok: boolean;
  readonly latencyMs: number;
}

export interface DependencyReport {
  readonly checkedAt: number;
  readonly networks: Readonly<Partial<Record<NetworkKey, NetworkProbe>>>;
  readonly store: StoreProbe;
}

export interface DependencyMonitorOptions {
  readonly networks: Readonly<Record<NetworkKey, Network>>;
  readonly hyperliquid: HyperliquidClients;
  readonly store: Store;
  readonly clock: Clock;
  readonly fetch?: FetchLike;
  readonly cacheMs?: number;
  readonly timeoutMs?: number;
}

interface RpcAnswer {
  readonly id?: unknown;
  readonly result?: unknown;
}

export class DependencyMonitor {
  private cached: DependencyReport | null = null;
  private inflight: Promise<DependencyReport> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly cacheMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: DependencyMonitorOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.cacheMs = options.cacheMs ?? HEALTH_CACHE_MS;
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  /** The cached report when fresh, else one shared probe round. */
  async report(): Promise<DependencyReport> {
    const now = this.options.clock.now();
    if (this.cached && now - this.cached.checkedAt < this.cacheMs) return this.cached;
    if (this.inflight) return this.inflight;
    const round = this.probeAll()
      .then((report) => {
        this.cached = report;
        return report;
      })
      .finally(() => {
        if (this.inflight === round) this.inflight = null;
      });
    this.inflight = round;
    return round;
  }

  /** The last report without probing (may be null or stale). */
  peek(): DependencyReport | null {
    return this.cached;
  }

  private async probeAll(): Promise<DependencyReport> {
    const entries = Object.values(this.options.networks) as Network[];
    const [probes, store] = await Promise.all([Promise.all(entries.map((network) => this.probeNetwork(network))), this.probeStore()]);
    const networks: Partial<Record<NetworkKey, NetworkProbe>> = {};
    for (const probe of probes) networks[probe.network] = probe;
    return { checkedAt: this.options.clock.now(), networks, store };
  }

  private async probeNetwork(network: Network): Promise<NetworkProbe> {
    if (network.vm === "hypercore") return this.probeHyperCore(network.key);
    if (network.rpcUrls.length === 0) {
      return {
        network: network.key,
        kind: "evm",
        reachable: false,
        head: null,
        latencyMs: null,
        note: network.status === "prelaunch" ? "Not launched publicly; no RPC endpoint configured." : "No RPC endpoint configured.",
        endpoints: [],
      };
    }
    const raw = await Promise.all(network.rpcUrls.map((url) => this.probeRpc(url, network.chainId)));
    const best = Math.max(0, ...raw.map((probe) => (probe.ok ? (probe.head ?? 0) : 0)));
    const endpoints = raw.map((probe): RpcProbe =>
      probe.ok && probe.head !== null && best - probe.head > STALE_LAG_BLOCKS ? { ...probe, ok: false, problem: "stale" } : probe,
    );
    const healthy = endpoints.filter((probe) => probe.ok);
    return {
      network: network.key,
      kind: "evm",
      reachable: healthy.length > 0,
      head: healthy.length > 0 ? best : null,
      latencyMs: healthy.length > 0 ? Math.min(...healthy.map((probe) => probe.latencyMs)) : null,
      endpoints,
    };
  }

  private async probeRpc(url: string, chainId: number): Promise<RpcProbe> {
    const endpoint = endpointLabel(url);
    const started = this.options.clock.now();
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
        ]),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const latencyMs = this.options.clock.now() - started;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { endpoint, ok: false, latencyMs, head: null, problem: "unreachable" };
      }
      const body = (await response.json()) as unknown;
      const answers = Array.isArray(body) ? (body as RpcAnswer[]) : [];
      const chain = answers.find((answer) => answer?.id === 1)?.result;
      const head = answers.find((answer) => answer?.id === 2)?.result;
      if (typeof chain !== "string" || typeof head !== "string") return { endpoint, ok: false, latencyMs, head: null, problem: "invalid_response" };
      if (Number.parseInt(chain, 16) !== chainId) return { endpoint, ok: false, latencyMs, head: null, problem: "chain_mismatch" };
      return { endpoint, ok: true, latencyMs, head: Number.parseInt(head, 16) };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { endpoint, ok: false, latencyMs: this.options.clock.now() - started, head: null, problem: timedOut ? "timeout" : "unreachable" };
    }
  }

  private async probeHyperCore(key: NetworkKey): Promise<NetworkProbe> {
    const client = this.options.hyperliquid.info(key);
    const endpoint = endpointLabel(client.network.infoUrl);
    const started = this.options.clock.now();
    try {
      // Weight 2, never cached: reachability right now.
      const status = await client.exchangeStatus({ cacheMs: 0 });
      const latencyMs = this.options.clock.now() - started;
      const ok = typeof status === "object" && status !== null && typeof status.time === "number";
      return {
        network: key,
        kind: "hypercore",
        reachable: ok,
        head: null,
        latencyMs: ok ? latencyMs : null,
        endpoints: [{ endpoint, ok, latencyMs, head: null, ...(ok ? {} : { problem: "invalid_response" as const }) }],
      };
    } catch (error) {
      const latencyMs = this.options.clock.now() - started;
      const code = (error as { code?: unknown }).code;
      return {
        network: key,
        kind: "hypercore",
        reachable: false,
        head: null,
        latencyMs: null,
        endpoints: [{ endpoint, ok: false, latencyMs, head: null, problem: code === "UPSTREAM_TIMEOUT" ? "timeout" : "unreachable" }],
      };
    }
  }

  private async probeStore(): Promise<StoreProbe> {
    const started = this.options.clock.now();
    try {
      await this.options.store.ping();
      return { kind: this.options.store.kind, ok: true, latencyMs: this.options.clock.now() - started };
    } catch {
      return { kind: this.options.store.kind, ok: false, latencyMs: this.options.clock.now() - started };
    }
  }
}
