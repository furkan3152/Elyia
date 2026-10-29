import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PulseBlock } from "@elyia/core";
import { EventBus } from "../bus.js";
import { formatLogLine, memoryLogger } from "../log.js";

const block = { network: "elysium-testnet", number: 1 } as PulseBlock;

describe("EventBus", () => {
  it("delivers in subscription order and unsubscribes independently", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const listener = () => seen.push("same");
    const offA = bus.on("elysium.block", listener);
    bus.on("elysium.block", listener);
    bus.on("elysium.block", () => seen.push("other"));
    bus.emit("elysium.block", block);
    assert.deepEqual(seen, ["same", "same", "other"]);
    offA();
    offA();
    assert.equal(bus.listenerCount("elysium.block"), 2);
  });

  it("isolates throwing listeners and logs them", () => {
    const log = memoryLogger();
    const bus = new EventBus(log);
    let reached = false;
    bus.on("elysium.block", () => {
      throw new Error("boom");
    });
    bus.on("elysium.block", () => {
      reached = true;
    });
    bus.emit("elysium.block", block);
    assert.equal(reached, true);
    assert.equal(log.lines[0]?.msg, "event listener failed");
  });

  it("supports once and typed custom event maps", () => {
    const bus = new EventBus<{ ping: number }>();
    const values: number[] = [];
    bus.once("ping", (value) => values.push(value));
    bus.emit("ping", 1);
    bus.emit("ping", 2);
    assert.deepEqual(values, [1]);
    assert.equal(bus.listenerCount("ping"), 0);
  });
});

describe("logger", () => {
  it("writes one JSON object per line with levels and child fields", () => {
    const log = memoryLogger("info");
    log.debug("hidden");
    log.child({ component: "pulse" }).warn("lagging", { behind: 5, big: 10n, error: new Error("x") });
    assert.equal(log.lines.length, 1);
    const line = log.lines[0] as Record<string, unknown>;
    assert.equal(line.level, "warn");
    assert.equal(line.msg, "lagging");
    assert.equal(line.component, "pulse");
    assert.equal(line.big, "10");
    assert.equal((line.error as { message: string }).message, "x");
    assert.ok(!Number.isNaN(Date.parse(String(line.time))));
  });

  it("never throws on unserializable fields", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const line = JSON.parse(formatLogLine(0, "info", "m", { circular })) as Record<string, unknown>;
    assert.equal(line.msg, "m");
    assert.ok(line.logError);
  });
});
