import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClearinghouseState } from "@elyia/core/hypercore/info";
import { parseVaultDump } from "../vaults.js";
import { liquidationMap, parseLeaderboard, positionsOf, type SweptPosition } from "../whales.js";
import { fixture } from "./fakes.js";

describe("leaderboard and vault dumps (recorded testnet stats-data)", () => {
  it("keeps the top accounts by account value with valid addresses", () => {
    const rows = parseLeaderboard(fixture("testnet-leaderboard.json"), 3);
    assert.equal(rows.length, 3);
    assert.ok(rows[0] && rows[1] && rows[0].accountValue >= rows[1].accountValue);
    assert.ok(rows.every((row) => /^0x[0-9a-f]{40}$/u.test(row.address)));
    assert.deepEqual(parseLeaderboard({ leaderboardRows: [{ ethAddress: "nope", accountValue: "5" }, { ethAddress: "0x0000000000000000000000000000000000000001", accountValue: "-1" }] }, 5), []);
  });

  it("parses vaults largest TVL first with APR in percent", () => {
    const rows = parseVaultDump(fixture("testnet-vaults-dump.json"));
    assert.equal(rows[0]?.name, "Hyperliquidity Provider (HLP)");
    assert.equal(rows[0]?.address, "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0");
    assert.equal(rows[0]?.relationship, "parent");
    assert.ok(rows.some((row) => row.isClosed));
    const raw = fixture<Array<{ apr: number; summary: { vaultAddress: string } }>>("testnet-vaults-dump.json");
    const hlp = raw.find((entry) => entry.summary.vaultAddress === rows[0]?.address);
    assert.ok(Math.abs((rows[0]?.aprPct ?? 0) - (hlp?.apr ?? 0) * 100) < 1e-3);
    for (let index = 1; index < rows.length; index += 1) assert.ok((rows[index - 1]?.tvlUsd ?? 0) >= (rows[index]?.tvlUsd ?? 0));
    assert.deepEqual(parseVaultDump({ not: "an array" }), []);
  });
});

describe("liquidation map", () => {
  const state = fixture<ClearinghouseState>("testnet-clearinghouse-cross.json");
  const entry = { address: "0x4547b9e33f07965711f67d0be2423939a4e33af5", accountValue: 1, displayName: null };

  it("reads positions from a recorded cross-margin account", () => {
    const positions = positionsOf(entry, state);
    assert.equal(positions.length, state.assetPositions.length);
    const sol = positions.find((position) => position.coin === "SOL");
    assert.ok(sol && sol.szi < 0, "the recorded SOL position is a short");
    assert.equal(sol.liquidationPx, state.assetPositions.find((asset) => asset.position.coin === "SOL")?.position.liquidationPx);
  });

  const base = { displayName: null, entryPx: "100", unrealizedPnl: 0, leverage: { type: "cross" as const, value: 5 } };
  const synthetic: SweptPosition[] = [
    { ...base, address: "0x01", coin: "HYPE", szi: 10, positionValue: 1_000, liquidationPx: "79" },
    { ...base, address: "0x02", coin: "HYPE", szi: 30, positionValue: 3_000, liquidationPx: "80" },
    { ...base, address: "0x03", coin: "HYPE", szi: 5, positionValue: 500, liquidationPx: "60" },
    { ...base, address: "0x04", coin: "HYPE", szi: -20, positionValue: 2_000, liquidationPx: "121" },
    { ...base, address: "0x05", coin: "HYPE", szi: -1, positionValue: 100, liquidationPx: null },
    { ...base, address: "0x06", coin: "HYPE", szi: 2, positionValue: 200, liquidationPx: "150" },
    { ...base, address: "0x07", coin: "BTC", szi: 1, positionValue: 80_000, liquidationPx: "1" },
  ];

  it("buckets liquidations by distance from mark, notional-weighted, nearest first", () => {
    const map = liquidationMap({ coin: "HYPE", mark: 100, positions: synthetic, bucketPct: 5, minNotionalUsd: 0, limit: 10 });
    assert.equal(map.accountsWithPosition, 6);
    assert.equal(map.longNotionalUsd, 4_700);
    assert.equal(map.shortNotionalUsd, 2_100);
    assert.deepEqual(map.longLiquidations, [
      { px: 79.75, distancePct: -20.25, notionalUsd: 4_000, positions: 2 },
      { px: 60, distancePct: -40, notionalUsd: 500, positions: 1 },
    ]);
    assert.deepEqual(map.shortLiquidations, [{ px: 121, distancePct: 21, notionalUsd: 2_000, positions: 1 }]);
    // A long whose liquidation is above mark (already past it) is not a level ahead.
    assert.ok(!map.longLiquidations.some((level) => level.px === 150));
    assert.equal(map.positions[0]?.notionalUsd, 3_000);
    assert.equal(map.positions.find((position) => position.address === "0x04")?.liquidationDistancePct, 21);
  });

  it("filters small levels and works without a mark", () => {
    const filtered = liquidationMap({ coin: "HYPE", mark: 100, positions: synthetic, bucketPct: 5, minNotionalUsd: 1_000, limit: 2 });
    assert.equal(filtered.longLiquidations.length, 1);
    assert.equal(filtered.positions.length, 2);
    const blind = liquidationMap({ coin: "HYPE", mark: null, positions: synthetic, bucketPct: 1, minNotionalUsd: 0, limit: 10 });
    assert.deepEqual(blind.longLiquidations, []);
    assert.ok(blind.positions.every((position) => position.liquidationDistancePct === null));
  });
});
