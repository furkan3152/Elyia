import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { herdWeight, normalizeXHandle, parseXStatusUrl } from "@elyia/core/api/herd";
import type { IntentGraph } from "@elyia/core";
import { EMPTY_FACTS, foldIntent, scoreFromFacts, sybilFlags, volumePoints } from "../score.js";

const NOW = Date.parse("2026-11-01T12:00:00Z");

describe("herd score", () => {
  it("is 0 with no usage and 100 at every cap, never more", () => {
    assert.equal(scoreFromFacts(EMPTY_FACTS, NOW).score, 0);
    assert.equal(scoreFromFacts(EMPTY_FACTS, NOW).weight, 1);
    const whale = { ...EMPTY_FACTS, settled: 10_000, activeDays30: 30, activeDays60: 60, layers: ["floor", "ridge", "summit"], venues: Array.from({ length: 40 }, (_, i) => `v${i}`), crossLayer: 500, automationsOn: 12, volumeUsd: 1e12, developerRequests30: 1e6, developerKeys: 3, taskPoints: 10, taskPointsMax: 10 };
    const top = scoreFromFacts(whale, NOW);
    assert.equal(top.score, 100);
    assert.equal(top.weight, 5);
    for (const component of top.components) assert.ok(component.points <= component.max, component.key);
    assert.equal(top.components.reduce((sum, component) => sum + component.max, 0), 100);
  });

  it("scores a typical user transparently", () => {
    const facts = { ...EMPTY_FACTS, settled: 3, activeDays30: 2, activeDays60: 4, layers: ["summit"], venues: ["kalos-v3", "ely-router"], crossLayer: 0, automationsOn: 1, volumeUsd: 250, taskPoints: 7, taskPointsMax: 10 };
    const score = scoreFromFacts(facts, NOW);
    const points = Object.fromEntries(score.components.map((component) => [component.key, component.points]));
    assert.deepEqual(points, { routes: 7.5, days: 4, layers: 5, venues: 4, journeys: 0, automations: 2.5, volume: 4, developer: 0, tasks: 7 });
    assert.equal(score.score, 34);
    assert.equal(score.weight, herdWeight(34));
    assert.ok(score.components.every((component) => component.tip === null || component.tip.length > 0));
  });

  it("caps volume on a log scale", () => {
    assert.deepEqual([5, 10, 99, 100, 9_999, 10_000, 1e5, 1e9].map(volumePoints), [0, 2, 2, 4, 6, 8, 10, 10]);
  });

  it("weights 1 + score/25 up to 5×, and 0 while a high flag is not cleared", () => {
    assert.equal(herdWeight(0), 1);
    assert.equal(herdWeight(50), 3);
    assert.equal(herdWeight(100), 5);
    assert.equal(herdWeight(250), 5);
    const flags = sybilFlags({ nonce: 0, sharedIp: 7, sharedDevice: 0, handleReused: false, usage: EMPTY_FACTS, movedFrom: null });
    assert.ok(flags.some((flag) => flag.code === "shared-ip" && flag.severity === "high"));
    assert.ok(flags.some((flag) => flag.code === "fresh-wallet"));
    assert.equal(scoreFromFacts(EMPTY_FACTS, NOW, flags).weight, 0);
    assert.equal(scoreFromFacts(EMPTY_FACTS, NOW, flags, true).weight, 1);
  });

  it("folds settled intents into layers, venues, days and journeys per account", () => {
    const into = new Map();
    const base = { accounts: ["eip155:99801:0x00000000000000000000000000000000000000aa"], createdAt: "2026-10-30T10:00:00Z", status: "completed", summary: { inputs: [{ usd: "120.5" }] } };
    foldIntent(into, { ...base, steps: [{ network: "elysium-testnet", protocol: "kalos-v3", status: "settled" }, { network: "hyperevm-testnet", protocol: "bridge", status: "settled" }] } as unknown as IntentGraph);
    foldIntent(into, { ...base, status: "failed", steps: [{ network: "hypercore-testnet", protocol: "hl", status: "failed" }] } as unknown as IntentGraph);
    const facts = into.get("0x00000000000000000000000000000000000000aa");
    assert.equal(facts.settled, 1);
    assert.deepEqual([...facts.layers].sort(), ["ridge", "summit"]);
    assert.equal(facts.crossLayer, 1);
    assert.equal(facts.volumeUsd, 120.5);
  });

  it("normalises X handles and status links", () => {
    assert.equal(normalizeXHandle("@Ely_Goat"), "ely_goat");
    assert.equal(normalizeXHandle("https://x.com/Ely_Goat?s=1"), "ely_goat");
    assert.equal(normalizeXHandle("not a handle!"), null);
    assert.deepEqual(parseXStatusUrl("https://twitter.com/Ely_Goat/status/1234567890123"), { handle: "ely_goat", id: "1234567890123" });
    assert.equal(parseXStatusUrl("https://evil.com/x.com/a/status/123456"), null);
  });
});

describe("herd config placeholders", () => {
  it("keeps owner inputs null until set, and validates them", async () => {
    const { testConfig } = await import("../../../__tests__/support.js");
    const empty = testConfig();
    assert.equal(empty.herd.xProfileUrl, null);
    assert.deepEqual(empty.herd.engagementPostUrls, []);
    assert.equal(empty.herd.treasury, null);
    assert.equal(empty.herd.xApiBearer, null);
    const set = testConfig({ HERD_X_PROFILE_URL: "https://x.com/elyia", HERD_ENGAGEMENT_POST_URLS: "https://x.com/elyia/status/1,https://x.com/elyia/status/2", HERD_TREASURY_ADDRESS: "0x7000000000000000000000000000000000000007" });
    assert.equal(set.herd.engagementPostUrls.length, 2);
    assert.throws(() => testConfig({ HERD_X_PROFILE_URL: "https://evil.example/elyia" }), /HERD_X_PROFILE_URL/u);
    assert.throws(() => testConfig({ HERD_TREASURY_ADDRESS: "0x123" }), /HERD_TREASURY_ADDRESS/u);
  });
});
