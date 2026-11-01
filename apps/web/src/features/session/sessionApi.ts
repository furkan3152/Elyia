/**
 * Session endpoints and the authed fetch: every call made on behalf of a
 * signed-in wallet carries the `Elyia-Session` header (never a cookie). A 401
 * clears the session so the page falls back to its signed-out state.
 */
import { SESSION_HEADER, type SessionResponse, type SessionView, type SiweNonceResponse } from "@elyia/core/api/ops";
import { useEffect } from "react";

import { apiFetch, ApiError, type ApiRequestOptions } from "../../lib/api";
import { readSessionResponse, readSessionView } from "./sessionModel";
import { sessionToken, useSessionStore } from "./sessionStore";

export function requestNonce(address: string, chainId: number | null): Promise<SiweNonceResponse> {
  return apiFetch<SiweNonceResponse>("/v1/auth/siwe/nonce", { method: "POST", body: chainId ? { address, chainId } : { address } });
}

export async function verifySignIn(message: string, signature: string): Promise<SessionResponse> {
  const response = await apiFetch<unknown>("/v1/auth/siwe/verify", { method: "POST", body: { message, signature } });
  const stored = readSessionResponse(response);
  if (!stored) throw new ApiError({ code: "INVALID_RESPONSE", message: "The API answered the sign-in with something Elyia could not read." });
  return stored;
}

/** Calls the API as the signed-in wallet. Throws `NO_SESSION` when signed out; a 401 ends the local session. */
export async function authedFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = sessionToken();
  if (!token) throw new ApiError({ code: "NO_SESSION", message: "Sign in with your wallet first.", status: 401 });
  try {
    return await apiFetch<T>(path, { ...options, headers: { ...options.headers, [SESSION_HEADER]: token } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) useSessionStore.getState().markExpired();
    throw error;
  }
}

export async function fetchSessionView(): Promise<SessionView> {
  const view = readSessionView(await authedFetch<unknown>("/v1/auth/session"));
  if (!view) throw new ApiError({ code: "INVALID_RESPONSE", message: "The API sent a session Elyia could not read." });
  return view;
}

export async function signOut(): Promise<void> {
  const token = sessionToken();
  useSessionStore.getState().clear();
  if (!token) return;
  // Revoke server side too; a failure only means the token expires on its own.
  await apiFetch("/v1/auth/logout", { method: "POST", body: {}, headers: { [SESSION_HEADER]: token } }).catch(() => undefined);
}

let validating: Promise<void> | null = null;

/** Re-reads the stored session's roles from the API once per tab (roles are the server's to decide). */
export function validateStoredSession(): Promise<void> {
  const state = useSessionStore.getState();
  if (state.validated || !state.stored) {
    if (!state.validated) state.markValidated();
    return Promise.resolve();
  }
  validating ??= fetchSessionView()
    .then((view) => {
      useSessionStore.getState().setRoles(view.roles);
      useSessionStore.getState().markValidated();
    })
    .catch((error: unknown) => {
      // 401 already cleared it; an unreachable API keeps the copy (labelled as unchecked) until it answers.
      if (!(error instanceof ApiError && error.status === 401)) useSessionStore.getState().markValidated();
    })
    .finally(() => {
      validating = null;
    });
  return validating;
}

/** The session for rendering, validated with the API once per tab. */
export function useSession() {
  const stored = useSessionStore((state) => state.stored);
  const status = useSessionStore((state) => state.status);
  const validated = useSessionStore((state) => state.validated);
  useEffect(() => {
    void validateStoredSession();
  }, []);
  return { session: stored?.session ?? null, status, validated, signedIn: status === "signed-in" || status === "checking" } as const;
}
