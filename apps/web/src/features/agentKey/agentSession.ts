/**
 * Agent-key sessions: what the UI shows (a zustand store) and the decrypted
 * keys themselves (a module-level map that never enters React state, the
 * store, storage or logs). "Lock" deletes the in-memory key; only the
 * encrypted copy in the vault remains.
 */
import type { NetworkEnvironment } from "@elyia/core/networks";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { create } from "zustand";

import { readStorage, writeStorage } from "../../app/state/storage";
import { NonceManager } from "./nonce";
import type { AgentSignerDeps } from "./signer";
import { AgentVault, recordId, type AgentRecordMeta } from "./vault";

export type AgentPhase =
  /** No IndexedDB or WebCrypto here. */
  | "unsupported"
  | "loading"
  /** No key on this device for this account. */
  | "none"
  /** A key is stored but the user locked the terminal. */
  | "locked"
  /** Decrypted in memory: orders can be signed. */
  | "ready"
  /** Past its valid_until: HyperCore prunes it; enable trading again (nothing is decrypted). */
  | "expired"
  | "error";

export interface AgentSession {
  readonly phase: AgentPhase;
  readonly meta: AgentRecordMeta | null;
  readonly error: string | null;
}

export const EMPTY_SESSION: AgentSession = Object.freeze({ phase: "loading", meta: null, error: null });

interface AgentStoreState {
  readonly sessions: Readonly<Record<string, AgentSession>>;
  /** One-click mode: sign straight from the ticket button, without the review step. Session only, never persisted. */
  readonly oneClick: boolean;
  setSession(id: string, session: AgentSession): void;
  setOneClick(on: boolean): void;
}

export const useAgentStore = create<AgentStoreState>()((set) => ({
  sessions: {},
  oneClick: false,
  setSession: (id, session) => set((state) => ({ sessions: { ...state.sessions, [id]: session } })),
  setOneClick: (oneClick) => set({ oneClick }),
}));

export function sessionId(env: NetworkEnvironment, master: string): string {
  return recordId(env, master);
}

interface Unlocked {
  readonly account: PrivateKeyAccount;
  readonly nonces: NonceManager;
  readonly meta: AgentRecordMeta;
}

const unlocked = new Map<string, Unlocked>();

let vaultInstance: AgentVault | null = null;

export function agentVault(): AgentVault {
  if (!vaultInstance) vaultInstance = new AgentVault();
  return vaultInstance;
}

const nonceStorage = { get: readStorage, set: writeStorage };

/** Puts a decrypted key in memory for signing. */
export function holdKey(id: string, meta: AgentRecordMeta, privateKey: `0x${string}`): void {
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== meta.agentAddress.toLowerCase()) throw new Error("The stored key does not match its record.");
  unlocked.set(id, { account, nonces: new NonceManager(account.address, nonceStorage), meta });
}

/** Forgets a decrypted key (Lock, revoke, account switch). */
export function dropKey(id: string): void {
  unlocked.delete(id);
}

export function dropAllKeys(): void {
  unlocked.clear();
}

/** Signing dependencies for an unlocked session, or null while locked or absent. */
export function signerFor(id: string, isMainnet: boolean, now: number = Date.now()): (AgentSignerDeps & { readonly address: string; readonly meta: AgentRecordMeta }) | null {
  const entry = unlocked.get(id);
  if (!entry) return null;
  // An expired key is forgotten, never used.
  if (isExpired(entry.meta, now)) {
    unlocked.delete(id);
    return null;
  }
  return {
    address: entry.account.address,
    meta: entry.meta,
    isMainnet,
    nonces: entry.nonces,
    validUntil: entry.meta.validUntil,
    signTypedData: (typedData) =>
      entry.account.signTypedData(typedData as unknown as Parameters<PrivateKeyAccount["signTypedData"]>[0]),
  };
}

/** True once a key is past its HyperCore expiry. */
export function isExpired(meta: Pick<AgentRecordMeta, "validUntil">, now: number): boolean {
  return Number.isFinite(meta.validUntil) && meta.validUntil <= now;
}

export function isHeld(id: string): boolean {
  return unlocked.has(id);
}
