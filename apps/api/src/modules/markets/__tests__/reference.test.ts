import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AllMids, SpotMeta } from "@elyia/core/hypercore/info";
import { ManualClock } from "../../../clock.js";
import { buildReferenceTable, isCashUnderlying, khypeAccountantAddress, priceMainnetToken, priceSymbol, ReferencePriceService, underlyingOf } from "../reference.js";
import { fixture } from "./fakes.js";

const mids = fixture<AllMids>("mainnet-mids.json");
const spotMeta = fixture<SpotMeta>("mainnet-spotmeta.json");
const table = buildReferenceTable({ mids, spotMeta, khypeToHype: 1.0272703501522418, time: 1_000 });

describe("reference prices (recorded HyperCore mainnet mids)", () => {
  it("prices spot tokens from their USDC pair and perps from their mid", () => {
    assert.deepEqual(priceSymbol(table, "HYPE"), { symbol: "HYPE", usd: Number(mids["@107"]), basis: "spot-pair", coin: "@107", detail: null });
    assert.equal(priceSymbol(table, "PURR")?.coin, "PURR/USDC");
    assert.equal(priceSymbol(table, "UBTC")?.coin, "@142");
    assert.equal(priceSymbol(table, "UETH")?.coin, "@151");
    assert.equal(priceSymbol(table, "USDT0")?.coin, "@166");
    assert.equal(priceSymbol(table, "USDH")?.coin, "@230", "the USDC pair, not KHYPE/USDH or other quotes");
    assert.equal(priceSymbol(table, "KNTQ")?.coin, "@334");
    assert.equal(priceSymbol(table, "BTC")?.basis, "perp-mid");
    assert.equal(priceSymbol(table, "kPEPE")?.usd, Number(mids.kPEPE), "perp coin names keep their case");
  });

  it("USDC is the unit; aliases resolve to the same asset", () => {
    assert.equal(priceSymbol(table, "USDC")?.usd, 1);
    assert.equal(priceSymbol(table, "USDC")?.basis, "unit");
    assert.equal(priceSymbol(table, "WHYPE")?.usd, priceSymbol(table, "HYPE")?.usd);
    assert.equal(priceSymbol(table, "WHYPE")?.symbol, "WHYPE", "the asked symbol is echoed");
    assert.equal(priceSymbol(table, "USDT")?.coin, "@166");
    assert.equal(priceSymbol(table, "usd₮0")?.coin, "@166");
  });

  it("kHYPE uses the StakingAccountant rate, and falls back to its spot pair without it", () => {
    const khype = priceSymbol(table, "kHYPE");
    assert.equal(khype?.basis, "lst-rate");
    assert.ok(Math.abs((khype?.usd ?? 0) - Number(mids["@107"]) * 1.0272703501522418) < 1e-9);
    assert.match(khype?.detail ?? "", /1 kHYPE = 1\.02727 HYPE/u);
    const noRate = buildReferenceTable({ mids, spotMeta, khypeToHype: null, time: 1_000 });
    assert.equal(priceSymbol(noRate, "kHYPE")?.coin, "@336");
    assert.equal(priceSymbol(noRate, "kHYPE")?.basis, "spot-pair");
  });

  it("unknown symbols are unknown, never zero", () => {
    assert.equal(priceSymbol(table, "NOTATOKEN"), null);
    assert.equal(priceSymbol(buildReferenceTable({ mids: { "@107": "0" }, spotMeta, khypeToHype: null, time: 0 }), "HYPE"), null, "a zero mid is not a price");
  });

  it("prices mainnet HyperCore balances by token index", () => {
    assert.equal(priceMainnetToken(table, 0)?.usd, 1);
    assert.equal(priceMainnetToken(table, 150)?.coin, "@107");
    assert.equal(priceMainnetToken(table, 121)?.basis, "lst-rate");
    assert.equal(priceMainnetToken(table, 197)?.coin, "@142");
    assert.equal(priceMainnetToken(table, 424_242), null);
  });

  it("maps holdings to their economic underlying", () => {
    assert.equal(underlyingOf("kHYPE"), "HYPE");
    assert.equal(underlyingOf("WHYPE"), "HYPE");
    assert.equal(underlyingOf("UBTC"), "BTC");
    assert.equal(underlyingOf("USDT0"), "USD");
    assert.equal(underlyingOf("kPEPE"), "kPEPE");
    assert.ok(isCashUnderlying("USD") && !isCashUnderlying("HYPE"));
  });

  it("reads the StakingAccountant address from the core protocol registry", () => {
    assert.equal(khypeAccountantAddress(), "0x9209648Ec9D448EF57116B73A2f081835643dc7A");
  });
});

describe("ReferencePriceService", () => {
  it("caches the table, rereads after the TTL and serves a stale table when mainnet fails", async () => {
    const clock = new ManualClock(1_000_000);
    let calls = 0;
    let fail = false;
    const info = {
      allMids: async () => {
        calls += 1;
        if (fail) throw new Error("down");
        return mids;
      },
      spotMeta: async () => spotMeta,
    };
    const service = new ReferencePriceService({ info: () => info as never, khypeRate: async () => 1.02, clock, ttlMs: 5_000 });
    const first = await service.table();
    assert.equal(first.stale, false);
    assert.equal(first.value.khypeToHype, 1.02);
    await service.table();
    assert.equal(calls, 1, "served from cache inside the TTL");
    clock.advance(6_000);
    fail = true;
    const stale = await service.table();
    assert.equal(stale.stale, true);
    assert.equal(stale.value.time, 1_000_000);
  });

  it("a failing kHYPE rate read leaves the rate null instead of failing the table", async () => {
    const info = { allMids: async () => mids, spotMeta: async () => spotMeta };
    const service = new ReferencePriceService({
      info: () => info as never,
      khypeRate: async () => {
        throw new Error("rpc down");
      },
      clock: new ManualClock(),
    });
    assert.equal((await service.table()).value.khypeToHype, null);
  });
});
