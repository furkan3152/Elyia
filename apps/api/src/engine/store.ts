/**
 * Persistence of intents on the shared document store (ctx.store):
 * - `intents`: the graph, written with compare-and-set on the store version
 *   (a concurrent writer gets INTENT_CONFLICT, never a lost update);
 * - `intent_claims`: one row per submitted reference (`<caip2>:tx:<hash>`,
 *   `:cloid:`, `:nonce:`), created with compare-and-set on "absent", so a
 *   reference completes at most one step across every intent;
 * - `intent_clients`: clientReference -> intent id (idempotent create);
 * - `intent_active`: intents the poller follows (removed once terminal);
 * - `intent_spend`: per-owner rolling ledger of started intents' USD value,
 *   the Rule Book's daily / weekly window.
 */
import type { IntentGraph } from "@elyia/core";
import type { Clock } from "../clock.js";
import type { Collection, JsonValue, Store } from "../store/types.js";
import { engineError } from "./errors.js";

/** Stored intents live 90 days after their last write (long withdrawals included). */
export const INTENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CAS_ATTEMPTS = 4;

export interface StoredIntent {
  readonly graph: IntentGraph;
  readonly version: number;
}

export interface ClaimRecord {
  readonly intentId: string;
  readonly stepId: string;
  readonly at: number;
}

interface SpendEntry {
  readonly id: string;
  readonly at: number;
  /** Micro-USD (decimal string). */
  readonly usd: string;
}

export class IntentStore {
  private readonly intents: Collection<JsonValue>;
  private readonly claims: Collection<JsonValue>;
  private readonly clients: Collection<JsonValue>;
  private readonly active: Collection<JsonValue>;
  private readonly spend: Collection<JsonValue>;

  constructor(
    store: Store,
    private readonly clock: Clock,
  ) {
    this.intents = store.collection<JsonValue>("intents");
    this.claims = store.collection<JsonValue>("intent_claims");
    this.clients = store.collection<JsonValue>("intent_clients");
    this.active = store.collection<JsonValue>("intent_active");
    this.spend = store.collection<JsonValue>("intent_spend");
  }

  async get(id: string): Promise<StoredIntent | null> {
    const doc = await this.intents.get(id);
    return doc ? { graph: doc.value as unknown as IntentGraph, version: doc.version } : null;
  }

  async require(id: string): Promise<StoredIntent> {
    const found = await this.get(id);
    if (!found) throw engineError("INTENT_NOT_FOUND");
    return found;
  }

  async create(graph: IntentGraph, clientReference?: string): Promise<{ readonly stored: StoredIntent; readonly replayed: boolean }> {
    if (clientReference) {
      const key = `${graph.accounts[0]?.split(":").pop()?.toLowerCase() ?? "anon"}:${clientReference}`;
      const claimed = await this.clients.compareAndSet(key, null, { intentId: graph.id }, { ttlMs: INTENT_TTL_MS });
      if (!claimed) {
        const existing = await this.clients.get(key);
        const id = (existing?.value as { intentId?: string } | null)?.intentId;
        const earlier = id ? await this.get(id) : null;
        if (earlier) return { stored: earlier, replayed: true };
        throw engineError("CLIENT_REFERENCE_EXISTS");
      }
    }
    const doc = await this.intents.compareAndSet(graph.id, null, graph as unknown as JsonValue, { ttlMs: INTENT_TTL_MS });
    if (!doc) throw engineError("INTENT_CONFLICT");
    await this.active.put(graph.id, { since: this.clock.now() }, { ttlMs: INTENT_TTL_MS });
    return { stored: { graph, version: doc.version }, replayed: false };
  }

  /** Writes `graph` if the stored version is still `version`; INTENT_CONFLICT otherwise. */
  async save(graph: IntentGraph, version: number): Promise<StoredIntent> {
    const doc = await this.intents.compareAndSet(graph.id, version, graph as unknown as JsonValue, { ttlMs: INTENT_TTL_MS });
    if (!doc) throw engineError("INTENT_CONFLICT");
    return { graph, version: doc.version };
  }

  /**
   * Read-modify-write with retries: `mutate` returns the new graph, or null
   * to leave the intent unchanged. Retries only on version conflicts.
   */
  async update(id: string, mutate: (current: StoredIntent) => Promise<IntentGraph | null> | IntentGraph | null): Promise<StoredIntent> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const current = await this.require(id);
      const next = await mutate(current);
      if (!next) return current;
      const doc = await this.intents.compareAndSet(id, current.version, next as unknown as JsonValue, { ttlMs: INTENT_TTL_MS });
      if (doc) return { graph: next, version: doc.version };
    }
    throw engineError("INTENT_CONFLICT");
  }

  /** Claims a reference for one step; true when it is (now or already) this step's. */
  async claim(key: string, intentId: string, stepId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly owner: ClaimRecord }> {
    const record: ClaimRecord = { intentId, stepId, at: this.clock.now() };
    const created = await this.claims.compareAndSet(key, null, record as unknown as JsonValue);
    if (created) return { ok: true };
    const existing = (await this.claims.get(key))?.value as unknown as ClaimRecord | undefined;
    if (existing && existing.intentId === intentId && existing.stepId === stepId) return { ok: true };
    if (!existing) return this.claim(key, intentId, stepId);
    return { ok: false, owner: existing };
  }

  /** Releases a claim this step holds (a reference that turned out not to be the step's). */
  async releaseClaim(key: string, intentId: string, stepId: string): Promise<void> {
    const doc = await this.claims.get(key);
    const owner = doc?.value as unknown as ClaimRecord | undefined;
    if (doc && owner?.intentId === intentId && owner.stepId === stepId) await this.claims.delete(key);
  }

  async claimOwner(key: string): Promise<ClaimRecord | null> {
    return ((await this.claims.get(key))?.value as unknown as ClaimRecord | undefined) ?? null;
  }

  async activeIds(limit = 500): Promise<string[]> {
    return (await this.active.list({ limit })).map((doc) => doc.id);
  }

  async deactivate(id: string): Promise<void> {
    await this.active.delete(id);
  }

  async activate(id: string): Promise<void> {
    await this.active.put(id, { since: this.clock.now() }, { ttlMs: INTENT_TTL_MS });
  }

  /** Counts an intent's USD value once, when its first step is prepared. */
  async recordSpend(owner: string, intentId: string, usdMicros: bigint): Promise<void> {
    const key = owner.toLowerCase();
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const doc = await this.spend.get(key);
      const now = this.clock.now();
      const entries = ((doc?.value as { entries?: SpendEntry[] } | null)?.entries ?? []).filter((entry) => now - entry.at < WEEK_MS);
      if (entries.some((entry) => entry.id === intentId)) return;
      entries.push({ id: intentId, at: now, usd: usdMicros.toString() });
      const written = await this.spend.compareAndSet(key, doc?.version ?? null, { entries: entries.slice(-500) } as unknown as JsonValue, { ttlMs: WEEK_MS });
      if (written) return;
    }
    throw engineError("INTENT_CONFLICT");
  }

  /** Rolling 24 h / 7 day USD already counted for `owner`, excluding `exclude`. */
  async usage(owner: string, exclude: string): Promise<{ readonly dayUsdMicros: bigint; readonly weekUsdMicros: bigint }> {
    const doc = await this.spend.get(owner.toLowerCase());
    const now = this.clock.now();
    let day = 0n;
    let week = 0n;
    for (const entry of (doc?.value as { entries?: SpendEntry[] } | null)?.entries ?? []) {
      if (entry.id === exclude || now - entry.at >= WEEK_MS) continue;
      const usd = BigInt(entry.usd);
      week += usd;
      if (now - entry.at < DAY_MS) day += usd;
    }
    return { dayUsdMicros: day, weekUsdMicros: week };
  }

  async hasSpend(owner: string, intentId: string): Promise<boolean> {
    const doc = await this.spend.get(owner.toLowerCase());
    return ((doc?.value as { entries?: SpendEntry[] } | null)?.entries ?? []).some((entry) => entry.id === intentId);
  }
}
