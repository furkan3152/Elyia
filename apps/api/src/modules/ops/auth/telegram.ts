/**
 * Telegram Mini App sign-in and chat linking.
 *
 * initData check (Telegram "Validating data received via the Mini App"):
 *   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
 * where data_check_string is every field but `hash` (and `signature`),
 * sorted, as `key=value` joined by "\n". `auth_date` must be at most a day old.
 *
 * Linking: a signed-in wallet asks for a one-time code; the bot's
 * `/start <code>` binds the chat to that address. Mini App sessions carry
 * the Telegram user and the linked address.
 */
import { createHmac } from "node:crypto";
import type { AppContext } from "../../../context.js";
import { randomBase62, safeEqual } from "./crypto.js";

export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;
export const LINK_CODE_TTL_MS = 10 * 60_000;

export interface TelegramUser {
  readonly id: number;
  readonly first_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export interface TelegramLink {
  readonly chatId: number;
  readonly userId: number;
  readonly address: string;
  readonly languageCode: string | null;
  readonly linkedAt: number;
}

export function initDataHash(botToken: string, dataCheckString: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** The Telegram user of valid initData, or null (bad hash, stale, malformed). */
export function validateInitData(initData: string, botToken: string, nowMs: number): TelegramUser | null {
  if (initData.length > 4_096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/u.test(hash)) return null;
  if (!safeEqual(initDataHash(botToken, dataCheckString(params)), hash)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || nowMs / 1000 - authDate > INIT_DATA_MAX_AGE_S || authDate - nowMs / 1000 > 60) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    return user && Number.isSafeInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

export async function createLinkCode(ctx: AppContext, address: string): Promise<{ readonly code: string; readonly expiresAt: number }> {
  const code = randomBase62(12);
  const expiresAt = ctx.clock.now() + LINK_CODE_TTL_MS;
  await ctx.store.collection("telegram_link_codes").put(code, { address: address.toLowerCase() }, { ttlMs: LINK_CODE_TTL_MS });
  return { code, expiresAt };
}

/** Consumes a link code (single use) and binds the chat. Null when the code is unknown or used. */
export async function redeemLinkCode(ctx: AppContext, code: string, chat: { readonly chatId: number; readonly userId: number; readonly languageCode: string | null }): Promise<TelegramLink | null> {
  if (!/^[0-9A-Za-z]{6,32}$/u.test(code)) return null;
  const links = ctx.store.collection<{ address: string }>("telegram_link_codes");
  const doc = await links.get(code);
  if (!doc || !(await links.delete(code))) return null;
  const link: TelegramLink = { chatId: chat.chatId, userId: chat.userId, address: doc.value.address, languageCode: chat.languageCode, linkedAt: ctx.clock.now() };
  await ctx.store.collection("telegram_links").put(`chat:${chat.chatId}`, { ...link });
  await ctx.store.collection("telegram_links").put(`addr:${link.address}`, { ...link });
  await ctx.store.collection("telegram_links").put(`user:${chat.userId}`, { ...link });
  return link;
}

export async function linkOfChat(ctx: AppContext, chatId: number): Promise<TelegramLink | null> {
  return ((await ctx.store.collection("telegram_links").get(`chat:${chatId}`))?.value as TelegramLink | undefined) ?? null;
}

export async function linkOfAddress(ctx: AppContext, address: string): Promise<TelegramLink | null> {
  return ((await ctx.store.collection("telegram_links").get(`addr:${address.toLowerCase()}`))?.value as TelegramLink | undefined) ?? null;
}

export async function linkOfUser(ctx: AppContext, userId: number): Promise<TelegramLink | null> {
  return ((await ctx.store.collection("telegram_links").get(`user:${userId}`))?.value as TelegramLink | undefined) ?? null;
}
