import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TradeView } from "@elyia/core/api/markets";
import type { L2Book, RecentTrade } from "@elyia/core/hypercore/info";
import { ManualClock } from "../../../clock.js";
import { summarizeBook, tradeView } from "../book.js";
import { RefreshingCache, RefreshingCacheMap } from "../cache.js";
import { CANDLE_INTERVAL_MS, MAX_CANDLES, planCandles } from "../candles.js";
import { StreamCoalescer, type CoalescerSink } from "../coalescer.js";
import { changePct, hourlyToAprPct, median, medianAbsoluteDeviation, round, toNumber } from "../num.js";
import { TradeRing, TradeTape } from "../tape.js";
import { fixture } from "./fakes.js";

describe("num", () => {
  it("parses decimal strings strictly and never turns junk into 0", () => {
    assert.equal(toNumber("79660.0"), 79_660);
    assert.equal(toNumber("-0.0015804324"), -0.0015804324);
    assert.equal(toNumber("1e-5"), 0.00001);
    for (const junk of ["", " ", "abc", "1,5", "NaN", null, undefined, {}, Number.POSITIVE_INFINITY]) assert.equal(toNumber(junk), null, String(junk));
  });

  it("derives percent change, APR, median and MAD", () => {
    assert.equal(changePct(110, 100), 10);
    assert.equal(changePct(1, 0), null);
    assert.equal(changePct(null, 1), null);
    assert.equal(hourlyToAprPct(0.0000125), 10.95);
    assert.equal(round(-0.0000001, 4), 0, "no negative zero");
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(medianAbsoluteDeviation([1, 2, 3, 4, 100]), 1);
    assert.equal(median([]), null);
  });
});

describe("book and trades (recorded testnet BTC)", () => {
  const book = fixture<L2Book>("testnet-l2book-btc.json");

  it("summarizes best bid/ask, mid, spread and cumulative depth", () => {
    const summary = summarizeBook(book, 3);
    const bid = Number(book.levels[0][0]?.px);
    const ask = Number(book.levels[1][0]?.px);
    assert.equal(summary.bestBid, book.levels[0][0]?.px);
    assert.equal(summary.mid, (bid + ask) / 2);
    assert.equal(summary.spread, ask - bid);
    assert.ok(Math.abs((summary.spreadBps ?? 0) - ((ask - bid) / ((bid + ask) / 2)) * 10_000) < 1e-3);
    assert.equal(summary.bids.length, 3);
    const cumulative = book.levels[0].slice(0, 3).reduce((total, level) => total + Number(level.sz), 0);
    assert.ok(Math.abs((summary.bids[2]?.cumSz ?? 0) - cumulative) < 1e-9);
  });

  it("an empty side has no mid or spread", () => {
    const summary = summarizeBook({ levels: [[], book.levels[1]] });
    assert.equal(summary.bestBid, null);
    assert.equal(summary.mid, null);
    assert.equal(summary.spreadBps, null);
  });

  it("maps the aggressor side B/A to buy/sell", () => {
    const trades = fixture<RecentTrade[]>("testnet-trades-btc.json");
    const view = tradeView(trades[0] as RecentTrade);
    assert.equal(view.side, trades[0]?.side === "B" ? "buy" : "sell");
    assert.equal(view.tid, trades[0]?.tid);
  });
});

describe("candle planning", () => {
  const now = Date.UTC(2026, 9, 29, 16, 20, 0);
  const hour = CANDLE_INTERVAL_MS["1h"];

  it("an open range ends at the current candle and is aligned to the interval (shared cache key)", () => {
    const plan = planCandles({ interval: "1h", limit: 3 }, now);
    assert.equal(plan.endTime, undefined);
    assert.equal(plan.to, Date.UTC(2026, 9, 29, 17, 0, 0) - 1);
    assert.equal(plan.startTime, Date.UTC(2026, 9, 29, 14, 0, 0));
    assert.equal(plan.truncated, false);
    assert.deepEqual(planCandles({ interval: "1h", limit: 3 }, now + 60_000), plan, "the same plan within the hour");
  });

  it("caps a long range at MAX_CANDLES and says so", () => {
    const plan = planCandles({ interval: "1m", from: now - 10 * MAX_CANDLES * 60_000, to: now - 60_000 }, now);
    assert.equal(plan.truncated, true);
    assert.equal(plan.closed, true);
    assert.equal((plan.to + 1 - plan.startTime) / 60_000, MAX_CANDLES);
    const short = planCandles({ interval: "1h", from: now - 5 * hour, to: now - hour }, now);
    assert.equal(short.truncated, false);
    assert.equal(short.startTime % hour, 0);
  });
});

describe("RefreshingCache", () => {
  it("shares one load, serves stale on failure inside maxStaleMs, then throws", async () => {
    const clock = new ManualClock(0);
    let loads = 0;
    let fail = false;
    const cache = new RefreshingCache(
      async () => {
        loads += 1;
        if (fail) throw new Error("down");
        return loads;
      },
      { ttlMs: 100, maxStaleMs: 1_000, clock },
    );
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    assert.deepEqual([a.value, b.value, loads], [1, 1, 1]);
    clock.advance(150);
    fail = true;
    assert.deepEqual(await cache.get(), { value: 1, fetchedAt: 0, stale: true });
    clock.advance(1_000);
    await assert.rejects(cache.get(), /down/u);
    fail = false;
    assert.equal((await cache.get()).value, 4);
  });

  it("backs off after a failure instead of hammering upstream", async () => {
    const clock = new ManualClock(0);
    let loads = 0;
    const cache = new RefreshingCache(
      async () => {
        loads += 1;
        throw new Error("down");
      },
      { ttlMs: 100, maxStaleMs: 1_000, clock, errorBackoffMs: 500 },
    );
    await assert.rejects(cache.get());
    await assert.rejects(cache.get());
    assert.equal(loads, 1);
    clock.advance(600);
    await assert.rejects(cache.get());
    assert.equal(loads, 2);
  });

  it("evicts the least recently used key", async () => {
    const map = new RefreshingCacheMap(async (key) => key.toUpperCase(), { ttlMs: 100, maxStaleMs: 100, clock: new ManualClock(), maxEntries: 2 });
    await map.get("a");
    await map.get("b");
    await map.get("a");
    await map.get("c");
    assert.equal(map.size, 2);
    assert.equal(map.peek("b"), null, "b was the least recently used");
    assert.equal(map.peek("a")?.value, "A");
  });
});

function trade(tid: number, time = tid): TradeView {
  return { px: "1", sz: "1", side: "buy", time, tid, hash: "0x" };
}

describe("trade ring and tape", () => {
  it("dedupes by trade id, keeps the newest capacity prints, newest first", () => {
    const ring = new TradeRing(3);
    assert.equal(ring.add([trade(1), trade(2)]), 2);
    assert.equal(ring.add([trade(2), trade(3), trade(4)]), 2);
    assert.deepEqual(ring.latest(10).map((print) => print.tid), [4, 3, 2]);
    assert.equal(ring.add([trade(1)]), 1, "an evicted id may come back");
  });

  it("seeds from REST once, then serves the live feed; idle coins are unsubscribed", async () => {
    let restCalls = 0;
    let listener: ((prints: RecentTrade[]) => void) | null = null;
    let unsubscribed = 0;
    let now = 0;
    const raw = fixture<RecentTrade[]>("testnet-trades-btc.json");
    const tape = new TradeTape({
      info: () => ({ recentTrades: async () => ((restCalls += 1), raw) }) as never,
      ws: () =>
        ({
          subscribe: (_subscription: unknown, fn: (prints: RecentTrade[]) => void) => {
            listener = fn;
            return () => {
              unsubscribed += 1;
            };
          },
        }) as never,
      now: () => now,
      idleMs: 1_000,
    });
    const first = await tape.recent("BTC", 3);
    assert.equal(first.source, "tape");
    assert.equal(first.trades.length, 3);
    const live = { ...(raw[0] as RecentTrade), tid: 1, time: (raw[0]?.time ?? 0) + 10_000 };
    (listener as unknown as (prints: RecentTrade[]) => void)([live]);
    const second = await tape.recent("BTC", 2);
    assert.equal(second.trades[0]?.tid, 1, "the live print is newest");
    assert.equal(restCalls, 1);
    now = 5_000;
    tape.sweep();
    assert.equal(unsubscribed, 1);
    assert.equal(tape.coins, 0);
    tape.close();
  });

  it("falls back to REST beyond the taped-coin cap", async () => {
    const raw = fixture<RecentTrade[]>("testnet-trades-btc.json");
    const tape = new TradeTape({ info: () => ({ recentTrades: async () => raw }) as never, ws: () => ({ subscribe: () => () => undefined }) as never, now: () => 0, maxCoins: 0 });
    const answer = await tape.recent("BTC", 2);
    assert.equal(answer.source, "info");
    assert.ok(answer.trades.length === 2 && (answer.trades[0]?.time ?? 0) >= (answer.trades[1]?.time ?? 0));
  });
});

describe("stream coalescer", () => {
  function sink(accept: () => boolean) {
    const events: Array<[string, unknown]> = [];
    const value: CoalescerSink & { events: typeof events } = {
      closed: false,
      events,
      send(event, data) {
        if (!accept()) return false;
        events.push([event, data]);
        return true;
      },
    };
    return value;
  }

  it("sends only changed mids and only the newest book", () => {
    const coalescer = new StreamCoalescer(() => 7);
    const coins = new Set(["BTC", "@1035"]);
    coalescer.pushMids({ BTC: "1", ETH: "2", "@1035": "3" }, coins);
    coalescer.pushBook({ coin: "BTC", time: 1, bids: [], asks: [] });
    coalescer.pushBook({ coin: "BTC", time: 2, bids: [], asks: [] });
    const out = sink(() => true);
    coalescer.flush(out);
    assert.deepEqual(out.events, [
      ["mids", { time: 7, mids: { BTC: "1", "@1035": "3" } }],
      ["book", { coin: "BTC", time: 2, bids: [], asks: [] }],
    ]);
    coalescer.pushMids({ BTC: "1", "@1035": "4" }, coins);
    coalescer.flush(out);
    assert.deepEqual(out.events[2], ["mids", { time: 7, mids: { "@1035": "4" } }]);
  });

  it("keeps trades while the client is not draining and drops the oldest beyond the cap", () => {
    const coalescer = new StreamCoalescer(() => 0, 3);
    coalescer.pushTrades("BTC", [trade(1), trade(2)]);
    const blocked = sink(() => false);
    coalescer.flush(blocked);
    assert.equal(coalescer.pending.trades, 2, "nothing lost while blocked");
    coalescer.pushTrades("BTC", [trade(3), trade(4)]);
    assert.equal(coalescer.pending.dropped, 1);
    const open = sink(() => true);
    coalescer.flush(open);
    assert.deepEqual(open.events, [
      ["trades", { coin: "BTC", trades: [trade(2), trade(3), trade(4)] }],
      ["dropped", { trades: 1 }],
    ]);
    assert.deepEqual(coalescer.pending, { mids: 0, books: 0, trades: 0, dropped: 0 });
  });
});
