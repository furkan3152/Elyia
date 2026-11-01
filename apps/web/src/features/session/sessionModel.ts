/**
 * Wallet sessions (SIWE), pure rules. No wallet stack and no DOM here: node
 * tests load this file, and site pages read the stored session without
 * downloading wagmi.
 *
 * A session is an HMAC-signed token the API issues after a Sign-In with
 * Ethereum (EIP-4361) signature. It proves control of an address and nothing
 * more: it moves no funds and can never sign a transaction. Roles (`developer`,
 * `admin`) are re-checked by the server on every request; the client copy only
 * decides what to draw.
 */
import type { SessionResponse, SessionRole, SessionView } from "@elyia/core/api/ops";

/** sessionStorage key: a session lasts for the tab, never across browser restarts. */
export const SESSION_STORAGE_KEY = "elyia.session.v1";

export type SessionStatus = "anonymous" | "checking" | "signed-in" | "expired";

export interface StoredSession {
  readonly token: string;
  readonly session: SessionView;
}

const ROLES: ReadonlySet<string> = new Set(["user", "developer", "admin"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A well-formed SessionView, or null. */
export function readSessionView(value: unknown): SessionView | null {
  if (!isRecord(value)) return null;
  const { address, roles, issuedAt, expiresAt, sessionId, telegramUserId } = value;
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string" && ROLES.has(role))) return null;
  if (typeof issuedAt !== "string" || typeof expiresAt !== "string" || typeof sessionId !== "string") return null;
  if (Number.isNaN(Date.parse(expiresAt))) return null;
  return {
    address,
    roles: roles as SessionRole[],
    issuedAt,
    expiresAt,
    sessionId,
    telegramUserId: typeof telegramUserId === "number" ? telegramUserId : null,
  };
}

/** Parses a SessionResponse from the API (or the stored copy); null when malformed. */
export function readSessionResponse(value: unknown): StoredSession | null {
  if (!isRecord(value)) return null;
  const { token, session } = value;
  if (typeof token !== "string" || token.length < 10 || token.length > 2_048) return null;
  const view = readSessionView(session);
  return view ? { token, session: view } : null;
}

export function serializeSession(stored: SessionResponse | StoredSession): string {
  return JSON.stringify({ token: stored.token, session: stored.session });
}

/** The stored session when it parses and has not expired at `now`. */
export function parseStoredSession(raw: string | null, now: number): StoredSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const stored = readSessionResponse(parsed);
  if (!stored || isExpired(stored.session, now)) return null;
  return stored;
}

export function isExpired(session: Pick<SessionView, "expiresAt">, now: number): boolean {
  const expires = Date.parse(session.expiresAt);
  return Number.isNaN(expires) || expires <= now;
}

/** Whole minutes until the session ends (0 once expired). */
export function minutesLeft(session: Pick<SessionView, "expiresAt">, now: number): number {
  const expires = Date.parse(session.expiresAt);
  if (Number.isNaN(expires)) return 0;
  return Math.max(0, Math.floor((expires - now) / 60_000));
}

/** "47 min left", "23 h left", "expired". */
export function timeLeftLabel(session: Pick<SessionView, "expiresAt">, now: number): string {
  const minutes = minutesLeft(session, now);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h left`;
}

export function hasRole(session: Pick<SessionView, "roles"> | null | undefined, role: SessionRole): boolean {
  return Boolean(session?.roles.includes(role));
}

/** The highest role, for the pill in the top bar. */
export function primaryRole(session: Pick<SessionView, "roles"> | null | undefined): SessionRole | null {
  if (!session) return null;
  if (session.roles.includes("admin")) return "admin";
  if (session.roles.includes("developer")) return "developer";
  return session.roles.includes("user") ? "user" : null;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** "0x7a…c41e". */
export function shortAddress(address: string | null | undefined, head = 4, tail = 4): string {
  if (!address) return "";
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head + 2)}…${address.slice(-tail)}`;
}

/* ------------------------------------------------- SIWE message (EIP-4361) */

export interface SiweFields {
  readonly domain: string;
  readonly address: string;
  readonly statement: string;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
}

/**
 * The EIP-4361 text, built in the browser so its domain and URI are the
 * page's own origin (wallets warn when a sign-in names another site). The
 * server issues the nonce and checks every field before it answers.
 */
export function buildSiweMessage(fields: SiweFields): string {
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
    fields.statement,
    "",
    `URI: ${fields.uri}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ].join("\n");
}

/** Chain id named in the message: the wallet's own when the server serves it, else the first Elysium chain the server lists. */
export function siweChainId(walletChainId: number | null | undefined, allowed: readonly number[]): number | null {
  if (walletChainId && allowed.includes(walletChainId)) return walletChainId;
  for (const preferred of [99801, 99901, 998, 999]) if (allowed.includes(preferred)) return preferred;
  return allowed[0] ?? null;
}

export type SiweCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Refuses to put text in front of the wallet that names another site, another
 * address, a past expiry or no nonce (a defence against a tampered response
 * or a bug). Pure; `host` is the page's `location.host`.
 */
export function checkSiweMessage(message: string, expected: { readonly address: string; readonly host: string; readonly now: number }): SiweCheck {
  const lines = message.split("\n");
  const head = /^(\S+) wants you to sign in with your Ethereum account:$/u.exec(lines[0] ?? "");
  if (!head) return { ok: false, reason: "The sign-in text is not an EIP-4361 message." };
  if (head[1] !== expected.host) return { ok: false, reason: `The sign-in text names ${head[1]}, not this site (${expected.host}).` };
  if (!sameAddress(lines[1]?.trim(), expected.address)) return { ok: false, reason: "The sign-in text names a different address than your wallet." };
  const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;
  const uri = field("URI");
  try {
    if (!uri || new URL(uri).host !== expected.host) return { ok: false, reason: "The sign-in URI is not on this site." };
  } catch {
    return { ok: false, reason: "The sign-in URI is not a URL." };
  }
  const nonce = field("Nonce");
  if (!nonce || !/^[A-Za-z0-9]{8,}$/u.test(nonce)) return { ok: false, reason: "The sign-in text has no valid nonce." };
  const expiry = field("Expiration Time");
  if (expiry && !(Date.parse(expiry) > expected.now)) return { ok: false, reason: "The sign-in text has already expired. Try again." };
  return { ok: true };
}
