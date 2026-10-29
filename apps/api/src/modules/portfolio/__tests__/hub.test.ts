import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { ElyiaHttpError } from "../../../http/errors.js";
import { waitFor } from "../../../__tests__/support.js";
import { PortfolioHub, snapshotDigest, type HubEvent } from "../hub.js";

function snapshot(netWorth: number, generatedAt: number): PortfolioSnapshot {
  return {
    address: "0x01",
    mode: "testnet",
    generatedAt,
    pricing: { source: "hypercore-mainnet-reference", label: "reference", time: generatedAt, khypeToHype: null },
    totals: { netWorthUsd: netWorth, byLayer: { hypercore: netWorth, hyperevm: 0, elysium: 0 }, unpricedLines: 0, unrealizedPnlUsd: 0, grossPerpNotionalUsd: 0 },
    layers: [],
    positions: [],
    accounts: [{ dex: "", collateral: "USDC", accountValue: netWorth, totalNotional: 0, totalMarginUsed: 0, crossAccountValue: netWorth, crossMaintenanceMarginUsed: 0, crossMarginRatioPct: 0, accountLeverage: 0, withdrawable: netWorth, time: generatedAt }],
    exposure: [],
    dexes: [],
    notes: [],
  };
}

describe("snapshot digest", () => {
  it("ignores read timestamps and changes with content", () => {
    assert.equal(snapshotDigest(snapshot(10, 1)), snapshotDigest(snapshot(10, 999)));
    assert.notEqual(snapshotDigest(snapshot(10, 1)), snapshotDigest(snapshot(11, 1)));
  });
});

describe("PortfolioHub", () => {
  function hub(values: number[], options: Partial<ConstructorParameters<typeof PortfolioHub>[0]> = {}) {
    let calls = 0;
    const instance = new PortfolioHub({
      load: async () => {
        const value = values[Math.min(calls, values.length - 1)] as number;
        calls += 1;
        if (Number.isNaN(value)) throw new ElyiaHttpError("PROVIDER_RATE_LIMITED", 503, "limited");
        return snapshot(value, calls);
      },
      now: () => 0,
      baseIntervalMs: 10,
      // A huge budget keeps the interval at the base in these timing tests.
      weightPerMinute: 1_000_000_000,
      idleMs: 20,
      ...options,
    });
    return { instance, calls: () => calls };
  }

  it("publishes snapshot on change, unchanged otherwise, with one loop per address", async () => {
    const { instance, calls } = hub([1, 1, 2, 2]);
    const a: HubEvent[] = [];
    const b: HubEvent[] = [];
    const offA = instance.subscribe("0x01", "testnet", (event) => a.push(event));
    const offB = instance.subscribe("0x01", "testnet", (event) => b.push(event));
    await waitFor(() => a.length >= 4);
    assert.equal(instance.size, 1, "both listeners share one loop");
    assert.deepEqual(a.slice(0, 4).map((event) => event.type), ["snapshot", "unchanged", "snapshot", "unchanged"]);
    assert.deepEqual(a.filter((event) => event.type === "snapshot").map((event) => (event.type === "snapshot" ? event.payload.seq : 0)), [1, 2]);
    assert.ok(b.length >= 4);
    const loads = calls();
    assert.ok(loads <= a.length + 1, "one load per published event, not per listener");
    offA();
    offB();
    offB();
    await waitFor(() => instance.size === 0, 1_000);
    const after = calls();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(calls(), after, "the loop stops once idle");
  });

  it("gives a late listener the last snapshot at once", async () => {
    const { instance } = hub([5]);
    const first: HubEvent[] = [];
    const off = instance.subscribe("0x01", "testnet", (event) => first.push(event));
    await waitFor(() => first.length >= 1);
    const late: HubEvent[] = [];
    const offLate = instance.subscribe("0x01", "testnet", (event) => late.push(event));
    await waitFor(() => late.length >= 1);
    assert.equal(late[0]?.type, "snapshot");
    off();
    offLate();
    instance.close();
  });

  it("reports refresh errors and keeps going", async () => {
    const { instance } = hub([Number.NaN, 3]);
    const events: HubEvent[] = [];
    const off = instance.subscribe("0x01", "testnet", (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "snapshot"));
    assert.deepEqual(events[0], { type: "error", payload: { code: "PROVIDER_RATE_LIMITED", message: "limited" } });
    off();
    instance.close();
  });

  it("skips a refresh when the shared REST budget is low", async () => {
    let remaining = 1_000;
    const { instance, calls } = hub([1, 2], { remainingWeight: () => remaining, reserveWeight: 200 });
    const events: HubEvent[] = [];
    const off = instance.subscribe("0x01", "testnet", (event) => events.push(event));
    await waitFor(() => events.length >= 1);
    remaining = 50;
    const before = calls();
    await waitFor(() => events.length >= 3);
    assert.equal(calls(), before, "no upstream load while the budget is low");
    assert.ok(events.slice(1).every((event) => event.type === "unchanged" && event.payload.stale));
    off();
    instance.close();
  });

  it("caps watched addresses and stretches the interval with load", () => {
    const { instance } = hub([1], { maxAddresses: 2, baseIntervalMs: 4_000, weightPerRefresh: 8, weightPerMinute: 300 });
    assert.equal(instance.intervalMs("testnet"), 4_000);
    const offs = [instance.subscribe("0x01", "testnet", () => undefined), instance.subscribe("0x02", "testnet", () => undefined)];
    assert.throws(() => instance.subscribe("0x03", "testnet", () => undefined), (error: unknown) => error instanceof ElyiaHttpError && error.code === "STREAM_CAPACITY" && error.status === 503);
    assert.doesNotThrow(() => instance.assertCapacity("0x01", "testnet"), "an address already watched always fits");
    assert.equal(instance.intervalMs("testnet"), 4_000);
    assert.equal(instance.intervalMs("mainnet"), 4_000);
    const many = new PortfolioHub({ load: async () => snapshot(1, 1), now: () => 0, maxAddresses: 100, weightPerRefresh: 8, weightPerMinute: 300 });
    const manyOffs = Array.from({ length: 10 }, (_, index) => many.subscribe(`0x${index}`, "testnet", () => undefined));
    assert.equal(many.intervalMs("testnet"), 16_000, "10 addresses x 8 weight per refresh within 300 per minute");
    for (const off of [...offs, ...manyOffs]) off();
    instance.close();
    many.close();
  });
});
