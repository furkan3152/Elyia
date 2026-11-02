import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_KEY_QUOTAS, MAX_INTEGRATOR_FEE_BPS } from "@elyia/core/api/developers";

import { devAccess } from "../access";
import { readFileSync } from "node:fs";

import { quickstartSnippet } from "../devModel";
import { bpsToPercent, clampBps, dailySeries, deliveryLine, feeDisclosure, feeOn, maskedKey, mcpSnippet, relativeTime, scopeChips, scrambleKey, shortEvent, sortKeys, steppedBarHeight, usageMeters, webhookUrlProblem } from "../devModel";
import { consoleJson, formatUnits, integratorFeeUsd, planAccount, userCard } from "../playgroundModel";
import { countRoutes, REST } from "../reference";
import { sampleUsage } from "../sample";

const NOW = Date.parse("2026-11-01T12:00:00Z");

describe("keys", () => {
  it("masks, labels scopes and sorts revoked keys last", () => {
    assert.equal(maskedKey({ last4: "x2Pa" }), "ely_••••••x2Pa");
    assert.deepEqual(scopeChips(["read", "plan", "execute-prepare", "webhooks"]), ["all 4"]);
    assert.deepEqual(scopeChips(["read", "execute-prepare"]), ["read", "prepare"]);
    const keys = sortKeys([
      { createdAt: "2026-10-01T00:00:00Z", revokedAt: "2026-10-12T00:00:00Z" },
      { createdAt: "2026-09-01T00:00:00Z", revokedAt: null },
      { createdAt: "2026-10-20T00:00:00Z", revokedAt: null },
    ]);
    assert.deepEqual(keys.map((key) => key.createdAt.slice(5, 7)), ["10", "09", "10"]);
    assert.equal(keys[2]!.revokedAt !== null, true);
  });
  it("scrambles the shown-once key into place, prefix first, exact at the end", () => {
    const key = "ely_abcdefghij";
    assert.equal(scrambleKey(key, 0, 3).slice(0, 4), "ely_");
    assert.notEqual(scrambleKey(key, 0, 3), key);
    assert.equal(scrambleKey(key, 0.5, 3).slice(0, 9), "ely_abcde");
    assert.equal(scrambleKey(key, 1, 99), key);
    assert.equal(scrambleKey(key, 0.2, 1).length, key.length);
  });
  it("says relative times in words", () => {
    assert.equal(relativeTime(new Date(NOW - 120_000).toISOString(), NOW), "2 min");
    assert.equal(relativeTime(new Date(NOW - 3_700_000).toISOString(), NOW), "1 h");
    assert.equal(relativeTime("2026-10-12T00:00:00Z", NOW), "Oct 12");
    assert.equal(relativeTime(null, NOW), "never");
  });
});

describe("usage", () => {
  it("sums days against daily quotas and marks near-quota meters in words", () => {
    const meters = usageMeters(sampleUsage(NOW), 1);
    assert.deepEqual(meters.map((m) => [m.metric, m.used, m.quota]), [["requests", 12_480, DEFAULT_KEY_QUOTAS.requestsPerDay], ["plans", 1_204, DEFAULT_KEY_QUOTAS.plansPerDay], ["prepares", 1_620, DEFAULT_KEY_QUOTAS.preparesPerDay]]);
    assert.deepEqual(meters.map((m) => m.hot), [false, false, true]);
    const week = usageMeters(sampleUsage(NOW), 7);
    assert.equal(week[0]!.quota, DEFAULT_KEY_QUOTAS.requestsPerDay * 7);
    assert.deepEqual(usageMeters({ keys: [] }, 1).map((m) => m.fraction), [0, 0, 0]);
  });
  it("orders daily series oldest first and grows bars in 4 steps", () => {
    const series = dailySeries(sampleUsage(NOW), 14);
    assert.equal(series.length, 14);
    assert.ok(series[0]!.day < series[13]!.day);
    assert.equal(series[13]!.value, 1_204);
    assert.equal(steppedBarHeight(80, 80, 20, 0), 0);
    assert.equal(steppedBarHeight(80, 80, 20, 0.3), 5);
    assert.equal(steppedBarHeight(80, 80, 20, 0.6), 10);
    assert.equal(steppedBarHeight(80, 80, 20, 1), 20);
    assert.equal(steppedBarHeight(1, 1000, 20, 1), 1);
  });
});

describe("integrator fee", () => {
  it("clamps to the API cap and previews the disclosure", () => {
    assert.equal(clampBps(80, MAX_INTEGRATOR_FEE_BPS), 50);
    assert.equal(clampBps(-3, MAX_INTEGRATOR_FEE_BPS), 0);
    assert.equal(clampBps(Number.NaN, MAX_INTEGRATOR_FEE_BPS), 0);
    assert.equal(bpsToPercent(15), "0.15%");
    assert.equal(feeDisclosure(15, "Acme Wallet"), "Includes 0.15% to Acme Wallet");
    assert.equal(feeDisclosure(0, "Acme Wallet"), "No integrator fee.");
    assert.match(feeDisclosure(30, null), /0\.30% integrator fee/u);
    assert.equal(feeOn(1540, 15), 2.31);
    assert.equal(integratorFeeUsd({ feeUsd: 1540 }, 15), 2.31);
    assert.equal(integratorFeeUsd({ feeUsd: null }, 15), null);
  });
});

describe("webhooks", () => {
  it("words every delivery state (never colour alone)", () => {
    assert.deepEqual(deliveryLine({ status: "delivered", httpStatus: 200, durationMs: 84, attempt: 1, error: null }), { text: "200 · 84 ms", tone: "up" });
    assert.deepEqual(deliveryLine({ status: "retrying", httpStatus: 503, durationMs: 9, attempt: 2, error: null }), { text: "retry 2 · 503", tone: "warn" });
    assert.deepEqual(deliveryLine({ status: "failed", httpStatus: null, durationMs: null, attempt: 5, error: "timeout" }), { text: "failed · timeout", tone: "dn" });
    assert.equal(shortEvent("intent.step.settled"), "step.settled");
    assert.equal(shortEvent("intent.failed"), "intent.failed");
  });
  it("accepts https receivers only (localhost while developing)", () => {
    assert.equal(webhookUrlProblem("https://acme.app/hooks"), null);
    // The API refuses these (public HTTPS only), so the form must too.
    for (const local of ["http://localhost:3000/h", "http://127.0.0.1:9911/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.8/h", "https://192.168.1.2/h", "https://169.254.169.254/latest", "https://[::1]/h", "https://box.local/h"]) {
      assert.ok(webhookUrlProblem(local), local);
    }
    assert.equal(webhookUrlProblem("https://8.8.8.8/h"), null);
    assert.ok(webhookUrlProblem("http://acme.app/h"));
    assert.ok(webhookUrlProblem("https://u:p@acme.app/h"));
    assert.ok(webhookUrlProblem("acme"));
  });
});

describe("playground and snippets", () => {
  it("formats base units", () => {
    assert.equal(formatUnits("1412080000", 6), "1,412.08");
    assert.equal(formatUnits("50000000000000000000", 18), "50");
    assert.equal(formatUnits("5", 6), "0");
    assert.equal(formatUnits("5", 6, 6), "0.000005");
    assert.equal(formatUnits("abc", 6), "abc");
  });
  it("builds the user card from a plan, or from a reading, or nothing", () => {
    const plan = {
      intent: { steps: [{ title: "Swap HYPE → USDC", network: "elysium-testnet" }], summary: { title: "Swap 50 HYPE → USDC", inputs: [{ expected: "50000000000000000000", decimals: 18, symbol: "HYPE", usd: "1540" }], outputs: [{ expected: "1412080000", decimals: 6, symbol: "USDC" }] } },
      quotes: [{ protocol: "kalos-v3", winner: true }, { protocol: "hexswap", winner: false }, { protocol: "perpme", winner: false, excluded: "slow" }],
    };
    const card = userCard(null, plan as never)!;
    assert.equal(card.where, "Summit · 1 camp");
    assert.equal(card.send, "50 HYPE");
    assert.equal(card.get, "1,412.08 USDC");
    assert.equal(card.venue, "kalos-v3 · 1 of 2");
    assert.equal(card.feeUsd, 1540);
    const reading = userCard({ status: "ready", canonical: "swap 50 HYPE to USDC on elysium", goals: [{ t: "value", goal: { kind: "swap" } }] } as never, null)!;
    assert.equal(reading.priced, false);
    assert.equal(reading.title, "swap 50 HYPE to USDC on elysium");
    assert.equal(userCard({ status: "unreadable", canonical: null, goals: [] } as never, null), null);
    assert.equal(planAccount("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"), "eip155:99801:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    assert.equal(planAccount("nope"), null);
    assert.match(consoleJson({ a: "x".repeat(50) }, 20), /more characters/u);
  });
  it("prints the MCP config as valid JSON against the API base", () => {
    const config = JSON.parse(mcpSnippet("https://api.example.test")) as { mcpServers: { elyia: { url: string } } };
    assert.equal(config.mcpServers.elyia.url, "https://api.example.test/v1/mcp");
  });
  it("lists every route once and reads access from the roles", () => {
    assert.equal(countRoutes(), REST.reduce((sum, group) => sum + group.rows.length, 0));
    assert.equal(new Set(REST.flatMap((group) => group.rows.map((row) => row.path))).size, countRoutes());
    assert.equal(devAccess(null), "anonymous");
    assert.equal(devAccess({ roles: ["user"] }), "user");
    assert.equal(devAccess({ roles: ["user", "developer"] }), "developer");
  });
});

describe("quickstart", () => {
  it("uses @elyia/sdk, and only methods the client has", () => {
    const snippet = quickstartSnippet("http://localhost:3001");
    assert.match(snippet, /import \{ ElyiaClient \} from "@elyia\/sdk";/u);
    assert.match(snippet, /baseUrl: "http:\/\/localhost:3001"/u);
    assert.ok(!/fetch\(/u.test(snippet), "no hand-rolled fetch");
    const source = readFileSync(new URL("../../../../../../packages/sdk/src/index.ts", import.meta.url), "utf8");
    const used = [...snippet.matchAll(/elyia\.([a-zA-Z]+)\(/gu)].map((match) => match[1]!);
    assert.deepEqual([...new Set(used)], ["plan", "prepare", "submit", "journeyStream"]);
    for (const method of used) assert.match(source, new RegExp(`^  (?:async \\*)?${method}\\(`, "mu"), method);
    assert.match(snippet, /wallet\.sendTransaction/u, "the user's wallet signs");
  });
});

describe("portal sub-views", async () => {
  const { hashTarget, neighbours, viewForHash } = await import("../portal/views");
  const views = ["overview", "playground", "sdk", "keys", "webhooks", "rest"];
  const items = [
    { id: "overview", view: "overview" },
    { id: "ways", view: "overview" },
    { id: "mcp", view: "sdk" },
    { id: "usage", view: "keys" },
    { id: "widget", view: "webhooks" },
    { id: "fee", view: "webhooks" },
    { id: "changelog", view: "rest" },
  ];
  it("opens the view holding a deep-linked section, and the first view otherwise", () => {
    assert.deepEqual(viewForHash("#fee", items, views), { view: "webhooks", section: "fee" });
    assert.deepEqual(viewForHash("#mcp", items, views), { view: "sdk", section: "mcp" });
    assert.deepEqual(viewForHash("#keys", items, views), { view: "keys", section: null });
    assert.deepEqual(viewForHash("", items, views), { view: "overview", section: null });
    assert.deepEqual(viewForHash("#nope", items, views), { view: "overview", section: null });
    assert.deepEqual(viewForHash("#<script>", items, views), { view: "overview", section: null });
    assert.equal(hashTarget("#Changelog"), null);
    assert.equal(hashTarget("#changelog"), "changelog");
  });
  it("links each view to its neighbours", () => {
    assert.deepEqual(neighbours("overview", views), { previous: null, next: "playground" });
    assert.deepEqual(neighbours("keys", views), { previous: "sdk", next: "webhooks" });
    assert.deepEqual(neighbours("rest", views), { previous: "webhooks", next: null });
  });
});
