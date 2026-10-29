import assert from "node:assert/strict";
import { test } from "node:test";

import type { PortfolioSnapshot, TimelineEvent } from "@elyia/core/api/portfolio";

import { shockRopes } from "../../../features/trading/topo";
import { referencePrice, snapshotFromBrowser } from "../range/browser";
import { pct, usdFull, usdShort, usdSigned } from "../range/format";
import {
  calendarFromTimeline,
  calendarGrid,
  campsFor,
  descentRadar,
  dustLines,
  exposureFold,
  gasCamps,
  hedgeSuggestion,
  layerSplit,
  MAP_UNITS,
  rebalanceMoves,
  REBALANCE_TARGETS,
  registerEntries,
  reliefPlan,
  shockOutcome,
  sortRopes,
  summitFacts,
  timelineCsv,
} from "../range/model";
import { sampleHistory, sampleRopes, sampleSnapshot } from "../range/sample";

const NOW = Date.UTC(2026, 9, 29, 14, 0);

test("format: money never loses its sign or chevron", () => {
  assert.equal(usdFull(4_978_542.8), "$4,978,543");
  assert.equal(usdFull(-12.4), "−$12.40");
  assert.equal(usdShort(4_978_542), "$4.98M");
  assert.equal(usdShort(115_134), "$115k");
  assert.equal(usdSigned(1204), "▲ +$1,204");
  assert.equal(usdSigned(-880), "▼ −$880");
  assert.equal(pct(0.224), "22%");
  assert.equal(pct(0.047), "4.7%");
  assert.equal(usdFull(null), "—");
});

test("layer split sums to the net worth and reads statuses", () => {
  const snapshot = sampleSnapshot(NOW);
  const split = layerSplit(snapshot);
  assert.deepEqual(split.map((entry) => entry.layer), ["floor", "ridge", "summit"]);
  const total = split.reduce((sum, entry) => sum + entry.usd, 0);
  assert.ok(Math.abs(total - snapshot.totals.netWorthUsd) < 1e-6);
  assert.ok(Math.abs(split.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);
});

test("relief plan: positions and lines, largest scaled to map units, dust hidden", () => {
  const snapshot = sampleSnapshot(NOW);
  const plan = reliefPlan(snapshot, { ropes: sampleRopes() });
  const top = plan.holdings[0]!;
  assert.equal(Math.round(top.usd), MAP_UNITS);
  const short = plan.holdings.find((holding) => holding.symbol === "FARTCOIN");
  assert.equal(short?.side, "short");
  assert.equal(short?.note, "rope 6%");
  assert.ok(plan.hidden.count >= 2, "PURR and JEFF dust stay off the map");
  assert.ok(plan.holdings.every((holding) => plan.sources.has(holding.id)));
  // the scale turns map units back into dollars
  assert.ok(Math.abs(top.usd / plan.scale - 12_400) < 1e-6);
  // heights keep two significant figures so live ticks do not redraw the sheet
  assert.ok(plan.holdings.every((holding) => Number(holding.usd.toPrecision(2)) === holding.usd));
});

test("exposure fold: cash apart, net and gross across layers", () => {
  const fold = exposureFold(sampleSnapshot(NOW));
  assert.equal(fold.cashUsd, 20_490);
  assert.equal(fold.rows[0]!.underlying, "HYPE");
  assert.ok(Math.abs(fold.netUsd - (19_568 + 8_958 - 1_950 + 1_137)) < 1);
  assert.ok(fold.gross !== null && fold.gross > 1.0 && fold.gross < 1.2);
});

test("shock outcome adds rope PnL and moved spot holdings; hedge reduces the fraying rope first", () => {
  const snapshot = sampleSnapshot(NOW);
  const ropes = sampleRopes();
  const shocked = shockRopes(ropes, { FARTCOIN: 0.08 });
  const outcome = shockOutcome(snapshot, shocked, "FARTCOIN", 0.08);
  assert.deepEqual(outcome.snapped, ["FARTCOIN"]);
  const hedge = hedgeSuggestion(snapshot, shocked, ropes, "FARTCOIN", 0.08);
  assert.equal(hedge?.sentence, "reduce FARTCOIN by 50%");

  const hype = shockRopes(ropes, { HYPE: -0.1 });
  const hypeOutcome = shockOutcome(snapshot, hype, "HYPE", -0.1);
  // HYPE rope: 310 * 40 * -0.1 = -1240; spot+lst: (28.24 + 151) * 40 * -0.1 = -716.96
  assert.ok(Math.abs(hypeOutcome.ropesChange + 1240) < 1e-6);
  assert.ok(Math.abs(hypeOutcome.spotChange + 716.96) < 1e-6);
  const cover = hedgeSuggestion(snapshot, hype, ropes, "HYPE", -0.1);
  assert.equal(cover?.sentence, "short 90 HYPE 1x");
  assert.equal(hedgeSuggestion(snapshot, hype, ropes, "HYPE", 0), null);
});

test("ropes sort nearest to the crevasse first", () => {
  const sorted = sortRopes(sampleRopes());
  assert.deepEqual(sorted.map((rope) => rope.coin), ["FARTCOIN", "ETH", "HYPE"]);
});

test("dust, gas at every camp and the descent radar", () => {
  const snapshot = sampleSnapshot(NOW);
  assert.deepEqual(dustLines(snapshot).map((line) => line.asset), ["JEFF", "PURR"]);
  const gas = gasCamps(snapshot);
  assert.equal(gas[0]!.state, "none-needed");
  assert.equal(gas[1]!.state, "ok");
  assert.equal(gas[2]!.state, "low");
  assert.equal(gas[2]!.sentence, "bridge 0.3 HYPE to Elysium");
  const radar = descentRadar(snapshot, null, NOW);
  assert.equal(radar.length, 1);
  assert.match(radar[0]!.what, /2\.5 HYPE unstaking/u);
});

test("rebalance moves close the gap to the target", () => {
  const split = [
    { layer: "floor" as const, usd: 600, share: 0.6, status: "ok" as const },
    { layer: "ridge" as const, usd: 300, share: 0.3, status: "ok" as const },
    { layer: "summit" as const, usd: 100, share: 0.1, status: "ok" as const },
  ];
  const moves = rebalanceMoves(split, REBALANCE_TARGETS.thirds);
  const moved = moves.reduce((sum, move) => sum + move.usd, 0);
  assert.ok(Math.abs(moved - 266.67) < 0.01);
  assert.equal(moves[0]!.from, "floor");
  assert.match(moves[0]!.sentence, /^move \d+ USDC from HyperCore to Elysium$/u);
});

test("calendar: weeks start Monday, days without events are empty, best and worst found", () => {
  const timeline: TimelineEvent[] = [
    { kind: "funding", id: "f1", time: NOW - 86_400_000, coin: "SOL", usdc: -12, szi: "1", fundingRate: "0", samples: 1 },
    { kind: "fill", id: "x1", time: NOW, hash: "0x", coin: "SOL", side: "sell", dir: "Close Long", px: "100", sz: "1", notional: 100, fee: 1, feeToken: "USDC", builderFee: null, closedPnl: 40, oid: 1, tid: 1, crossed: true, liquidation: false },
  ];
  const calendar = calendarFromTimeline(timeline);
  assert.deepEqual(calendar.map((day) => [day.day, day.net]), [["2026-10-28", -12], ["2026-10-29", 39]]);
  const grid = calendarGrid(calendar, NOW, 35);
  assert.ok(grid.weeks.every((week) => week.length === 7));
  assert.equal(grid.best?.day, "2026-10-29");
  assert.equal(grid.worst?.day, "2026-10-28");
  assert.equal(grid.total, 27);
  const cells = grid.weeks.flat().filter((cell) => cell.day !== null);
  assert.equal(cells.length, 35);
});

test("register folds the pieces of one order and keeps funding and ledger lines", () => {
  const base = { kind: "fill" as const, hash: "0xabc" as const, coin: "SOL", side: "buy" as const, dir: "Open Long", px: "103.69", fee: 0.1, feeToken: "USDC", builderFee: null, closedPnl: 0, oid: 7, crossed: false, liquidation: false };
  const timeline: TimelineEvent[] = [
    { ...base, id: "a", time: NOW, sz: "14.71", notional: 1525.28, tid: 1 },
    { ...base, id: "b", time: NOW - 2000, sz: "0.29", notional: 30.07, tid: 2 },
    { kind: "ledger", id: "l", time: NOW - 86_400_000, hash: "0xdef", type: "deposit", usdc: 500, token: "USDC", amount: "500", summary: "Deposit 500 USDC" },
  ];
  const rows = registerEntries(timeline);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.entry, /^Open Long 15 SOL at 103\.69 · 2 fills$/u);
  assert.equal(rows[1]!.amount, "+$500");
});

test("csv: header, one row per event, formula injection neutralised", () => {
  const timeline: TimelineEvent[] = [{ kind: "ledger", id: "l", time: NOW, hash: "0x1", type: "send", usdc: -5, token: "USDC", amount: "5", summary: "=HYPERLINK(\"x\")" }];
  const csv = timelineCsv(timeline);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^time_utc,kind,/u);
  assert.match(lines[1]!, /"'=HYPERLINK\(""x""\)"/u);
  assert.match(lines[1]!, /,-5,/u);
});

test("camps pick the biggest events in the window, in time order", () => {
  const history = sampleHistory(NOW);
  const curve = history.equity.allTime!.accountValue;
  const camps = campsFor(history.timeline, curve[0]![0], NOW);
  assert.equal(camps.length, 3);
  assert.match(camps[0]!.label, /^CAMP I · \+\$5,000 deposit$/u);
  assert.ok(camps[0]!.t < camps[1]!.t && camps[1]!.t < camps[2]!.t);
});

test("summit facts: high, change and deepest drawdown", () => {
  const facts = summitFacts([
    { t: 0, value: 100 },
    { t: 86_400_000, value: 150 },
    { t: 2 * 86_400_000, value: 120 },
    { t: 3 * 86_400_000, value: 140 },
  ]);
  assert.equal(facts.high, 150);
  assert.equal(facts.change, 40);
  assert.ok(Math.abs(facts.drawdown - 0.2) < 1e-9);
  assert.equal(facts.days, 3);
});

test("browser snapshot values at reference prices and folds exposure", () => {
  assert.equal(referencePrice("USDC", null), 1);
  assert.equal(referencePrice("kHYPE", { HYPE: "40" }), 40);
  assert.equal(referencePrice("NOPE", { HYPE: "40" }), null);
  const snapshot = snapshotFromBrowser({
    address: "0xABC",
    mode: "testnet",
    now: NOW,
    summary: { accountValue: 1000, withdrawable: 500, marginUsed: 200, maintenance: 50, totalNotional: 2000, crossAccountValue: 1000 },
    positions: [{ coin: "ETH", dex: "", szi: 0.5, sziText: "0.5", isLong: true, entryPx: 3900, positionValue: 2000, unrealizedPnl: 50, roe: 0.25, liquidationPx: 3000, marginUsed: 200, leverage: 10, leverageType: "cross", maxLeverage: 25, fundingSinceOpen: 1, markPx: 4000, liquidationDistance: 0.25 }],
    spot: [{ coin: "HYPE", token: 150, total: "10", hold: "0", entryNtl: "0" } as never, { coin: "MYSTERY", token: 999, total: "5", hold: "0", entryNtl: "0" } as never],
    staking: null,
    mids: { HYPE: "40", ETH: "4000" },
    ridge: { network: "hyperevm-testnet", hype: 1, usdc: 0, blockNumber: null },
    summit: null,
  }) as PortfolioSnapshot;
  assert.equal(snapshot.address, "0xabc");
  assert.equal(snapshot.totals.netWorthUsd, 1000 + 400 + 40);
  assert.equal(snapshot.totals.unpricedLines, 1);
  assert.equal(snapshot.layers[2]!.status, "unavailable");
  const eth = snapshot.exposure.find((row) => row.underlying === "ETH");
  assert.equal(eth?.netUsd, 2000);
  assert.equal(snapshot.positions[0]!.fundingSinceOpen, -1);
});
