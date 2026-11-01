/**
 * The discovery pages against REAL API responses (captured from a live API
 * on 2026-11-01: GET /v1/protocols/live on Elysium testnet and mainnet,
 * /v1/discovery/launches, /v1/elysium/stats), trimmed to a few rows.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ElysiumStatsResponse, LaunchesResponse, LaunchView, ProtocolLiveResponse } from "@elyia/core/api/discovery";

import { launchKindWord, launchOf, liveRead, liveSummary, mergeLive, statLines, statusOf, withLaunch, withStatus } from "../discoveryModel";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;

const liveTest = fixture<ProtocolLiveResponse>("protocols-live-elysium-testnet.json");
const liveMain = fixture<ProtocolLiveResponse>("protocols-live-elysium-mainnet.json");
const launches = fixture<LaunchesResponse>("launches.json");
const stats = fixture<ElysiumStatsResponse>("elysium-stats.json");

describe("discovery: real responses", () => {
  it("an Elysium without RPC (head null, rows unread) never hides the testnet's reading", () => {
    assert.equal(liveRead(liveMain), false);
    assert.equal(liveRead(liveTest), true);
    const merged = mergeLive([liveMain, liveTest]);
    // The canonical bridge is listed on both; mainnet answered "unknown", testnet read it active.
    assert.equal(merged.get("elysium-canonical-bridge")?.active, true);
    assert.equal(merged.get("cheshire")?.present, 4);
    assert.equal(merged.has("elyspump"), false, "unread mainnet rows are left out");
    assert.match(liveSummary(liveMain), /^elysium-mainnet: not read \(Elysium has no RPC endpoint/u);
    assert.match(liveSummary(liveTest), /^elysium-testnet: 457\/457 contracts present, 32 active in the last 2,000 blocks$/u);
  });

  it("streamed launches fold into the listing: deduped, newest first, capped", () => {
    const first = launches.launches[0]!;
    const fresh: LaunchView = { ...first, id: "elysium-testnet:0xabc:1", blockNumber: first.blockNumber + 10, logIndex: 1 };
    const folded = withLaunch(launches, fresh, 3);
    assert.equal(folded.launches[0]!.id, fresh.id);
    assert.equal(folded.launches.length, 3);
    assert.equal(folded.scannedThrough, first.blockNumber + 10);
    assert.equal(withLaunch(folded, fresh, 3).launches.filter((item) => item.id === fresh.id).length, 1);
    assert.equal(withLaunch(launches, { ...fresh, network: "elysium-mainnet" }).launches.length, launches.launches.length, "another network's launch is ignored");
    const { launches: _rows, ...status } = { ...launches, scannedThrough: (launches.scannedThrough ?? 0) + 99 };
    assert.equal(withStatus(launches, status).scannedThrough, (launches.scannedThrough ?? 0) + 99);
    assert.equal(withStatus(launches, status).launches.length, launches.launches.length);
  });

  it("validates stream events and names launch kinds", () => {
    assert.deepEqual(launchOf(launches.launches[0]), launches.launches[0]);
    assert.equal(launchOf({ id: "x" }), null);
    const { launches: _rows, ...status } = launches;
    assert.deepEqual(statusOf(JSON.parse(JSON.stringify(status))), status);
    assert.equal(statusOf({ network: "elysium-testnet" }), null);
    assert.equal(launchKindWord("launchpad-event"), "launchpad token");
    assert.equal(launchKindWord("v4-pool"), "new V4 pool");
  });

  it("prints every stat with its basis (measured / estimate / registry)", () => {
    const lines = statLines(stats);
    const byId = new Map([...lines.chain, ...lines.ecosystem, ...lines.activity].map((line) => [line.id, line]));
    assert.equal(byId.get("head")?.value, "20,489,395");
    assert.equal(byId.get("head")?.basis, "measured");
    assert.equal(byId.get("blockTime")?.value, "196 ms");
    assert.equal(byId.get("tps")?.value, "8.91");
    assert.equal(byId.get("blocksPerDay")?.basis, "estimate");
    assert.equal(byId.get("blocksPerDay")?.value, "~440,143");
    assert.equal(byId.get("txPerDay")?.basis, "estimate");
    assert.equal(byId.get("protocols")?.basis, "registry");
    assert.equal(byId.get("executable")?.value, "12");
    assert.equal(byId.get("launches")?.basis, "measured");
    const unmeasured = statLines({ ...stats, chain: { ...stats.chain, tps: { value: null, basis: "measured", source: "pulse warming up" } } });
    assert.equal(unmeasured.chain.find((line) => line.id === "tps")?.value, "—");
  });
});
