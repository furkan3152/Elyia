import assert from "node:assert/strict";
import { test } from "node:test";

import { depositableVaults, formatApr, formatTvl, rankYields, stakingRate, trailScore, vaultFromDump, yieldPeaks, type YieldRow } from "../yields";

const row = (id: string, aprPct: number | null, tvlUsd: number | null): YieldRow => ({ id, name: id, kind: "vault", layer: "floor", aprPct, tvlUsd, asset: "USDC", entry: "external", note: "" });

test("staking: stake-weighted weekly APR of active, unjailed validators", () => {
  const week = (apr: string) => [["day", { predictedApr: "9", uptimeFraction: "1" }], ["week", { predictedApr: apr, uptimeFraction: "1" }]] as const;
  const rate = stakingRate([
    { validator: "a", name: "a", stake: 3e8, isJailed: false, isActive: true, commission: "0.05", stats: week("0.02") },
    { validator: "b", name: "b", stake: 1e8, isJailed: false, isActive: true, commission: "0.05", stats: week("0.04") },
    { validator: "c", name: "c", stake: 9e8, isJailed: true, isActive: true, commission: "0.05", stats: week("0.5") },
  ]);
  assert.equal(rate.validators, 2);
  assert.equal(rate.stakedHype, 4);
  assert.ok(Math.abs(rate.aprPct! - 2.5) < 1e-9);
  assert.equal(stakingRate([]).aprPct, null);
});

test("ranking: thin pools cannot outrank deep ones on APR alone", () => {
  assert.ok(trailScore(row("hlp", 4.8, 117e6)) > trailScore(row("tiny", 40, 5e3)));
  assert.ok(trailScore(row("mid", 20, 1e6)) > trailScore(row("hlp", 4.8, 117e6)));
  assert.equal(trailScore(row("x", null, 1e9)), Number.NEGATIVE_INFINITY);
  assert.deepEqual(rankYields([row("tiny", 40, 5e3), row("hlp", 4.8, 117e6), row("none", null, 1e6)]).map((item) => item.id), ["hlp", "tiny", "none"]);
});

test("vaults: dump rows convert, children and closed vaults drop out", () => {
  const vault = vaultFromDump({ apr: 0.048, summary: { name: "HLP", vaultAddress: "0xa", leader: "0xb", tvl: "116984463.1", isClosed: false, relationship: { type: "parent" } } });
  assert.equal(vault.aprPct, 4.8);
  assert.equal(vault.tvlUsd, 116984463.1);
  const child = { ...vault, address: "0xc", relationship: "child" };
  const closed = { ...vault, address: "0xd", isClosed: true };
  const small = { ...vault, address: "0xe", tvlUsd: 50 };
  assert.deepEqual(depositableVaults([child, closed, small, vault]).map((item) => item.address), ["0xa"]);
});

test("yield range: peaks rise with APR, basins sink, formats read", () => {
  const peaks = yieldPeaks([row("a", 50, 1e6), row("b", 5, 1e6), row("c", -2, 1e4)], 900, 320, 236);
  assert.ok(peaks[0]!.top < peaks[1]!.top);
  assert.equal(peaks[2]!.basin, true);
  assert.ok(peaks[2]!.top > 236);
  assert.equal(formatApr(-0.84), "−0.84%");
  assert.equal(formatApr(182.6), "183%");
  assert.equal(formatTvl(117e6), "$117.0M");
  assert.equal(formatTvl(null), "—");
});
