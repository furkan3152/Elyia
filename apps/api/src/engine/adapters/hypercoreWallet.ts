/**
 * HyperCore actions the user's WALLET signs (EIP-712, user-signed): approve
 * the trade-only agent (`approveAgent`, named `elyia-web` or
 * `elyia-keeper`, always with an expiry), sends to other HyperCore accounts
 * (`usdSend` from perp margin, `spotSend` of spot tokens) and spot <-> perp
 * USDC (`usdClassTransfer`). Agents can never sign these (HyperCore
 * enforces it). Verified from the ledger by nonce and signed fields, or
 * from `extraAgents`.
 */
import { hypercore, NETWORKS, sameOwner, type StepAmount } from "@elyia/core";
import { amountOf, assetOfAmount, formatAmount, resolveAsset, stepAddress, type ResolvedAsset } from "../assets.js";
import type { EngineDeps } from "../deps.js";
import { engineError } from "../errors.js";
import { unitsToDecimal } from "./hypercoreTrade.js";
import { userSignedContext, userSignedRequest } from "../hypercore/requests.js";
import { verifyUserSigned } from "../hypercore/verify.js";
import type { AdapterAction, AdapterRoute, PlannedStep, PrepareContext, PreparedPayload, ProtocolAdapter } from "../types.js";

/** Browser agent name and validity (HyperCore allows up to 180 days; Elyia keeps keys short-lived). */
export const WEB_AGENT_NAME = "elyia-web";
export const WEB_AGENT_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
/** An approved agent counts as usable while it has at least this long left (otherwise the planner re-approves). */
export const AGENT_MIN_REMAINING_MS = 60 * 60 * 1000;

/** The approved agent of `user` at `address`, when it still has time left. */
export async function approvedAgent(deps: EngineDeps, network: AdapterRoute["network"], user: string, address: string, now: number): Promise<{ readonly name: string; readonly validUntil: number } | null> {
  const listed = (await deps.core.extraAgents(network, user)).find((entry) => entry.address.toLowerCase() === address.toLowerCase());
  if (!listed || listed.validUntil <= now + AGENT_MIN_REMAINING_MS) return null;
  return { name: listed.name, validUntil: listed.validUntil };
}

function isCore(deps: EngineDeps, network: AdapterRoute["network"]): boolean {
  return deps.networks[network]?.vm === "hypercore";
}

export function createHypercoreAgentAdapter(deps: EngineDeps): ProtocolAdapter {
  return {
    id: "hypercore-agent",
    protocols: ["hypercore-perps"],
    label: "HyperCore agent",
    supports: (route) => route.kind === "agent" && isCore(deps, route.network),
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const agent = action.agent;
      if (!agent) throw engineError("AGENT_KEY_REQUIRED");
      const keeper = action.signer === "keeper";
      if (keeper) throw engineError("KEEPER_DISABLED", "Keeper keys are approved from the Agent settings, not inside an intent.");
      const validUntil = deps.clock.now() + WEB_AGENT_VALIDITY_MS;
      return {
        protocol: "hypercore-perps",
        kind: "agent",
        title: `Approve Elyia's trade-only key ${agent.slice(0, 6)}…${agent.slice(-4)} on HyperCore (30 days)`,
        mode: "wallet",
        inputs: [],
        outputs: [],
        feesUsd: "0",
        estimatedSeconds: 3,
        settlement: { kind: "same-network", mechanism: "ledger" },
        warnings: ["The agent key can place and cancel orders but can never withdraw or transfer your funds; revoke it any time."],
        route: { variant: "approve-agent", slippageBps: 0, params: { agent: agent.toLowerCase() } },
        requestCount: 1,
        agent: { address: agent.toLowerCase() as `0x${string}`, name: WEB_AGENT_NAME, validUntil, scope: "browser" },
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const agent = step.agent;
      if (!agent) throw engineError("STEP_INVALID", "The agent step lost its agent.");
      const listed = await approvedAgent(deps, step.network, stepAddress(step), agent.address, context.now);
      if (listed) return { requests: [], inputs: [], outputs: [], warnings: [], skip: `The trade-only key is already approved until ${new Date(listed.validUntil).toISOString()}.` };
      // The expiry is recomputed at prepare so a late signature still grants the full window.
      const validUntil = context.now + WEB_AGENT_VALIDITY_MS;
      const action = hypercore.approveAgentAction(userSignedContext(step.network, context.signatureChainId), {
        agentAddress: agent.address,
        agentName: hypercore.agentNameWithExpiry(WEB_AGENT_NAME, validUntil, context.now),
        nonce: deps.nonces.next(),
      });
      return {
        requests: [userSignedRequest(step.network, stepAddress(step), action, step.title)],
        inputs: [],
        outputs: [],
        warnings: [],
        agent: { ...agent, validUntil },
      };
    },
    verify: (context) => verifyUserSigned(deps, context),
  };
}

/** spotSend token string `NAME:tokenId` of a HyperCore spot asset. */
export function tokenString(asset: ResolvedAsset): string {
  if (!asset.core) throw engineError("TOKEN_UNKNOWN", `${asset.symbol} is not a HyperCore spot token.`);
  return `${asset.core.name}:${asset.core.tokenId}`;
}

export function createHypercoreTransferAdapter(deps: EngineDeps): ProtocolAdapter {
  return {
    id: "hypercore-transfers",
    protocols: ["hypercore-transfers"],
    label: "HyperCore transfers",
    supports: (route) =>
      isCore(deps, route.network) &&
      route.destinationNetwork === route.network &&
      ((route.kind === "transfer" && route.input !== null) || (route.kind === "margin" && route.variant !== "isolated-margin" && route.input?.symbol.toUpperCase() === "USDC")),
    async plan(action: AdapterAction): Promise<PlannedStep> {
      const input = action.input as ResolvedAsset;
      if (action.amount <= 0n) throw engineError("AMOUNT_TOO_SMALL");
      const base = { protocol: "hypercore-transfers", mode: "wallet" as const, feesUsd: "0", estimatedSeconds: 3, settlement: { kind: "same-network" as const, mechanism: "ledger" as const }, requestCount: 1 };
      if (action.kind === "margin") {
        const toPerp = action.params.toPerp !== false && action.params.direction !== "toSpot";
        const amount = formatAmount(action.amount, input.decimals, "USDC");
        const spotUsdc = input.margin ? null : input;
        const outputs: StepAmount[] = toPerp
          ? [{ asset: `${NETWORKS[action.network].caip2}/margin:usdc` as StepAmount["asset"], symbol: "USDC", decimals: input.decimals, expected: action.amount.toString(), minimum: action.amount.toString() }]
          : spotUsdc ? [amountOf(spotUsdc, action.amount, { minimum: action.amount })] : [];
        return {
          ...base,
          kind: "margin",
          title: `Move ${amount} ${toPerp ? "from spot to perps" : "from perps to spot"} on HyperCore`,
          inputs: [amountOf(input, action.amount)],
          outputs,
          warnings: [],
          route: { variant: toPerp ? "to-perp" : "to-spot", slippageBps: 0, plannedInput: action.amount.toString() },
        };
      }
      const recipient = action.recipient.address.toLowerCase();
      if (sameOwner(recipient, action.account.address)) throw engineError("RECIPIENT_INVALID", "That is your own HyperCore account; nothing to send.");
      const usd = input.margin === true;
      return {
        ...base,
        kind: "transfer",
        title: `Send ${formatAmount(action.amount, input.decimals, input.symbol)} to ${recipient.slice(0, 6)}…${recipient.slice(-4)} on HyperCore`,
        inputs: [amountOf(input, action.amount)],
        outputs: [amountOf(input, action.amount, { minimum: action.amount })],
        warnings: ["HyperCore sends are final; check the address."],
        route: { variant: usd ? "usd-send" : "spot-send", slippageBps: 0, plannedInput: action.amount.toString(), params: { destination: recipient } },
        recipient: action.recipient,
      };
    },
    async prepare(context: PrepareContext): Promise<PreparedPayload> {
      const { step } = context;
      const inputAmount = step.inputs[0];
      if (!inputAmount) throw engineError("STEP_INVALID", "The transfer step lost its amount.");
      const input = assetOfAmount(inputAmount);
      const from = stepAddress(step);
      const signing = userSignedContext(step.network, context.signatureChainId);
      const nonce = deps.nonces.next();
      const amount = unitsToDecimal(context.amount, input.decimals);
      const variant = step.route?.variant;
      let action: hypercore.UserSignedAction;
      if (variant === "to-perp" || variant === "to-spot") {
        action = hypercore.usdClassTransferAction(signing, { amount, toPerp: variant === "to-perp", nonce });
      } else if (variant === "usd-send") {
        action = hypercore.usdSendAction(signing, { destination: String(step.route?.params?.destination), amount, time: nonce });
      } else if (variant === "spot-send") {
        const resolved = await resolveAsset(deps, step.network, inputAmount.asset);
        action = hypercore.spotSendAction(signing, { destination: String(step.route?.params?.destination), token: tokenString(resolved), amount, time: nonce });
      } else {
        throw engineError("STEP_INVALID", `Unknown HyperCore transfer variant ${String(variant)}.`);
      }
      return {
        requests: [userSignedRequest(step.network, from, action, step.title)],
        inputs: [{ ...inputAmount, expected: context.amount.toString() }],
        outputs: step.outputs.map((output) => ({ ...output, expected: context.amount.toString(), minimum: context.amount.toString() })),
        warnings: [],
      };
    },
    verify: (context) => verifyUserSigned(deps, context),
  };
}
