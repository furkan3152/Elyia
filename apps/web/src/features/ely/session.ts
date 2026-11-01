/**
 * A wallet session for Ely (SIWE, EIP-4361): the wallet signs a sign-in
 * message (a signature, never a transaction), the API answers with a
 * session token sent back as the `Elyia-Session` header. With it Ely stores
 * the thread, turns moves into proposals, and the portfolio's automations
 * can be switched. The token stays in this tab (sessionStorage) and is
 * dropped when the wallet changes.
 */
import type { SessionResponse, SiweNonceResponse } from "@elyia/core/api/ops";
import { SESSION_HEADER } from "@elyia/core/api/ops";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { signMessage } from "wagmi/actions";
import { create } from "zustand";

import { apiFetch, apiPost, describeError, type ApiRequestOptions } from "../../lib/api";

const STORAGE_KEY = "elyia.ely.session.v1";

interface StoredSession {
  readonly address: string;
  readonly token: string;
  readonly expiresAt: string;
}

function readStored(): StoredSession | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.address !== "string" || typeof value.token !== "string" || typeof value.expiresAt !== "string") return null;
    if (Date.parse(value.expiresAt) <= Date.now()) return null;
    return { address: value.address, token: value.token, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

interface SessionState {
  readonly session: StoredSession | null;
  set(session: StoredSession | null): void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  session: readStored(),
  set(session) {
    try {
      if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: the session lives in memory only
    }
    set({ session });
  },
}));

/** The token for `address` (lower case), when this tab signed in with it and it has not expired. */
export function tokenFor(address: string | null | undefined): string | null {
  const session = useSessionStore.getState().session;
  if (!session || !address || session.address !== address.toLowerCase()) return null;
  return Date.parse(session.expiresAt) > Date.now() ? session.token : null;
}

/** apiFetch with the session header. */
export function sessionFetch<T>(path: string, token: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, headers: { ...options.headers, [SESSION_HEADER]: token } });
}

export interface ElySession {
  /** The connected wallet (lower case), null when none. */
  readonly address: string | null;
  /** The session token for the connected wallet, null when not signed in. */
  readonly token: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  signIn(): Promise<string | null>;
  signOut(): void;
}

export function useElySession(): ElySession {
  const config = useConfig();
  const { address: connected, chainId } = useAccount();
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = connected?.toLowerCase() ?? null;
  // Expiry is checked when the session is read from storage and by the API (401 drops it).
  const token = session && address && session.address === address ? session.token : null;

  const signIn = useCallback(async (): Promise<string | null> => {
    if (!connected) {
      setError("Connect a wallet first.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const nonce = await apiPost<SiweNonceResponse>("/v1/auth/siwe/nonce", { address: connected, ...(chainId ? { chainId } : {}) });
      if (!nonce.message) throw new Error("The API did not prepare a sign-in message.");
      const signature = await signMessage(config, { account: connected, message: nonce.message });
      const verified = await apiPost<SessionResponse>("/v1/auth/siwe/verify", { message: nonce.message, signature });
      const next = { address: verified.session.address.toLowerCase(), token: verified.token, expiresAt: verified.session.expiresAt };
      setSession(next);
      return next.token;
    } catch (problem) {
      const text = describeError(problem);
      setError(/user rejected|denied/iu.test(text) ? "You declined the sign-in in your wallet." : text);
      return null;
    } finally {
      setBusy(false);
    }
  }, [config, connected, chainId, setSession]);

  const signOut = useCallback(() => {
    const current = useSessionStore.getState().session;
    if (current) void sessionFetch("/v1/auth/logout", current.token, { method: "POST", body: {} }).catch(() => undefined);
    setSession(null);
  }, [setSession]);

  return { address, token, busy, error, signIn, signOut };
}
