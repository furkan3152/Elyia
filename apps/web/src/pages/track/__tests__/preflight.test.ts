import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeErrorResult, parseAbi } from "viem";

import { preflight, revertReason } from "../flow/preflight";

const FROM = "0x1683Ce24F61f40D0b140EFDC78dC3fdcc7Eb18fa";
const TX = { from: FROM, to: "0x0000000000000000000000000000000000000064", data: "0x" as const, value: 0n } as const;

test("reads the revert reason of a failed eth_call", () => {
  const data = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["STF"] });
  assert.equal(revertReason({ name: "CallExecutionError", message: "Execution reverted", cause: { name: "RawContractError", data } }), "STF");
  assert.equal(revertReason({ name: "CallExecutionError", shortMessage: "Execution reverted.", details: "invalid opcode: INVALID" }), "invalid opcode: INVALID");
  assert.equal(revertReason({ name: "ExecutionRevertedError", message: "execution reverted" }), "execution reverted");
});

test("a transport failure is not a revert (the wallet still decides)", () => {
  assert.equal(revertReason({ name: "CallExecutionError", message: "HTTP request failed", cause: { name: "HttpRequestError", message: "fetch failed" } }), null);
  assert.equal(revertReason(new Error("socket hang up")), null);
  assert.equal(revertReason(null), null);
});

test("preflight stops a transaction that would revert, and lets a good one through", async () => {
  const reverting = { call: () => Promise.reject({ name: "CallExecutionError", details: "invalid opcode: INVALID" }) };
  await assert.rejects(preflight(reverting, TX, "Elysium Testnet"), /would revert on Elysium Testnet \(invalid opcode: INVALID\), so it was not sent/u);
  await preflight({ call: () => Promise.resolve({ data: "0x" }) }, TX, "Elysium Testnet");
  await preflight({ call: () => Promise.reject({ name: "HttpRequestError", message: "down" }) }, TX, "Elysium Testnet");
  await preflight(undefined, TX, "Elysium Testnet");
});
