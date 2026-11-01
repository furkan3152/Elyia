/**
 * Session tokens and roles.
 *
 *   token = "es1." + base64url(JSON payload) + "." + base64url(HMAC-SHA256(k_session, "es1." + payload))
 *
 * `k_session` is derived from ELYIA_SESSION_SECRET (HKDF, purpose "session").
 * Tokens travel in the `Elyia-Session` header (never cookies). Roles:
 * `user` for any valid session; `developer` when the address registered a
 * developer profile; `admin` when the address is in ELYIA_ADMIN_ADDRESSES.
 * Developer and admin are re-checked on every request, never trusted from
 * the token. Logging out revokes the session id until its expiry.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SESSION_HEADER, type SessionRole, type SessionView } from "@elyia/core/api/ops";
import type { AppContext } from "../../../context.js";
import { ElyiaHttpError } from "../../../http/errors.js";
import { sendError } from "../../../http/request.js";
import { purposeKey, randomHex, safeEqual, sessionSecretOf, sessionsUnavailable } from "./crypto.js";
import { createHmac } from "node:crypto";

export const SESSION_TTL_MS = 24 * 60 * 60_000;
const TOKEN_PREFIX = "es1";
const MAX_TOKEN_LENGTH = 2_048;

export interface SessionClaims {
  /** Lowercase 0x address. */
  readonly sub: string;
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
  /** Telegram user id for Mini App sessions. */
  readonly tg?: number;
}

export interface SessionContext {
  readonly claims: SessionClaims;
  readonly address: string;
  readonly roles: readonly SessionRole[];
}

function sign(ctx: AppContext, body: string): string {
  return createHmac("sha256", purposeKey(ctx, "session")).update(`${TOKEN_PREFIX}.${body}`, "utf8").digest("base64url");
}

export function issueToken(ctx: AppContext, input: { readonly address: string; readonly telegramUserId?: number; readonly ttlMs?: number }): { readonly token: string; readonly claims: SessionClaims } {
  const now = ctx.clock.now();
  const claims: SessionClaims = {
    sub: input.address.toLowerCase(),
    sid: `ses_${randomHex(12)}`,
    iat: now,
    exp: now + (input.ttlMs ?? SESSION_TTL_MS),
    ...(input.telegramUserId !== undefined ? { tg: input.telegramUserId } : {}),
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return { token: `${TOKEN_PREFIX}.${body}.${sign(ctx, body)}`, claims };
}

/** Claims of a well-formed, correctly signed, unexpired token, or null. Revocation is checked separately. */
export function verifyToken(ctx: AppContext, token: string): SessionClaims | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const [prefix, body, mac] = token.split(".");
  if (prefix !== TOKEN_PREFIX || !body || !mac) return null;
  if (!safeEqual(sign(ctx, body), mac)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || !/^0x[0-9a-f]{40}$/u.test(claims.sub) || typeof claims.exp !== "number" || typeof claims.sid !== "string") return null;
  if (claims.exp <= ctx.clock.now()) return null;
  return claims;
}

/* ---------------------------------------------------------------- roles */

export function isAdmin(ctx: AppContext, address: string): boolean {
  return ctx.config.adminAddresses.includes(address.toLowerCase());
}

/** Developer profiles live in the `developers` collection, keyed by address. */
export async function isDeveloper(ctx: AppContext, address: string): Promise<boolean> {
  return (await ctx.store.collection("developers").get(address.toLowerCase())) !== null;
}

export async function rolesOf(ctx: AppContext, address: string): Promise<SessionRole[]> {
  const roles: SessionRole[] = ["user"];
  if (await isDeveloper(ctx, address)) roles.push("developer");
  if (isAdmin(ctx, address)) roles.push("admin");
  return roles;
}

export function sessionView(claims: SessionClaims, roles: readonly SessionRole[]): SessionView {
  return {
    address: claims.sub,
    roles,
    issuedAt: new Date(claims.iat).toISOString(),
    expiresAt: new Date(claims.exp).toISOString(),
    sessionId: claims.sid,
    telegramUserId: claims.tg ?? null,
  };
}

export async function revokeSession(ctx: AppContext, claims: SessionClaims): Promise<void> {
  const ttlMs = Math.max(1, claims.exp - ctx.clock.now());
  await ctx.store.collection("session_revocations").put(claims.sid, { at: ctx.clock.now() }, { ttlMs });
}

async function isRevoked(ctx: AppContext, sid: string): Promise<boolean> {
  return (await ctx.store.collection("session_revocations").get(sid)) !== null;
}

/* ----------------------------------------------------------- middleware */

const sessions = new WeakMap<Request, SessionContext>();

/** The request's verified session (after `requireSession` / `optionalSession`), or null. */
export function sessionOf(req: Request): SessionContext | null {
  return sessions.get(req) ?? null;
}

export function unauthorized(message = "Sign in first: send a session token in the Elyia-Session header."): ElyiaHttpError {
  return new ElyiaHttpError("UNAUTHORIZED", 401, message);
}

/** Reads and verifies the session header. Throws 401 for a bad token; returns null when none was sent. */
export async function readSession(ctx: AppContext, req: Request): Promise<SessionContext | null> {
  const cached = sessions.get(req);
  if (cached) return cached;
  const raw = req.get(SESSION_HEADER)?.trim();
  if (!raw) return null;
  if (!sessionSecretOf(ctx)) throw sessionsUnavailable();
  const claims = verifyToken(ctx, raw);
  if (!claims) throw unauthorized("The session token is invalid or expired. Sign in again.");
  if (await isRevoked(ctx, claims.sid)) throw unauthorized("This session was signed out. Sign in again.");
  const session: SessionContext = { claims, address: claims.sub, roles: await rolesOf(ctx, claims.sub) };
  sessions.set(req, session);
  return session;
}

function wrap(handler: (req: Request) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req).then(
      () => next(),
      (error: unknown) => sendError(req, res, error),
    );
  };
}

/**
 * Route guard: 401 without a valid session, 403 when the session lacks
 * `role`. Developer and admin are checked live.
 */
export function requireSession(ctx: AppContext, role: SessionRole = "user"): RequestHandler {
  return wrap(async (req) => {
    const session = await readSession(ctx, req);
    if (!session) throw unauthorized();
    if (!session.roles.includes(role)) {
      throw new ElyiaHttpError("FORBIDDEN", 403, role === "admin" ? "This needs an owner (admin) wallet." : role === "developer" ? "Register as a developer first (POST /v1/developers/register)." : "Not allowed.", { role });
    }
  });
}

/** Attaches a session when one is sent (a bad token is still a 401). */
export function optionalSession(ctx: AppContext): RequestHandler {
  return wrap(async (req) => {
    await readSession(ctx, req);
  });
}

/** The session of a guarded route (requireSession ran first). */
export function mustSession(req: Request): SessionContext {
  const session = sessionOf(req);
  if (!session) throw unauthorized();
  return session;
}
