import assert from "node:assert/strict";
import { test } from "node:test";

import type { Insight } from "@elyia/core/api/agent";

import { sampleHistory, sampleRopes, sampleSnapshot } from "../range/sample";
import { SAMPLE_INSIGHTS, SAMPLE_PNL } from "../v2/sample";
import { activityRows, allocation, balanceGroups, positionRows, riskLine, ropeWord, rowAction, samplePnlTurn, tabForKey, TABS, wantsPnl } from "../workspace/model";

const NOW = Date.UTC(2026, 10, 1, 12);

test("tabs: four views on keys 1–4, nothing else", () => {
  assert.deepEqual(
    TABS.map((tab) => [tab.id, tab.key]),
    [
      ["map", "1"],
      ["positions", "2"],
      ["balances", "3"],
      ["activity", "4"],
    ],
  );
  assert.equal(tabForKey("3"), "balances");
  assert.equal(tabForKey("5"), null);
  assert.equal(tabForKey("/"), null);
});

test("allocation: whole percents that add up to 100, by Floor / Ridge / Summit", () => {
  const parts = allocation(sampleSnapshot(NOW));
  assert.deepEqual(
    parts.map((part) => part.layer),
    ["floor", "ridge", "summit"],
  );
  assert.equal(
    parts.reduce((sum, part) => sum + part.pct, 0),
    100,
  );
  for (const part of parts) assert.ok(Number.isInteger(part.pct));
  const empty = sampleSnapshot(NOW);
  const zero = allocation({ ...empty, totals: { ...empty.totals, netWorthUsd: 0, byLayer: { hypercore: 0, hyperevm: 0, elysium: 0 } } });
  assert.deepEqual(
    zero.map((part) => part.pct),
    [0, 0, 0],
  );
});

test("rope words and the risk line (▲/▼, never colour alone)", () => {
  assert.equal(ropeWord(0.06), "risk");
  assert.equal(ropeWord(0.19), "watch");
  assert.equal(ropeWord(0.33), "ok");
  assert.equal(ropeWord(null), "no liq");
  assert.deepEqual(riskLine([]), { tone: "mute", text: "no open ropes" });
  assert.deepEqual(riskLine([{ distance: 0.06 }, { distance: 0.3 }]), { tone: "dn", text: "▼ 1 rope under 10%" });
  assert.deepEqual(riskLine([{ distance: 0.3 }, { distance: null }]), { tone: "up", text: "▲ every rope over 10%" });
});

test("positions: nearest the edge first; Ely's own draft wins, else ease / anchor / close", () => {
  const ropes = sampleRopes();
  const rows = positionRows(ropes, SAMPLE_INSIGHTS, "hypercore-testnet");
  assert.deepEqual(
    rows.map((row) => row.coin),
    ["FARTCOIN", "ETH", "HYPE"],
  );
  const [fart, eth, hype] = rows;
  // FARTCOIN: 6% from liquidation and no insight -> trim 25%, reduce-only.
  assert.equal(fart!.word, "risk");
  assert.equal(fart!.action.label, "Ease");
  assert.equal(fart!.action.insightId, null);
  assert.deepEqual(fart!.action.source.kind === "actions" ? fart!.action.source.actions : null, [{ kind: "order", network: "hypercore-testnet", market: "FARTCOIN", params: { reduce: true, portionBps: 2_500 } }]);
  // ETH: the sample's liquidation-guard insight names it -> Ely's own draft.
  assert.equal(eth!.action.label, "Ease");
  assert.equal(eth!.action.insightId, "sample_liquidation-guard_ETH");
  // HYPE: safe, no stop resting -> a reduce-only stop inside half the distance to liquidation, at most 8%.
  assert.equal(hype!.hasStop, false);
  assert.equal(hype!.action.label, "Anchor");
  const stop = hype!.action.source.kind === "actions" ? Number(hype!.action.source.actions[0]!.stopLoss) : NaN;
  assert.ok(Math.abs(stop - 40 * 0.92) < 1e-6, `stop ${stop}`);
});

test("row action: a protected, safe position offers Close (reduce-only, whole size); paper insights are skipped", () => {
  const paper: Insight = { ...SAMPLE_INSIGHTS[0]!, paper: true };
  const action = rowAction({ coin: "ETH", side: "long", markPx: 4000, liquidationPx: 2000, distance: 0.5, sl: { px: 3600, oid: 1, wholePosition: true } }, [paper], "hypercore-mainnet");
  assert.equal(action.label, "Close");
  assert.deepEqual(action.source.kind === "actions" ? action.source.actions : null, [{ kind: "order", network: "hypercore-mainnet", market: "ETH", params: { reduce: true, portionBps: 10_000 } }]);
  // A short's stop sits above the mark.
  const short = rowAction({ coin: "SOL", side: "short", markPx: 100, liquidationPx: 150, distance: 0.5, sl: null }, [], "hypercore-testnet");
  assert.equal(short.label, "Anchor");
  assert.equal(short.source.kind === "actions" ? short.source.actions[0]!.stopLoss : null, "108");
});

test("balances: grouped by layer, largest first, dust and unpriced lines folded unless asked", () => {
  const snapshot = sampleSnapshot(NOW);
  const groups = balanceGroups(snapshot, false);
  assert.deepEqual(
    groups.map((group) => group.title),
    ["Floor", "Ridge", "Summit"],
  );
  const floor = groups[0]!;
  assert.equal(floor.rows[0]!.asset, "USDC");
  assert.equal(floor.rows[0]!.account, "perp margin");
  for (const group of groups) for (let i = 1; i < group.rows.length; i += 1) assert.ok((group.rows[i - 1]!.usd ?? -1) >= (group.rows[i]!.usd ?? -1));
  // JEFF ($2.73) and 14 PURR ($1.68) are dust on the Floor.
  assert.ok(!floor.rows.some((row) => row.asset === "JEFF" || row.asset === "PURR"));
  assert.equal(floor.hidden, 2);
  const unpriced = { ...snapshot, layers: snapshot.layers.map((layer) => (layer.layer === "hypercore" ? { ...layer, lines: [...layer.lines, { ...layer.lines[0]!, id: "spam", asset: "AAARST", priceUsd: null, usd: null }] } : layer)) };
  assert.ok(!balanceGroups(unpriced, false)[0]!.rows.some((row) => row.asset === "AAARST"));
  assert.ok(balanceGroups(unpriced, true)[0]!.rows.some((row) => row.asset === "AAARST" && row.usd === null));
  const all = balanceGroups(snapshot, true);
  assert.ok(all[0]!.rows.some((row) => row.asset === "JEFF"));
  assert.equal(all[0]!.hidden, 0);
});

test("activity: the log book, filtered by kind, newest first", () => {
  const history = sampleHistory(NOW);
  const all = activityRows(history, "all");
  assert.ok(all.length > 0);
  for (let i = 1; i < all.length; i += 1) assert.ok(all[i - 1]!.time >= all[i]!.time);
  const funding = activityRows(history, "funding");
  assert.ok(funding.length > 0 && funding.every((row) => row.kind === "funding"));
  const ledger = activityRows(history, "ledger");
  assert.deepEqual(
    ledger.map((row) => row.entry),
    ["Deposit 5000 USDC"],
  );
  assert.deepEqual(activityRows(null, "all"), []);
});

test("explain PnL: which messages carry the waterfall, and the labelled sample's answer", () => {
  assert.ok(wantsPnl("Explain my PnL"));
  assert.ok(wantsPnl("where did my money go?"));
  assert.ok(!wantsPnl("protect my positions"));
  const turn = samplePnlTurn(SAMPLE_PNL, "e1", NOW);
  assert.equal(turn.doneAt, NOW + 1_000);
  assert.equal(turn.readings.length, 3);
  assert.ok(turn.readings.every((reading) => reading.ok === true && reading.settledAt !== null));
  // Causes in order of size, and the net the waterfall reconciles to (1318 − 51 − 21 + 38).
  const lines = turn.text.split("\n");
  assert.equal(lines[0], "Four things, in order of size:");
  assert.ok(lines[1]!.startsWith("**Realized, ▲ +$1,318.**"));
  assert.ok(turn.text.includes("**▲ +$1,284**"));
  assert.ok(turn.text.includes("labelled sample"));
});
