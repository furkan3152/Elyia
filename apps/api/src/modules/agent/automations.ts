/**
 * Automations: an owner turns on a skill; the scheduler runs it on the
 * owner's insights and turns each new finding into a proposal (feed entry).
 * With `keeper: true` and an active keeper, proposals that are reduce-only
 * HyperCore protection go through the keeper guard and execute; everything
 * else waits for the wallet. The kill switch pauses all of it.
 *
 * Dedupe: one proposal per insight id per cooldown (default 60 min).
 * Budget: at most MAX_PER_TICK automations per pass (insights read the
 * portfolio, which spends HyperCore weight).
 */
import { AUTOMATION_KINDS, type Automation, type AutomationInput, type AutomationKind, type AutomationListResponse, type InsightKind } from "@elyia/core/api/agent";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { perksFor } from "../herd/perks.js";
import { randomHex } from "../ops/auth/crypto.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";
import { registerStats } from "../admin/stats.js";
import { executeWithKeeper, isKilled } from "./keeper.js";
import { addFeed } from "./memory.js";
import { createProposal, insightsFor } from "./proposals.js";

export const SCHEDULER_INTERVAL_MS = 60_000;
export const MAX_PER_TICK = 20;
export const MAX_AUTOMATIONS_PER_OWNER = 12;

export const AUTOMATION_INSIGHT: Readonly<Record<AutomationKind, InsightKind>> = Object.freeze({
  "auto-protect": "auto-protect",
  "liquidation-guard": "liquidation-guard",
  "idle-sweep": "idle-cash",
  "gas-top-up": "gas-top-up",
  "dust-sweep": "dust-sweep",
  rebalance: "rebalance",
  "funding-harvest-paper": "funding-harvest",
});

export const AUTOMATION_CATALOG: AutomationListResponse["catalog"] = AUTOMATION_KINDS.map((kind) => ({
  kind,
  title: {
    "auto-protect": { en: "Auto-protect every position", tr: "Her pozisyonu otomatik koru" },
    "liquidation-guard": { en: "Liquidation guard", tr: "Tasfiye koruması" },
    "idle-sweep": { en: "Idle-cash sweeper", tr: "Boştaki nakit süpürücü" },
    "gas-top-up": { en: "Gas at every camp", tr: "Her kampta gaz" },
    "dust-sweep": { en: "Dust sweep", tr: "Kırıntı süpürme" },
    rebalance: { en: "Rebalance to target mix", tr: "Hedef karışıma dengele" },
    "funding-harvest-paper": { en: "Funding harvester (paper)", tr: "Fonlama hasadı (kağıt üzerinde)" },
  }[kind],
  params: { cooldownMinutes: { type: "integer", default: 60, description: "Minutes before the same finding is proposed again." } },
}));

interface AutomationDoc {
  readonly id: string;
  readonly owner: string;
  readonly kind: AutomationKind;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly enabled: boolean;
  readonly keeper: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastRunAt: number | null;
  readonly lastResult: string | null;
  readonly runs: number;
  /** insight id -> last proposal time (dedupe). */
  readonly proposed: Readonly<Record<string, number>>;
}

function collection(ctx: AppContext) {
  return docs<AutomationDoc>(ctx, PLATFORM_COLLECTIONS.agentAutomations);
}

function view(doc: AutomationDoc): Automation {
  return {
    id: doc.id,
    owner: doc.owner,
    kind: doc.kind,
    params: doc.params,
    enabled: doc.enabled,
    keeper: doc.keeper,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    lastRunAt: iso(doc.lastRunAt),
    lastResult: doc.lastResult,
    runs: doc.runs,
  };
}

export async function listAutomations(ctx: AppContext, owner: string): Promise<Automation[]> {
  return (await collection(ctx).list({ prefix: `${owner}:`, limit: 100 })).map((doc) => view(doc.value));
}

export async function createAutomation(ctx: AppContext, owner: string, input: AutomationInput): Promise<Automation> {
  const max = Math.max(MAX_AUTOMATIONS_PER_OWNER, (await perksFor(ctx, owner)).automations);
  if ((await listAutomations(ctx, owner)).length >= max) throw new ElyiaHttpError("AUTOMATION_LIMIT", 409, `At most ${max} automations${max > MAX_AUTOMATIONS_PER_OWNER ? " (Herd holder)" : ""}.`);
  const now = ctx.clock.now();
  const doc: AutomationDoc = { id: `aut_${randomHex(10)}`, owner, kind: input.kind, params: input.params ?? {}, enabled: input.enabled ?? true, keeper: input.keeper ?? false, createdAt: now, updatedAt: now, lastRunAt: null, lastResult: null, runs: 0, proposed: {} };
  await collection(ctx).put(`${owner}:${doc.id}`, doc);
  await addFeed(ctx, owner, { kind: "automation", text: { en: `Automation on: ${input.kind}${doc.keeper ? " (keeper may execute protection)" : ""}`, tr: `Otomasyon açık: ${input.kind}${doc.keeper ? " (koruyucu emirleri keeper uygulayabilir)" : ""}` }, proposalId: null });
  return view(doc);
}

export async function updateAutomation(ctx: AppContext, owner: string, id: string, patch: Partial<Pick<AutomationInput, "params" | "enabled" | "keeper">>): Promise<Automation> {
  const current = (await collection(ctx).get(`${owner}:${id}`))?.value;
  if (!current) throw new ElyiaHttpError("NOT_FOUND", 404, "No such automation.");
  const next: AutomationDoc = { ...current, ...(patch.params ? { params: patch.params } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.keeper !== undefined ? { keeper: patch.keeper } : {}), updatedAt: ctx.clock.now() };
  await collection(ctx).put(`${owner}:${id}`, next);
  return view(next);
}

export async function deleteAutomation(ctx: AppContext, owner: string, id: string): Promise<boolean> {
  return collection(ctx).delete(`${owner}:${id}`);
}

/** One automation run: insights -> new proposals (deduped) -> keeper when allowed. */
export async function runAutomation(ctx: AppContext, doc: AutomationDoc): Promise<string> {
  const now = ctx.clock.now();
  if (await isKilled(ctx, doc.owner)) return "paused: kill switch on";
  const cooldownMs = Math.max(5, Number(doc.params.cooldownMinutes ?? 60)) * 60_000;
  const kind = AUTOMATION_INSIGHT[doc.kind];
  const insights = (await insightsFor(ctx, doc.owner, { history: kind === "explain-pnl" })).insights.filter((insight) => insight.kind === kind);
  const proposed: Record<string, number> = Object.fromEntries(Object.entries(doc.proposed).filter(([, at]) => now - at < cooldownMs));
  let made = 0;
  let executed = 0;
  for (const insight of insights) {
    if (proposed[insight.id] !== undefined) continue;
    proposed[insight.id] = now;
    if (insight.paper || insight.actions.length === 0) {
      await addFeed(ctx, doc.owner, { kind: "insight", text: { en: `${insight.title.en}: ${insight.explanation.en}`, tr: `${insight.title.tr}: ${insight.explanation.tr}` }, proposalId: null });
      continue;
    }
    const proposal = await createProposal(ctx, doc.owner, { origin: "automation", title: insight.title.en, explanation: insight.explanation.en, actions: insight.actions, insightId: insight.id, automationId: doc.id });
    made += 1;
    if (doc.keeper && proposal.keeperEligible) {
      const result = await executeWithKeeper(ctx, doc.owner, proposal);
      if (result.executed) executed += 1;
    }
  }
  const summary = `${insights.length} findings, ${made} proposals${executed ? `, ${executed} executed by the keeper` : ""}`;
  await collection(ctx).put(`${doc.owner}:${doc.id}`, { ...doc, proposed, lastRunAt: now, lastResult: summary, runs: doc.runs + 1 });
  return summary;
}

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  cursor: string | undefined;
}

const schedulers = new WeakMap<AppContext, SchedulerState>();

export async function schedulerPass(ctx: AppContext, state: SchedulerState): Promise<number> {
  const rows = await collection(ctx).list({ ...(state.cursor ? { after: state.cursor } : {}), limit: MAX_PER_TICK });
  state.cursor = rows.length < MAX_PER_TICK ? undefined : rows.at(-1)?.id;
  let ran = 0;
  // Herd holders' automations run first in every pass (priority keeper scheduling; perks are cached on-chain reads).
  const enabled = rows.filter((row) => row.value.enabled);
  const priority = new Map<string, boolean>();
  for (const row of enabled) if (!priority.has(row.value.owner)) priority.set(row.value.owner, (await perksFor(ctx, row.value.owner)).priorityKeeper);
  enabled.sort((a, b) => Number(priority.get(b.value.owner) ?? false) - Number(priority.get(a.value.owner) ?? false));
  for (const row of enabled) {
    try {
      await runAutomation(ctx, row.value);
      ran += 1;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message.slice(0, 160) : "automation failed";
    }
  }
  state.lastRunAt = ctx.clock.now();
  return ran;
}

export function startScheduler(ctx: AppContext, intervalMs = SCHEDULER_INTERVAL_MS): void {
  if (schedulers.has(ctx)) return;
  const state: SchedulerState = { timer: null, running: false, lastRunAt: null, lastError: null, cursor: undefined };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    void schedulerPass(ctx, state)
      .catch((error: unknown) => {
        state.lastError = error instanceof Error ? error.message.slice(0, 160) : "pass failed";
      })
      .finally(() => {
        state.running = false;
      });
  }, intervalMs);
  state.timer.unref();
  schedulers.set(ctx, state);
  registerStats(ctx, "automations", async () => ({ running: state.timer !== null, lastRunAt: state.lastRunAt, lastError: state.lastError, pending: (await collection(ctx).list({ limit: 1_000 })).filter((row) => row.value.enabled).length }));
}

export function stopScheduler(ctx: AppContext): void {
  const state = schedulers.get(ctx);
  if (state?.timer) clearInterval(state.timer);
  schedulers.delete(ctx);
}
