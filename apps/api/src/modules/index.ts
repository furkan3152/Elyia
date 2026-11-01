/**
 * Every API module, in mount order. A feature module lives in
 * `src/modules/<name>/index.ts`, exports an ApiModule and is added here:
 *
 *   export const marketsModule: ApiModule = {
 *     name: "markets",
 *     register(router, ctx) {
 *       router.get("/markets", ctx.limits.heavy, async (req, res) => { ... });
 *     },
 *   };
 */
import type { ApiModule } from "../http/router.js";
import { systemModule } from "./system/index.js";
import { marketsModule } from "./markets/index.js";
import { portfolioModule } from "./portfolio/index.js";
import { intentsModule } from "./intents/index.js";
import { opsModule } from "./ops/index.js";
import { agentModule } from "./agent/index.js";
import { discoveryModule } from "./discovery/index.js";
import { developersModule } from "./developers/index.js";
import { adminModule } from "./admin/index.js";
import { herdModule } from "./herd/index.js";

export const MODULES: readonly ApiModule[] = [
  // First: its API key gate (auth, scopes, quotas, metering) runs before every other module's routes.
  developersModule,
  systemModule,
  marketsModule,
  portfolioModule,
  intentsModule,
  opsModule,
  agentModule,
  discoveryModule,
  adminModule,
  herdModule,
];
