import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSiweMessage, checkSiweMessage, hasRole, isExpired, minutesLeft, parseStoredSession, primaryRole, serializeSession, shortAddress, siweChainId, timeLeftLabel, tokenForAddress } from "../sessionModel";

const ADDRESS = "0x7a00000000000000000000000000000000c41e";
const ADDR = "0x7A0000000000000000000000000000000000c41E";
const NOW = Date.parse("2026-11-01T12:00:00Z");
const view = { address: ADDR, roles: ["user", "admin"] as const, issuedAt: "2026-11-01T11:00:00Z", expiresAt: "2026-11-01T12:47:30Z", sessionId: "ses_1", telegramUserId: null };

describe("stored sessions", () => {
  it("round-trips and drops expired or malformed copies", () => {
    const raw = serializeSession({ token: "es1.payload.mac", session: { ...view, roles: [...view.roles] } });
    assert.equal(parseStoredSession(raw, NOW)?.session.address, ADDR);
    assert.equal(parseStoredSession(raw, Date.parse("2026-11-01T13:00:00Z")), null);
    assert.equal(parseStoredSession("{not json", NOW), null);
    assert.equal(parseStoredSession(JSON.stringify({ token: "es1.payload.mac", session: { ...view, roles: ["root"] } }), NOW), null);
    assert.equal(parseStoredSession(JSON.stringify({ token: "x", session: view }), NOW), null);
    assert.equal(parseStoredSession(null, NOW), null);
  });

  it("counts time left and reads roles", () => {
    assert.equal(minutesLeft(view, NOW), 47);
    assert.equal(timeLeftLabel(view, NOW), "47 min left");
    assert.equal(timeLeftLabel({ expiresAt: "2026-11-02T11:00:00Z" }, NOW), "23 h left");
    assert.equal(timeLeftLabel(view, Date.parse("2026-11-01T13:00:00Z")), "expired");
    assert.equal(isExpired(view, NOW), false);
    assert.equal(hasRole(view, "admin"), true);
    assert.equal(hasRole(view, "developer"), false);
    assert.equal(hasRole(null, "user"), false);
    assert.equal(primaryRole(view), "admin");
    assert.equal(primaryRole({ roles: ["user", "developer"] }), "developer");
    assert.equal(primaryRole(null), null);
    assert.equal(shortAddress(ADDR), "0x7A00…c41E");
  });
});

describe("one session for every page", () => {
  it("hands the token to the wallet it belongs to, in any case, until it expires", () => {
    const stored = { token: "es1.payload.mac", session: { ...view, roles: [...view.roles] } };
    assert.equal(tokenForAddress(stored, ADDR, NOW), "es1.payload.mac");
    assert.equal(tokenForAddress(stored, ADDR.toLowerCase(), NOW), "es1.payload.mac");
    assert.equal(tokenForAddress(stored, "0x1111111111111111111111111111111111111111", NOW), null, "another wallet gets no token");
    assert.equal(tokenForAddress(stored, null, NOW), null);
    assert.equal(tokenForAddress(stored, ADDR, Date.parse("2026-11-01T13:00:00Z")), null);
    assert.equal(tokenForAddress(null, ADDR, NOW), null);
  });
});

describe("SIWE message", () => {
  const fields = { domain: "elyia.xyz", address: ADDR, statement: "Sign in to Elyia.", uri: "https://elyia.xyz", chainId: 99801, nonce: "abcd1234efgh", issuedAt: "2026-11-01T12:00:00.000Z", expirationTime: "2026-11-01T12:10:00.000Z" };

  it("builds EIP-4361 text in the standard field order", () => {
    const message = buildSiweMessage(fields);
    const lines = message.split("\n");
    assert.equal(lines[0], "elyia.xyz wants you to sign in with your Ethereum account:");
    assert.equal(lines[1], ADDR);
    assert.equal(lines[3], "Sign in to Elyia.");
    assert.deepEqual(lines.slice(5), ["URI: https://elyia.xyz", "Version: 1", "Chain ID: 99801", "Nonce: abcd1234efgh", "Issued At: 2026-11-01T12:00:00.000Z", "Expiration Time: 2026-11-01T12:10:00.000Z"]);
  });

  it("accepts its own message and refuses other sites, addresses, expiries and missing nonces", () => {
    const message = buildSiweMessage(fields);
    assert.deepEqual(checkSiweMessage(message, { address: ADDR.toLowerCase(), host: "elyia.xyz", now: NOW }), { ok: true });
    assert.equal(checkSiweMessage(message, { address: ADDR, host: "evil.example", now: NOW }).ok, false);
    assert.equal(checkSiweMessage(message, { address: ADDRESS.replace("7a", "7b"), host: "elyia.xyz", now: NOW }).ok, false);
    assert.equal(checkSiweMessage(message, { address: ADDR, host: "elyia.xyz", now: Date.parse("2026-11-01T12:30:00Z") }).ok, false);
    assert.equal(checkSiweMessage(buildSiweMessage({ ...fields, nonce: "" }), { address: ADDR, host: "elyia.xyz", now: NOW }).ok, false);
    assert.equal(checkSiweMessage(buildSiweMessage({ ...fields, uri: "https://other.example" }), { address: ADDR, host: "elyia.xyz", now: NOW }).ok, false);
    assert.equal(checkSiweMessage("hello", { address: ADDR, host: "elyia.xyz", now: NOW }).ok, false);
  });

  it("names the wallet's chain when the server serves it, else Elysium", () => {
    assert.equal(siweChainId(998, [1, 998, 99801]), 998);
    assert.equal(siweChainId(137, [1, 998, 99801]), 99801);
    assert.equal(siweChainId(undefined, [1, 42161]), 1);
    assert.equal(siweChainId(1, []), null);
  });
});
