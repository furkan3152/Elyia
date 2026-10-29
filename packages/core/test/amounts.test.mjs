import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AmountError,
  addSlippage,
  applySlippage,
  compact,
  compareDecimal,
  coreWeiToEvmUnits,
  decimalProblem,
  evmUnitsToCoreWei,
  formatUnitsTrim,
  fromBaseUnits,
  portionOf,
  scaleUnits,
  toBaseUnits,
  truncateDecimal,
} from "../dist/index.js";

test("exact decimal <-> base units", () => {
  assert.equal(toBaseUnits("1.5", 6), "1500000");
  assert.equal(toBaseUnits("0.000001", 6), "1");
  assert.equal(toBaseUnits("20", 18), "20000000000000000000");
  assert.equal(toBaseUnits("1.500000", 6), "1500000", "trailing zeros are fine");
  assert.equal(fromBaseUnits("1500000", 6), "1.5");
  assert.equal(fromBaseUnits(-1500000n, 6), "-1.5");
  assert.equal(fromBaseUnits("20000000000000000000", 18), "20");
  assert.throws(() => toBaseUnits("1.0000001", 6), (error) => error instanceof AmountError && error.code === "AMOUNT_TOO_PRECISE");
  assert.throws(() => toBaseUnits("1", 99), { code: "DECIMALS_INVALID" });
});

test("strict parsing refuses decimal commas, exponents, signs and padding with a reason", () => {
  const code = (text) => decimalProblem(text)?.code ?? null;
  assert.equal(code("1,5"), "AMOUNT_DECIMAL_COMMA");
  assert.equal(code("1,500"), "AMOUNT_DECIMAL_COMMA", "ambiguous: 1.5 or 1500, so refused");
  assert.equal(code("1,000.50"), "AMOUNT_DECIMAL_COMMA");
  assert.equal(code("1e18"), "AMOUNT_EXPONENT");
  assert.equal(code("2E-3"), "AMOUNT_EXPONENT");
  assert.equal(code("-1"), "AMOUNT_SIGNED");
  assert.equal(code("+1"), "AMOUNT_SIGNED");
  assert.equal(code(" 1"), "AMOUNT_WHITESPACE");
  assert.equal(code(""), "AMOUNT_EMPTY");
  for (const bad of [".5", "5.", "01", "0x10", "1.2.3", "NaN", "Infinity"]) assert.equal(code(bad), "AMOUNT_MALFORMED", bad);
  assert.equal(code("0.5"), null);
  assert.throws(() => toBaseUnits("1,5", 6), { code: "AMOUNT_DECIMAL_COMMA" });
});

test("scaling between decimals is exact or explicitly rounded", () => {
  assert.equal(scaleUnits(1500000n, 6, 18), 1500000000000000000n);
  assert.equal(scaleUnits(1500000000000000000n, 18, 6), 1500000n);
  assert.throws(() => scaleUnits(1500000000000000001n, 18, 6), { code: "AMOUNT_NOT_DIVISIBLE" });
  assert.equal(scaleUnits(1500000000000000001n, 18, 6, "floor"), 1500000n);
  assert.equal(scaleUnits(1500000000000000001n, 18, 6, "ceil"), 1500001n);
});

test("HyperCore weiDecimals vs EVM decimals, refusing dust", () => {
  // HYPE: 8 wei decimals on Core, 18 on the EVM (evm_extra_wei_decimals 10).
  assert.equal(coreWeiToEvmUnits(150000000n, 10), 1500000000000000000n);
  assert.equal(evmUnitsToCoreWei(1500000000000000000n, 10), 150000000n);
  assert.throws(() => evmUnitsToCoreWei(1500000000000000001n, 10), { code: "AMOUNT_NOT_DIVISIBLE" }, "the last wei would be lost");
  // USDH / USDT0: 8 on Core, 6 on the EVM (extra -2).
  assert.equal(evmUnitsToCoreWei(1500000n, -2), 150000000n);
  assert.equal(coreWeiToEvmUnits(150000000n, -2), 1500000n);
  assert.throws(() => coreWeiToEvmUnits(150000001n, -2), { code: "AMOUNT_NOT_DIVISIBLE" });
  // PURR: 5 on Core, 18 on the EVM (extra 13).
  assert.equal(coreWeiToEvmUnits(1n, 13), 10000000000000n);
});

test("slippage and portions round in the user's favour", () => {
  assert.equal(applySlippage(1000n, 50), 995n);
  assert.equal(applySlippage(999n, 50), 994n);
  assert.equal(addSlippage(1000n, 50), 1005n);
  assert.equal(addSlippage(999n, 50), 1004n);
  assert.equal(portionOf(3n, 5000), 1n);
  assert.throws(() => applySlippage(1n, 10001));
  assert.equal(compareDecimal("1.50", "1.5"), 0);
  assert.equal(compareDecimal("0.1", "0.09"), 1);
  assert.equal(compareDecimal("2", "10"), -1);
});

test("pure formatting: formatUnitsTrim and compact truncate toward zero", () => {
  assert.equal(formatUnitsTrim(1234567n, 6, 2), "1.23");
  assert.equal(formatUnitsTrim("1999999", 6, 2), "1.99");
  assert.equal(formatUnitsTrim(1500000n, 6), "1.5");
  assert.equal(formatUnitsTrim(-1999999n, 6, 2), "-1.99");
  assert.equal(truncateDecimal("-0.001", 2), "0");
  assert.equal(compact("1234567.8"), "1.23M");
  assert.equal(compact("999.99"), "999.99");
  assert.equal(compact("1000"), "1K");
  assert.equal(compact("-15300"), "-15.3K");
  assert.equal(compact("2500000000000"), "2.5T");
  assert.equal(compact("0.123456", 4), "0.1234");
  assert.throws(() => compact("1e5"), { code: "AMOUNT_EXPONENT" });
});
