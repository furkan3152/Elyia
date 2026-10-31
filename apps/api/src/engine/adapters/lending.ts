/**
 * Morpho-Blue style lending (supply and withdraw of a market's loan asset)
 * for one pinned core (Elyra lending on Elysium testnet). Markets are pinned
 * by id with their params, and the params must hash to the id
 * (`keccak256(abi.encode(MarketParams))`, Morpho's `Id`), so a wrong pin can
 * never touch another market; `market(id)` must answer with a created market.
 *
 * - deposit (supply): exact approval of the loan token to the core, then
 *   `supply(params, assets, 0, onBehalf = account, "")`.
 * - withdraw: `withdraw(params, assets, 0, account, account)`, or by shares
 *   (`params.all`: the whole position, read from `position(id, account)`).
 *   Refused when the market's free liquidity (supplied - borrowed) is short.
 *
 * Borrowing is not offered. Verification: the core's Supply / Withdraw event
 * for the market id and account, and the token Transfer.
 */
import { explorerAddressUrl, type StepAmount } from "@elyia/core";
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { MORPHO_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, eventsOf, verifyEvmReceipts } from "../verify.js";
import type { LendingMarket, LendingVenue } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { approvalFor, approveCall, assertBalance, evmRequest, feesUsd, GAS, simulateWithFunds } from "./evmCommon.js";

const SUPPLY_GAS = 180_000n;
const WITHDRAW_GAS = 160_000n;
/** Morpho virtual shares / assets (SharesMathLib). */
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

export function marketParamsOf(market: LendingMarket) {
  return { loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltv: market.lltv } as const;
}

/** Morpho's market id: keccak256(abi.encode(MarketParams)). */
export function marketIdOf(market: Pick<LendingMarket, "loanToken" | "collateralToken" | "oracle" | "irm" | "lltv">): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }], [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]),
  );
}

export function supplyCalldata(market: LendingMarket, assets: bigint, account: Address): Hex {
  return encodeFunctionData({ abi: MORPHO_ABI, functionName: "supply", args: [marketParamsOf(market), assets, 0n, account, "0x"] });
}

export function withdrawCalldata(market: LendingMarket, amount: { readonly assets: bigint } | { readonly shares: bigint }, account: Address): Hex {
  const [assets, shares] = "assets" in amount ? [amount.assets, 0n] : [0n, amount.shares];
  return encodeFunctionData({ abi: MORPHO_ABI, functionName: "withdraw", args: [marketParamsOf(market), assets, shares, account, account] });
}

/** Assets of `shares` (rounded down, as Morpho pays a withdrawal by shares). */
export function sharesToAssets(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

interface MarketState {
  readonly totalSupplyAssets: bigint;
  readonly totalSupplyShares: bigint;
  readonly totalBorrowAssets: bigint;
  readonly lastUpdate: bigint;
}

export function createLendingAdapter(deps: EngineDeps, venue: LendingVenue): ProtocolAdapter {
  const marketFor = (loanToken: string | null | undefined, requested?: unknown): LendingMarket | null => {
    const candidates = venue.markets.filter((market) => market.loanToken === loanToken?.toLowerCase());
    if (typeof requested === "string") return candidates.find((market) => market.id === requested.toLowerCase()) ?? null;
    return candidates[0] ?? null;
  };

  const supports = (route: AdapterRoute): boolean => {
    if ((route.kind !== "deposit" && route.kind !== "withdraw") || route.network !== venue.network || route.destinationNetwork !== venue.network) return false;
    const asset = route.kind === "deposit" ? route.input : route.output;
    return marketFor(asset?.address) !== null;
  };

  async function stateOf(market: LendingMarket): Promise<MarketState> {
    if (marketIdOf(market) !== market.id) throw engineError("VENUE_UNAVAILABLE", `The pinned ${venue.label} market params do not hash to market ${market.id}.`);
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, , lastUpdate] = await deps.evm.read(venue.network, { address: venue.core, abi: MORPHO_ABI, functionName: "market", args: [market.id] });
    if (lastUpdate === 0n) throw engineError("VENUE_UNAVAILABLE", `${venue.label} market ${market.id} is not created on-chain.`);
    return { totalSupplyAssets, totalSupplyShares, totalBorrowAssets, lastUpdate };
  }

  /**
   * Runs approve + supply as the account with the funds (eth_simulateV1). Some cores cap a
   * market's supply without exposing the cap (Elyra's USDC market sits at about 1M), so a
   * refused supply is caught here instead of in the wallet. Null when the network cannot simulate.
   */
  async function supplyAccepted(market: LendingMarket, account: Address, assets: bigint): Promise<boolean | null> {
    const simulated = await simulateWithFunds(deps, venue.network, {
      from: account,
      calls: [
        { from: account, to: market.loanToken, data: approveCall(venue.core, assets) },
        { from: account, to: venue.core, data: supplyCalldata(market, assets, account) },
      ],
      erc20: { token: market.loanToken, amount: assets, holder: venue.core },
    }).catch(() => null);
    if (!simulated) return null;
    return simulated.every((call) => call.status === "success");
  }

  async function positionShares(market: LendingMarket, account: Address): Promise<bigint> {
    const [supplyShares] = await deps.evm.read(venue.network, { address: venue.core, abi: MORPHO_ABI, functionName: "position", args: [market.id, account] });
    return supplyShares;
  }

  /** What a withdrawal pays out now (assets), refusing when the position or the free liquidity is short. */
  async function withdrawQuote(market: LendingMarket, account: Address, request: { readonly assets?: bigint; readonly all: boolean }, strict: boolean): Promise<{ readonly assets: bigint; readonly shares: bigint | null }> {
    const state = await stateOf(market);
    const shares = await positionShares(market, account).catch((error: unknown) => {
      if (strict) throw error;
      return null;
    });
    const held = shares === null ? null : sharesToAssets(shares, state.totalSupplyAssets, state.totalSupplyShares);
    const assets = request.all ? (held ?? 0n) : (request.assets ?? 0n);
    if (request.all && (shares === null || shares === 0n)) throw engineError("INSUFFICIENT_BALANCE", `You have nothing supplied to this ${venue.label} market.`);
    if (held !== null && !request.all && assets > held) throw engineError("INSUFFICIENT_BALANCE", `Your ${market.loanSymbol} position in this ${venue.label} market is ${formatAmount(held, market.loanDecimals, market.loanSymbol)}.`);
    const free = state.totalSupplyAssets - state.totalBorrowAssets;
    if (assets > free) throw engineError("ROUTE_UNAVAILABLE", `${venue.label}'s ${market.loanSymbol} market has ${formatAmount(free > 0n ? free : 0n, market.loanDecimals, market.loanSymbol)} free to withdraw right now (the rest is borrowed).`);
    return { assets, shares: request.all ? shares : null };
  }

  return {
    id: venue.id,
    protocols: [venue.id],
    label: venue.label,
    ...(venue.explicitOnly ? { explicitOnly: true } : {}),
    supports,
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const deposit = action.kind === "deposit";
      const asset = (deposit ? action.input : action.output) as ResolvedAsset;
      const market = marketFor(asset.address, action.params.market);
      if (!market) throw engineError("ROUTE_UNSUPPORTED", `${venue.label} has no pinned ${asset.symbol} market${typeof action.params.market === "string" ? ` ${action.params.market}` : ""}.`);
      const account = action.account.address.toLowerCase() as Address;
      const all = action.params.all === true;
      const common = {
        protocol: venue.id,
        kind: action.kind,
        mode: "wallet" as const,
        estimatedSeconds: 2,
        settlement: { kind: "same-network" as const, mechanism: "receipt" as const },
        floor: "onchain" as const,
      };
      if (deposit) {
        if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
        await stateOf(market);
        const accepted = await supplyAccepted(market, account, action.amount);
        if (accepted === false) throw engineError("ROUTE_UNAVAILABLE", `${venue.label} refuses a ${formatAmount(action.amount, asset.decimals, asset.symbol)} supply to its ${market.loanSymbol} market right now (a simulation reverts; the market is likely at its supply cap). Try a smaller amount.`);
        const approval = action.funded ? null : await approvalFor(deps, venue.network, { token: market.loanToken, symbol: market.loanSymbol, owner: account, spender: venue.core, spenderLabel: venue.label, amount: action.amount, bestEffort: true });
        const needsApproval = action.funded || approval !== null;
        return {
          ...common,
          title: `Lend ${formatAmount(action.amount, asset.decimals, asset.symbol)} on ${venue.label} (${market.loanSymbol}/${market.collateralSymbol} market)`,
          inputs: [amountOf(asset, action.amount)],
          outputs: [],
          feesUsd: await feesUsd(deps, venue.network, SUPPLY_GAS + (needsApproval ? GAS.approve : 0n)),
          warnings: [...venue.warnings, ...(accepted === null ? ["Elyia could not simulate this supply first (the network has no eth_simulateV1)."] : []), `Supplied ${market.loanSymbol} earns the market's interest and is lent to borrowers posting ${market.collateralSymbol} (LLTV ${Number(market.lltv / 10n ** 14n) / 100}%).`],
          route: { variant: "morpho:supply", slippageBps: 0, plannedInput: action.amount.toString(), params: { venue: venue.id, core: venue.core, market: market.id } },
          requestCount: needsApproval ? 2 : 1,
        };
      }
      const quote = await withdrawQuote(market, account, { assets: action.amount, all }, false);
      return {
        ...common,
        title: all ? `Withdraw all your ${asset.symbol} from ${venue.label}` : `Withdraw ${formatAmount(quote.assets, asset.decimals, asset.symbol)} from ${venue.label}`,
        inputs: [],
        outputs: [amountOf(asset, quote.assets, { minimum: quote.assets })],
        feesUsd: await feesUsd(deps, venue.network, WITHDRAW_GAS),
        warnings: [...venue.warnings],
        route: { variant: all ? "morpho:withdraw-all" : "morpho:withdraw", slippageBps: 0, plannedMinimum: quote.assets.toString(), params: { venue: venue.id, core: venue.core, market: market.id, all } },
        requestCount: 1,
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const marketId = String(step.route?.params?.market ?? "");
      const market = venue.markets.find((entry) => entry.id === marketId);
      if (!market || String(step.route?.params?.core ?? "") !== venue.core) throw engineError("STEP_INVALID", "The lending step lost its recorded market.");
      const account = stepAddress(step);
      if (step.kind === "deposit") {
        const input = assetOfAmount(step.inputs[0] as StepAmount);
        await assertBalance(deps, input, account, context.amount);
        await stateOf(market);
        const approval = await approvalFor(deps, venue.network, { token: market.loanToken, symbol: market.loanSymbol, owner: account, spender: venue.core, spenderLabel: venue.label, amount: context.amount });
        return {
          requests: [...(approval ? [approval] : []), evmRequest(venue.network, account, venue.core, supplyCalldata(market, context.amount, account), 0n, `Lend ${formatAmount(context.amount, input.decimals, input.symbol)} on ${venue.label}`)],
          inputs: [amountOf(input, context.amount)],
          outputs: [],
          warnings: [],
        };
      }
      const all = step.route?.params?.all === true;
      const output = assetOfAmount(step.outputs[0] as StepAmount);
      const planned = BigInt((step.outputs[0] as StepAmount).expected);
      const quote = await withdrawQuote(market, account, { assets: planned, all }, true);
      const data = quote.shares !== null ? withdrawCalldata(market, { shares: quote.shares }, account) : withdrawCalldata(market, { assets: quote.assets }, account);
      return {
        requests: [evmRequest(venue.network, account, venue.core, data, 0n, `Withdraw ${formatAmount(quote.assets, output.decimals, output.symbol)} from ${venue.label}`)],
        inputs: [],
        outputs: [amountOf(output, quote.assets, { minimum: all ? (quote.assets * 9_990n) / 10_000n : quote.assets })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const marketId = String(step.route?.params?.market ?? "").toLowerCase();
      const market = venue.markets.find((entry) => entry.id === marketId);
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        if (!market) return { failure: { code: "STEP_INVALID", message: "The lending step lost its market." } };
        const logs = receipts.flatMap((receipt) => receipt.logs);
        const deposit = step.kind === "deposit";
        const events = eventsOf(logs, { address: venue.core, abi: MORPHO_ABI, eventName: deposit ? "Supply" : "Withdraw" }).filter(
          (event) => String(event.args.id).toLowerCase() === marketId && String(event.args.onBehalf).toLowerCase() === account,
        );
        if (events.length === 0) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No ${deposit ? "Supply" : "Withdraw"} event for market ${marketId} and this account.` } };
        const moved = events.reduce((sum, event) => sum + (event.args.assets as bigint), 0n);
        if (deposit) {
          const planned = BigInt(step.inputs[0]?.expected ?? "0");
          if (moved < planned) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `${venue.label} recorded a supply of ${moved}, less than the ${planned} sent.` } };
          return { evidence: [evidence("settlement", step.network, context.now, `${venue.label} Supply of ${formatAmount(moved, market.loanDecimals, market.loanSymbol)} to market ${marketId.slice(0, 10)}….`, { url: explorerAddressUrl(step.network, venue.core) })] };
        }
        const output = step.outputs[0] as StepAmount;
        const credit = erc20Credit(logs, market.loanToken, account, venue.core);
        const floor = BigInt(output.minimum ?? output.expected);
        if (credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `${venue.label} paid ${credit}, below the ${floor} expected.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `${venue.label} Withdraw; ${formatAmount(credit, market.loanDecimals, market.loanSymbol)} paid to the account.`, { url: explorerAddressUrl(step.network, venue.core) })],
        };
      });
      return result;
    },
  };
}
