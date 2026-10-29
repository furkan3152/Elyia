/**
 * GET /v1/networks: the core network registry with live status from the
 * dependency monitor. Endpoints are the registry's public ones; operator RPC
 * overrides (which may carry API keys) are only reported as `rpcConfigured`.
 */
import { NETWORK_KEYS, NETWORKS } from "@elyia/core";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import type { DependencyMonitor } from "../../health/dependencies.js";
import { cachePublicly } from "../../http/request.js";
import { parseQuery } from "../../http/validate.js";
import { environment } from "./query.js";

const NetworksQuery = z.object({ environment: environment.optional() });

export function registerNetworks(router: Router, ctx: AppContext, monitor: DependencyMonitor): void {
  router.get("/networks", async (req, res) => {
    const query = parseQuery(req, NetworksQuery);
    const report = await monitor.report();
    const networks = NETWORK_KEYS.filter((key) => !query.environment || NETWORKS[key].environment === query.environment).map((key) => {
      const registry = NETWORKS[key];
      const configured = ctx.config.networks[key];
      const probe = report.networks[key];
      return {
        ...registry,
        enabled: registry.environment === ctx.config.mode,
        rpcConfigured: configured.vm === "evm" ? configured.rpcUrls.length > 0 : true,
        live: probe
          ? {
              reachable: probe.reachable,
              head: probe.head,
              latencyMs: probe.latencyMs,
              checkedAt: new Date(report.checkedAt).toISOString(),
              ...(probe.note ? { note: probe.note } : {}),
            }
          : null,
      };
    });
    cachePublicly(res, 5);
    res.json({ mode: ctx.config.mode, networks });
  });
}
