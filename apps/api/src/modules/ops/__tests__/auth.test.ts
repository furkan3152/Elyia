import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createApp } from "../../../app.js";
import { productionIssues, loadConfig } from "../../../config.js";
import { createContext, type AppContext } from "../../../context.js";
import { serve, testConfig, type Served } from "../../../__tests__/support.js";
import { MemoryStore } from "../../../store/memory.js";
import { open, seal, deriveKey } from "../auth/crypto.js";
import { issueToken, verifyToken } from "../auth/session.js";
import { dataCheckString, initDataHash, validateInitData } from "../auth/telegram.js";

const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

let ctx: AppContext;
let server: Served;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.url}${path}`, { headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function signIn(account = owner, mutate: (message: Parameters<typeof createSiweMessage>[0]) => Parameters<typeof createSiweMessage>[0] = (m) => m) {
  const nonce = (await post("/v1/auth/siwe/nonce", {})).body as { nonce: string; domain: string; uri: string };
  const message = createSiweMessage(mutate({ address: account.address, chainId: 99801, domain: nonce.domain, nonce: nonce.nonce, uri: nonce.uri, version: "1", issuedAt: new Date() }));
  const signature = await account.signMessage({ message });
  return { message, signature, verify: () => post("/v1/auth/siwe/verify", { message, signature }) };
}

before(async () => {
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_ADMIN_ADDRESSES: owner.address, TELEGRAM_BOT_TOKEN: "123:test-token" }), { store: new MemoryStore() });
  server = await serve(createApp(ctx));
});

after(async () => {
  await server.close();
});

describe("ops: SIWE sign-in", () => {
  it("verifies an EIP-4361 message and returns a session with roles", async () => {
    const { verify } = await signIn();
    const result = await verify();
    assert.equal(result.status, 200);
    const session = result.body.session as { address: string; roles: string[] };
    assert.equal(session.address, owner.address.toLowerCase());
    assert.deepEqual(session.roles, ["user", "admin"]);
    const me = await get("/v1/auth/session", { "Elyia-Session": result.body.token as string });
    assert.equal(me.status, 200);
    assert.equal((me.body as { address: string }).address, owner.address.toLowerCase());
  });

  it("uses each nonce once (a replay is refused)", async () => {
    const { verify } = await signIn(other);
    assert.equal((await verify()).status, 200);
    const replay = await verify();
    assert.equal(replay.status, 401);
    assert.equal((replay.body.error as { code: string }).code, "SIWE_NONCE");
  });

  it("refuses another domain, an unknown chain and a wrong signer", async () => {
    const domain = await (await signIn(owner, (m) => ({ ...m, domain: "evil.example", uri: "https://evil.example" }))).verify();
    assert.equal((domain.body.error as { code: string }).code, "SIWE_DOMAIN");
    const chain = await (await signIn(owner, (m) => ({ ...m, chainId: 5 }))).verify();
    assert.equal((chain.body.error as { code: string }).code, "SIWE_CHAIN");
    const nonce = (await post("/v1/auth/siwe/nonce", {})).body as { nonce: string; domain: string; uri: string };
    const message = createSiweMessage({ address: owner.address, chainId: 99801, domain: nonce.domain, nonce: nonce.nonce, uri: nonce.uri, version: "1", issuedAt: new Date() });
    const forged = await post("/v1/auth/siwe/verify", { message, signature: await other.signMessage({ message }) });
    assert.equal((forged.body.error as { code: string }).code, "SIWE_SIGNATURE");
  });

  it("refuses expired messages", async () => {
    const expired = await (await signIn(owner, (m) => ({ ...m, expirationTime: new Date(Date.now() - 1_000) }))).verify();
    assert.equal((expired.body.error as { code: string }).code, "SIWE_EXPIRED");
  });
});

describe("ops: session tokens", () => {
  it("rejects tampered and expired tokens, and logout revokes", async () => {
    const { token } = issueToken(ctx, { address: other.address });
    assert.ok(verifyToken(ctx, token));
    const [prefix, body, mac] = token.split(".");
    const claims = JSON.parse(Buffer.from(body as string, "base64url").toString()) as Record<string, unknown>;
    const forged = `${prefix}.${Buffer.from(JSON.stringify({ ...claims, sub: owner.address.toLowerCase() })).toString("base64url")}.${mac}`;
    assert.equal(verifyToken(ctx, forged), null);
    assert.equal(verifyToken(ctx, issueToken(ctx, { address: other.address, ttlMs: -1 }).token), null);
    assert.equal((await get("/v1/auth/session", { "Elyia-Session": forged })).status, 401);
    assert.equal((await post("/v1/auth/logout", {}, { "Elyia-Session": token })).status, 200);
    assert.equal((await get("/v1/auth/session", { "Elyia-Session": token })).status, 401);
  });

  it("admin routes need an admin wallet (403 otherwise, 401 without a session)", async () => {
    assert.equal((await get("/v1/admin/flags")).status, 401);
    const user = issueToken(ctx, { address: other.address }).token;
    assert.equal((await get("/v1/admin/flags", { "Elyia-Session": user })).status, 403);
    const admin = issueToken(ctx, { address: owner.address }).token;
    assert.equal((await get("/v1/admin/flags", { "Elyia-Session": admin })).status, 200);
  });

  it("production refuses to run without ELYIA_SESSION_SECRET", () => {
    assert.ok(productionIssues(loadConfig({ NODE_ENV: "production" })).some((issue) => issue.startsWith("ELYIA_SESSION_SECRET")));
    assert.deepEqual(productionIssues(loadConfig({ NODE_ENV: "production", ELYIA_SESSION_SECRET: "x".repeat(32) })), []);
  });

  it("seals with AES-256-GCM bound to its context", () => {
    const key = deriveKey("k".repeat(40), "test");
    const box = seal(key, "secret", "ctx:a");
    assert.equal(open(key, box, "ctx:a"), "secret");
    assert.throws(() => open(key, box, "ctx:b"));
    assert.throws(() => open(deriveKey("j".repeat(40), "test"), box, "ctx:a"));
  });
});

describe("ops: Telegram Mini App initData", () => {
  function initData(token: string, authDate: number, user = { id: 42, first_name: "Ada", language_code: "tr" }) {
    const params = new URLSearchParams({ auth_date: String(authDate), query_id: "AAE", user: JSON.stringify(user) });
    params.set("hash", initDataHash(token, dataCheckString(params)));
    return params.toString();
  }

  it("validates the HMAC chain and freshness", () => {
    const now = Date.now();
    const data = initData("123:test-token", Math.floor(now / 1000));
    assert.equal(validateInitData(data, "123:test-token", now)?.id, 42);
    assert.equal(validateInitData(data, "123:other", now), null);
    assert.equal(validateInitData(initData("123:test-token", Math.floor(now / 1000) - 2 * 86_400), "123:test-token", now), null);
    // The secret is HMAC("WebAppData", token), as Telegram documents.
    const secret = createHmac("sha256", "WebAppData").update("123:test-token").digest();
    assert.equal(initDataHash("123:test-token", "a=1"), createHmac("sha256", secret).update("a=1").digest("hex"));
  });

  it("signs in a linked Telegram user only", async () => {
    const now = Date.now();
    const notLinked = await post("/v1/auth/telegram", { initData: initData("123:test-token", Math.floor(now / 1000), { id: 777, first_name: "X", language_code: "en" }) });
    assert.equal((notLinked.body.error as { code: string }).code, "TELEGRAM_NOT_LINKED");
    const bad = await post("/v1/auth/telegram", { initData: "auth_date=1&hash=" + "0".repeat(64) });
    assert.equal(bad.status, 401);
  });
});
