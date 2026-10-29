/**
 * System module: health, network registry with live status, protocol and
 * token registries, and the Elysium pulse (JSON + SSE block stream).
 */
import type { ApiModule } from "../../http/router.js";
import { DependencyMonitor } from "../../health/dependencies.js";
import { registerElysium } from "./elysium.js";
import { registerHealth } from "./health.js";
import { registerNetworks } from "./networks.js";
import { registerRegistry } from "./registry.js";

export const systemModule: ApiModule = {
  name: "system",
  register(router, ctx) {
    const monitor = new DependencyMonitor({
      networks: ctx.config.networks,
      hyperliquid: ctx.hyperliquid,
      store: ctx.store,
      clock: ctx.clock,
      fetch: ctx.fetch,
    });
    registerHealth(router, ctx, monitor);
    registerNetworks(router, ctx, monitor);
    registerRegistry(router, ctx);
    registerElysium(router, ctx);
  },
};
