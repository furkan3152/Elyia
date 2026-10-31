/**
 * HyperEVM <-> HyperCore link through the system addresses.
 *
 * EVM -> Core (wallet transaction on HyperEVM):
 * - native HYPE: value transfer to 0x2222…2222;
 * - USDC: exact `approve(CoreDepositWallet)` + `CoreDepositWallet.deposit(amount, dex)`
 *   (dex 0 = perps margin, 4294967295 = spot); the wallet is the token
 *   `spotMeta` links to Core USDC and its `token()` must be the registry USDC;
 * - other linked tokens: ERC-20 `transfer` to `0x20…<index>`; the amount
 *   must convert exactly into Core wei (`evm_extra_wei_decimals`), else the
 *   remainder would be burned, so it is rounded down and the dust stays.
 * Core -> EVM (user-signed `spotSend` to the token's system address); the
 * EVM credit arrives with the next HyperEVM block.
 *
 * The Core and EVM credits carry no reference to the source, so settlement
 * is proven by a ledger entry when HyperCore records one, else by the
 * balance increase over the reading taken at prepare (said so in evidence).
 */
import {
  coreWeiToEvmUnits,
  evmUnitsToCoreWei,
  HYPE_SYSTEM_ADDRESS,
  hypercore,
  marginAssetId,
  nativeToken,
  NETWORKS,
  spotAssetId,
  spotSystemAddress,
  tokenByAddress,
  type NetworkKey,
  type StepAmount,
} from "@elyia/core";
import { encodeFunctionData, type Address } from "viem";
import { CORE_DEPOSIT_WALLET_ABI, erc20Abi } from "../abis.js";
import { amountOf, assetOfAmount, coreTokenInfo, formatAmount, fromToken, resolveAsset, stepAddress, type CoreTokenInfo, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { decimalUnits, HYPERCORE_STALE_MS, verifyUserSigned } from "../hypercore/verify.js";
import { userSignedContext, userSignedRequest } from "../hypercore/requests.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type SettlementResult, type VerifyContext } from "../types.js";
import { erc20Credit, verifyEvmReceipts } from "../verify.js";
import { CORE_DEPOSIT_WALLET, CORE_DEX_PERPS, CORE_DEX_SPOT } from "../venues.js";
import { approvalFor, assertBalance, balanceOf, evmRequest, feesUsd, GAS } from "./evmCommon.js";
import { unitsToDecimal } from "./hypercoreTrade.js";
import { tokenString } from "./hypercoreWallet.js";

const ZERO = "0x0000000000000000000000000000000000000000";

type LinkKind = "hype" | "usdc" | "erc20";

interface EvmToCoreRoute {
  readonly kind: LinkKind;
  readonly core: CoreTokenInfo;
  /** Where the EVM transaction goes: the system address or the CoreDepositWallet. */
  readonly target: Address;
  readonly extraWeiDecimals: number;
}

function coreNetworkOf(network: NetworkKey): NetworkKey {
  return NETWORKS[network].environment === "testnet" ? "hypercore-testnet" : "hypercore-mainnet";
}

function evmNetworkOf(network: NetworkKey): NetworkKey {
  const descriptor = NETWORKS[network];
  if (descriptor.vm !== "hypercore") throw engineError("ROUTE_UNSUPPORTED", `${network} is not HyperCore.`);
  return descriptor.evm;
}

/** Which Core token an EVM asset links to, read from the live spotMeta (never assumed). */
async function evmToCoreRoute(deps: EngineDeps, asset: ResolvedAsset): Promise<EvmToCoreRoute> {
  const coreNetwork = coreNetworkOf(asset.network);
  const meta = await deps.core.spotMeta(coreNetwork);
  if (asset.native) {
    const name = NETWORKS[asset.network].vm === "evm" ? "HYPE" : asset.symbol;
    const core = coreTokenInfo(meta, (token) => token.name === name && token.evmContract !== null && token.evmContract.address.toLowerCase() === ZERO);
    if (!core || !core.evmContract) throw engineError("CORE_LINK_UNLINKED_TOKEN", "HyperCore HYPE is not linked to native HYPE here.");
    return { kind: "hype", core, target: HYPE_SYSTEM_ADDRESS as Address, extraWeiDecimals: core.evmContract.extraWeiDecimals };
  }
  const address = asset.address?.toLowerCase();
  if (!address) throw engineError("CORE_LINK_UNLINKED_TOKEN");
  const wallet = CORE_DEPOSIT_WALLET[asset.network];
  if (wallet) {
    const usdc = coreTokenInfo(meta, (token) => token.index === 0);
    if (usdc?.evmContract && usdc.evmContract.address === wallet) {
      const underlying = (await deps.evm.read(asset.network, { address: wallet, abi: CORE_DEPOSIT_WALLET_ABI, functionName: "token" })).toLowerCase();
      if (underlying === address) return { kind: "usdc", core: usdc, target: wallet, extraWeiDecimals: usdc.evmContract.extraWeiDecimals };
    }
  }
  const linked = coreTokenInfo(meta, (token) => token.evmContract !== null && token.evmContract.address.toLowerCase() === address);
  if (!linked || !linked.evmContract) throw engineError("CORE_LINK_UNLINKED_TOKEN", `${asset.symbol} on ${NETWORKS[asset.network].name} is not linked to a HyperCore token.`);
  return { kind: "erc20", core: linked, target: spotSystemAddress(linked.index) as Address, extraWeiDecimals: linked.evmContract.extraWeiDecimals };
}

/** The EVM asset a Core spot token arrives as (native HYPE, the CoreDepositWallet's USDC, or the linked ERC-20). */
async function coreToEvmAsset(deps: EngineDeps, coreNetwork: NetworkKey, core: CoreTokenInfo): Promise<{ readonly asset: ResolvedAsset; readonly system: Address }> {
  const evmNetwork = evmNetworkOf(coreNetwork);
  if (!core.evmContract) throw engineError("CORE_LINK_UNLINKED_TOKEN", `HyperCore ${core.name} is not linked to HyperEVM.`);
  if (core.evmContract.address === ZERO) {
    const native = nativeToken(evmNetwork);
    if (!native) throw engineError("CORE_LINK_UNLINKED_TOKEN");
    return { asset: fromToken(native), system: HYPE_SYSTEM_ADDRESS as Address };
  }
  const wallet = CORE_DEPOSIT_WALLET[evmNetwork];
  const address = core.index === 0 && wallet && core.evmContract.address === wallet
    ? (await deps.evm.read(evmNetwork, { address: wallet, abi: CORE_DEPOSIT_WALLET_ABI, functionName: "token" })).toLowerCase()
    : core.evmContract.address;
  const token = tokenByAddress(evmNetwork, address);
  if (!token) throw engineError("TOKEN_UNVERIFIED", `HyperCore ${core.name} links to ${address}, which is not in Elyia's verified list.`);
  return { asset: fromToken(token), system: spotSystemAddress(core.index) as Address };
}

/** Rounds EVM units down to what Core can represent exactly. */
export function exactLinkUnits(units: bigint, extraWeiDecimals: number): bigint {
  if (extraWeiDecimals <= 0) return units;
  const step = 10n ** BigInt(extraWeiDecimals);
  return units - (units % step);
}

async function coreBalance(deps: EngineDeps, coreNetwork: NetworkKey, user: string, outputAsset: string, symbol: string): Promise<string> {
  if (outputAsset === marginAssetId(coreNetwork)) {
    const state = await deps.core.clearinghouseState(coreNetwork, user);
    return state.withdrawable;
  }
  const state = await deps.core.spotClearinghouseState(coreNetwork, user);
  return state.balances.find((balance) => balance.coin === symbol)?.total ?? "0";
}

export function createHypercoreLinkAdapter(deps: EngineDeps): ProtocolAdapter {
  const supports = (route: AdapterRoute): boolean => {
    if (route.kind !== "link" || !route.input) return false;
    const from = NETWORKS[route.network];
    const to = NETWORKS[route.destinationNetwork];
    if (from.environment !== to.environment) return false;
    return (from.vm === "evm" && from.family === "hyperevm" && to.vm === "hypercore") || (from.vm === "hypercore" && to.vm === "evm" && to.family === "hyperevm");
  };

  async function planToCore(action: AdapterAction): Promise<PlannedStep> {
    const input = action.input as ResolvedAsset;
    const link = await evmToCoreRoute(deps, input);
    const coreNetwork = action.destinationNetwork;
    const units = exactLinkUnits(action.amount, link.extraWeiDecimals);
    if (units <= 0n) throw engineError("AMOUNT_TOO_SMALL", "The amount rounds to zero on HyperCore.");
    const wei = evmUnitsToCoreWei(units, link.extraWeiDecimals);
    const toSpot = link.kind !== "usdc" || action.params.dex === "spot";
    const output: StepAmount = toSpot
      ? { asset: spotAssetId(coreNetwork, link.core.index), symbol: link.core.name, decimals: link.core.weiDecimals, expected: wei.toString(), minimum: wei.toString() }
      : { asset: marginAssetId(coreNetwork), symbol: "USDC", decimals: 6, expected: units.toString(), minimum: units.toString() };
    const warnings = units < action.amount ? [`Rounded to ${formatAmount(units, input.decimals, input.symbol)}: HyperCore keeps fewer decimals and would burn the rest.`] : [];
    const gas = link.kind === "hype" ? GAS.transfer : link.kind === "usdc" ? GAS.coreDeposit + GAS.approve : GAS.erc20Transfer;
    return {
      protocol: "hyperevm-core-link",
      kind: "link",
      title: `Move ${formatAmount(units, input.decimals, input.symbol)} from HyperEVM to HyperCore ${toSpot ? "spot" : "perps"}`,
      mode: "wallet",
      inputs: [amountOf(input, units)],
      outputs: [output],
      feesUsd: await feesUsd(deps, action.network, gas),
      estimatedSeconds: 10,
      settlement: { kind: "cross-network", destinationNetwork: coreNetwork, mechanism: "core-link", expectedSeconds: 10 },
      warnings,
      route: {
        variant: `evm-to-core:${link.kind}`,
        slippageBps: 0,
        plannedInput: units.toString(),
        plannedMinimum: output.minimum ?? output.expected,
        params: { target: link.target, coreIndex: link.core.index, extraWeiDecimals: link.extraWeiDecimals, dex: toSpot ? CORE_DEX_SPOT : CORE_DEX_PERPS },
      },
      requestCount: link.kind === "usdc" ? 2 : 1,
      floor: "onchain",
    };
  }

  async function planToEvm(action: AdapterAction): Promise<PlannedStep> {
    const input = action.input as ResolvedAsset;
    if (!input.core) throw engineError("TOKEN_UNKNOWN", `${input.symbol} is not a HyperCore spot token.`);
    const { asset, system } = await coreToEvmAsset(deps, action.network, input.core);
    const extra = input.core.evmContract?.extraWeiDecimals ?? 0;
    // Core wei -> EVM units must be exact (USDC: 8 -> 6 decimals).
    const step = extra < 0 ? 10n ** BigInt(-extra) : 1n;
    const wei = action.amount - (action.amount % step);
    if (wei <= 0n) throw engineError("AMOUNT_TOO_SMALL");
    const units = coreWeiToEvmUnits(wei, extra);
    return {
      protocol: "hyperevm-core-link",
      kind: "link",
      title: `Move ${formatAmount(wei, input.decimals, input.symbol)} from HyperCore to HyperEVM`,
      mode: "wallet",
      inputs: [amountOf(input, wei)],
      outputs: [amountOf(asset, units, { minimum: (units * 999n) / 1000n })],
      feesUsd: "0",
      estimatedSeconds: 15,
      settlement: { kind: "cross-network", destinationNetwork: action.destinationNetwork, mechanism: "core-link", expectedSeconds: 15 },
      warnings: ["HyperCore -> HyperEVM transfers arrive with the next HyperEVM block and pay a small fee in HYPE on HyperCore."],
      route: { variant: "core-to-evm", slippageBps: 10, plannedInput: wei.toString(), plannedMinimum: ((units * 999n) / 1000n).toString(), params: { system, coreIndex: input.core.index, extraWeiDecimals: extra } },
      requestCount: 1,
      floor: "claimed",
    };
  }

  async function prepareToCore(context: PrepareContext): Promise<PreparedPayload> {
    const { step } = context;
    const input = assetOfAmount(step.inputs[0] as StepAmount);
    const account = stepAddress(step);
    const params = step.route?.params ?? {};
    const extra = Number(params.extraWeiDecimals ?? 0);
    const units = exactLinkUnits(context.amount, extra);
    if (units <= 0n) throw engineError("AMOUNT_TOO_SMALL");
    // Re-check the link: the spotMeta link and the CoreDepositWallet's token must still be what was planned.
    const link = await evmToCoreRoute(deps, input);
    if (link.target.toLowerCase() !== String(params.target).toLowerCase()) throw engineError("STEP_INVALID", "The HyperCore link of this token changed since planning.");
    await assertBalance(deps, input, account, units);
    const output = step.outputs[0] as StepAmount;
    const observed = { coreBalance: await coreBalance(deps, step.settlement?.destinationNetwork ?? coreNetworkOf(step.network), account, output.asset, output.symbol) };
    const requests = [];
    if (link.kind === "hype") {
      requests.push(evmRequest(step.network, account, link.target, "0x", units, `Send ${formatAmount(units, 18, "HYPE")} to the HyperCore system address`));
    } else if (link.kind === "usdc") {
      const approval = await approvalFor(deps, step.network, { token: input.address as Address, symbol: input.symbol, owner: account, spender: link.target, spenderLabel: "the Core deposit wallet", amount: units });
      if (approval) requests.push(approval);
      const data = encodeFunctionData({ abi: CORE_DEPOSIT_WALLET_ABI, functionName: "deposit", args: [units, Number(params.dex ?? CORE_DEX_PERPS)] });
      requests.push(evmRequest(step.network, account, link.target, data, 0n, `Deposit ${formatAmount(units, input.decimals, "USDC")} to HyperCore ${Number(params.dex) === CORE_DEX_SPOT ? "spot" : "perps"}`));
    } else {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [link.target, units] });
      requests.push(evmRequest(step.network, account, input.address as Address, data, 0n, `Send ${formatAmount(units, input.decimals, input.symbol)} to its HyperCore system address`));
    }
    // Perp margin is counted in USDC (6 decimals); spot balances in Core wei.
    const wei = output.asset.endsWith("/margin:usdc") ? units : evmUnitsToCoreWei(units, extra);
    return {
      requests,
      inputs: [amountOf(input, units)],
      outputs: [{ ...output, expected: wei.toString(), minimum: wei.toString() }],
      warnings: units < context.amount ? ["The dust HyperCore cannot represent stays in your wallet."] : [],
      observed,
    };
  }

  async function prepareToEvm(context: PrepareContext): Promise<PreparedPayload> {
    const { step } = context;
    const inputAmount = step.inputs[0] as StepAmount;
    const input = await resolveAsset(deps, step.network, inputAmount.asset);
    const params = step.route?.params ?? {};
    const extra = Number(params.extraWeiDecimals ?? 0);
    const stepUnit = extra < 0 ? 10n ** BigInt(-extra) : 1n;
    const wei = context.amount - (context.amount % stepUnit);
    if (wei <= 0n) throw engineError("AMOUNT_TOO_SMALL");
    const account = stepAddress(step);
    const spot = await deps.core.spotClearinghouseState(step.network, account);
    const held = spot.balances.find((balance) => balance.coin === input.symbol);
    const available = held ? decimalUnits(held.total, input.decimals) - decimalUnits(held.hold, input.decimals) : 0n;
    if (available < wei) throw engineError("INSUFFICIENT_BALANCE", `HyperCore spot holds ${held?.total ?? "0"} ${input.symbol} (${held?.hold ?? "0"} on hold), less than this needs.`);
    const output = step.outputs[0] as StepAmount;
    const outAsset = assetOfAmount(output);
    const evmNetwork = step.settlement?.destinationNetwork ?? evmNetworkOf(step.network);
    const observed = { evmBalance: (await balanceOf(deps, { ...outAsset, network: evmNetwork }, account)).toString() };
    const action = hypercore.spotSendAction(userSignedContext(step.network, context.signatureChainId), {
      destination: String(params.system),
      token: tokenString(input),
      amount: unitsToDecimal(wei, input.decimals),
      time: deps.nonces.next(),
    });
    const units = coreWeiToEvmUnits(wei, extra);
    return {
      requests: [userSignedRequest(step.network, account, action, `Send ${formatAmount(wei, input.decimals, input.symbol)} from HyperCore to your HyperEVM wallet`)],
      inputs: [{ ...inputAmount, expected: wei.toString() }],
      outputs: [{ ...output, expected: units.toString(), minimum: ((units * 999n) / 1000n).toString() }],
      warnings: [],
      observed,
    };
  }

  async function verifyToCore(context: VerifyContext) {
    const { step } = context;
    const account = stepAddress(step);
    const target = String(step.route?.params?.target ?? "").toLowerCase();
    const variant = step.route?.variant ?? "";
    const input = step.inputs[0] as StepAmount;
    const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
      const logs = receipts.flatMap((receipt) => receipt.logs);
      if (variant.endsWith(":usdc") || variant.endsWith(":erc20")) {
        const token = assetOfAmount(input).address as string;
        const moved = erc20Credit(logs, token, target, account);
        if (moved < BigInt(input.expected)) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `Only ${moved} base units of ${input.symbol} reached the HyperCore link.` } };
      }
      return { settled: false, settlement: { state: "crediting" as const }, evidence: [evidence("note", step.network, context.now, "Sent to HyperCore; waiting for the HyperCore credit.")] };
    });
    return result;
  }

  async function pollToCore(step: Parameters<NonNullable<ProtocolAdapter["poll"]>>[0], now: number): Promise<SettlementResult> {
    const coreNetwork = step.settlement?.destinationNetwork ?? coreNetworkOf(step.network);
    const output = step.outputs[0] as StepAmount;
    const account = stepAddress(step);
    const before = step.prepared?.observed?.coreBalance;
    if (before === undefined) return { status: "settling", evidence: [] };
    const current = await coreBalance(deps, coreNetwork, account, output.asset, output.symbol);
    const credited = decimalUnits(current, output.decimals) - decimalUnits(before, output.decimals);
    const expected = BigInt(output.minimum ?? output.expected);
    if (credited >= expected) {
      return {
        status: "settled",
        actualOutputs: [{ ...output, expected: expected.toString(), minimum: expected.toString() }],
        evidence: [evidence("balance", coreNetwork, now, `HyperCore ${output.symbol} rose from ${before} to ${current} (balance reading; HyperCore records no source for this credit).`)],
      };
    }
    const submitted = Date.parse(step.prepared?.preparedAt ?? new Date(now).toISOString());
    if (now - submitted > HYPERCORE_STALE_MS) {
      return { status: "failed", review: true, evidence: [], failure: { code: "SETTLEMENT_TIMEOUT", message: "HyperCore has not shown the credit for 10 minutes; held for review." } };
    }
    return { status: "settling", evidence: [] };
  }

  async function pollToEvm(step: Parameters<NonNullable<ProtocolAdapter["poll"]>>[0], now: number): Promise<SettlementResult> {
    const evmNetwork = step.settlement?.destinationNetwork ?? evmNetworkOf(step.network);
    const output = step.outputs[0] as StepAmount;
    const account = stepAddress(step);
    const before = step.prepared?.observed?.evmBalance;
    if (before === undefined) return { status: "settling", evidence: [] };
    const asset = assetOfAmount(output);
    const current = await balanceOf(deps, asset, account);
    const credited = current - BigInt(before);
    const minimum = BigInt(output.minimum ?? output.expected);
    if (credited >= minimum) {
      const value = credited > BigInt(output.expected) ? BigInt(output.expected) : credited;
      return {
        status: "settled",
        actualOutputs: [{ ...output, expected: value.toString(), minimum: value.toString() }],
        evidence: [evidence("balance", evmNetwork, now, `HyperEVM ${output.symbol} balance rose by ${formatAmount(credited, output.decimals, output.symbol)} (balance reading; the system credit carries no reference).`)],
      };
    }
    const submitted = Date.parse(step.prepared?.preparedAt ?? new Date(now).toISOString());
    if (now - submitted > HYPERCORE_STALE_MS) {
      return { status: "failed", review: true, evidence: [], failure: { code: "SETTLEMENT_TIMEOUT", message: "HyperEVM has not shown the credit for 10 minutes; held for review." } };
    }
    return { status: "settling", evidence: [] };
  }

  return {
    id: "hyperevm-core-link",
    protocols: ["hyperevm-core-link"],
    label: "HyperEVM ↔ HyperCore link",
    supports,
    plan: (action) => (NETWORKS[action.network].vm === "evm" ? planToCore(action) : planToEvm(action)),
    prepare: (context) => (NETWORKS[context.step.network].vm === "evm" ? prepareToCore(context) : prepareToEvm(context)),
    async verify(context) {
      if (NETWORKS[context.step.network].vm === "evm") return verifyToCore(context);
      const result = await verifyUserSigned(deps, context);
      if (result.status !== "confirmed") return result;
      return { ...result, settled: false, settlement: { state: "crediting" } };
    },
    poll: (step, _graph, now) => (NETWORKS[step.network].vm === "evm" ? pollToCore(step, now) : pollToEvm(step, now)),
  };
}

