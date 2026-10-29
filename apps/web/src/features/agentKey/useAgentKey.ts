/**
 * The "Enable trading" lifecycle for one account in one network mode:
 * restore (decrypt unless locked), enable (fresh key -> wallet signs
 * approveAgent -> /exchange -> verified with extraAgents), revoke, lock,
 * unlock and forget. The user's wallet key never leaves the wallet; the
 * agent key never leaves this browser.
 */
import type { ExtraAgent } from "@elyia/core/hypercore/info";
import { buildExchangeRequest } from "@elyia/core/hypercore/signing";
import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useConfig } from "wagmi";
import { getAccount, signTypedData } from "wagmi/actions";

import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { exchangeError, postExchange } from "../../lib/hypercore/exchangeClient";
import { infoClient } from "../../lib/hypercore/runtime";
import { agentHealth, buildApproveAgent, buildRevokeAgent, listAgents, validUntilFor, type AgentHealth, type AgentListing, type ApprovePayload, type ExpiryDays } from "./approve";
import { agentVault, dropKey, EMPTY_SESSION, holdKey, isExpired, isHeld, sessionId, useAgentStore, type AgentSession } from "./agentSession";
import type { AgentRecordMeta } from "./vault";

export type EnableStep = "idle" | "generate" | "sign" | "submit" | "verify" | "done" | "error";

export interface EnableProgress {
  readonly step: EnableStep;
  readonly error: string | null;
}

const IDLE: EnableProgress = { step: "idle", error: null };
const NO_ACCOUNT: AgentSession = Object.freeze({ phase: "none", meta: null, error: null });

export function extraAgentsKey(mode: NetworkEnvironment, master: string | null): readonly unknown[] {
  return ["hypercore", mode, "extraAgents", master?.toLowerCase() ?? null];
}

/** Loads this account's stored key and decrypts it unless the user locked it. */
async function restore(mode: NetworkEnvironment, master: string): Promise<void> {
  const id = sessionId(mode, master);
  const { setSession } = useAgentStore.getState();
  const vault = agentVault();
  const reason = vault.unavailableReason();
  if (reason) {
    setSession(id, { phase: "unsupported", meta: null, error: reason });
    return;
  }
  try {
    const meta = await vault.load(mode, master);
    if (!meta) {
      dropKey(id);
      setSession(id, { phase: "none", meta: null, error: null });
      return;
    }
    if (isExpired(meta, Date.now())) {
      dropKey(id);
      setSession(id, { phase: "expired", meta, error: null });
      return;
    }
    if (meta.locked) {
      dropKey(id);
      setSession(id, { phase: "locked", meta, error: null });
      return;
    }
    if (!isHeld(id)) {
      const { privateKey } = await vault.decrypt(mode, master);
      holdKey(id, meta, privateKey);
    }
    setSession(id, { phase: "ready", meta, error: null });
  } catch (error) {
    dropKey(id);
    setSession(id, { phase: "error", meta: null, error: error instanceof Error ? error.message : "The key vault failed." });
  }
}

function friendlyWalletError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel/iu.test(text)) return "You declined the signature in your wallet. Nothing changed.";
  if (/chain/iu.test(text) && /mismatch|match/iu.test(text)) return "Your wallet switched networks during the request. Try again on one network.";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export interface AgentKeyApi {
  readonly session: AgentSession;
  readonly progress: EnableProgress;
  /** HyperCore's view of this device's key (null while unknown). */
  readonly health: AgentHealth | null;
  /** Named agents on the account, this device first. */
  readonly agents: readonly AgentListing[];
  readonly agentsLoading: boolean;
  enable(days: ExpiryDays): Promise<boolean>;
  revoke(): Promise<boolean>;
  lock(): Promise<void>;
  unlock(): Promise<void>;
  /** Deletes the key from this device without touching HyperCore (for an expired or replaced key). */
  forget(): Promise<void>;
  resetProgress(): void;
}

export function useAgentKey(mode: NetworkEnvironment, master: string | null, now: number): AgentKeyApi {
  const id = master ? sessionId(mode, master) : null;
  const session = useAgentStore((state) => (id ? (state.sessions[id] ?? EMPTY_SESSION) : NO_ACCOUNT));
  const config = useConfig();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<EnableProgress>(IDLE);
  const endpoints = hyperCoreEndpoints(mode);

  const agentsQuery = useQuery({
    queryKey: extraAgentsKey(mode, master),
    queryFn: () => infoClient(mode).post<ExtraAgent[]>({ type: "extraAgents", user: master as string }),
    enabled: master !== null,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!master) return;
    void restore(mode, master);
  }, [mode, master]);

  // A key that expires while the page is open is dropped at once.
  const expiresAt = session.phase === "ready" ? (session.meta?.validUntil ?? null) : null;
  useEffect(() => {
    if (!master || expiresAt === null || expiresAt > now) return;
    void restore(mode, master);
  }, [mode, master, expiresAt, now]);

  const local = session.meta?.agentAddress ?? null;
  const health = local && agentsQuery.data ? agentHealth(agentsQuery.data, local, now) : null;
  const agents = listAgents(agentsQuery.data, local, now);

  // A key saved as "pending" (HyperCore had not listed it yet) becomes "active" once extraAgents shows it.
  const pendingMeta = session.meta?.status === "pending" ? session.meta : null;
  useEffect(() => {
    if (!master || !id || !pendingMeta || health !== "active") return;
    void agentVault()
      .update(mode, master, { status: "active" })
      .then((meta) => {
        const current = useAgentStore.getState().sessions[id];
        if (meta && current?.meta?.agentAddress === meta.agentAddress) useAgentStore.getState().setSession(id, { ...current, meta });
      })
      .catch(() => undefined);
  }, [mode, master, id, pendingMeta, health]);

  /** Wallet-signs a user-signed approveAgent and submits it; returns once HyperCore accepted it. */
  const approveWithWallet = useCallback(
    async (build: (chainId: number, nonce: number, nowMs: number) => ApprovePayload): Promise<ApprovePayload> => {
      const account = getAccount(config);
      if (!account.address || !master || account.address.toLowerCase() !== master.toLowerCase()) {
        throw new Error("Connect the wallet of this account first.");
      }
      if (account.chainId === undefined) throw new Error("Your wallet did not report its network. Reconnect it and try again.");
      const nowMs = Date.now();
      // signatureChainId must equal the connected wallet's chain id (its signing domain).
      const payload = build(account.chainId, nowMs, nowMs);
      setProgress({ step: "sign", error: null });
      const typed = payload.typedData;
      const signature = await signTypedData(config, {
        account: account.address,
        domain: { ...typed.domain },
        types: typed.types as unknown as Record<string, { name: string; type: string }[]>,
        primaryType: typed.primaryType,
        message: { ...typed.message },
      });
      const after = getAccount(config);
      if (after.chainId !== account.chainId) throw new Error("Your wallet switched networks while signing. Try again on one network.");
      setProgress({ step: "submit", error: null });
      const response = await postExchange(endpoints.exchangeUrl, buildExchangeRequest({ action: payload.action, nonce: payload.nonce, signature }));
      if (response.status === "err") throw exchangeError(response.response);
      return payload;
    },
    [config, endpoints.exchangeUrl, master],
  );

  const enable = useCallback(
    async (days: ExpiryDays): Promise<boolean> => {
      if (!master || !id) return false;
      const vault = agentVault();
      const unavailable = vault.unavailableReason();
      if (unavailable) {
        setProgress({ step: "error", error: unavailable });
        return false;
      }
      let saved: AgentRecordMeta | null = null;
      try {
        setProgress({ step: "generate", error: null });
        const privateKey = generatePrivateKey();
        const agent = privateKeyToAccount(privateKey);
        const validUntil = validUntilFor(days, Date.now());
        const built = await approveWithWallet((chainId, nonce, nowMs) =>
          buildApproveAgent({ hyperliquidChain: endpoints.hyperliquidChain, walletChainId: chainId, agentAddress: agent.address, validUntil, nonce, now: nowMs }),
        );
        // Store only after HyperCore accepted, encrypted; a crash in between leaves an orphan agent that holds no funds and expires.
        saved = await vault.save({ env: mode, master, agentAddress: agent.address, privateKey, name: built.agentName, validUntil, status: "pending" });
        setProgress({ step: "verify", error: null });
        let verified = false;
        for (let attempt = 0; attempt < 8 && !verified; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 900));
          const list = await infoClient(mode).post<ExtraAgent[]>({ type: "extraAgents", user: master }, { force: true, ttlMs: 0 }).catch(() => null);
          verified = Array.isArray(list) && list.some((entry) => entry.address.toLowerCase() === agent.address.toLowerCase());
          if (list) queryClient.setQueryData(extraAgentsKey(mode, master), list);
        }
        // "active" only once HyperCore lists the key; a later health check confirms a pending one.
        const meta = (await vault.update(mode, master, { status: verified ? "active" : "pending", locked: false })) ?? saved;
        holdKey(id, meta, privateKey);
        useAgentStore.getState().setSession(id, { phase: "ready", meta, error: null });
        setProgress({ step: "done", error: verified ? null : "HyperCore accepted the approval; it may take a few seconds to list the key." });
        return true;
      } catch (error) {
        if (saved) await vault.remove(mode, master).catch(() => undefined);
        const message = error instanceof Error && error.name === "ExchangeError" ? error.message : friendlyWalletError(error);
        setProgress({ step: "error", error: message });
        return false;
      }
    },
    [approveWithWallet, endpoints.hyperliquidChain, id, master, mode, queryClient],
  );

  const revoke = useCallback(async (): Promise<boolean> => {
    if (!master || !id) return false;
    try {
      // A fresh address under the same name replaces (deregisters) the current key; its private key is never kept.
      const throwaway = privateKeyToAccount(generatePrivateKey()).address;
      await approveWithWallet((chainId, nonce, nowMs) => buildRevokeAgent({ hyperliquidChain: endpoints.hyperliquidChain, walletChainId: chainId, agentAddress: throwaway, nonce, now: nowMs }));
      dropKey(id);
      await agentVault().remove(mode, master).catch(() => undefined);
      useAgentStore.getState().setSession(id, { phase: "none", meta: null, error: null });
      await queryClient.invalidateQueries({ queryKey: extraAgentsKey(mode, master) });
      setProgress({ step: "idle", error: null });
      return true;
    } catch (error) {
      setProgress({ step: "error", error: error instanceof Error && error.name === "ExchangeError" ? error.message : friendlyWalletError(error) });
      return false;
    }
  }, [approveWithWallet, endpoints.hyperliquidChain, id, master, mode, queryClient]);

  const lock = useCallback(async () => {
    if (!master || !id) return;
    dropKey(id);
    const meta = await agentVault().update(mode, master, { locked: true }).catch(() => null);
    useAgentStore.getState().setSession(id, { phase: meta ? "locked" : "none", meta, error: null });
  }, [id, master, mode]);

  const unlock = useCallback(async () => {
    if (!master || !id) return;
    await agentVault().update(mode, master, { locked: false }).catch(() => null);
    await restore(mode, master);
  }, [id, master, mode]);

  const forget = useCallback(async () => {
    if (!master || !id) return;
    dropKey(id);
    await agentVault().remove(mode, master).catch(() => undefined);
    useAgentStore.getState().setSession(id, { phase: "none", meta: null, error: null });
  }, [id, master, mode]);

  const resetProgress = useCallback(() => setProgress(IDLE), []);

  return { session, progress, health, agents, agentsLoading: agentsQuery.isPending && master !== null, enable, revoke, lock, unlock, forget, resetProgress };
}
