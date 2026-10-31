/**
 * Plain EVM moves on Elysium and HyperEVM: native HYPE / ERC-20 sends to a
 * recipient, and HYPE <-> canonical WHYPE wraps. A native send is proven by
 * the binding itself (target and value are in it) and a successful receipt;
 * ERC-20 sends and wraps by their Transfer / Deposit / Withdrawal events.
 * Gas is never hard-coded at 21000: Elysium's plain transfer uses ~21,140.
 */
import { getEvmNetwork, NETWORKS, sameOwner, type StepAmount } from "@elyia/core";
import { encodeFunctionData, type Address } from "viem";
import { erc20Abi, WETH_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, eventsOf, verifyEvmReceipts } from "../verify.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { assertBalance, evmRequest, feesUsd, GAS } from "./evmCommon.js";

const ZERO = "0x0000000000000000000000000000000000000000";

function isEvm(deps: EngineDeps, network: AdapterRoute["network"]): boolean {
  return deps.networks[network]?.vm === "evm";
}

export function createEvmTransferAdapter(deps: EngineDeps): ProtocolAdapter {
  return {
    id: "evm-transfer",
    protocols: ["evm-transfer"],
    label: "Transfer",
    supports: (route) => route.kind === "transfer" && isEvm(deps, route.network) && route.destinationNetwork === route.network && route.input !== null && (route.input.native || route.input.address !== null),
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      const recipient = action.recipient.address.toLowerCase();
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
      if (sameOwner(recipient, action.account.address)) throw engineError("RECIPIENT_INVALID", "That is your own address on this network; nothing to send.");
      const warnings = input.verified ? [] : [`${input.symbol} (${input.address}) is not in Elyia's verified token list.`];
      return {
        protocol: "evm-transfer",
        kind: "transfer",
        title: `Send ${formatAmount(action.amount, input.decimals, input.symbol)} to ${recipient.slice(0, 6)}…${recipient.slice(-4)} on ${NETWORKS[action.network].name}`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(input, action.amount, { minimum: action.amount })],
        feesUsd: await feesUsd(deps, action.network, input.native ? GAS.transfer : GAS.erc20Transfer),
        estimatedSeconds: NETWORKS[action.network].family === "elysium" ? 2 : 3,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings,
        route: { variant: input.native ? "native" : "erc20", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString(), params: { to: recipient } },
        requestCount: 1,
        floor: "onchain",
        recipient: action.recipient,
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const input = assetOfAmount(step.inputs[0] as StepAmount);
      const account = stepAddress(step);
      const to = String(step.route?.params?.to ?? "").toLowerCase() as Address;
      if (!/^0x[0-9a-f]{40}$/u.test(to)) throw engineError("STEP_INVALID", "The transfer lost its recipient.");
      await assertBalance(deps, input, account, context.amount);
      const request = input.native
        ? evmRequest(step.network, account, to, "0x", context.amount, `Send ${formatAmount(context.amount, 18, "HYPE")}`)
        : evmRequest(step.network, account, input.address as Address, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, context.amount] }), 0n, `Send ${formatAmount(context.amount, input.decimals, input.symbol)}`);
      return {
        requests: [request],
        inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
        outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const input = assetOfAmount(step.inputs[0] as StepAmount);
      const to = String(step.route?.params?.to ?? "").toLowerCase();
      const amount = BigInt((step.inputs[0] as StepAmount).expected);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        if (input.native) return { actualOutputs: step.outputs, evidence: [evidence("settlement", step.network, context.now, `Sent ${formatAmount(amount, 18, "HYPE")}.`)] };
        const credit = erc20Credit(receipts.flatMap((receipt) => receipt.logs), input.address as string, to, stepAddress(step));
        if (credit < amount) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `Only ${credit} base units reached the recipient (fee-on-transfer token?).` } };
        return { actualOutputs: step.outputs, evidence: [evidence("settlement", step.network, context.now, `Transfer of ${formatAmount(credit, input.decimals, input.symbol)} to the recipient.`)] };
      });
      return result;
    },
  };
}

/** HYPE <-> canonical WHYPE on one network (the network's pinned wrapped native). */
export function createWrapAdapter(deps: EngineDeps): ProtocolAdapter {
  const wrappedOf = (network: AdapterRoute["network"]): string | null => (isEvm(deps, network) ? getEvmNetwork(network).contracts.wrappedNative?.toLowerCase() ?? null : null);
  return {
    id: "wrapped-hype",
    protocols: ["wrapped-hype"],
    label: "WHYPE",
    supports(route) {
      if (route.kind !== "swap" || route.network !== route.destinationNetwork || !route.input || !route.output) return false;
      const wrapped = wrappedOf(route.network);
      if (!wrapped) return false;
      return (route.input.native && route.output.address?.toLowerCase() === wrapped) || (route.output.native && route.input.address?.toLowerCase() === wrapped);
    },
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      const output = action.output as ResolvedAsset;
      const wrap = input.native;
      return {
        protocol: "wrapped-hype",
        kind: "swap",
        title: `${wrap ? "Wrap" : "Unwrap"} ${formatAmount(action.amount, 18, input.symbol)} ${wrap ? "into" : "to"} ${output.symbol}`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, action.amount, { minimum: action.amount })],
        feesUsd: await feesUsd(deps, action.network, wrap ? GAS.wrap : GAS.unwrap),
        estimatedSeconds: 2,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings: [],
        route: { variant: wrap ? "wrap" : "unwrap", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString(), params: { wrapped: wrappedOf(action.network) ?? "" } },
        requestCount: 1,
        floor: "onchain",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const input = assetOfAmount(step.inputs[0] as StepAmount);
      const account = stepAddress(step);
      const wrapped = String(step.route?.params?.wrapped ?? "") as Address;
      if (wrapped.toLowerCase() !== wrappedOf(step.network)) throw engineError("STEP_INVALID", "The wrapped HYPE pin changed.");
      await assertBalance(deps, input, account, context.amount);
      const wrap = step.route?.variant === "wrap";
      const data = wrap ? encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }) : encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [context.amount] });
      return {
        requests: [evmRequest(step.network, account, wrapped, data, wrap ? context.amount : 0n, step.title)],
        inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
        outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const wrapped = String(step.route?.params?.wrapped ?? "");
      const account = stepAddress(step);
      const amount = BigInt((step.inputs[0] as StepAmount).expected);
      const wrap = step.route?.variant === "wrap";
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const logs = receipts.flatMap((receipt) => receipt.logs);
        // WETH9 clones emit Deposit / Withdrawal; Arbitrum-style aeWETH mints and burns with Transfer from / to zero.
        const evented = wrap
          ? eventsOf(logs, { address: wrapped, abi: WETH_ABI, eventName: "Deposit" }).filter((event) => String(event.args.dst).toLowerCase() === account).reduce((sum, event) => sum + (event.args.wad as bigint), 0n)
          : eventsOf(logs, { address: wrapped, abi: WETH_ABI, eventName: "Withdrawal" }).filter((event) => String(event.args.src).toLowerCase() === account).reduce((sum, event) => sum + (event.args.wad as bigint), 0n);
        const minted = wrap ? erc20Credit(logs, wrapped, account, ZERO) : erc20Credit(logs, wrapped, ZERO, account);
        const moved = evented > minted ? evented : minted;
        if (moved < amount) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `${wrap ? "Wrap" : "Unwrap"} moved ${moved} instead of ${amount}.` } };
        return { actualOutputs: step.outputs, evidence: [evidence("settlement", step.network, context.now, `${wrap ? "Wrapped" : "Unwrapped"} ${formatAmount(amount, 18, "HYPE")}.`)] };
      });
      return result;
    },
  };
}
