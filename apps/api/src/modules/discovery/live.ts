/**
 * GET /v1/protocols/live: is each registry protocol still there, and is it
 * doing anything? Per network, every verified registry contract is checked
 * for bytecode (batched EXTCODESIZE, CODE_SIZE_BATCH per request) and the
 * contracts' logs over the last `logWindow` blocks (the network's public
 * eth_getLogs limit, at most MAX_LOG_BLOCKS) are counted
 * (address-filtered eth_getLogs, LOG_ADDRESS_BATCH addresses per request).
 * One check costs a handful of requests and is cached LIVE_CACHE_MS
 * (concurrent callers share one in-flight check), well inside the public
 * RPC limits.
 */
import { NETWORKS, type NetworkKey, type ProtocolDescriptor } from "@elyia/core";
import type { ProtocolLiveResponse, ProtocolLiveRow } from "@elyia/core/api/discovery";
import type { Clock } from "../../clock.js";
import { MAX_LOG_BLOCKS, type DiscoveryRpc } from "./rpc.js";

export const LIVE_CACHE_MS = 10 * 60_000;

interface Watched {
  readonly protocol: ProtocolDescriptor;
  readonly addresses: readonly string[];
  readonly deploymentStatus: ProtocolLiveRow["deploymentStatus"];
}

/** Registry contracts per protocol on `network` (lower-case addresses). */
export function watchedContracts(rows: readonly ProtocolDescriptor[], network: NetworkKey): Watched[] {
  const out: Watched[] = [];
  for (const protocol of rows) {
    const deployment = protocol.deployments.find((entry) => entry.network === network);
    if (!deployment) continue;
    const addresses = [...new Set((deployment.contractInfo ?? []).map((contract) => contract.address.toLowerCase()))];
    if (addresses.length === 0) continue;
    out.push({ protocol, addresses, deploymentStatus: deployment.status });
  }
  return out;
}

export interface LiveCheckerOptions {
  readonly rpc: DiscoveryRpc;
  readonly clock: Clock;
  readonly rows: () => readonly ProtocolDescriptor[];
  /** Measured block interval of a network (the pulse), for the window's duration. */
  readonly blockTimeMs?: (network: NetworkKey) => number | null;
  readonly cacheMs?: number;
}

/** Blocks per eth_getLogs request on a network: its public RPC limit, never above MAX_LOG_BLOCKS. */
export function logWindow(network: NetworkKey): number {
  const entry = NETWORKS[network];
  return Math.max(1, Math.min(MAX_LOG_BLOCKS, entry.vm === "evm" ? entry.logRangeLimit : MAX_LOG_BLOCKS));
}

export class LiveChecker {
  private readonly cache = new Map<NetworkKey, { readonly at: number; readonly value: ProtocolLiveResponse }>();
  private readonly inflight = new Map<NetworkKey, Promise<ProtocolLiveResponse>>();

  constructor(private readonly options: LiveCheckerOptions) {}

  /** The cached check, or a fresh one (shared by concurrent callers). */
  check(network: NetworkKey): Promise<ProtocolLiveResponse> {
    const cached = this.cache.get(network);
    const ttl = this.options.cacheMs ?? LIVE_CACHE_MS;
    if (cached && this.options.clock.now() - cached.at < ttl) return Promise.resolve(cached.value);
    let running = this.inflight.get(network);
    if (!running) {
      running = this.run(network)
        .then((value) => {
          this.cache.set(network, { at: this.options.clock.now(), value });
          return value;
        })
        .finally(() => this.inflight.delete(network));
      this.inflight.set(network, running);
    }
    return running;
  }

  /** The last completed check, if any (no RPC). */
  peek(network: NetworkKey): ProtocolLiveResponse | null {
    return this.cache.get(network)?.value ?? null;
  }

  private async run(network: NetworkKey): Promise<ProtocolLiveResponse> {
    const { rpc, clock } = this.options;
    const watched = watchedContracts(this.options.rows(), network);
    const unique = [...new Set(watched.flatMap((entry) => entry.addresses))];
    const notes: string[] = [];
    const cacheSeconds = Math.round((this.options.cacheMs ?? LIVE_CACHE_MS) / 1000);
    const checkedAt = new Date(clock.now()).toISOString();
    if (!rpc.available(network)) {
      notes.push(`${NETWORKS[network].name} has no RPC endpoint configured on this server: presence and activity are unknown.`);
      return this.assemble(network, watched, new Map(), null, null, null, checkedAt, cacheSeconds, notes);
    }
    let head: number | null = null;
    try {
      head = await rpc.head(network);
    } catch {
      notes.push("The chain head could not be read: activity is unknown.");
    }
    const sizes = new Map<string, number | null>();
    try {
      const read = await rpc.codeSizes(network, unique);
      unique.forEach((address, index) => sizes.set(address, read[index] ?? null));
    } catch {
      notes.push("Bytecode sizes could not be read.");
    }
    let activity: Map<string, { count: number; last: number }> | null = null;
    let window: ProtocolLiveResponse["window"] = null;
    if (head !== null) {
      const fromBlock = Math.max(0, head - logWindow(network) + 1);
      const blockTime = this.options.blockTimeMs?.(network) ?? null;
      window = { fromBlock, toBlock: head, blocks: head - fromBlock + 1, approxSeconds: blockTime === null ? null : Math.round(((head - fromBlock + 1) * blockTime) / 1000) };
      try {
        const logs = await rpc.logs(network, { addresses: unique, fromBlock, toBlock: head });
        activity = new Map();
        for (const log of logs) {
          const entry = activity.get(log.address) ?? { count: 0, last: 0 };
          entry.count += 1;
          entry.last = Math.max(entry.last, log.blockNumber);
          activity.set(log.address, entry);
        }
      } catch {
        notes.push(`Logs of the last ${window.blocks} blocks could not be read (RPC limit or outage): activity is unknown.`);
      }
    }
    notes.push(`Activity counts logs over the last ${logWindow(network)} blocks only (the RPC's eth_getLogs limit): a quiet protocol may simply be idle.`);
    return this.assemble(network, watched, sizes, activity, head, window, checkedAt, cacheSeconds, notes);
  }

  private assemble(
    network: NetworkKey,
    watched: readonly Watched[],
    sizes: ReadonlyMap<string, number | null>,
    activity: ReadonlyMap<string, { count: number; last: number }> | null,
    head: number | null,
    window: ProtocolLiveResponse["window"],
    checkedAt: string,
    cacheSeconds: number,
    notes: readonly string[],
  ): ProtocolLiveResponse {
    const protocols: ProtocolLiveRow[] = watched.map(({ protocol, addresses, deploymentStatus }) => {
      const size = (address: string) => sizes.get(address);
      const present = addresses.filter((address) => (size(address) ?? 0) > 0).length;
      const missing = addresses.filter((address) => size(address) === 0);
      const unknown = addresses.filter((address) => size(address) === null || size(address) === undefined).length;
      const hits = activity ? addresses.map((address) => activity.get(address)).filter((entry): entry is { count: number; last: number } => entry !== undefined) : null;
      const recentLogs = hits ? hits.reduce((sum, entry) => sum + entry.count, 0) : null;
      return {
        protocolId: protocol.id,
        name: protocol.name,
        kind: protocol.kind,
        status: protocol.status,
        deploymentStatus,
        contracts: addresses.length,
        present,
        missing,
        unknown,
        recentLogs,
        active: recentLogs === null ? null : recentLogs > 0,
        lastActivityBlock: hits && hits.length > 0 ? Math.max(...hits.map((entry) => entry.last)) : null,
      };
    });
    protocols.sort((a, b) => (b.recentLogs ?? -1) - (a.recentLogs ?? -1) || a.protocolId.localeCompare(b.protocolId));
    const contracts = new Set(watched.flatMap((entry) => entry.addresses));
    const present = [...contracts].filter((address) => (sizes.get(address) ?? 0) > 0).length;
    const missing = [...contracts].filter((address) => sizes.get(address) === 0).length;
    return {
      network,
      checkedAt,
      cacheSeconds,
      head,
      window,
      protocols,
      totals: { protocols: protocols.length, contracts: contracts.size, present, missing, active: protocols.filter((row) => row.active === true).length },
      notes,
    };
  }
}
