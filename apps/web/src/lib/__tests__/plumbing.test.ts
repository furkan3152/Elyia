import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, describeError, errorFromResponse, parseRetryAfter } from "../apiErrors";
import { backoffDelay } from "../backoff";
import { DEFAULT_API_URL, resolveApiBase } from "../config";
import { DEMO_MARKETS, hottestMarkets, marketStrings, parseMarketRow, parseMarkets } from "../markets";

describe("API base", () => {
  it("accepts origins only", () => {
    assert.deepEqual(resolveApiBase(undefined), { base: DEFAULT_API_URL, warning: null });
    assert.deepEqual(resolveApiBase("https://api.elyia.xyz"), { base: "https://api.elyia.xyz", warning: null });
    assert.deepEqual(resolveApiBase("https://api.elyia.xyz/"), { base: "https://api.elyia.xyz", warning: null });
    for (const bad of ["https://api.elyia.xyz/v1", "ftp://x.y", "https://u:p@x.y", "not a url", "https://x.y/?a=1"]) {
      const result = resolveApiBase(bad);
      assert.equal(result.base, DEFAULT_API_URL, bad);
      assert.ok(result.warning, bad);
    }
  });
});

describe("API errors", () => {
  it("reads the error envelope", () => {
    const error = errorFromResponse(503, { error: { code: "PULSE_UNAVAILABLE", message: "Warming up.", details: { network: "elysium-testnet" }, requestId: "req_1" } }, "2");
    assert.equal(error.code, "PULSE_UNAVAILABLE");
    assert.equal(error.status, 503);
    assert.equal(error.requestId, "req_1");
    assert.deepEqual(error.details, { network: "elysium-testnet" });
    assert.equal(error.retryAfterMs, 2_000);
    assert.equal(error.retryable, true);
  });

  it("falls back to plain words for bodies without an envelope", () => {
    const error = errorFromResponse(404, "<html>nope</html>");
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.message, "Not found.");
    assert.equal(error.retryable, false);
    assert.equal(errorFromResponse(599, null).message, "The Elyia API had a problem. Try again shortly.");
  });

  it("parses Retry-After seconds and dates", () => {
    assert.equal(parseRetryAfter("5"), 5_000);
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
    assert.equal(parseRetryAfter("soon"), null);
    assert.equal(parseRetryAfter(null), null);
  });

  it("describes any thrown value", () => {
    assert.equal(describeError(new ApiError({ code: "TIMEOUT", message: "Too slow." })), "Too slow.");
    assert.equal(describeError("x"), "Something went wrong.");
  });
});

describe("backoff", () => {
  it("grows exponentially with jitter inside the bounds", () => {
    assert.equal(backoffDelay(1, { baseMs: 1_000 }, () => 1), 1_000);
    assert.equal(backoffDelay(3, { baseMs: 1_000 }, () => 1), 4_000);
    assert.equal(backoffDelay(3, { baseMs: 1_000 }, () => 0), 2_000);
    assert.equal(backoffDelay(50, { baseMs: 1_000, maxMs: 30_000 }, () => 1), 30_000);
    assert.equal(backoffDelay(1, { baseMs: 100, minMs: 250 }, () => 0), 250);
  });
});

describe("markets", () => {
  it("reads HyperCore-style and summary-style rows", () => {
    assert.deepEqual(parseMarketRow({ name: "ETH", ctx: { dayNtlVlm: "980000000", markPx: "2500", prevDayPx: "2000" } }), { coin: "ETH", volumeUsd: 980_000_000, change: 0.25, markPx: 2500 });
    assert.deepEqual(parseMarketRow({ coin: "HYPE", volume24hUsd: 4e8, change24hPct: 4.2, markPx: 41.8 }), { coin: "HYPE", volumeUsd: 4e8, change: 0.042, markPx: 41.8 });
    assert.equal(parseMarketRow({ coin: "X" }), null);
    assert.equal(parseMarketRow({ coin: "<script>", volume: 1 }), null);
  });

  it("accepts the response shapes and de-duplicates", () => {
    const body = { perps: [{ coin: "BTC", volume24h: 2 }, { coin: "BTC", volume24h: 1 }], markets: [{ coin: "SOL", volume24h: 3 }] };
    assert.deepEqual(parseMarkets(body).map((m) => m.coin), ["BTC", "SOL"]);
    assert.deepEqual(parseMarkets([{ coin: "A", volume: 1 }]).map((m) => m.coin), ["A"]);
    assert.deepEqual(parseMarkets("nope"), []);
  });

  it("ranks by volume and maps to strings", () => {
    const top = hottestMarkets(DEMO_MARKETS, 3);
    assert.deepEqual(top.map((m) => m.coin), ["BTC", "ETH", "HYPE"]);
    const strings = marketStrings(top);
    assert.equal(strings[0]!.thickness, 1);
    assert.equal(strings[1]!.tint, "rose");
    assert.equal(strings[2]!.tint, "mint");
    assert.ok(strings.every((s) => s.amplitude >= 0 && s.amplitude <= 1));
    assert.equal(marketStrings([{ coin: "FARTCOIN", volumeUsd: 1, change: null, markPx: null }])[0]!.label, "FARTC");
  });
});
