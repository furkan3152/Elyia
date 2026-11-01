/**
 * One owner call on ElyHerd: the API prepares the calldata (guards, eth_call
 * simulation, audit), the admin's own wallet signs and sends it, then the
 * hash is reported for the audit log. The server never signs.
 */
import type { HerdPreparedTx } from "@elyia/core/api/herd";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";

import { useHerdAdmin } from "../../../features/herd/herdApi";
import { mintError } from "../../../features/herd/herdModel";
import { describeError } from "../../../lib/api";

export type HerdTxState =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing" }
  | { readonly phase: "prepared"; readonly tx: HerdPreparedTx }
  | { readonly phase: "wallet"; readonly tx: HerdPreparedTx }
  | { readonly phase: "pending"; readonly tx: HerdPreparedTx; readonly hash: string }
  | { readonly phase: "done"; readonly tx: HerdPreparedTx; readonly hash: string }
  | { readonly phase: "failed"; readonly error: string; readonly tx: HerdPreparedTx | null };

export function useHerdTx() {
  const admin = useHerdAdmin();
  const { chainId } = useAccount();
  const [state, setState] = useState<HerdTxState>({ phase: "idle" });
  const target = state.phase === "prepared" || state.phase === "wallet" || state.phase === "pending" || state.phase === "done" ? state.tx.chainId : undefined;
  const client = usePublicClient({ chainId: target });
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const prepare = async (functionName: string, args: readonly unknown[]) => {
    setState({ phase: "preparing" });
    try {
      setState({ phase: "prepared", tx: await admin.prepare.mutateAsync({ functionName, args }) });
    } catch (error) {
      setState({ phase: "failed", error: describeError(error), tx: null });
    }
  };

  const sign = async (tx: HerdPreparedTx) => {
    setState({ phase: "wallet", tx });
    try {
      if (chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
      const hash = await sendTransactionAsync({ chainId: tx.chainId, to: tx.to as Address, data: tx.data as Hex, value: 0n });
      setState({ phase: "pending", tx, hash });
      void admin.sent.mutateAsync({ functionName: tx.functionName, hash }).catch(() => undefined);
      const receipt = await client?.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt && receipt.status !== "success") throw new Error("The transaction reverted.");
      setState({ phase: "done", tx, hash });
      void queryClient.invalidateQueries({ queryKey: ["admin", "herd"] });
      void queryClient.invalidateQueries({ queryKey: ["herd"] });
    } catch (error) {
      setState({ phase: "failed", error: mintError(describeError(error)), tx });
    }
  };

  return { state, prepare, sign, reset: () => setState({ phase: "idle" }) } as const;
}
