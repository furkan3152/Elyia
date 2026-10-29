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

export const MODULES: readonly ApiModule[] = [systemModule];
