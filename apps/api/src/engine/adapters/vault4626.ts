/**
 * ERC-4626 vault deposits and redemptions for one pinned vault (Kalos
 * stKALOS, the Cheshire USDC vault). Deposit: exact approval of the asset to
 * the vault, then `deposit(assets, receiver = account)`; the expected shares
 * come from `previewDeposit`. Redeem (kind `withdraw`): `redeem(shares,
 * receiver = account, owner = account)`, expected assets from
 * `previewRedeem`. The vault's `asset()` is re-read at plan and prepare and
 * must equal the pin. ERC-4626 calls carry no minimum, so the floor is the
 * preview minus a small tolerance and is checked from the vault's
 * Deposit / Withdraw event and the token Transfer at verification.
 */
import { applySlippage, explorerAddressUrl, type StepAmount } from "@elyia/core";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { ERC4626_ABI } from "../abis.js";
import { amountOf, assetOfAmount, formatAmount, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { erc20Credit, eventsOf, lowestPreparedFloor, verifyEvmReceipts } from "../verify.js";
import type { VaultVenue } from "../venues.js";
import { evidence, type AdapterAction, type AdapterRoute, type PlannedStep, type PrepareContext, type PreparedPayload, type ProtocolAdapter, type VerifyContext } from "../types.js";
import { approvalFor, assertBalance, evmRequest, feesUsd, GAS, tokenTrustWarnings } from "./evmCommon.js";

/** Share-price drift tolerated between the preview and execution (vaults accrue between blocks). */
export const VAULT_TOLERANCE_BPS = 10;
const VAULT_GAS = 140_000n;

export type VaultDirection = "deposit" | "withdraw";

/** Calldata of the vault call (deposit assets, or redeem shares). */
export function vaultCalldata(direction: VaultDirection, amount: bigint, account: Address): Hex {
  return direction === "deposit"
    ? encodeFunctionData({ abi: ERC4626_ABI, functionName: "deposit", args: [amount, account] })
    : encodeFunctionData({ abi: ERC4626_ABI, functionName: "redeem", args: [amount, account, account] });
}

export function createVaultAdapter(deps: EngineDeps, venue: VaultVenue): ProtocolAdapter {
  const supports = (route: AdapterRoute): boolean => {
    if ((route.kind !== "deposit" && route.kind !== "withdraw") || route.network !== venue.network || route.destinationNetwork !== venue.network) return false;
    const input = route.input?.address?.toLowerCase();
    const output = route.output?.address?.toLowerCase();
    return route.kind === "deposit" ? input === venue.asset && output === venue.vault : input === venue.vault && output === venue.asset;
  };

  async function checkAsset(): Promise<void> {
    const asset = (await deps.evm.read(venue.network, { address: venue.vault, abi: ERC4626_ABI, functionName: "asset" })).toLowerCase();
    if (asset !== venue.asset) throw engineError("VENUE_UNAVAILABLE", `${venue.label} now reports asset ${asset}, not the pinned ${venue.asset}; Elyia refuses until it is re-checked.`);
  }

  async function preview(direction: VaultDirection, amount: bigint): Promise<bigint> {
    const out = await deps.evm.read(venue.network, { address: venue.vault, abi: ERC4626_ABI, functionName: direction === "deposit" ? "previewDeposit" : "previewRedeem", args: [amount] });
    if (out <= 0n) throw engineError("AMOUNT_TOO_SMALL", `${venue.label} previews nothing for this amount.`);
    return out;
  }

  const directionOf = (kind: string): VaultDirection => (kind === "deposit" ? "deposit" : "withdraw");

  return {
    id: venue.id,
    protocols: [venue.id],
    label: venue.label,
    ...(venue.explicitOnly ? { explicitOnly: true } : {}),
    supports,
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      const output = action.output as ResolvedAsset;
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
      const direction = directionOf(action.kind);
      const trust = tokenTrustWarnings([input, output]);
      await checkAsset();
      const out = await preview(direction, action.amount);
      const minimum = applySlippage(out, VAULT_TOLERANCE_BPS);
      const account = action.account.address.toLowerCase() as Address;
      const approval = direction === "deposit" && !action.funded ? await approvalFor(deps, venue.network, { token: venue.asset, symbol: venue.assetSymbol, owner: account, spender: venue.vault, spenderLabel: venue.label, amount: action.amount, bestEffort: true }) : null;
      const needsApproval = direction === "deposit" && (action.funded || approval !== null);
      const verb = direction === "deposit" ? "Deposit" : "Redeem";
      return {
        protocol: venue.id,
        kind: action.kind,
        title: direction === "deposit" ? `${verb} ${formatAmount(action.amount, input.decimals, input.symbol)} into ${venue.label}` : `${verb} ${formatAmount(action.amount, input.decimals, input.symbol)} from ${venue.label}`,
        mode: "wallet",
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(output, out, { minimum })],
        feesUsd: await feesUsd(deps, venue.network, VAULT_GAS + (needsApproval ? GAS.approve : 0n)),
        estimatedSeconds: 2,
        settlement: { kind: "same-network", mechanism: "receipt" },
        warnings: [...venue.warnings, ...trust, "ERC-4626 calls carry no on-chain minimum: Elyia checks the result against the preview when it verifies."],
        route: { variant: `erc4626:${direction}`, slippageBps: VAULT_TOLERANCE_BPS, plannedInput: action.amount.toString(), plannedMinimum: minimum.toString(), params: { venue: venue.id, vault: venue.vault } },
        requestCount: needsApproval ? 2 : 1,
        floor: "claimed",
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const inputAmount = step.inputs[0];
      const outputAmount = step.outputs[0];
      if (!inputAmount || !outputAmount || String(step.route?.params?.vault ?? "") !== venue.vault) throw engineError("STEP_INVALID", "The vault step lost its recorded vault.");
      const direction = directionOf(step.kind);
      const input = assetOfAmount(inputAmount);
      const output = assetOfAmount(outputAmount);
      const account = stepAddress(step);
      await assertBalance(deps, input, account, context.amount);
      await checkAsset();
      const out = await preview(direction, context.amount);
      const minimum = applySlippage(out, VAULT_TOLERANCE_BPS);
      const approval = direction === "deposit" ? await approvalFor(deps, venue.network, { token: venue.asset, symbol: venue.assetSymbol, owner: account, spender: venue.vault, spenderLabel: venue.label, amount: context.amount }) : null;
      const data = vaultCalldata(direction, context.amount, account);
      return {
        requests: [
          ...(approval ? [approval] : []),
          evmRequest(venue.network, account, venue.vault, data, 0n, direction === "deposit" ? `Deposit ${formatAmount(context.amount, input.decimals, input.symbol)} into ${venue.label}` : `Redeem ${formatAmount(context.amount, input.decimals, input.symbol)} from ${venue.label}`),
        ],
        inputs: [amountOf(input, context.amount)],
        outputs: [amountOf(output, out, { minimum })],
        warnings: [],
      };
    },
    async verify(context: VerifyContext) {
      const { step } = context;
      const direction = directionOf(step.kind);
      const output = step.outputs[0] as StepAmount;
      const account = stepAddress(step);
      const { result } = await verifyEvmReceipts(deps.evm, context, (receipts) => {
        const logs = receipts.flatMap((receipt) => receipt.logs);
        const events = eventsOf(logs, { address: venue.vault, abi: ERC4626_ABI, eventName: direction === "deposit" ? "Deposit" : "Withdraw" }).filter(
          (event) => String(event.args.owner).toLowerCase() === account,
        );
        if (events.length === 0) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `No ${direction === "deposit" ? "Deposit" : "Withdraw"} event from ${venue.label} for this account.` } };
        // Deposit: shares minted to the account; redeem: assets transferred from the vault to the account.
        const credit = direction === "deposit" ? erc20Credit(logs, venue.vault, account, "0x0000000000000000000000000000000000000000") : erc20Credit(logs, venue.asset, account, venue.vault);
        const floor = lowestPreparedFloor(step) ?? 0n;
        if (credit === 0n || credit < floor) return { failure: { code: "OUTCOME_NOT_PROVEN", message: `${venue.label} credited ${credit} base units of ${output.symbol}, below the previewed ${floor}.` } };
        return {
          actualOutputs: [{ ...output, expected: credit.toString(), minimum: credit.toString() }],
          evidence: [evidence("settlement", step.network, context.now, `${venue.label} ${direction === "deposit" ? "Deposit" : "Withdraw"} event; ${formatAmount(credit, output.decimals, output.symbol)} credited.`, { url: explorerAddressUrl(step.network, venue.vault) })],
        };
      });
      return result;
    },
  };
}
