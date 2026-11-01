/**
 * Developer platform: API keys, quotas and usage, webhooks, integrator fees,
 * the widget config and the MCP server.
 *
 *   (gate)  every /v1 request with an API key: auth, scope, quotas, metering
 *   POST   /developers/register                  (session)            DeveloperProfile
 *   GET    /developers/me                        (developer)          { profile, fee, widget }
 *   GET    /developers/keys                      (developer)          ApiKeyListResponse
 *   POST   /developers/keys                      (developer)          CreateKeyResponse (plain key once)
 *   POST   /developers/keys/:id/rotate           (developer)          CreateKeyResponse
 *   DELETE /developers/keys/:id                  (developer)          { key }
 *   GET    /developers/usage?days=1..30          (developer or key)   UsageResponse
 *   GET    /developers/webhooks                  (developer or key:webhooks)
 *   POST   /developers/webhooks                  (developer or key:webhooks)   CreateWebhookResponse
 *   PATCH  /developers/webhooks/:id              { enabled?, events? }
 *   DELETE /developers/webhooks/:id
 *   POST   /developers/webhooks/:id/test         one signed test delivery
 *   GET    /developers/webhooks/:id/deliveries   WebhookDeliveriesResponse
 *   GET    /developers/fees      PUT /developers/fees     IntegratorFeeConfig
 *   GET    /developers/widget    PUT /developers/widget   WidgetConfig
 *   GET    /widget/:developerId                  (public)             WidgetConfig
 *   POST   /mcp                                  (public or key)      MCP Streamable HTTP (stateless)
 *
 * Contract types: @elyia/core/api/developers. Nothing here signs or moves funds.
 */
import { NETWORK_KEYS, type NetworkKey } from "@elyia/core";
import { API_KEY_SCOPES, WEBHOOK_EVENT_TYPES, type UsageDay, type UsageResponse, type WebhookEvent, type WebhookEventType } from "@elyia/core/api/developers";
import type { IntentStreamEvent } from "@elyia/core/api/intents";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { elysiumNetworkFor } from "../../config.js";
import { ElyiaHttpError } from "../../http/errors.js";
import type { ApiModule } from "../../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryInteger } from "../../http/validate.js";
import { randomHex } from "../ops/auth/crypto.js";
import { mustSession, readSession, requireSession } from "../ops/auth/session.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { discoveryFor } from "../discovery/index.js";
import { developerGate, keyOf, usageOf, utcDay, type IntentOwner } from "./gate.js";
import { createKey, developerByAddress, developerById, keyView, listKeys, profileView, registerDeveloper, revokeKey, rotateKey, type DeveloperRecord } from "./keys.js";
import { serveMcp } from "./mcp/server.js";
import { feeView, setFee, setWidget, settingsOf, widgetView } from "./settings.js";
import { WebhookService, webhookView, type WebhookServiceOptions } from "./webhooks.js";

declare module "../../bus.js" {
  interface ElyiaEvents {
    /** An alert fired (ops evaluator); webhooks deliver it as `alert.fired`. */
    "alert.fired": { readonly owner: string; readonly firing: unknown };
  }
}

interface DeveloperServices {
  readonly webhooks: WebhookService;
  readonly unsubscribe: Array<() => void>;
}

const services = new WeakMap<AppContext, DeveloperServices>();

export function developerServices(ctx: AppContext, options: WebhookServiceOptions = {}): DeveloperServices {
  let found = services.get(ctx);
  if (!found) {
    found = { webhooks: new WebhookService(ctx, options), unsubscribe: [] };
    services.set(ctx, found);
  }
  return found;
}

/** Installs services with fakes (tests). */
export function setDeveloperServices(ctx: AppContext, options: WebhookServiceOptions): DeveloperServices {
  services.get(ctx)?.webhooks.stop();
  const created: DeveloperServices = { webhooks: new WebhookService(ctx, options), unsubscribe: [] };
  services.set(ctx, created);
  return created;
}

function event<T>(type: WebhookEvent["type"], data: T, now: number): WebhookEvent<T> {
  return { id: `evt_${randomHex(16)}`, type, createdAt: new Date(now).toISOString(), data };
}

/** Bus -> webhooks: intent events go to the developer whose key created the intent; alerts to the alert owner's developer profile. */
export function wireWebhookEvents(ctx: AppContext): () => void {
  const { webhooks } = developerServices(ctx);
  const offs: Array<() => void> = [];
  offs.push(
    ctx.bus.on("intents.event", ({ intentId, event: intentEvent }: { readonly intentId: string; readonly event: IntentStreamEvent }) => {
      const type: WebhookEventType | null =
        intentEvent.type === "intent.step_updated" && intentEvent.data.status === "settled"
          ? "intent.step.settled"
          : (intentEvent.type === "intent.step_updated" && intentEvent.data.status === "failed") || (intentEvent.type === "intent.status_changed" && intentEvent.data.status === "failed")
            ? "intent.failed"
            : null;
      if (!type) return;
      void docs<IntentOwner>(ctx, PLATFORM_COLLECTIONS.intentOwners)
        .get(intentId)
        .then((owner) => (owner ? webhooks.publish(owner.value.developerId, event(type, { intentId, ...(intentEvent.data as object) }, ctx.clock.now())) : 0))
        .catch((error: unknown) => ctx.log.warn("webhook routing failed", { error: error instanceof Error ? error.message : String(error) }));
    }),
  );
  offs.push(
    ctx.bus.on("alert.fired", ({ owner, firing }) => {
      void developerByAddress(ctx, owner)
        .then((developer) => (developer ? webhooks.publish(developer.id, event("alert.fired", firing, ctx.clock.now())) : 0))
        .catch(() => undefined);
    }),
  );
  return () => offs.forEach((off) => off());
}

/** Launch radar -> `launch.new` for every subscriber following that network. */
export function wireLaunchEvents(ctx: AppContext, network: NetworkKey): () => void {
  const { webhooks } = developerServices(ctx);
  return discoveryFor(ctx)
    .radar(network)
    .subscribe((launch: unknown) => {
      void webhooks
        .subscribers("launch.new")
        .then((records) => {
          const developers = new Set(records.filter((record) => record.networks.length === 0 || record.networks.includes(network)).map((record) => record.developerId));
          const payload = event("launch.new", { network, launch }, ctx.clock.now());
          return Promise.all([...developers].map((id) => webhooks.publish(id, payload, (record) => record.networks.length === 0 || record.networks.includes(network))));
        })
        .catch(() => undefined);
    });
}

/* ---------------------------------------------------------------- auth */

/** The developer behind a request: a developer session, or an API key (with `scope` when given). */
async function developerOf(ctx: AppContext, req: Request, scope?: (typeof API_KEY_SCOPES)[number]): Promise<DeveloperRecord> {
  const key = keyOf(req);
  if (key) {
    if (scope && !key.key.scopes.includes(scope)) throw new ElyiaHttpError("KEY_SCOPE", 403, `This key lacks the "${scope}" scope.`);
    const developer = await developerById(ctx, key.key.developerId);
    if (!developer) throw new ElyiaHttpError("UNAUTHORIZED", 401, "The key's developer no longer exists.");
    return developer;
  }
  const session = await readSession(ctx, req);
  if (!session) throw new ElyiaHttpError("UNAUTHORIZED", 401, "Sign in with a developer wallet or send an API key.");
  const developer = await developerByAddress(ctx, session.address);
  if (!developer) throw new ElyiaHttpError("FORBIDDEN", 403, "Register as a developer first (POST /v1/developers/register).");
  return developer;
}

/** Key management needs the wallet session (a key cannot mint keys). */
async function developerBySession(ctx: AppContext, req: Request): Promise<DeveloperRecord> {
  if (keyOf(req)) throw new ElyiaHttpError("FORBIDDEN", 403, "Keys are managed with a wallet session, not with an API key.");
  return developerOf(ctx, req);
}

/* ------------------------------------------------------------- schemas */

const scopeSchema = z.enum(API_KEY_SCOPES as unknown as [string, ...string[]]);
const quotasSchema = z.object({ requestsPerDay: z.number().int().positive(), plansPerDay: z.number().int().positive(), preparesPerDay: z.number().int().positive(), requestsPerMinute: z.number().int().positive() }).partial().strict();
const KeyBody = z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(scopeSchema).max(4).optional(), quotas: quotasSchema.optional() }).strict();
const KeyParams = z.object({ id: z.string().regex(/^key_[0-9a-f]{24}$/u) });
const WebhookParams = z.object({ id: z.string().regex(/^wh_[0-9a-f]{24}$/u) });
const eventSchema = z.enum(WEBHOOK_EVENT_TYPES as unknown as [string, ...string[]]);
const networkSchema = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]);
const WebhookBody = z.object({ url: z.string().min(8).max(2_048), events: z.array(eventSchema).min(1).max(WEBHOOK_EVENT_TYPES.length), networks: z.array(networkSchema).max(6).optional() }).strict();
const WebhookPatch = z.object({ enabled: z.boolean().optional(), events: z.array(eventSchema).min(1).max(WEBHOOK_EVENT_TYPES.length).optional() }).strict();
const FeeBody = z.object({ feeBps: z.number().int().min(0).max(10_000), recipient: evmAddress.nullable().optional() }).strict();
const originSchema = z
  .string()
  .max(200)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.origin === value && (url.protocol === "https:" || url.hostname === "localhost");
    } catch {
      return false;
    }
  }, "Expected an exact https origin.");
const WidgetBody = z
  .object({
    allowedOrigins: z.array(originSchema).max(20).optional(),
    theme: z.object({ mode: z.enum(["light", "dark", "auto"]).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/u).nullable().optional(), radius: z.enum(["pixel", "soft"]).optional(), locale: z.enum(["en", "tr", "auto"]).optional() }).strict().optional(),
    networks: z.array(networkSchema).max(6).optional(),
  })
  .strict();
const RegisterBody = z.object({ name: z.string().trim().min(1).max(60).optional() }).strict();
const UsageQuery = z.object({ days: queryInteger(1, 30).optional() });
const WidgetParams = z.object({ developerId: z.string().regex(/^dev_[0-9a-f]{20}$/u) });

export const developersModule: ApiModule = {
  name: "developers",
  register(router, ctx) {
    router.use(developerGate(ctx));

    router.post("/developers/register", requireSession(ctx), async (req, res) => {
      const body = parseBody(req, RegisterBody);
      const { record, created } = await registerDeveloper(ctx, mustSession(req).address, body.name ?? null);
      res.status(created ? 201 : 200).json(profileView(record));
    });

    router.get("/developers/me", async (req, res) => {
      const developer = await developerOf(ctx, req);
      const settings = await settingsOf(ctx, developer.id);
      res.json({ profile: profileView(developer), fee: feeView(settings), widget: widgetView(developer.id, settings) });
    });

    router.get("/developers/keys", async (req, res) => {
      const developer = await developerBySession(ctx, req);
      res.json({ keys: (await listKeys(ctx, developer.id)).map(keyView) });
    });

    router.post("/developers/keys", ctx.limits.auth, async (req, res) => {
      const developer = await developerBySession(ctx, req);
      const body = parseBody(req, KeyBody);
      const { record, plainKey } = await createKey(ctx, developer, { name: body.name, ...(body.scopes ? { scopes: body.scopes as never } : {}), ...(body.quotas ? { quotas: body.quotas } : {}) });
      res.status(201).json({ key: keyView(record), plainKey });
    });

    router.post("/developers/keys/:id/rotate", ctx.limits.auth, async (req, res) => {
      const developer = await developerBySession(ctx, req);
      const { id } = parseParams(req, KeyParams);
      const { record, plainKey } = await rotateKey(ctx, developer.id, id);
      res.json({ key: keyView(record), plainKey });
    });

    router.delete("/developers/keys/:id", async (req, res) => {
      const developer = await developerBySession(ctx, req);
      const { id } = parseParams(req, KeyParams);
      res.json({ key: keyView(await revokeKey(ctx, developer.id, id)) });
    });

    router.get("/developers/usage", async (req, res) => {
      const developer = await developerOf(ctx, req);
      const days = parseQuery(req, UsageQuery).days ?? 7;
      const now = ctx.clock.now();
      const dayList = Array.from({ length: days }, (_, index) => utcDay(now - index * 86_400_000));
      const keys = await listKeys(ctx, developer.id);
      const usage = await Promise.all(keys.map(async (key) => ({ keyId: key.id, name: key.name, quotas: key.quotas, days: await Promise.all(dayList.map((day) => usageOf(ctx, key.id, day))) })));
      const today = dayList[0] as string;
      const totals: UsageDay = usage.reduce<UsageDay>(
        (sum, key) => {
          const day = key.days[0];
          return day ? { day: today, requests: sum.requests + day.requests, plans: sum.plans + day.plans, prepares: sum.prepares + day.prepares } : sum;
        },
        { day: today, requests: 0, plans: 0, prepares: 0 },
      );
      const body: UsageResponse = { developerId: developer.id, keys: usage, totals };
      res.json(body);
    });

    const webhooks = () => developerServices(ctx).webhooks;

    router.get("/developers/webhooks", async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      res.json({ webhooks: (await webhooks().list(developer.id)).map(webhookView) });
    });

    router.post("/developers/webhooks", ctx.limits.auth, async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      const body = parseBody(req, WebhookBody);
      const { record, secret } = await webhooks().create(developer.id, { url: body.url, events: body.events as WebhookEventType[], networks: body.networks ?? (body.events.includes("launch.new") ? [elysiumNetworkFor(ctx.config.mode)] : []) });
      res.status(201).json({ webhook: webhookView(record), secret });
    });

    router.patch("/developers/webhooks/:id", async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      const { id } = parseParams(req, WebhookParams);
      const body = parseBody(req, WebhookPatch);
      res.json({ webhook: webhookView(await webhooks().update(developer.id, id, { ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.events ? { events: body.events as WebhookEventType[] } : {}) })) });
    });

    router.delete("/developers/webhooks/:id", async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      const { id } = parseParams(req, WebhookParams);
      if (!(await webhooks().remove(developer.id, id))) throw new ElyiaHttpError("NOT_FOUND", 404, "No such webhook.");
      res.json({ deleted: true });
    });

    router.post("/developers/webhooks/:id/test", ctx.limits.auth, async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      const { id } = parseParams(req, WebhookParams);
      res.json({ delivery: await webhooks().test(developer.id, id) });
    });

    router.get("/developers/webhooks/:id/deliveries", async (req, res) => {
      const developer = await developerOf(ctx, req, "webhooks");
      const { id } = parseParams(req, WebhookParams);
      res.json({ deliveries: await webhooks().deliveries(developer.id, id) });
    });

    router.get("/developers/fees", async (req, res) => {
      const developer = await developerOf(ctx, req);
      res.json(feeView(await settingsOf(ctx, developer.id)));
    });

    router.put("/developers/fees", async (req, res) => {
      const developer = await developerBySession(ctx, req);
      const body = parseBody(req, FeeBody);
      res.json(feeView(await setFee(ctx, developer.id, { feeBps: body.feeBps, recipient: body.recipient ?? null })));
    });

    router.get("/developers/widget", async (req, res) => {
      const developer = await developerOf(ctx, req);
      res.json(widgetView(developer.id, await settingsOf(ctx, developer.id)));
    });

    router.put("/developers/widget", async (req, res) => {
      const developer = await developerBySession(ctx, req);
      const body = parseBody(req, WidgetBody);
      res.json(widgetView(developer.id, await setWidget(ctx, developer.id, body as never)));
    });

    router.get("/widget/:developerId", async (req, res) => {
      const { developerId } = parseParams(req, WidgetParams);
      const developer = await developerById(ctx, developerId);
      if (!developer) throw new ElyiaHttpError("NOT_FOUND", 404, "No such developer.");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(widgetView(developer.id, await settingsOf(ctx, developer.id)));
    });

    router.post("/mcp", ctx.limits.heavy, serveMcp(ctx));
  },
  start(ctx) {
    const found = developerServices(ctx);
    found.unsubscribe.push(wireWebhookEvents(ctx));
    found.unsubscribe.push(wireLaunchEvents(ctx, elysiumNetworkFor(ctx.config.mode)));
  },
  stop(ctx) {
    const found = services.get(ctx);
    if (!found) return;
    for (const off of found.unsubscribe.splice(0)) off();
    found.webhooks.stop();
  },
};

/** Integrator fee of the developer behind a keyed request (route cards), or null. */
export async function integratorFeeOf(ctx: AppContext, req: Request): Promise<{ readonly bps: number; readonly recipient: string; readonly developerId: string } | null> {
  const key = keyOf(req);
  if (!key) return null;
  const settings = await settingsOf(ctx, key.key.developerId);
  return settings.fee.feeBps > 0 && settings.fee.recipient ? { bps: settings.fee.feeBps, recipient: settings.fee.recipient, developerId: key.key.developerId } : null;
}
