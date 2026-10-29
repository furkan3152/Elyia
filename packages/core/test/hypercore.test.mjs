// HyperCore signing golden vectors.
//
// Every vector below is copied from the official Python SDK test suite
// (hyperliquid-python-sdk, tests/signing_test.py, master on 2026-10-29). The
// payloads are produced by @elyia/core and signed here with viem; the
// signatures must equal the SDK's exactly. If one fails, Elyia's encoding is
// wrong: fix the encoding, never the vector.
//
// The SDK test `test_multi_sig_user_set_abstraction_payload_uses_wire_enum`
// checks an exchange.py payload rewrite for multi-sig users (no hash or
// signature); Elyia has no multi-sig flow, so there is nothing to port.
import assert from "node:assert/strict";
import { test } from "node:test";
import { encode } from "@msgpack/msgpack";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { hypercore as hc } from "../dist/index.js";

const KEY = "0x0123456789012345678901234567890123456789012345678901234567890123";
const wallet = privateKeyToAccount(KEY);

/** The SDK prints r and s with `to_hex(int)`, which drops leading zeros: compare as integers. */
function assertSignature(actualHex, expected) {
  const signature = hc.splitSignature(actualHex);
  assert.equal(BigInt(signature.r), BigInt(expected.r), "r");
  assert.equal(BigInt(signature.s), BigInt(expected.s), "s");
  assert.equal(signature.v, expected.v, "v");
}

async function signL1(action, vaultAddress, nonce, expiresAfter, isMainnet) {
  const { typedData } = hc.l1ActionTypedData({ action, nonce, vaultAddress, expiresAfter, isMainnet });
  return wallet.signTypedData(typedData);
}

/** The SDK's order_request_to_order_wire for (coin -> asset, is_buy, sz, limit_px, order_type, reduce_only, cloid). */
function sdkOrderWire(asset, isBuy, sz, limitPx, orderType, reduceOnly = false, cloid) {
  const kind = "limit" in orderType
    ? orderType
    : { trigger: { isMarket: orderType.trigger.isMarket, triggerPx: hc.floatToWire(orderType.trigger.triggerPx), tpsl: orderType.trigger.tpsl } };
  return hc.orderWire({ asset, isBuy, price: hc.floatToWire(limitPx), size: hc.floatToWire(sz), reduceOnly, kind, ...(cloid ? { cloid } : {}) });
}

test("test_phantom_agent_creation_matches_production", () => {
  const action = hc.orderAction([sdkOrderWire(4, true, 0.0147, 1670.1, { limit: { tif: "Ioc" } })]);
  const hash = hc.actionHash(action, null, 1677777606040, null);
  const agent = hc.phantomAgent(hash, true);
  assert.equal(agent.connectionId, "0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908");
  assert.equal(agent.source, "a");
});

test("test_l1_action_signing_matches", async () => {
  const action = { type: "dummy", num: Number(hc.floatToIntForHashing(1000)) };
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298",
    s: "0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8",
    v: 27,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0x542af61ef1f429707e3c76c5293c80d01f74ef853e34b76efffcb57e574f9510",
    s: "0x17b8b32f086e8cdede991f1e2c529f5dd5297cbe8128500e00cbaf766204a613",
    v: 28,
  });
});

test("test_l1_action_signing_order_matches", async () => {
  const action = hc.orderAction([sdkOrderWire(1, true, 100, 100, { limit: { tif: "Gtc" } })]);
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e",
    s: "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e",
    v: 28,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54",
    s: "0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5",
    v: 27,
  });
});

test("test_l1_action_signing_order_with_cloid_matches", async () => {
  const action = hc.orderAction([sdkOrderWire(1, true, 100, 100, { limit: { tif: "Gtc" } }, false, "0x00000000000000000000000000000001")]);
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0x41ae18e8239a56cacbc5dad94d45d0b747e5da11ad564077fcac71277a946e3",
    s: "0x3c61f667e747404fe7eea8f90ab0e76cc12ce60270438b2058324681a00116da",
    v: 27,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0xeba0664bed2676fc4e5a743bf89e5c7501aa6d870bdb9446e122c9466c5cd16d",
    s: "0x7f3e74825c9114bc59086f1eebea2928c190fdfbfde144827cb02b85bbe90988",
    v: 28,
  });
});

test("test_l1_action_signing_matches_with_vault", async () => {
  const action = { type: "dummy", num: Number(hc.floatToIntForHashing(1000)) };
  const vault = "0x1719884eb866cb12b2287399b15f7db5e7d775ea";
  assertSignature(await signL1(action, vault, 0, null, true), {
    r: "0x3c548db75e479f8012acf3000ca3a6b05606bc2ec0c29c50c515066a326239",
    s: "0x4d402be7396ce74fbba3795769cda45aec00dc3125a984f2a9f23177b190da2c",
    v: 28,
  });
  assertSignature(await signL1(action, vault, 0, null, false), {
    r: "0xe281d2fb5c6e25ca01601f878e4d69c965bb598b88fac58e475dd1f5e56c362b",
    s: "0x7ddad27e9a238d045c035bc606349d075d5c5cd00a6cd1da23ab5c39d4ef0f60",
    v: 27,
  });
});

test("test_l1_action_signing_tpsl_order_matches", async () => {
  const action = hc.orderAction([sdkOrderWire(1, true, 100, 100, { trigger: { triggerPx: 103, isMarket: true, tpsl: "sl" } })]);
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0x98343f2b5ae8e26bb2587daad3863bc70d8792b09af1841b6fdd530a2065a3f9",
    s: "0x6b5bb6bb0633b710aa22b721dd9dee6d083646a5f8e581a20b545be6c1feb405",
    v: 27,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0x971c554d917c44e0e1b6cc45d8f9404f32172a9d3b3566262347d0302896a2e4",
    s: "0x206257b104788f80450f8e786c329daa589aa0b32ba96948201ae556d5637eac",
    v: 28,
  });
});

test("test_float_to_int_for_hashing", () => {
  assert.equal(hc.floatToIntForHashing(123123123123), 12312312312300000000n);
  assert.equal(hc.floatToIntForHashing(0.00001231), 1231n);
  assert.equal(hc.floatToIntForHashing(1.033), 103300000n);
  assert.throws(() => hc.floatToIntForHashing(0.000012312312), { name: "HyperCoreWireError" });
});

test("test_sign_usd_transfer_action", async () => {
  const action = hc.usdSendAction(
    { hyperliquidChain: "Testnet", signatureChainId: "0x66eee" },
    { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1687816341423 },
  );
  assertSignature(await wallet.signTypedData(hc.typedDataForUserAction(action)), {
    r: "0x637b37dd731507cdd24f46532ca8ba6eec616952c56218baeff04144e4a77073",
    s: "0x11a6a24900e6e314136d2592e2f8d502cd89b7c15b198e1bee043c9589f9fad7",
    v: 27,
  });
});

test("test_sign_withdraw_from_bridge_action", async () => {
  const action = hc.withdraw3Action(
    { hyperliquidChain: "Testnet", signatureChainId: "0x66eee" },
    { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1687816341423 },
  );
  assertSignature(await wallet.signTypedData(hc.typedDataForUserAction(action)), {
    r: "0x8363524c799e90ce9bc41022f7c39b4e9bdba786e5f9c72b20e43e1462c37cf9",
    s: "0x58b1411a775938b83e29182e8ef74975f9054c8e97ebf5ec2dc8d51bfc893881",
    v: 28,
  });
});

test("test_create_sub_account_action", async () => {
  const action = { type: "createSubAccount", name: "example" };
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0x51096fe3239421d16b671e192f574ae24ae14329099b6db28e479b86cdd6caa7",
    s: "0xb71f7d293af92d3772572afb8b102d167a7cef7473388286bc01f52a5c5b423",
    v: 27,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0xa699e3ed5c2b89628c746d3298b5dc1cca604694c2c855da8bb8250ec8014a5b",
    s: "0x53f1b8153a301c72ecc655b1c315d64e1dcea3ee58921fd7507e35818fcc1584",
    v: 28,
  });
});

test("test_sub_account_transfer_action", async () => {
  const action = { type: "subAccountTransfer", subAccountUser: "0x1d9470d4b963f552e6f671a81619d395877bf409", isDeposit: true, usd: 10 };
  assertSignature(await signL1(action, null, 0, null, true), {
    r: "0x43592d7c6c7d816ece2e206f174be61249d651944932b13343f4d13f306ae602",
    s: "0x71a926cb5c9a7c01c3359ec4c4c34c16ff8107d610994d4de0e6430e5cc0f4c9",
    v: 28,
  });
  assertSignature(await signL1(action, null, 0, null, false), {
    r: "0xe26574013395ad55ee2f4e0575310f003c5bb3351b5425482e2969fa51543927",
    s: "0xefb08999196366871f919fd0e138b3a7f30ee33e678df7cfaf203e25f0a4278",
    v: 28,
  });
});

test("test_schedule_cancel_action", async () => {
  const clear = hc.scheduleCancelAction();
  assertSignature(await signL1(clear, null, 0, null, true), {
    r: "0x6cdfb286702f5917e76cd9b3b8bf678fcc49aec194c02a73e6d4f16891195df9",
    s: "0x6557ac307fa05d25b8d61f21fb8a938e703b3d9bf575f6717ba21ec61261b2a0",
    v: 27,
  });
  assertSignature(await signL1(clear, null, 0, null, false), {
    r: "0xc75bb195c3f6a4e06b7d395acc20bbb224f6d23ccff7c6a26d327304e6efaeed",
    s: "0x342f8ede109a29f2c0723bd5efb9e9100e3bbb493f8fb5164ee3d385908233df",
    v: 28,
  });
  const at = hc.scheduleCancelAction(123456789);
  assertSignature(await signL1(at, null, 0, null, true), {
    r: "0x609cb20c737945d070716dcc696ba030e9976fcf5edad87afa7d877493109d55",
    s: "0x16c685d63b5c7a04512d73f183b3d7a00da5406ff1f8aad33f8ae2163bab758b",
    v: 28,
  });
  assertSignature(await signL1(at, null, 0, null, false), {
    r: "0x4e4f2dbd4107c69783e251b7e1057d9f2b9d11cee213441ccfa2be63516dc5bc",
    s: "0x706c656b23428c8ba356d68db207e11139ede1670481a9e01ae2dfcdb0e1a678",
    v: 27,
  });
});

/* -------------------------------------------- encoding details beyond the SDK suite */

const u64 = (value) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};
const keccakHex = (bytes) => `0x${bytesToHex(keccak_256(bytes))}`;

test("actionHash appends nonce, vault marker and expiresAfter exactly as signing.py action_hash", () => {
  const action = hc.cancelAction([{ asset: 3, oid: 63986468816 }]);
  const body = encode(action);
  const nonce = 1793280000010;
  const expires = 1793280120010;
  const vault = "0x1719884eb866cb12b2287399b15f7db5e7d775ea";
  assert.equal(hc.actionHash(action, null, nonce, null), keccakHex(concatBytes(body, u64(nonce), Uint8Array.of(0))));
  assert.equal(hc.actionHash(action, null, nonce, expires), keccakHex(concatBytes(body, u64(nonce), Uint8Array.of(0), Uint8Array.of(0), u64(expires))));
  assert.equal(
    hc.actionHash(action, vault, nonce, expires),
    keccakHex(concatBytes(body, u64(nonce), Uint8Array.of(1), hexToBytes(vault.slice(2)), Uint8Array.of(0), u64(expires))),
  );
  assert.notEqual(hc.actionHash(action, null, nonce, expires), hc.actionHash(action, null, nonce, null));
  // The vault address is hashed as raw bytes, so its case does not matter.
  assert.equal(hc.actionHash(action, vault.toUpperCase().replace("0X", "0x"), nonce, null), hc.actionHash(action, vault, nonce, null));
});

test("msgpack bytes: insertion-order maps, smallest integer forms", () => {
  assert.equal(bytesToHex(hc.actionMsgpack(hc.noopAction())), "81a474797065a46e6f6f70");
  // 100000000000 does not fit in 32 bits: uint64 (0xcf), as Python's msgpack packs it.
  assert.equal(bytesToHex(hc.actionMsgpack({ n: 100000000000 })), "81a16ecf000000174876e800");
  assert.equal(bytesToHex(hc.actionMsgpack({ n: -12500000 })), "81a16ed2ff4143e0");
  assert.equal(bytesToHex(hc.actionMsgpack({ b: false, z: null })), "82a162c2a17ac0");
});

test("msgpack refuses values that would hash differently from the SDK", () => {
  assert.throws(() => hc.actionMsgpack({ type: "order", px: 1.5 }), /only safe integers/u);
  assert.throws(() => hc.actionMsgpack({ type: "order", c: undefined }), /undefined/u);
  assert.throws(() => hc.actionMsgpack({ type: "order", n: 10n }), /cannot be hashed/u);
  assert.throws(() => hc.actionMsgpack({ type: "order", n: 2 ** 60 }), /only safe integers/u);
  assert.throws(() => hc.actionHash({ type: "noop" }, null, -1, null), /unsigned 64-bit/u);
  assert.throws(() => hc.actionHash({ type: "noop" }, "0x1234", 1, null), /not an address/u);
});

test("builders create keys in the SDK / exchange-docs order", () => {
  const entry = hc.orderWire({ asset: 3, isBuy: true, price: "79650", size: "0.01", kind: { limit: { tif: "Ioc" } }, cloid: "0x0000000000000000000000000000BEEF" });
  assert.equal(JSON.stringify(entry), '{"a":3,"b":true,"p":"79650","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}},"c":"0x0000000000000000000000000000beef"}');
  const stop = hc.orderWire({ asset: 3, isBuy: false, price: "76000", size: "0.01", reduceOnly: true, kind: { trigger: { tpsl: "sl", triggerPx: "76500.5", isMarket: false } } });
  assert.equal(JSON.stringify(stop.t), '{"trigger":{"isMarket":false,"triggerPx":"76500.5","tpsl":"sl"}}');
  const bracket = hc.orderAction([entry, stop], { grouping: "normalTpsl", builder: { b: "0x1719884EB866cb12b2287399b15f7db5e7d775ea", f: 10 } });
  assert.deepEqual(Object.keys(bracket), ["type", "orders", "grouping", "builder"]);
  assert.equal(JSON.stringify(bracket.builder), '{"b":"0x1719884eb866cb12b2287399b15f7db5e7d775ea","f":10}');
  assert.equal(JSON.stringify(hc.cancelAction([{ asset: 3, oid: 7 }])), '{"type":"cancel","cancels":[{"a":3,"o":7}]}');
  assert.equal(JSON.stringify(hc.cancelAction([{ asset: 3, oid: 7 }], { fast: true })), '{"type":"cancel","cancels":[{"a":3,"o":7}],"f":true}');
  assert.equal(JSON.stringify(hc.cancelAction([{ asset: 3, oid: 7 }], { fast: false })), '{"type":"cancel","cancels":[{"a":3,"o":7}]}');
  assert.equal(
    JSON.stringify(hc.cancelByCloidAction([{ asset: 3, cloid: "0x0000000000000000000000000000beef" }])),
    '{"type":"cancelByCloid","cancels":[{"asset":3,"cloid":"0x0000000000000000000000000000beef"}]}',
  );
  assert.deepEqual(Object.keys(hc.modifyAction(9, entry)), ["type", "oid", "order"]);
  assert.deepEqual(Object.keys(hc.modifyAction(9, entry, { alwaysPlace: true })), ["type", "oid", "order", "a"]);
  assert.equal(JSON.stringify(hc.batchModifyAction([{ oid: "0x0000000000000000000000000000beef", order: entry }])).startsWith('{"type":"batchModify","modifies":[{"oid":"0x0000000000000000000000000000beef","order":{"a":3'), true);
  assert.equal(JSON.stringify(hc.updateLeverageAction(3, true, 5)), '{"type":"updateLeverage","asset":3,"isCross":true,"leverage":5}');
  assert.equal(JSON.stringify(hc.updateIsolatedMarginAction(4, hc.usdToMicros("-12.5"))), '{"type":"updateIsolatedMargin","asset":4,"isBuy":true,"ntli":-12500000}');
  assert.equal(
    JSON.stringify(hc.twapOrderAction({ asset: 3, isBuy: true, size: "0.05", minutes: 30, randomize: true })),
    '{"type":"twapOrder","twap":{"a":3,"b":true,"s":"0.05","r":false,"m":30,"t":true}}',
  );
  assert.equal(JSON.stringify(hc.twapCancelAction(3, 77738308)), '{"type":"twapCancel","a":3,"t":77738308}');
  assert.equal(JSON.stringify(hc.scheduleCancelAction(1793280300000)), '{"type":"scheduleCancel","time":1793280300000}');
});

test("builders refuse malformed input instead of hashing it", () => {
  const base = { asset: 3, isBuy: true, price: "79650", size: "0.01", kind: { limit: { tif: "Ioc" } } };
  assert.throws(() => hc.orderWire({ ...base, price: "79650.0" }), /wire decimal/u);
  assert.throws(() => hc.orderWire({ ...base, size: "0" }), /wire decimal/u);
  assert.throws(() => hc.orderWire({ ...base, kind: { limit: { tif: "Fok" } } }), /time in force/u);
  assert.throws(() => hc.orderWire({ ...base, cloid: "0x1234" }), /cloid/u);
  assert.throws(() => hc.orderAction([]), /at least one order/u);
  assert.throws(() => hc.orderAction([hc.orderWire(base)], { builder: { b: "0x1719884eb866cb12b2287399b15f7db5e7d775ea", f: 5000 } }), /Builder fee/u);
  assert.throws(() => hc.twapOrderAction({ asset: 3, isBuy: true, size: "1", minutes: 2 }), /5 to 1440/u);
  assert.throws(() => hc.updateLeverageAction(3, true, 0), /leverage/u);
  assert.throws(() => hc.updateIsolatedMarginAction(3, 1.5), /ntli/u);
});

test("market order wires check tick and lot rules for the market", () => {
  const btc = { coin: "BTC", displayName: "BTC", asset: 3, szDecimals: 5, isSpot: false, maxLeverage: 25, onlyIsolated: false, isDelisted: false };
  const wire = hc.orderWireFor(btc, { isBuy: true, price: "80048", size: "0.00125", kind: { limit: { tif: "Ioc" } } });
  assert.deepEqual([wire.p, wire.s], ["80048", "0.00125"]);
  assert.throws(() => hc.orderWireFor(btc, { isBuy: true, price: "80048.5", size: "0.001", kind: { limit: { tif: "Ioc" } } }), { code: "PRICE_TICK" });
  assert.throws(() => hc.orderWireFor(btc, { isBuy: true, price: "80048", size: "0.000001", kind: { limit: { tif: "Ioc" } } }), { code: "SIZE_LOT" });
  assert.throws(() => hc.orderWireFor({ ...btc, isDelisted: true }, { isBuy: true, price: "80048", size: "0.001", kind: { limit: { tif: "Ioc" } } }), /delisted/u);
  const tp = hc.orderWireFor(btc, { isBuy: false, price: 84000, size: 0.001, reduceOnly: true, kind: { trigger: { isMarket: true, triggerPx: 84000, tpsl: "tp" } } });
  assert.equal(JSON.stringify(tp), '{"a":3,"b":false,"p":"84000","s":"0.001","r":true,"t":{"trigger":{"isMarket":true,"triggerPx":"84000","tpsl":"tp"}}}');
});

test("phantom agent typed data: Exchange domain on chain 1337, source a/b", () => {
  const { connectionId, typedData } = hc.l1ActionTypedData({ action: hc.noopAction(), nonce: 1, isMainnet: false });
  assert.deepEqual(typedData.domain, { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" });
  assert.deepEqual(typedData.types, { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] });
  assert.equal(typedData.primaryType, "Agent");
  assert.deepEqual(typedData.message, { source: "b", connectionId });
  assert.equal(hc.l1ActionTypedData({ action: hc.noopAction(), nonce: 1, isMainnet: true }).typedData.message.source, "a");
  assert.deepEqual(Object.keys(hc.withDomainType(typedData).types), ["Agent", "EIP712Domain"]);
});

test("user-signed typed data: SDK field lists, wallet chain as the domain chain, signable and recoverable", async () => {
  const testnetOnElysium = { hyperliquidChain: "Testnet", signatureChainId: "0x185d9" };
  const actions = [
    hc.usdSendAction(testnetOnElysium, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "12.5", time: 1793280000100 }),
    hc.spotSendAction(testnetOnElysium, { destination: "0x2222222222222222222222222222222222222222", token: "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab", amount: "0.5", time: 1793280000101 }),
    hc.withdraw3Action(testnetOnElysium, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "5", time: 1793280000102 }),
    hc.usdClassTransferAction(testnetOnElysium, { amount: "200", toPerp: true, nonce: 1793280000103 }),
    hc.sendAssetAction(testnetOnElysium, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", sourceDex: "spot", destinationDex: "", token: "USDC:0xeb62eee3685fc4c43992febcd9e75443", amount: "10", nonce: 1793280000104 }),
    hc.approveAgentAction(testnetOnElysium, { agentAddress: "0xAA75418d6af464d2be641ce8a575e1113df53a9d", agentName: "elyia valid_until 1800000000000", nonce: 1793280000105 }),
    hc.approveBuilderFeeAction(testnetOnElysium, { builder: "0x1719884eb866cb12b2287399b15f7db5e7d775ea", maxFeeRate: "0.001%", nonce: 1793280000106 }),
    hc.tokenDelegateAction(testnetOnElysium, { validator: "0x5ac99df645f3414876c816caa18b2d234024b487", wei: 1000000000, isUndelegate: false, nonce: 1793280000107 }),
    hc.cDepositAction(testnetOnElysium, { wei: 250000000, nonce: 1793280000108 }),
    hc.cWithdrawAction(testnetOnElysium, { wei: 250000000, nonce: 1793280000109 }),
  ];
  const expectedPrimary = {
    usdSend: "HyperliquidTransaction:UsdSend",
    spotSend: "HyperliquidTransaction:SpotSend",
    withdraw3: "HyperliquidTransaction:Withdraw",
    usdClassTransfer: "HyperliquidTransaction:UsdClassTransfer",
    sendAsset: "HyperliquidTransaction:SendAsset",
    approveAgent: "HyperliquidTransaction:ApproveAgent",
    approveBuilderFee: "HyperliquidTransaction:ApproveBuilderFee",
    tokenDelegate: "HyperliquidTransaction:TokenDelegate",
    cDeposit: "HyperliquidTransaction:CDeposit",
    cWithdraw: "HyperliquidTransaction:CWithdraw",
  };
  for (const action of actions) {
    const typed = hc.typedDataForUserAction(action);
    assert.equal(typed.primaryType, expectedPrimary[action.type], action.type);
    assert.deepEqual(typed.domain, { name: "HyperliquidSignTransaction", version: "1", chainId: 99801, verifyingContract: "0x0000000000000000000000000000000000000000" });
    const fields = typed.types[typed.primaryType].map((field) => field.name);
    assert.equal(fields[0], "hyperliquidChain", action.type);
    assert.deepEqual(Object.keys(typed.message), fields, action.type);
    assert.equal(typed.message.hyperliquidChain, "Testnet");
    const signature = await wallet.signTypedData(typed);
    assert.equal(await recoverTypedDataAddress({ ...typed, signature }), wallet.address, action.type);
  }
  assert.deepEqual(
    hc.USD_CLASS_TRANSFER_SIGN_TYPES,
    [{ name: "hyperliquidChain", type: "string" }, { name: "amount", type: "string" }, { name: "toPerp", type: "bool" }, { name: "nonce", type: "uint64" }],
  );
  assert.deepEqual(
    hc.TOKEN_DELEGATE_TYPES.map((field) => `${field.name}:${field.type}`),
    ["hyperliquidChain:string", "validator:address", "wei:uint64", "isUndelegate:bool", "nonce:uint64"],
  );
});

test("an unnamed approveAgent omits agentName from the action but signs agentName \"\" (as the SDK)", () => {
  const action = hc.approveAgentAction({ hyperliquidChain: "Mainnet", signatureChainId: "0x3e6" }, { agentAddress: "0xaa75418d6af464d2be641ce8a575e1113df53a9d", agentName: null, nonce: 5 });
  assert.equal("agentName" in action, false);
  const typed = hc.typedDataForUserAction(action);
  assert.equal(typed.message.agentName, "");
  assert.equal(typed.message.hyperliquidChain, "Mainnet");
  assert.equal(typed.domain.chainId, 998);
});

test("user-signed builders lower-case addresses and refuse bad fields", () => {
  const ctx = { hyperliquidChain: "Testnet", signatureChainId: "0x3e6" };
  assert.equal(hc.usdSendAction(ctx, { destination: "0x5E9EE1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1 }).destination, "0x5e9ee1089755c3435139848e47e6635505d5a13a");
  assert.throws(() => hc.usdSendAction(ctx, { destination: "0x5e9e", amount: "1", time: 1 }), /not an address/u);
  assert.throws(() => hc.usdSendAction(ctx, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "0", time: 1 }), /positive/u);
  assert.throws(() => hc.usdSendAction(ctx, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1,5", time: 1 }), /positive/u);
  assert.throws(() => hc.usdSendAction({ ...ctx, signatureChainId: "998" }, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1 }), /signatureChainId/u);
  assert.throws(() => hc.spotSendAction(ctx, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", token: "HYPE", amount: "1", time: 1 }), /NAME:tokenId/u);
  assert.equal(
    hc.usdClassTransferAction(ctx, { amount: "1", toPerp: false, nonce: 1, subAccount: "0x1719884EB866cb12b2287399b15f7db5e7d775ea" }).amount,
    "1 subaccount:0x1719884eb866cb12b2287399b15f7db5e7d775ea",
  );
  assert.throws(() => hc.approveBuilderFeeAction(ctx, { builder: "0x1719884eb866cb12b2287399b15f7db5e7d775ea", maxFeeRate: "0.001", nonce: 1 }), /percent/u);
});

test("agent names: expiry suffix, 180 day bound, Keeper 30 day bound", () => {
  const now = 1793280000000;
  assert.equal(hc.agentNameWithExpiry("elyia", now + 86_400_000, now), `elyia valid_until ${now + 86_400_000}`);
  assert.throws(() => hc.agentNameWithExpiry("elyia", now - 1, now), /future/u);
  assert.throws(() => hc.agentNameWithExpiry("elyia", now + hc.MAX_AGENT_VALIDITY_MS + 1, now), /180 days/u);
  assert.throws(() => hc.agentNameWithExpiry("elyia agent", now + 1000, now), /Agent names/u);
  assert.equal(hc.keeperAgentName(now + hc.KEEPER_DEFAULT_VALIDITY_MS, now), `elyia-keeper valid_until ${now + hc.KEEPER_DEFAULT_VALIDITY_MS}`);
  assert.throws(() => hc.keeperAgentName(now + hc.KEEPER_MAX_VALIDITY_MS + 1, now), /30 days/u);
  assert.deepEqual(hc.parseAgentName("grid_bot valid_until 1799909269142"), { name: "grid_bot", validUntil: 1799909269142 });
  assert.deepEqual(hc.parseAgentName("elyia"), { name: "elyia", validUntil: null });
});

test("agents may only sign trading L1 actions; the Keeper set is narrower", () => {
  for (const type of hc.USER_SIGNED_ACTION_TYPES) {
    assert.equal(hc.isAgentSignable({ type }), false, type);
    assert.equal(hc.isKeeperSignable({ type }), false, type);
  }
  assert.equal(hc.isAgentSignable({ type: "order" }), true);
  assert.equal(hc.isKeeperSignable({ type: "order" }), true);
  assert.equal(hc.isAgentSignable({ type: "updateIsolatedMargin" }), true);
  assert.equal(hc.isKeeperSignable({ type: "updateIsolatedMargin" }), false);
  assert.equal(hc.isAgentSignable({ type: "vaultTransfer" }), false);
  for (const type of hc.KEEPER_SIGNABLE_ACTIONS) assert.ok(hc.AGENT_SIGNABLE_ACTIONS.includes(type), type);
});

test("splitSignature normalises v and refuses malformed or high-s signatures", async () => {
  const signature = await wallet.signTypedData(hc.l1ActionTypedData({ action: hc.noopAction(), nonce: 1, isMainnet: false }).typedData);
  const split = hc.splitSignature(signature);
  assert.match(split.r, /^0x[0-9a-f]{64}$/u);
  assert.match(split.s, /^0x[0-9a-f]{64}$/u);
  const zeroOne = `${signature.slice(0, 130)}${(split.v - 27).toString(16).padStart(2, "0")}`;
  assert.deepEqual(hc.splitSignature(zeroOne), split);
  assert.throws(() => hc.splitSignature("0x1234"), /65 bytes/u);
  assert.throws(() => hc.splitSignature(`${signature.slice(0, 130)}1d`), /recovery id/u);
  const highS = `${signature.slice(0, 66)}${"f".repeat(64)}1b`;
  assert.throws(() => hc.splitSignature(highS), /high s/u);
});

test("buildExchangeRequest: L1 carries vault and expiry; user-signed carries neither", async () => {
  const order = hc.orderAction([hc.orderWire({ asset: 3, isBuy: true, price: "79650", size: "0.01", kind: { limit: { tif: "Ioc" } } })]);
  const signature = await signL1(order, null, 1793280000000, 1793280120000, false);
  const l1 = hc.buildExchangeRequest({ action: order, nonce: 1793280000000, signature, expiresAfter: 1793280120000, vaultAddress: "0x1719884EB866cb12b2287399b15f7db5e7d775ea" });
  assert.deepEqual(Object.keys(l1), ["action", "nonce", "signature", "vaultAddress", "expiresAfter"]);
  assert.equal(l1.vaultAddress, "0x1719884eb866cb12b2287399b15f7db5e7d775ea");
  assert.deepEqual(Object.keys(hc.buildExchangeRequest({ action: order, nonce: 1, signature: l1.signature })), ["action", "nonce", "signature"]);
  const send = hc.usdSendAction({ hyperliquidChain: "Testnet", signatureChainId: "0x66eee" }, { destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a", amount: "1", time: 1687816341423 });
  const userSignature = await wallet.signTypedData(hc.typedDataForUserAction(send));
  assert.equal(hc.buildExchangeRequest({ action: send, nonce: 1687816341423, signature: userSignature }).nonce, 1687816341423);
  assert.throws(() => hc.buildExchangeRequest({ action: send, nonce: 1687816341424, signature: userSignature }), /nonce/u);
  assert.throws(() => hc.buildExchangeRequest({ action: send, nonce: 1687816341423, signature: userSignature, expiresAfter: 1 }), /expiresAfter/u);
  assert.throws(() => hc.buildExchangeRequest({ action: send, nonce: 1687816341423, signature: userSignature, vaultAddress: "0x1719884eb866cb12b2287399b15f7db5e7d775ea" }), /vaultAddress/u);
});

test("exchange replies map to per-order outcomes (hints, never proof)", () => {
  const outcomes = hc.orderPlacementOutcomes({
    status: "ok",
    response: {
      type: "order",
      data: { statuses: [{ resting: { oid: 77738308 } }, { filled: { totalSz: "0.02", avgPx: "1891.4", oid: 77747314 } }, { error: "Order must have minimum value of $10." }, "waitingForTrigger"] },
    },
  });
  assert.deepEqual(outcomes, [
    { kind: "resting", oid: 77738308 },
    { kind: "filled", oid: 77747314, totalSz: "0.02", avgPx: "1891.4" },
    { kind: "error", message: "Order must have minimum value of $10." },
    { kind: "waiting" },
  ]);
  assert.deepEqual(hc.orderPlacementOutcomes({ status: "err", response: "User or API Wallet 0x0 does not exist." }), [{ kind: "error", message: "User or API Wallet 0x0 does not exist." }]);
  assert.equal(hc.isTerminalOrderStatus("filled"), true);
  assert.equal(hc.isTerminalOrderStatus("open"), false);
  assert.equal(hc.isTerminalOrderStatus("triggered"), false);
  assert.equal(hc.isRejectedOrderStatus("minTradeNtlRejected"), true);
  assert.equal(hc.isRejectedOrderStatus("marginCanceled"), false);
});
