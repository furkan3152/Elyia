/**
 * The wallet session for this tab: token + the server's view of it. Kept in
 * sessionStorage (closing the tab signs out) and re-validated with the API on
 * first use, because roles are the server's to decide. Wallet-free: site pages
 * read it without the wallet stack.
 */
import type { SessionResponse, SessionRole } from "@elyia/core/api/ops";
import { create } from "zustand";

import { readSessionStorage, writeSessionStorage } from "../../app/state/storage";
import { hasRole, isExpired, parseStoredSession, serializeSession, SESSION_STORAGE_KEY, type SessionStatus, type StoredSession } from "./sessionModel";

export interface SessionState {
  readonly stored: StoredSession | null;
  readonly status: SessionStatus;
  /** Set once the API confirmed (or refused) the stored token in this tab. */
  readonly validated: boolean;
  readonly setSession: (response: SessionResponse | StoredSession) => void;
  /** Roles changed on the server (e.g. after registering as a developer). */
  readonly setRoles: (roles: readonly SessionRole[]) => void;
  readonly markValidated: () => void;
  readonly markExpired: () => void;
  readonly clear: () => void;
}

function initial(): StoredSession | null {
  return parseStoredSession(readSessionStorage(SESSION_STORAGE_KEY), Date.now());
}

const first = initial();

export const useSessionStore = create<SessionState>()((set, get) => ({
  stored: first,
  status: first ? "checking" : "anonymous",
  validated: false,
  setSession: (response) => {
    const stored: StoredSession = { token: response.token, session: response.session };
    writeSessionStorage(SESSION_STORAGE_KEY, serializeSession(stored));
    set({ stored, status: "signed-in", validated: true });
  },
  setRoles: (roles) => {
    const current = get().stored;
    if (!current) return;
    const stored: StoredSession = { token: current.token, session: { ...current.session, roles: [...roles] } };
    writeSessionStorage(SESSION_STORAGE_KEY, serializeSession(stored));
    set({ stored });
  },
  markValidated: () => set((state) => ({ validated: true, status: state.stored && !isExpired(state.stored.session, Date.now()) ? "signed-in" : "anonymous" })),
  markExpired: () => {
    writeSessionStorage(SESSION_STORAGE_KEY, "");
    set({ stored: null, status: "expired", validated: true });
  },
  clear: () => {
    writeSessionStorage(SESSION_STORAGE_KEY, "");
    set({ stored: null, status: "anonymous", validated: true });
  },
}));

export function sessionToken(): string | null {
  const stored = useSessionStore.getState().stored;
  return stored && !isExpired(stored.session, Date.now()) ? stored.token : null;
}

export function useSessionRole(role: SessionRole): boolean {
  return useSessionStore((state) => hasRole(state.stored?.session, role));
}
