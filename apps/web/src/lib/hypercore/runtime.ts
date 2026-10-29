/**
 * The app-wide HyperCore clients: one info client and one WebSocket per
 * network mode, created on first use. Feature code reaches HyperCore only
 * through these, so caching, de-duplication, pacing and subscription
 * reference counts hold for the whole tab.
 */
import type { NetworkEnvironment } from "@elyia/core/networks";

import { hyperCoreEndpoints } from "./endpoints";
import { InfoClient } from "./infoClient";
import { HyperCoreSocket } from "./wsClient";

const infoClients = new Map<NetworkEnvironment, InfoClient>();
const sockets = new Map<NetworkEnvironment, HyperCoreSocket>();

export function infoClient(mode: NetworkEnvironment): InfoClient {
  let client = infoClients.get(mode);
  if (!client) {
    client = new InfoClient({ url: hyperCoreEndpoints(mode).infoUrl });
    infoClients.set(mode, client);
  }
  return client;
}

export function hyperCoreSocket(mode: NetworkEnvironment): HyperCoreSocket {
  let socket = sockets.get(mode);
  if (!socket) {
    socket = new HyperCoreSocket({ url: hyperCoreEndpoints(mode).wsUrl });
    sockets.set(mode, socket);
  }
  return socket;
}
