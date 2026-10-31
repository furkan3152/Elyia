/**
 * Calldata of every adapter, decoded back with viem and checked field by
 * field; Orbit message math against live Elysium testnet deposits; the
 * pinned lending market ids against their params.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concatHex, decodeFunctionData, getAddress, numberToHex, pad, type Address, type Hex } from "viem";
import { ERC4626_ABI, MORPHO_ABI, SIGNAL_V4_ABI, SWAP_ROUTER_02_ABI, SWAP_ROUTER_V1_ABI, V2_ROUTER_ABI } from "../abis.js";
import { exactLinkUnits } from "../adapters/hypercoreLink.js";
import { marketIdOf, sharesToAssets, supplyCalldata, withdrawCalldata } from "../adapters/lending.js";
import { signalBuyCalldata, signalPoolKey } from "../adapters/signalV4.js";
import { v2SwapCalldata } from "../adapters/swapV2.js";
import { swapCalldata } from "../adapters/swapV3.js";
import { vaultCalldata } from "../adapters/vault4626.js";
import { applyL1ToL2Alias, ethDepositTxId, retryableFees, undoL1ToL2Alias, MIN_GAS_PRICE_BID_WEI } from "../orbit/math.js";
import { ELYRA_LENDING, HYPERSWAP_V3, KALOS_V3, PERPME_V3, SIGNAL_V4 } from "../venues.js";
import { OWNER } from "./fakes.js";

const USDC = "0x7d29d8047b905000459c0e80c34a26ceedcb47b2" as Address;
const WHYPE = "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234" as Address;

describe("V3 router calldata", () => {
  const base = { tokenIn: WHYPE, tokenOut: USDC, fee: 20_000, amountIn: 10n ** 16n, minOut: 95_000_000n, account: OWNER, deadline: 1_800_000_600n };

  it("SwapRouter v1 (Kalos): exactInputSingle with the deadline in the struct, HYPE as msg.value", () => {
    const { data, value } = swapCalldata(KALOS_V3, { ...base, nativeIn: true, nativeOut: false });
    assert.equal(value, 10n ** 16n);
    const decoded = decodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, data });
    assert.equal(decoded.functionName, "exactInputSingle");
    const params = decoded.args[0] as { tokenIn: Address; tokenOut: Address; fee: number; recipient: Address; deadline: bigint; amountIn: bigint; amountOutMinimum: bigint; sqrtPriceLimitX96: bigint };
    assert.equal(params.tokenIn.toLowerCase(), WHYPE);
    assert.equal(params.recipient.toLowerCase(), OWNER);
    assert.equal(params.deadline, base.deadline);
    assert.equal(params.amountOutMinimum, base.minOut);
    assert.equal(params.fee, 20_000);
    assert.equal(params.sqrtPriceLimitX96, 0n);
  });

  it("SwapRouter v1: native out = multicall([exactInputSingle(recipient = router), unwrapWETH9(min, account)])", () => {
    const { data, value } = swapCalldata(KALOS_V3, { ...base, tokenIn: USDC, tokenOut: WHYPE, nativeIn: false, nativeOut: true });
    assert.equal(value, 0n);
    const outer = decodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, data });
    assert.equal(outer.functionName, "multicall");
    const [swap, unwrap] = outer.args[0] as readonly Hex[];
    const single = decodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, data: swap as Hex });
    assert.equal((single.args[0] as { recipient: Address }).recipient.toLowerCase(), KALOS_V3.router);
    const unwrapped = decodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, data: unwrap as Hex });
    assert.equal(unwrapped.functionName, "unwrapWETH9");
    assert.deepEqual(unwrapped.args.map(String), [String(base.minOut), getAddress(OWNER)]);
  });

  it("PerpMe uses the same v1 dialect through its own router", () => {
    const { data } = swapCalldata(PERPME_V3, { ...base, tokenIn: PERPME_V3.wrappedNative, nativeIn: true, nativeOut: false });
    assert.equal(data.slice(0, 10), "0x414bf389");
  });

  it("SwapRouter02 (HyperSwap): multicall(deadline, [exactInputSingle(no deadline), unwrapWETH9]) with recipient = address(2)", () => {
    const { data } = swapCalldata(HYPERSWAP_V3, { ...base, tokenIn: USDC, tokenOut: HYPERSWAP_V3.wrappedNative, nativeIn: false, nativeOut: true });
    const outer = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data });
    assert.equal(outer.functionName, "multicall");
    assert.equal(outer.args[0], base.deadline);
    const calls = outer.args[1] as readonly Hex[];
    assert.equal(calls.length, 2);
    const single = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[0] as Hex });
    assert.equal((single.args[0] as { recipient: Address }).recipient.toLowerCase(), "0x0000000000000000000000000000000000000002");
  });
});

describe("V2 router calldata", () => {
  const path = ["0xff5681eb95bbacfbb334f80fcdbc31fb59f22332", USDC] as Address[];
  it("native in: swapExactETHForTokens(min, path, to, deadline) with value", () => {
    const call = v2SwapCalldata({ nativeIn: true, nativeOut: false, amountIn: 5n, minOut: 4n, path, to: OWNER, deadline: 9n });
    const decoded = decodeFunctionData({ abi: V2_ROUTER_ABI, data: call.data });
    assert.equal(decoded.functionName, "swapExactETHForTokens");
    assert.equal(call.value, 5n);
    assert.deepEqual(decoded.args.map((arg) => (Array.isArray(arg) ? arg.map((a: string) => a.toLowerCase()) : String(arg).toLowerCase())), ["4", path, OWNER, "9"]);
  });
  it("native out and token -> token", () => {
    assert.equal(decodeFunctionData({ abi: V2_ROUTER_ABI, data: v2SwapCalldata({ nativeIn: false, nativeOut: true, amountIn: 5n, minOut: 4n, path: [...path].reverse(), to: OWNER, deadline: 9n }).data }).functionName, "swapExactTokensForETH");
    const tokens = v2SwapCalldata({ nativeIn: false, nativeOut: false, amountIn: 5n, minOut: 4n, path, to: OWNER, deadline: 9n });
    assert.equal(decodeFunctionData({ abi: V2_ROUTER_ABI, data: tokens.data }).functionName, "swapExactTokensForTokens");
    assert.equal(tokens.value, 0n);
  });
});

describe("ERC-4626, Morpho-style lending and Signal calldata", () => {
  it("vault deposit(assets, receiver) and redeem(shares, receiver, owner)", () => {
    const deposit = decodeFunctionData({ abi: ERC4626_ABI, data: vaultCalldata("deposit", 10n, OWNER) });
    assert.equal(deposit.functionName, "deposit");
    assert.deepEqual(deposit.args.map((arg) => String(arg).toLowerCase()), ["10", OWNER]);
    const redeem = decodeFunctionData({ abi: ERC4626_ABI, data: vaultCalldata("withdraw", 7n, OWNER) });
    assert.equal(redeem.functionName, "redeem");
    assert.deepEqual(redeem.args.map((arg) => String(arg).toLowerCase()), ["7", OWNER, OWNER]);
  });

  it("every pinned market's params hash to its id (keccak256(abi.encode(MarketParams)))", () => {
    for (const market of ELYRA_LENDING.markets) assert.equal(marketIdOf(market), market.id);
  });

  it("supply(params, assets, 0, onBehalf, '') and withdraw by assets or by shares", () => {
    const market = ELYRA_LENDING.markets[0];
    assert.ok(market);
    const supply = decodeFunctionData({ abi: MORPHO_ABI, data: supplyCalldata(market, 1_000n, OWNER) });
    assert.equal(supply.functionName, "supply");
    const [params, assets, shares, onBehalf, data] = supply.args as readonly [{ loanToken: Address; lltv: bigint }, bigint, bigint, Address, Hex];
    assert.equal(params.loanToken.toLowerCase(), USDC);
    assert.equal(params.lltv, 770_000_000_000_000_000n);
    assert.equal(assets, 1_000n);
    assert.equal(shares, 0n);
    assert.equal(onBehalf.toLowerCase(), OWNER);
    assert.equal(data, "0x");
    const byShares = decodeFunctionData({ abi: MORPHO_ABI, data: withdrawCalldata(market, { shares: 55n }, OWNER) });
    assert.deepEqual(byShares.args.slice(1).map((arg) => String(arg).toLowerCase()), ["0", "55", OWNER, OWNER]);
    const byAssets = decodeFunctionData({ abi: MORPHO_ABI, data: withdrawCalldata(market, { assets: 9n }, OWNER) });
    assert.deepEqual(byAssets.args.slice(1, 3).map(String), ["9", "0"]);
  });

  it("Morpho share math rounds a withdrawal down (virtual shares 1e6, virtual assets 1)", () => {
    assert.equal(sharesToAssets(1_000_000n, 0n, 0n), 1n);
    assert.equal(sharesToAssets(999_998_488_401_007_338n, 999_999_932_846n, 999_998_488_401_007_338n), 999_999_932_845n);
  });

  it("Signal pool keys sort currencies; buyNative carries key, minimum, recipient, refundTo, deadline", () => {
    const low = signalPoolKey("0x0000000000000000000000000000000000000001");
    assert.equal(low.key.currency1, SIGNAL_V4.wrappedNative);
    assert.equal(low.zeroForOne, false);
    const high = signalPoolKey("0xffffffffffffffffffffffffffffffffffffffff");
    assert.equal(high.key.currency0, SIGNAL_V4.wrappedNative);
    assert.equal(high.zeroForOne, true);
    // The live pool of the decoded buyNative tx 0x07f5…42b1.
    const live = signalPoolKey("0x8aa6F0835805Ca99f370634415d502ec5c603Baf");
    assert.deepEqual(live.key, { currency0: "0x8aa6f0835805ca99f370634415d502ec5c603baf", currency1: WHYPE, fee: 0, tickSpacing: 200, hooks: "0xda605da70bff4b32a9b379c614a6d9e4a09baaec" });
    const decoded = decodeFunctionData({ abi: SIGNAL_V4_ABI, data: signalBuyCalldata(live.key, 12n, OWNER, 99n) });
    assert.equal(decoded.functionName, "buyNative");
    assert.deepEqual(decoded.args.slice(1).map((arg) => String(arg).toLowerCase()), ["12", OWNER, OWNER, "99"]);
  });

  it("HyperCore link amounts drop the EVM dust below the core decimals (no rounding up)", () => {
    assert.equal(exactLinkUnits(1_234_000_000_001n, 10), 1_230_000_000_000n);
    assert.equal(exactLinkUnits(5n, 0), 5n);
  });
});

describe("Orbit message math (live Elysium testnet deposits, critic-raw/kind12.out)", () => {
  const live = [
    { l1from: "0x1683ce24f61f40d0b140efdc78dc3fdcc7eb18fa", msgIdx: 1_872_777n, aliased: "0x2794CE24F61F40d0b140EFdc78dc3FdcC7EB2A0b", to: "0x1683Ce24F61f40D0b140EFDC78dC3fdcc7Eb18fa", value: 99_990_893_300_000_000n, l2: "0x12675ff2443e751b84bf1af6dcf593ae9e9a64d37aac0c019729eca6d81639e1" },
    { l1from: "0xa90ed5a56fe0d7e5deec51edc45e11df1ef994e7", msgIdx: 1_872_786n, aliased: "0xBA1FD5A56FE0d7e5Deec51Edc45E11dF1eF9A5f8", to: "0xa90eD5A56FE0d7E5DEEC51edC45E11dF1EF994E7", value: 3_239_073_930_300_000n, l2: "0xf4d061c77bc21b64e9a588b32b3008dbecdd70982449ac9e9c2b2be73075b5df" },
    { l1from: "0xf28e7e33186950bfb55e166d1d84190c95d8b3fb", msgIdx: 1_872_631n, aliased: "0x039F7e33186950BfB55e166D1D84190C95D8C50C", to: "0xf28e7E33186950bfb55e166D1D84190c95D8B3Fb", value: 3_231_921_758_520_000n, l2: "0xd1e3673f20809141b3cf95e0a5dbc5e3ee7e8688bacc0cf0f0a4e689dc4128ae" },
  ] as const;

  it("aliases L1 senders (+0x1111…1111) and undoes it", () => {
    for (const row of live) {
      assert.equal(applyL1ToL2Alias(row.l1from), row.aliased);
      assert.equal(undoL1ToL2Alias(row.aliased).toLowerCase(), row.l1from);
    }
  });

  it("derives the kind-12 L2 tx id of 3 of 3 live depositEth messages", () => {
    for (const row of live) {
      const data = concatHex([row.to as Hex, pad(numberToHex(row.value), { size: 32 })]);
      assert.equal(ethDepositTxId(99_801, row.msgIdx, row.aliased, data), row.l2);
    }
  });

  it("sizes retryables: submission +300%, gas +50%, bid 2x with a 0.2 gwei floor", () => {
    const fees = retryableFees({ submissionFee: 1_000n, gasEstimate: 100_000n, l2GasPrice: 50_000_000n });
    assert.equal(fees.maxSubmissionCost, 4_000n);
    assert.equal(fees.maxGas, 150_000n);
    assert.equal(fees.gasPriceBid, MIN_GAS_PRICE_BID_WEI);
    assert.equal(fees.value, 4_000n + 150_000n * MIN_GAS_PRICE_BID_WEI);
    const high = retryableFees({ submissionFee: 3n, gasEstimate: 3n, l2GasPrice: 300_000_000n, l2CallValue: 7n });
    assert.equal(high.maxSubmissionCost, 12n);
    assert.equal(high.maxGas, 5n);
    assert.equal(high.gasPriceBid, 600_000_000n);
    assert.equal(high.value, 12n + 5n * 600_000_000n + 7n);
    assert.throws(() => retryableFees({ submissionFee: 1n, gasEstimate: 0n, l2GasPrice: 1n }));
  });
});
