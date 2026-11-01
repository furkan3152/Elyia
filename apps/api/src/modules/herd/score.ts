/**
 * The usage score: how much a wallet really uses Elyia, transparent and
 * capped so whales don't dominate. Shown to the applicant component by
 * component, with how to raise each one (by using Elyia, never by paying).
 *
 *   settled routes         2.5 each            max 20
 *   active days (60 d)     1 per distinct day  max 15
 *   layers used            5 per layer         max 15   (Floor, Ridge, Summit)
 *   venues used            2 per venue         max 10
 *   cross-layer journeys   2.5 each            max 5
 *   automations on         2.5 each            max 5
 *   volume tier            log-scaled          max 10   ($10 → 2 … $100k+ → 10)
 *   developer key in use   5 (any) / 10 (≥ 50 requests in 30 d)
 *   WL tasks done          the tasks' points, normalised to 10
 *                                              ─────
 *                                              100
 * Raffle weight = 1 + score / 25 (1× … 5×); 0 while a high sybil flag is not cleared.
 */
import type { HerdScoreComponent, HerdSybilFlag, HerdUsageScore } from "@elyia/core/api/herd";
import { herdWeight } from "@elyia/core/api/herd";
import type { IntentGraph } from "@elyia/core";
import type { AppContext } from "../../context.js";
import { utcDay, usageOf } from "../developers/gate.js";
import { developerByAddress, listKeys } from "../developers/keys.js";
import { docs, PLATFORM_COLLECTIONS } from "../ops/docs.js";

export const SCORE_FORMULA = "routes 2.5 each (20) + active days 1 each in 60 d (15) + layers 5 each (15) + venues 2 each (10) + cross-layer 2.5 each (5) + automations 2.5 each (5) + volume tier (10) + developer key in use (10) + WL tasks (10) = 100; weight = 1 + score/25, max 5×";

export interface UsageFacts {
  readonly settled: number;
  readonly activeDays30: number;
  readonly activeDays60: number;
  readonly layers: readonly string[];
  readonly venues: readonly string[];
  readonly crossLayer: number;
  readonly automationsOn: number;
  /** Conservative USD of settled inputs (reference prices). */
  readonly volumeUsd: number;
  readonly developerRequests30: number;
  readonly developerKeys: number;
  readonly taskPoints: number;
  readonly taskPointsMax: number;
}

export const EMPTY_FACTS: UsageFacts = { settled: 0, activeDays30: 0, activeDays60: 0, layers: [], venues: [], crossLayer: 0, automationsOn: 0, volumeUsd: 0, developerRequests30: 0, developerKeys: 0, taskPoints: 0, taskPointsMax: 0 };

const LAYER_NAMES: Readonly<Record<string, string>> = { floor: "Floor", ridge: "Ridge", summit: "Summit" };

function capped(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value * 10) / 10));
}

/** $0-10 → 0, $10 → 2, $100 → 4, $1k → 6, $10k → 8, $100k+ → 10 (log10, capped). */
export function volumePoints(usd: number): number {
  if (!Number.isFinite(usd) || usd < 10) return 0;
  return capped(2 * Math.floor(Math.log10(usd)), 10);
}

export function scoreFromFacts(facts: UsageFacts, now: number, flags: readonly HerdSybilFlag[] = [], flagsCleared = false): HerdUsageScore {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const taskShare = facts.taskPointsMax > 0 ? (facts.taskPoints / facts.taskPointsMax) * 10 : 0;
  const components: HerdScoreComponent[] = [
    { key: "routes", label: "Settled routes", measure: plural(facts.settled, "settled route"), points: capped(facts.settled * 2.5, 20), max: 20, tip: facts.settled >= 8 ? null : "Ask Ely for a swap, a bridge or a trade and sign it through." },
    { key: "days", label: "Active days", measure: `${facts.activeDays60} of the last 60 days (${facts.activeDays30} in 30)`, points: capped(facts.activeDays60, 15), max: 15, tip: facts.activeDays60 >= 15 ? null : "Come back on different days: one real route a day counts." },
    { key: "layers", label: "Layers used", measure: facts.layers.length === 0 ? "none yet" : facts.layers.map((layer) => LAYER_NAMES[layer] ?? layer).join(", "), points: capped(facts.layers.length * 5, 15), max: 15, tip: facts.layers.length >= 3 ? null : "Use all three layers: Floor (HyperCore), Ridge (HyperEVM) and Summit (Elysium)." },
    { key: "venues", label: "Venues used", measure: plural(facts.venues.length, "venue"), points: capped(facts.venues.length * 2, 10), max: 10, tip: facts.venues.length >= 5 ? null : "Route through different venues: swaps, lending, vaults, perps." },
    { key: "journeys", label: "Cross-layer journeys", measure: plural(facts.crossLayer, "journey"), points: capped(facts.crossLayer * 2.5, 5), max: 5, tip: facts.crossLayer >= 2 ? null : "Move value between layers in one route (bridge up or down)." },
    { key: "automations", label: "Automations on", measure: plural(facts.automationsOn, "automation"), points: capped(facts.automationsOn * 2.5, 5), max: 5, tip: facts.automationsOn >= 2 ? null : "Turn on an automation in Portfolio (auto-protect, DCA, idle sweeper)." },
    { key: "volume", label: "Volume tier", measure: facts.volumeUsd < 10 ? "under $10" : `about $${Math.round(facts.volumeUsd).toLocaleString("en-US")} (log-scaled, capped)`, points: volumePoints(facts.volumeUsd), max: 10, tip: facts.volumeUsd >= 100_000 ? null : "Volume counts on a log scale and is capped: steady use beats size." },
    { key: "developer", label: "Developer key in use", measure: facts.developerKeys === 0 ? "no key" : `${plural(facts.developerKeys, "key")}, ${facts.developerRequests30.toLocaleString("en-US")} requests in 30 d`, points: facts.developerRequests30 >= 50 ? 10 : facts.developerRequests30 > 0 ? 5 : 0, max: 10, tip: facts.developerRequests30 >= 50 ? null : "Build on Elyia: create a key in Developers and make real calls." },
    { key: "tasks", label: "WL tasks done", measure: `${facts.taskPoints} of ${facts.taskPointsMax} task points`, points: capped(taskShare, 10), max: 10, tip: facts.taskPoints >= facts.taskPointsMax ? null : "Finish every WL task." },
  ];
  const score = Math.min(100, Math.round(components.reduce((sum, component) => sum + component.points, 0)));
  const blocked = !flagsCleared && flags.some((flag) => flag.severity === "high");
  return { score, weight: blocked ? 0 : herdWeight(score), components, computedAt: new Date(now).toISOString(), formula: SCORE_FORMULA };
}

/* ----------------------------------------------------- facts from store */

interface IntentFacts {
  readonly settled: number;
  readonly days: readonly number[];
  readonly layers: Set<string>;
  readonly venues: Set<string>;
  readonly crossLayer: number;
  readonly volumeUsd: number;
}

const SETTLED = new Set(["completed", "partially-completed"]);
const INDEX_TTL_MS = 120_000;
const MAX_SCAN = 100_000;
const indexes = new WeakMap<AppContext, { at: number; byAccount: Map<string, IntentFacts> }>();

export function layerOfNetwork(network: string): string | null {
  if (network.startsWith("hypercore")) return "floor";
  if (network.startsWith("hyperevm")) return "ridge";
  if (network.startsWith("elysium")) return "summit";
  return null;
}

/** Folds one intent into the facts of its accounts (pure; exported for tests). */
export function foldIntent(into: Map<string, IntentFacts>, graph: IntentGraph): void {
  const owners = new Set(graph.accounts.map((account) => account.split(":").pop()?.toLowerCase() ?? "").filter((value) => /^0x[0-9a-f]{40}$/u.test(value)));
  const settled = SETTLED.has(graph.status);
  const day = Math.floor(Date.parse(graph.createdAt) / 86_400_000);
  const layers = new Set<string>();
  const venues = new Set<string>();
  let usd = 0;
  for (const step of graph.steps) {
    if (step.status !== "settled") continue;
    const layer = layerOfNetwork(step.network);
    if (layer) layers.add(layer);
    if (step.protocol) venues.add(step.protocol);
  }
  if (settled) for (const input of graph.summary.inputs) usd += Number(input.usd ?? 0) || 0;
  for (const owner of owners) {
    const current = into.get(owner) ?? { settled: 0, days: [], layers: new Set<string>(), venues: new Set<string>(), crossLayer: 0, volumeUsd: 0 };
    into.set(owner, {
      settled: current.settled + (settled ? 1 : 0),
      days: settled && Number.isFinite(day) ? [...current.days, day] : current.days,
      layers: settled ? new Set([...current.layers, ...layers]) : current.layers,
      venues: settled ? new Set([...current.venues, ...venues]) : current.venues,
      crossLayer: current.crossLayer + (settled && layers.size > 1 ? 1 : 0),
      volumeUsd: current.volumeUsd + usd,
    });
  }
}

async function intentIndex(ctx: AppContext): Promise<Map<string, IntentFacts>> {
  const hit = indexes.get(ctx);
  if (hit && ctx.clock.now() - hit.at < INDEX_TTL_MS) return hit.byAccount;
  const byAccount = new Map<string, IntentFacts>();
  const collection = ctx.store.collection("intents");
  let after: string | undefined;
  let scanned = 0;
  while (scanned < MAX_SCAN) {
    const page = await collection.list({ limit: 1_000, ...(after ? { after } : {}) });
    for (const row of page) {
      const graph = row.value as unknown as IntentGraph;
      if (graph && Array.isArray(graph.accounts) && Array.isArray(graph.steps)) foldIntent(byAccount, graph);
    }
    scanned += page.length;
    if (page.length < 1_000) break;
    after = page[page.length - 1]!.id;
  }
  indexes.set(ctx, { at: ctx.clock.now(), byAccount });
  return byAccount;
}

export function forgetScoreIndex(ctx: AppContext): void {
  indexes.delete(ctx);
}

export async function usageFacts(ctx: AppContext, wallet: string, tasks: { readonly points: number; readonly max: number }): Promise<UsageFacts> {
  const owner = wallet.toLowerCase();
  const now = ctx.clock.now();
  const today = Math.floor(now / 86_400_000);
  const intents = (await intentIndex(ctx)).get(owner);
  const days = new Set(intents?.days ?? []);
  const automations = (await docs<{ enabled?: boolean }>(ctx, PLATFORM_COLLECTIONS.agentAutomations).list({ prefix: `${owner}:`, limit: 100 })).filter((row) => row.value.enabled === true).length;
  let developerRequests30 = 0;
  let developerKeys = 0;
  const developer = await developerByAddress(ctx, owner).catch(() => null);
  if (developer) {
    const keys = await listKeys(ctx, developer.id);
    developerKeys = keys.filter((key) => key.revokedAt === null).length;
    for (const key of keys) {
      for (let back = 0; back < 30; back += 1) developerRequests30 += (await usageOf(ctx, key.id, utcDay(now - back * 86_400_000))).requests;
    }
  }
  return {
    settled: intents?.settled ?? 0,
    activeDays30: [...days].filter((day) => today - day < 30).length,
    activeDays60: [...days].filter((day) => today - day < 60).length,
    layers: [...(intents?.layers ?? [])].sort(),
    venues: [...(intents?.venues ?? [])].sort(),
    crossLayer: intents?.crossLayer ?? 0,
    automationsOn: automations,
    volumeUsd: intents?.volumeUsd ?? 0,
    developerRequests30,
    developerKeys,
    taskPoints: tasks.points,
    taskPointsMax: tasks.max,
  };
}

/* --------------------------------------------------------- sybil flags */

export interface SybilSignals {
  /** Outgoing transaction count on the herd network (null: unreadable). */
  readonly nonce: number | null;
  /** Other applications from the same coarse IP hash. */
  readonly sharedIp: number;
  readonly sharedDevice: number;
  /** The X handle was used by another wallet before. */
  readonly handleReused: boolean;
  readonly usage: UsageFacts;
  readonly movedFrom: string | null;
}

export function sybilFlags(signals: SybilSignals): HerdSybilFlag[] {
  const flags: HerdSybilFlag[] = [];
  if (signals.nonce === 0) flags.push({ code: "fresh-wallet", severity: "warn", detail: "No outgoing transaction on Elysium yet (a brand-new wallet)." });
  if (signals.sharedIp >= 6) flags.push({ code: "shared-ip", severity: "high", detail: `${signals.sharedIp} other applications share this coarse network hash.` });
  else if (signals.sharedIp >= 2) flags.push({ code: "shared-ip", severity: "warn", detail: `${signals.sharedIp} other applications share this coarse network hash.` });
  if (signals.sharedDevice >= 3) flags.push({ code: "shared-device", severity: "high", detail: `${signals.sharedDevice} other applications share this device hash.` });
  else if (signals.sharedDevice >= 1) flags.push({ code: "shared-device", severity: "warn", detail: `${signals.sharedDevice} other application shares this device hash.` });
  if (signals.handleReused) flags.push({ code: "handle-reused", severity: "warn", detail: "This X handle was used by another wallet before." });
  const usage = signals.usage;
  if (usage.settled === 0 && usage.automationsOn === 0 && usage.developerKeys === 0) flags.push({ code: "no-usage", severity: "info", detail: "No Elyia usage yet." });
  if (signals.movedFrom) flags.push({ code: "wallet-moved", severity: "info", detail: `Moved from ${signals.movedFrom}.` });
  return flags;
}
