/**
 * Verify Elyia webhook deliveries (WebCrypto HMAC-SHA256; Node 20+, Deno,
 * Bun, Workers, browsers).
 *
 *   Elyia-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Pass the raw request body (the exact bytes), not a re-serialized object.
 * Deliveries are at least once: dedupe on `Elyia-Event-Id`.
 */
import { WEBHOOK_TOLERANCE_SECONDS, webhookSignedPayload, type WebhookEvent } from "@elyia/core/api/developers";

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function signWebhookPayload(secret: string, timestamp: number, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(webhookSignedPayload(timestamp, rawBody))));
}

/** Returns the parsed event when the signature is valid and fresh; throws WebhookSignatureError otherwise. */
export async function verifyWebhook<T = unknown>(input: {
  readonly secret: string;
  readonly rawBody: string;
  readonly signatureHeader: string | null | undefined;
  readonly toleranceSeconds?: number;
  readonly now?: number;
}): Promise<WebhookEvent<T>> {
  const header = input.signatureHeader ?? "";
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/u.exec(header.trim());
  if (!match) throw new WebhookSignatureError("Missing or malformed Elyia-Signature header.");
  const timestamp = Number(match[1]);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) throw new WebhookSignatureError("The signature is too old (replay protection).");
  const expected = await signWebhookPayload(input.secret, timestamp, input.rawBody);
  if (!constantTimeEqual(expected, match[2] as string)) throw new WebhookSignatureError("The signature does not match.");
  return JSON.parse(input.rawBody) as WebhookEvent<T>;
}
