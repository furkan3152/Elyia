/**
 * The session as an app page needs it (needs the wagmi providers): the
 * connected wallet, its token when this tab signed in with it, and the
 * sign-in / sign-out actions. Backed by the one session store
 * (sessionStore.ts), so signing in on Ask Ely, Portfolio, the developer
 * portal or the owner console signs in everywhere in this tab. Signing in
 * signs a message, never a transaction.
 */
import { useCallback, useEffect } from "react";
import { useAccount } from "wagmi";

import { useNow } from "../../hooks/useNow";
import { tokenForAddress } from "./sessionModel";
import { signOut as endSession, validateStoredSession } from "./sessionApi";
import { sessionToken, useSessionStore } from "./sessionStore";
import { useSiweSignIn } from "./useSiweSignIn";

export interface WalletSession {
  /** The connected wallet (lower case), null when none. */
  readonly address: string | null;
  /** The session token for the connected wallet, null when not signed in as it. */
  readonly token: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** Runs Sign-In with Ethereum; resolves to the new token, or null (declined, failed, no wallet). */
  signIn(): Promise<string | null>;
  signOut(): void;
}

export function useWalletSession(): WalletSession {
  const { address: connected } = useAccount();
  const siwe = useSiweSignIn();
  const stored = useSessionStore((state) => state.stored);
  const address = connected?.toLowerCase() ?? null;
  // Expiry is re-checked every 30 s here, and by the API (a 401 drops the session).
  const now = useNow(30_000);
  const token = tokenForAddress(stored, address, now);

  useEffect(() => {
    void validateStoredSession();
  }, []);

  const { signIn: run } = siwe;
  const signIn = useCallback(async (): Promise<string | null> => ((await run()) ? sessionToken() : null), [run]);
  const signOut = useCallback(() => void endSession(), []);

  return { address, token, busy: siwe.busy, error: siwe.error, signIn, signOut };
}
