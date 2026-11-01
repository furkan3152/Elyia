#!/usr/bin/env node
// Writes reports/gas-unit.txt and reports/gas-fork.txt with hardhat-gas-reporter.
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const cwd = path.join(__dirname, "..");
fs.mkdirSync(path.join(cwd, "reports"), { recursive: true });
const run = (files, out, extra = {}) => {
  const r = spawnSync("npx", ["hardhat", "test", ...files], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, REPORT_GAS: "1", GAS_REPORT_FILE: path.join("reports", out), ...extra },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["test/unit.router.test.cjs", "test/unit.account.test.cjs", "test/unit.orders.test.cjs", "test/unit.herd.test.cjs"], "gas-unit.txt");
run(["test/fork.venues.test.cjs", "test/fork.herd.test.cjs"], "gas-fork.txt", { ELYIA_FORK: "1" });
