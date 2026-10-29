import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";

import { orderAction, orderWire } from "@elyia/core/hypercore/actions";
import { actionHash } from "@elyia/core/hypercore/signing";
import { DEFAULT_RULE_BOOK } from "@elyia/core/policy";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { agentHealth, buildApproveAgent, buildRevokeAgent, daysLeft, listAgents, validUntilFor, WEB_AGENT_NAME } from "../approve";
import { memoryNonceStorage, NonceManager, nonceStorageKey } from "../nonce";
import { dropKey, holdKey, isExpired, signerFor } from "../agentSession";
import { AgentExpiredError, checkGuard, ConfirmationRequiredError, GuardBlockedError, signAgentAction } from "../signer";
import { effectiveRuleBook } from "../../trading/guard";
import { AgentVault, deviceLabelFrom, VAULT_DB } from "../vault";
import { FakeIndexedDb } from "./fakeIndexedDb";
import { guardFactsFor, type GuardContext } from "../../trading/guard";

const MASTER = "0x4547b9e33f07965711f67d0be2423939a4e33af5";
const DAY = 86_400_000;

function vaultWith(idb = new FakeIndexedDb()) {
  return { idb, vault: new AgentVault({ indexedDB: idb.asFactory(), subtle: webcrypto.subtle as unknown as SubtleCrypto, deviceLabel: "Test on Node" }) };
}

describe("nonce manager", () => {
  it("is monotonic within a millisecond and across instances", () => {
    const storage = memoryNonceStorage();
    let now = 1_793_290_000_000;
    const a = new NonceManager("0xAbC0000000000000000000000000000000000001", storage, () => now);
    assert.equal(a.next(), now);
    assert.equal(a.next(), now + 1);
    assert.equal(a.next(), now + 2);
    // A second tab (another manager over the same storage) continues above the persisted value.
    const b = new NonceManager("0xabc0000000000000000000000000000000000001", storage, () => now);
    assert.equal(b.next(), now + 3);
    now += 10_000;
    assert.equal(a.next(), now);
    assert.equal(storage.values.get(nonceStorageKey("0xabc0000000000000000000000000000000000001")), String(now));
  });

  it("ignores a persisted value from a broken clock far in the future", () => {
    const storage = memoryNonceStorage();
    const now = 1_793_290_000_000;
    storage.set(nonceStorageKey("0x01"), String(now + 5 * DAY));
    const manager = new NonceManager("0x01", storage, () => now);
    assert.equal(manager.next(), now);
  });

  it("survives a storage that throws", () => {
    const now = 1_700_000_000_000;
    const manager = new NonceManager("0x02", { get: () => { throw new Error("blocked"); }, set: () => { throw new Error("blocked"); } }, () => now);
    assert.equal(manager.next(), now);
    assert.equal(manager.next(), now + 1);
  });
});

describe("agent key vault", () => {
  it("round-trips a key through AES-GCM with a non-extractable wrapping key", async () => {
    const { idb, vault } = vaultWith();
    const privateKey = generatePrivateKey();
    const agent = privateKeyToAccount(privateKey);
    const meta = await vault.save({ env: "testnet", master: MASTER.toUpperCase().replace("0X", "0x"), agentAddress: agent.address, privateKey, name: `${WEB_AGENT_NAME} valid_until 1800000000000`, validUntil: 1_800_000_000_000, status: "pending" });
    assert.equal(meta.master, MASTER);
    assert.equal(meta.agentAddress, agent.address.toLowerCase());
    assert.equal(meta.deviceLabel, "Test on Node");

    const { privateKey: back, meta: loaded } = await vault.decrypt("testnet", MASTER);
    assert.equal(back, privateKey);
    assert.equal(loaded.status, "pending");

    // Nothing in the database is the key in clear, and the wrapping key cannot be exported.
    const db = idb.databases.get(VAULT_DB)!;
    const raw = JSON.stringify(db.dump("agents").map((record) => ({ ...(record as object), ciphertext: Buffer.from((record as { ciphertext: ArrayBuffer }).ciphertext).toString("hex") })));
    assert.ok(!raw.includes(privateKey.slice(2)), "the private key must never be stored in clear");
    const [wrap] = db.dump("wrapKeys") as CryptoKey[];
    assert.ok(wrap);
    assert.equal(wrap.extractable, false);
    await assert.rejects(webcrypto.subtle.exportKey("raw", wrap as unknown as webcrypto.CryptoKey));
  });

  it("binds the ciphertext to its record (a swapped record fails to decrypt)", async () => {
    const { idb, vault } = vaultWith();
    const keyA = generatePrivateKey();
    const keyB = generatePrivateKey();
    const other = "0x1111111111111111111111111111111111111111";
    await vault.save({ env: "testnet", master: MASTER, agentAddress: privateKeyToAccount(keyA).address, privateKey: keyA, name: "a", validUntil: 1, status: "active" });
    await vault.save({ env: "testnet", master: other, agentAddress: privateKeyToAccount(keyB).address, privateKey: keyB, name: "b", validUntil: 1, status: "active" });
    const store = idb.databases.get(VAULT_DB)!.store("agents");
    const recordA = store.get(`testnet:${MASTER}`) as Record<string, unknown>;
    const recordB = store.get(`testnet:${other}`) as Record<string, unknown>;
    // Move B's ciphertext under A's identity.
    store.set(`testnet:${MASTER}`, { ...recordA, iv: recordB.iv, ciphertext: recordB.ciphertext });
    await assert.rejects(vault.decrypt("testnet", MASTER), /could not be decrypted/u);
    assert.equal((await vault.decrypt("testnet", other)).privateKey, keyB);
  });

  it("keeps lock state, lists per device and removes", async () => {
    const { vault } = vaultWith();
    const key = generatePrivateKey();
    await vault.save({ env: "testnet", master: MASTER, agentAddress: privateKeyToAccount(key).address, privateKey: key, name: "x", validUntil: 5, status: "pending" });
    const locked = await vault.update("testnet", MASTER, { status: "active", locked: true });
    assert.equal(locked?.locked, true);
    assert.equal(locked?.status, "active");
    assert.equal((await vault.load("testnet", MASTER))?.locked, true);
    assert.equal((await vault.load("mainnet", MASTER)), null);
    const list = await vault.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.deviceLabel, "Test on Node");
    assert.ok(!("ciphertext" in (list[0] as object)), "listings never carry the ciphertext");
    await vault.remove("testnet", MASTER);
    assert.equal(await vault.load("testnet", MASTER), null);
    await assert.rejects(vault.decrypt("testnet", MASTER), /No trading key/u);
  });

  it("refuses to work without IndexedDB or WebCrypto, in plain words", async () => {
    const noDb = new AgentVault({ indexedDB: null, subtle: webcrypto.subtle as unknown as SubtleCrypto });
    assert.match(noDb.unavailableReason() ?? "", /IndexedDB/u);
    await assert.rejects(noDb.load("testnet", MASTER), /IndexedDB/u);
    const noCrypto = new AgentVault({ indexedDB: new FakeIndexedDb().asFactory(), subtle: null });
    assert.match(noCrypto.unavailableReason() ?? "", /WebCrypto/u);
  });

  it("labels devices without identifying them", () => {
    assert.equal(deviceLabelFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome on macOS");
    assert.equal(deviceLabelFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox on Windows");
    assert.equal(deviceLabelFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  });
});

describe("approveAgent payloads", () => {
  const now = 1_793_290_000_000;

  it("names the key elyia-web valid_until <ms> and signs in the wallet's chain domain", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const agent = privateKeyToAccount(generatePrivateKey());
    const validUntil = validUntilFor(30, now);
    assert.equal(validUntil, now + 30 * DAY);
    const payload = buildApproveAgent({ hyperliquidChain: "Testnet", walletChainId: 99801, agentAddress: agent.address, validUntil, nonce: now, now });
    assert.equal(payload.agentName, `elyia-web valid_until ${validUntil}`);
    assert.equal(payload.action.signatureChainId, "0x185d9");
    assert.equal(payload.action.hyperliquidChain, "Testnet");
    assert.equal(payload.action.agentAddress, agent.address.toLowerCase());
    assert.equal(payload.typedData.domain.chainId, 99801);
    assert.equal(payload.typedData.primaryType, "HyperliquidTransaction:ApproveAgent");
    assert.deepEqual(Object.keys(payload.typedData.message), ["hyperliquidChain", "agentAddress", "agentName", "nonce"]);
    // HyperEVM-connected wallets sign in 998's domain.
    assert.equal(buildApproveAgent({ hyperliquidChain: "Testnet", walletChainId: 998, agentAddress: agent.address, validUntil, nonce: now, now }).action.signatureChainId, "0x3e6");

    const typed = payload.typedData as unknown as Parameters<typeof wallet.signTypedData>[0];
    const signature = await wallet.signTypedData(typed);
    assert.equal((await recoverTypedDataAddress({ ...(typed as object), signature } as Parameters<typeof recoverTypedDataAddress>[0])).toLowerCase(), wallet.address.toLowerCase());
  });

  it("caps the longest expiry under HyperCore's 180 days and refuses beyond", () => {
    const longest = validUntilFor(180, now);
    assert.ok(longest < now + 180 * DAY && longest > now + 179 * DAY);
    assert.doesNotThrow(() => buildApproveAgent({ hyperliquidChain: "Testnet", walletChainId: 99801, agentAddress: MASTER, validUntil: longest, nonce: now, now }));
    assert.throws(() => buildApproveAgent({ hyperliquidChain: "Testnet", walletChainId: 99801, agentAddress: MASTER, validUntil: now + 181 * DAY, nonce: now, now }));
  });

  it("revokes by approving a short-lived placeholder under the same name", () => {
    const placeholder = privateKeyToAccount(generatePrivateKey()).address;
    const revoke = buildRevokeAgent({ hyperliquidChain: "Testnet", walletChainId: 99801, agentAddress: placeholder, nonce: now, now });
    assert.match(revoke.agentName, /^elyia-web valid_until \d+$/u);
    assert.ok(revoke.validUntil - now <= 10 * 60_000);
  });

  it("lists agents per device and reads their health", () => {
    const local = "0xaaaa000000000000000000000000000000000001";
    const agents = [
      { name: "fs-38ae1663", address: "0xbbbb000000000000000000000000000000000002" as const, validUntil: now + DAY },
      { name: "elyia-web", address: "0xAAAA000000000000000000000000000000000001" as const, validUntil: now + 3 * DAY },
    ];
    const listed = listAgents(agents, local, now);
    assert.equal(listed[0]?.thisDevice, true);
    assert.equal(listed[0]?.isElyia, true);
    assert.equal(listed[1]?.thisDevice, false);
    assert.equal(agentHealth(agents, local, now), "active");
    assert.equal(agentHealth(agents, local, now + 4 * DAY), "expired");
    assert.equal(agentHealth(agents, "0xcccc000000000000000000000000000000000003", now), "missing");
    assert.equal(daysLeft(now + 3 * DAY + 5, now), 3);
  });
});

describe("agent signer behind the Rule Book", () => {
  const now = 1_793_290_000_000;
  const market = { coin: "ETH", displayName: "ETH", kind: "perp" as const, quote: "USD", asset: 4 };
  const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({
    mode: "testnet",
    networkKey: "hypercore-testnet",
    master: MASTER,
    marketByAsset: (asset) => (asset === 4 ? market : null),
    priceOf: () => 2300,
    leverageOf: () => 5,
    trading: { openOrders: 2, openNotionalUsdMicros: 1_000_000_000n, dayVolumeUsdMicros: 0n, dayRealizedLossUsdMicros: 0n },
    dayUsdMicros: 0n,
    weekUsdMicros: 0n,
    now,
    ...overrides,
  });
  const order = (sz: string) => orderAction([orderWire({ asset: 4, isBuy: true, price: "2300", size: sz, kind: { limit: { tif: "Gtc" } } })]);

  it("signs an allowed order and the signature recovers to the agent", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    let signed = 0;
    const deps = {
      isMainnet: false,
      nonces: new NonceManager(agent.address, memoryNonceStorage(), () => now),
      signTypedData: async (typed: unknown) => {
        signed += 1;
        return agent.signTypedData(typed as Parameters<typeof agent.signTypedData>[0]);
      },
    };
    const action = order("0.1");
    const result = await signAgentAction(deps, action, { book: DEFAULT_RULE_BOOK, facts: guardFactsFor(action, ctx()) });
    assert.equal(signed, 1);
    assert.equal(result.evaluation.decision, "allow");
    assert.equal(result.request.nonce, now);
    assert.equal(result.request.expiresAfter, now + 45_000);
    // The connection id the agent signed is the core action hash of exactly this request.
    const connectionId = actionHash(action, null, result.request.nonce, result.request.expiresAfter ?? null);
    const typed = { domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" as const }, types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] }, primaryType: "Agent" as const, message: { source: "b", connectionId } };
    const signature = `${result.request.signature.r}${result.request.signature.s.slice(2)}${result.request.signature.v.toString(16)}` as `0x${string}`;
    assert.equal((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase(), agent.address.toLowerCase());
  });

  it("never touches the key when the Rule Book denies or facts are missing", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    let signed = 0;
    const deps = { isMainnet: false, nonces: new NonceManager(agent.address, memoryNonceStorage(), () => now), signTypedData: async () => { signed += 1; return "0x" as `0x${string}`; } };
    // $23,000 is above the default $10,000 per-order limit.
    const big = order("10");
    await assert.rejects(signAgentAction(deps, big, { book: DEFAULT_RULE_BOOK, facts: guardFactsFor(big, ctx()) }), GuardBlockedError);
    // Open-order count unknown: fail closed.
    const small = order("0.1");
    await assert.rejects(signAgentAction(deps, small, { book: DEFAULT_RULE_BOOK, facts: guardFactsFor(small, ctx({ trading: { openOrders: null, openNotionalUsdMicros: 0n, dayVolumeUsdMicros: 0n, dayRealizedLossUsdMicros: 0n } })) }), /does not|refuses|unknown/u);
    // No guard at all.
    await assert.rejects(signAgentAction(deps, small, null), GuardBlockedError);
    // Facts for a different action.
    await assert.rejects(signAgentAction(deps, small, { book: DEFAULT_RULE_BOOK, facts: guardFactsFor({ type: "cancel", cancels: [{ a: 4, o: 1 }] }, ctx()) }), /does not describe/u);
    assert.equal(signed, 0);
  });

  it("asks for confirmation above the threshold and signs once confirmed", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    const deps = { isMainnet: false, nonces: new NonceManager(agent.address, memoryNonceStorage(), () => now), signTypedData: (typed: unknown) => agent.signTypedData(typed as Parameters<typeof agent.signTypedData>[0]) };
    // $3,450 is above the default $2,500 confirmation threshold.
    const action = order("1.5");
    const guard = { book: DEFAULT_RULE_BOOK, facts: guardFactsFor(action, ctx()) };
    assert.throws(() => checkGuard(action, guard, false), ConfirmationRequiredError);
    const result = await signAgentAction(deps, action, guard, { confirmed: true });
    assert.equal(result.evaluation.decision, "confirm");
  });

  it("signs de-risking actions whatever the limits say, but never an opening order under them", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    let signed = 0;
    const deps = { isMainnet: false, nonces: new NonceManager(agent.address, memoryNonceStorage(), () => now), signTypedData: async (typed: unknown) => ((signed += 1), agent.signTypedData(typed as Parameters<typeof agent.signTypedData>[0])) };
    const strict = effectiveRuleBook({ paused: true, markets: ["BTC"], maxSlippageBps: 5, reduceOnly: true }).book;
    const blind = ctx({ trading: { openOrders: null, openNotionalUsdMicros: null, dayVolumeUsdMicros: null, dayRealizedLossUsdMicros: null }, dayUsdMicros: null, weekUsdMicros: null, marketSlippageBps: 800 });
    const close = orderAction([orderWire({ asset: 4, isBuy: false, price: "2100", size: "3", reduceOnly: true, kind: { limit: { tif: "Ioc" } } })]);
    const signedClose = await signAgentAction(deps, close, { book: strict, facts: guardFactsFor(close, blind) });
    assert.equal(signedClose.evaluation.decision, "allow");
    assert.ok(signedClose.evaluation.waived.length > 0, "the waived limits are reported");
    const cancel = { type: "cancel" as const, cancels: [{ a: 4, o: 77 }] };
    await signAgentAction(deps, cancel, { book: strict, facts: guardFactsFor(cancel, ctx({ mode: "mainnet", networkKey: "hypercore-mainnet" })) });
    assert.equal(signed, 2);
    // The same order without reduce-only is refused: the lane reads the action, not the caller's facts.
    const opening = orderAction([orderWire({ asset: 4, isBuy: false, price: "2100", size: "3", kind: { limit: { tif: "Ioc" } } })]);
    await assert.rejects(signAgentAction(deps, opening, { book: strict, facts: guardFactsFor(close, blind) }), GuardBlockedError);
    assert.equal(signed, 2);
  });

  it("never signs with an expired key, and forgets it", async () => {
    const privateKey = generatePrivateKey();
    const agent = privateKeyToAccount(privateKey);
    let signed = 0;
    const deps = { isMainnet: false, validUntil: now - 1, now: () => now, nonces: new NonceManager(agent.address, memoryNonceStorage(), () => now), signTypedData: async () => ((signed += 1), "0x" as `0x${string}`) };
    const action = order("0.1");
    await assert.rejects(signAgentAction(deps, action, { book: DEFAULT_RULE_BOOK, facts: guardFactsFor(action, ctx()) }), AgentExpiredError);
    assert.equal(signed, 0);
    assert.equal(isExpired({ validUntil: now }, now), true);
    assert.equal(isExpired({ validUntil: now + 1 }, now), false);
    const meta = { id: "testnet:x", env: "testnet" as const, master: MASTER, agentAddress: agent.address.toLowerCase(), name: "elyia-web valid_until 1", validUntil: now + DAY, createdAt: now, status: "active" as const, locked: false, deviceLabel: "Test" };
    holdKey("t1", meta, privateKey);
    const live = signerFor("t1", false, now);
    assert.equal(live?.validUntil, now + DAY);
    assert.equal(live?.address.toLowerCase(), agent.address.toLowerCase());
    assert.equal(signerFor("t1", false, now + DAY), null, "past valid_until the key is dropped");
    assert.equal(signerFor("t1", false, now), null, "and stays dropped");
    assert.throws(() => holdKey("t2", { ...meta, agentAddress: "0x0000000000000000000000000000000000000001" }, privateKey), /does not match/u);
    dropKey("t2");
  });
});
