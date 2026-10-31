/**
 * Uniswap V2 swaps for one pinned venue (Dex Da Costa on Elysium testnet).
 * Quotes come from the router's `getAmountsOut` (a view), the path is
 * direct, the pair must be the factory's `getPair` and answer `factory()`
 * with the pin. The router's WETH is not canonical WHYPE, so native HYPE
 * goes in and out only through `swapExactETHForTokens` /
 * `swapExactTokensForETH` with the router's own WETH in the path; canonical
 * WHYPE is just another ERC-20 here.
 */
import { applySlippage, explorerAddressUrl, NETWORKS, type StepAmount } from "@elyia/core";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { V2_FACTORY_ABI, V2_PAIR_ABI, V2_ROUTER_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, sameResolved, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, eventsOf, lowestPreparedFloor, nativeUnwrapped, verifyEvmReceipts } from "../verify.js";
import type { V2Venue } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { approvalFor, assertBalance, deadlineFor, evmRequest, feesUsd, GAS, MAX_DEX_SLIPPAGE_BPS, tokenTrustWarnings } from "./evmCommon.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const PAIR_CACHE_MS = 10 * 60_000;
const pairCache = new Map<string, { readonly pair: Address | null; readonly at: number }>();

function pathToken(venue: V2Venue, asset: ResolvedAsset): Address {
  if (asset.native) return venue.wrappedNative;
  if (!asset.address) throw engineError("ROUTE_UNSUPPORTED", `${asset.symbol} has no contract to swap on ${venue.label}.`);
  return asset.address;
}

/** The factory's pair for the path, proven both ways; null when none. */
async function pairOf(deps: EngineDeps, venue: V2Venue, a: Address, b: Address): Promise<Address | null> {
  const key = `${venue.id}:${[a.toLowerCase(), b.toLowerCase()].sort().join(":")}`;
  const cached = pairCache.get(key);
  if (cached && deps.clock.now() - cached.at < PAIR_CACHE_MS) return cached.pair;
  const pair = (await deps.evm.read(venue.network, { address: venue.factory, abi: V2_FACTORY_ABI, functionName: "getPair", args: [a, b] })).toLowerCase() as Address;
  let proven: Address | null = null;
  if (pair !== ZERO) {
    const factory = await deps.evm.read(venue.network, { address: pair, abi: V2_PAIR_ABI, functionName: "factory" });
    if (factory.toLowerCase() === venue.factory.toLowerCase()) proven = pair;
  }
  pairCache.set(key, { pair: proven, at: deps.clock.now() });
  return proven;
}

async function amountsOut(deps: EngineDeps, venue: V2Venue, amount: bigint, path: readonly Address[]): Promise<bigint> {
  const amounts = await deps.evm.read(venue.network, { address: venue.router, abi: V2_ROUTER_ABI, functionName: "getAmountsOut", args: [amount, [...path]] });
  const out = amounts.at(-1);
  if (out === undefined || out <= 0n) throw engineError("ROUTE_UNAVAILABLE", `${venue.label} quoted nothing for this pair.`);
  return out;
}

/** Calldata and msg.value of the router call for a direct path. */
export function v2SwapCalldata(input: { readonly nativeIn: boolean; readonly nativeOut: boolean; readonly amountIn: bigint; readonly minOut: bigint; readonly path: readonly Address[]; readonly to: Address; readonly deadline: bigint }): { readonly data: Hex; readonly value: bigint } {
  const path = [...input.path];
  if (input.nativeIn) return { data: encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "swapExactETHForTokens", args: [input.minOut, path, input.to, input.deadline] }), value: input.amountIn };
  if (input.nativeOut) return { data: encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "swapExactTokensForETH", args: [input.amountIn, input.minOut, path, input.to, input.deadline] }), value: 0n };
  return { data: encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "swapExactTokensForTokens", args: [input.amountIn, input.minOut, path, input.to, input.deadline] }), value: 0n };
}

export function createV2SwapAdapter(deps: EngineDeps, venue: V2Venue): ProtocolAdapter {
  const supports = (route: AdapterRoute): boolean => {
    if (route.kind !== "swap" || route.network !== venue.network || route.destinationNetwork !== venue.network) return false;
    const { input, output } = route;
    // Unverified tokens resolve only when the request named a venue; the plan warns (and refuses look-alikes).
    if (!input || !output || sameResolved(input, output)) return false;
    if (input.native && output.native) return false;
    const wrapped = (NETWORKS[venue.network] as { contracts?: { wrappedNative?: string | null } }).contracts?.wrappedNative?.toLowerCase();
    if ((input.native && output.address?.toLowerCase() === wrapped) || (output.native && input.address?.toLowerCase() === wrapped)) return false;
    return (input.native || input.address !== null) && (output.native || output.address !== null);
  };

  return {
    id: venue.id,
    protocols: [venue.id],
    label: venue.label,
    ...(venue.explicitOnly ? { explicitOnly: true } : {}),
    supports,
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      const output = action.output as ResolvedAsset;
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL", "The swap amount is zero.");
      const trust = tokenTrustWarnings([input, output]);
      const path = [pathToken(venue, input), pathToken(venue, output)];
      const pair = await pairOf(deps, venue, path[0] as Address, path[1] as Address);
      if (!pair) throw engineError("ROUTE_UNAVAILABLE", `${venue.label} has no ${input.symbol}/${output.symbol} pair.`);
      const out = await amountsOut(deps, venue, action.amount, path);
      const slippageBps = Math.max(1, Math.min(action.slippageBps, MAX_DEX_SLIPPAGE_BPS));
      const minimum = applySlippage(out, slippageBps);
      const account = action.account.address.toLowerCase() as Address;
      const approval = input.native || action.funded ? null : await approvalFor(deps, venue.network, { token: input.address as Address, symbol: input.symbol, owner: account, spender: venue.router, spenderLabel: venue.label, amount: action.amount, bestEffort: true });
      const needsApproval = !input.native && (action.funded || approval !== null);
      const warnings = [
        ...(NETWORKS[venue.network].environment === "testnet" ? [`${NETWORKS[venue.network].name} pool prices are test prices, not market prices; USD values use HyperCore mainnet reference mids.`] : []),
        ...(input.native || output.native ? [`${venue.label} wraps native HYPE into its own WETH (${venue.wrappedNative}), not canonical WHYPE.`] : []),
        ...trust,
      ];
      return {
        protocol: venue.id,
        kind: "swap",
        title: `Swap ${formatAmount(action.amount, input.decimals, input.symbol)} to ${output.symbol} on ${venue.label}`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, out, { minimum })],
        feesUsd: await feesUsd(deps, venue.network, GAS.v2Swap + (needsApproval ? GAS.approve : 0n)),
        estimatedSeconds: 2,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings,
        route: { variant: "v2:direct", slippageBps, plannedInput: action.amount.toString(), plannedMinimum: minimum.toString(), params: { venue: venue.id, pair, path: path.join(",") } },
        requestCount: needsApproval ? 2 : 1,
        floor: "onchain",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const inputAmount = step.inputs[0];
      const outputAmount = step.outputs[0];
      if (!inputAmount || !outputAmount) throw engineError("STEP_INVALID", "The swap step lost its amounts.");
      const input = assetOfAmount(inputAmount);
      const output = assetOfAmount(outputAmount);
      const account = stepAddress(step);
      const path = [pathToken(venue, input), pathToken(venue, output)];
      if (String(step.route?.params?.path ?? "") !== path.join(",")) throw engineError("STEP_INVALID", "The swap step lost its recorded path.");
      await assertBalance(deps, input, account, context.amount);
      const out = await amountsOut(deps, venue, context.amount, path);
      const minimum = applySlippage(out, step.route?.slippageBps ?? 50);
      const call = v2SwapCalldata({ nativeIn: input.native, nativeOut: output.native, amountIn: context.amount, minOut: minimum, path, to: account, deadline: deadlineFor(context.expiresAt) });
      const approval = input.native ? null : await approvalFor(deps, venue.network, { token: input.address as Address, symbol: input.symbol, owner: account, spender: venue.router, spenderLabel: venue.label, amount: context.amount });
      return {
        requests: [
          ...(approval ? [approval] : []),
          evmRequest(venue.network, account, venue.router, call.data, call.value, `Swap ${formatAmount(context.amount, input.decimals, input.symbol)} for at least ${formatAmount(minimum, output.decimals, output.symbol)} on ${venue.label}`),
        ],
        inputs: [amountOf(input, context.amount)],
        outputs: [amountOf(output, out, { minimum })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const pair = String(step.route?.params?.pair ?? "").toLowerCase();
      const output = step.outputs[0] as StepAmount;
      const outAsset = assetOfAmount(output);
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const logs = receipts.flatMap((receipt) => receipt.logs);
        if (eventsOf(logs, { address: pair, abi: V2_PAIR_ABI, eventName: "Swap" }).length === 0) {
          return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No Swap event from the recorded pair ${pair}.` } };
        }
        const credit = outAsset.native
          ? nativeUnwrapped(logs, venue.wrappedNative, venue.router)
          : erc20Credit(logs, outAsset.address as string, account);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `The swap delivered ${credit} base units of ${output.symbol}, below the guaranteed ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `Swap event from the ${venue.label} pair; ${formatAmount(credit, output.decimals, output.symbol)} credited.`, { url: explorerAddressUrl(step.network, pair) })],
        };
      });
      return result;
    },
  };
}
