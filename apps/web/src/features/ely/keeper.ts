/**
 * Keeper mode (opt-in Autopilot), wallet side. The server makes a fresh
 * trade-only key and returns ONLY its address plus what the owner signs:
 * HyperCore `approveAgent` typed data, named and capped (per order, per day,
 * reduce-only, expiry). The owner's wallet signs it and the browser sends
 * it to HyperCore; the server then checks the chain and activates. Revoking
 * deletes the key at once and returns what to sign to revoke on chain too.
 * Nothing here signs without the person pressing the button.
 */
import type { KeeperLimits, KeeperPrepareResponse, KeeperRevokeResponse, KeeperStatusResponse } from "@elyia/core/api/agent";
import { buildExchangeRequest } from "@elyia/core/hypercore/signing";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useConfig } from "wagmi";
import { getAccount, signTypedData } from "wagmi/actions";

import { useUiStore } from "../../app/state/uiStore";
import { describeError } from "../../lib/api";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { exchangeError, postExchange } from "../../lib/hypercore/exchangeClient";
import { sessionFetch } from "../session/sessionApi";

export type KeeperStep = "idle" | "prepare" | "sign" | "submit" | "activate" | "done" | "error";

interface TypedData {
  readonly domain: Record<string, unknown>;
  readonly types: Record<string, { name: string; type: string }[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
}

export function useKeeperFlow(token: string | null) {
  const config = useConfig();
  const mode = useUiStore((state) => state.mode);
  const client = useQueryClient();
  const [step, setStep] = useState<KeeperStep>("idle");
  const [error, setError] = useState<string | null>(null);

  const signAndSend = async (action: Readonly<Record<string, unknown>>, typed: unknown) => {
    const account = getAccount(config);
    if (!account.address) throw new Error("Connect the wallet that owns this account.");
    const data = typed as TypedData;
    setStep("sign");
    const signature = await signTypedData(config, { account: account.address, domain: { ...data.domain }, types: data.types, primaryType: data.primaryType, message: { ...data.message } });
    setStep("submit");
    const nonce = Number((action as { nonce?: unknown }).nonce);
    const response = await postExchange(hyperCoreEndpoints(mode).exchangeUrl, buildExchangeRequest({ action: action as never, nonce, signature }));
    if (response.status === "err") throw exchangeError(response.response);
  };

  const enable = async (input: { readonly days: number; readonly limits: Partial<KeeperLimits> }) => {
    if (!token) return;
    setError(null);
    try {
      setStep("prepare");
      const chainId = getAccount(config).chainId;
      const prepared = await sessionFetch<KeeperPrepareResponse>("/v1/agent/keeper/prepare", token, { method: "POST", body: { realm: "hypercore", days: input.days, limits: input.limits, ...(chainId ? { signatureChainId: chainId } : {}) }, timeoutMs: 20_000 });
      if (prepared.sign.kind !== "hypercore-approve-agent") throw new Error(prepared.sign.note);
      await signAndSend(prepared.sign.action, prepared.sign.typedData);
      setStep("activate");
      await sessionFetch<KeeperStatusResponse>("/v1/agent/keeper/activate", token, { method: "POST", body: {}, timeoutMs: 20_000 });
      setStep("done");
    } catch (problem) {
      const text = describeError(problem);
      setError(/user rejected|denied/iu.test(text) ? "You declined in your wallet. Nothing was approved." : text);
      setStep("error");
    } finally {
      void client.invalidateQueries({ queryKey: ["ely-keeper"] });
    }
  };

  const revoke = async () => {
    if (!token) return;
    setError(null);
    try {
      const chainId = getAccount(config).chainId;
      const result = await sessionFetch<KeeperRevokeResponse>("/v1/agent/keeper/revoke", token, { method: "POST", body: chainId ? { signatureChainId: chainId } : {}, timeoutMs: 20_000 });
      if (result.revokeOnChain && result.revokeOnChain.kind === "hypercore-approve-agent") await signAndSend(result.revokeOnChain.action, result.revokeOnChain.typedData);
      setStep("idle");
    } catch (problem) {
      setError(describeError(problem));
      setStep("error");
    } finally {
      void client.invalidateQueries({ queryKey: ["ely-keeper"] });
    }
  };

  return { step, error, enable, revoke, busy: step === "prepare" || step === "sign" || step === "submit" || step === "activate" };
}
