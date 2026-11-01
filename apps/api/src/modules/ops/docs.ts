/**
 * Typed access to store collections for records declared as interfaces
 * (the store's JsonValue constraint wants index signatures; these records
 * are plain JSON by construction). Every collection the platform modules
 * use is listed here: it is the "schema" of the document store.
 */
import type { AppContext } from "../../context.js";
import type { Collection } from "../../store/types.js";

/** Store collections (tables) of the ops, developers, admin and agent modules. */
export const PLATFORM_COLLECTIONS = Object.freeze({
  siweNonces: "siwe_nonces",
  sessionRevocations: "session_revocations",
  telegramLinkCodes: "telegram_link_codes",
  telegramLinks: "telegram_links",
  tracks: "tracks",
  watchlists: "watchlists",
  alerts: "alerts",
  alertFirings: "alert_firings",
  developers: "developers",
  apiKeys: "api_keys",
  apiKeyHashes: "api_key_hashes",
  webhooks: "webhooks",
  webhookDeliveries: "webhook_deliveries",
  developerSettings: "developer_settings",
  intentOwners: "intent_owners",
  deployments: "deployments",
  deploymentHistory: "deployment_history",
  featureFlags: "feature_flags",
  agentThreads: "agent_threads",
  agentMemory: "agent_memory",
  agentProposals: "agent_proposals",
  agentProposalLinks: "agent_proposal_links",
  agentAutomations: "agent_automations",
  agentFeed: "agent_feed",
  keepers: "keepers",
  keeperAudit: "keeper_audit",
  herdTasks: "herd_tasks",
  herdApplications: "herd_applications",
  herdHandles: "herd_handles",
  herdSettings: "herd_settings",
  herdRaffles: "herd_raffles",
  herdMerkle: "herd_merkle",
  herdPartners: "herd_partners",
  herdAudit: "herd_audit",
  herdTokens: "herd_tokens",
  herdIndex: "herd_index",
  herdMoves: "herd_moves",
  herdSeen: "herd_seen",
} as const);

export function docs<T>(ctx: AppContext, name: string): Collection<T> {
  return ctx.store.collection(name) as unknown as Collection<T>;
}

export function iso(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}
