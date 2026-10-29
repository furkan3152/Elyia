import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { campBulletin, isMuted, parseMutes } from "../camp";
import { luminance, readTelegram } from "../telegram";

const links = { intent: (s: string) => `/app?intent=${encodeURIComponent(s)}`, trade: (c: string) => `/app/trade/${c}` };
const rope = (coin: string, distance: number | null, sl: unknown = null, dex = "") => ({ coin, dex, side: "long" as const, leverage: 5, distance, liquidationPx: 100, sl: sl as null, positionValue: 1000 });

describe("base-camp bulletin", () => {
  it("leads with the fraying rope, then a missing anchor, then calm", () => {
    const fray = campBulletin([rope("ETH", 0.3), rope("BTC", 0.06)], links);
    assert.equal(fray.tone, "alert");
    assert.match(fray.title, /BTC 5×/u);
    assert.ok(fray.actions[0]!.href!.includes("close%20half%20my%20BTC"));
    assert.equal(campBulletin([rope("ETH", 0.3)], links).tone, "caution");
    assert.equal(campBulletin([rope("ETH", 0.3, { px: 90 })], links).tone, "calm");
    assert.equal(campBulletin([], links).title, "All quiet on the range");
  });

  it("keeps the HIP-3 dex in the terminal link", () => {
    const bulletin = campBulletin([rope("SPX", 0.05, null, "xyz")], links);
    assert.equal(bulletin.actions[1]!.href, "/app/trade/xyz:SPX");
  });

  it("mutes per situation and drops expired mutes", () => {
    const mutes = parseMutes(JSON.stringify({ a: 2_000, b: 500, c: "x" }), 1_000);
    assert.deepEqual(mutes, { a: 2_000 });
    assert.equal(isMuted(mutes, "a", 1_500), true);
    assert.equal(isMuted(mutes, "a", 2_500), false);
    assert.deepEqual(parseMutes("{broken", 0), {});
  });
});

describe("telegram bridge", () => {
  it("is absent outside Telegram and never throws", () => {
    assert.equal(readTelegram(undefined).inside, false);
    assert.equal(readTelegram({}).app, null);
    const hostile = { get Telegram(): unknown { throw new Error("no"); } };
    assert.equal(readTelegram(hostile).inside, false);
  });

  it("reads the scheme, the start address and the name", () => {
    const ctx = readTelegram({ Telegram: { WebApp: { platform: "ios", colorScheme: "dark", initDataUnsafe: { start_param: "as_0xDC0054D9962FB4ADF760F669DC3E02C07AA5AF95", user: { first_name: "Ada" } } } } });
    assert.equal(ctx.inside, true);
    assert.equal(ctx.scheme, "night");
    assert.equal(ctx.startAddress, "0xdc0054d9962fb4adf760f669dc3e02c07aa5af95");
    assert.equal(ctx.firstName, "Ada");
    assert.equal(readTelegram({ Telegram: { WebApp: { platform: "web", themeParams: { bg_color: "#ffffff" } } } }).scheme, "day");
    assert.equal(readTelegram({ Telegram: { WebApp: { platform: "unknown", initDataUnsafe: { start_param: "as_nope" } } } }).startAddress, null);
  });

  it("measures luminance", () => {
    assert.equal(luminance("#000000"), 0);
    assert.ok(Math.abs(luminance("#ffffff")! - 1) < 1e-9);
    assert.equal(luminance("red"), null);
  });
});
