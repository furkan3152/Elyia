/**
 * The HyperCore info reads the engine needs, behind one port (tests use a
 * fake). The production port delegates to the shared, cached and
 * weight-budgeted info client (ctx.hyperliquid), so the engine never spends
 * Hyperliquid weight outside that budget.
 */
import type { NetworkKey } from "@elyia/core";
import type { HyperliquidClients } from "../../hyperliquid/index.js";
import type {
  ActiveAssetData,
  AllMids,
  ClearinghouseState,
  Cloid,
  ExtraAgent,
  FrontendOpenOrder,
  LedgerUpdate,
  OrderStatusResponse,
  PerpMeta,
  SpotClearinghouseState,
  SpotMeta,
  UserFill,
} from "../../hyperliquid/types.js";

export interface HyperCorePort {
  meta(network: NetworkKey): Promise<PerpMeta>;
  spotMeta(network: NetworkKey): Promise<SpotMeta>;
  allMids(network: NetworkKey): Promise<AllMids>;
  orderStatus(network: NetworkKey, user: string, oid: number | Cloid): Promise<OrderStatusResponse>;
  userFillsByTime(network: NetworkKey, user: string, startTime: number, endTime?: number): Promise<readonly UserFill[]>;
  ledger(network: NetworkKey, user: string, startTime: number, endTime?: number): Promise<readonly LedgerUpdate[]>;
  extraAgents(network: NetworkKey, user: string): Promise<readonly ExtraAgent[]>;
  clearinghouseState(network: NetworkKey, user: string): Promise<ClearinghouseState>;
  spotClearinghouseState(network: NetworkKey, user: string): Promise<SpotClearinghouseState>;
  frontendOpenOrders(network: NetworkKey, user: string): Promise<readonly FrontendOpenOrder[]>;
  activeAssetData(network: NetworkKey, user: string, coin: string): Promise<ActiveAssetData>;
}

/** Status reads that must be fresh skip the shared cache (they are light: weight 2). */
const FRESH = { cacheMs: 0 } as const;

export class InfoHyperCorePort implements HyperCorePort {
  constructor(private readonly clients: HyperliquidClients) {}

  meta(network: NetworkKey): Promise<PerpMeta> {
    return this.clients.info(network).meta();
  }

  spotMeta(network: NetworkKey): Promise<SpotMeta> {
    return this.clients.info(network).spotMeta();
  }

  allMids(network: NetworkKey): Promise<AllMids> {
    return this.clients.info(network).allMids();
  }

  orderStatus(network: NetworkKey, user: string, oid: number | Cloid): Promise<OrderStatusResponse> {
    return this.clients.info(network).request({ type: "orderStatus", user, oid }, FRESH);
  }

  userFillsByTime(network: NetworkKey, user: string, startTime: number, endTime?: number): Promise<readonly UserFill[]> {
    return this.clients.info(network).userFillsByTime(user, startTime, endTime);
  }

  ledger(network: NetworkKey, user: string, startTime: number, endTime?: number): Promise<readonly LedgerUpdate[]> {
    return this.clients.info(network).userNonFundingLedgerUpdates(user, startTime, endTime);
  }

  extraAgents(network: NetworkKey, user: string): Promise<readonly ExtraAgent[]> {
    return this.clients.info(network).extraAgents(user);
  }

  clearinghouseState(network: NetworkKey, user: string): Promise<ClearinghouseState> {
    return this.clients.info(network).clearinghouseState(user);
  }

  spotClearinghouseState(network: NetworkKey, user: string): Promise<SpotClearinghouseState> {
    return this.clients.info(network).spotClearinghouseState(user);
  }

  frontendOpenOrders(network: NetworkKey, user: string): Promise<readonly FrontendOpenOrder[]> {
    return this.clients.info(network).frontendOpenOrders(user);
  }

  activeAssetData(network: NetworkKey, user: string, coin: string): Promise<ActiveAssetData> {
    return this.clients.info(network).activeAssetData(user, coin);
  }
}
