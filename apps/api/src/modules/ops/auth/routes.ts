/**
 *   POST /auth/siwe/nonce     { address?, chainId? }       SiweNonceResponse
 *   POST /auth/siwe/verify    { message, signature }       SessionResponse
 *   GET  /auth/session        (session)                    SessionView
 *   POST /auth/logout         (session)                    { revoked: true }
 *   POST /auth/telegram       { initData }                 SessionResponse (linked chats only)
 *   POST /telegram/link-code  (session)                    LinkCodeResponse
 */
import type { LinkCodeResponse, SessionResponse } from "@elyia/core/api/ops";
import type { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../../context.js";
import { ElyiaHttpError } from "../../../http/errors.js";
import { evmAddress, parseBody } from "../../../http/validate.js";
import { requireSecret } from "./crypto.js";
import { issueToken, mustSession, requireSession, revokeSession, rolesOf, sessionView } from "./session.js";
import { issueNonce, verifySiwe } from "./siwe.js";
import { createLinkCode, linkOfUser, validateInitData } from "./telegram.js";

const NonceBody = z.object({ address: evmAddress.optional(), chainId: z.number().int().positive().max(2 ** 53).optional() }).strict();
const VerifyBody = z.object({ message: z.string().min(40).max(4_000), signature: z.string().regex(/^0x[0-9a-fA-F]{2,2000}$/u) }).strict();
const TelegramBody = z.object({ initData: z.string().min(10).max(4_096) }).strict();

export function registerAuthRoutes(router: Router, ctx: AppContext): void {
  router.post("/auth/siwe/nonce", ctx.limits.auth, async (req, res) => {
    const body = parseBody(req, NonceBody);
    requireSecret(ctx);
    res.json(await issueNonce(ctx, body));
  });

  router.post("/auth/siwe/verify", ctx.limits.auth, async (req, res) => {
    const body = parseBody(req, VerifyBody);
    requireSecret(ctx);
    const verified = await verifySiwe(ctx, body.message, body.signature);
    const { token, claims } = issueToken(ctx, { address: verified.address });
    const response: SessionResponse = { token, session: sessionView(claims, await rolesOf(ctx, verified.address)) };
    res.json(response);
  });

  router.get("/auth/session", requireSession(ctx), (req, res) => {
    const session = mustSession(req);
    res.json(sessionView(session.claims, session.roles));
  });

  router.post("/auth/logout", requireSession(ctx), async (req, res) => {
    await revokeSession(ctx, mustSession(req).claims);
    res.json({ revoked: true });
  });

  router.post("/auth/telegram", ctx.limits.auth, async (req, res) => {
    const body = parseBody(req, TelegramBody);
    const botToken = ctx.config.telegram.botToken;
    if (!botToken) throw new ElyiaHttpError("TELEGRAM_NOT_CONFIGURED", 503, "The Telegram bot is not configured on this server.");
    requireSecret(ctx);
    const user = validateInitData(body.initData, botToken, ctx.clock.now());
    if (!user) throw new ElyiaHttpError("TELEGRAM_INIT_DATA_INVALID", 401, "The Mini App data did not verify (bad hash or older than a day).");
    const link = await linkOfUser(ctx, user.id);
    if (!link) throw new ElyiaHttpError("TELEGRAM_NOT_LINKED", 403, "Link this Telegram account to a wallet first: sign in on the web and open the bot link.");
    const { token, claims } = issueToken(ctx, { address: link.address, telegramUserId: user.id });
    const response: SessionResponse = { token, session: sessionView(claims, await rolesOf(ctx, link.address)) };
    res.json(response);
  });

  router.post("/telegram/link-code", ctx.limits.auth, requireSession(ctx), async (req, res) => {
    const { code, expiresAt } = await createLinkCode(ctx, mustSession(req).address);
    const bot = ctx.config.telegram.botUsername;
    const response: LinkCodeResponse = { code, expiresAt: new Date(expiresAt).toISOString(), deepLink: bot ? `https://t.me/${bot}?start=${code}` : null };
    res.json(response);
  });
}
