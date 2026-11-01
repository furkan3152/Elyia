/**
 * The launch radar: new pairs, pools and launch tokens from the factories
 * and launchpads of the verified registry. One address-filtered eth_getLogs
 * per window of at most `logWindow` blocks (2,000 on Elysium; all sources in
 * one request),
 * a few windows per tick to catch up, then the head every LAUNCH_POLL_MS.
 *
 * Decoded: Uniswap V2 PairCreated, V3 PoolCreated, V4 Initialize and
 * Algebra Pool. Any other event of a launchpad contract counts only when one
 * of its indexed addresses is a contract answering ERC-20 metadata, and only
 * the first time the radar sees that token (dedupe by event id and token),
 * so buy/sell chatter does not flood it. Token metadata is read for at most
 * ENRICH_PER_TICK new tokens per tick, gentle on the shared RPC.
 */
import { flaggedToken, getToken, NETWORKS, erc20AssetId, type NetworkKey, type ProtocolDescriptor } from "@elyia/core";
import type { LaunchesResponse, LaunchKind, LaunchTokenView, LaunchView } from "@elyia/core/api/discovery";
import { toEventSelector, type Hex } from "viem";
import type { Clock } from "../../clock.js";
import type { Logger } from "../../log.js";
import { logWindow } from "./live.js";
import { type DiscoveryLog, type DiscoveryRpc } from "./rpc.js";

export const LAUNCH_POLL_MS = 30_000;
/** Windows scanned on the first tick (the last ~6,000 blocks, about 12 minutes on Elysium). */
export const BACKFILL_WINDOWS = 3;
/** Windows per tick when behind. */
export const CATCH_UP_WINDOWS = 3;
export const ENRICH_PER_TICK = 6;
export const MAX_LAUNCHES = 300;
const MAX_SEEN = 20_000;

export const TOPICS = Object.freeze({
  v2PairCreated: toEventSelector("PairCreated(address,address,address,uint256)"),
  v3PoolCreated: toEventSelector("PoolCreated(address,address,uint24,int24,address)"),
  v4Initialize: toEventSelector("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"),
  algebraPool: toEventSelector("Pool(address,address,address)"),
});

const LAUNCH_ROLE = /factory|launchpad|launcher|launch ?(router|controller)|pool ?manager|bonding|curve/iu;
const NOT_A_LAUNCH_SOURCE = /bridge|wallet|account|treasury|drop|nft|create2|escrow|position|quote ?factory|certificate|staking|locker|vault|registry|swap ?router|token( ×\d+)?$/iu;
/** Pool factories and pool managers: only their decodable creation events count. */
const AMM_ROLE = /pool ?manager|v[234] ?factory|pool factory|algebra|solidly|uniswapv3factory|^factory$|swapfactory|(?:^|\s)v3 factory/iu;
const AMM_KINDS = new Set(["dex", "aggregator", "otc"]);
const LAUNCH_KINDS = new Set(["dex", "launchpad", "aggregator", "otc", "perps"]);
/** Token chatter, never a launch by itself. */
const IGNORED_TOPICS: ReadonlySet<string> = new Set([
  toEventSelector("Transfer(address,address,uint256)"),
  toEventSelector("Approval(address,address,uint256)"),
  toEventSelector("OwnershipTransferred(address,address)"),
]);

export interface LaunchSource {
  readonly address: string;
  readonly role: string;
  readonly protocolId: string;
  readonly protocolName: string;
  /** Pool factories and pool managers only emit decodable creation events. */
  readonly amm: boolean;
}

/** Registry contracts on `network` that create pairs, pools or launch tokens. */
export function launchSources(rows: readonly ProtocolDescriptor[], network: NetworkKey): LaunchSource[] {
  const out = new Map<string, LaunchSource>();
  for (const protocol of rows) {
    if (!LAUNCH_KINDS.has(protocol.kind) || protocol.status === "deprecated") continue;
    const deployment = protocol.deployments.find((entry) => entry.network === network);
    for (const contract of deployment?.contractInfo ?? []) {
      if (contract.deprecated || !LAUNCH_ROLE.test(contract.role) || NOT_A_LAUNCH_SOURCE.test(contract.role)) continue;
      const address = contract.address.toLowerCase();
      if (out.has(address)) continue;
      out.set(address, { address, role: contract.role, protocolId: protocol.id, protocolName: protocol.name, amm: AMM_ROLE.test(contract.role) || (AMM_KINDS.has(protocol.kind) && /factory|manager/iu.test(contract.role)) });
    }
  }
  return [...out.values()];
}

const ZERO = /^0x0{40}$/u;

function topicAddress(topic: Hex | undefined): string | null {
  if (!topic || !/^0x0{24}[0-9a-f]{40}$/iu.test(topic)) return null;
  const address = `0x${topic.slice(26).toLowerCase()}`;
  return ZERO.test(address) ? null : address;
}

function wordAddress(data: Hex, index: number): string | null {
  const word = data.slice(2 + index * 64, 2 + (index + 1) * 64);
  if (word.length !== 64 || !/^0{24}/u.test(word)) return null;
  const address = `0x${word.slice(24).toLowerCase()}`;
  return ZERO.test(address) ? null : address;
}

export interface DecodedLaunch {
  readonly kind: LaunchKind;
  readonly pool: string | null;
  /** Token addresses the event names. */
  readonly tokens: readonly string[];
  /** Candidates still to prove they are tokens (launchpad events). */
  readonly unproven: boolean;
}

/** Decodes a factory / launchpad log; null when it names nothing launch-like. */
export function decodeLaunch(log: DiscoveryLog, source: LaunchSource): DecodedLaunch | null {
  const topic = log.topics[0];
  const indexed = [log.topics[1], log.topics[2], log.topics[3]].map(topicAddress).filter((address): address is string => address !== null);
  switch (topic) {
    case TOPICS.v2PairCreated:
      return { kind: "v2-pair", pool: wordAddress(log.data, 0), tokens: indexed.slice(0, 2), unproven: false };
    case TOPICS.v3PoolCreated:
      return { kind: "v3-pool", pool: wordAddress(log.data, 1), tokens: indexed.slice(0, 2), unproven: false };
    case TOPICS.algebraPool:
      return { kind: "v3-pool", pool: wordAddress(log.data, 0), tokens: indexed.slice(0, 2), unproven: false };
    case TOPICS.v4Initialize: {
      // currency0 / currency1 are indexed; native HYPE is the zero address (dropped).
      const id = log.topics[1] ?? null;
      return { kind: "v4-pool", pool: id, tokens: [topicAddress(log.topics[2]), topicAddress(log.topics[3])].filter((address): address is string => address !== null), unproven: false };
    }
    default: {
      if (source.amm || (topic !== undefined && IGNORED_TOPICS.has(topic))) return null;
      const candidates = indexed.filter((address) => address !== source.address);
      return candidates.length > 0 ? { kind: "launchpad-event", pool: null, tokens: candidates, unproven: true } : null;
    }
  }
}

export interface LaunchRadarOptions {
  readonly network: NetworkKey;
  readonly rpc: DiscoveryRpc;
  readonly clock: Clock;
  readonly log: Logger;
  readonly rows: () => readonly ProtocolDescriptor[];
  readonly pollMs?: number;
}

type Listener = (launch: LaunchView) => void;

export class LaunchRadar {
  private readonly launches: LaunchView[] = [];
  private readonly seenEvents = new Set<string>();
  private readonly seenTokens = new Set<string>();
  private readonly notTokens = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private readonly metadata = new Map<string, Pick<LaunchTokenView, "symbol" | "name" | "decimals">>();
  private readonly sources: LaunchSource[];
  private readonly byAddress: Map<string, LaunchSource>;
  private scanned: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: LaunchRadarOptions) {
    this.sources = launchSources(options.rows(), options.network);
    this.byAddress = new Map(this.sources.map((source) => [source.address, source]));
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Starts polling (idempotent). The first tick runs at once. */
  start(): void {
    if (this.timer || this.sources.length === 0 || !this.options.rpc.available(this.options.network)) return;
    this.timer = setInterval(() => void this.tick(), this.options.pollMs ?? LAUNCH_POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One scan step (also called by tests); concurrent calls share the running one. */
  tick(): Promise<void> {
    this.ticking ??= this.scan()
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.options.log.warn("launch radar scan failed", { network: this.options.network, error: this.lastError });
      })
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  private async scan(): Promise<void> {
    const { rpc, network } = this.options;
    const head = await rpc.head(network);
    const size = logWindow(network);
    let from = this.scanned === null ? Math.max(0, head - BACKFILL_WINDOWS * size + 1) : this.scanned + 1;
    // Far behind (a long outage): skip ahead rather than hammer the RPC.
    if (head - from > (CATCH_UP_WINDOWS + BACKFILL_WINDOWS) * size) from = head - BACKFILL_WINDOWS * size + 1;
    const fresh: { log: DiscoveryLog; source: LaunchSource; decoded: DecodedLaunch }[] = [];
    for (let window = 0; window < Math.max(BACKFILL_WINDOWS, CATCH_UP_WINDOWS) && from <= head; window += 1) {
      const to = Math.min(head, from + size - 1);
      const logs = await rpc.logs(network, { addresses: this.sources.map((source) => source.address), fromBlock: from, toBlock: to });
      for (const log of logs) {
        const source = this.byAddress.get(log.address);
        if (!source) continue;
        const id = `${network}:${log.transactionHash}:${log.logIndex}`;
        if (this.seenEvents.has(id)) continue;
        this.remember(this.seenEvents, id);
        const decoded = decodeLaunch(log, source);
        if (decoded) fresh.push({ log, source, decoded });
      }
      this.scanned = to;
      from = to + 1;
    }
    this.lastError = null;
    fresh.sort((a, b) => a.log.blockNumber - b.log.blockNumber || a.log.logIndex - b.log.logIndex);
    let budget = ENRICH_PER_TICK;
    for (const { log, source, decoded } of fresh) {
      let tokens = decoded.tokens.filter((address) => !this.notTokens.has(address));
      if (decoded.unproven) {
        // Only tokens the radar has not reported yet, proven by bytecode + ERC-20 metadata, within the budget.
        tokens = tokens.filter((address) => !this.seenTokens.has(address) && !this.byAddress.has(address));
        if (tokens.length === 0 || budget <= 0) continue;
        const proven: string[] = [];
        const sizes = await rpc.codeSizes(network, tokens);
        for (const [index, address] of tokens.entries()) {
          if ((sizes[index] ?? 0) === 0 || budget <= 0) {
            if ((sizes[index] ?? null) === 0) this.remember(this.notTokens, address);
            continue;
          }
          budget -= 1;
          const meta = await this.meta(address);
          if (meta.symbol !== null && meta.decimals !== null) proven.push(address);
          else this.remember(this.notTokens, address);
        }
        if (proven.length === 0) continue;
        tokens = proven;
      }
      const views: LaunchTokenView[] = [];
      for (const address of tokens) {
        const known = this.isQuote(address);
        const meta = known || budget <= 0 ? this.metadata.get(address) ?? this.registryMeta(address) : ((budget -= 1), await this.meta(address));
        views.push({ address, ...meta, verified: known, flagged: flaggedToken(network, address) });
      }
      views.sort((a, b) => Number(a.verified) - Number(b.verified));
      for (const view of views) if (!view.verified) this.remember(this.seenTokens, view.address);
      const launch: LaunchView = {
        id: `${network}:${log.transactionHash}:${log.logIndex}`,
        network,
        kind: decoded.kind,
        protocolId: source.protocolId,
        protocolName: source.protocolName,
        source: { address: source.address, role: source.role },
        pool: decoded.pool,
        tokens: views,
        topic: log.topics[0] ?? "0x",
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        seenAt: new Date(this.options.clock.now()).toISOString(),
      };
      this.launches.push(launch);
      if (this.launches.length > MAX_LAUNCHES) this.launches.splice(0, this.launches.length - MAX_LAUNCHES);
      for (const listener of this.listeners) {
        try {
          listener(launch);
        } catch {
          // A broken subscriber must not stop the radar.
        }
      }
    }
  }

  private remember(set: Set<string>, value: string): void {
    if (set.size >= MAX_SEEN) set.delete(set.values().next().value as string);
    set.add(value);
  }

  private isQuote(address: string): boolean {
    return getToken(erc20AssetId(this.options.network, address)) !== null;
  }

  private registryMeta(address: string): Pick<LaunchTokenView, "symbol" | "name" | "decimals"> {
    const token = getToken(erc20AssetId(this.options.network, address));
    return token ? { symbol: token.symbol, name: token.name, decimals: token.decimals } : { symbol: null, name: null, decimals: null };
  }

  private async meta(address: string): Promise<Pick<LaunchTokenView, "symbol" | "name" | "decimals">> {
    const cached = this.metadata.get(address);
    if (cached) return cached;
    try {
      const read = await this.options.rpc.tokenMetadata(this.options.network, address);
      const value = { symbol: read.symbol, name: read.name, decimals: read.decimals };
      if (this.metadata.size >= MAX_SEEN) this.metadata.delete(this.metadata.keys().next().value as string);
      this.metadata.set(address, value);
      return value;
    } catch {
      return { symbol: null, name: null, decimals: null };
    }
  }

  /** Newest first, filtered. */
  list(filter: { readonly protocol?: string; readonly kind?: LaunchKind; readonly limit?: number } = {}): LaunchView[] {
    return this.launches
      .filter((launch) => (!filter.protocol || launch.protocolId === filter.protocol) && (!filter.kind || launch.kind === filter.kind))
      .slice(-(filter.limit ?? 50))
      .reverse();
  }

  status(): Omit<LaunchesResponse, "launches"> {
    const notes = [
      "launchpad-event: the first time the radar saw this token in an event of a registry launchpad; it may have launched earlier.",
      "Launch tokens are unverified. Run Shield (GET /v1/discovery/shield/:token) before trading one.",
      ...(NETWORKS[this.options.network].environment === "testnet" ? ["Testnet pool prices are fake: Elyia values tokens at HyperCore mainnet reference prices only."] : []),
      ...(this.sources.length === 0 ? [`No registry factory or launchpad on ${NETWORKS[this.options.network].name}.`] : []),
      ...(!this.options.rpc.available(this.options.network) ? [`${NETWORKS[this.options.network].name} has no RPC endpoint configured on this server.`] : []),
      ...(this.lastError ? [`Last scan failed: ${this.lastError.slice(0, 160)}`] : []),
    ];
    return { network: this.options.network, scannedThrough: this.scanned, sources: this.sources.length, windowBlocks: logWindow(this.options.network), running: this.running, notes };
  }

  /** Launches in the buffer (at most MAX_LAUNCHES). */
  count(): number {
    return this.launches.length;
  }
}
