/**
 * Kinetiq kHYPE staking on HyperEVM: `StakingManager.stake{value}()` mints
 * kHYPE to the sender. The testnet manager's identity is INFERRED (it is the
 * sole MINTER_ROLE holder of testnet kHYPE; Kinetiq does not publish it), its
 * behaviour is verified (min 0.1 HYPE, `estimateGas(stake())` succeeds, a
 * bogus selector reverts). Expected kHYPE comes from the accountant's
 * `HYPEToKHYPE`; the call has no minimum, so the floor is checked at
 * verification (mint >= expected - 5 bps). Unstaking goes through Kinetiq's
 * withdrawal queue, which Elyia only describes for now.
 */
import { applySlippage, NETWORKS, tokenByAddress, type StepAmount } from "@elyia/core";
import { encodeFunctionData, type Address } from "viem";
import { KINETIQ_ACCOUNTANT_ABI, KINETIQ_STAKING_MANAGER_ABI } from "../abis.js";
import { amountOf, formatAmount, fromToken, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, lowestPreparedFloor, verifyEvmReceipts } from "../verify.js";
import { KINETIQ_STAKING } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { assertBalance, evmRequest, feesUsd, GAS } from "./evmCommon.js";

/** Tolerance between the accountant's quote and the mint (rate drift between plan and execution). */
export const STAKE_TOLERANCE_BPS = 5;
const ZERO = "0x0000000000000000000000000000000000000000";

export function createKinetiqAdapter(deps: EngineDeps): ProtocolAdapter {
  const supports = (route: AdapterRoute) => {
    const pins = KINETIQ_STAKING[route.network];
    return route.kind === "stake" && pins !== undefined && route.input?.native === true && route.output?.address?.toLowerCase() === pins.kHYPE;
  };

  async function readState(network: AdapterRoute["network"], amount: bigint) {
    const pins = KINETIQ_STAKING[network];
    if (!pins) throw engineError("ROUTE_UNSUPPORTED", `Kinetiq staking is not available on ${NETWORKS[network].name}.`);
    const [minimum, maximum, paused, accountant] = await Promise.all([
      deps.evm.read(network, { address: pins.manager, abi: KINETIQ_STAKING_MANAGER_ABI, functionName: "minStakeAmount" }),
      deps.evm.read(network, { address: pins.manager, abi: KINETIQ_STAKING_MANAGER_ABI, functionName: "maxStakeAmount" }),
      deps.evm.read(network, { address: pins.manager, abi: KINETIQ_STAKING_MANAGER_ABI, functionName: "stakingPaused" }),
      deps.evm.read(network, { address: pins.manager, abi: KINETIQ_STAKING_MANAGER_ABI, functionName: "stakingAccountant" }),
    ]);
    if (accountant.toLowerCase() !== pins.accountant) throw engineError("ROUTE_UNAVAILABLE", "The Kinetiq staking accountant changed; Elyia refuses until it is re-pinned.");
    if (paused) throw engineError("ROUTE_UNAVAILABLE", "Kinetiq staking is paused right now.");
    if (amount < minimum) throw engineError("AMOUNT_TOO_SMALL", `Kinetiq stakes at least ${formatAmount(minimum, 18, "HYPE")}.`);
    if (maximum > 0n && amount > maximum) throw engineError("ROUTE_UNAVAILABLE", `Kinetiq stakes at most ${formatAmount(maximum, 18, "HYPE")} at once.`);
    const kHype = await deps.evm.read(network, { address: pins.accountant, abi: KINETIQ_ACCOUNTANT_ABI, functionName: "HYPEToKHYPE", args: [amount] });
    if (kHype <= 0n) throw engineError("ROUTE_UNAVAILABLE", "The Kinetiq accountant quoted no kHYPE.");
    return { pins, kHype };
  }

  function kHypeAsset(network: AdapterRoute["network"]): ResolvedAsset {
    const pins = KINETIQ_STAKING[network];
    const token = pins ? tokenByAddress(network, pins.kHYPE) : null;
    if (!token) throw engineError("TOKEN_UNKNOWN", "kHYPE is not in the registry for this network.");
    return fromToken(token);
  }

  return {
    id: "kinetiq",
    protocols: ["kinetiq"],
    label: "Kinetiq",
    supports,
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const { pins, kHype } = await readState(action.network, action.amount);
      const output = kHypeAsset(action.network);
      const minimum = applySlippage(kHype, STAKE_TOLERANCE_BPS);
      return {
        protocol: "kinetiq",
        kind: "stake",
        title: `Stake ${formatAmount(action.amount, 18, "HYPE")} with Kinetiq for kHYPE`,
        mode: "wallet",
        inputs: [amountOf(action.input as ResolvedAsset, action.amount)],
        outputs: [amountOf(output, kHype, { minimum })],
        feesUsd: await feesUsd(deps, action.network, GAS.stake),
        estimatedSeconds: 4,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings: [
          ...(pins.identity === "inferred" ? ["The testnet StakingManager is identified as kHYPE's only minter (INFERRED); Kinetiq does not publish its testnet address."] : []),
          "kHYPE unstakes through Kinetiq's withdrawal queue (fee and delay apply), or can be swapped where liquidity exists.",
        ],
        route: { variant: "stake", slippageBps: STAKE_TOLERANCE_BPS, plannedInput: action.amount.toString(), plannedMinimum: minimum.toString(), params: { manager: pins.manager } },
        requestCount: 1,
        floor: "claimed",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const account = stepAddress(step);
      const { pins, kHype } = await readState(step.network, context.amount);
      const input = { ...(step.inputs[0] as StepAmount), expected: context.amount.toString() };
      await assertBalance(deps, { network: step.network, id: input.asset, symbol: "HYPE", decimals: 18, native: true, address: null, token: null, verified: true }, account, context.amount);
      const data = encodeFunctionData({ abi: KINETIQ_STAKING_MANAGER_ABI, functionName: "stake" });
      const output = kHypeAsset(step.network);
      return {
        requests: [evmRequest(step.network, account, pins.manager, data, context.amount, `Stake ${formatAmount(context.amount, 18, "HYPE")} with Kinetiq`)],
        inputs: [input],
        outputs: [amountOf(output, kHype, { minimum: applySlippage(kHype, STAKE_TOLERANCE_BPS) })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const pins = KINETIQ_STAKING[step.network];
      const output = step.outputs[0] as StepAmount;
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const minted = erc20Credit(receipts.flatMap((receipt) => receipt.logs), pins?.kHYPE as Address, account, ZERO);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (minted === 0n || minted < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `Kinetiq minted ${minted} kHYPE base units, below the expected ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: minted.toString(), minimum: minted.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `Minted ${formatAmount(minted, 18, "kHYPE")}.`)],
        };
      });
      return result;
    },
  };
}
