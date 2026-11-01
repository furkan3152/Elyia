/**
 * Server-side secrets and the primitives built on them:
 *
 * - the session secret (ELYIA_SESSION_SECRET; outside production an
 *   ephemeral one is generated with a warning, so sessions die on restart);
 * - purpose keys derived with HKDF-SHA256 (`purposeKey("webhook-seal")`), so
 *   one secret never signs two kinds of things;
 * - AES-256-GCM sealing with the context as AAD (`v1.<iv>.<tag>.<ct>`, base64url);
 * - unbiased base62 tokens and SHA-256 hex.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "../../../context.js";
import { ElyiaHttpError } from "../../../http/errors.js";

const ephemeral = new WeakMap<AppContext, string>();

/** The session root secret, or null in production when it is missing (callers refuse with 503). */
export function sessionSecretOf(ctx: AppContext): string | null {
  if (ctx.config.sessionSecret) return ctx.config.sessionSecret;
  if (ctx.config.env === "production") return null;
  let secret = ephemeral.get(ctx);
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    ephemeral.set(ctx, secret);
    ctx.log.warn("ELYIA_SESSION_SECRET is not set: using an ephemeral secret (sessions, webhook secrets and link codes reset on restart)");
  }
  return secret;
}

export function sessionsUnavailable(): ElyiaHttpError {
  return new ElyiaHttpError("SESSIONS_NOT_CONFIGURED", 503, "Sign-in is not configured on this server (ELYIA_SESSION_SECRET is missing).");
}

export function requireSecret(ctx: AppContext): string {
  const secret = sessionSecretOf(ctx);
  if (!secret) throw sessionsUnavailable();
  return secret;
}

/** A 32-byte key for one purpose, derived from a root secret. */
export function deriveKey(root: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(root, "utf8"), Buffer.from("elyia/v1", "utf8"), Buffer.from(purpose, "utf8"), 32));
}

export function purposeKey(ctx: AppContext, purpose: string): Buffer {
  return deriveKey(requireSecret(ctx), purpose);
}

export function hmacHex(key: Buffer | string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Rejection sampling: no modulo bias. */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** AES-256-GCM, 96-bit IV, AAD = context. */
export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

/** Throws when the box was tampered with, sealed for another context or with another key. */
export function open(key: Buffer, box: string, context: string): string {
  const [version, iv, tag, ct] = box.split(".");
  if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("sealed value has an unknown format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
