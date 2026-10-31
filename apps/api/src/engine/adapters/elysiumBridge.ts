/**
 * The Elysium canonical (Arbitrum Orbit) bridge between HyperEVM and
 * Elysium, and the Kinetiq mirror bridge for Elysium-native tokens.
 *
 * Deposits (HyperEVM -> Elysium):
 * - native HYPE: `Inbox.depositEth{value}()`, credited to the same address
 *   on Elysium as a kind-12 message whose L2 transaction id is derived from
 *   `MessageDelivered` + `InboxMessageDelivered` (orbit/math.ts, verified on
 *   live deposits);
 * - ERC-20: exact approval of `L1GatewayRouter.getGateway(token)`, then
 *   `outboundTransferCustomRefund` sized from the Inbox submission fee and a
 *   NodeInterface gas estimate (with headroom). The retryable ticket is
 *   followed to its auto-redeem; when that failed (NEEDS_REDEEM, frequent on
 *   testnet) the engine appends an `ArbRetryableTx.redeem(ticket)` step
 *   anyone can send before the ticket expires (7 days).
 * Withdrawals (Elysium -> HyperEVM): `ArbSys.withdrawEth(destination)` or
 * `L2GatewayRouter.outboundTransfer(l1Token, to, amount, 0, 0, "")`; the step
 * settles when the rollup confirmed the message (`confirmPeriodBlocks` read
 * on-chain), then the claim step runs `Outbox.executeTransaction` with the
 * NodeInterface proof.
 * Mirror (Elysium-native token -> HyperEVM, explicit only):
 * `createL2Wallet` and `createAndRegisterL1Mirror` once per token, then an
 * exact approval of the escrow wallet and `outboundTransfer(mirror, …)`,
 * then the same claim, which mints the mirror on HyperEVM.
 */
import {
  counterpartToken,
  erc20AssetId,
  explorerTxUrl,
  getEvmNetwork,
  NETWORKS,
  sameOwner,
  type IntentGraph,
  type IntentStep,
  type NetworkKey,
  type StepAmount,
  type StepSettlement,
} from "@elyia/core";
import { encodeAbiParameters, encodeFunctionData, toEventSelector, type Address, type Hex } from "viem";
import {
  ARB_RETRYABLE_TX_ABI,
  ARB_SYS_ABI,
  ELYSIUM_BRIDGE_FACTORY_ABI,
  ELYSIUM_MIRROR_FACTORY_ABI,
  ERC20_METADATA_ABI,
  INBOX_ABI,
  L1_GATEWAY_ABI,
  L1_GATEWAY_ROUTER_ABI,
  L2_GATEWAY_ABI,
  L2_GATEWAY_ROUTER_ABI,
  NODE_INTERFACE_ABI,
  OUTBOX_ABI,
} from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, fromToken, nativeAsset, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { ethDepositTxId, L1_MESSAGE_KIND, parseEthDepositData, parseRetryableData, retryableFees, retryableTicketId } from "../orbit/math.js";
import {
  ARB_RETRYABLE_TX_ADDRESS,
  ARB_SYS_ADDRESS,
  confirmedSendCount,
  confirmPeriodBlocks,
  deliveredMessages,
  l2ToL1Messages,
  NODE_INTERFACE_ADDRESS,
  orbitPair,
  outboxProof,
  outboxSpent,
  withdrawalSeconds,
  type OrbitPair,
} from "../orbit/reads.js";
import { ReferencePrices } from "../prices.js";
import { evidence, type AdapterAction, type AdapterRoute, type FollowUpStep, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type SettlementResult, type VerificationResult, type VerifyContext } from "../types.js";
import { erc20Credit, eventsOf, failed, firstPreparedAt, verifyEvmReceipts } from "../verify.js";
import { approvalFor, assertBalance, evmRequest, feesUsd, GAS } from "./evmCommon.js";

const ZERO = "0x0000000000000000000000000000000000000000";
/** Deposits land on Elysium in about 1-2 minutes (sequencer reading the delayed inbox). */
export const DEPOSIT_SECONDS = 120;
/** Mirror registration retryables: reported keeper parameters (CorePad ops/keeper). */
const MIRROR_MAX_SUBMISSION = 400_000_000_000_000n;
const MIRROR_MAX_GAS = 300_000n;
/** Retryables live this long on Elysium (ArbRetryableTx.getLifetime()). */
const RETRYABLE_LIFETIME_MS = 604_800_000;
/** A settling deposit unseen this long goes to review. */
const DEPOSIT_REVIEW_MS = 3 * 60 * 60 * 1000;
const REDEEM_SCAN_WINDOW = 2_000n;
const REDEEM_SCHEDULED_TOPIC = toEventSelector("RedeemScheduled(bytes32,bytes32,uint64,uint64,address,uint256,uint256)");

type Variant = "eth-deposit" | "erc20-deposit" | "eth-withdraw" | "erc20-withdraw" | "mirror-withdraw" | "outbox-claim" | "retryable-redeem" | "mirror-create-wallet" | "mirror-register";

function variantOf(step: Pick<IntentStep, "route">): Variant {
  return (step.route?.variant ?? "") as Variant;
}

function isDeposit(route: Pick<AdapterRoute, "network" | "destinationNetwork">): boolean {
  return NETWORKS[route.network].family === "hyperevm" && NETWORKS[route.destinationNetwork].family === "elysium";
}

function isWithdrawal(route: Pick<AdapterRoute, "network" | "destinationNetwork">): boolean {
  return NETWORKS[route.network].family === "elysium" && NETWORKS[route.destinationNetwork].family === "hyperevm";
}

/** The Elysium network of a bridge route (deposit or withdrawal). */
function elysiumOf(network: NetworkKey, destination: NetworkKey): NetworkKey {
  return NETWORKS[network].family === "elysium" ? network : destination;
}

function pinned<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw engineError("BRIDGE_DISABLED", `${what} is not pinned for this network yet.`);
  return value;
}

function hypeUsd(snapshot: Awaited<ReturnType<ReferencePrices["snapshot"]>>, wei: bigint): string | null {
  return ReferencePrices.usdText(wei, 18, ReferencePrices.symbolMicros(snapshot, "HYPE"));
}

/** The claim step that completes a withdrawal on HyperEVM (planned with it, prepared once claimable). */
function claimStep(protocol: string, parent: NetworkKey, output: StepAmount): PlannedStep {
  return {
    network: parent,
    protocol,
    kind: "claim",
    title: `Claim ${formatAmount(BigInt(output.expected), output.decimals, output.symbol)} on ${NETWORKS[parent].name}`,
    mode: "wallet",
    inputs: [],
    outputs: [{ ...output, minimum: output.expected }],
    feesUsd: null,
    estimatedSeconds: 30,
    settlement: { kind: "same-network", mechanism: "outbox-claim" },
    warnings: [],
    route: { variant: "outbox-claim", slippageBps: 0, plannedMinimum: output.expected },
    requestCount: 1,
    floor: "onchain",
  };
}

/* ----------------------------------------------------------------- shared */

/** Retryable fees of an ERC-20 deposit, read from the gateway, the Inbox and the NodeInterface. */
async function depositFees(deps: EngineDeps, pair: OrbitPair, input: { readonly token: Address; readonly gateway: Address; readonly from: Address; readonly to: Address; readonly amount: bigint }) {
  const counterpart = (await deps.evm.read(pair.parent, { address: input.gateway, abi: L1_GATEWAY_ABI, functionName: "counterpartGateway" })).toLowerCase() as Address;
  const outbound = await deps.evm.read(pair.parent, { address: input.gateway, abi: L1_GATEWAY_ABI, functionName: "getOutboundCalldata", args: [input.token, input.from, input.to, input.amount, "0x"] });
  const block = await deps.evm.getBlock(pair.parent, "latest");
  const baseFee = block?.baseFeePerGas ?? (await deps.evm.gasPrice(pair.parent));
  const submissionFee = await deps.evm.read(pair.parent, { address: pair.contracts.parent.inbox as Address, abi: INBOX_ABI, functionName: "calculateRetryableSubmissionFee", args: [BigInt((outbound.length - 2) / 2), baseFee] });
  const estimateData = encodeFunctionData({ abi: NODE_INTERFACE_ABI, functionName: "estimateRetryableTicket", args: [input.gateway, 10n ** 18n, counterpart, 0n, input.from, input.from, outbound] });
  const gasEstimate = await deps.evm.estimateGas(pair.elysium, { from: input.from, to: NODE_INTERFACE_ADDRESS, data: estimateData });
  const l2GasPrice = await deps.evm.gasPrice(pair.elysium);
  return { counterpart, fees: retryableFees({ submissionFee, gasEstimate, l2GasPrice }) };
}

/** Pinned L1 gateways a canonical deposit may approve. */
function canonicalL1Gateways(pair: OrbitPair): Set<string> {
  const parent = pair.contracts.parent;
  return new Set([parent.l1StandardGateway, parent.l1WhypeGateway, parent.l1StandardCustomGateway].filter((value): value is string => value !== null).map((value) => value.toLowerCase()));
}

/** The registry token on the other side of a canonical route, read back through the gateway router. */
async function canonicalCounterpart(deps: EngineDeps, pair: OrbitPair, asset: ResolvedAsset, deposit: boolean): Promise<ResolvedAsset> {
  const token = asset.token;
  const other = token ? counterpartToken(token) : null;
  if (!token || !other || token.bridge?.route !== "canonical") throw engineError("ROUTE_UNSUPPORTED", `${asset.symbol} has no canonical Elysium bridge route in Elyia's registry.`);
  const l1 = (deposit ? token.address : other.address) as Address;
  const l2 = (deposit ? other.address : token.address) as Address;
  const router = pinned(deposit ? pair.contracts.parent.l1GatewayRouter : pair.contracts.child.l2GatewayRouter, "The gateway router") as Address;
  const computed = await deps.evm.read(deposit ? pair.parent : pair.elysium, { address: router, abi: L1_GATEWAY_ROUTER_ABI, functionName: "calculateL2TokenAddress", args: [l1] });
  if (computed.toLowerCase() !== l2.toLowerCase()) throw engineError("ROUTE_UNAVAILABLE", `The gateway router maps ${asset.symbol} to ${computed}, not the registry's ${l2}; Elyia refuses until they agree.`);
  return fromToken(other);
}

/* ------------------------------------------------------------------ plan */

async function planEthDeposit(deps: EngineDeps, action: AdapterAction, pair: OrbitPair): Promise<PlannedStep> {
  const input = action.input as ResolvedAsset;
  const account = action.account.address.toLowerCase() as Address;
  if (!sameOwner(action.recipient.address, account)) {
    throw engineError("RECIPIENT_INVALID", "Native HYPE deposits arrive at your own address on Elysium. Bridge first, then send it from there.");
  }
  const code = await deps.evm.getCode(pair.parent, account).catch(() => "0x" as Hex);
  if (code !== "0x") throw engineError("ROUTE_UNSUPPORTED", "This account is a contract on HyperEVM: an Orbit deposit would credit its aliased address on Elysium. Use an EOA.");
  const output = nativeAsset(pair.elysium);
  return {
    protocol: "elysium-canonical-bridge",
    kind: "bridge",
    title: `Bridge ${formatAmount(action.amount, 18, "HYPE")} from ${NETWORKS[pair.parent].name} to ${NETWORKS[pair.elysium].name}`,
    mode: "wallet",
    inputs: [amountOf(input, action.amount)],
    outputs: [amountOf(output, action.amount, { minimum: action.amount })],
    feesUsd: await feesUsd(deps, pair.parent, GAS.depositEth),
    estimatedSeconds: DEPOSIT_SECONDS,
    settlement: { kind: "cross-network", destinationNetwork: pair.elysium, mechanism: "orbit-deposit", expectedSeconds: DEPOSIT_SECONDS },
    warnings: [],
    route: { variant: "eth-deposit", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString() },
    requestCount: 1,
    floor: "onchain",
  };
}

async function planErc20Deposit(deps: EngineDeps, action: AdapterAction, pair: OrbitPair): Promise<PlannedStep> {
  const input = action.input as ResolvedAsset;
  const output = await canonicalCounterpart(deps, pair, input, true);
  const account = action.account.address.toLowerCase() as Address;
  const to = action.recipient.address.toLowerCase() as Address;
  const router = pinned(pair.contracts.parent.l1GatewayRouter, "The L1 gateway router") as Address;
  const gateway = (await deps.evm.read(pair.parent, { address: router, abi: L1_GATEWAY_ROUTER_ABI, functionName: "getGateway", args: [input.address as Address] })).toLowerCase() as Address;
  if (!canonicalL1Gateways(pair).has(gateway)) throw engineError("ROUTE_UNAVAILABLE", `${input.symbol} routes through gateway ${gateway}, which is not a pinned canonical gateway.`);
  const { fees } = await depositFees(deps, pair, { token: input.address as Address, gateway, from: account, to, amount: action.amount });
  const snapshot = await deps.prices.snapshot();
  const native = nativeAsset(pair.parent);
  const approval = action.funded ? null : await approvalFor(deps, pair.parent, { token: input.address as Address, symbol: input.symbol, owner: account, spender: gateway, spenderLabel: "the Elysium gateway", amount: action.amount, bestEffort: true });
  const needsApproval = action.funded || approval !== null;
  return {
    protocol: "elysium-canonical-bridge",
    kind: "bridge",
    title: `Bridge ${formatAmount(action.amount, input.decimals, input.symbol)} from ${NETWORKS[pair.parent].name} to ${NETWORKS[pair.elysium].name}`,
    mode: "wallet",
    inputs: [amountOf(input, action.amount)],
    outputs: [amountOf(output, action.amount, { minimum: action.amount })],
    extraCosts: [amountOf(native, fees.value, { usd: hypeUsd(snapshot, fees.value) })],
    feesUsd: await feesUsd(deps, pair.parent, GAS.gatewayDeposit + (needsApproval ? GAS.approve : 0n)),
    estimatedSeconds: DEPOSIT_SECONDS,
    settlement: { kind: "cross-network", destinationNetwork: pair.elysium, mechanism: "orbit-deposit", expectedSeconds: DEPOSIT_SECONDS },
    warnings: [
      `Includes ${formatAmount(fees.value, 18, "HYPE")} of retryable fees (unused gas is refunded on Elysium).`,
      "If Elysium's automatic redeem fails, Elyia adds a one-click redeem step; anyone can redeem within 7 days.",
    ],
    route: { variant: "erc20-deposit", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString(), params: { gateway, l1Token: input.address as string, to } },
    requestCount: needsApproval ? 2 : 1,
    floor: "onchain",
    ...(sameOwner(to, account) ? {} : { recipient: action.recipient }),
  };
}

async function planWithdrawal(deps: EngineDeps, action: AdapterAction, pair: OrbitPair, protocol: string): Promise<PlannedStep> {
  const input = action.input as ResolvedAsset;
  const to = action.recipient.address.toLowerCase() as Address;
  const native = input.native;
  const output = native ? nativeAsset(pair.parent) : await canonicalCounterpart(deps, pair, input, false);
  const period = await confirmPeriodBlocks(deps, pair);
  const seconds = withdrawalSeconds(period);
  const outAmount = amountOf(output, action.amount, { minimum: action.amount });
  const days = seconds >= 86_400 ? `${(seconds / 86_400).toFixed(1)} days` : `${Math.ceil(seconds / 60)} minutes`;
  return {
    protocol,
    kind: "bridge",
    title: `Withdraw ${formatAmount(action.amount, input.decimals, input.symbol)} from ${NETWORKS[pair.elysium].name} to ${NETWORKS[pair.parent].name}`,
    mode: "wallet",
    inputs: [amountOf(input, action.amount)],
    outputs: [outAmount],
    feesUsd: await feesUsd(deps, pair.elysium, native ? GAS.withdrawEth : GAS.gatewayWithdraw),
    estimatedSeconds: seconds,
    settlement: { kind: "cross-network", destinationNetwork: pair.parent, mechanism: "orbit-withdrawal", expectedSeconds: seconds },
    warnings: [`Withdrawals wait for the rollup to confirm (${period} HyperEVM blocks plus the assertion cadence, about ${days}), then need a claim on HyperEVM.`],
    route: { variant: native ? "eth-withdraw" : "erc20-withdraw", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString(), params: { to, ...(native ? {} : { l1Token: output.address as string }) } },
    requestCount: 1,
    floor: "onchain",
    ...(sameOwner(to, action.account.address) ? {} : { recipient: action.recipient }),
    after: [claimStep(protocol, pair.parent, outAmount)],
  };
}

/* --------------------------------------------------------------- prepare */

async function prepareEthDeposit(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step } = context;
  const account = stepAddress(step);
  const input = assetOfAmount(step.inputs[0] as StepAmount);
  const code = await deps.evm.getCode(pair.parent, account);
  if (code !== "0x") throw engineError("ROUTE_UNSUPPORTED", "This account is a contract on HyperEVM; Orbit deposits from contracts are aliased. Use an EOA.");
  await assertBalance(deps, input, account, context.amount);
  const data = encodeFunctionData({ abi: INBOX_ABI, functionName: "depositEth" });
  return {
    requests: [evmRequest(pair.parent, account, pair.contracts.parent.inbox as Address, data, context.amount, `Deposit ${formatAmount(context.amount, 18, "HYPE")} into the Elysium inbox`)],
    inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
    outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
    warnings: [],
  };
}

async function prepareErc20Deposit(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step } = context;
  const account = stepAddress(step);
  const params = step.route?.params ?? {};
  const token = String(params.l1Token).toLowerCase() as Address;
  const to = String(params.to ?? account).toLowerCase() as Address;
  const input = assetOfAmount(step.inputs[0] as StepAmount);
  const router = pinned(pair.contracts.parent.l1GatewayRouter, "The L1 gateway router") as Address;
  const gateway = (await deps.evm.read(pair.parent, { address: router, abi: L1_GATEWAY_ROUTER_ABI, functionName: "getGateway", args: [token] })).toLowerCase() as Address;
  if (gateway !== String(params.gateway).toLowerCase() || !canonicalL1Gateways(pair).has(gateway)) throw engineError("STEP_INVALID", "The token's gateway changed since planning; plan again.");
  const { fees } = await depositFees(deps, pair, { token, gateway, from: account, to, amount: context.amount });
  await assertBalance(deps, input, account, context.amount, fees.value);
  const approval = await approvalFor(deps, pair.parent, { token, symbol: input.symbol, owner: account, spender: gateway, spenderLabel: "the Elysium gateway", amount: context.amount });
  const extraData = encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [fees.maxSubmissionCost, "0x"]);
  const data = encodeFunctionData({ abi: L1_GATEWAY_ROUTER_ABI, functionName: "outboundTransferCustomRefund", args: [token, account, to, context.amount, fees.maxGas, fees.gasPriceBid, extraData] });
  const native = nativeAsset(pair.parent);
  return {
    requests: [
      ...(approval ? [approval] : []),
      evmRequest(pair.parent, account, router, data, fees.value, `Bridge ${formatAmount(context.amount, input.decimals, input.symbol)} to Elysium (retryable: ${fees.maxGas} gas at ${fees.gasPriceBid} wei)`),
    ],
    inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
    outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
    extraCosts: [amountOf(native, fees.value, { usd: hypeUsd(await deps.prices.snapshot(), fees.value) })],
    warnings: [],
  };
}

async function prepareWithdrawal(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step } = context;
  const account = stepAddress(step);
  const input = assetOfAmount(step.inputs[0] as StepAmount);
  const to = String(step.route?.params?.to ?? account).toLowerCase() as Address;
  await assertBalance(deps, input, account, context.amount);
  let request;
  if (variantOf(step) === "eth-withdraw") {
    const data = encodeFunctionData({ abi: ARB_SYS_ABI, functionName: "withdrawEth", args: [to] });
    request = evmRequest(pair.elysium, account, ARB_SYS_ADDRESS, data, context.amount, `Withdraw ${formatAmount(context.amount, 18, "HYPE")} to HyperEVM (claim after the challenge period)`);
  } else {
    const router = pinned(pair.contracts.child.l2GatewayRouter, "The L2 gateway router") as Address;
    const l1Token = String(step.route?.params?.l1Token).toLowerCase() as Address;
    const data = encodeFunctionData({ abi: L2_GATEWAY_ROUTER_ABI, functionName: "outboundTransfer", args: [l1Token, to, context.amount, 0n, 0n, "0x"] });
    request = evmRequest(pair.elysium, account, router, data, 0n, `Withdraw ${formatAmount(context.amount, input.decimals, input.symbol)} to HyperEVM (claim after the challenge period)`);
  }
  return {
    requests: [request],
    inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
    outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
    warnings: [],
  };
}

/** The withdrawal step a claim completes, and its L2->L1 message (read back from its transaction). */
async function withdrawalMessage(deps: EngineDeps, graph: IntentGraph, step: IntentStep, pair: OrbitPair) {
  const parent = graph.steps.find((candidate) => candidate.id === step.dependsOn[0]);
  const reference = parent?.references?.at(-1);
  if (!parent || !reference) throw engineError("STEP_NOT_READY", "The withdrawal has not been submitted yet.");
  const tx = await deps.evm.observeTransaction(pair.elysium, reference as Hex);
  if (tx.state !== "landed") throw engineError("STEP_NOT_READY", "The withdrawal transaction is not visible on Elysium yet.");
  const message = l2ToL1Messages(tx.logs)[0];
  if (!message) throw engineError("STEP_INVALID", "The withdrawal transaction carries no L2-to-L1 message.");
  return { parent, message };
}

async function prepareClaim(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step, graph } = context;
  const account = stepAddress(step);
  const { message } = await withdrawalMessage(deps, graph, step, pair);
  if (await outboxSpent(deps, pair, message.position)) return { requests: [], inputs: [], outputs: step.outputs, warnings: [], skip: "This withdrawal was already claimed on HyperEVM (Outbox.isSpent)." };
  const confirmation = await confirmedSendCount(deps, pair);
  if (message.position >= confirmation.sendCount) {
    throw engineError("WITHDRAWAL_NOT_CLAIMABLE", `The rollup has confirmed ${confirmation.sendCount} messages; this one is #${message.position}. Claim after confirmation.`);
  }
  const { proof } = await outboxProof(deps, pair, confirmation.sendCount, message.position);
  const outbox = pinned(pair.contracts.parent.outbox, "The outbox") as Address;
  const data = encodeFunctionData({
    abi: OUTBOX_ABI,
    functionName: "executeTransaction",
    args: [[...proof], message.position, message.caller, message.destination, message.arbBlockNum, message.ethBlockNum, message.timestamp, message.callvalue, message.data],
  });
  return {
    requests: [evmRequest(pair.parent, account, outbox, data, 0n, `Claim withdrawal #${message.position} from the Elysium outbox`)],
    inputs: [],
    outputs: step.outputs,
    warnings: [],
  };
}

async function prepareRedeem(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step } = context;
  const ticketId = String(step.route?.params?.ticketId ?? "") as Hex;
  if (!/^0x[0-9a-f]{64}$/u.test(ticketId)) throw engineError("STEP_INVALID", "The redeem step lost its ticket id.");
  const alive = await deps.evm.call(pair.elysium, { to: ARB_RETRYABLE_TX_ADDRESS, data: encodeFunctionData({ abi: ARB_RETRYABLE_TX_ABI, functionName: "getTimeout", args: [ticketId] }) });
  if (!alive.ok) return { requests: [], inputs: [], outputs: [], warnings: [], skip: "The ticket no longer exists (already redeemed or expired)." };
  const data = encodeFunctionData({ abi: ARB_RETRYABLE_TX_ABI, functionName: "redeem", args: [ticketId] });
  return {
    requests: [evmRequest(pair.elysium, stepAddress(step), ARB_RETRYABLE_TX_ADDRESS, data, 0n, `Redeem bridge ticket ${ticketId.slice(0, 10)}… on Elysium`)],
    inputs: [],
    outputs: [],
    warnings: ["The redeem pays Elysium gas from this account; the deposit then completes."],
  };
}

/* ---------------------------------------------------------------- verify */

async function verifyDeposit(deps: EngineDeps, context: VerifyContext, pair: OrbitPair): Promise<VerificationResult> {
  const { step, now } = context;
  const account = stepAddress(step);
  const variant = variantOf(step);
  const amount = BigInt((step.inputs[0] as StepAmount).expected);
  const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
    const logs = receipts.flatMap((receipt) => receipt.logs);
    const messages = deliveredMessages(logs, pair);
    const chainId = getEvmNetwork(pair.elysium).chainId;
    if (variant === "eth-deposit") {
      const message = messages.find((entry) => entry.kind === L1_MESSAGE_KIND.ethDeposit);
      if (!message) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "No ETH-deposit message (kind 12) from the pinned Bridge and Inbox." } };
      const deposit = parseEthDepositData(message.data);
      if (deposit.to.toLowerCase() !== account || deposit.value !== amount) {
        return { failure: { code: "OUTCOME_NOT_PROVEN", message: `The deposit message credits ${deposit.value} wei to ${deposit.to}, not the planned amount to the step account.` } };
      }
      const l2TxId = ethDepositTxId(chainId, message.messageIndex, message.sender, message.data);
      return {
        settled: false,
        settlement: { trackingId: l2TxId, state: "queued" },
        evidence: [evidence("settlement", step.network, now, `Inbox message #${message.messageIndex}; Elysium deposit transaction ${l2TxId}.`, { reference: l2TxId, url: explorerTxUrl(pair.elysium, l2TxId) })],
      };
    }
    const message = messages.find((entry) => entry.kind === L1_MESSAGE_KIND.submitRetryable);
    if (!message) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "No retryable message (kind 9) from the pinned Bridge and Inbox." } };
    const ticket = parseRetryableData(message.data);
    if (ticket.excessFeeRefundAddress.toLowerCase() !== account || ticket.callValueRefundAddress.toLowerCase() !== account) {
      return { failure: { code: "OUTCOME_NOT_PROVEN", message: "The retryable refunds another address than the step account." } };
    }
    const gateway = String(step.route?.params?.gateway ?? "").toLowerCase();
    const initiated = eventsOf(logs, { address: gateway, abi: L1_GATEWAY_ABI, eventName: "DepositInitiated" });
    const to = String(step.route?.params?.to ?? account).toLowerCase();
    if (!initiated.some((event) => (event.args.amount as bigint) === amount && String(event.args.to).toLowerCase() === to)) {
      return { failure: { code: "OUTCOME_NOT_PROVEN", message: "The gateway did not report the planned deposit (amount or recipient differ)." } };
    }
    const ticketId = retryableTicketId(chainId, message.messageIndex, message.sender, message.baseFeeL1, message.data);
    return {
      settled: false,
      settlement: { trackingId: ticketId, state: "queued", deadline: new Date(now + RETRYABLE_LIFETIME_MS).toISOString() },
      evidence: [evidence("settlement", step.network, now, `Retryable ticket ${ticketId} (message #${message.messageIndex}).`, { reference: ticketId, url: explorerTxUrl(pair.elysium, ticketId) })],
    };
  });
  return result;
}

async function verifyWithdrawal(deps: EngineDeps, context: VerifyContext, pair: OrbitPair): Promise<VerificationResult> {
  const { step, now } = context;
  const account = stepAddress(step);
  const amount = BigInt((step.inputs[0] as StepAmount).expected);
  const to = String(step.route?.params?.to ?? account).toLowerCase();
  const variant = variantOf(step);
  const period = await confirmPeriodBlocks(deps, pair).catch(() => null);
  const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
    const logs = receipts.flatMap((receipt) => receipt.logs);
    const messages = l2ToL1Messages(logs);
    let message;
    if (variant === "eth-withdraw") {
      message = messages.find((entry) => entry.caller.toLowerCase() === account && entry.destination.toLowerCase() === to && entry.callvalue === amount);
    } else {
      const initiated = eventsOf(logs, { abi: L2_GATEWAY_ABI, eventName: "WithdrawalInitiated" }).find(
        (event) => String(event.args.from).toLowerCase() === account && String(event.args.to).toLowerCase() === to && (event.args.amount as bigint) === amount,
      );
      if (!initiated) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "No WithdrawalInitiated event for the planned amount and recipient." } };
      if (variant === "mirror-withdraw" && erc20Credit(logs, String(step.route?.params?.token ?? ""), String(step.route?.params?.wallet ?? ""), account) !== amount) {
        return { failure: { code: "OUTCOME_NOT_PROVEN", message: "The escrow wallet did not receive the planned amount." } };
      }
      message = messages.find((entry) => entry.caller.toLowerCase() === initiated.log.address.toLowerCase());
    }
    if (!message) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "No matching L2ToL1Tx event from ArbSys." } };
    const seconds = period === null ? undefined : withdrawalSeconds(period);
    const settlement: Partial<StepSettlement> = {
      trackingId: message.position.toString(),
      state: "unconfirmed",
      ...(seconds !== undefined ? { claimableAt: new Date(Number(message.timestamp) * 1000 + seconds * 1000).toISOString() } : {}),
    };
    return { settled: false, settlement, evidence: [evidence("settlement", step.network, now, `L2-to-L1 message #${message.position}; claimable after the rollup confirms it.`)] };
  });
  return result;
}

async function verifyClaim(deps: EngineDeps, context: VerifyContext, pair: OrbitPair): Promise<VerificationResult> {
  const { step, now, graph } = context;
  const outbox = pinned(pair.contracts.parent.outbox, "The outbox");
  const { message } = await withdrawalMessage(deps, graph, step, pair);
  const output = step.outputs[0];
  const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
    const logs = receipts.flatMap((receipt) => receipt.logs);
    const executed = eventsOf(logs, { address: outbox, abi: OUTBOX_ABI, eventName: "OutBoxTransactionExecuted" }).find((event) => (event.args.transactionIndex as bigint) === message.position);
    if (!executed) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No OutBoxTransactionExecuted for message #${message.position}.` } };
    if (output && !assetOfAmount(output).native) {
      const asset = assetOfAmount(output);
      const recipient = String(graph.steps.find((candidate) => candidate.id === step.dependsOn[0])?.route?.params?.to ?? stepAddress(step));
      const credit = erc20Credit(logs, asset.address as string, recipient);
      if (credit < BigInt(output.expected)) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `The claim credited ${credit} base units of ${output.symbol}, less than the withdrawal.` } };
    }
    return { actualOutputs: step.outputs, evidence: [evidence("settlement", step.network, now, `Outbox executed message #${message.position}.`)] };
  });
  return result;
}

async function verifyRedeem(deps: EngineDeps, context: VerifyContext, pair: OrbitPair): Promise<VerificationResult> {
  const { step, now } = context;
  const ticketId = String(step.route?.params?.ticketId ?? "").toLowerCase();
  let retryTx: Hex | null = null;
  const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
    const logs = receipts.flatMap((receipt) => receipt.logs);
    const scheduled = eventsOf(logs, { address: ARB_RETRYABLE_TX_ADDRESS, abi: ARB_RETRYABLE_TX_ABI, eventName: "RedeemScheduled" }).find((event) => String(event.args.ticketId).toLowerCase() === ticketId);
    if (!scheduled) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "The redeem transaction scheduled no retry for this ticket." } };
    retryTx = String(scheduled.args.retryTxHash) as Hex;
    return { evidence: [evidence("settlement", step.network, now, `Retry ${retryTx} scheduled.`, { reference: retryTx, url: explorerTxUrl(pair.elysium, retryTx) })], settlement: { trackingId: retryTx } };
  });
  if (result.status !== "confirmed" || !retryTx) return result;
  const retry = await deps.evm.observeTransaction(pair.elysium, retryTx);
  if (retry.state !== "landed") return { status: "pending", evidence: [], reason: "The retry is not visible yet.", stale: false };
  if (retry.status !== "success") return failed(result.evidence, "RETRYABLE_REDEEM_NEEDED", "The retry ran out of gas or reverted; redeem again (the ticket stays alive until it expires).");
  return result;
}

/* ------------------------------------------------------------------ poll */

const redeemScanCursor = new Map<string, bigint>();

/** A successful retry of `ticketId`, from the redeem follow-up step or a bounded RedeemScheduled log scan. */
async function successfulRetry(deps: EngineDeps, pair: OrbitPair, graph: IntentGraph, ticketId: Hex, ticketBlock: bigint): Promise<Hex | null> {
  const redeem = graph.steps.find((candidate) => candidate.route?.variant === "retryable-redeem" && String(candidate.route.params?.ticketId).toLowerCase() === ticketId.toLowerCase() && candidate.status === "settled");
  const recorded = redeem?.settlement?.trackingId;
  if (recorded) return recorded as Hex;
  const head = (await deps.evm.getBlock(pair.elysium, "latest"))?.number;
  if (head === undefined) return null;
  const from = redeemScanCursor.get(ticketId) ?? ticketBlock;
  const to = from + REDEEM_SCAN_WINDOW > head ? head : from + REDEEM_SCAN_WINDOW;
  const topic = REDEEM_SCHEDULED_TOPIC;
  const logs = await deps.evm.getLogs(pair.elysium, { address: ARB_RETRYABLE_TX_ADDRESS, topics: [topic, ticketId], fromBlock: from, toBlock: to });
  redeemScanCursor.set(ticketId, to + 1n);
  for (const log of logs) {
    const retry = log.topics[2];
    if (!retry) continue;
    const observed = await deps.evm.observeTransaction(pair.elysium, retry);
    if (observed.state === "landed" && observed.status === "success") return retry;
  }
  return null;
}

async function pollDeposit(deps: EngineDeps, step: IntentStep, graph: IntentGraph, now: number, pair: OrbitPair): Promise<SettlementResult> {
  const trackingId = step.settlement?.trackingId as Hex | undefined;
  if (!trackingId) return { status: "settling", evidence: [] };
  const output = step.outputs[0] as StepAmount;
  const tx = await deps.evm.observeTransaction(pair.elysium, trackingId);
  const age = now - (firstPreparedAt(step) ?? now);
  if (tx.state !== "landed") {
    if (age > DEPOSIT_REVIEW_MS) return { status: "failed", review: true, evidence: [], failure: { code: "SETTLEMENT_TIMEOUT", message: "The Elysium side of the deposit has not appeared in 3 hours; held for review." } };
    return { status: "settling", evidence: [], settlement: { state: "queued" } };
  }
  if (variantOf(step) === "eth-deposit") {
    const account = stepAddress(step);
    if (tx.status !== "success" || tx.to?.toLowerCase() !== account || tx.value !== BigInt(output.expected)) {
      return { status: "failed", review: true, evidence: [], failure: { code: "OUTCOME_NOT_PROVEN", message: "The Elysium deposit transaction does not credit the planned amount to the step account." } };
    }
    return {
      status: "settled",
      actualOutputs: [{ ...output, minimum: output.expected }],
      evidence: [evidence("settlement", pair.elysium, now, `Credited on Elysium in block ${tx.blockNumber}.`, { reference: trackingId, url: explorerTxUrl(pair.elysium, trackingId) })],
    };
  }
  // ERC-20 retryable: the ticket landed; did its auto-redeem succeed?
  if (tx.status !== "success") return { status: "failed", review: true, evidence: [], failure: { code: "OUTCOME_NOT_PROVEN", message: "The retryable ticket creation failed on Elysium." } };
  const scheduled = eventsOf(tx.logs, { address: ARB_RETRYABLE_TX_ADDRESS, abi: ARB_RETRYABLE_TX_ABI, eventName: "RedeemScheduled" }).find((event) => String(event.args.ticketId).toLowerCase() === trackingId.toLowerCase());
  let retry: Hex | null = null;
  if (scheduled) {
    const auto = await deps.evm.observeTransaction(pair.elysium, String(scheduled.args.retryTxHash) as Hex);
    if (auto.state !== "landed") return { status: "settling", evidence: [], settlement: { state: "ticket-created" } };
    if (auto.status === "success") retry = auto.hash;
  }
  if (!retry) {
    const timeout = await deps.evm.call(pair.elysium, { to: ARB_RETRYABLE_TX_ADDRESS, data: encodeFunctionData({ abi: ARB_RETRYABLE_TX_ABI, functionName: "getTimeout", args: [trackingId] }) });
    if (timeout.ok) {
      const deadline = new Date(Number(BigInt(timeout.data)) * 1000).toISOString();
      const followUp: FollowUpStep = {
        key: `redeem:${trackingId}`,
        kind: "claim",
        network: pair.elysium,
        protocol: "elysium-canonical-bridge",
        title: "Redeem the bridge ticket on Elysium (the automatic redeem failed)",
        route: { variant: "retryable-redeem", slippageBps: 0, params: { ticketId: trackingId, depositStep: step.id } },
      };
      return { status: "settling", evidence: [evidence("note", pair.elysium, now, `The automatic redeem did not complete; redeem before ${deadline}.`)], settlement: { state: "needs-redeem", deadline }, followUp };
    }
    retry = await successfulRetry(deps, pair, graph, trackingId, tx.blockNumber);
    if (!retry) {
      const deadline = step.settlement?.deadline ? Date.parse(step.settlement.deadline) : now + RETRYABLE_LIFETIME_MS;
      if (now > deadline) return { status: "failed", review: true, evidence: [], failure: { code: "RETRYABLE_REDEEM_FAILED", message: "The retryable ticket expired without a successful redeem; the tokens stay in the HyperEVM gateway." } };
      return { status: "settling", evidence: [], settlement: { state: "needs-redeem" } };
    }
  }
  const retryTx = await deps.evm.observeTransaction(pair.elysium, retry);
  if (retryTx.state !== "landed") return { status: "settling", evidence: [] };
  const account = String(step.route?.params?.to ?? stepAddress(step)).toLowerCase();
  const finalized = eventsOf(retryTx.logs, { abi: L2_GATEWAY_ABI, eventName: "DepositFinalized" }).find((event) => String(event.args.to).toLowerCase() === account && (event.args.amount as bigint) === BigInt(output.expected));
  if (!finalized) return { status: "failed", review: true, evidence: [], failure: { code: "OUTCOME_NOT_PROVEN", message: "The redeemed ticket did not finalize the planned deposit." } };
  return {
    status: "settled",
    actualOutputs: [{ ...output, minimum: output.expected }],
    evidence: [evidence("settlement", pair.elysium, now, `Deposit finalized on Elysium by ${retry}.`, { reference: retry, url: explorerTxUrl(pair.elysium, retry) })],
    settlement: { state: "redeemed" },
  };
}

async function pollWithdrawal(deps: EngineDeps, step: IntentStep, now: number, pair: OrbitPair): Promise<SettlementResult> {
  const position = step.settlement?.trackingId;
  if (!position || !/^\d+$/u.test(position)) return { status: "settling", evidence: [] };
  const confirmation = await confirmedSendCount(deps, pair);
  if (BigInt(position) >= confirmation.sendCount) return { status: "settling", evidence: [], settlement: { state: "unconfirmed" } };
  const spent = await outboxSpent(deps, pair, BigInt(position));
  return {
    status: "settled",
    actualOutputs: step.outputs,
    settlement: { state: spent ? "executed" : "claimable", claimableAt: new Date(now).toISOString() },
    evidence: [evidence("settlement", pair.parent, now, spent ? `Message #${position} was already executed on HyperEVM.` : `Message #${position} is confirmed: claim it on HyperEVM.`)],
  };
}

/* --------------------------------------------------------------- mirror */

async function mirrorFacts(deps: EngineDeps, pair: OrbitPair, token: Address) {
  const factory = pinned(pair.contracts.child.bridgeFactory, "The mirror bridge factory") as Address;
  const [wallet, predicted, mirror] = await Promise.all([
    deps.evm.read(pair.elysium, { address: factory, abi: ELYSIUM_BRIDGE_FACTORY_ABI, functionName: "l2WalletFor", args: [token] }),
    deps.evm.read(pair.elysium, { address: factory, abi: ELYSIUM_BRIDGE_FACTORY_ABI, functionName: "predictL2Wallet", args: [token] }),
    deps.evm.read(pair.elysium, { address: factory, abi: ELYSIUM_BRIDGE_FACTORY_ABI, functionName: "expectedL1Mirror", args: [token] }),
  ]);
  const router = pinned(pair.contracts.child.l2GatewayRouter, "The L2 gateway router") as Address;
  const gateway = await deps.evm.read(pair.elysium, { address: router, abi: L2_GATEWAY_ROUTER_ABI, functionName: "getGateway", args: [mirror] });
  const custom = pinned(pair.contracts.child.l2CustomGateway, "The mirror gateway").toLowerCase();
  return {
    factory,
    wallet: wallet.toLowerCase() === ZERO ? null : (wallet.toLowerCase() as Address),
    predicted: predicted.toLowerCase() as Address,
    mirror: mirror.toLowerCase() as Address,
    registered: gateway.toLowerCase() === custom,
  };
}

async function planMirror(deps: EngineDeps, action: AdapterAction, pair: OrbitPair): Promise<PlannedStep> {
  const input = action.input as ResolvedAsset;
  if (input.native || !input.address) throw engineError("ROUTE_UNSUPPORTED", "The mirror bridge moves Elysium-native ERC-20 tokens.");
  if (input.token?.bridge?.route === "canonical") throw engineError("ROUTE_UNSUPPORTED", `${input.symbol} is a canonical bridged token: use the canonical bridge.`);
  const token = input.address;
  const facts = await mirrorFacts(deps, pair, token);
  const [name, symbol, decimals] = await Promise.all([
    deps.evm.read(pair.elysium, { address: token, abi: ERC20_METADATA_ABI, functionName: "name" }),
    deps.evm.read(pair.elysium, { address: token, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
    deps.evm.read(pair.elysium, { address: token, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
  ]);
  const to = action.recipient.address.toLowerCase() as Address;
  const mirrorAsset: StepAmount = { asset: erc20AssetId(pair.parent, facts.mirror), symbol: String(symbol).slice(0, 24), decimals: Number(decimals), expected: action.amount.toString(), minimum: action.amount.toString() };
  const period = await confirmPeriodBlocks(deps, pair);
  const seconds = withdrawalSeconds(period);
  const before: PlannedStep[] = [];
  const setup = { protocol: "elysium-mirror-bridge", kind: "approve" as const, mode: "wallet" as const, inputs: [], outputs: [], requestCount: 1, warnings: [] as string[] };
  if (!facts.wallet) {
    before.push({
      ...setup,
      network: pair.elysium,
      title: `Create the Elysium escrow wallet for ${String(symbol)} (once per token)`,
      feesUsd: await feesUsd(deps, pair.elysium, GAS.mirrorWallet),
      estimatedSeconds: 3,
      settlement: { kind: "same-network", mechanism: "receipt" },
      route: { variant: "mirror-create-wallet", slippageBps: 0, params: { token } },
    });
  }
  if (!facts.registered) {
    const bid = await mirrorGasBid(deps, pair);
    const value = 2n * (MIRROR_MAX_SUBMISSION + MIRROR_MAX_GAS * bid);
    before.push({
      ...setup,
      network: pair.parent,
      title: `Register the ${String(symbol)} mirror on HyperEVM (once per token)`,
      extraCosts: [amountOf(nativeAsset(pair.parent), value, { usd: hypeUsd(await deps.prices.snapshot(), value) })],
      feesUsd: await feesUsd(deps, pair.parent, GAS.mirrorRegister),
      estimatedSeconds: DEPOSIT_SECONDS,
      settlement: { kind: "cross-network", destinationNetwork: pair.elysium, mechanism: "orbit-deposit", expectedSeconds: DEPOSIT_SECONDS },
      warnings: ["Registration sends two retryables to Elysium with the keeper parameters CorePad reports; the transfer waits until the gateway lists the mirror."],
      route: { variant: "mirror-register", slippageBps: 0, params: { token, mirror: facts.mirror, name: String(name).slice(0, 64), symbol: String(symbol).slice(0, 24), decimals: Number(decimals) } },
    });
  }
  return {
    protocol: "elysium-mirror-bridge",
    kind: "bridge",
    title: `Bridge ${formatAmount(action.amount, input.decimals, input.symbol)} to HyperEVM through the mirror bridge`,
    mode: "wallet",
    inputs: [amountOf(input, action.amount)],
    outputs: [mirrorAsset],
    feesUsd: await feesUsd(deps, pair.elysium, GAS.gatewayWithdraw + GAS.approve),
    estimatedSeconds: seconds,
    settlement: { kind: "cross-network", destinationNetwork: pair.parent, mechanism: "orbit-withdrawal", expectedSeconds: seconds },
    warnings: [`${input.verified ? `${input.symbol} arrives on HyperEVM as its mirror token` : `${input.symbol} is not in Elyia's verified list; its HyperEVM mirror is`} ${facts.mirror}.`, "Withdrawals need a claim on HyperEVM after the rollup confirms them."],
    route: { variant: "mirror-withdraw", slippageBps: 0, plannedInput: action.amount.toString(), plannedMinimum: action.amount.toString(), params: { token, mirror: facts.mirror, wallet: facts.wallet ?? facts.predicted, to } },
    requestCount: 2,
    floor: "onchain",
    ...(sameOwner(to, action.account.address) ? {} : { recipient: action.recipient }),
    before,
    after: [claimStep("elysium-mirror-bridge", pair.parent, mirrorAsset)],
  };
}

async function mirrorGasBid(deps: EngineDeps, pair: OrbitPair): Promise<bigint> {
  const block = await deps.evm.getBlock(pair.elysium, "latest");
  const tenfold = (block?.baseFeePerGas ?? 0n) * 10n;
  return tenfold > 100_000_000n ? tenfold : 100_000_000n;
}

async function prepareMirror(deps: EngineDeps, context: PrepareContext, pair: OrbitPair): Promise<PreparedPayload> {
  const { step } = context;
  const account = stepAddress(step);
  const params = step.route?.params ?? {};
  const token = String(params.token).toLowerCase() as Address;
  const facts = await mirrorFacts(deps, pair, token);
  switch (variantOf(step)) {
    case "mirror-create-wallet": {
      if (facts.wallet) return { requests: [], inputs: [], outputs: [], warnings: [], skip: "The escrow wallet already exists." };
      const data = encodeFunctionData({ abi: ELYSIUM_BRIDGE_FACTORY_ABI, functionName: "createL2Wallet", args: [token] });
      return { requests: [evmRequest(pair.elysium, account, facts.factory, data, 0n, step.title)], inputs: [], outputs: [], warnings: [] };
    }
    case "mirror-register": {
      if (facts.registered) return { requests: [], inputs: [], outputs: [], warnings: [], skip: "The mirror is already registered." };
      const factory = pinned(pair.contracts.parent.mirrorFactory, "The mirror factory") as Address;
      const bid = await mirrorGasBid(deps, pair);
      const each = MIRROR_MAX_SUBMISSION + MIRROR_MAX_GAS * bid;
      const tuple = [MIRROR_MAX_SUBMISSION, MIRROR_MAX_SUBMISSION, MIRROR_MAX_GAS, MIRROR_MAX_GAS, bid, each, each, account] as const;
      const data = encodeFunctionData({ abi: ELYSIUM_MIRROR_FACTORY_ABI, functionName: "createAndRegisterL1Mirror", args: [token, String(params.name), String(params.symbol), Number(params.decimals), tuple] });
      return { requests: [evmRequest(pair.parent, account, factory, data, 2n * each, step.title)], inputs: [], outputs: [], warnings: [], extraCosts: [amountOf(nativeAsset(pair.parent), 2n * each)] };
    }
    default: {
      if (!facts.wallet) throw engineError("STEP_NOT_READY", "The escrow wallet does not exist yet.");
      if (!facts.registered) throw engineError("STEP_NOT_READY", "The mirror is not registered on the Elysium gateway yet; wait for the registration to land.");
      const input = assetOfAmount(step.inputs[0] as StepAmount);
      await assertBalance(deps, input, account, context.amount);
      const approval = await approvalFor(deps, pair.elysium, { token, symbol: input.symbol, owner: account, spender: facts.wallet, spenderLabel: "the escrow wallet", amount: context.amount });
      const router = pinned(pair.contracts.child.l2GatewayRouter, "The L2 gateway router") as Address;
      const to = String(params.to ?? account).toLowerCase() as Address;
      const data = encodeFunctionData({ abi: L2_GATEWAY_ROUTER_ABI, functionName: "outboundTransfer", args: [facts.mirror, to, context.amount, 0n, 0n, "0x"] });
      return {
        requests: [...(approval ? [approval] : []), evmRequest(pair.elysium, account, router, data, 0n, `Bridge ${formatAmount(context.amount, input.decimals, input.symbol)} through the mirror bridge`)],
        inputs: [{ ...(step.inputs[0] as StepAmount), expected: context.amount.toString() }],
        outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
        warnings: [],
      };
    }
  }
}

async function verifyMirrorSetup(deps: EngineDeps, context: VerifyContext, pair: OrbitPair): Promise<VerificationResult> {
  const { step, now } = context;
  const token = String(step.route?.params?.token).toLowerCase() as Address;
  const { result } = await verifyEvmReceipts(deps.evm, context, async () => {
    const facts = await mirrorFacts(deps, pair, token);
    if (variantOf(step) === "mirror-create-wallet") {
      if (!facts.wallet) return { failure: { code: "OUTCOME_NOT_PROVEN", message: "l2WalletFor still returns no wallet." } };
      return { evidence: [evidence("settlement", step.network, now, `Escrow wallet ${facts.wallet}.`)] };
    }
    return { settled: facts.registered, settlement: { state: facts.registered ? "redeemed" : "queued" }, evidence: [evidence("note", step.network, now, facts.registered ? "Mirror registered." : "Registration retryables sent; waiting for Elysium.")] };
  });
  return result;
}

async function pollMirrorRegistration(deps: EngineDeps, step: IntentStep, now: number, pair: OrbitPair): Promise<SettlementResult> {
  const token = String(step.route?.params?.token).toLowerCase() as Address;
  const facts = await mirrorFacts(deps, pair, token);
  if (facts.registered) return { status: "settled", evidence: [evidence("settlement", pair.elysium, now, `The Elysium gateway router lists mirror ${facts.mirror}.`)], settlement: { state: "redeemed" } };
  const age = now - (firstPreparedAt(step) ?? now);
  if (age > 30 * 60_000) return { status: "failed", review: true, evidence: [], failure: { code: "RETRYABLE_REDEEM_NEEDED", message: "The mirror registration has not reached Elysium in 30 minutes; its retryables may need a redeem." } };
  return { status: "settling", evidence: [], settlement: { state: "queued" } };
}

/* -------------------------------------------------------------- adapters */

/** The Orbit pair a stored step belongs to (deposits, claims and registrations run on HyperEVM). */
function pairOfStep(step: IntentStep): OrbitPair {
  return orbitPair(NETWORKS[step.network].family === "elysium" ? step.network : elysiumFor(step.network));
}

/** The Elysium network whose parent is this HyperEVM network. */
function elysiumFor(hyperevm: NetworkKey): NetworkKey {
  const match = (Object.values(NETWORKS) as Array<(typeof NETWORKS)[NetworkKey]>).find((network) => network.vm === "evm" && network.family === "elysium" && network.parent === hyperevm);
  if (!match) throw engineError("BRIDGE_DISABLED", `No Elysium network settles to ${hyperevm}.`);
  return match.key;
}

export function createElysiumBridgeAdapter(deps: EngineDeps): ProtocolAdapter {
  return {
    id: "elysium-canonical-bridge",
    protocols: ["elysium-canonical-bridge"],
    label: "Elysium bridge",
    supports(route) {
      if (route.kind === "claim") return route.variant === "outbox-claim" || route.variant === "retryable-redeem";
      if (route.kind !== "bridge" || !route.input || NETWORKS[route.network].environment !== NETWORKS[route.destinationNetwork].environment) return false;
      if (!isDeposit(route) && !isWithdrawal(route)) return false;
      if (route.input.native) return true;
      return route.input.token?.bridge?.route === "canonical";
    },
    async plan(action) {
      const pair = orbitPair(elysiumOf(action.network, action.destinationNetwork));
      if (isDeposit(action)) return (action.input as ResolvedAsset).native ? planEthDeposit(deps, action, pair) : planErc20Deposit(deps, action, pair);
      return planWithdrawal(deps, action, pair, "elysium-canonical-bridge");
    },
    async prepare(context) {
      const pair = pairOfStep(context.step);
      switch (variantOf(context.step)) {
        case "eth-deposit":
          return prepareEthDeposit(deps, context, pair);
        case "erc20-deposit":
          return prepareErc20Deposit(deps, context, pair);
        case "eth-withdraw":
        case "erc20-withdraw":
          return prepareWithdrawal(deps, context, pair);
        case "outbox-claim":
          return prepareClaim(deps, context, pair);
        case "retryable-redeem":
          return prepareRedeem(deps, context, pair);
        default:
          throw engineError("STEP_INVALID", `Unknown bridge variant ${String(context.step.route?.variant)}.`);
      }
    },
    async verify(context) {
      const pair = pairOfStep(context.step);
      switch (variantOf(context.step)) {
        case "eth-deposit":
        case "erc20-deposit":
          return verifyDeposit(deps, context, pair);
        case "eth-withdraw":
        case "erc20-withdraw":
          return verifyWithdrawal(deps, context, pair);
        case "outbox-claim":
          return verifyClaim(deps, context, pair);
        case "retryable-redeem":
          return verifyRedeem(deps, context, pair);
        default:
          return failed([], "STEP_INVALID", "Unknown bridge variant.");
      }
    },
    async poll(step, graph, now) {
      const pair = pairOfStep(step);
      const variant = variantOf(step);
      if (variant === "eth-deposit" || variant === "erc20-deposit") return pollDeposit(deps, step, graph, now, pair);
      if (variant === "eth-withdraw" || variant === "erc20-withdraw") return pollWithdrawal(deps, step, now, pair);
      return { status: "settling", evidence: [] };
    },
  };
}

export function createMirrorBridgeAdapter(deps: EngineDeps): ProtocolAdapter {
  return {
    id: "elysium-mirror-bridge",
    protocols: ["elysium-mirror-bridge"],
    label: "Elysium mirror bridge",
    explicitOnly: true,
    supports(route) {
      if (route.kind === "claim") return route.variant === "outbox-claim";
      if (route.kind === "approve") return route.variant === "mirror-create-wallet" || route.variant === "mirror-register";
      return route.kind === "bridge" && route.input !== null && !route.input.native && isWithdrawal(route) && route.input.token?.bridge?.route !== "canonical";
    },
    plan: (action) => planMirror(deps, action, orbitPair(elysiumOf(action.network, action.destinationNetwork))),
    prepare(context) {
      const pair = pairOfStep(context.step);
      return variantOf(context.step) === "outbox-claim" ? prepareClaim(deps, context, pair) : prepareMirror(deps, context, pair);
    },
    verify(context) {
      const pair = pairOfStep(context.step);
      const variant = variantOf(context.step);
      if (variant === "outbox-claim") return verifyClaim(deps, context, pair);
      if (variant === "mirror-withdraw") return verifyWithdrawal(deps, context, pair);
      return verifyMirrorSetup(deps, context, pair);
    },
    async poll(step, _graph, now) {
      const pair = pairOfStep(step);
      const variant = variantOf(step);
      if (variant === "mirror-withdraw") return pollWithdrawal(deps, step, now, pair);
      if (variant === "mirror-register") return pollMirrorRegistration(deps, step, now, pair);
      return { status: "settling", evidence: [] };
    },
  };
}

