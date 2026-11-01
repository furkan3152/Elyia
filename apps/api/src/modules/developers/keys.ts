/**
 * Developer profiles and API keys.
 *
 * - A developer is a wallet address that registered (`developers/<address>`).
 * - Keys are `ely_` + 40 base62 characters. Only SHA-256(key) is stored
 *   (`api_key_hashes/<hash>` -> key id) plus the last four characters; the
 *   plain key is returned once.
 * - Rotation issues a new secret under the same id; the previous secret keeps
 *   working for a 24 h grace period so deployments can roll over.
 * - Revocation is immediate (both hashes are removed, caches dropped).
 */
import { API_KEY_PREFIX, API_KEY_SCOPES, DEFAULT_KEY_QUOTAS, MAX_KEY_QUOTAS, MAX_KEYS_PER_DEVELOPER, type ApiKeyScope, type ApiKeyView, type DeveloperProfile, type KeyQuotas } from "@elyia/core/api/developers";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { randomBase62, randomHex, sha256Hex } from "../ops/auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";

export const ROTATION_GRACE_MS = 24 * 60 * 60_000;
const KEY_CACHE_MS = 15_000;
const KEY_PATTERN = /^ely_[0-9A-Za-z]{40}$/u;

export interface DeveloperRecord {
  readonly id: string;
  readonly address: string;
  readonly name: string | null;
  readonly createdAt: number;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly developerId: string;
  readonly owner: string;
  readonly name: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly quotas: KeyQuotas;
  readonly hash: string;
  readonly last4: string;
  readonly createdAt: number;
  readonly rotatedAt: number | null;
  readonly revokedAt: number | null;
  readonly lastUsedAt: number | null;
  readonly previousHash: string | null;
  readonly previousExpiresAt: number | null;
}

interface HashEntry {
  readonly keyId: string;
  readonly previous: boolean;
}

export function profileView(record: DeveloperRecord): DeveloperProfile {
  return { id: record.id, address: record.address, name: record.name, createdAt: new Date(record.createdAt).toISOString() };
}

export function keyView(record: ApiKeyRecord): ApiKeyView {
  return {
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    quotas: record.quotas,
    last4: record.last4,
    createdAt: new Date(record.createdAt).toISOString(),
    rotatedAt: iso(record.rotatedAt),
    revokedAt: iso(record.revokedAt),
    lastUsedAt: iso(record.lastUsedAt),
  };
}

export function developerIdFor(address: string): string {
  return `dev_${sha256Hex(`developer:${address.toLowerCase()}`).slice(0, 20)}`;
}

export async function registerDeveloper(ctx: AppContext, address: string, name: string | null): Promise<{ readonly record: DeveloperRecord; readonly created: boolean }> {
  const collection = docs<DeveloperRecord>(ctx, PLATFORM_COLLECTIONS.developers);
  const key = address.toLowerCase();
  const existing = await collection.get(key);
  if (existing) return { record: existing.value, created: false };
  const record: DeveloperRecord = { id: developerIdFor(key), address: key, name, createdAt: ctx.clock.now() };
  const written = await collection.compareAndSet(key, null, record);
  if (!written) return { record: (await collection.get(key))!.value, created: false };
  await docs<{ address: string }>(ctx, PLATFORM_COLLECTIONS.developers).put(`id:${record.id}`, { address: key });
  return { record, created: true };
}

export async function developerByAddress(ctx: AppContext, address: string): Promise<DeveloperRecord | null> {
  return (await docs<DeveloperRecord>(ctx, PLATFORM_COLLECTIONS.developers).get(address.toLowerCase()))?.value ?? null;
}

export async function developerById(ctx: AppContext, id: string): Promise<DeveloperRecord | null> {
  const pointer = (await docs<{ address: string }>(ctx, PLATFORM_COLLECTIONS.developers).get(`id:${id}`))?.value;
  return pointer ? developerByAddress(ctx, pointer.address) : null;
}

/* ----------------------------------------------------------------- keys */

function newSecret(): string {
  return `${API_KEY_PREFIX}${randomBase62(40)}`;
}

export function quotasOf(input: Partial<KeyQuotas> | undefined): KeyQuotas {
  const pick = (name: keyof KeyQuotas) => Math.max(1, Math.min(MAX_KEY_QUOTAS[name], Math.floor(input?.[name] ?? DEFAULT_KEY_QUOTAS[name])));
  return { requestsPerDay: pick("requestsPerDay"), plansPerDay: pick("plansPerDay"), preparesPerDay: pick("preparesPerDay"), requestsPerMinute: pick("requestsPerMinute") };
}

export async function listKeys(ctx: AppContext, developerId: string): Promise<ApiKeyRecord[]> {
  const rows = await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).list({ prefix: `${developerId}:`, limit: 1_000 });
  return rows.map((row) => row.value).sort((a, b) => a.createdAt - b.createdAt);
}

export async function createKey(
  ctx: AppContext,
  developer: DeveloperRecord,
  input: { readonly name: string; readonly scopes?: readonly ApiKeyScope[]; readonly quotas?: Partial<KeyQuotas> },
): Promise<{ readonly record: ApiKeyRecord; readonly plainKey: string }> {
  const active = (await listKeys(ctx, developer.id)).filter((key) => key.revokedAt === null);
  if (active.length >= MAX_KEYS_PER_DEVELOPER) throw new ElyiaHttpError("KEY_LIMIT", 409, `At most ${MAX_KEYS_PER_DEVELOPER} active keys per developer. Revoke one first.`);
  const plainKey = newSecret();
  const scopes = [...new Set(input.scopes && input.scopes.length > 0 ? input.scopes : (["read", "plan"] as ApiKeyScope[]))].filter((scope) => API_KEY_SCOPES.includes(scope));
  const record: ApiKeyRecord = {
    id: `key_${randomHex(12)}`,
    developerId: developer.id,
    owner: developer.address,
    name: input.name,
    scopes,
    quotas: quotasOf(input.quotas),
    hash: sha256Hex(plainKey),
    last4: plainKey.slice(-4),
    createdAt: ctx.clock.now(),
    rotatedAt: null,
    revokedAt: null,
    lastUsedAt: null,
    previousHash: null,
    previousExpiresAt: null,
  };
  await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).put(`${developer.id}:${record.id}`, record);
  await docs<HashEntry>(ctx, PLATFORM_COLLECTIONS.apiKeyHashes).put(record.hash, { keyId: `${developer.id}:${record.id}`, previous: false });
  return { record, plainKey };
}

async function ownKey(ctx: AppContext, developerId: string, keyId: string): Promise<{ readonly record: ApiKeyRecord; readonly version: number }> {
  const doc = await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).get(`${developerId}:${keyId}`);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such key.");
  return { record: doc.value, version: doc.version };
}

export async function rotateKey(ctx: AppContext, developerId: string, keyId: string): Promise<{ readonly record: ApiKeyRecord; readonly plainKey: string }> {
  const { record } = await ownKey(ctx, developerId, keyId);
  if (record.revokedAt !== null) throw new ElyiaHttpError("KEY_REVOKED", 409, "A revoked key cannot be rotated.");
  const now = ctx.clock.now();
  const plainKey = newSecret();
  const hashes = docs<HashEntry>(ctx, PLATFORM_COLLECTIONS.apiKeyHashes);
  if (record.previousHash) await hashes.delete(record.previousHash);
  const next: ApiKeyRecord = { ...record, hash: sha256Hex(plainKey), last4: plainKey.slice(-4), rotatedAt: now, previousHash: record.hash, previousExpiresAt: now + ROTATION_GRACE_MS };
  await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).put(`${developerId}:${keyId}`, next);
  await hashes.put(next.hash, { keyId: `${developerId}:${keyId}`, previous: false });
  await hashes.put(record.hash, { keyId: `${developerId}:${keyId}`, previous: true }, { ttlMs: ROTATION_GRACE_MS });
  forgetKeyCache();
  return { record: next, plainKey };
}

export async function revokeKey(ctx: AppContext, developerId: string, keyId: string): Promise<ApiKeyRecord> {
  const { record } = await ownKey(ctx, developerId, keyId);
  if (record.revokedAt !== null) return record;
  const next: ApiKeyRecord = { ...record, revokedAt: ctx.clock.now(), previousHash: null, previousExpiresAt: null };
  await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).put(`${developerId}:${keyId}`, next);
  const hashes = docs<HashEntry>(ctx, PLATFORM_COLLECTIONS.apiKeyHashes);
  await hashes.delete(record.hash);
  if (record.previousHash) await hashes.delete(record.previousHash);
  forgetKeyCache();
  return next;
}

/* --------------------------------------------------------------- lookup */

const cache = new Map<string, { readonly record: ApiKeyRecord | null; readonly at: number }>();

export function forgetKeyCache(): void {
  cache.clear();
}

export function looksLikeKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** The live key record of a presented secret, or null (unknown, revoked, expired grace). */
export async function lookupKey(ctx: AppContext, plainKey: string): Promise<ApiKeyRecord | null> {
  if (!looksLikeKey(plainKey)) return null;
  const hash = sha256Hex(plainKey);
  const now = ctx.clock.now();
  const cached = cache.get(hash);
  if (cached && now - cached.at < KEY_CACHE_MS) return cached.record;
  const entry = (await docs<HashEntry>(ctx, PLATFORM_COLLECTIONS.apiKeyHashes).get(hash))?.value;
  let record: ApiKeyRecord | null = null;
  if (entry) {
    const doc = (await docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys).get(entry.keyId))?.value ?? null;
    const valid = doc && doc.revokedAt === null && (entry.previous ? doc.previousHash === hash && (doc.previousExpiresAt ?? 0) > now : doc.hash === hash);
    record = valid ? doc : null;
  }
  cache.set(hash, { record, at: now });
  if (cache.size > 10_000) cache.delete(cache.keys().next().value as string);
  return record;
}

const touched = new Map<string, number>();

/** Updates lastUsedAt at most once a minute per key (fire and forget). */
export function touchKey(ctx: AppContext, record: ApiKeyRecord): void {
  const now = ctx.clock.now();
  if ((touched.get(record.id) ?? 0) > now - 60_000) return;
  touched.set(record.id, now);
  const collection = docs<ApiKeyRecord>(ctx, PLATFORM_COLLECTIONS.apiKeys);
  void collection
    .get(`${record.developerId}:${record.id}`)
    .then((doc) => (doc && doc.value.revokedAt === null ? collection.compareAndSet(doc.id, doc.version, { ...doc.value, lastUsedAt: now }) : null))
    .catch(() => undefined);
}
