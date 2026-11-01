/**
 * What Ely (and MCP clients, and the Telegram bot) can see, as in-process
 * calls to the other modules' services, plus the intent dry run and the
 * route card a proposal shows. Everything here is read-only; `planActions`
 * is a dry run (nothing stored, nothing signed).
 */
import { formatUnitsTrim, getEvmNetwork, NETWORKS, type AccountId, type IntentActionSpec, type NetworkEnvironment, type NetworkKey } from "@elyia/core";
import type { CreateIntentResponse } from "@elyia/core/api/intents";
import type { HyperCoreNetworkKey, MarketRow } from "@elyia/core/api/markets";
import type { PortfolioMode, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import type { RouteCard } from "@elyia/core/api/agent";
import type { AppContext } from "../../context.js";
import { hypercoreNetworkFor, elysiumNetworkFor } from "../../config.js";
import { venueCatalog } from "../../engine/catalog.js";
import { engineFor } from "../../engine/index.js";
import { ledgerServices } from "../markets/services.js";
import { priceSymbol } from "../markets/reference.js";
import { readPortfolio, readPortfolioHistory } from "../portfolio/index.js";
import { liveRegistry, filterRegistry } from "../discovery/registry.js";
import { discoveryFor } from "../discovery/index.js";

export { readPortfolio, readPortfolioHistory };

export function modeOf(ctx: AppContext, mode?: PortfolioMode): PortfolioMode {
  return mode ?? ctx.config.mode;
}

/** The CAIP-10 account the engine plans for (one 0x address re-homed per network). */
export function accountsFor(ctx: AppContext, address: string, environment: NetworkEnvironment = ctx.config.mode): AccountId[] {
  const network = getEvmNetwork(elysiumNetworkFor(environment));
  return [`eip155:${network.chainId}:${address.toLowerCase()}` as AccountId];
}

export async function perpMarkets(ctx: AppContext, network: HyperCoreNetworkKey = hypercoreNetworkFor(ctx.config.mode) as HyperCoreNetworkKey): Promise<MarketRow[]> {
  return ledgerServices(ctx).catalog.perpRows(network, "");
}

export async function marketRow(ctx: AppContext, coin: string, network: HyperCoreNetworkKey = hypercoreNetworkFor(ctx.config.mode) as HyperCoreNetworkKey): Promise<MarketRow> {
  const catalog = ledgerServices(ctx).catalog;
  return (await catalog.row(network, await catalog.resolve(network, coin))).row;
}

/** Mainnet reference prices (USD) of symbols, null when a symbol has none. */
export async function referencePrices(ctx: AppContext, symbols: readonly string[]): Promise<Record<string, number | null>> {
  const table = (await ledgerServices(ctx).reference.table()).value;
  const out: Record<string, number | null> = {};
  for (const symbol of symbols) out[symbol] = priceSymbol(table, symbol)?.usd ?? null;
  return out;
}

export function protocols(ctx: AppContext, filter: { readonly network?: NetworkKey; readonly q?: string; readonly executable?: boolean } = {}) {
  const registry = liveRegistry(ctx);
  return filterRegistry(registry.rows, { ...(filter.network ? { network: filter.network } : {}), ...(filter.q ? { q: filter.q } : {}), ...(filter.executable !== undefined ? { executable: filter.executable } : {}) });
}

export function venues(ctx: AppContext, network?: NetworkKey) {
  const executable = new Set(liveRegistry(ctx).executableIds);
  return venueCatalog(ctx.config.networks, executable).filter((venue) => !network || venue.network === network);
}

export function shield(ctx: AppContext, network: NetworkKey, token: string) {
  return discoveryFor(ctx).shield.inspect(network, token);
}

export async function snapshot(ctx: AppContext, address: string, mode?: PortfolioMode): Promise<PortfolioSnapshot> {
  return readPortfolio(ctx, address, modeOf(ctx, mode));
}

/** Engine dry run of actions for an address. */
export async function planActions(ctx: AppContext, address: string, actions: readonly IntentActionSpec[], options: { readonly dryRun?: boolean; readonly metadata?: Readonly<Record<string, string>>; readonly signer?: "agent" | "keeper" } = {}): Promise<CreateIntentResponse> {
  return engineFor(ctx).service.create({
    actions,
    accounts: accountsFor(ctx, address),
    environment: ctx.config.mode,
    signer: options.signer ?? "agent",
    dryRun: options.dryRun ?? true,
    source: "assistant",
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
}

export async function getIntent(ctx: AppContext, id: string) {
  return engineFor(ctx).service.get(id);
}

/** The card a user sees before signing. */
export function routeCardOf(plan: CreateIntentResponse, integratorFee: RouteCard["integratorFee"] = null): RouteCard {
  const { intent, quotes, policy } = plan;
  const lastSteps = intent.steps.filter((step) => !intent.steps.some((other) => other.dependsOn.includes(step.id)));
  return {
    title: intent.summary.title,
    steps: intent.steps.map((step) => ({ network: step.network, protocol: step.protocol, title: step.title })),
    outputs: lastSteps.flatMap((step) =>
      step.outputs.map((output) => ({
        symbol: output.symbol,
        expected: formatUnitsTrim(output.expected, output.decimals, 6),
        minimum: formatUnitsTrim(output.minimum ?? output.expected, output.decimals, 6),
      })),
    ),
    venues: quotes.map((quote) => ({
      protocol: quote.protocol,
      expected: formatUnitsTrim(quote.expected, quote.decimals, 6),
      winner: quote.winner,
      ...(quote.note || quote.excluded ? { note: quote.note ?? `excluded: ${quote.excluded}` } : {}),
    })),
    feesUsd: intent.summary.totalFeesUsd ?? null,
    notionalUsd: policy.notionalUsd,
    integratorFee,
    policy: { decision: policy.decision, reasons: policy.reasons.map((reason) => reason.message) },
    warnings: [...new Set([...intent.warnings, ...intent.steps.flatMap((step) => step.warnings ?? [])])].slice(0, 12),
    priceSource: "reference:hypercore-mainnet-mids",
    estimatedSeconds: intent.summary.estimatedSeconds ?? null,
  };
}

export function networkName(key: NetworkKey): string {
  return NETWORKS[key].name;
}
