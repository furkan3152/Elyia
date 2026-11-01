/**
 * GET /v1/health: version, mode, uptime and dependency checks (each RPC
 * endpoint and Hyperliquid info of the configured mode, plus the store),
 * cached 15 s by the DependencyMonitor. 200 while anything works; 503 only
 * when every dependency of the mode is down.
 */
import type { NetworkKey } from "@elyia/core";
import type { Router } from "express";
import type { AppContext } from "../../context.js";
import type { DependencyMonitor, NetworkProbe } from "../../health/dependencies.js";
import { liveRegistry } from "../discovery/registry.js";

export type HealthStatus = "ok" | "degraded" | "down";

export function healthStatus(networks: readonly NetworkProbe[], storeOk: boolean): HealthStatus {
  const reachable = networks.filter((network) => network.reachable).length;
  if (networks.length > 0 && reachable === 0) return "down";
  if (!storeOk || reachable < networks.length) return "degraded";
  return "ok";
}

export function registerHealth(router: Router, ctx: AppContext, monitor: DependencyMonitor): void {
  const startedAt = ctx.clock.now();
  router.get("/health", async (_req, res) => {
    const report = await monitor.report();
    const modeKeys = (Object.keys(ctx.config.networks) as NetworkKey[]).filter((key) => ctx.config.networks[key].environment === ctx.config.mode);
    const networks = modeKeys.map((key) => report.networks[key]).filter((probe): probe is NetworkProbe => probe !== undefined);
    const status = healthStatus(networks, report.store.ok);
    const now = ctx.clock.now();
    res.status(status === "down" ? 503 : 200).json({
      status,
      service: "elyia-api",
      version: ctx.config.version,
      mode: ctx.config.mode,
      build: ctx.config.build,
      time: new Date(now).toISOString(),
      uptimeSeconds: Math.floor((now - startedAt) / 1000),
      checkedAt: new Date(report.checkedAt).toISOString(),
      dependencies: { store: report.store, networks },
      pulse: ctx.pulse.status(),
      // What the running engine executes (adapters -> withExecutable), not what the registry hoped for.
      registry: { protocols: liveRegistry(ctx).rows.length, executable: liveRegistry(ctx).executableIds.length, executableIds: liveRegistry(ctx).executableIds },
      hyperliquidWs: ctx.hyperliquid.wsStatus(),
      features: {
        database: ctx.store.kind,
        sessions: ctx.config.sessionSecret ? "enabled" : "needs_configuration",
        telegram: ctx.config.telegram.botToken ? "enabled" : "needs_configuration",
        agent: ctx.config.agent.anthropicApiKey ? "ai" : "deterministic",
      },
    });
  });
}
