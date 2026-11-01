/**
 * The mint, wallet side (needs the wagmi providers): mintedBy and balance
 * reads, the network switch, and the mint transaction your wallet signs.
 * Never sends anything without the press of Mint in the wallet.
 */
import type { HerdConfigResponse } from "@elyia/core/api/herd";
import { useCallback, useState } from "react";
import { decodeEventLog, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";

import { describeError } from "../../lib/api";
import { HERD_WEB_ABI } from "./abi";
import { useHolder, useInvalidateHerd } from "./herdApi";
import { mintError, type MintAction } from "./herdModel";

export type MintTx = { readonly state: "idle" } | { readonly state: "wallet" } | { readonly state: "pending"; readonly hash: string } | { readonly state: "done"; readonly hash: string; readonly tokenId: number | null } | { readonly state: "failed"; readonly error: string };

export function useMint(config: HerdConfigResponse | null | undefined) {
  const { address, chainId } = useAccount();
  const target = config?.chainId;
  const contract = config?.source === "chain" ? (config.address as Address | null) : null;
  const client = usePublicClient({ chainId: target });
  const balance = useBalance({ address, chainId: target, query: { enabled: Boolean(address && target), refetchInterval: 20_000 } });
  const minted = useReadContract({ address: contract ?? undefined, abi: HERD_WEB_ABI, functionName: "mintedBy", args: address ? [address] : undefined, chainId: target, query: { enabled: Boolean(contract && address && target), refetchInterval: 15_000 } });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const invalidate = useInvalidateHerd();
  const [tx, setTx] = useState<MintTx>({ state: "idle" });
  // Fallback when the wallet's RPC cannot read: the API's on-chain read of mintedBy.
  const holder = useHolder(address?.toLowerCase());

  const switchNetwork = useCallback(async () => {
    if (!target) return;
    try {
      await switchChainAsync({ chainId: target });
    } catch (error) {
      setTx({ state: "failed", error: mintError(describeError(error)) });
    }
  }, [switchChainAsync, target]);

  const mint = useCallback(
    async (action: MintAction) => {
      if (!contract || !target) return;
      setTx({ state: "wallet" });
      try {
        if (chainId !== target) await switchChainAsync({ chainId: target });
        const hash = await writeContractAsync({ chainId: target, address: contract, abi: HERD_WEB_ABI, functionName: action.functionName, args: action.args as never, value: action.value });
        setTx({ state: "pending", hash });
        const receipt = await client?.waitForTransactionReceipt({ hash, timeout: 180_000 });
        if (receipt && receipt.status !== "success") throw new Error("The transaction reverted.");
        let tokenId: number | null = null;
        for (const log of receipt?.logs ?? []) {
          try {
            const event = decodeEventLog({ abi: HERD_WEB_ABI, data: log.data, topics: log.topics });
            if (event.eventName === "Minted") tokenId = Number((event.args as unknown as { id: bigint }).id);
          } catch {
            // not ours
          }
        }
        setTx({ state: "done", hash, tokenId });
        void minted.refetch();
        void balance.refetch();
        void holder.refetch();
        invalidate();
      } catch (error) {
        setTx({ state: "failed", error: mintError(describeError(error)) });
      }
    },
    [balance, chainId, client, contract, holder, invalidate, minted, switchChainAsync, target, writeContractAsync],
  );

  const fromApi = holder.data ? (holder.data.minted ? (holder.data.tokenIds[0] ?? -1) : 0) : undefined;
  const mintedId = !address || !contract ? null : tx.state === "done" ? (tx.tokenId ?? -1) : minted.data !== undefined ? Number(minted.data) : minted.isError ? fromApi : undefined;
  return { address: address?.toLowerCase() ?? null, chainId: chainId ?? null, balanceWei: balance.data?.value ?? null, mintedId, tx, mint, switchNetwork, reset: () => setTx({ state: "idle" }) } as const;
}
