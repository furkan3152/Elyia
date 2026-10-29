/**
 * The field manual (pure): every Elyia API endpoint filed by altitude, with
 * a survey status, and the snippets the paper cards print. The
 * status says what THIS build of the API serves; "being surveyed" means the
 * route is specified but not served yet, never that it works.
 */

export type Method = "GET" | "POST" | "PATCH" | "DELETE" | "SSE";
/** open: served; partial: served with gaps (named in `note`); surveying: specified, not served yet. */
export type Survey = "open" | "partial" | "surveying";
export type Altitude = "base" | "summit" | "ridge" | "floor" | "range" | "guide";

export interface Endpoint {
  readonly method: Method;
  readonly path: string;
  readonly what: string;
  readonly survey: Survey;
  readonly note?: string;
  /** A safe GET the page may call to show a live answer ("/v1/health"). */
  readonly probe?: string;
}

export interface AltitudeGroup {
  readonly altitude: Altitude;
  readonly title: string;
  readonly subtitle: string;
  readonly endpoints: readonly Endpoint[];
}

export const MANUAL: readonly AltitudeGroup[] = [
  {
    altitude: "base",
    title: "Base camp",
    subtitle: "health, networks, the registry",
    endpoints: [
      { method: "GET", path: "/v1/health", what: "Is the API up, which mode, which modules", survey: "open", probe: "/v1/health" },
      { method: "GET", path: "/v1/networks", what: "Elysium, HyperEVM and HyperCore, testnet and mainnet: RPCs, explorers, status", survey: "open", probe: "/v1/networks" },
      { method: "GET", path: "/v1/protocols", what: "The ecosystem registry: who is deployed where, and what Elyia can route through", survey: "open", probe: "/v1/protocols" },
      { method: "GET", path: "/v1/tokens?network=", what: "Verified tokens per network; anything else is unverified or a look-alike", survey: "open", probe: "/v1/tokens?network=elysium-testnet" },
    ],
  },
  {
    altitude: "summit",
    title: "The Summit",
    subtitle: "Elysium, block by block",
    endpoints: [
      { method: "GET", path: "/v1/elysium/pulse", what: "Head, measured block time, gas, tx/s, parent head", survey: "open", probe: "/v1/elysium/pulse" },
      { method: "SSE", path: "/v1/elysium/blocks/stream", what: "One `block` event per Elysium block (~114 ms), `pulse` summaries; Last-Event-ID resumes", survey: "open" },
      { method: "GET", path: "/v1/elysium/bridge/stats", what: "Canonical bridge flow and retryables needing a redeem", survey: "surveying" },
    ],
  },
  {
    altitude: "floor",
    title: "The Floor",
    subtitle: "HyperCore markets",
    endpoints: [
      { method: "GET", path: "/v1/markets", what: "Perps and spot with mark, mid, oracle, funding, open interest, 24 h volume", survey: "open", probe: "/v1/markets?limit=3" },
      { method: "GET", path: "/v1/markets/:coin", what: "One market, plus /book, /trades and /candles?interval=", survey: "open" },
      { method: "SSE", path: "/v1/markets/stream?coins=", what: "mids, trades and book for the coins you name, from one shared socket", survey: "open" },
      { method: "GET", path: "/v1/funding", what: "Funding across venues, annualised", survey: "open" },
      { method: "GET", path: "/v1/prices", what: "Reference prices (HyperCore mainnet mids), always labelled", survey: "open" },
      { method: "GET", path: "/v1/vaults · /v1/whales", what: "HLP and vaults ranked; large positions and their liquidation levels", survey: "open" },
    ],
  },
  {
    altitude: "range",
    title: "Your range",
    subtitle: "portfolio and route cards",
    endpoints: [
      { method: "GET", path: "/v1/portfolio/:address", what: "One balance sheet across all three layers, valued at reference prices, with liquidation distances", survey: "open" },
      { method: "GET", path: "/v1/portfolio/:address/history", what: "Fills, funding and ledger as one timeline", survey: "open" },
      { method: "SSE", path: "/v1/portfolio/:address/stream", what: "The snapshot again whenever it changes", survey: "open" },
      { method: "POST", path: "/v1/intents?dryRun=true", what: "Plan a route card from actions or goals; quote bound, Rule Book checked", survey: "partial", note: "structured actions plan today; free text answers TEXT_NOT_SUPPORTED_YET" },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/prepare", what: "Fresh quote → unsigned requests + quote binding. The server never signs", survey: "partial" },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/submit", what: "References only (tx hash, hc:cloid:, hc:nonce:); proven from chain", survey: "partial" },
      { method: "SSE", path: "/v1/intents/:id/stream", what: "Every step's state, as it happens", survey: "partial" },
      { method: "POST", path: "/v1/track", what: "Watch any tx hash or HyperCore reference to settlement", survey: "surveying" },
    ],
  },
  {
    altitude: "guide",
    title: "The Guide",
    subtitle: "agent, alerts, Telegram, MCP",
    endpoints: [
      { method: "POST", path: "/v1/agent/chat", what: "Stream the Guide: text, survey readings, route proposals to sign", survey: "surveying" },
      { method: "GET", path: "/v1/agent/automations", what: "Standing orders under the Rule Book; kill switch", survey: "surveying" },
      { method: "GET", path: "/v1/alerts", what: "Price, funding, rope distance, fills, bridge settled", survey: "surveying" },
      { method: "POST", path: "/v1/telegram/link-code", what: "Link a Telegram chat to your account for alerts and the mini app", survey: "surveying" },
      { method: "POST", path: "/v1/mcp", what: "Read-only tools for AI agents; proposals return a signing link", survey: "surveying" },
    ],
  },
];

export function surveyCounts(groups: readonly AltitudeGroup[] = MANUAL): Readonly<Record<Survey, number>> {
  const counts: Record<Survey, number> = { open: 0, partial: 0, surveying: 0 };
  for (const group of groups) for (const endpoint of group.endpoints) counts[endpoint.survey] += 1;
  return counts;
}

export const SURVEY_WORDS: Readonly<Record<Survey, string>> = {
  open: "served",
  partial: "served, with gaps",
  surveying: "being surveyed",
};

/** Every endpoint the page may call on its own: GETs only, no parameters a person must fill in. */
export function probes(groups: readonly AltitudeGroup[] = MANUAL): string[] {
  return groups.flatMap((group) => group.endpoints.flatMap((endpoint) => (endpoint.probe && endpoint.method === "GET" ? [endpoint.probe] : [])));
}

/* Snippets ---------------------------------------------------------------- */

export type SnippetLanguage = "curl" | "ts";

export interface Snippet {
  readonly id: string;
  readonly title: string;
  readonly caption: string;
  readonly survey: Survey;
  readonly code: Readonly<Partial<Record<SnippetLanguage | "json", string>>>;
}

export function snippets(apiBase: string): Snippet[] {
  const base = apiBase.replace(/\/+$/u, "");
  return [
    {
      id: "rest",
      title: "One call, three layers",
      caption: "REST · JSON · error envelope",
      survey: "open",
      code: {
        curl: `curl -s "${base}/v1/portfolio/0xYOUR_ADDRESS?mode=testnet" \\
  | jq '.totals.netWorthUsd, .positions[].liquidation'`,
        ts: `import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";

const res = await fetch(\`${base}/v1/portfolio/\${address}?mode=testnet\`);
if (!res.ok) {
  const { error } = await res.json(); // { code, message, details, requestId }
  throw new Error(\`\${error.code}: \${error.message}\`);
}
const range: PortfolioSnapshot = await res.json();
console.log(range.totals.netWorthUsd);`,
      },
    },
    {
      id: "stream",
      title: "Blocks as they land",
      caption: "SSE · one event per Elysium block",
      survey: "open",
      code: {
        curl: `curl -N "${base}/v1/elysium/blocks/stream"
# event: block
# id: 18663383
# data: {"number":18663383,"txCount":2,"baseFeeGwei":0.1,...}`,
        ts: `import { PULSE_EVENTS, type PulseBlock } from "@elyia/core/pulse";

const source = new EventSource("${base}/v1/elysium/blocks/stream");
source.addEventListener(PULSE_EVENTS.block, (event) => {
  const block: PulseBlock = JSON.parse(event.data);
  console.log(block.number, block.txCount); // ~9 a second
});
// the browser resumes with Last-Event-ID after a drop`,
      },
    },
    {
      id: "route",
      title: "A route card, quote bound",
      caption: "plan → prepare → you sign → submit references",
      survey: "partial",
      code: {
        curl: `curl -s -X POST "${base}/v1/intents?dryRun=true" \\
  -H 'content-type: application/json' \\
  -d '{"accounts":["eip155:998:0xYOUR_ADDRESS"],
       "actions":[{"kind":"bridge","network":"hyperevm-testnet",
                   "from":"HYPE","to":"HYPE","amount":"20",
                   "toNetwork":"elysium-testnet"}]}'`,
        ts: `// 1. plan (nothing is stored with dryRun)
const plan = await post("/v1/intents?dryRun=true", body);
// 2. prepare a step: unsigned requests + the quote binding
const { payload } = await post(\`/v1/intents/\${id}/steps/\${sid}/prepare\`, {});
// payload.requests are unsigned; payload.quoteBinding pins the quote
// 3. the person signs in their own wallet. Elyia never signs.
const hash = await wallet.sendTransaction(payload.requests[0]);
// 4. submit the reference only; the API proves it from the chain
await post(\`/v1/intents/\${id}/steps/\${sid}/submit\`, { references: [hash] });`,
      },
    },
    {
      id: "mcp",
      title: "Give your agent the range",
      caption: "MCP · read-only tools · signing links",
      survey: "surveying",
      code: {
        json: `{
  "mcpServers": {
    "elyia": {
      "type": "http",
      "url": "${base}/v1/mcp"
    }
  }
}`,
      },
    },
  ];
}

/** The error envelope every endpoint answers with, as printed on the manual. */
export const ERROR_EXAMPLE = `{
  "error": {
    "code": "QUOTE_EXPIRED",
    "message": "The quote for step 2 expired 4 s ago. Prepare the step again for a fresh quote.",
    "details": { "step": "s2", "expiredAt": "2026-10-29T18:02:11.204Z" },
    "requestId": "8f1c2e4a-…"
  }
}`;
