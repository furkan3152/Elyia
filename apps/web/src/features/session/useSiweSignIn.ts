/**
 * Sign-In with Ethereum, wallet side (needs the wagmi providers). The flow:
 * the API issues a nonce, the page builds the EIP-4361 text for its own
 * origin, checks it, the wallet signs it (a message, never a transaction),
 * and the API verifies it and returns the session token.
 */
import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { describeError } from "../../lib/api";
import { buildSiweMessage, checkSiweMessage, siweChainId } from "./sessionModel";
import { requestNonce, verifySignIn } from "./sessionApi";
import { useSessionStore } from "./sessionStore";

export type SignInPhase = "idle" | "nonce" | "wallet" | "verify" | "error";

export function useSiweSignIn() {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [phase, setPhase] = useState<SignInPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!address) return false;
    setError(null);
    try {
      setPhase("nonce");
      const nonce = await requestNonce(address, null);
      const chain = siweChainId(chainId, nonce.chainIds);
      if (!chain) throw new Error("The API serves no chain this wallet can sign in on.");
      const host = window.location.host;
      const message = buildSiweMessage({
        domain: host,
        address,
        statement: nonce.statement,
        uri: window.location.origin,
        chainId: chain,
        nonce: nonce.nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: nonce.expiresAt,
      });
      const check = checkSiweMessage(message, { address, host, now: Date.now() });
      if (!check.ok) throw new Error(check.reason);
      setPhase("wallet");
      const signature = await signMessageAsync({ account: address, message });
      setPhase("verify");
      const session = await verifySignIn(message, signature);
      useSessionStore.getState().setSession(session);
      setPhase("idle");
      return true;
    } catch (caught) {
      const text = caught instanceof Error && /reject|denied|cancel/iu.test(caught.message) ? "You declined the signature. Nothing was signed." : describeError(caught);
      setError(text);
      setPhase("error");
      return false;
    }
  }, [address, chainId, signMessageAsync]);

  return { address: address ?? null, chainId: chainId ?? null, isConnected, phase, error, signIn, busy: phase === "nonce" || phase === "wallet" || phase === "verify" } as const;
}
