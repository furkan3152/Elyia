/**
 * The thread token: earlier answers of a clarify conversation, signed so a
 * client cannot forge them and bound to the text they answer. It carries
 * question ids and option ids or typed answers (bounded), never balances,
 * prices or resolved addresses. HMAC-SHA256 over the JSON payload.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { LANGUAGE_LIMITS, type LanguageAnswer } from "@elyia/core/api/language";
import { z } from "zod";

const payloadSchema = z
  .object({
    v: z.literal(1),
    /** First 16 hex chars of sha256(text). */
    h: z.string().regex(/^[0-9a-f]{16}$/u),
    /** Expiry, seconds since epoch. */
    e: z.number().int().positive(),
    a: z
      .array(
        z
          .object({
            question: z.string().min(1).max(80),
            option: z.string().max(80).optional(),
            text: z.string().max(LANGUAGE_LIMITS.maxAnswerTextLength).optional(),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();

export function textHash(text: string): string {
  return createHash("sha256").update(text.trim().normalize("NFC")).digest("hex").slice(0, 16);
}

function b64(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

export class ThreadSigner {
  private readonly key: Buffer;

  /** A missing secret gets a per-process key: threads then do not survive a restart. */
  constructor(secret: string | null | undefined) {
    this.key = secret ? createHash("sha256").update(`elyia.language.thread:${secret}`).digest() : randomBytes(32);
  }

  sign(text: string, answers: readonly LanguageAnswer[], nowMs: number): string | null {
    if (answers.length === 0) return null;
    const payload = { v: 1 as const, h: textHash(text), e: Math.floor(nowMs / 1000) + LANGUAGE_LIMITS.threadTtlSeconds, a: answers.map((answer) => ({ question: answer.question, ...(answer.option !== undefined ? { option: answer.option } : {}), ...(answer.text !== undefined ? { text: answer.text } : {}) })) };
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(createHmac("sha256", this.key).update(body).digest())}`;
  }

  /** The answers of a valid, unexpired token for this text; null otherwise (a bad token is ignored, never trusted). */
  verify(token: string, text: string, nowMs: number): LanguageAnswer[] | null {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra !== undefined || token.length > 8_192) return null;
    const expected = createHmac("sha256", this.key).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    const result = payloadSchema.safeParse(parsed);
    if (!result.success) return null;
    if (result.data.h !== textHash(text) || result.data.e * 1000 < nowMs) return null;
    return result.data.a.map((answer) => ({ question: answer.question, ...(answer.option !== undefined ? { option: answer.option } : {}), ...(answer.text !== undefined ? { text: answer.text } : {}) }));
  }
}

/** Earlier answers first, then this turn's (a new answer to the same question wins). */
export function mergeAnswers(earlier: readonly LanguageAnswer[], now: readonly LanguageAnswer[]): LanguageAnswer[] {
  const map = new Map<string, LanguageAnswer>();
  for (const answer of [...earlier, ...now]) map.set(answer.question, answer);
  return [...map.values()];
}
