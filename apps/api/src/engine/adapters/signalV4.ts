/**
 * Signal launch-token buys (Uniswap v4 copy) on Elysium testnet: native
 * HYPE -> a launch token through the launch router's
 * `buyNative(PoolKey, amountOutMinimum, recipient, refundTo, deadline)`.
 * The pool key is derived (token / canonical WHYPE, fee 0, tick spacing 200,
 * the Signal hook) and must quote on the V4Quoter, so a token without a
 * Signal pool never routes. Buy only (the sell path's encoding is not
 * proven). Explicit-only: the request names `signal` and the token address.
 * Verification: the launch token's Transfer from the PoolManager to the
 * account, at least the encoded minimum.
 */
import { applySlippage, explorerAddressUrl, type StepAmount } from "@elyia/core";
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import { SIGNAL_V4_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, lowestPreparedFloor, verifyEvmReceipts } from "../verify.js";
import { SIGNAL_V4 } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { assertBalance, deadlineFor, evmRequest, feesUsd, MAX_DEX_SLIPPAGE_BPS, tokenTrustWarnings } from "./evmCommon.js";

const BUY_GAS = 260_000n;

export interface PoolKey {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
}

/** The Signal pool key of a launch token (currencies sorted by address). */
export function signalPoolKey(token: Address): { readonly key: PoolKey; readonly zeroForOne: boolean } {
  const a = token.toLowerCase() as Address;
  const w = SIGNAL_V4.wrappedNative;
  const tokenFirst = BigInt(a) < BigInt(w);
  return {
    key: { currency0: tokenFirst ? a : w, currency1: tokenFirst ? w : a, fee: SIGNAL_V4.fee, tickSpacing: SIGNAL_V4.tickSpacing, hooks: SIGNAL_V4.hook },
    // Buying spends WHYPE: zeroForOne when WHYPE is currency0.
    zeroForOne: !tokenFirst,
  };
}

export function signalBuyCalldata(key: PoolKey, minOut: bigint, account: Address, deadline: bigint): Hex {
  return encodeFunctionData({ abi: SIGNAL_V4_ABI, functionName: "buyNative", args: [key, minOut, account, account, deadline] });
}

export function createSignalAdapter(deps: EngineDeps): ProtocolAdapter {
  const venue = SIGNAL_V4;

  async function quote(token: Address, amount: bigint): Promise<bigint> {
    const { key, zeroForOne } = signalPoolKey(token);
    if (amount >= 2n ** 128n) throw engineError("AMOUNT_TOO_LARGE");
    const data = encodeFunctionData({ abi: SIGNAL_V4_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" }] });
    const result = await deps.evm.call(venue.network, { to: venue.quoter, data });
    if (!result.ok) throw engineError("ROUTE_UNAVAILABLE", `Signal has no launch pool for ${token} (the V4 quoter refuses its pool key).`);
    const [out] = decodeFunctionResult({ abi: SIGNAL_V4_ABI, functionName: "quoteExactInputSingle", data: result.data }) as readonly [bigint, bigint];
    if (out <= 0n) throw engineError("ROUTE_UNAVAILABLE", "Signal quoted nothing for this buy.");
    return out;
  }

  return {
    id: venue.id,
    protocols: [venue.id],
    label: venue.label,
    explicitOnly: true,
    supports: (route: AdapterRoute) =>
      route.kind === "swap" && route.network === venue.network && route.destinationNetwork === venue.network && route.input?.native === true && route.output !== null && !route.output.native && route.output.address !== null && route.output.address.toLowerCase() !== venue.wrappedNative,
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      const output = action.output as ResolvedAsset;
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
      const trust = tokenTrustWarnings([output]);
      const out = await quote(output.address as Address, action.amount);
      const slippageBps = Math.max(1, Math.min(action.slippageBps, MAX_DEX_SLIPPAGE_BPS));
      const minimum = applySlippage(out, slippageBps);
      return {
        protocol: venue.id,
        kind: "swap",
        title: `Buy ${output.symbol} with ${formatAmount(action.amount, input.decimals, input.symbol)} on Signal`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, out, { minimum })],
        feesUsd: await feesUsd(deps, venue.network, BUY_GAS),
        estimatedSeconds: 2,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings: [
          "Signal is a third-party launchpad (a Uniswap v4 copy, not official Uniswap); launch tokens can lose all value and Elyia can only buy them here, not sell.",
          `${output.symbol} launch pool prices are testnet prices.`,
          ...trust,
        ],
        route: { variant: "v4:launch-buy", slippageBps, plannedInput: action.amount.toString(), plannedMinimum: minimum.toString(), params: { venue: venue.id, token: (output.address as Address).toLowerCase() } },
        requestCount: 1,
        floor: "onchain",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const inputAmount = step.inputs[0];
      const outputAmount = step.outputs[0];
      const token = String(step.route?.params?.token ?? "") as Address;
      if (!inputAmount || !outputAmount || !/^0x[0-9a-f]{40}$/u.test(token)) throw engineError("STEP_INVALID", "The Signal step lost its token.");
      const input = assetOfAmount(inputAmount);
      const output = assetOfAmount(outputAmount);
      const account = stepAddress(step);
      await assertBalance(deps, input, account, context.amount);
      const out = await quote(token, context.amount);
      const minimum = applySlippage(out, step.route?.slippageBps ?? 50);
      const { key } = signalPoolKey(token);
      return {
        requests: [evmRequest(venue.network, account, venue.launchRouter, signalBuyCalldata(key, minimum, account, deadlineFor(context.expiresAt)), context.amount, `Buy at least ${formatAmount(minimum, output.decimals, output.symbol)} with ${formatAmount(context.amount, input.decimals, input.symbol)} on Signal`)],
        inputs: [amountOf(input, context.amount)],
        outputs: [amountOf(output, out, { minimum })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const output = step.outputs[0] as StepAmount;
      const outAsset = assetOfAmount(output);
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const credit = erc20Credit(receipts.flatMap((receipt) => receipt.logs), outAsset.address as string, account, venue.poolManager);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (credit === 0n || credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `Signal delivered ${credit} base units of ${output.symbol}, below the guaranteed ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `${formatAmount(credit, output.decimals, output.symbol)} from the Signal PoolManager.`, { url: explorerAddressUrl(step.network, venue.poolManager) })],
        };
      });
      return result;
    },
  };
}
