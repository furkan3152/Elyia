import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleHistory, sampleRopes, sampleSnapshot } from "../../portfolio/range/sample";
import { buildFacts, morningBulletin } from "../guide/facts";
import { anchorProposal, anchoredSafely, answer, fundingPerHour, proposedAnchor, roundPrice, topicOf, type GuideFacts, type GuideRope } from "../guide/planner";

const NOW = 1_800_000_000_000;

function facts(overrides: Partial<GuideFacts> = {}): GuideFacts {
  const base = buildFacts({ source: "sample", snapshot: sampleSnapshot(NOW), history: sampleHistory(NOW), ropes: sampleRopes(), funding: { FARTCOIN: 0.0002, ETH: 0.0000125, HYPE: -0.00001 }, ruleBook: "max 20× · every market", killSwitch: false, now: NOW });
  return { ...base, ...overrides };
}

const text = (reply: ReturnType<typeof answer>) => reply.segments.map((segment) => segment.text).join("");

test("topics are read from the question", () => {
  assert.equal(topicOf("what's my riskiest rope right now?"), "riskiest");
  assert.equal(topicOf("how exposed am I?"), "exposure");
  assert.equal(topicOf("what does funding cost me?"), "funding");
  assert.equal(topicOf("alert me if ETH funding goes above 0.01%"), "rule");
  assert.equal(topicOf("when any rope is under 10%, close half"), "rule");
  assert.equal(topicOf("bridge 20 HYPE to Elysium"), "route");
  assert.equal(topicOf("long ETH 5x with 200 USDC, stop at -3%"), "route");
  assert.equal(topicOf("hit the kill switch"), "killswitch");
  assert.equal(topicOf("how am I doing?"), "summary");
  assert.equal(topicOf("hello"), "help");
});

test("the riskiest rope is the one nearest its crevasse, with an anchor and a halve", () => {
  const reply = answer("what's my riskiest rope?", facts());
  assert.equal(reply.topic, "riskiest");
  assert.match(text(reply), /FARTCOIN 3× short/u);
  assert.match(text(reply), /6\.0% to the crevasse/u);
  const anchor = reply.proposals.find((proposal) => proposal.kind === "anchor");
  assert.ok(anchor && anchor.kind === "anchor");
  // Halfway from the mark (1.06) to the liquidation (1.124), above the mark for a short.
  assert.equal(anchor.stop, 1.092);
  assert.ok(anchor.stop > anchor.mark && anchor.stop < (anchor.liquidation ?? 0));
  assert.ok(Math.abs(anchor.maxLoss - 0.032 * 1840) < 1e-6);
  assert.ok(reply.proposals.some((proposal) => proposal.kind === "halve"));
  assert.ok(reply.readings.some((reading) => reading.label === "read ropes" && reading.detail === "3"));
  assert.match(text(reply), /sample range/u);
});

test("no ropes, no proposal", () => {
  const reply = answer("riskiest rope?", facts({ ropes: [] }));
  assert.equal(reply.proposals.length, 0);
  assert.match(text(reply), /No ropes out/u);
});

test("a stop already between the mark and the crevasse is respected", () => {
  const rope: GuideRope = { coin: "ETH", dex: "", side: "long", size: 2, entryPx: 3950, markPx: 4000, liquidationPx: 3700, distance: 0.075, leverage: 10, positionValue: 8000, unrealizedPnl: 100, sl: { px: 3800 }, tp: null };
  assert.equal(anchoredSafely(rope), true);
  assert.equal(anchoredSafely({ ...rope, sl: { px: 3600 } }), false);
  const reply = answer("riskiest", facts({ ropes: [rope] }));
  assert.ok(!reply.proposals.some((proposal) => proposal.kind === "anchor"));
  assert.ok(reply.proposals.some((proposal) => proposal.kind === "halve"));
  assert.equal(proposedAnchor(rope), 3850);
  assert.equal(anchorProposal({ ...rope, liquidationPx: null }).stop, 3800);
});

test("funding per hour is signed from the holder's side", () => {
  assert.ok(Math.abs((fundingPerHour({ coin: "ETH", side: "long", positionValue: 10_000 }, { ETH: 0.0001 }) ?? 0) + 1) < 1e-9);
  assert.ok(Math.abs((fundingPerHour({ coin: "ETH", side: "short", positionValue: 10_000 }, { ETH: 0.0001 }) ?? 0) - 1) < 1e-9);
  assert.equal(fundingPerHour({ coin: "X", side: "long", positionValue: 1 }, {}), null);
  const reply = answer("what does funding cost me?", facts());
  assert.equal(reply.topic, "funding");
  assert.match(text(reply), /\/h/u);
});

test("exposure folds layers and names the biggest hill", () => {
  const reply = answer("how exposed am I?", facts());
  assert.match(text(reply), /net long/u);
  assert.match(text(reply), /HYPE/u);
});

test("routes and rules become proposals, never signatures", () => {
  const route = answer("bridge 20 HYPE to Elysium", facts());
  assert.deepEqual(route.proposals, [{ kind: "route", sentence: "bridge 20 HYPE to Elysium" }]);
  const rule = answer("when FARTCOIN rope is under 5%, close half", facts());
  const proposal = rule.proposals[0];
  assert.ok(proposal && proposal.kind === "rule");
  assert.equal(proposal.parsed.rule.coin, "FARTCOIN");
  assert.equal(proposal.parsed.rule.action, "close half");
});

test("prices round to five significant figures", () => {
  assert.equal(roundPrice(1.0923456), 1.0923);
  assert.equal(roundPrice(98765.4321), 98765);
  assert.equal(roundPrice(0.000123456), 0.00012346);
});

test("the morning bulletin has three columns and a one-tap question", () => {
  const columns = morningBulletin(facts(), sampleSnapshot(NOW));
  assert.deepEqual(columns.map((column) => column.title), ["Overnight", "On the summit", "Today"]);
  assert.ok(columns[2]?.ask);
  assert.match(columns[2]?.lines[0]?.text ?? "", /FARTCOIN/u);
});
