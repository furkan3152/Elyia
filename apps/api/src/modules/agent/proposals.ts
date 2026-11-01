/**
 * Proposals: every write Ely makes. A proposal is a list of intent actions,
 * planned as a dry run into a route card. Approving it through the wallet
 * stores the intent and hands the client the first step to prepare and sign;
 * approving it through the opt-in keeper runs the keeper guard first.
 * Proposals expire after 15 minutes (prices move).
 *
 * Also the insight service: snapshot + trigger orders + history + mainnet
 * funding -> deterministic insights (insights.ts).
 */
import type { IntentActionSpec, IntentStatus } from "@elyia/core";
import type { IntentStreamEvent } from "@elyia/core/api/intents";
import type { InsightsResponse, Proposal, ProposalDecisionResponse, ProposalOrigin, RouteCard } from "@elyia/core/api/agent";
import type { AppContext } from "../../context.js";
import { hypercoreNetworkFor } from "../../config.js";
import { ElyiaHttpError, isElyiaHttpError } from "../../http/errors.js";
import { randomHex } from "../ops/auth/crypto.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { computeInsights, type FundingCandidate } from "./insights.js";
import { executeWithKeeper, tradeOnlyReducing } from "./keeper.js";
import { addFeed, memoryOf } from "./memory.js";
import { getIntent, perpMarkets, planActions, readPortfolioHistory, routeCardOf, snapshot } from "./perception.js";

export const PROPOSAL_TTL_MS = 15 * 60_000;

function proposals(ctx: AppContext) {
  return docs<Proposal>(ctx, PLATFORM_COLLECTIONS.agentProposals);
}

export async function createProposal(
  ctx: AppContext,
  owner: string,
  input: {
    readonly origin: ProposalOrigin;
    readonly title: string;
    readonly explanation: string;
    readonly actions: readonly IntentActionSpec[];
    readonly insightId?: string;
    readonly automationId?: string;
    readonly integratorFee?: RouteCard["integratorFee"];
  },
): Promise<Proposal> {
  const now = ctx.clock.now();
  let card: RouteCard | null = null;
  let planError: Proposal["planError"] = null;
  if (input.actions.length === 0) {
    planError = { code: "NOTHING_TO_SIGN", message: "This is information only: there is nothing to sign." };
  } else {
    try {
      card = routeCardOf(await planActions(ctx, owner, input.actions), input.integratorFee ?? null);
    } catch (error) {
      planError = isElyiaHttpError(error) && error.status < 500 ? { code: error.code, message: error.message } : { code: "PLAN_FAILED", message: "The engine could not plan this right now." };
    }
  }
  const proposal: Proposal = {
    id: `prp_${randomHex(12)}`,
    owner,
    origin: input.origin,
    title: input.title,
    explanation: input.explanation,
    actions: input.actions,
    card,
    planError,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PROPOSAL_TTL_MS).toISOString(),
    intentId: null,
    insightId: input.insightId ?? null,
    automationId: input.automationId ?? null,
    keeperEligible: card !== null && tradeOnlyReducing({ actions: input.actions }),
  };
  await proposals(ctx).put(`${owner}:${proposal.id}`, proposal, { ttlMs: 7 * 24 * 60 * 60_000 });
  await addFeed(ctx, owner, { kind: "proposal", text: { en: `Proposed: ${proposal.title}`, tr: `Öneri: ${proposal.title}` }, proposalId: proposal.id });
  return proposal;
}

function withExpiry(ctx: AppContext, proposal: Proposal): Proposal {
  return proposal.status === "pending" && Date.parse(proposal.expiresAt) <= ctx.clock.now() ? { ...proposal, status: "expired" } : proposal;
}

export async function proposalOf(ctx: AppContext, owner: string, id: string): Promise<Proposal> {
  const doc = await proposals(ctx).get(`${owner}:${id}`);
  if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such proposal.");
  return withExpiry(ctx, doc.value);
}

export async function listProposals(ctx: AppContext, owner: string, limit = 50): Promise<Proposal[]> {
  const rows = await proposals(ctx).list({ prefix: `${owner}:`, limit: 1_000 });
  return rows
    .map((row) => withExpiry(ctx, row.value))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

async function save(ctx: AppContext, proposal: Proposal): Promise<void> {
  await proposals(ctx).put(`${proposal.owner}:${proposal.id}`, proposal, { ttlMs: 7 * 24 * 60 * 60_000 });
}

/** intentId -> the proposal it came from (written when a proposal is approved). */
interface ProposalLink {
  readonly owner: string;
  readonly proposalId: string;
}

function links(ctx: AppContext) {
  return docs<ProposalLink>(ctx, PLATFORM_COLLECTIONS.agentProposalLinks);
}

async function linkIntent(ctx: AppContext, proposal: Proposal, intentId: string): Promise<void> {
  await links(ctx).put(intentId, { owner: proposal.owner, proposalId: proposal.id }, { ttlMs: 7 * 24 * 60 * 60_000 });
}

/** The step the wallet signs first, for a stored intent. */
async function nextOf(ctx: AppContext, intentId: string): Promise<ProposalDecisionResponse["next"]> {
  const graph = await getIntent(ctx, intentId);
  const first = graph.steps.find((step) => step.status === "ready") ?? graph.steps.find((step) => step.status !== "settled" && step.status !== "skipped") ?? null;
  return { intentId, firstStepId: first?.id ?? null, preparePath: first ? `/v1/intents/${intentId}/steps/${first.id}/prepare` : null };
}

/**
 * Approve (wallet or keeper) or reject a proposal. Approving through the
 * wallet stores ONE intent for the proposal's actions and links it back
 * (`intentId`); approving again returns that same intent instead of storing
 * a second one, so a route card signed from a proposal never duplicates.
 * Nothing is signed here: the wallet signs each step it prepares.
 */
export async function decide(ctx: AppContext, owner: string, id: string, decision: "approve" | "reject", via: "wallet" | "keeper" = "wallet"): Promise<ProposalDecisionResponse> {
  const proposal = await proposalOf(ctx, owner, id);
  if (decision === "approve" && via === "wallet" && proposal.status === "approved" && proposal.intentId) {
    return { proposal, next: await nextOf(ctx, proposal.intentId), keeper: null };
  }
  if (proposal.status !== "pending") throw new ElyiaHttpError("PROPOSAL_CLOSED", 409, `This proposal is ${proposal.status}.`);
  if (decision === "reject") {
    const rejected: Proposal = { ...proposal, status: "rejected" };
    await save(ctx, rejected);
    return { proposal: rejected, next: null, keeper: null };
  }
  if (!proposal.card) throw new ElyiaHttpError("PROPOSAL_NOT_PLANNABLE", 409, proposal.planError?.message ?? "This proposal has no plan to sign.");
  if (via === "keeper") {
    const result = await executeWithKeeper(ctx, owner, proposal);
    const next: Proposal = { ...proposal, status: result.executed ? "executed" : proposal.status, intentId: result.intentId };
    await save(ctx, next);
    if (result.intentId) await linkIntent(ctx, next, result.intentId);
    return { proposal: next, next: null, keeper: { executed: result.executed, detail: result.detail } };
  }
  const plan = await planActions(ctx, owner, proposal.actions, { dryRun: false, metadata: { proposalId: proposal.id, surface: "ely-proposal" } });
  const approved: Proposal = { ...proposal, status: "approved", intentId: plan.intent.id };
  await save(ctx, approved);
  await linkIntent(ctx, approved, plan.intent.id);
  await addFeed(ctx, owner, { kind: "proposal", text: { en: `Approved: ${proposal.title}`, tr: `Onaylandı: ${proposal.title}` }, proposalId: proposal.id });
  const first = plan.intent.steps.find((step) => step.status === "ready") ?? plan.intent.steps[0] ?? null;
  return {
    proposal: approved,
    next: { intentId: plan.intent.id, firstStepId: first?.id ?? null, preparePath: first ? `/v1/intents/${plan.intent.id}/steps/${first.id}/prepare` : null },
    keeper: null,
  };
}

/** What a linked intent's final status means for its proposal (null: not final yet). */
export function proposalOutcome(status: IntentStatus | string): "executed" | "failed" | null {
  if (status === "completed") return "executed";
  if (status === "failed" || status === "expired" || status === "stopped" || status === "cancelled") return "failed";
  return null;
}

/** Marks a linked proposal executed or failed once its intent settles (idempotent). */
export async function settleProposalOf(ctx: AppContext, intentId: string, status: IntentStatus | string): Promise<Proposal | null> {
  const outcome = proposalOutcome(status);
  if (!outcome) return null;
  const link = await links(ctx).get(intentId);
  if (!link) return null;
  const doc = await proposals(ctx).get(`${link.value.owner}:${link.value.proposalId}`);
  if (!doc || doc.value.intentId !== intentId || doc.value.status === outcome) return doc?.value ?? null;
  if (doc.value.status !== "approved" && doc.value.status !== "pending") return doc.value;
  const next: Proposal = { ...doc.value, status: outcome };
  await save(ctx, next);
  await addFeed(ctx, next.owner, { kind: "proposal", text: outcome === "executed" ? { en: `Done: ${next.title}`, tr: `Tamamlandı: ${next.title}` } : { en: `Stopped: ${next.title}`, tr: `Durdu: ${next.title}` }, proposalId: next.id });
  return next;
}

/** Bus -> proposals: a linked intent's final status closes its proposal. */
export function wireProposalOutcomes(ctx: AppContext): () => void {
  return ctx.bus.on("intents.event", ({ intentId, event }: { readonly intentId: string; readonly event: IntentStreamEvent }) => {
    if (event.type !== "intent.status_changed") return;
    const status = String((event.data as { status?: unknown }).status ?? "");
    if (!proposalOutcome(status)) return;
    void settleProposalOf(ctx, intentId, status).catch((error: unknown) => ctx.log.warn("proposal outcome failed", { error: error instanceof Error ? error.message : String(error) }));
  });
}

/* ------------------------------------------------------------- insights */

export async function triggersOf(ctx: AppContext, address: string): Promise<Map<string, { sl: boolean; tp: boolean }>> {
  const out = new Map<string, { sl: boolean; tp: boolean }>();
  const orders = await ctx.hyperliquid.info(hypercoreNetworkFor(ctx.config.mode)).frontendOpenOrders(address).catch(() => []);
  for (const order of orders) {
    if (!order.isTrigger && !order.isPositionTpsl) continue;
    const entry = out.get(order.coin) ?? { sl: false, tp: false };
    if (/stop/iu.test(order.orderType)) entry.sl = true;
    if (/take profit/iu.test(order.orderType)) entry.tp = true;
    out.set(order.coin, entry);
  }
  return out;
}

export async function mainnetFunding(ctx: AppContext): Promise<FundingCandidate[] | null> {
  try {
    const rows = await perpMarkets(ctx, "hypercore-mainnet");
    return rows.filter((row) => row.fundingAprPct !== null && !row.isDelisted).map((row) => ({ coin: row.coin, aprPct: row.fundingAprPct as number, openInterestUsd: row.openInterestUsd, markPx: row.markPx === null ? null : Number(row.markPx) }));
  } catch {
    return null;
  }
}

export async function insightsFor(ctx: AppContext, address: string, options: { readonly history?: boolean } = {}): Promise<InsightsResponse> {
  const owner = address.toLowerCase();
  const [snap, memory, triggers, funding, history] = await Promise.all([
    snapshot(ctx, owner),
    memoryOf(ctx, owner),
    triggersOf(ctx, owner),
    mainnetFunding(ctx),
    options.history === false ? Promise.resolve(null) : readPortfolioHistory(ctx, owner, ctx.config.mode, 30).catch(() => null),
  ]);
  const { insights, shocks } = computeInsights({ snapshot: snap, memory, triggers, history, funding, environment: ctx.config.mode });
  return {
    address: owner,
    mode: ctx.config.mode,
    generatedAt: new Date(ctx.clock.now()).toISOString(),
    netWorthUsd: snap.totals.netWorthUsd,
    insights,
    shocks,
    priceLabel: snap.pricing.label,
    notes: [...snap.notes, ...(funding === null ? ["Mainnet funding could not be read: no funding insight."] : []), ...(ctx.config.mode === "testnet" ? ["Testnet: USD values are HyperCore mainnet reference prices; the funding harvester is paper only."] : [])],
  };
}
