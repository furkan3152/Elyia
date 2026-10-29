/**
 * The "Enable trading" payloads (pure): approveAgent for a fresh in-browser
 * key named `elyia-web valid_until <ms>`, and the revoke that replaces it
 * with a throwaway address under the same name (HyperCore deregisters the
 * old agent of a name when a new one is approved; agent addresses are never
 * reused).
 *
 * approveAgent is user-signed EIP-712: the user's wallet signs it in the
 * domain of the chain the wallet is on (`signatureChainId` = the connected
 * chain id; Elysium testnet 0x185d9 and HyperEVM 0x3e6 are both accepted),
 * and `hyperliquidChain` ("Testnet"/"Mainnet") pins the environment.
 */
import { agentNameWithExpiry, approveAgentAction, MAX_AGENT_VALIDITY_MS, parseAgentName, type ApproveAgentAction } from "@elyia/core/hypercore/actions";
import type { ExtraAgent } from "@elyia/core/hypercore/info";
import { typedDataForUserAction, type Eip712TypedData } from "@elyia/core/hypercore/signing";
import { signatureChainIdHex } from "@elyia/core/networks";

/** The in-browser agent's name on HyperCore (one per account: a new device replaces the old key). */
export const WEB_AGENT_NAME = "elyia-web";

export const EXPIRY_CHOICES = [7, 30, 90, 180] as const;
export type ExpiryDays = (typeof EXPIRY_CHOICES)[number];
export const DEFAULT_EXPIRY_DAYS: ExpiryDays = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Margin under HyperCore's 180-day cap, so clock skew never turns a valid choice into a refusal. */
const CAP_MARGIN_MS = 10 * 60 * 1000;

export function validUntilFor(days: ExpiryDays, now: number): number {
  return Math.min(now + days * DAY_MS, now + MAX_AGENT_VALIDITY_MS - CAP_MARGIN_MS);
}

export interface ApprovePayload {
  readonly action: ApproveAgentAction;
  readonly typedData: Eip712TypedData<`HyperliquidTransaction:${string}`>;
  readonly nonce: number;
  readonly agentName: string;
  readonly validUntil: number;
}

export interface ApproveInput {
  readonly hyperliquidChain: "Mainnet" | "Testnet";
  /** The connected wallet's chain id: the domain the wallet signs in. */
  readonly walletChainId: number;
  readonly agentAddress: string;
  readonly validUntil: number;
  readonly nonce: number;
  readonly now: number;
}

/** approveAgent for `elyia-web valid_until <validUntil>` and its typed data. */
export function buildApproveAgent(input: ApproveInput): ApprovePayload {
  const agentName = agentNameWithExpiry(WEB_AGENT_NAME, input.validUntil, input.now);
  const action = approveAgentAction(
    { hyperliquidChain: input.hyperliquidChain, signatureChainId: signatureChainIdHex(input.walletChainId) },
    { agentAddress: input.agentAddress, agentName, nonce: input.nonce },
  );
  return { action, typedData: typedDataForUserAction(action), nonce: input.nonce, agentName, validUntil: input.validUntil };
}

/** Lifetime of the throwaway agent a revoke installs: just long enough to be accepted, then HyperCore prunes it. */
export const REVOKE_PLACEHOLDER_MS = 10 * 60 * 1000;

/**
 * Revoke: approve a random, immediately forgotten address under the same
 * name. The old key stops working the moment HyperCore accepts this.
 */
export function buildRevokeAgent(input: Omit<ApproveInput, "validUntil">): ApprovePayload {
  return buildApproveAgent({ ...input, validUntil: input.now + REVOKE_PLACEHOLDER_MS });
}

export interface AgentListing {
  readonly name: string;
  readonly address: string;
  readonly validUntil: number | null;
  /** This browser holds the key. */
  readonly thisDevice: boolean;
  /** Elyia's web agent (on any device). */
  readonly isElyia: boolean;
  readonly expired: boolean;
}

/** Named agents of an account (`extraAgents`), tagged with this device's key. */
export function listAgents(agents: readonly ExtraAgent[] | null | undefined, localAddress: string | null, now: number): AgentListing[] {
  if (!agents) return [];
  return agents
    .map((agent) => {
      const parsed = parseAgentName(agent.name);
      const validUntil = Number.isSafeInteger(agent.validUntil) ? agent.validUntil : parsed.validUntil;
      return {
        name: parsed.name,
        address: agent.address.toLowerCase(),
        validUntil,
        thisDevice: localAddress !== null && agent.address.toLowerCase() === localAddress.toLowerCase(),
        isElyia: parsed.name === WEB_AGENT_NAME || parsed.name.startsWith("elyia"),
        expired: validUntil !== null && validUntil <= now,
      };
    })
    .sort((a, b) => Number(b.thisDevice) - Number(a.thisDevice) || a.name.localeCompare(b.name));
}

export type AgentHealth =
  /** HyperCore lists this device's key and it has not expired. */
  | "active"
  /** Past valid_until: HyperCore prunes it. */
  | "expired"
  /** HyperCore does not list it: revoked, replaced on another device, or not approved yet. */
  | "missing";

export function agentHealth(agents: readonly ExtraAgent[] | null | undefined, localAddress: string, now: number): AgentHealth {
  const match = (agents ?? []).find((agent) => agent.address.toLowerCase() === localAddress.toLowerCase());
  if (!match) return "missing";
  return match.validUntil <= now ? "expired" : "active";
}

/** "elyia-web valid_until …" approvals expire on their own; this says how soon, in days (rounded down). */
export function daysLeft(validUntil: number, now: number): number {
  return Math.max(0, Math.floor((validUntil - now) / DAY_MS));
}
