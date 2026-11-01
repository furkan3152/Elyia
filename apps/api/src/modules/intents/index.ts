/**
 * Intents: the language reader (sentence to goals and questions) and the engine (plan, prepare, submit, verify, journey).
 *
 *   POST /intents                              plan (+ store unless dryRun)       CreateIntentResponse
 *   GET  /intents/:id                          the graph (status re-derived)      IntentGraph
 *   GET  /intents/:id/journey                  "where is my money"                Journey
 *   POST /intents/:id/steps/:sid/prepare       unsigned requests + quote binding  PrepareStepResponse
 *   POST /intents/:id/steps/:sid/submit        references only, verified          SubmitStepResponse
 *   POST /intents/:id/stop                     stop every unstarted step          StopIntentResponse
 *   GET  /intents/:id/stream                   SSE of IntentStreamEvent (Last-Event-ID resumes)
 *   GET  /venues                               every venue: network, kind, status   VenuesResponse
 *
 * Contract types: @elyia/core/api/intents. The server never signs.
 */
import type { AccountId } from "@elyia/core";
import type { VenuesResponse } from "@elyia/core/api/intents";
import type { AppContext } from "../../context.js";
import { engineFor } from "../../engine/index.js";
import { goalsToActions } from "../../engine/planner/goals.js";
import type { ApiModule } from "../../http/router.js";
import { openSse } from "../../http/sse.js";
import { parseBody, parseParams, parseQuery } from "../../http/validate.js";
import { venueCatalog } from "../../engine/catalog.js";
import { PRICE_SOURCE } from "../../engine/prices.js";
import { cachePublicly } from "../../http/request.js";
import { createBodySchema, createQuerySchema, intentParamsSchema, prepareBodySchema, stepParamsSchema, submitBodySchema, venuesQuerySchema } from "./schemas.js";
import { registerLanguageRoutes } from "./language.js";
import { actionsFromText } from "./text.js";
import { liveRegistry } from "../discovery/registry.js";

/** Background poll of in-flight intents (settlements, resting orders, late receipts). */
export const POLL_INTERVAL_MS = 15_000;

interface PollerState {
  timer: NodeJS.Timeout | null;
  running: boolean;
}

const pollers = new WeakMap<AppContext, PollerState>();

export const intentsModule: ApiModule = {
  name: "intents",
  register(router, ctx) {
    const engine = () => engineFor(ctx);
    registerLanguageRoutes(router, ctx);

    router.post("/intents", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createBodySchema);
      const query = parseQuery(req, createQuerySchema);
      const environment = body.mode ?? ctx.config.mode;
      const accounts = body.accounts as AccountId[];
      const now = ctx.clock.now();
      const actions = body.actions
        ? body.actions
        : body.goals
          ? goalsToActions(body.goals, environment)
          : (await actionsFromText(body.text as string, { environment, accounts, now, ctx, ...(body.thread ? { thread: body.thread } : {}) })).actions;
      const dryRun = body.dryRun === true || query.dryRun === "true" || query.dryRun === "1";
      const response = await engine().service.create({
        actions,
        accounts,
        environment,
        ...(body.constraints ? { constraints: body.constraints } : {}),
        signer: body.signer ?? "agent",
        ...(body.agent ? { agent: body.agent } : {}),
        dryRun,
        ...(body.text ? { text: body.text } : {}),
        source: body.text ? "text" : "structured",
        ...(body.metadata ? { metadata: body.metadata } : {}),
        ...(body.clientReference ? { clientReference: body.clientReference } : {}),
      });
      res.status(dryRun || response.replayed ? 200 : 201).json(response);
    });

    router.get("/venues", (req, res) => {
      const query = parseQuery(req, venuesQuerySchema);
      const executable = liveRegistry(ctx).executableIds;
      const venues = venueCatalog(ctx.config.networks, new Set(executable)).filter(
        (venue) =>
          (!query.network || venue.network === query.network) &&
          (!query.environment || venue.environment === query.environment) &&
          (!query.kind || venue.kind === query.kind) &&
          (!query.status || venue.status === query.status),
      );
      cachePublicly(res, 60);
      const body: VenuesResponse = { venues, priceSource: PRICE_SOURCE, executableProtocols: executable };
      res.json(body);
    });

    router.get("/intents/:id", async (req, res) => {
      const { id } = parseParams(req, intentParamsSchema);
      res.json(await engine().service.get(id));
    });

    router.get("/intents/:id/journey", async (req, res) => {
      const { id } = parseParams(req, intentParamsSchema);
      res.json(await engine().service.journey(id));
    });

    router.post("/intents/:id/steps/:sid/prepare", ctx.limits.heavy, async (req, res) => {
      const { id, sid } = parseParams(req, stepParamsSchema);
      const body = parseBody(req, prepareBodySchema);
      res.json(await engine().service.prepare(id, sid, body));
    });

    router.post("/intents/:id/steps/:sid/submit", ctx.limits.heavy, async (req, res) => {
      const { id, sid } = parseParams(req, stepParamsSchema);
      const body = parseBody(req, submitBodySchema);
      res.json(await engine().service.submit(id, sid, body.references));
    });

    router.post("/intents/:id/stop", async (req, res) => {
      const { id } = parseParams(req, intentParamsSchema);
      res.json(await engine().service.stop(id));
    });

    router.get("/intents/:id/stream", async (req, res) => {
      const { id } = parseParams(req, intentParamsSchema);
      const { service, events } = engine();
      const graph = await service.get(id);
      const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
      if (stream.closed) return;
      const unsubscribe = events.subscribe(id, (event) => {
        stream.send(event.type, event.data, event.id);
      });
      stream.onClose(unsubscribe);
      const missed = stream.lastEventId ? events.since(id, stream.lastEventId) : null;
      if (missed === null) stream.send("intent.snapshot", graph, events.lastId(id));
      else for (const event of missed) stream.send(event.type, event.data, event.id);
    });
  },
  start(ctx) {
    if (pollers.has(ctx)) return;
    const state: PollerState = { timer: null, running: false };
    state.timer = setInterval(() => {
      if (state.running) return;
      state.running = true;
      engineFor(ctx)
        .service.pollActive()
        .catch((error: unknown) => ctx.log.warn("intent poller pass failed", { error }))
        .finally(() => {
          state.running = false;
        });
    }, POLL_INTERVAL_MS);
    state.timer.unref();
    pollers.set(ctx, state);
  },
  stop(ctx) {
    const state = pollers.get(ctx);
    if (state?.timer) clearInterval(state.timer);
    pollers.delete(ctx);
  },
};
