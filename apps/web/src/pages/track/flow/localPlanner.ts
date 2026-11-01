/**
 * The offline planner (pure): when the Elyia planner cannot be reached, the
 * browser plans the simple, single-step moves it can build safely itself,
 * from the pinned address book (core networks/assets). Anything else stays
 * "planner offline". These plans are the same transactions the API engine
 * prepares:
 *
 * - HYPE HyperEVM -> Elysium: `Inbox.depositEth{value}()` (kind-12 deposit);
 * - HYPE Elysium -> HyperEVM: `ArbSys.withdrawEth(you){value}`, claimed later;
 * - USDC HyperEVM -> HyperCore: `approve` + `CoreDepositWallet.deposit(amount, dex)`;
 * - HYPE HyperEVM -> HyperCore: a plain transfer to `0x2222…2222`;
 * - USDC spot <-> perps on HyperCore: `usdClassTransfer`, signed by the wallet;
 * - HYPE -> kHYPE: `StakingManager.stake{value}()` on HyperEVM (min 0.1 HYPE).
 *
 * Nothing here signs: the runner hands each request to the wallet.
 */
import type { IntentActionSpec } from "@elyia/core/intent";
import { usdClassTransferAction, type UserSignedAction } from "@elyia/core/hypercore/actions";
import { typedDataForUserAction, type Eip712TypedData } from "@elyia/core/hypercore/signing";
import { getEvmNetwork, getHyperCoreNetwork, HYPE_SYSTEM_ADDRESS, layersFor, NETWORKS, signatureChainIdHex, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";

import type { Grade } from "../../../topo/geometry/conditions";
import { ARB_SYS_ABI, CORE_DEPOSIT_WALLET_ABI, ERC20_ABI, INBOX_ABI, KINETIQ_STAKING_ABI } from "./abis";
import { ARB_SYS, withdrawalSeconds } from "./orbit";
import { formatEta, layerOf, shortRouteId, stepVerb, type FlowRoute, type FlowStepView } from "./routeModel";

/** Circle CoreDepositWallet on HyperEVM testnet (spotMeta USDC evmContract). */
export const CORE_DEPOSIT_WALLET: Partial<Record<NetworkKey, Address>> = { "hyperevm-testnet": "0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206" };
/** CoreDepositWallet destination dex: 0 = perps, uint32 max = spot. */
export const CORE_DEX = { perps: 0, spot: 4_294_967_295 } as const;
/** Kinetiq StakingManager (testnet identity inferred: sole kHYPE minter; min stake 0.1 HYPE). */
export const KINETIQ_MANAGER: Partial<Record<NetworkKey, Address>> = { "hyperevm-testnet": "0x9E4cE62b9D9a0792C56990CbEa4d0A116A8a9216" };
export const KINETIQ_MIN_STAKE = "0.1";
const USDC_HEVM_TESTNET: Address = "0x2B3370eE501B4a559b57D449569354196457D8Ab";

export interface EvmRequest {
  readonly kind: "evm";
  readonly network: NetworkKey;
  readonly chainId: number;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly description: string;
}

export interface UserSignedRequest {
  readonly kind: "user-signed";
  readonly network: NetworkKey;
  readonly description: string;
  /** Built at signing time: the domain is the wallet's chain and the nonce is now. */
  readonly build: (walletChainId: number, nonce: number) => { readonly action: UserSignedAction; readonly typedData: Eip712TypedData<`HyperliquidTransaction:${string}`> };
}

export type LocalRequest = EvmRequest | UserSignedRequest;

/** How the runner knows a step arrived. */
export type LocalSettle = "receipt" | "orbit-deposit" | "orbit-withdrawal" | "ledger" | "core-credit";

export interface LocalStep {
  readonly view: FlowStepView;
  readonly requests: readonly LocalRequest[];
  readonly settle: LocalSettle;
  /** Planned but not executable offline (the Orbit claim needs the outbox proof the planner builds). */
  readonly offlineOnly?: string;
}

export interface LocalPlan {
  readonly route: FlowRoute;
  readonly steps: readonly LocalStep[];
}

export type OfflinePlanResult = { readonly ok: true; readonly plan: LocalPlan } | { readonly ok: false; readonly reason: string };

interface Context {
  readonly account: Address;
  readonly mode: NetworkEnvironment;
  readonly sentence: string;
  readonly grade: Grade;
  readonly now: number;
}

function view(input: { stepId: string; network: NetworkKey; toNetwork?: NetworkKey; kind: string; title: string; venue: string; inOut: string; seconds: number; signer?: "wallet" | "none"; index: number }): FlowStepView {
  const layer = layerOf(input.network);
  const toLayer = input.toNetwork && layerOf(input.toNetwork) !== layer ? layerOf(input.toNetwork) : undefined;
  return {
    id: `W${input.index + 1}`,
    stepId: input.stepId,
    network: input.network,
    title: input.title,
    layer,
    toLayer,
    action: stepVerb(input.kind, layer, toLayer ?? layer),
    venue: input.venue,
    inOut: input.inOut,
    fee: "gas only",
    eta: formatEta(input.seconds),
    state: input.index === 0 ? "next" : "waiting",
    signer: input.signer ?? "wallet",
    estimatedSeconds: input.seconds,
  };
}

function route(ctx: Context, steps: readonly LocalStep[], arrives: string, warnings: readonly string[] = []): LocalPlan {
  const signers = steps.filter((step) => step.view.signer !== "none");
  return {
    steps,
    route: {
      id: shortRouteId(`${ctx.sentence}:${ctx.now}`),
      sentence: ctx.sentence,
      grade: ctx.grade,
      source: "offline",
      steps: steps.map((step) => step.view),
      fees: "gas only",
      signatures: { done: 0, needed: signers.length },
      rules: ["planned in your browser", "to your own address", "verified addresses only"],
      unpriced: [],
      warnings: ["The Elyia planner is offline: this plan was built in your browser from the pinned address book. The Rule Book's caps are not checked until the planner is back.", ...warnings],
      quotes: [],
      arrives,
      minimum: null,
      notionalUsd: null,
      totalSeconds: steps.reduce((sum, step) => sum + (step.view.estimatedSeconds ?? 0), 0),
      decision: "allow",
    },
  };
}

function amountOf(action: IntentActionSpec, decimals: number): bigint | string {
  const text = action.amount?.trim() ?? "";
  if (!/^\d+(\.\d+)?$/u.test(text)) return "Enter an amount.";
  try {
    const value = parseUnits(text, decimals);
    return value > 0n ? value : "Enter an amount above zero.";
  } catch {
    return "That amount has too many decimals.";
  }
}

/** Plans one action in the browser, or says why it cannot. */
export function planOffline(action: IntentActionSpec, ctx: Context): OfflinePlanResult {
  if (ctx.mode !== "testnet") return { ok: false, reason: "Offline plans cover the practice wall (testnet) only." };
  const layers = layersFor(ctx.mode);
  const asset = (action.from ?? "HYPE").toUpperCase();
  const fromFamily = NETWORKS[action.network].family;
  const toFamily = action.toNetwork ? NETWORKS[action.toNetwork].family : fromFamily;

  // HYPE up: HyperEVM -> Elysium.
  if (action.kind === "bridge" && fromFamily === "hyperevm" && toFamily === "elysium" && asset === "HYPE") {
    const value = amountOf(action, 18);
    if (typeof value === "string") return { ok: false, reason: value };
    const bridge = getEvmNetwork(layers.elysium.key).elysiumBridge!;
    const parent = getEvmNetwork(layers.hyperevm.key);
    return {
      ok: true,
      plan: route(ctx, [
        {
          view: view({ stepId: "s1", network: parent.key, toNetwork: layers.elysium.key, kind: "bridge", title: `Bridge ${action.amount} HYPE to Elysium`, venue: "canonical bridge", inOut: `${action.amount} HYPE → ${action.amount} HYPE`, seconds: 120, index: 0 }),
          requests: [{ kind: "evm", network: parent.key, chainId: parent.chainId, to: bridge.parent.inbox as Address, data: encodeFunctionData({ abi: INBOX_ABI, functionName: "depositEth" }), value, description: "Inbox.depositEth on HyperEVM" }],
          settle: "orbit-deposit",
        },
      ], `${action.amount} HYPE on Elysium`),
    };
  }

  // HYPE down: Elysium -> HyperEVM (withdraw, then claim after the confirm period).
  if (action.kind === "bridge" && fromFamily === "elysium" && toFamily === "hyperevm" && asset === "HYPE") {
    const value = amountOf(action, 18);
    if (typeof value === "string") return { ok: false, reason: value };
    const elysium = getEvmNetwork(layers.elysium.key);
    const seconds = withdrawalSeconds(elysium.elysiumBridge?.confirmPeriodBlocks ?? 10);
    return {
      ok: true,
      plan: route(ctx, [
        {
          view: view({ stepId: "s1", network: elysium.key, toNetwork: layers.hyperevm.key, kind: "bridge", title: `Withdraw ${action.amount} HYPE to HyperEVM`, venue: "canonical bridge", inOut: `${action.amount} HYPE → outbox`, seconds, index: 0 }),
          requests: [{ kind: "evm", network: elysium.key, chainId: elysium.chainId, to: ARB_SYS, data: encodeFunctionData({ abi: ARB_SYS_ABI, functionName: "withdrawEth", args: [ctx.account] }), value, description: "ArbSys.withdrawEth on Elysium" }],
          settle: "orbit-withdrawal",
        },
        {
          view: view({ stepId: "s2", network: layers.hyperevm.key, kind: "claim", title: `Claim ${action.amount} HYPE on HyperEVM`, venue: "outbox", inOut: `outbox → ${action.amount} HYPE`, seconds: 30, index: 1 }),
          requests: [],
          settle: "receipt",
          offlineOnly: "The claim needs the outbox proof the Elyia planner builds. Track this withdrawal; the claim opens when the confirm period ends.",
        },
      ], `${action.amount} HYPE on HyperEVM`, ["Descent: the claim opens after the rollup confirms (testnet ≈ 30 min; mainnet ≈ 5 d 14 h)."]),
    };
  }

  // HyperEVM -> HyperCore.
  if (action.kind === "link" && fromFamily === "hyperevm" && toFamily === "hypercore") {
    const evm = getEvmNetwork(action.network);
    const core = layers.hypercore.key;
    if (asset === "USDC") {
      const value = amountOf(action, 6);
      if (typeof value === "string") return { ok: false, reason: value };
      const wallet = CORE_DEPOSIT_WALLET[evm.key];
      if (!wallet) return { ok: false, reason: "The CoreDepositWallet is pinned for testnet only." };
      const toPerp = action.params?.toPerp !== false;
      return {
        ok: true,
        plan: route(ctx, [
          {
            view: view({ stepId: "s1", network: evm.key, toNetwork: core, kind: "link", title: `Move ${action.amount} USDC to HyperCore ${toPerp ? "perps" : "spot"}`, venue: "CoreDepositWallet", inOut: `${action.amount} USDC → ${action.amount} USDC`, seconds: 10, index: 0 }),
            requests: [
              { kind: "evm", network: evm.key, chainId: evm.chainId, to: USDC_HEVM_TESTNET, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [wallet, value] }), value: 0n, description: "Approve exactly this USDC for the CoreDepositWallet" },
              { kind: "evm", network: evm.key, chainId: evm.chainId, to: wallet, data: encodeFunctionData({ abi: CORE_DEPOSIT_WALLET_ABI, functionName: "deposit", args: [value, toPerp ? CORE_DEX.perps : CORE_DEX.spot] }), value: 0n, description: "CoreDepositWallet.deposit" },
            ],
            settle: "core-credit",
          },
        ], `${action.amount} USDC on HyperCore ${toPerp ? "perps" : "spot"}`),
      };
    }
    if (asset === "HYPE") {
      const value = amountOf(action, 18);
      if (typeof value === "string") return { ok: false, reason: value };
      return {
        ok: true,
        plan: route(ctx, [
          {
            view: view({ stepId: "s1", network: evm.key, toNetwork: core, kind: "link", title: `Move ${action.amount} HYPE to HyperCore spot`, venue: "system address", inOut: `${action.amount} HYPE → ${action.amount} HYPE`, seconds: 10, index: 0 }),
            requests: [{ kind: "evm", network: evm.key, chainId: evm.chainId, to: HYPE_SYSTEM_ADDRESS as Address, data: "0x", value, description: "Send HYPE to the HyperCore system address 0x2222…2222" }],
            settle: "core-credit",
          },
        ], `${action.amount} HYPE on HyperCore spot`),
      };
    }
  }

  // Spot <-> perps on HyperCore.
  if (action.kind === "margin" && fromFamily === "hypercore") {
    const value = amountOf(action, 6);
    if (typeof value === "string") return { ok: false, reason: value };
    const toPerp = action.params?.toPerp !== false;
    const amount = action.amount!;
    const chain = getHyperCoreNetwork(action.network).hyperliquidChain;
    return {
      ok: true,
      plan: route(ctx, [
        {
          view: view({ stepId: "s1", network: action.network, kind: "margin", title: `Move ${amount} USDC ${toPerp ? "spot → perps" : "perps → spot"}`, venue: "HyperCore", inOut: `${amount} USDC ${toPerp ? "spot → perps" : "perps → spot"}`, seconds: 3, index: 0 }),
          requests: [
            {
              kind: "user-signed",
              network: action.network,
              description: "usdClassTransfer, signed by your wallet",
              build: (walletChainId, nonce) => {
                const built = usdClassTransferAction({ hyperliquidChain: chain, signatureChainId: signatureChainIdHex(walletChainId) }, { amount, toPerp, nonce });
                return { action: built, typedData: typedDataForUserAction(built) };
              },
            },
          ],
          settle: "ledger",
        },
      ], `${amount} USDC on ${toPerp ? "perps" : "spot"}`),
    };
  }

  // HYPE -> kHYPE (Kinetiq on HyperEVM).
  if (action.kind === "stake" && fromFamily === "hyperevm" && asset === "HYPE") {
    const value = amountOf(action, 18);
    if (typeof value === "string") return { ok: false, reason: value };
    if (value < parseUnits(KINETIQ_MIN_STAKE, 18)) return { ok: false, reason: `Kinetiq takes at least ${KINETIQ_MIN_STAKE} HYPE.` };
    const evm = getEvmNetwork(action.network);
    const manager = KINETIQ_MANAGER[evm.key];
    if (!manager) return { ok: false, reason: "The Kinetiq StakingManager is pinned for testnet only." };
    return {
      ok: true,
      plan: route(ctx, [
        {
          view: view({ stepId: "s1", network: evm.key, kind: "stake", title: `Stake ${action.amount} HYPE with Kinetiq`, venue: "Kinetiq", inOut: `${action.amount} HYPE → kHYPE`, seconds: 4, index: 0 }),
          requests: [{ kind: "evm", network: evm.key, chainId: evm.chainId, to: manager, data: encodeFunctionData({ abi: KINETIQ_STAKING_ABI, functionName: "stake" }), value, description: "StakingManager.stake on HyperEVM" }],
          settle: "receipt",
        },
      ], "kHYPE on HyperEVM"),
    };
  }

  return { ok: false, reason: "This move needs the Elyia planner (quotes, retryable sizing or a claim proof). It is offline right now." };
}
