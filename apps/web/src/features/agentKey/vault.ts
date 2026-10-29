/**
 * The agent-key vault: the trade-only agent key lives only in this browser,
 * encrypted at rest.
 *
 * - One AES-GCM-256 wrapping key per browser profile, generated with
 *   `extractable: false`: JavaScript can use it but never read its bytes, so
 *   a copied IndexedDB file or disk backup cannot decrypt anything. It is
 *   stored in IndexedDB as a CryptoKey object (structured clone).
 * - Each agent key is encrypted with a fresh 96-bit IV, and the record's
 *   identity (environment, master account, agent address) is bound as
 *   additional authenticated data, so records cannot be swapped.
 * - The decrypted key is held in memory only while the terminal is unlocked
 *   (see agentSession.ts); "Lock" forgets it until the user unlocks again.
 *
 * Known limit: code running inside the Elyia page itself could
 * use the key while the page is open. The key can only trade (HyperCore
 * forbids agents to withdraw or transfer) and every signature first passes
 * the Rule Book.
 */
import { idbRequest, inTransaction, openDatabase } from "./idb";

export const VAULT_DB = "elyia-agent-vault";
const VAULT_VERSION = 1;
const KEYS_STORE = "wrapKeys";
const AGENTS_STORE = "agents";
const WRAP_KEY_ID = "aes-gcm-v1";

export type VaultEnv = "testnet" | "mainnet";

export interface AgentRecordMeta {
  /** `${env}:${master}`. */
  readonly id: string;
  readonly env: VaultEnv;
  /** Lower-case master (the user's wallet) address. */
  readonly master: string;
  /** Lower-case agent address. */
  readonly agentAddress: string;
  /** Full HyperCore agent name, `elyia-web valid_until <ms>`. */
  readonly name: string;
  readonly validUntil: number;
  readonly createdAt: number;
  /** "pending" until HyperCore confirms the approval. */
  readonly status: "pending" | "active";
  /** The user locked the terminal: do not decrypt until they unlock. */
  readonly locked: boolean;
  /** "Chrome on macOS": shown in the per-device listing. */
  readonly deviceLabel: string;
}

interface AgentRecord extends AgentRecordMeta {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: ArrayBuffer;
}

export interface VaultDeps {
  readonly indexedDB?: IDBFactory | null;
  readonly subtle?: SubtleCrypto | null;
  readonly getRandomValues?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
  readonly now?: () => number;
  readonly deviceLabel?: string;
}

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

export function recordId(env: VaultEnv, master: string): string {
  return `${env}:${master.toLowerCase()}`;
}

function aad(env: VaultEnv, master: string, agentAddress: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`elyia.agent/v1|${env}|${master.toLowerCase()}|${agentAddress.toLowerCase()}`);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/u.test(body)) throw new Error("An agent key is 32 bytes of hex.");
  const out = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) out[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

function strip(record: AgentRecord): AgentRecordMeta {
  return {
    id: record.id,
    env: record.env,
    master: record.master,
    agentAddress: record.agentAddress,
    name: record.name,
    validUntil: record.validUntil,
    createdAt: record.createdAt,
    status: record.status,
    locked: record.locked,
    deviceLabel: record.deviceLabel,
  };
}

/** "Firefox on Windows" from a user agent string (best effort, never identifying). */
export function deviceLabelFrom(userAgent: string): string {
  const ua = userAgent || "";
  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /OPR\//u.test(ua)
      ? "Opera"
      : /Firefox\//u.test(ua)
        ? "Firefox"
        : /Chrome\//u.test(ua)
          ? "Chrome"
          : /Safari\//u.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad/u.test(ua) ? "iOS" : /Android/u.test(ua) ? "Android" : /Mac OS X/u.test(ua) ? "macOS" : /Windows/u.test(ua) ? "Windows" : /Linux/u.test(ua) ? "Linux" : "this device";
  return `${browser} on ${os}`;
}

export class AgentVault {
  private readonly factory: IDBFactory | null;
  private readonly subtle: SubtleCrypto | null;
  private readonly random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
  private readonly now: () => number;
  private readonly deviceLabel: string;
  private db: Promise<IDBDatabase> | null = null;

  constructor(deps: VaultDeps = {}) {
    this.factory = deps.indexedDB === undefined ? safeIndexedDb() : deps.indexedDB;
    this.subtle = deps.subtle === undefined ? (globalThis.crypto?.subtle ?? null) : deps.subtle;
    this.random = deps.getRandomValues ?? ((bytes) => globalThis.crypto.getRandomValues(bytes));
    this.now = deps.now ?? (() => Date.now());
    this.deviceLabel = deps.deviceLabel ?? (typeof navigator === "undefined" ? "this device" : deviceLabelFrom(navigator.userAgent));
  }

  /** Why the vault cannot work here, or null when it can. */
  unavailableReason(): string | null {
    if (!this.subtle) return "This browser has no WebCrypto (a secure https page is required), so Elyia cannot keep a trading key safely here.";
    if (!this.factory) return "This browser blocks site storage (IndexedDB), so Elyia cannot keep a trading key here. Allow site data or use another browser.";
    return null;
  }

  private assertAvailable(): { readonly factory: IDBFactory; readonly subtle: SubtleCrypto } {
    const reason = this.unavailableReason();
    if (reason || !this.factory || !this.subtle) throw new VaultUnavailableError(reason ?? "The vault is unavailable.");
    return { factory: this.factory, subtle: this.subtle };
  }

  private open(): Promise<IDBDatabase> {
    const { factory } = this.assertAvailable();
    if (!this.db) {
      this.db = openDatabase(factory, VAULT_DB, VAULT_VERSION, (db) => {
        if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE);
        if (!db.objectStoreNames.contains(AGENTS_STORE)) db.createObjectStore(AGENTS_STORE);
      }).catch((error: unknown) => {
        this.db = null;
        throw new VaultUnavailableError(error instanceof Error ? `The key vault could not open: ${error.message}` : "The key vault could not open.");
      });
    }
    return this.db;
  }

  /** The browser's non-extractable wrapping key, created on first use. */
  private async wrapKey(): Promise<CryptoKey> {
    const { subtle } = this.assertAvailable();
    const db = await this.open();
    const existing = await inTransaction(db, KEYS_STORE, "readonly", (tx) => idbRequest(tx.objectStore(KEYS_STORE).get(WRAP_KEY_ID) as IDBRequest<CryptoKey | undefined>));
    if (existing) return existing;
    const created = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // Another tab may have raced us: keep whichever key landed first.
    return inTransaction(db, KEYS_STORE, "readwrite", async (tx) => {
      const store = tx.objectStore(KEYS_STORE);
      const raced = await idbRequest(store.get(WRAP_KEY_ID) as IDBRequest<CryptoKey | undefined>);
      if (raced) return raced;
      await idbRequest(store.put(created, WRAP_KEY_ID));
      return created;
    });
  }

  /** Encrypts and stores an agent key (replacing this account's previous one on this device). */
  async save(input: { readonly env: VaultEnv; readonly master: string; readonly agentAddress: string; readonly privateKey: `0x${string}`; readonly name: string; readonly validUntil: number; readonly status: "pending" | "active" }): Promise<AgentRecordMeta> {
    const { subtle } = this.assertAvailable();
    const key = await this.wrapKey();
    const iv = this.random(new Uint8Array(12));
    const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(input.env, input.master, input.agentAddress) }, key, hexToBytes(input.privateKey));
    const record: AgentRecord = {
      id: recordId(input.env, input.master),
      env: input.env,
      master: input.master.toLowerCase(),
      agentAddress: input.agentAddress.toLowerCase(),
      name: input.name,
      validUntil: input.validUntil,
      createdAt: this.now(),
      status: input.status,
      locked: false,
      deviceLabel: this.deviceLabel,
      iv,
      ciphertext,
    };
    const db = await this.open();
    await inTransaction(db, AGENTS_STORE, "readwrite", (tx) => idbRequest(tx.objectStore(AGENTS_STORE).put(record, record.id)));
    return strip(record);
  }

  private async record(env: VaultEnv, master: string): Promise<AgentRecord | null> {
    const db = await this.open();
    const record = await inTransaction(db, AGENTS_STORE, "readonly", (tx) => idbRequest(tx.objectStore(AGENTS_STORE).get(recordId(env, master)) as IDBRequest<AgentRecord | undefined>));
    return record ?? null;
  }

  /** What is stored for this account (never the key). */
  async load(env: VaultEnv, master: string): Promise<AgentRecordMeta | null> {
    const record = await this.record(env, master);
    return record ? strip(record) : null;
  }

  /** Decrypts this account's agent key. Throws when it is missing or cannot be authenticated. */
  async decrypt(env: VaultEnv, master: string): Promise<{ readonly meta: AgentRecordMeta; readonly privateKey: `0x${string}` }> {
    const { subtle } = this.assertAvailable();
    const record = await this.record(env, master);
    if (!record) throw new Error("No trading key is stored for this account on this device.");
    const key = await this.wrapKey();
    let plain: ArrayBuffer;
    try {
      plain = await subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: aad(record.env, record.master, record.agentAddress) }, key, record.ciphertext);
    } catch {
      throw new Error("The stored trading key could not be decrypted on this device (the browser's key store was reset). Enable trading again.");
    }
    return { meta: strip(record), privateKey: bytesToHex(new Uint8Array(plain)) };
  }

  async update(env: VaultEnv, master: string, patch: { readonly status?: "pending" | "active"; readonly locked?: boolean }): Promise<AgentRecordMeta | null> {
    const db = await this.open();
    return inTransaction(db, AGENTS_STORE, "readwrite", async (tx) => {
      const store = tx.objectStore(AGENTS_STORE);
      const record = (await idbRequest(store.get(recordId(env, master)) as IDBRequest<AgentRecord | undefined>)) ?? null;
      if (!record) return null;
      const next: AgentRecord = { ...record, ...(patch.status !== undefined ? { status: patch.status } : {}), ...(patch.locked !== undefined ? { locked: patch.locked } : {}) };
      await idbRequest(store.put(next, next.id));
      return strip(next);
    });
  }

  /** Deletes this account's key from this device. */
  async remove(env: VaultEnv, master: string): Promise<void> {
    const db = await this.open();
    await inTransaction(db, AGENTS_STORE, "readwrite", (tx) => idbRequest(tx.objectStore(AGENTS_STORE).delete(recordId(env, master))));
  }

  /** Every account with a key on this device. */
  async list(): Promise<AgentRecordMeta[]> {
    const db = await this.open();
    const records = await inTransaction(db, AGENTS_STORE, "readonly", (tx) => idbRequest(tx.objectStore(AGENTS_STORE).getAll() as IDBRequest<AgentRecord[]>));
    return records.map(strip).sort((a, b) => b.createdAt - a.createdAt);
  }
}

function safeIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    return null;
  }
}
