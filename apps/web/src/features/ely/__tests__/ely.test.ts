import assert from "node:assert/strict";
import { test } from "node:test";

import type { Proposal, RouteCard } from "@elyia/core/api/agent";
import type { LanguageQuestion } from "@elyia/core/api/language";

import { cardId, cardView, compactAmount, etaWord, layerOfNetwork, usd } from "../cardModel";
import { allAnswered, answersOf, pickedLabel } from "../clarify";
import { stripCamps, stripProfile, stripZone } from "../draw";
import { parseElyEvent, type ElyEvent } from "../events";
import { readingLabel, phaseLabel } from "../labels";
import { signSourceOf } from "../signSource";
import { createSseParser, type SseMessage } from "../sseParse";
import { groupThreads, parseThreads, serializeThreads, serverThreadOf, titleFor, upsertThread, MAX_THREADS, type ChatThread } from "../threads";
import { DEFAULT_TIMELINE, revealCps, turnPhase, turnTimeline, visibleChars } from "../timeline";
import { applyEvent, endsAsking, interrupted, newElyTurn, planning, primaryCard, type ElyTurn } from "../turn";
import { askOf } from "../signSource";

const CARD: RouteCard = {
  title: "Swap 50 HYPE to USDC on Kalos V3",
  steps: [{ network: "elysium-testnet", protocol: "kalos-v3", title: "Swap 50 HYPE to USDC on Kalos V3" }],
  outputs: [{ symbol: "USDC", expected: "2000", minimum: "1990" }],
  venues: [
    { protocol: "kalos-v3", expected: "2000", winner: true },
    { protocol: "dex-da-costa", expected: "1950", winner: false },
  ],
  feesUsd: "0.01",
  notionalUsd: "1950.5",
  integratorFee: null,
  policy: { decision: "allow", reasons: [] },
  warnings: ["Fake price: Kalos V3's testnet pool pays 7,048% more than the reference price."],
  priceSource: "reference:hypercore-mainnet-mids",
  estimatedSeconds: 2,
};

const PROPOSAL: Proposal = {
  id: "prp_aaaaaaaaaaaaaaaaaaaaaaaa",
  owner: "0x1",
  origin: "chat",
  title: "Swap 50 HYPE",
  explanation: "because",
  actions: [{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "50" }],
  card: CARD,
  planError: null,
  status: "pending",
  createdAt: "2026-11-01T00:00:00Z",
  expiresAt: "2026-11-01T00:15:00Z",
  intentId: null,
  insightId: null,
  automationId: null,
  keeperEligible: false,
};

function ev(name: string, data: unknown): ElyEvent {
  const event = parseElyEvent(name, JSON.stringify(data));
  assert.ok(event, `${name} parses`);
  return event;
}

/* ------------------------------------------------------------ SSE parser */

test("SSE parser: events, multi-line data, comments, CRLF and split chunks", () => {
  const out: SseMessage[] = [];
  const parser = createSseParser((message) => out.push(message));
  parser.push("retry: 3000\r\n\r\n: comment\nevent: tok");
  parser.push('en\ndata: {"text":"a"}\n\nevent: note\ndata: line1\r');
  parser.push("\ndata: line2\n\n");
  parser.push("event: done\ndata: {}");
  parser.end();
  assert.deepEqual(
    out.map((message) => [message.event, message.data]),
    [
      ["token", '{"text":"a"}'],
      ["note", "line1\nline2"],
      ["done", "{}"],
    ],
  );
});

test("SSE parser: a message without data is dropped; default event name is message", () => {
  const out: SseMessage[] = [];
  const parser = createSseParser((message) => out.push(message));
  parser.push("event: thread\n\ndata: x\n\n");
  assert.deepEqual(out, [{ event: "message", data: "x", id: null }]);
});

/* ---------------------------------------------------------------- events */

test("events: malformed or unknown events are dropped, valid ones typed", () => {
  assert.equal(parseElyEvent("token", "{not json"), null);
  assert.equal(parseElyEvent("token", '{"text":5}'), null);
  assert.equal(parseElyEvent("mystery", "{}"), null);
  assert.equal(parseElyEvent("route_card", JSON.stringify({ proposalId: null, card: { title: "x" } })), null);
  assert.deepEqual(parseElyEvent("route_card", JSON.stringify({ proposalId: null, card: CARD }))?.type, "route_card");
  assert.equal(parseElyEvent("proposal", JSON.stringify(PROPOSAL))?.type, "proposal");
  assert.deepEqual(parseElyEvent("error", "{}"), { type: "error", data: { code: "AGENT_FAILED", message: "Ely could not finish this turn." } });
  assert.deepEqual(parseElyEvent("thread", JSON.stringify({ threadId: null, mode: "deterministic", model: null })), { type: "thread", data: { threadId: null as unknown as string, mode: "deterministic", model: null } });
});

/* --------------------------------------------------------------- reducer */

function playedTurn(): ElyTurn {
  let turn = newElyTurn("e1", 1000);
  turn = applyEvent(turn, ev("thread", { threadId: "thr_00000000000000000000", mode: "deterministic", model: null }), 1001);
  turn = applyEvent(turn, ev("tool_call", { id: "c1", name: "get_portfolio", input: {} }), 1002);
  turn = applyEvent(turn, ev("tool_call", { id: "c2", name: "plan_intent", input: { actions: PROPOSAL.actions } }), 1003);
  turn = applyEvent(turn, ev("tool_result", { id: "c1", name: "get_portfolio", ok: true, summary: "ok" }), 1004);
  turn = applyEvent(turn, ev("tool_result", { id: "c2", name: "plan_intent", ok: true, summary: "ok" }), 1005);
  turn = applyEvent(turn, ev("token", { text: "Here is " }), 1006);
  turn = applyEvent(turn, ev("token", { text: "the route." }), 1007);
  turn = applyEvent(turn, ev("route_card", { proposalId: null, card: CARD }), 1008);
  turn = applyEvent(turn, ev("note", { text: "draft:alert", draft: {} }), 1009);
  turn = applyEvent(turn, ev("done", { threadId: "thr_00000000000000000000", text: "Here is the route.", proposals: [], stopReason: "end_turn" }), 1010);
  return turn;
}

test("reducer: folds a turn; events after done are ignored", () => {
  const turn = playedTurn();
  assert.equal(turn.mode, "deterministic");
  assert.equal(turn.text, "Here is the route.");
  assert.equal(turn.textAt, 1006);
  assert.equal(turn.readings.length, 2);
  assert.ok(turn.readings.every((reading) => reading.ok === true && reading.settledAt !== null));
  assert.deepEqual(turn.drafts.map((draft) => draft.kind), ["alert"]);
  assert.equal(turn.serverThreadId, "thr_00000000000000000000");
  assert.equal(planning(turn), true);
  assert.equal(primaryCard(turn)?.card.title, CARD.title);
  const after = applyEvent(turn, ev("token", { text: "more" }), 2000);
  assert.equal(after, turn);
});

test("reducer: done text fills a turn whose tokens were lost; unsettled readings settle as failed", () => {
  let turn = newElyTurn("e", 0);
  turn = applyEvent(turn, ev("tool_call", { id: "x", name: "get_market", input: { coin: "eth" } }), 1);
  turn = applyEvent(turn, ev("done", { threadId: "", text: "Answer", proposals: [], stopReason: "end_turn" }), 5);
  assert.equal(turn.text, "Answer");
  assert.equal(turn.readings[0]!.ok, false);
});

test("reducer: interrupted marks a turn that never finished; endsAsking spots a question", () => {
  const open = applyEvent(newElyTurn("e", 0), ev("token", { text: "Swap on which network?" }), 1);
  const cut = interrupted(open, 9);
  assert.equal(cut.error?.code, "STREAM_CLOSED");
  assert.equal(interrupted(playedTurn(), 9).error, null);
  const asked = applyEvent(open, ev("done", { threadId: "", text: "Swap on which network?", proposals: [], stopReason: "end_turn" }), 2);
  assert.equal(endsAsking(asked), true);
  assert.equal(endsAsking(playedTurn()), false);
});

test("primaryCard prefers the card's proposal", () => {
  let turn = newElyTurn("e", 0);
  turn = applyEvent(turn, ev("proposal", PROPOSAL), 1);
  turn = applyEvent(turn, ev("route_card", { proposalId: PROPOSAL.id, card: CARD }), 2);
  assert.equal(primaryCard(turn)?.proposal?.id, PROPOSAL.id);
});

/* -------------------------------------------------------------- timeline */

test("timeline: chips pace at 0.3 s, settle no sooner than 0.5 s, text waits for them, card after text", () => {
  const turn = playedTurn();
  const tl = turnTimeline(turn);
  assert.equal(tl.readings[0]!.showAt, 1000 + DEFAULT_TIMELINE.firstDelay);
  assert.equal(tl.readings[1]!.showAt, tl.readings[0]!.showAt + DEFAULT_TIMELINE.chipGap);
  assert.equal(tl.readings[1]!.settleAt, tl.readings[1]!.showAt + DEFAULT_TIMELINE.settleMin);
  assert.ok(tl.textStart! >= tl.readings[1]!.settleAt!);
  assert.ok(tl.textEnd! > tl.textStart!);
  assert.ok(tl.cardsAt[0]! >= tl.textEnd!);
  assert.equal(tl.endAt, tl.cardsAt[0]);
  assert.equal(turnPhase(turn, tl, tl.readings[0]!.showAt + 10), "surveying");
  assert.equal(turnPhase(turn, tl, tl.textStart! + 50), "streaming");
  assert.equal(turnPhase(turn, tl, tl.endAt! + 1), "ready");
  assert.equal(turnPhase(turn, tl, Infinity), "ready");
});

test("timeline: reveal is monotone, catches up on long text, and shows everything at Infinity", () => {
  assert.equal(revealCps(10), 55);
  assert.equal(revealCps(1000), 250);
  const turn = playedTurn();
  const tl = turnTimeline(turn);
  let last = -1;
  for (let t = tl.textStart! - 100; t < tl.textEnd! + 100; t += 37) {
    const shown = visibleChars(tl, turn.text.length, t);
    assert.ok(shown >= last);
    last = shown;
  }
  assert.equal(visibleChars(tl, turn.text.length, Infinity), turn.text.length);
  assert.equal(visibleChars(tl, turn.text.length, tl.textStart! - 1), 0);
});

test("timeline: a live turn has no end and reads as surveying before anything arrives", () => {
  const turn = newElyTurn("e", 0);
  const tl = turnTimeline(turn);
  assert.equal(tl.endAt, null);
  assert.equal(turnPhase(turn, tl, 100), "surveying");
});

/* ------------------------------------------------------------ threads */

test("threads: title, grouping by day, upsert cap, and the server thread id", () => {
  assert.equal(titleFor("  Move   1,000 USDC to the Summit: half kHYPE, half Kalos pool please  "), "Move 1,000 USDC to the Summit: half kHYPE…");
  const now = new Date(2026, 10, 1, 12).getTime();
  const mk = (id: string, at: number): ChatThread => ({ id, title: id, createdAt: at, updatedAt: at, address: null, turns: [] });
  const groups = groupThreads([mk("a", now - 1000), mk("b", now - 24 * 3600_000), mk("c", new Date(2026, 9, 29, 9).getTime())], now);
  assert.deepEqual(groups.map((group) => group.label), ["Today", "Yesterday", "Oct 29"]);
  assert.deepEqual(groupThreads([mk("alpha", now)], now, "zzz"), []);
  let list: ChatThread[] = [];
  for (let i = 0; i < MAX_THREADS + 5; i += 1) list = upsertThread(list, mk(`t${i}`, i));
  assert.equal(list.length, MAX_THREADS);
  assert.equal(list[0]!.id, `t${MAX_THREADS + 4}`);
  assert.equal(serverThreadOf({ ...mk("x", 1), turns: [playedTurn()] }), "thr_00000000000000000000");
});

test("threads: round trip through storage; malformed entries dropped; mid-stream turns marked interrupted", () => {
  const live = applyEvent(newElyTurn("e2", 5), ev("token", { text: "hal" }), 6);
  const thread: ChatThread = { id: "t1", title: "x", createdAt: 1, updatedAt: 2, address: "0x" + "a".repeat(40), turns: [{ kind: "user", id: "u", text: "hi", at: 1 }, playedTurn(), live] };
  const back = parseThreads(serializeThreads([thread]));
  assert.equal(back.length, 1);
  assert.equal(back[0]!.turns.length, 3);
  const ely = back[0]!.turns[1] as ElyTurn;
  assert.equal(ely.cards[0]!.card.title, CARD.title);
  assert.equal((back[0]!.turns[2] as ElyTurn).error?.code, "STREAM_CLOSED");
  assert.deepEqual(parseThreads("not json"), []);
  assert.deepEqual(parseThreads(JSON.stringify([{ id: 1 }, null])), []);
});

/* ------------------------------------------------------------ card model */

test("card model: legs, readouts, guards, honest labels", () => {
  const view = cardView(CARD);
  assert.equal(view.legs.length, 1);
  assert.equal(view.legs[0]!.layer, "summit");
  assert.equal(view.legs[0]!.state, "next");
  assert.equal(view.legs[0]!.amount, "2,000 USDC");
  assert.deepEqual(view.readouts.map((readout) => readout.label), ["Value", "You get", "Fees", "Time"]);
  assert.equal(view.readouts[0].value, "$1,950.5");
  assert.equal(view.readouts[3].value, "~2 s");
  assert.ok(view.guards.includes("min-out 0.5%"));
  assert.ok(view.guards.includes("testnet · reference prices"));
  assert.equal(view.fakePrice, true);
  assert.equal(cardId(CARD), cardView(CARD).id);
  assert.match(view.id, /^[0-9A-F]{4}$/u);
  assert.equal(cardView(CARD, { states: ["settled"] }).legs[0]!.state, "settled");
});

test("card model: number words", () => {
  assert.equal(compactAmount("6288.74119"), "6,288.74");
  assert.equal(compactAmount("326327.25"), "326.3K");
  assert.equal(compactAmount(4_050_000), "4.05M");
  assert.equal(compactAmount("0.0042131"), "0.004213");
  assert.equal(usd(null), "—");
  assert.equal(usd("0.01"), "$0.01");
  assert.equal(etaWord(180), "~3 min");
  assert.equal(etaWord(null), null);
  assert.equal(layerOfNetwork("hypercore-testnet"), "floor");
  assert.equal(layerOfNetwork("hyperevm-mainnet"), "ridge");
});

/* --------------------------------------------------------- labels, sign */

test("labels: reading chips and status words", () => {
  assert.equal(readingLabel({ name: "simulate_shock", input: { underlying: "hype", movePct: -20 } }), "What-if HYPE −20%");
  assert.equal(readingLabel({ name: "plan_intent", input: {} }, CARD), "2 venues");
  assert.equal(readingLabel({ name: "get_market", input: { coin: "eth" } }), "ETH market");
  assert.equal(readingLabel({ name: "weird_tool", input: null }), "weird tool");
  assert.equal(phaseLabel("answered", { readings: 2, seconds: 2.34, planning: false, mode: "ai" }), "2 readings · 2.3 s");
  assert.equal(phaseLabel("answered", { readings: 0, seconds: 0, planning: false, mode: null, asking: true }), "one question first");
});

test("sign source: proposal actions, else the dry run's actions, else the sentence", () => {
  const anon = playedTurn();
  assert.deepEqual(signSourceOf(anon, "swap"), { kind: "actions", actions: PROPOSAL.actions, sentence: CARD.title });
  let signed = newElyTurn("e", 0);
  signed = applyEvent(signed, ev("proposal", PROPOSAL), 1);
  signed = applyEvent(signed, ev("route_card", { proposalId: PROPOSAL.id, card: CARD }), 2);
  assert.equal(signSourceOf(signed, "x").kind, "actions");
  assert.deepEqual(signSourceOf(newElyTurn("e", 0), "swap 1 HYPE"), { kind: "text", text: "swap 1 HYPE" });
  const ask = askOf({ kind: "text", text: "swap 1 HYPE to USDC" });
  assert.equal(ask.text, "swap 1 HYPE to USDC");
  assert.equal(askOf({ kind: "actions", actions: PROPOSAL.actions, sentence: "s" }).actions.length, 1);
});

/* --------------------------------------------------------------- clarify */

test("clarify: answers only for open questions; typed answers; all answered", () => {
  const questions = [
    { id: "g0.network", options: [{ id: "elysium", label: "Elysium" }] },
    { id: "g0.amount", options: [{ id: "max", label: "All of it" }] },
  ] as unknown as LanguageQuestion[];
  assert.equal(allAnswered(questions, { "g0.network": "elysium" }), false);
  const picked = { "g0.network": "elysium", "g0.amount": "text:5", stale: "x" };
  assert.equal(allAnswered(questions, picked), true);
  assert.deepEqual(answersOf(questions, picked), [
    { question: "g0.network", option: "elysium" },
    { question: "g0.amount", text: "5" },
  ]);
  assert.equal(pickedLabel(questions[0]!, "elysium"), "Elysium");
  assert.equal(pickedLabel(questions[1]!, "text:5"), "5");
});

/* ----------------------------------------------------------------- strip */

test("route strip: camps span the strip; zones follow each leg's layer; profile climbs", () => {
  const camps = stripCamps(3);
  assert.equal(camps.length, 4);
  assert.ok(camps.every((u, i) => i === 0 || u > camps[i - 1]!));
  const layers = ["floor", "ridge", "summit"] as const;
  assert.equal(stripZone(0.01, layers), "floor");
  assert.equal(stripZone(0.99, layers), "summit");
  assert.ok(stripProfile(0.95, layers) > stripProfile(0.05, layers));
  assert.ok(stripProfile(0.95, ["summit"]) > stripProfile(0.02, ["summit"]));
});
