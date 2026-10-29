import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LedgerUpdate, Portfolio, UserFill, UserFundingEntry } from "@elyia/core/hypercore/info";
import { fixture } from "../../markets/__tests__/fakes.js";
import { buildHistory, equityCurves, fillEvent, fundingEvent, ledgerEvent, pnlCalendar, utcDay } from "../history.js";
import { touchedDexes } from "../sources.js";

const ADDRESS = "0x6e190168dc30077b827eb6c1eb7629a7c16f912a";
const fills = fixture<UserFill[]>("testnet-fills.json", "portfolio");
const funding = fixture<UserFundingEntry[]>("testnet-funding.json", "portfolio");
const ledger = fixture<LedgerUpdate[]>("testnet-ledger.json", "portfolio");
const portfolio = fixture<Portfolio>("testnet-portfolio.json", "portfolio");

describe("timeline events (recorded testnet history)", () => {
  it("maps fills with side, notional, fee and realized PnL", () => {
    const raw = fills[0] as UserFill;
    const event = fillEvent(raw);
    assert.equal(event.kind, "fill");
    assert.equal(event.id, `fill:${raw.tid}`);
    assert.equal(event.side, raw.side === "B" ? "buy" : "sell");
    assert.ok(Math.abs(event.notional - Number(raw.px) * Number(raw.sz)) < 1e-6);
    assert.equal(event.closedPnl, Number(raw.closedPnl));
    assert.equal(event.liquidation, false);
  });

  it("keeps HyperCore's funding sign (negative = paid) and merged sample counts", () => {
    const raw = funding[0] as UserFundingEntry;
    const event = fundingEvent(raw);
    assert.equal(event.usdc, Number(raw.delta.usdc));
    assert.equal(event.samples, raw.delta.nSamples);
  });

  it("states ledger updates from the account's side", () => {
    const events = ledger.map((update) => ledgerEvent(update, ADDRESS));
    const incoming = events.find((event, index) => event.type === "send" && (ledger[index]?.delta as { destination?: string }).destination === ADDRESS);
    assert.ok(incoming && (incoming.usdc ?? 0) > 0, "a send to this account is incoming");
    assert.match(incoming.summary, /^Received /u);
    const outgoing = events.find((event, index) => event.type === "send" && (ledger[index]?.delta as { user?: string }).user === ADDRESS);
    assert.ok(outgoing && (outgoing.usdc ?? 0) < 0);
    const classMove = events.find((event) => event.type === "accountClassTransfer");
    assert.equal(classMove?.usdc, null, "moving between spot and perps is not income");
    assert.match(classMove?.summary ?? "", /Spot → Perps|Perps → Spot/u);
  });

  it("covers the ledger types HyperCore documents", () => {
    const at = (delta: Record<string, unknown>) => ledgerEvent({ time: 1, hash: "0x01", delta: delta as LedgerUpdate["delta"] }, ADDRESS);
    assert.equal(at({ type: "deposit", usdc: "100.0" }).usdc, 100);
    assert.equal(at({ type: "withdraw", usdc: "40.0", nonce: 1, fee: "1.0" }).usdc, -40);
    assert.equal(at({ type: "vaultDeposit", vault: "0x02", usdc: "25" }).usdc, -25);
    assert.equal(at({ type: "vaultWithdraw", vault: "0x02", user: ADDRESS, requestedUsd: "10", commission: "0", closingCost: "0", basis: "9", netWithdrawnUsd: "9.5" }).usdc, 9.5);
    assert.equal(at({ type: "send", user: ADDRESS, destination: ADDRESS, sourceDex: "", destinationDex: "xyz", token: "USDC", amount: "5", usdcValue: "5", fee: "0", nativeTokenFee: "0", nonce: 1, feeToken: "" }).usdc, null);
    assert.match(at({ type: "liquidation", liquidatedNtlPos: "1", accountValue: "2", leverageType: "Cross", liquidatedPositions: [] }).summary, /Liquidated/u);
    assert.equal(at({ type: "somethingNew" }).summary, "somethingNew");
  });

  it("finds the HIP-3 dexes a user touched in the ledger and fills", () => {
    assert.deepEqual(touchedDexes(ledger, fills), [], "the recorded account only used the first dex and spot");
    const send = { time: 1, hash: "0x01", delta: { type: "send", sourceDex: "", destinationDex: "xyz" } } as unknown as LedgerUpdate;
    const fill = { ...(fills[0] as UserFill), coin: "flx:GOLD" };
    assert.deepEqual(touchedDexes([send], [fill]), ["flx", "xyz"]);
  });
});

describe("calendar and equity", () => {
  it("sums realized PnL, fees and funding by UTC day", () => {
    const fillEvents = fills.map(fillEvent);
    const fundingEvents = funding.map(fundingEvent);
    const { days } = pnlCalendar(fillEvents, fundingEvents, () => null);
    const total = days.reduce((sum, day) => sum + day.net, 0);
    const expected = fillEvents.reduce((sum, fill) => sum + fill.closedPnl - fill.fee, 0) + fundingEvents.reduce((sum, entry) => sum + entry.usdc, 0);
    assert.ok(Math.abs(total - expected) < 1e-4);
    assert.ok(days.every((day, index) => index === 0 || (days[index - 1]?.day ?? "") < day.day), "oldest first");
    assert.equal(utcDay(Date.UTC(2026, 9, 29, 23, 59)), "2026-10-29");
  });

  it("values non-USDC fees with the reference and counts the ones it cannot", () => {
    const base = fillEvent(fills[0] as UserFill);
    const { days, unpricedFees } = pnlCalendar([{ ...base, fee: 0.1, feeToken: "HYPE" }, { ...base, fee: 3, feeToken: "MYSTERY" }], [], (token) => (token === "HYPE" ? 90 : null));
    assert.equal(days[0]?.fees, 9);
    assert.equal(unpricedFees, 1);
  });

  it("reads every equity period with numeric points", () => {
    const curves = equityCurves(portfolio);
    assert.deepEqual(Object.keys(curves).sort(), ["allTime", "day", "month", "perpAllTime", "perpDay", "perpMonth", "perpWeek", "week"]);
    assert.ok(curves.day && curves.day.accountValue.every(([time, value]) => Number.isInteger(time) && Number.isFinite(value)));
  });

  it("builds the history with sections, a range filter and newest-first timeline", () => {
    const times = [...fills.map((fill) => fill.time), ...funding.map((entry) => entry.time), ...ledger.map((update) => update.time)];
    const from = Math.min(...times);
    const to = Math.max(...times);
    const history = buildHistory({
      address: ADDRESS,
      mode: "testnet",
      from,
      to,
      now: to,
      fills: { items: fills, truncated: false, message: null },
      funding: { items: funding, truncated: true, message: null },
      ledger: { items: null, truncated: false, message: "Hyperliquid is limiting requests right now." },
      portfolio: { value: portfolio, message: null },
      feeUsd: () => null,
    });
    assert.equal(history.timeline.length, fills.length + funding.length);
    assert.ok(history.timeline.every((event, index) => index === 0 || (history.timeline[index - 1]?.time ?? 0) >= event.time));
    assert.equal(history.sections.funding.truncated, true);
    assert.equal(history.sections.ledger.status, "error");
    assert.equal(history.sections.ledger.message, "Hyperliquid is limiting requests right now.");
    assert.equal(history.sections.equity.count, 8);
    const narrow = buildHistory({ ...{ address: ADDRESS, mode: "testnet" as const, now: to, fills: { items: fills, truncated: false, message: null }, funding: { items: [], truncated: false, message: null }, ledger: { items: [], truncated: false, message: null }, portfolio: { value: null, message: null }, feeUsd: () => null }, from: to + 1, to: to + 2 });
    assert.equal(narrow.timeline.length, 0, "events outside the window are dropped");
    assert.equal(narrow.sections.equity.status, "error");
  });
});
