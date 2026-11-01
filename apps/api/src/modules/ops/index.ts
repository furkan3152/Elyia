/**
 * Ops: wallet and Telegram sessions, transaction tracking, watchlists, alerts and the Telegram bot.
 *
 *   POST   /auth/siwe/nonce  POST /auth/siwe/verify  GET /auth/session  POST /auth/logout  POST /auth/telegram
 *   POST   /telegram/link-code   (session)          GET /telegram/status
 *   GET    /admin/telegram       (admin)            AdminTelegramStatusResponse (the flag note)
 *   POST   /track  { network, reference, label? }    TrackView
 *   GET    /track/:id                                 TrackView
 *   GET    /track/:id/stream                          SSE: track.snapshot, track.updated
 *   GET    /watch  POST /watch  DELETE /watch/:address           (session)
 *   GET    /alerts  POST /alerts  PATCH /alerts/:id  DELETE /alerts/:id  GET /alerts/feed   (session)
 *   POST   /telegram/webhook (outside /v1, production webhook mode only)
 *
 * Contract types: @elyia/core/api/ops. `requireSession(ctx, role)` (auth/session.ts) guards every module's private routes.
 */
import { ALERT_KINDS, TRACK_STREAM_EVENTS, type AlertChannel, type TelegramStatusResponse, type WatchEntry } from "@elyia/core/api/ops";
import { NETWORK_KEYS, type NetworkKey } from "@elyia/core";
import { z } from "zod";
import type { ApiModule } from "../../http/router.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { openSse } from "../../http/sse.js";
import { evmAddress, parseBody, parseParams } from "../../http/validate.js";
import { alertView, createAlert, deleteAlert, feed, listAlerts, startEvaluator, stopEvaluator, updateAlert } from "./alerts.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { mustSession, optionalSession, readSession, requireSession } from "./auth/session.js";
import { linkOfAddress } from "./auth/telegram.js";
import { docs, PLATFORM_COLLECTIONS } from "./docs.js";
import { botMode, mountTelegramWebhook, startBot, stopBot, telegramAdminStatus } from "./telegram.js";
import { flagOn } from "../admin/index.js";
import { createTrack, getTrack, startTracker, stopTracker } from "./track.js";

export { requireSession, optionalSession, mustSession } from "./auth/session.js";

const networkSchema = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]);
const TrackBody = z.object({ network: networkSchema, reference: z.string().trim().min(10).max(200), label: z.string().trim().max(60).optional() }).strict();
const TrackParams = z.object({ id: z.string().regex(/^trk_[0-9a-f]{24}$/u) });
const WatchBody = z.object({ address: evmAddress, label: z.string().trim().max(40).optional() }).strict();
const WatchParams = z.object({ address: evmAddress });
const channel = z.enum(["feed", "telegram", "webhook"]);
const decimal = z.string().regex(/^-?\d{1,15}(?:\.\d{1,12})?$/u);
const AlertBody = z
  .object({
    kind: z.enum(ALERT_KINDS as unknown as [string, ...string[]]),
    coin: z.string().trim().min(1).max(40).optional(),
    threshold: decimal.optional(),
    intentId: z.string().regex(/^int_[0-9a-f]{32}$/u).optional(),
    account: evmAddress.optional(),
    channels: z.array(channel).min(1).max(3).optional(),
    cooldownSeconds: z.number().int().min(60).max(7 * 86_400).optional(),
    note: z.string().max(200).optional(),
  })
  .strict();
const AlertPatch = z.object({ enabled: z.boolean().optional(), threshold: decimal.optional(), cooldownSeconds: z.number().int().min(60).max(7 * 86_400).optional(), channels: z.array(channel).min(1).max(3).optional(), note: z.string().max(200).optional() }).strict();
const AlertParams = z.object({ id: z.string().regex(/^alr_[0-9a-f]{20}$/u) });
const MAX_WATCH = 50;

interface WatchDoc {
  readonly entries: readonly { readonly address: string; readonly label: string | null; readonly createdAt: number }[];
}

export const opsModule: ApiModule = {
  name: "ops",
  register(router, ctx) {
    registerAuthRoutes(router, ctx);
    const session = requireSession(ctx);

    router.get("/telegram/status", optionalSession(ctx), async (req, res) => {
      const signedIn = await readSession(ctx, req);
      const mode = botMode(ctx);
      const body: TelegramStatusResponse = { configured: ctx.config.telegram.botToken !== null, mode, botUsername: ctx.config.telegram.botUsername, linked: signedIn ? (await linkOfAddress(ctx, signedIn.address)) !== null : false };
      res.json(body);
    });

    // The owner console's flag note: is the bot configured, running, linked? (No token, no chat ids.)
    router.get("/admin/telegram", requireSession(ctx, "admin"), async (_req, res) => {
      res.json(await telegramAdminStatus(ctx, await flagOn(ctx, "telegram")));
    });

    router.post("/track", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, TrackBody);
      res.status(201).json(await createTrack(ctx, { network: body.network, reference: body.reference, ...(body.label ? { label: body.label } : {}) }));
    });

    router.get("/track/:id", async (req, res) => {
      const { id } = parseParams(req, TrackParams);
      res.json(await getTrack(ctx, id));
    });

    router.get("/track/:id/stream", async (req, res) => {
      const { id } = parseParams(req, TrackParams);
      const first = await getTrack(ctx, id);
      const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
      if (stream.closed) return;
      const off = ctx.bus.on("track.updated", (track) => {
        if (track.id !== id) return;
        stream.send(TRACK_STREAM_EVENTS.updated, track);
        if (track.nextCheckAt === null) stream.close();
      });
      stream.onClose(off);
      stream.send(TRACK_STREAM_EVENTS.snapshot, first);
      if (first.nextCheckAt === null) stream.close();
    });

    const watch = () => docs<WatchDoc>(ctx, PLATFORM_COLLECTIONS.watchlists);
    const watchView = (doc: WatchDoc | undefined): { entries: WatchEntry[] } => ({ entries: (doc?.entries ?? []).map((entry) => ({ address: entry.address, label: entry.label, createdAt: new Date(entry.createdAt).toISOString() })) });

    router.get("/watch", session, async (req, res) => {
      res.json(watchView((await watch().get(mustSession(req).address))?.value));
    });

    router.post("/watch", session, async (req, res) => {
      const body = parseBody(req, WatchBody);
      const owner = mustSession(req).address;
      const current = (await watch().get(owner))?.value?.entries ?? [];
      if (current.length >= MAX_WATCH && !current.some((entry) => entry.address === body.address)) throw new ElyiaHttpError("WATCH_LIMIT", 409, `At most ${MAX_WATCH} watched addresses.`);
      const entries = [...current.filter((entry) => entry.address !== body.address), { address: body.address, label: body.label ?? null, createdAt: ctx.clock.now() }];
      await watch().put(owner, { entries });
      res.status(201).json(watchView({ entries }));
    });

    router.delete("/watch/:address", session, async (req, res) => {
      const { address } = parseParams(req, WatchParams);
      const owner = mustSession(req).address;
      const entries = ((await watch().get(owner))?.value?.entries ?? []).filter((entry) => entry.address !== address);
      await watch().put(owner, { entries });
      res.json(watchView({ entries }));
    });

    router.get("/alerts", session, async (req, res) => {
      res.json({ alerts: (await listAlerts(ctx, mustSession(req).address)).map((alert) => alertView(ctx, alert)) });
    });

    router.post("/alerts", session, async (req, res) => {
      const body = parseBody(req, AlertBody);
      res.status(201).json(alertView(ctx, await createAlert(ctx, mustSession(req).address, body as never)));
    });

    router.get("/alerts/feed", session, async (req, res) => {
      res.json({ firings: await feed(ctx, mustSession(req).address) });
    });

    router.patch("/alerts/:id", session, async (req, res) => {
      const { id } = parseParams(req, AlertParams);
      const body = parseBody(req, AlertPatch);
      res.json(alertView(ctx, await updateAlert(ctx, mustSession(req).address, id, { ...body, ...(body.channels ? { channels: body.channels as AlertChannel[] } : {}) })));
    });

    router.delete("/alerts/:id", session, async (req, res) => {
      const { id } = parseParams(req, AlertParams);
      if (!(await deleteAlert(ctx, mustSession(req).address, id))) throw new ElyiaHttpError("NOT_FOUND", 404, "No such alert.");
      res.json({ deleted: true });
    });
  },
  mountRoot(app, ctx) {
    mountTelegramWebhook(app, ctx);
  },
  async start(ctx) {
    startEvaluator(ctx);
    startTracker(ctx);
    await startBot(ctx);
  },
  async stop(ctx) {
    stopEvaluator(ctx);
    stopTracker(ctx);
    await stopBot(ctx);
  },
};
