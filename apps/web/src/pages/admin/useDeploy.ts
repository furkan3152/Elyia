/**
 * The five camps, wallet side (needs the wagmi providers): preview (creation
 * data from the manifest + artifact, cross-checked with the server's plan;
 * nonce, predicted CREATE address, eth_estimateGas, an eth_call simulation),
 * the owner's wallet signs and sends, the receipt, the bytecode check, and
 * POST /v1/admin/deployments to record. Nothing is ever sent without the
 * owner pressing Sign in their own wallet.
 */
import type { DeployPlanResponse } from "@elyia/core/api/admin";
import { elyAccountFactoryArtifact, elyiaRouterArtifact, elyOrdersArtifact, elysiumTestnetDeployManifest } from "@elyia/core/contracts/index";
import { useCallback, useReducer } from "react";
import { encodeDeployData, type Abi, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";

import { describeError } from "../../lib/api";
import { recordDeployment, useInvalidateAdmin } from "./adminApi";
import { compareRuntimeCode, deployReducer, NETWORK_OPTIONS, predictAddress, resolveArgs, type AdminNetwork, type Deployable, type DeployPreview } from "./deployModel";

export const ARTIFACTS = {
  ElyiaRouter: elyiaRouterArtifact,
  ElyAccountFactory: elyAccountFactoryArtifact,
  ElyOrders: elyOrdersArtifact,
} as const;

export const MANIFEST = elysiumTestnetDeployManifest;

function walletWords(error: unknown): string {
  const text = describeError(error);
  if (/reject|denied|cancel/iu.test(text)) return "You rejected it in your wallet. Nothing was sent.";
  return text.split("\n")[0]!.slice(0, 240);
}

/** Creation data for `contract` on `network`: local (manifest + artifact) on 99801, the server's plan elsewhere. */
export function creationData(contract: Deployable, network: AdminNetwork, owner: string | null, deployed: Readonly<Partial<Record<string, string>>>, plan: DeployPlanResponse | undefined) {
  const serverStep = plan?.network === network ? plan.steps.find((step) => step.contract === contract) : undefined;
  const serverData = serverStep?.transaction?.data ?? null;
  if (network === MANIFEST.network) {
    const step = MANIFEST.order.find((entry) => entry.contract === contract);
    if (!step) return { ok: false as const, reason: `${contract} is not in the manifest.` };
    const args = resolveArgs(step.constructor as never, owner, deployed);
    if (!args.ok) return { ok: false as const, reason: `Waiting for ${args.missing.join(", ")}.` };
    const artifact = ARTIFACTS[contract];
    const data = encodeDeployData({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args: args.values as never });
    return { ok: true as const, data, args: args.shown, matchesServerPlan: serverData === null ? null : serverData.toLowerCase() === data.toLowerCase() };
  }
  if (!serverData) return { ok: false as const, reason: serverStep?.note ?? "No server plan for this network yet." };
  return { ok: true as const, data: serverData, args: (serverStep?.constructorArgs ?? []).map((arg) => ({ name: arg.name, value: arg.value ?? "—" })), matchesServerPlan: true };
}

export function useDeploy(contract: Deployable, network: AdminNetwork, deployed: Readonly<Partial<Record<string, string>>>, plan: DeployPlanResponse | undefined) {
  const [state, dispatch] = useReducer(deployReducer, { phase: "idle" });
  const option = NETWORK_OPTIONS.find((entry) => entry.key === network)!;
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: option.chainId });
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const invalidate = useInvalidateAdmin();

  const preview = useCallback(async () => {
    dispatch({ type: "preview" });
    try {
      if (!option.enabled) throw new Error(option.note);
      if (!address) throw new Error("Connect the owner wallet first.");
      if (!publicClient) throw new Error(`No RPC for chain ${option.chainId} in this build.`);
      const built = creationData(contract, network, address, deployed, plan);
      if (!built.ok) throw new Error(built.reason);
      if (built.matchesServerPlan === false) throw new Error("The server's plan builds different creation data than the manifest. Stop and check versions.");
      const nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
      const [gas, gasPrice, simulation] = await Promise.all([
        publicClient.estimateGas({ account: address, data: built.data }).catch(() => null),
        publicClient.getGasPrice().catch(() => null),
        publicClient
          .call({ account: address, data: built.data })
          .then((result) => ({ size: result.data ? (result.data.length - 2) / 2 : 0, error: null }))
          .catch((error: unknown) => ({ size: null, error: walletWords(error) })),
      ]);
      const next: DeployPreview = {
        contract,
        network,
        chainId: option.chainId,
        from: address,
        nonce,
        predicted: predictAddress(address, nonce),
        data: built.data,
        gas,
        gasPriceWei: gasPrice,
        args: built.args,
        simulatedSize: simulation.size,
        simulationError: simulation.error,
        matchesServerPlan: built.matchesServerPlan,
      };
      dispatch({ type: "previewed", preview: next });
    } catch (error) {
      dispatch({ type: "fail", error: walletWords(error) });
    }
  }, [address, contract, deployed, network, option, plan, publicClient]);

  const sign = useCallback(
    async (current: DeployPreview) => {
      dispatch({ type: "sign" });
      try {
        if (!publicClient) throw new Error("No RPC for this chain.");
        if (chainId !== current.chainId) await switchChainAsync({ chainId: current.chainId });
        const hash = await sendTransactionAsync({ chainId: current.chainId, data: current.data, to: null, ...(current.gas ? { gas: (current.gas * 12n) / 10n } : {}) });
        dispatch({ type: "sent", hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
        if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`The transaction reverted in block ${receipt.blockNumber}.`);
        dispatch({ type: "mined", receipt: { hash, blockNumber: receipt.blockNumber.toString(), address: receipt.contractAddress, gasUsed: receipt.gasUsed.toString() } });
        const code = await publicClient.getCode({ address: receipt.contractAddress });
        const check = compareRuntimeCode(code, ARTIFACTS[current.contract].deployedBytecode);
        dispatch({ type: "checked", code: check });
        if (check.verdict === "mismatch") return;
        const recorded = await recordDeployment({ network: current.network, contract: current.contract, txHash: hash });
        if (!recorded.deployment.checks.runtimeCodeMatches) throw new Error("The server's bytecode check did not match. Not recorded.");
        dispatch({ type: "recorded", at: recorded.deployment.recordedAt });
        invalidate();
      } catch (error) {
        dispatch({ type: "fail", error: walletWords(error) });
      }
    },
    [chainId, invalidate, publicClient, sendTransactionAsync, switchChainAsync],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { state, preview, sign, reset, walletChainId: chainId ?? null, address: address ?? null } as const;
}
