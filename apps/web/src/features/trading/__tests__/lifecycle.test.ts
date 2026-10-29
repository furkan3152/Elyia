import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MarketInfo } from "@elyia/core/hypercore/wire";
import { DEFAULT_RULE_BOOK } from "@elyia/core/policy";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { memoryNonceStorage, NonceManager } from "../../agentKey/nonce";
import { DERISK_FLOOR, isDeriskingAction } from "../derisk";
import { executePlan, type ExecutorDeps } from "../executor";
import { effectiveRuleBook, evaluateAction, type GuardContext } from "../guard";
import { cancelOrders, closePositionOrder, flattenPlan, isolatedMarginAction, leverageAction, limitOrder, marketOrder, modifyTpslPlan, positionTpslOrder, TicketError, triggerKind, twapOrder } from "../orderBuilders";
import { applyOrderUpdates, parseOrderUpdates, settledPending } from "../reconcile";
import type { PendingOrder } from "../tradeStore";

const ETH: MarketInfo = { coin: "ETH", displayName: "ETH", asset: 4, szDecimals: 4, isSpot: false, maxLeverage: 25, onlyIsolated: false, isDelisted: false };
const HYPE_SPOT: MarketInfo = { coin: "@1035", displayName: "HYPE/USDC", asset: 11035, szDecimals: 2, isSpot: true, maxLeverage: null, onlyIsolated: false, isDelisted: false };
const NOW = 1_793_290_000_000;
let counter = 0;
const cloid = () => `0x${(counter += 1).toString(16).padStart(32, "0")}`;

const markets = new Map([[4, { coin: "ETH", displayName: "ETH", kind: "perp" as const, quote: "USD", asset: 4 }]]);
const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({
  mode: "testnet",
  networkKey: "hypercore-testnet",
  master: "0x4547b9e33f07965711f67d0be2423939a4e33af5",
  marketByAsset: (asset) => markets.get(asset) ?? null,
  priceOf: () => 2300,
  leverageOf: () => 5,
  marketSlippageBps: 100,
  trading: { openOrders: 1, openNotionalUsdMicros: 0n, dayVolumeUsdMicros: 0n, dayRealizedLossUsdMicros: 0n },
  dayUsdMicros: 0n,
  weekUsdMicros: 0n,
  now: NOW,
  ...overrides,
});
const BLIND = { trading: { openOrders: null, openNotionalUsdMicros: null, dayVolumeUsdMicros: null, dayRealizedLossUsdMicros: null }, dayUsdMicros: null, weekUsdMicros: null };

describe("the de-risk lane: reduce-only orders and cancels are never blocked", () => {
  const strict = effectiveRuleBook({ paused: true, reduceOnly: true, markets: ["BTC"], maxSlippageBps: 10, maxLeverage: 2, maxNotionalUsd: "50", dailyLossUsd: "1" }).book;
  const close = closePositionOrder({ market: ETH, szi: "100", mid: "2300", slippageBps: 900 }).action;
  const tpsl = positionTpslOrder({ market: ETH, szi: "-3", reference: 2300, tpsl: { tp: 2000, sl: 2600 } }).action;
  const cancel = cancelOrders([{ asset: 4, oid: 1 }])!;
  const twapOut = twapOrder({ market: ETH, side: "sell", size: "5", minutes: 30, randomize: true, reduceOnly: true });

  it("passes every limit, unknown facts and the network opt-in, and reports what it waived", () => {
    const cases: [string, GuardContext][] = [
      ["strict book, unknown facts, 9% slippage", ctx({ ...BLIND, marketSlippageBps: 900 })],
      ["mainnet without opt-in", ctx({ mode: "mainnet", networkKey: "hypercore-mainnet" })],
      ["market not in the catalogue", ctx({ marketByAsset: () => null, priceOf: () => null, leverageOf: () => null })],
    ];
    for (const [label, context] of cases) {
      for (const action of [close, tpsl, cancel, twapOut]) {
        const verdict = evaluateAction(strict, action, context);
        assert.equal(verdict.decision, "allow", `${label}: ${action.type}`);
        assert.ok(verdict.reasons.every((reason) => DERISK_FLOOR.has(reason.rule)));
      }
    }
    assert.ok(evaluateAction(strict, close, ctx({ ...BLIND, marketSlippageBps: 900 })).waived.some((reason) => reason.rule === "trading.maxSlippageBps"));
  });

  it("does not open the lane for anything that adds risk", () => {
    const opening = limitOrder({ market: ETH, side: "buy", size: "0.01", price: "2300", tif: "Gtc" }).action;
    assert.equal(isDeriskingAction(opening), false);
    assert.equal(evaluateAction(strict, opening, ctx()).decision, "deny");
    // An entry with reduce-only TP/SL children still opens risk.
    const bracket = marketOrder({ market: ETH, side: "buy", size: "0.01", mid: "2300", slippageBps: 50, tpsl: { tp: 2500, sl: 2200 } }).action;
    assert.equal(isDeriskingAction(bracket), false);
    assert.equal(isDeriskingAction(leverageAction(ETH, 2, true)), false);
    assert.equal(isDeriskingAction(isolatedMarginAction(ETH, "10", "remove")), false);
    assert.equal(isDeriskingAction(twapOrder({ market: ETH, side: "buy", size: "1", minutes: 30, randomize: false })), false);
    assert.equal(isDeriskingAction({ type: "noop" }), true);
    assert.equal(isDeriskingAction({ type: "scheduleCancel", time: NOW + 60_000 }), true);
  });

  it("keeps ordinary verdicts unchanged", () => {
    const ok = evaluateAction(DEFAULT_RULE_BOOK, limitOrder({ market: ETH, side: "buy", size: "0.5", price: "2300", tif: "Gtc" }).action, ctx());
    assert.equal(ok.decision, "allow");
    assert.deepEqual(ok.waived, []);
  });
});

describe("margin and TP/SL changes", () => {
  it("adds and removes isolated margin in micro-USD", () => {
    assert.deepEqual(isolatedMarginAction(ETH, "12.5", "add"), { type: "updateIsolatedMargin", asset: 4, isBuy: true, ntli: 12_500_000 });
    assert.equal(isolatedMarginAction(ETH, 3, "remove").ntli, -3_000_000);
    assert.throws(() => isolatedMarginAction(ETH, "0", "add"), TicketError);
    assert.throws(() => isolatedMarginAction(HYPE_SPOT, "5", "add"), /Spot has no margin/u);
  });

  it("modifies TP/SL: new position triggers first, then cancels only the replaced kinds", () => {
    const orders = [
      { coin: "ETH", oid: 1, isTrigger: true, reduceOnly: true, orderType: "Take Profit Market" },
      { coin: "ETH", oid: 2, isTrigger: true, reduceOnly: true, orderType: "Stop Market" },
      { coin: "ETH", oid: 3, isTrigger: false, reduceOnly: false, orderType: "Limit" },
      { coin: "BTC", oid: 4, isTrigger: true, reduceOnly: true, orderType: "Stop Market" },
    ];
    const both = modifyTpslPlan({ market: ETH, szi: "1.5", reference: 2300, tpsl: { tp: 2500, sl: 2150 }, openOrders: orders, cloid });
    assert.equal(both.place.grouping, "positionTpsl");
    assert.deepEqual(both.place.legs.map((leg) => [leg.role, leg.triggerPx, leg.reduceOnly, leg.isBuy]), [
      ["tp", "2500", true, false],
      ["sl", "2150", true, false],
    ]);
    assert.deepEqual(both.replaced, [1, 2]);
    assert.deepEqual(both.cancel?.cancels, [{ a: 4, o: 1 }, { a: 4, o: 2 }]);
    const stopOnly = modifyTpslPlan({ market: ETH, szi: "1.5", reference: 2300, tpsl: { sl: 2200 }, openOrders: orders, cloid });
    assert.deepEqual(stopOnly.replaced, [2], "the take-profit stays");
    const fresh = modifyTpslPlan({ market: ETH, szi: "-1", reference: 2300, tpsl: { tp: 2100 }, openOrders: [], cloid });
    assert.equal(fresh.cancel, null);
    assert.equal(fresh.place.legs[0]?.isBuy, true, "a short's TP buys back");
    assert.equal(triggerKind({ isTrigger: true, orderType: "Stop Limit" }), "sl");
    assert.equal(triggerKind({ isTrigger: false, orderType: "Take Profit Market" }), null);
  });

  it("flattens with every close reduce-only, skipping what cannot be priced", () => {
    const plan = flattenPlan({
      orders: [{ asset: 4, oid: 9 }],
      positions: [
        { market: ETH, szi: "-0.75", mid: "2300" },
        { market: { ...ETH, coin: "SOL", displayName: "SOL", asset: 0, szDecimals: 2 }, szi: "3", mid: null },
      ],
      slippageBps: 100,
      cloid,
    });
    assert.deepEqual(plan.cancel?.cancels, [{ a: 4, o: 9 }]);
    assert.equal(plan.close?.action.orders.length, 1);
    assert.ok(plan.close?.action.orders.every((wire) => wire.r && "limit" in wire.t && wire.t.limit.tif === "Ioc"));
    assert.deepEqual(plan.skipped, [{ coin: "SOL", reason: "no live price" }]);
    assert.ok(isDeriskingAction(plan.close!.action) && isDeriskingAction(plan.cancel!));
  });
});

describe("optimistic rows reconciled from the feeds", () => {
  const row = (cloidValue: string, at = NOW, status: PendingOrder["status"] = "sent"): PendingOrder => ({ cloid: cloidValue, coin: "ETH", isBuy: true, px: "2300", sz: "0.1", label: "entry", status, at });
  const A = "0x000000000000000000000000000000aa";
  const B = "0x000000000000000000000000000000bb";
  const C = "0x000000000000000000000000000000cc";

  it("parses orderUpdates and moves rows on", () => {
    const updates = parseOrderUpdates([
      { order: { coin: "ETH", oid: 1, cloid: A.toUpperCase().replace("0X", "0x") }, status: "open", statusTimestamp: 1 },
      { order: { coin: "ETH", oid: 2, cloid: B }, status: "filled", statusTimestamp: 2 },
      { order: { coin: "ETH", oid: 3, cloid: C }, status: "marginCanceled", statusTimestamp: 3 },
      { order: { coin: "ETH", oid: 4 }, status: "open", statusTimestamp: 4 },
      { broken: true },
    ]);
    assert.equal(updates.length, 4);
    const changes = applyOrderUpdates([row(A), row(B), row(C)], updates);
    assert.deepEqual(changes.update, [
      { cloid: A, status: "resting" },
      { cloid: B, status: "filled" },
    ]);
    assert.deepEqual(changes.drop, [C]);
    assert.deepEqual(applyOrderUpdates([], updates), { drop: [], update: [] });
  });

  it("retires rows once the real order or fill is listed, or after the timeout", () => {
    const pending = [row(A), row(B), row(C, NOW - 25_000)];
    assert.deepEqual(settledPending(pending, { openOrders: [{ cloid: A }], fills: [{ cloid: B.toUpperCase().replace("0X", "0x") }] }, NOW), [A, B, C]);
    assert.deepEqual(settledPending(pending, { openOrders: null, fills: null }, NOW), [C]);
  });
});

describe("executor", () => {
  const agent = privateKeyToAccount(generatePrivateKey());
  /** Executor dependencies with a real agent signer and a fake exchange; `state` counts signatures and posts. */
  const deps = (overrides: Partial<ExecutorDeps> = {}): ExecutorDeps & { readonly state: { signed: number; posted: unknown[] } } => {
    const state = { signed: 0, posted: [] as unknown[] };
    return {
      signer: {
        isMainnet: false,
        nonces: new NonceManager(agent.address, memoryNonceStorage(), () => NOW),
        signTypedData: async (typed) => {
          state.signed += 1;
          return agent.signTypedData(typed as Parameters<typeof agent.signTypedData>[0]);
        },
      },
      book: DEFAULT_RULE_BOOK,
      guard: ctx(),
      exchangeUrl: "https://x/exchange",
      now: () => NOW,
      fetch: (async (_url: string, init?: { body?: string }) => {
        state.posted.push(JSON.parse(init?.body ?? "{}"));
        return new Response(JSON.stringify({ status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 5 } }] } } }), { status: 200 });
      }) as unknown as typeof fetch,
      ...overrides,
      state,
    };
  };

  it("checks every action before signing any: a refused second step signs nothing", async () => {
    const d = deps();
    const plan = { label: "Long", actions: [leverageAction(ETH, 5, true), limitOrder({ market: ETH, side: "buy", size: "5", price: "2300", tif: "Gtc" }).action] };
    const result = await executePlan(d, plan);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "blocked");
    assert.equal(d.state.signed, 0);
    assert.equal(d.state.posted.length, 0);
  });

  it("asks for confirmation, then signs in order with monotonic nonces and reports pending rows", async () => {
    const rows: PendingOrder[] = [];
    const settled: [readonly string[], string][] = [];
    const d = deps({ onPending: (pending) => rows.push(...pending), onSettled: (cloids, status) => settled.push([cloids, status]) });
    const built = limitOrder({ market: ETH, side: "buy", size: "1.2", price: "2300", tif: "Gtc", cloid });
    const plan = { label: "Long 1.2 ETH", actions: [leverageAction(ETH, 5, true), built.action], legs: built.legs, coin: "ETH" };
    const first = await executePlan(d, plan);
    assert.equal(!first.ok && first.kind, "confirm", "$2,760 is above the confirmation threshold");
    assert.equal(d.state.signed, 0);
    const second = await executePlan(d, plan, { confirmed: true });
    assert.equal(second.ok, true);
    assert.equal(d.state.signed, 2);
    const nonces = d.state.posted.map((body) => (body as { nonce: number }).nonce);
    assert.ok(nonces[1]! > nonces[0]!, "nonces strictly increase");
    assert.equal(rows.length, 1);
    assert.deepEqual(settled, [[[built.legs[0]!.cloid], "resting"]]);
  });

  it("refuses without an unlocked key and closes through the lane while facts are unknown", async () => {
    const locked = await executePlan({ ...deps(), signer: null }, { label: "x", actions: [cancelOrders([{ asset: 4, oid: 1 }])!] });
    assert.equal(!locked.ok && locked.kind, "blocked");
    const d = deps({ guard: ctx(BLIND), book: effectiveRuleBook({ paused: true }).book });
    const result = await executePlan(d, { label: "Close ETH", actions: [closePositionOrder({ market: ETH, szi: "2", mid: "2300", slippageBps: 100, cloid }).action] });
    assert.equal(result.ok, true);
    assert.equal(d.state.signed, 1);
  });
});
