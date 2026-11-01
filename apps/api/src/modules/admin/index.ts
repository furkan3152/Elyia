/**
 * Admin and public contract config.
 *
 *   GET  /config/contracts?network=      (public)  ContractsConfigResponse
 *   GET  /config/flags                   (public)  FeatureFlagsResponse
 *   GET  /admin/deployments?network=     (admin)   { deployments }
 *   POST /admin/deployments              (admin)   RecordDeploymentResponse (verified receipt + code)
 *   GET  /admin/deploy-plan?network=     (admin)   DeployPlanResponse (unsigned creation txs for the owner's wallet)
 *   GET  /admin/router?network=          (admin)   RouterSettingsResponse (fees, pause state, live reads)
 *   GET  /admin/flags  PUT /admin/flags  (admin)   FeatureFlagsResponse
 *   GET  /admin/system                   (admin)   SystemDashboardResponse
 *
 * Admin = a wallet session whose address is in ELYIA_ADMIN_ADDRESSES. The
 * server never deploys or signs: the owner's wallet does, and the server
 * verifies what landed.
 */
import { NETWORK_KEYS, NETWORKS, type NetworkKey } from "@elyia/core";
import { DEFAULT_FEATURE_FLAGS, ELYIA_CONTRACT_NAMES, FEATURE_FLAGS, type ContractsConfigResponse, type FeatureFlag, type FeatureFlags, type FeatureFlagsResponse, type SystemDashboardResponse } from "@elyia/core/api/admin";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor } from "../../config.js";
import type { ApiModule } from "../../http/router.js";
import { parseBody, parseQuery, txHash, evmAddress } from "../../http/validate.js";
import { mustSession, requireSession } from "../ops/auth/session.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { usageOf, utcDay } from "../developers/gate.js";
import { listKeys } from "../developers/keys.js";
import { contractArtifacts } from "./artifacts.js";
import { deployPlan, listDeployments, loadRegistry, recordDeployment, routerSettings } from "./deployments.js";
import { readStats } from "./stats.js";

const networkSchema = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]);
const evmNetwork = networkSchema.refine((key) => NETWORKS[key].vm === "evm", "Expected an EVM network.");
const NetworkQuery = z.object({ network: evmNetwork.optional() });
const DeploymentBody = z.object({ network: evmNetwork, contract: z.enum(ELYIA_CONTRACT_NAMES as unknown as [string, ...string[]]), txHash, address: evmAddress.optional() }).strict();
const FlagsBody = z.object(Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, z.boolean().optional()])) as Record<FeatureFlag, z.ZodOptional<z.ZodBoolean>>).strict();

interface FlagsDoc {
  readonly flags: FeatureFlags;
  readonly updatedAt: number | null;
  readonly updatedBy: string | null;
}

export async function featureFlags(ctx: AppContext): Promise<FlagsDoc> {
  const doc = (await docs<FlagsDoc>(ctx, PLATFORM_COLLECTIONS.featureFlags).get("global"))?.value;
  return { flags: { ...DEFAULT_FEATURE_FLAGS, ...(doc?.flags ?? {}) }, updatedAt: doc?.updatedAt ?? null, updatedBy: doc?.updatedBy ?? null };
}

/** One flag (cheap enough per request: one store read). */
export async function flagOn(ctx: AppContext, flag: FeatureFlag): Promise<boolean> {
  return (await featureFlags(ctx)).flags[flag];
}

function flagsView(doc: FlagsDoc): FeatureFlagsResponse {
  return { flags: doc.flags, updatedAt: iso(doc.updatedAt), updatedBy: doc.updatedBy };
}

const startedAt = new WeakMap<AppContext, number>();

export const adminModule: ApiModule = {
  name: "admin",
  register(router, ctx) {
    startedAt.set(ctx, ctx.clock.now());

    router.get("/config/contracts", async (req, res) => {
      const { network } = parseQuery(req, NetworkQuery);
      const records = await listDeployments(ctx, network);
      const keys = network ? [network] : (Object.keys(ctx.config.networks) as NetworkKey[]).filter((key) => NETWORKS[key].vm === "evm" && NETWORKS[key].environment === ctx.config.mode);
      const artifacts = await contractArtifacts();
      const body: ContractsConfigResponse = {
        networks: keys.map((key) => ({
          network: key,
          contracts: Object.fromEntries(records.filter((record) => record.network === key).map((record) => [record.contract, { address: record.address, artifactVersion: record.artifactVersion, recordedAt: record.recordedAt }])),
        })),
        artifacts: artifacts.size > 0 ? [...artifacts.values()].map((artifact) => ({ contractName: artifact.contractName, version: artifact.version })) : null,
      };
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(body);
    });

    router.get("/config/flags", async (_req, res) => {
      res.json(flagsView(await featureFlags(ctx)));
    });

    router.get("/admin/deployments", requireSession(ctx, "admin"), async (req, res) => {
      const { network } = parseQuery(req, NetworkQuery);
      res.json({ deployments: await listDeployments(ctx, network) });
    });

    router.post("/admin/deployments", ctx.limits.auth, requireSession(ctx, "admin"), async (req, res) => {
      const body = parseBody(req, DeploymentBody);
      const deployment = await recordDeployment(ctx, { network: body.network, contract: body.contract as never, txHash: body.txHash, ...(body.address ? { address: body.address } : {}), recordedBy: mustSession(req).address });
      res.status(201).json({ deployment });
    });

    router.get("/admin/deploy-plan", requireSession(ctx, "admin"), async (req, res) => {
      const network = parseQuery(req, NetworkQuery).network ?? elysiumNetworkFor(ctx.config.mode);
      res.json(await deployPlan(ctx, network, mustSession(req).address));
    });

    router.get("/admin/router", requireSession(ctx, "admin"), async (req, res) => {
      const network = parseQuery(req, NetworkQuery).network ?? elysiumNetworkFor(ctx.config.mode);
      res.json(await routerSettings(ctx, network));
    });

    router.get("/admin/flags", requireSession(ctx, "admin"), async (_req, res) => {
      res.json(flagsView(await featureFlags(ctx)));
    });

    router.put("/admin/flags", requireSession(ctx, "admin"), async (req, res) => {
      const body = parseBody(req, FlagsBody);
      const current = await featureFlags(ctx);
      const next: FlagsDoc = { flags: { ...current.flags, ...Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) } as FeatureFlags, updatedAt: ctx.clock.now(), updatedBy: mustSession(req).address };
      await docs<FlagsDoc>(ctx, PLATFORM_COLLECTIONS.featureFlags).put("global", next);
      res.json(flagsView(next));
    });

    router.get("/admin/system", requireSession(ctx, "admin"), async (_req, res) => {
      const now = ctx.clock.now();
      const day = utcDay(now);
      let storeOk = "ok";
      await ctx.store.ping().catch(() => {
        storeOk = "down";
      });
      const developers = (await docs<{ id?: string }>(ctx, PLATFORM_COLLECTIONS.developers).list({ limit: 1_000 })).filter((doc) => !doc.id.startsWith("id:"));
      let requests = 0;
      let plans = 0;
      let prepares = 0;
      let keyCount = 0;
      for (const developer of developers) {
        const id = (developer.value as { id?: string }).id;
        if (!id) continue;
        for (const key of await listKeys(ctx, id)) {
          keyCount += key.revokedAt === null ? 1 : 0;
          const usage = await usageOf(ctx, key.id, day);
          requests += usage.requests;
          plans += usage.plans;
          prepares += usage.prepares;
        }
      }
      const stats = await readStats(ctx);
      const keepers = stats.keeper?.pending ?? 0;
      const body: SystemDashboardResponse = {
        generatedAt: new Date(now).toISOString(),
        health: { status: storeOk === "ok" ? "ok" : "degraded", store: `${ctx.store.kind}:${storeOk}`, uptimeSeconds: Math.floor((now - (startedAt.get(ctx) ?? now)) / 1000) },
        usage: { day, requests, plans, prepares, developers: developers.length, keys: keyCount },
        queues: Object.fromEntries(Object.entries(stats).map(([name, stat]) => [name, { pending: stat.pending, ...(stat.note ? { note: stat.note } : {}) }])),
        workers: Object.fromEntries(Object.entries(stats).map(([name, stat]) => [name, { running: stat.running, lastRunAt: iso(stat.lastRunAt), lastError: stat.lastError }])),
        agent: { mode: ctx.config.agent.anthropicApiKey && ctx.config.agent.model ? "ai" : "deterministic", model: ctx.config.agent.model, keepersActive: keepers },
      };
      res.json(body);
    });
  },
  async start(ctx) {
    await loadRegistry(ctx);
  },
};
