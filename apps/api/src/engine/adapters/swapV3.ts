/**
 * Concentrated-liquidity swaps (Uniswap V3 forks) for one pinned venue:
 * Kalos V3 on Elysium (SwapRouter v1, no quoter: quotes are eth_simulateV1
 * runs of the real swap) and HyperSwap V3 on HyperEVM (SwapRouter02 +
 * QuoterV2). Fee tiers are discovered with `factory.getPool` and every pool
 * must answer `factory()` with the pinned factory (look-alike pools never
 * route). The minimum output is encoded on-chain (`amountOutMinimum`).
 *
 * Native HYPE goes in as `msg.value` and comes out through
 * `multicall([exactInputSingle(recipient = router), unwrapWETH9(min, account)])`,
 * only through the router's own wrapped native (Kalos: canonical WHYPE;
 * HyperSwap: its own "Wrapped Ether", so only HyperSwap's pools of that token serve HYPE).
 */
import { applySlippage, explorerAddressUrl, NETWORKS, type StepAmount } from "@elyia/core";
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import { QUOTER_V2_ABI, SWAP_ROUTER_02_ABI, SWAP_ROUTER_V1_ABI, V3_FACTORY_ABI, V3_POOL_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, sameResolved, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, eventsOf, lowestPreparedFloor, nativeUnwrapped, verifyEvmReceipts } from "../verify.js";
import type { V3Venue } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { approvalFor, assertBalance, deadlineFor, evmRequest, feesUsd, GAS, MAX_DEX_SLIPPAGE_BPS, simulateWithFunds, approveCall, tokenTrustWarnings } from "./evmCommon.js";

const ZERO = "0x0000000000000000000000000000000000000000";
/** SwapRouter02: `recipient = address(2)` keeps the output in the router (for unwrapWETH9). */
const ROUTER02_THIS = "0x0000000000000000000000000000000000000002";
const POOL_CACHE_MS = 10 * 60_000;

interface PoolInfo {
  readonly pool: Address;
  readonly fee: number;
}

const poolCache = new Map<string, { readonly pools: readonly PoolInfo[]; readonly at: number }>();

function poolToken(venue: V3Venue, asset: ResolvedAsset): Address {
  if (asset.native) return venue.wrappedNative;
  if (!asset.address) throw engineError("ROUTE_UNSUPPORTED", `${asset.symbol} has no contract to swap on ${venue.label}.`);
  return asset.address;
}

/** Pools of the pair on the venue, factory-proven both ways, with liquidity. */
async function poolsOf(deps: EngineDeps, venue: V3Venue, a: Address, b: Address): Promise<readonly PoolInfo[]> {
  const key = `${venue.id}:${[a.toLowerCase(), b.toLowerCase()].sort().join(":")}`;
  const cached = poolCache.get(key);
  const now = deps.clock.now();
  if (cached && now - cached.at < POOL_CACHE_MS) return cached.pools;
  const pools: PoolInfo[] = [];
  for (const fee of venue.feeTiers) {
    const pool = (await deps.evm.read(venue.network, { address: venue.factory, abi: V3_FACTORY_ABI, functionName: "getPool", args: [a, b, fee] })).toLowerCase() as Address;
    if (pool === ZERO) continue;
    const [factory, liquidity] = await Promise.all([
      deps.evm.read(venue.network, { address: pool, abi: V3_POOL_ABI, functionName: "factory" }),
      deps.evm.read(venue.network, { address: pool, abi: V3_POOL_ABI, functionName: "liquidity" }),
    ]);
    if (factory.toLowerCase() !== venue.factory.toLowerCase() || liquidity === 0n) continue;
    pools.push({ pool, fee });
  }
  poolCache.set(key, { pools, at: now });
  return pools;
}

interface SwapShape {
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly fee: number;
  readonly amountIn: bigint;
  readonly minOut: bigint;
  readonly account: Address;
  readonly nativeIn: boolean;
  readonly nativeOut: boolean;
  readonly deadline: bigint;
}

/** Calldata of the swap call to the router, and its msg.value. */
export function swapCalldata(venue: V3Venue, shape: SwapShape): { readonly data: Hex; readonly value: bigint } {
  const value = shape.nativeIn ? shape.amountIn : 0n;
  if (venue.dialect === "router01") {
    const single = encodeFunctionData({
      abi: SWAP_ROUTER_V1_ABI,
      functionName: "exactInputSingle",
      args: [{ tokenIn: shape.tokenIn, tokenOut: shape.tokenOut, fee: shape.fee, recipient: shape.nativeOut ? venue.router : shape.account, deadline: shape.deadline, amountIn: shape.amountIn, amountOutMinimum: shape.minOut, sqrtPriceLimitX96: 0n }],
    });
    if (!shape.nativeOut) return { data: single, value };
    const unwrap = encodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, functionName: "unwrapWETH9", args: [shape.minOut, shape.account] });
    return { data: encodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, functionName: "multicall", args: [[single, unwrap]] }), value };
  }
  const single = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [{ tokenIn: shape.tokenIn, tokenOut: shape.tokenOut, fee: shape.fee, recipient: shape.nativeOut ? ROUTER02_THIS : shape.account, amountIn: shape.amountIn, amountOutMinimum: shape.minOut, sqrtPriceLimitX96: 0n }],
  });
  const calls: Hex[] = [single];
  if (shape.nativeOut) calls.push(encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: "unwrapWETH9", args: [shape.minOut, shape.account] }));
  return { data: encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: "multicall", args: [shape.deadline, calls] }), value };
}

/** amountOut from the router's return data (direct or the first multicall result). */
function amountOutOf(venue: V3Venue, data: Hex, multicall: boolean): bigint {
  if (venue.dialect === "router01" && !multicall) return decodeFunctionResult({ abi: SWAP_ROUTER_V1_ABI, functionName: "exactInputSingle", data });
  const results = decodeFunctionResult({ abi: venue.dialect === "router01" ? SWAP_ROUTER_V1_ABI : SWAP_ROUTER_02_ABI, functionName: "multicall", data }) as readonly Hex[];
  const first = results[0];
  if (!first) throw new Error("multicall returned nothing");
  return decodeFunctionResult({ abi: SWAP_ROUTER_V1_ABI, functionName: "exactInputSingle", data: first });
}

/** Expected output of swapping through one pool (QuoterV2 eth_call, or a simulation of the real swap). */
async function quote(deps: EngineDeps, venue: V3Venue, input: ResolvedAsset, output: ResolvedAsset, pool: PoolInfo, amount: bigint, account: Address): Promise<bigint | null> {
  const tokenIn = poolToken(venue, input);
  const tokenOut = poolToken(venue, output);
  if (venue.quoter) {
    const data = encodeFunctionData({ abi: QUOTER_V2_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn: amount, fee: pool.fee, sqrtPriceLimitX96: 0n }] });
    const result = await deps.evm.call(venue.network, { to: venue.quoter, data });
    if (!result.ok) return null;
    return (decodeFunctionResult({ abi: QUOTER_V2_ABI, functionName: "quoteExactInputSingle", data: result.data }) as readonly [bigint, bigint, number, bigint])[0];
  }
  const shape: SwapShape = { tokenIn, tokenOut, fee: pool.fee, amountIn: amount, minOut: 0n, account, nativeIn: input.native, nativeOut: output.native, deadline: BigInt(Math.floor(deps.clock.now() / 1000) + 600) };
  const swap = swapCalldata(venue, shape);
  const calls = [
    ...(input.native ? [] : [{ from: account, to: tokenIn, data: approveCall(venue.router, amount) }]),
    { from: account, to: venue.router, data: swap.data, value: swap.value },
  ];
  const simulated = await simulateWithFunds(deps, venue.network, {
    from: account,
    calls,
    nativeBalance: (input.native ? amount : 0n) + 10n ** 21n,
    ...(input.native ? {} : { erc20: { token: tokenIn, amount, holder: pool.pool } }),
  });
  const last = simulated?.at(-1);
  if (!simulated || !last || simulated.some((call) => call.status !== "success")) return null;
  return amountOutOf(venue, last.returnData, venue.dialect === "router01" && output.native);
}

function slippageOf(requested: number): number {
  return Math.max(1, Math.min(requested, MAX_DEX_SLIPPAGE_BPS));
}

function testnetWarning(venue: V3Venue): string {
  return `${NETWORKS[venue.network].name} pool prices are test prices, not market prices; USD values use HyperCore mainnet reference mids.`;
}

function nativeWarning(venue: V3Venue, input: ResolvedAsset, output: ResolvedAsset): string[] {
  if (venue.canonicalWrapped || (!input.native && !output.native)) return [];
  return [`${venue.label} routes native HYPE through its own wrapped token (${venue.wrappedNative}), not WHYPE; only its pools of that token are used.`];
}

export function createV3SwapAdapter(deps: EngineDeps, venue: V3Venue): ProtocolAdapter {
  const supports = (route: AdapterRoute): boolean => {
    if (route.kind !== "swap" || route.network !== venue.network || route.destinationNetwork !== venue.network) return false;
    const { input, output } = route;
    if (!input || !output || sameResolved(input, output) || input.network !== venue.network || output.network !== venue.network) return false;
    if (!input.native && !input.address) return false;
    if (!output.native && !output.address) return false;
    // HYPE <-> canonical WHYPE is a wrap, not a swap.
    const wrapped = NETWORKS[venue.network].vm === "evm" ? (NETWORKS[venue.network] as { contracts: { wrappedNative: string | null } }).contracts.wrappedNative?.toLowerCase() : null;
    if ((input.native && output.address?.toLowerCase() === wrapped) || (output.native && input.address?.toLowerCase() === wrapped)) return false;
    // Unverified tokens resolve only when the request named a venue; the plan warns (and refuses look-alikes).
    return true;
  };

  async function bestPool(input: ResolvedAsset, output: ResolvedAsset, amount: bigint, account: Address, onlyFee?: number): Promise<{ readonly pool: PoolInfo; readonly out: bigint }> {
    const pools = (await poolsOf(deps, venue, poolToken(venue, input), poolToken(venue, output))).filter((pool) => onlyFee === undefined || pool.fee === onlyFee);
    if (pools.length === 0) throw engineError("ROUTE_UNAVAILABLE", `${venue.label} has no ${input.symbol}/${output.symbol} pool with liquidity${onlyFee !== undefined ? ` in the ${onlyFee / 10_000}% tier` : ""}.`);
    let best: { pool: PoolInfo; out: bigint } | null = null;
    for (const pool of pools) {
      const out = await quote(deps, venue, input, output, pool, amount, account).catch(() => null);
      if (out !== null && out > 0n && (!best || out > best.out)) best = { pool, out };
    }
    if (!best) throw engineError("ROUTE_UNAVAILABLE", `${venue.label} could not quote ${formatAmount(amount, input.decimals, input.symbol)} to ${output.symbol} right now.`);
    return best;
  }

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
      const account = action.account.address.toLowerCase() as Address;
      const best = await bestPool(input, output, action.amount, account);
      const slippageBps = slippageOf(action.slippageBps);
      const minimum = applySlippage(best.out, slippageBps);
      const approval = input.native || action.funded ? null : await approvalFor(deps, venue.network, { token: input.address as Address, symbol: input.symbol, owner: account, spender: venue.router, spenderLabel: venue.label, amount: action.amount, bestEffort: true });
      const needsApproval = !input.native && (action.funded || approval !== null);
      return {
        protocol: venue.id,
        kind: "swap",
        title: `Swap ${formatAmount(action.amount, input.decimals, input.symbol)} to ${output.symbol} on ${venue.label}`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, best.out, { minimum })],
        feesUsd: await feesUsd(deps, venue.network, GAS.v3Swap + (needsApproval ? GAS.approve : 0n)),
        estimatedSeconds: venue.network.startsWith("elysium") ? 2 : 4,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings: [...(NETWORKS[venue.network].environment === "testnet" ? [testnetWarning(venue)] : []), ...nativeWarning(venue, input, output), ...trust],
        route: { variant: `v3:${best.pool.fee}`, slippageBps, plannedInput: action.amount.toString(), plannedMinimum: minimum.toString(), params: { venue: venue.id, pool: best.pool.pool, fee: best.pool.fee } },
        requestCount: needsApproval ? 2 : 1,
        floor: "onchain",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const inputAmount = step.inputs[0];
      const outputAmount = step.outputs[0];
      const fee = Number(step.route?.params?.fee);
      if (!inputAmount || !outputAmount || !Number.isInteger(fee)) throw engineError("STEP_INVALID", "The swap step lost its recorded route.");
      const input = assetOfAmount(inputAmount);
      const output = assetOfAmount(outputAmount);
      const account = stepAddress(step);
      await assertBalance(deps, input, account, context.amount);
      // Prepare re-quotes the recorded pool (fee tier), never a fresh search.
      const best = await bestPool(input, output, context.amount, account, fee);
      const slippageBps = step.route?.slippageBps ?? 50;
      const minimum = applySlippage(best.out, slippageBps);
      const tokenIn = poolToken(venue, input);
      const swap = swapCalldata(venue, { tokenIn, tokenOut: poolToken(venue, output), fee, amountIn: context.amount, minOut: minimum, account, nativeIn: input.native, nativeOut: output.native, deadline: deadlineFor(context.expiresAt) });
      const approval = input.native ? null : await approvalFor(deps, venue.network, { token: tokenIn, symbol: input.symbol, owner: account, spender: venue.router, spenderLabel: venue.label, amount: context.amount });
      return {
        requests: [
          ...(approval ? [approval] : []),
          evmRequest(venue.network, account, venue.router, swap.data, swap.value, `Swap ${formatAmount(context.amount, input.decimals, input.symbol)} for at least ${formatAmount(minimum, output.decimals, output.symbol)} on ${venue.label}`),
        ],
        inputs: [amountOf(input, context.amount)],
        outputs: [amountOf(output, best.out, { minimum })],
        warnings: nativeWarning(venue, input, output),
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const pool = String(step.route?.params?.pool ?? "").toLowerCase();
      const output = step.outputs[0] as StepAmount;
      const outAsset = assetOfAmount(output);
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const logs = receipts.flatMap((receipt) => receipt.logs);
        const swaps = eventsOf(logs, { address: pool, abi: V3_POOL_ABI, eventName: "Swap" });
        if (swaps.length === 0) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No Swap event from the recorded pool ${pool}.` } };
        const credit = outAsset.native
          ? nativeUnwrapped(logs, venue.wrappedNative, venue.router)
          : erc20Credit(logs, outAsset.address as string, account);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `The swap delivered ${credit} base units of ${output.symbol}, below the guaranteed ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `Swap event from ${venue.label} pool; ${formatAmount(credit, output.decimals, output.symbol)} credited.`, { url: explorerAddressUrl(step.network, pool) })],
        };
      });
      return result;
    },
  };
}
