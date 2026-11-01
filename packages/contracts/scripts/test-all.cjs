#!/usr/bin/env node
// `npm test`: compile, unit tests (in-process chain), then fork tests against Elysium testnet
// (pinned block, nothing broadcast), then export artifacts. Set ELYIA_SKIP_FORK=1 to skip the fork
// suite when offline; this prints a loud warning because fork coverage is part of the gate.
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cwd = path.join(__dirname, "..");
const hh = (args, env = {}) => {
  const r = spawnSync("npx", ["hardhat", ...args], { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

hh(["compile", "--quiet"]);
hh(["test", "--no-compile", "test/unit.router.test.cjs", "test/unit.account.test.cjs", "test/unit.orders.test.cjs", "test/unit.export.test.cjs"]);
if (process.env.ELYIA_SKIP_FORK === "1") {
  console.warn("\n[elyia] WARNING: ELYIA_SKIP_FORK=1, fork tests against Elysium testnet were NOT run.\n");
} else {
  hh(["test", "--no-compile", "test/fork.venues.test.cjs"], { ELYIA_FORK: "1" });
}
const e = spawnSync("node", ["scripts/export.cjs"], { cwd, stdio: "inherit" });
process.exit(e.status ?? 1);
