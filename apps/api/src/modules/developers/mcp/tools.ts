/**
 * MCP tools (read-only, plus a signing-link hand-off). Inputs are plain JSON
 * Schema (converted once by the server) and validated again with zod here.
 * No tool signs, sends or stores a transaction: `plan_intent` is a dry run,
 * and `create_signing_link` only builds an Elyia web URL the user opens to
 * review and sign with their own wallet.
 */
import { NETWORK_KEYS, NETWORKS, type IntentActionSpec, type NetworkKey } from "@elyia/core";
import { z } from "zod";
import type { AppContext } from "../../../context.js";
import { isElyiaHttpError } from "../../../http/errors.js";
import { getIntent, marketRow, perpMarkets, planActions, protocols, routeCardOf, shield, snapshot, venues } from "../../agent/perception.js";

export const MAX_TOOL_TEXT = 24_000;

export interface ToolCaller {
  readonly keyId: string | null;
}

export interface ElyiaTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  run(ctx: AppContext, args: Record<string, unknown>, caller: ToolCaller): Promise<unknown>;
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const networkKey = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]);
const actionSchema = z
  .object({
    kind: z.string().min(1).max(32),
    network: networkKey,
    from: z.string().max(100).optional(),
    to: z.string().max(100).optional(),
    amount: z.string().max(40).optional(),
    toNetwork: networkKey.optional(),
    protocol: z.string().max(64).optional(),
    market: z.string().max(40).optional(),
    side: z.enum(["buy", "sell", "long", "short"]).optional(),
    size: z.string().max(40).optional(),
    price: z.string().max(40).optional(),
    reduceOnly: z.boolean().optional(),
    takeProfit: z.string().max(40).optional(),
    stopLoss: z.string().max(40).optional(),
    after: z.array(z.number().int().min(0).max(7)).min(1).max(7).optional(),
    params: z.record(z.union([z.string().max(80), z.number(), z.boolean()])).optional(),
  })
  .strict();
const actionsSchema = z
  .array(actionSchema)
  .min(1)
  .max(8)
  .refine((list) => list.every((entry, index) => (entry.after ?? []).every((parent) => parent < index)), "`after` may only name earlier actions");

const NETWORK_SCHEMA = { type: "string", enum: [...NETWORK_KEYS] };
const ADDRESS_SCHEMA = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "A 0x wallet address." };

/** Web origin for signing links: the first configured non-localhost origin, else the first one. */
export function webOrigin(ctx: AppContext): string {
  return ctx.config.webOrigins.find((origin) => !origin.includes("localhost")) ?? ctx.config.webOrigins[0] ?? "https://elyia.app";
}

function compactMarket(row: Awaited<ReturnType<typeof marketRow>>) {
  return { coin: row.coin, name: row.displayName, markPx: row.markPx, change24hPct: row.change24hPct, fundingAprPct: row.fundingAprPct, openInterestUsd: row.openInterestUsd, volume24hUsd: row.volume24hUsd, maxLeverage: row.maxLeverage };
}

export const ELYIA_TOOLS: readonly ElyiaTool[] = [
  {
    name: "get_networks",
    title: "Networks",
    description: "Networks Elyia serves (Elysium, HyperEVM, HyperCore; testnet and mainnet) and which ones this server runs in its mode.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(ctx) {
      return { mode: ctx.config.mode, networks: Object.values(NETWORKS).map((network) => ({ key: network.key, name: network.name, environment: network.environment, vm: network.vm, ...(network.vm === "evm" ? { chainId: network.chainId } : {}) })) };
    },
  },
  {
    name: "get_markets",
    title: "HyperCore perp markets",
    description: "HyperCore perp markets of the server's mode, by 24 h volume: mark, change, funding APR, open interest. Testnet marks are test prices.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, q: { type: "string", maxLength: 32 } }, additionalProperties: false },
    async run(ctx, args) {
      const input = z.object({ limit: z.number().int().min(1).max(100).optional(), q: z.string().max(32).optional() }).parse(args);
      const q = input.q?.toUpperCase();
      const rows = (await perpMarkets(ctx)).filter((row) => !q || row.coin.toUpperCase().includes(q)).sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
      return { count: rows.length, markets: rows.slice(0, input.limit ?? 25).map(compactMarket) };
    },
  },
  {
    name: "get_market",
    title: "One market",
    description: "One HyperCore market by coin (BTC, HYPE, xyz:TSLA, PURR/USDC).",
    inputSchema: { type: "object", properties: { coin: { type: "string", minLength: 1, maxLength: 40 } }, required: ["coin"], additionalProperties: false },
    async run(ctx, args) {
      const { coin } = z.object({ coin: z.string().min(1).max(40) }).parse(args);
      return compactMarket(await marketRow(ctx, coin));
    },
  },
  {
    name: "get_portfolio",
    title: "Portfolio",
    description: "Unified balance sheet of a public address across HyperCore, HyperEVM and Elysium: net worth (reference USD), exposure, perp positions with liquidation distance.",
    inputSchema: { type: "object", properties: { address: ADDRESS_SCHEMA }, required: ["address"], additionalProperties: false },
    async run(ctx, args) {
      const input = z.object({ address }).parse(args);
      const snap = await snapshot(ctx, input.address);
      return {
        address: snap.address,
        mode: snap.mode,
        priceLabel: snap.pricing.label,
        totals: snap.totals,
        exposure: snap.exposure.slice(0, 12),
        positions: snap.positions.map((position) => ({ coin: position.coin, side: position.side, size: position.size, entryPx: position.entryPx, markPx: position.markPx, unrealizedPnl: position.unrealizedPnl, leverage: position.leverage, liquidationPx: position.liquidationPx, liquidationDistancePct: position.liquidationDistancePct, liquidationRisk: position.liquidationRisk })),
        notes: snap.notes,
      };
    },
  },
  {
    name: "get_protocols",
    title: "Protocol registry",
    description: "Elyia's verified protocol registry (164 protocols): which run on a network and which the engine executes.",
    inputSchema: { type: "object", properties: { network: NETWORK_SCHEMA, q: { type: "string", minLength: 2, maxLength: 64 }, executable: { type: "boolean" } }, additionalProperties: false },
    async run(ctx, args) {
      const input = z.object({ network: networkKey.optional(), q: z.string().min(2).max(64).optional(), executable: z.boolean().optional() }).parse(args);
      const rows = protocols(ctx, input);
      return { count: rows.length, protocols: rows.slice(0, 60).map((row) => ({ id: row.id, name: row.name, kind: row.kind, status: row.status, executable: row.executable })) };
    },
  },
  {
    name: "get_venues",
    title: "Venues",
    description: "Venues the engine routes through (live) and the read-only registry venues, per network.",
    inputSchema: { type: "object", properties: { network: NETWORK_SCHEMA }, additionalProperties: false },
    async run(ctx, args) {
      const input = z.object({ network: networkKey.optional() }).parse(args);
      return { venues: venues(ctx, input.network).map((venue) => ({ id: venue.id, name: venue.label, network: venue.network, kind: venue.kind, status: venue.status })) };
    },
  },
  {
    name: "plan_intent",
    title: "Plan an intent (dry run)",
    description: "Plans intent actions for an address through the venue auction and the Rule Book. Dry run: nothing is stored or signed. Returns the route card.",
    inputSchema: {
      type: "object",
      properties: {
        address: ADDRESS_SCHEMA,
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", description: "swap, bridge, transfer, wrap, stake, deposit, order ..." },
              network: NETWORK_SCHEMA,
              from: { type: "string" },
              to: { type: "string" },
              amount: { type: "string" },
              toNetwork: NETWORK_SCHEMA,
              protocol: { type: "string" },
              market: { type: "string" },
              side: { type: "string", enum: ["buy", "sell", "long", "short"] },
              size: { type: "string" },
              price: { type: "string" },
              reduceOnly: { type: "boolean" },
              takeProfit: { type: "string" },
              stopLoss: { type: "string" },
              after: { type: "array", items: { type: "integer", minimum: 0 }, description: "Indexes of earlier actions this one waits for; with amount \"max\" it spends that output." },
              params: { type: "object", description: "portionBps on a chained \"max\" step (5000 = half); protect/reduce for orders." },
            },
            required: ["kind", "network"],
            additionalProperties: false,
          },
        },
      },
      required: ["address", "actions"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const input = z.object({ address, actions: actionsSchema }).parse(args);
      const plan = await planActions(ctx, input.address, input.actions as unknown as IntentActionSpec[]);
      return { card: routeCardOf(plan), policy: plan.policy.decision, steps: plan.intent.steps.length };
    },
  },
  {
    name: "get_intent",
    title: "Intent status",
    description: "A stored intent's steps and status (int_ + 32 hex).",
    inputSchema: { type: "object", properties: { id: { type: "string", pattern: "^int_[0-9a-f]{32}$" } }, required: ["id"], additionalProperties: false },
    async run(ctx, args) {
      const { id } = z.object({ id: z.string().regex(/^int_[0-9a-f]{32}$/u) }).parse(args);
      const graph = await getIntent(ctx, id);
      return { id: graph.id, status: graph.status, title: graph.summary.title, steps: graph.steps.map((step) => ({ id: step.id, title: step.title, network: step.network, status: step.status })) };
    },
  },
  {
    name: "shield",
    title: "Token Shield",
    description: "What can be proven about a token on an EVM network (registry, bytecode, privileged functions, simulated buy/sell tax). Never says 'safe'.",
    inputSchema: { type: "object", properties: { network: NETWORK_SCHEMA, token: ADDRESS_SCHEMA }, required: ["network", "token"], additionalProperties: false },
    async run(ctx, args) {
      const input = z.object({ network: networkKey, token: address }).parse(args);
      return shield(ctx, input.network, input.token);
    },
  },
  {
    name: "create_signing_link",
    title: "Signing link",
    description: "Builds an Elyia link where the user reviews and signs an intent with their own wallet. This tool never signs or sends anything.",
    inputSchema: { type: "object", properties: { text: { type: "string", minLength: 3, maxLength: 500 } }, required: ["text"], additionalProperties: false },
    async run(ctx, args) {
      const { text } = z
        .object({ text: z.string().min(3).max(500).refine((value) => ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), "No control characters.") })
        .parse(args);
      return { url: `${webOrigin(ctx)}/app?intent=${encodeURIComponent(text)}`, note: "Open the link to review the plan; your wallet signs every step. Elyia never signs for you." };
    },
  },
];

export interface ToolResult {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent: Record<string, unknown>;
  readonly isError?: boolean;
}

/** Runs a tool; failures become `isError` results with a code and a message (never provider text). */
export async function runTool(ctx: AppContext, tool: ElyiaTool, args: Record<string, unknown>, caller: ToolCaller): Promise<ToolResult> {
  try {
    const data = (await tool.run(ctx, args, caller)) as Record<string, unknown>;
    const text = JSON.stringify(data);
    return { content: [{ type: "text", text: text.length > MAX_TOOL_TEXT ? `${text.slice(0, MAX_TOOL_TEXT)}…` : text }], structuredContent: data };
  } catch (error) {
    const known = isElyiaHttpError(error) && error.status < 500;
    const code = isElyiaHttpError(error) ? error.code : error instanceof z.ZodError ? "INVALID_INPUT" : "TOOL_FAILED";
    const message = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 300) : known ? (error as Error).message.slice(0, 300) : isElyiaHttpError(error) ? error.message.slice(0, 200) : "The tool failed.";
    return { content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }], structuredContent: { error: { code, message } }, isError: true };
  }
}
