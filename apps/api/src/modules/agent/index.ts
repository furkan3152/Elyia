/**
 * Ely, the Elyia agent: chat, memory, proposals, portfolio insights,
 * automations and opt-in Keeper mode.
 *
 *   POST   /agent/chat                               SSE: thread, token, tool_call, tool_result, proposal, route_card, note, clarify, done, error
 *                                                    (body.clarify: answers to the last clarify event's questions)
 *   GET    /agent/threads   GET/DELETE /agent/threads/:id         (session)
 *   GET    /agent/memory    PUT /agent/memory                     (session)
 *   GET    /agent/insights/:address                               (public, read-only)   InsightsResponse
 *   POST   /agent/insights/:address/:insightId/propose            (session = address)   Proposal
 *   GET    /agent/proposals  POST /agent/proposals  GET /agent/proposals/:id            (session)
 *   POST   /agent/proposals/:id/decision    { decision, via? }    (session)   ProposalDecisionResponse
 *          (approve stores one intent linked to the proposal; approving again returns it; the
 *           intent's final status marks the proposal executed / failed)
 *   GET    /agent/automations  POST  PATCH /:id  DELETE /:id      (session)
 *   GET    /agent/skills                                          automation catalog
 *   GET    /agent/feed                                            (session)
 *   POST   /agent/keeper/prepare | /activate | /revoke   GET /agent/keeper    (session; 503 without ELYIA_KEEPER_SECRET)
 *   POST   /agent/kill      { on: boolean }                       (session) pauses keeper + automations
 *
 * Contract types: @elyia/core/api/agent. Writes are proposals the user
 * signs; only the opt-in keeper executes, and only reduce-only protection
 * inside its caps.
 */
import { INSIGHT_KINDS, AUTOMATION_KINDS, type ChatRequest } from "@elyia/core/api/agent";
import { LANGUAGE_LIMITS } from "@elyia/core/api/language";
import { NETWORK_KEYS, type IntentActionSpec, type NetworkKey } from "@elyia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError, retryAfterHeader } from "../../http/errors.js";
import { HERD_HOLDER_PERKS } from "@elyia/core/api/herd";
import { perksFor } from "../herd/perks.js";
import type { ApiModule } from "../../http/router.js";
import { openSse } from "../../http/sse.js";
import { evmAddress, parseBody, parseParams } from "../../http/validate.js";
import { mustSession, optionalSession, readSession, requireSession } from "../ops/auth/session.js";
import { integratorFeeOf } from "../developers/index.js";
import { registerStats } from "../admin/stats.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { AUTOMATION_CATALOG, createAutomation, deleteAutomation, listAutomations, startScheduler, stopScheduler, updateAutomation } from "./automations.js";
import { chatTurn } from "./chat.js";
import { activateKeeper, keeperStatus, keeperUnavailable, prepareKeeper, revokeKeeper, setKill, type KeeperRecord } from "./keeper.js";
import { deleteThread, feedOf, listThreads, memoryOf, threadOf, updateMemory } from "./memory.js";
import { createProposal, decide, insightsFor, listProposals, proposalOf, wireProposalOutcomes } from "./proposals.js";

const outcomeWires = new WeakMap<AppContext, () => void>();

const networkKey = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]);
const ClarifyAnswer = z
  .object({ question: z.string().min(1).max(80), option: z.string().min(1).max(80).optional(), text: z.string().min(1).max(LANGUAGE_LIMITS.maxAnswerTextLength).optional() })
  .strict()
  .refine((answer) => (answer.option === undefined) !== (answer.text === undefined), "Give either option or text.");
const ChatBody = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    threadId: z.string().regex(/^thr_[0-9a-f]{20}$/u).optional(),
    locale: z.enum(["en", "tr"]).optional(),
    address: evmAddress.optional(),
    clarify: z.object({ thread: z.string().min(1).max(8_192).optional(), answers: z.array(ClarifyAnswer).min(1).max(LANGUAGE_LIMITS.maxAnswers) }).strict().optional(),
  })
  .strict();
const ThreadParams = z.object({ id: z.string().regex(/^thr_[0-9a-f]{20}$/u) });
const AddressParams = z.object({ address: evmAddress });
const InsightParams = z.object({ address: evmAddress, insightId: z.string().min(5).max(80) });
const ProposalParams = z.object({ id: z.string().regex(/^prp_[0-9a-f]{24}$/u) });
const AutomationParams = z.object({ id: z.string().regex(/^aut_[0-9a-f]{20}$/u) });
const DecisionBody = z.object({ decision: z.enum(["approve", "reject"]), via: z.enum(["wallet", "keeper"]).optional(), agent: evmAddress.optional() }).strict();
const paramValue = z.union([z.string().max(80), z.number(), z.boolean()]);
const AutomationBody = z.object({ kind: z.enum(AUTOMATION_KINDS as unknown as [string, ...string[]]), params: z.record(paramValue).optional(), enabled: z.boolean().optional(), keeper: z.boolean().optional() }).strict();
const AutomationPatch = z.object({ params: z.record(paramValue).optional(), enabled: z.boolean().optional(), keeper: z.boolean().optional() }).strict();
const MemoryBody = z
  .object({
    goals: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
    riskProfile: z.enum(["careful", "balanced", "bold"]).optional(),
    targetMix: z.object({ weights: z.record(z.number().min(0).max(100)), bandPct: z.number().min(1).max(50) }).strict().nullable().optional(),
    gasFloorHype: z.string().regex(/^\d{1,4}(?:\.\d{1,8})?$/u).optional(),
    dustUsd: z.number().min(0).max(100).optional(),
    locale: z.enum(["en", "tr"]).optional(),
  })
  .strict();
const actionSchema = z
  .object({
    kind: z.string().min(1).max(32),
    network: networkKey,
    from: z.string().max(100).optional(),
    to: z.string().max(100).optional(),
    amount: z.string().max(40).optional(),
    toNetwork: networkKey.optional(),
    protocol: z.string().max(64).optional(),
    market: z.string().max(40).optional(),
    side: z.enum(["buy", "sell", "long", "short"]).optional(),
    size: z.string().max(40).optional(),
    price: z.string().max(40).optional(),
    reduceOnly: z.boolean().optional(),
    takeProfit: z.string().max(40).optional(),
    stopLoss: z.string().max(40).optional(),
    leverage: z.object({ value: z.number().min(1).max(50), mode: z.enum(["cross", "isolated"]).optional() }).strict().optional(),
    params: z.record(paramValue).optional(),
  })
  .strict();
const ProposalBody = z.object({ title: z.string().trim().min(3).max(120), explanation: z.string().trim().max(1_200).optional(), actions: z.array(actionSchema).min(1).max(8) }).strict();
const KeeperPrepareBody = z
  .object({
    realm: z.enum(["hypercore", "elysium"]).optional(),
    days: z.number().int().min(1).max(30).optional(),
    limits: z.object({ maxOrderUsd: z.number().positive().max(10_000).optional(), maxDailyUsd: z.number().positive().max(50_000).optional(), coins: z.array(z.string().min(1).max(40)).max(20).optional() }).strict().optional(),
    account: evmAddress.optional(),
    signatureChainId: z.number().int().positive().max(2 ** 32).optional(),
  })
  .strict();
const KeeperRevokeBody = z.object({ signatureChainId: z.number().int().positive().max(2 ** 32).optional() }).strict();
const KillBody = z.object({ on: z.boolean() }).strict();

function owner(req: Request): string {
  return mustSession(req).address;
}

/** Signed-in chat turns per UTC day: the base allowance, more for Herd holders (perksFor: balanceOf on chain, cached). */
export async function chatQuota(ctx: AppContext, owner: string): Promise<void> {
  const now = ctx.clock.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const limit = (await perksFor(ctx, owner)).agentChatPerDay;
  const used = await ctx.store.counters("agent_chat_daily").increment(`${owner}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
  if (used > limit) {
    const seconds = Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now) / 1000));
    throw new ElyiaHttpError("QUOTA_EXCEEDED", 429, `You used today's ${limit} Ely turns. They reset at 00:00 UTC${limit < HERD_HOLDER_PERKS.agentChatPerDay ? `; Herd holders get ${HERD_HOLDER_PERKS.agentChatPerDay}` : ""}.`, { limit, retryAfterSeconds: seconds }, { headers: retryAfterHeader(seconds, 86_400) });
  }
}

function needKeeper(ctx: AppContext): void {
  if (!ctx.config.keeperSecret) throw keeperUnavailable();
}

export const agentModule: ApiModule = {
  name: "agent",
  register(router, ctx) {
    const session = requireSession(ctx);

    router.post("/agent/chat", ctx.limits.heavy, optionalSession(ctx), async (req, res) => {
      const body = parseBody(req, ChatBody) as ChatRequest;
      const signedIn = await readSession(ctx, req);
      const address = body.address ?? signedIn?.address;
      if (!address) throw new ElyiaHttpError("INVALID_REQUEST", 400, "Send `address` or sign in: Ely needs a wallet to look at.");
      if (signedIn) await chatQuota(ctx, signedIn.address);
      const integratorFee = await integratorFeeOf(ctx, req);
      const stream = openSse(req, res, { slots: ctx.limits.streams, now: () => ctx.clock.now() });
      if (stream.closed) return;
      try {
        await chatTurn({ ctx, owner: signedIn?.address ?? null, address, message: body.message, threadId: body.threadId ?? null, locale: body.locale ?? null, integratorFee, clarify: body.clarify ?? null, emit: (event, data) => stream.send(event, data) });
      } catch (error) {
        ctx.log.warn("agent chat turn failed", { error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
        stream.send("error", { code: error instanceof ElyiaHttpError ? error.code : "AGENT_FAILED", message: error instanceof ElyiaHttpError && error.status < 500 ? error.message : "Ely could not finish this turn." });
      }
      stream.close();
    });

    router.get("/agent/threads", session, async (req, res) => {
      const threads = await listThreads(ctx, owner(req));
      res.json({ threads: threads.map((thread) => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt, messages: thread.messages.length })) });
    });

    router.get("/agent/threads/:id", session, async (req, res) => {
      const { id } = parseParams(req, ThreadParams);
      const thread = await threadOf(ctx, owner(req), id);
      if (!thread) throw new ElyiaHttpError("NOT_FOUND", 404, "No such thread.");
      res.json(thread);
    });

    router.delete("/agent/threads/:id", session, async (req, res) => {
      const { id } = parseParams(req, ThreadParams);
      res.json({ deleted: await deleteThread(ctx, owner(req), id) });
    });

    router.get("/agent/memory", session, async (req, res) => {
      res.json(await memoryOf(ctx, owner(req)));
    });

    router.put("/agent/memory", session, async (req, res) => {
      const body = parseBody(req, MemoryBody);
      res.json(await updateMemory(ctx, owner(req), { ...body, ...(body.targetMix === null ? { targetMix: null } : {}) } as never));
    });

    router.get("/agent/insights/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      res.json(await insightsFor(ctx, address));
    });

    router.post("/agent/insights/:address/:insightId/propose", ctx.limits.heavy, session, async (req, res) => {
      const { address, insightId } = parseParams(req, InsightParams);
      if (address !== owner(req)) throw new ElyiaHttpError("FORBIDDEN", 403, "Proposals are made only for the signed-in wallet.");
      const insight = (await insightsFor(ctx, address)).insights.find((entry) => entry.id === insightId);
      if (!insight) throw new ElyiaHttpError("NOT_FOUND", 404, "That insight is no longer current. Reload the insights.");
      if (insight.paper || insight.actions.length === 0) throw new ElyiaHttpError("NOTHING_TO_SIGN", 409, insight.paper ? "This insight is paper only (testnet funding harvester)." : "This insight is information only.");
      res.status(201).json(await createProposal(ctx, address, { origin: "insight", title: insight.title.en, explanation: insight.explanation.en, actions: insight.actions, insightId, integratorFee: await integratorFeeOf(ctx, req) }));
    });

    router.get("/agent/proposals", session, async (req, res) => {
      res.json({ proposals: await listProposals(ctx, owner(req)) });
    });

    router.post("/agent/proposals", ctx.limits.heavy, session, async (req, res) => {
      const body = parseBody(req, ProposalBody);
      res.status(201).json(await createProposal(ctx, owner(req), { origin: "chat", title: body.title, explanation: body.explanation ?? body.title, actions: body.actions as unknown as IntentActionSpec[], integratorFee: await integratorFeeOf(ctx, req) }));
    });

    router.get("/agent/proposals/:id", session, async (req, res) => {
      const { id } = parseParams(req, ProposalParams);
      res.json(await proposalOf(ctx, owner(req), id));
    });

    router.post("/agent/proposals/:id/decision", ctx.limits.heavy, session, async (req, res) => {
      const { id } = parseParams(req, ProposalParams);
      const body = parseBody(req, DecisionBody);
      if (body.via === "keeper") needKeeper(ctx);
      res.json(await decide(ctx, owner(req), id, body.decision, body.via ?? "wallet", body.agent ? { agent: body.agent } : {}));
    });

    router.get("/agent/skills", (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ automations: AUTOMATION_CATALOG, insights: INSIGHT_KINDS });
    });

    router.get("/agent/automations", session, async (req, res) => {
      res.json({ automations: await listAutomations(ctx, owner(req)), catalog: AUTOMATION_CATALOG });
    });

    router.post("/agent/automations", session, async (req, res) => {
      const body = parseBody(req, AutomationBody);
      if (body.keeper) needKeeper(ctx);
      res.status(201).json(await createAutomation(ctx, owner(req), body as never));
    });

    router.patch("/agent/automations/:id", session, async (req, res) => {
      const { id } = parseParams(req, AutomationParams);
      const body = parseBody(req, AutomationPatch);
      if (body.keeper) needKeeper(ctx);
      res.json(await updateAutomation(ctx, owner(req), id, body));
    });

    router.delete("/agent/automations/:id", session, async (req, res) => {
      const { id } = parseParams(req, AutomationParams);
      if (!(await deleteAutomation(ctx, owner(req), id))) throw new ElyiaHttpError("NOT_FOUND", 404, "No such automation.");
      res.json({ deleted: true });
    });

    router.get("/agent/feed", session, async (req, res) => {
      res.json({ entries: await feedOf(ctx, owner(req)) });
    });

    router.get("/agent/keeper", session, async (req, res) => {
      res.json(await keeperStatus(ctx, owner(req)));
    });

    router.post("/agent/keeper/prepare", ctx.limits.auth, session, async (req, res) => {
      needKeeper(ctx);
      const body = parseBody(req, KeeperPrepareBody);
      const realm = body.realm ?? "hypercore";
      if (realm === "elysium" && !body.account) throw new ElyiaHttpError("INVALID_REQUEST", 400, "Elysium keepers need `account` (your ElyAccount).");
      res.json(await prepareKeeper(ctx, owner(req), { realm, days: body.days ?? 7, ...(body.limits ? { limits: body.limits } : {}), ...(body.account ? { account: body.account } : {}), ...(body.signatureChainId ? { signatureChainId: body.signatureChainId } : {}) }));
    });

    router.post("/agent/keeper/activate", ctx.limits.auth, session, async (req, res) => {
      needKeeper(ctx);
      await activateKeeper(ctx, owner(req));
      res.json(await keeperStatus(ctx, owner(req)));
    });

    router.post("/agent/keeper/revoke", ctx.limits.auth, session, async (req, res) => {
      const body = parseBody(req, KeeperRevokeBody);
      res.json(await revokeKeeper(ctx, owner(req), body.signatureChainId));
    });

    router.post("/agent/kill", session, async (req, res) => {
      const body = parseBody(req, KillBody);
      await setKill(ctx, owner(req), body.on);
      res.json(await keeperStatus(ctx, owner(req)));
    });
  },
  start(ctx) {
    startScheduler(ctx);
    if (!outcomeWires.has(ctx)) outcomeWires.set(ctx, wireProposalOutcomes(ctx));
    registerStats(ctx, "keeper", async () => {
      const rows = await docs<KeeperRecord>(ctx, PLATFORM_COLLECTIONS.keepers).list({ limit: 1_000 });
      return { running: ctx.config.keeperSecret !== null, lastRunAt: null, lastError: null, pending: rows.filter((row) => row.value.state === "active").length, note: "active keepers" };
    });
  },
  stop(ctx) {
    stopScheduler(ctx);
    outcomeWires.get(ctx)?.();
    outcomeWires.delete(ctx);
  },
};
