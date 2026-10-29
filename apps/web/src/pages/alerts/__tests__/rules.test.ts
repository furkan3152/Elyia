import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeRules } from "../model/alertStore";
import { afterFire, aprFromHourly, COOLDOWN_MS, evaluateRule, parseRuleSentence, ruleSentence, shouldFire, type AlertRule, type RuleReadings } from "../model/rules";

const NOW = 1_800_000_000_000;

function rule(values: Partial<AlertRule>): AlertRule {
  return { id: "r1", kind: "price", coin: "BTC", direction: "above", threshold: 100_000, channels: { app: true, telegram: false }, armed: true, once: false, createdAt: NOW - 60_000, lastFiredAt: null, ...values };
}

const READINGS: RuleReadings = {
  mids: { BTC: 98_000, ETH: 4_000 },
  funding: { ETH: 0.0000125, BTC: -0.00002 },
  ropes: [
    { coin: "ETH", distance: 0.19 },
    { coin: "FARTCOIN", distance: 0.06 },
    { coin: "USDC", distance: null },
  ],
  fills: [{ coin: "ETH", time: NOW - 1_000, side: "buy", px: "4000", sz: "0.5" }],
  bridges: [],
  now: NOW,
};

test("price rules: gap, crossing and the event line", () => {
  const below = evaluateRule(rule({}), READINGS);
  assert.equal(below.met, false);
  assert.ok(below.gap !== null && Math.abs(below.gap - 2_000 / 98_000) < 1e-9);
  assert.match(below.reading, /to go/u);
  const crossed = evaluateRule(rule({ threshold: 95_000 }), READINGS);
  assert.equal(crossed.met, true);
  assert.equal(crossed.gap, 0);
  assert.match(crossed.event ?? "", /BTC is above \$95,000/u);
  const down = evaluateRule(rule({ direction: "below", threshold: 99_000 }), READINGS);
  assert.equal(down.met, true);
  const unknown = evaluateRule(rule({ coin: "NOPE" }), READINGS);
  assert.equal(unknown.value, null);
  const unset = evaluateRule(rule({ threshold: null }), READINGS);
  assert.equal(unset.value, 98_000);
  assert.match(unset.reading, /set your line/u);
});

test("funding rules compare APR and say who pays", () => {
  assert.ok(Math.abs(aprFromHourly(0.0000125) - 0.1095) < 1e-9);
  const status = evaluateRule(rule({ kind: "funding", coin: "ETH", threshold: 0.1 }), READINGS);
  assert.equal(status.met, true);
  assert.match(status.event ?? "", /longs pay/u);
  const negative = evaluateRule(rule({ kind: "funding", coin: "BTC", direction: "below", threshold: -0.1 }), READINGS);
  assert.equal(negative.met, true);
  assert.match(negative.event ?? "", /shorts pay/u);
});

test("rope rules read the nearest rope and ignore ropes without a crevasse", () => {
  const any = evaluateRule(rule({ kind: "rope", coin: null, direction: "below", threshold: 0.1 }), READINGS);
  assert.equal(any.met, true);
  assert.match(any.event ?? "", /FARTCOIN rope is 6%/u);
  const eth = evaluateRule(rule({ kind: "rope", coin: "ETH", direction: "below", threshold: 0.1 }), READINGS);
  assert.equal(eth.met, false);
  assert.ok(eth.gap !== null && Math.abs(eth.gap - 0.09) < 1e-9);
  const none = evaluateRule(rule({ kind: "rope", coin: "USDC", threshold: 0.1 }), READINGS);
  assert.equal(none.met, false);
  assert.equal(none.value, null);
});

test("fill rules only hear fills after the rule (or its last firing)", () => {
  const fresh = evaluateRule(rule({ kind: "fill", coin: null }), READINGS);
  assert.equal(fresh.met, true);
  assert.equal(fresh.event, "Bought 0.5 ETH at 4000");
  const old = evaluateRule(rule({ kind: "fill", coin: null, lastFiredAt: NOW }), READINGS);
  assert.equal(old.met, false);
  const other = evaluateRule(rule({ kind: "fill", coin: "BTC" }), READINGS);
  assert.equal(other.met, false);
});

test("firing respects arming, the cooldown and one-shot rules", () => {
  const met = evaluateRule(rule({ threshold: 90_000 }), READINGS);
  assert.equal(shouldFire(rule({ threshold: 90_000 }), met, NOW), true);
  assert.equal(shouldFire(rule({ threshold: 90_000, armed: false }), met, NOW), false);
  assert.equal(shouldFire(rule({ threshold: 90_000, lastFiredAt: NOW - COOLDOWN_MS + 1 }), met, NOW), false);
  assert.equal(shouldFire(rule({ threshold: 90_000, lastFiredAt: NOW - COOLDOWN_MS }), met, NOW), true);
  const once = afterFire(rule({ once: true }), NOW);
  assert.equal(once.armed, false);
  assert.equal(once.lastFiredAt, NOW);
  assert.equal(afterFire(rule({}), NOW).armed, true);
});

test("plain sentences become rules", () => {
  const funding = parseRuleSentence("alert me if ETH funding goes above 0.01%");
  assert.ok(funding);
  assert.equal(funding.rule.kind, "funding");
  assert.equal(funding.rule.coin, "ETH");
  assert.equal(funding.rule.direction, "above");
  assert.ok(Math.abs((funding.rule.threshold ?? 0) - 0.876) < 1e-9);
  const apr = parseRuleSentence("tell me when btc funding is below -30% APR");
  assert.equal(apr?.rule.coin, "BTC");
  assert.equal(apr?.rule.direction, "below");
  assert.ok(Math.abs((apr?.rule.threshold ?? 0) + 0.3) < 1e-9);
  const price = parseRuleSentence("ping me when BTC drops below 90k");
  assert.equal(price?.rule.kind, "price");
  assert.equal(price?.rule.threshold, 90_000);
  assert.equal(price?.rule.direction, "below");
  const rope = parseRuleSentence("when any rope is under 10%, close half");
  assert.equal(rope?.rule.kind, "rope");
  assert.equal(rope?.rule.coin, null);
  assert.equal(rope?.rule.threshold, 0.1);
  assert.equal(rope?.rule.action, "close half");
  const fill = parseRuleSentence("notify me when a HYPE order fills");
  assert.equal(fill?.rule.kind, "fill");
  assert.equal(fill?.rule.coin, "HYPE");
  assert.equal(parseRuleSentence("what's my riskiest rope?"), null);
  assert.equal(parseRuleSentence("how safe am I if ETH drops 20%"), null);
  assert.equal(parseRuleSentence("long ETH 5x with 200 USDC"), null);
});

test("rules read back as sentences", () => {
  assert.equal(ruleSentence(rule({})), "Tell me when BTC goes above $100,000");
  assert.equal(ruleSentence(rule({ kind: "rope", coin: null, threshold: 0.1, action: "close half" })), "When any rope is closer than 10% to the crevasse, draft: close half");
});

test("stored rules are sanitised", () => {
  const rules = sanitizeRules([rule({}), { id: 5 }, { id: "x", kind: "nope" }, { ...rule({ id: "y" }), threshold: "NaN", coin: "eth", action: "  " }, null]);
  assert.equal(rules.length, 2);
  assert.equal(rules[1]?.coin, "ETH");
  assert.equal(rules[1]?.threshold, null);
  assert.equal(rules[1]?.action, undefined);
  assert.deepEqual(sanitizeRules("garbage"), []);
});
