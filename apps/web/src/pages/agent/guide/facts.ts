/**
 * What the Guide reads (pure): the followed range turned into GuideFacts,
 * and the morning bulletin (overnight · on the summit · today) built from
 * the same facts and the last 24 h of history.
 */
import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";

import type { RopeView } from "../../../features/trading/useTopoData";
import { fundingPerHour, pct, px, ropesByRisk, usd, type GuideFacts, type GuideRope, type GuideSource } from "./planner";

const DAY = 86_400_000;

export function guideRopes(ropes: readonly RopeView[]): GuideRope[] {
  return ropes.map((rope) => ({
    coin: rope.coin,
    dex: rope.dex,
    side: rope.side,
    size: rope.size,
    entryPx: rope.entryPx,
    markPx: rope.markPx,
    liquidationPx: rope.liquidationPx,
    distance: rope.distance,
    leverage: rope.leverage,
    positionValue: rope.positionValue,
    unrealizedPnl: rope.unrealizedPnl,
    sl: rope.sl ? { px: rope.sl.px } : null,
    tp: rope.tp ? { px: rope.tp.px } : null,
  }));
}

export interface FactsInput {
  readonly source: GuideSource;
  readonly snapshot: PortfolioSnapshot | null;
  readonly history: PortfolioHistory | null;
  readonly ropes: readonly RopeView[];
  readonly funding: Readonly<Record<string, number>>;
  readonly ruleBook: string;
  readonly killSwitch: boolean;
  readonly now: number;
}

export function buildFacts(input: FactsInput): GuideFacts {
  const { snapshot, history, now } = input;
  const since = now - DAY;
  const recent = history?.timeline.filter((event) => event.time >= since) ?? null;
  const fundingOk = history?.sections.funding.status === "ok";
  const fillsOk = history?.sections.fills.status === "ok";
  const funding24h = recent && fundingOk ? recent.reduce((sum, event) => (event.kind === "funding" ? sum + event.usdc : sum), 0) : null;
  const fills = recent && fillsOk ? recent.filter((event) => event.kind === "fill") : null;
  return {
    source: input.source,
    netWorth: snapshot?.totals.netWorthUsd ?? null,
    byLayer: snapshot ? { floor: snapshot.totals.byLayer.hypercore, ridge: snapshot.totals.byLayer.hyperevm, summit: snapshot.totals.byLayer.elysium } : null,
    ropes: guideRopes(input.ropes),
    exposure: (snapshot?.exposure ?? []).map((row) => ({ underlying: row.underlying, netUsd: row.netUsd, perp: row.perp, spot: row.spot, lst: row.lst, isCash: row.isCash })),
    funding: input.funding,
    funding24h,
    realized24h: fills ? fills.reduce((sum, event) => (event.kind === "fill" ? sum + event.closedPnl - event.fee : sum), 0) : null,
    fills24h: fills ? fills.length : null,
    ruleBook: input.ruleBook,
    killSwitch: input.killSwitch,
  };
}

export interface BulletinColumn {
  readonly title: string;
  readonly lines: readonly { readonly text: string; readonly tone?: "up" | "down" | "strong" }[];
  /** Optional one-tap question for the Guide. */
  readonly ask?: { readonly label: string; readonly question: string };
}

/** The morning bulletin: what happened overnight, how the summit looks, what today asks of you. */
export function morningBulletin(facts: GuideFacts, snapshot: PortfolioSnapshot | null): readonly BulletinColumn[] {
  const overnight: BulletinColumn["lines"][number][] = [];
  if (facts.fills24h !== null) overnight.push({ text: `${facts.fills24h} fill${facts.fills24h === 1 ? "" : "s"} · ${usd(facts.realized24h ?? 0, true)} realised after fees`, tone: (facts.realized24h ?? 0) >= 0 ? "up" : "down" });
  if (facts.funding24h !== null) overnight.push({ text: `Funding ${facts.funding24h >= 0 ? "paid you" : "cost you"} ${usd(Math.abs(facts.funding24h))}`, tone: facts.funding24h >= 0 ? "up" : "down" });
  if (overnight.length === 0) overnight.push({ text: facts.source === "sample" ? "Sample range: no real night to report." : "History is not answering; ropes and prices are live." });

  const summit: BulletinColumn["lines"][number][] = [];
  const elysium = snapshot?.layers.find((layer) => layer.layer === "elysium");
  if (elysium) {
    const lines = elysium.lines.filter((line) => (line.usd ?? 0) > 1).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
    summit.push({ text: `${usd(elysium.totalUsd)} on Elysium across ${lines.length} holding${lines.length === 1 ? "" : "s"}`, tone: "strong" });
    const top = lines[0];
    if (top) summit.push({ text: `Biggest: ${top.asset} ${usd(top.usd ?? 0)}${top.note ? ` · ${top.note}` : ""}` });
    const gas = elysium.lines.find((line) => line.asset === "HYPE" && line.account === "wallet");
    if (gas && Number(gas.amount) < 0.05) summit.push({ text: `Gas is low: ${Number(gas.amount).toFixed(3)} HYPE`, tone: "down" });
  } else {
    summit.push({ text: "Nothing on the summit yet." });
  }

  const today: BulletinColumn["lines"][number][] = [];
  const ordered = ropesByRisk(facts.ropes);
  const weak = ordered[0];
  let ask: BulletinColumn["ask"];
  if (weak && weak.distance !== null) {
    today.push({ text: `${weak.coin} ${weak.leverage}× ${weak.side} is ${pct(weak.distance, 1)} from the crevasse (${px(weak.liquidationPx ?? 0)})`, tone: weak.distance < 0.1 ? "down" : "strong" });
    ask = { label: "what would you do?", question: "what's my riskiest rope right now?" };
  }
  const dearest = facts.ropes
    .map((rope) => ({ rope, perHour: fundingPerHour(rope, facts.funding) }))
    .filter((row): row is { rope: GuideRope; perHour: number } => row.perHour !== null && row.perHour < 0)
    .sort((a, b) => a.perHour - b.perHour)[0];
  if (dearest) today.push({ text: `${dearest.rope.coin} funding costs you ${usd(-dearest.perHour)}/h`, tone: "down" });
  if (today.length === 0) today.push({ text: "No ropes out. A quiet day: say where to." });
  return [
    { title: "Overnight", lines: overnight },
    { title: "On the summit", lines: summit },
    { title: "Today", lines: today, ...(ask ? { ask } : {}) },
  ];
}
