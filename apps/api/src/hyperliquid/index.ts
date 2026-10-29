/**
 * Hyperliquid clients per HyperCore network, created lazily: one Info client
 * (with its own weight budget: testnet and mainnet are separate API hosts)
 * and one shared WebSocket.
 */
import type { HyperCoreNetwork, Network, NetworkKey } from "@elyia/core";
import type { Clock } from "../clock.js";
import { ElyiaHttpError } from "../http/errors.js";
import type { Logger } from "../log.js";
import { HyperliquidInfoClient, type FetchLike } from "./info.js";
import { WeightBudget } from "./weights.js";
import { HyperliquidWs, type SocketFactory } from "./ws.js";

export { HyperliquidInfoClient } from "./info.js";
export { HyperliquidWs } from "./ws.js";
export { WeightBudget } from "./weights.js";

export interface HyperliquidClientsOptions {
  readonly networks: Readonly<Record<NetworkKey, Network>>;
  readonly weightPerMinute: number;
  readonly clock: Clock;
  readonly log: Logger;
  readonly fetch?: FetchLike;
  readonly createSocket?: SocketFactory;
}

export class HyperliquidClients {
  private readonly infos = new Map<NetworkKey, HyperliquidInfoClient>();
  private readonly sockets = new Map<NetworkKey, HyperliquidWs>();

  constructor(private readonly options: HyperliquidClientsOptions) {}

  network(key: NetworkKey): HyperCoreNetwork {
    const network = this.options.networks[key];
    if (!network || network.vm !== "hypercore") {
      throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${key} is not a HyperCore network.`, { network: key });
    }
    return network;
  }

  /** Every HyperCore network key in the registry. */
  keys(): NetworkKey[] {
    return (Object.values(this.options.networks) as Network[]).filter((network) => network.vm === "hypercore").map((network) => network.key);
  }

  info(key: NetworkKey): HyperliquidInfoClient {
    let client = this.infos.get(key);
    if (!client) {
      const network = this.network(key);
      client = new HyperliquidInfoClient({
        network,
        budget: new WeightBudget(this.options.weightPerMinute, this.options.clock),
        clock: this.options.clock,
        log: this.options.log.child({ component: "hyperliquid-info", network: key }),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      this.infos.set(key, client);
    }
    return client;
  }

  ws(key: NetworkKey): HyperliquidWs {
    let socket = this.sockets.get(key);
    if (!socket) {
      const network = this.network(key);
      socket = new HyperliquidWs({
        url: network.wsUrl,
        log: this.options.log.child({ component: "hyperliquid-ws", network: key }),
        now: () => this.options.clock.now(),
        ...(this.options.createSocket ? { createSocket: this.options.createSocket } : {}),
      });
      this.sockets.set(key, socket);
    }
    return socket;
  }

  /** Status of the sockets opened so far (health). */
  wsStatus(): Partial<Record<NetworkKey, ReturnType<HyperliquidWs["status"]>>> {
    const out: Partial<Record<NetworkKey, ReturnType<HyperliquidWs["status"]>>> = {};
    for (const [key, socket] of this.sockets) out[key] = socket.status();
    return out;
  }

  close(): void {
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }
}
