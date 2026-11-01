/**
 * The REST reference the portal prints: the routes this API serves, grouped,
 * with who may call them. Kept in step with the route headers of
 * apps/api/src/modules/*. Pure (node tests load it).
 */
import { WEBHOOK_EVENT_TYPES } from "@elyia/core/api/developers";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "SSE";
export type Auth = "public" | "key" | "session" | "developer" | "admin";
/* "key": public too, but a key meters it, carries your integrator fee and routes the webhooks to you. */

export interface RouteRow {
  readonly method: Method;
  readonly path: string;
  readonly what: string;
  readonly auth: Auth;
}

export interface RouteGroup {
  readonly title: string;
  readonly rows: readonly RouteRow[];
}

export const REST: readonly RouteGroup[] = [
  {
    title: "Read",
    rows: [
      { method: "GET", path: "/v1/health", what: "Mode, uptime, every RPC and the store", auth: "public" },
      { method: "GET", path: "/v1/networks", what: "Elysium, HyperEVM, HyperCore with live status", auth: "public" },
      { method: "GET", path: "/v1/protocols", what: "The 164-protocol registry; which ones execute", auth: "public" },
      { method: "GET", path: "/v1/venues", what: "Venues in the auction, per network", auth: "public" },
      { method: "GET", path: "/v1/markets", what: "HyperCore perps and spot", auth: "public" },
      { method: "GET", path: "/v1/portfolio/:address", what: "One balance sheet across three layers", auth: "public" },
    ],
  },
  {
    title: "Intents",
    rows: [
      { method: "POST", path: "/v1/intents/parse", what: "Sentence → goals, questions, plan input", auth: "public" },
      { method: "POST", path: "/v1/intents", what: "Plan a priced route (dryRun stores nothing)", auth: "key" },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/prepare", what: "Fresh quote → unsigned requests", auth: "key" },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/submit", what: "Tx hash or HyperCore reference; proven from chain", auth: "key" },
      { method: "SSE", path: "/v1/intents/:id/stream", what: "Every step's state as it happens", auth: "public" },
    ],
  },
  {
    title: "Your project",
    rows: [
      { method: "POST", path: "/v1/auth/siwe/nonce · /verify", what: "Sign-In with Ethereum → Elyia-Session", auth: "public" },
      { method: "POST", path: "/v1/developers/register", what: "Open a developer profile", auth: "session" },
      { method: "POST", path: "/v1/developers/keys", what: "Create a key (shown once); rotate; revoke", auth: "developer" },
      { method: "GET", path: "/v1/developers/usage?days=", what: "Requests, plans, prepares per key per day", auth: "developer" },
      { method: "POST", path: "/v1/developers/webhooks", what: "Signed deliveries; test fire; delivery log", auth: "developer" },
      { method: "PUT", path: "/v1/developers/fees", what: "Integrator fee 0–50 bps and recipient", auth: "developer" },
      { method: "POST", path: "/v1/mcp", what: "MCP tools for agents (read + draft)", auth: "key" },
    ],
  },
];

export const AUTH_WORDS: Readonly<Record<Auth, string>> = { public: "public", key: "public · key metered", session: "wallet session", developer: "developer", admin: "owner" };

export const EVENT_NOTES: Readonly<Record<(typeof WEBHOOK_EVENT_TYPES)[number], string>> = {
  "intent.step.settled": "A step your key planned settled on chain.",
  "intent.failed": "A step or the intent failed; the reason is in data.",
  "alert.fired": "One of your alerts crossed its threshold.",
  "launch.new": "A new protocol or pool appeared on a network you follow.",
};

export const ERROR_ENVELOPE = `{
  "error": {
    "code": "KEY_SCOPE",
    "message": "This key lacks the \\"plan\\" scope.",
    "details": null,
    "requestId": "8f1c2e4a-…"
  }
}`;

export const COMMON_ERRORS: ReadonlyArray<readonly [string, number, string]> = [
  ["UNAUTHORIZED", 401, "No key, a revoked key, or no session"],
  ["KEY_SCOPE", 403, "The key lacks the scope this route needs"],
  ["QUOTA_EXCEEDED", 429, "A key quota is spent; Retry-After says when"],
  ["RATE_LIMITED", 429, "Per-IP limit; slow down"],
  ["FEE_OUT_OF_RANGE", 400, "Integrator fee outside 0–50 bps"],
  ["INTENT_CLARIFY", 422, "Ely needs an answer before planning"],
];

export const CHANGELOG: ReadonlyArray<readonly [string, string]> = [
  ["Nov 2026", "Developer platform: keys, usage, webhooks, integrator fee, widget config, MCP."],
  ["Nov 2026", "ElyiaRouter, ElyAccountFactory, ElyOrders: owner-deployed, server-verified."],
  ["Oct 2026", "Intents engine: 18 executable protocols, EN + TR reader."],
  ["Nov 9", "Elysium mainnet 99901: keys work on both modes."],
];

export function countRoutes(groups: readonly RouteGroup[] = REST): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}
