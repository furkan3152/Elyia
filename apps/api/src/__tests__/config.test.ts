import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NETWORKS } from "@elyia/core";
import { ConfigError, DEFAULT_AGENT_MODEL, DEFAULT_HYPERLIQUID_WEIGHT_PER_MINUTE, loadConfig, parseOrigin } from "../config.js";

describe("loadConfig", () => {
  it("applies local development defaults", () => {
    const config = loadConfig({});
    assert.equal(config.env, "development");
    assert.equal(config.port, 3001);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.mode, "testnet");
    assert.deepEqual(config.webOrigins, ["http://localhost:5173", "http://localhost:5174"]);
    assert.equal(config.databaseUrl, null);
    assert.equal(config.sessionSecret, null);
    assert.equal(config.agent.model, DEFAULT_AGENT_MODEL);
    assert.equal(config.hyperliquid.weightPerMinute, DEFAULT_HYPERLIQUID_WEIGHT_PER_MINUTE);
    assert.equal(config.trustProxy, 0);
    assert.equal(config.logLevel, "debug");
    assert.equal(config.build.commit, null);
    assert.match(config.version, /^\d+\.\d+\.\d+/u);
    assert.ok(Object.isFrozen(config));
  });

  it("treats empty strings as unset", () => {
    const config = loadConfig({ PORT: "", ELYIA_MODE: "", ELYIA_DATABASE_URL: "  ", TELEGRAM_BOT_TOKEN: "" });
    assert.equal(config.port, 3001);
    assert.equal(config.mode, "testnet");
    assert.equal(config.databaseUrl, null);
    assert.equal(config.telegram.botToken, null);
  });

  it("parses every documented variable", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      PORT: "8080",
      ELYIA_MODE: "mainnet",
      ELYIA_WEB_ORIGIN: "https://elyia.app, https://www.elyia.app/",
      ELYIA_DATABASE_URL: "postgresql://user:pw@db.example.com:5432/elyia",
      ELYIA_SESSION_SECRET: "s".repeat(40),
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_WEBHOOK_SECRET: "webhook_secret_1234",
      TELEGRAM_BOT_USERNAME: "@ElyiaBot",
      ANTHROPIC_API_KEY: "key",
      ELYIA_AGENT_MODEL: "custom-model",
      HYPERDEXER_API_KEY: "hx",
      ELYIA_TRUST_PROXY: "2",
      ELYIA_HL_WEIGHT_PER_MIN: "600",
      RENDER_GIT_COMMIT: "ABCDEF1234567",
    });
    assert.equal(config.env, "production");
    assert.equal(config.port, 8080);
    assert.equal(config.mode, "mainnet");
    // Production drops the localhost defaults; trailing slashes normalize to the origin.
    assert.deepEqual(config.webOrigins, ["https://elyia.app", "https://www.elyia.app"]);
    assert.equal(config.databaseUrl, "postgresql://user:pw@db.example.com:5432/elyia");
    assert.equal(config.telegram.botUsername, "ElyiaBot");
    assert.equal(config.agent.anthropicApiKey, "key");
    assert.equal(config.agent.model, "custom-model");
    assert.equal(config.hyperdexerApiKey, "hx");
    assert.equal(config.trustProxy, 2);
    assert.equal(config.hyperliquid.weightPerMinute, 600);
    assert.equal(config.build.commit, "abcdef1234567");
    assert.equal(config.logLevel, "info");
  });

  it("defaults trust proxy to one hop in production", () => {
    assert.equal(loadConfig({ NODE_ENV: "production" }).trustProxy, 1);
  });

  it("prepends RPC overrides to the core endpoints, deduplicated", () => {
    const publicUrl = (NETWORKS["elysium-testnet"] as { rpcUrls: readonly string[] }).rpcUrls[1] as string;
    const config = loadConfig({ ELYSIUM_TESTNET_RPC_URL: `https://keyed.example.com/abc123, ${publicUrl}` });
    const network = config.networks["elysium-testnet"];
    assert.equal(network.vm, "evm");
    if (network.vm !== "evm") return;
    assert.equal(network.rpcUrls[0], "https://keyed.example.com/abc123");
    assert.equal(network.rpcUrls.filter((url) => url === publicUrl).length, 1);
    assert.equal(network.rpcUrls.length, (NETWORKS["elysium-testnet"] as { rpcUrls: readonly string[] }).rpcUrls.length + 1);
    assert.deepEqual(config.rpcOverrides["elysium-testnet"], ["https://keyed.example.com/abc123", publicUrl]);
    // The core registry itself is never mutated.
    assert.notEqual((NETWORKS["elysium-testnet"] as { rpcUrls: readonly string[] }).rpcUrls[0], "https://keyed.example.com/abc123");
  });

  it("gives prelaunch Elysium mainnet an endpoint only when configured", () => {
    const without = loadConfig({}).networks["elysium-mainnet"];
    assert.equal(without.vm === "evm" && without.rpcUrls.length, 0);
    const withRpc = loadConfig({ ELYSIUM_MAINNET_RPC_URL: "https://rpc-elysium-mainnet.example.com/key" }).networks["elysium-mainnet"];
    assert.deepEqual(withRpc.vm === "evm" && withRpc.rpcUrls, ["https://rpc-elysium-mainnet.example.com/key"]);
  });

  it("reports every invalid variable at once without echoing values", () => {
    try {
      loadConfig({
        PORT: "99999",
        ELYIA_MODE: "devnet",
      });
      assert.fail("expected ConfigError");
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.ok(error.issues.some((issue) => issue.startsWith("PORT")));
      assert.ok(error.issues.some((issue) => issue.startsWith("ELYIA_MODE")));
    }
    try {
      loadConfig({
        ELYIA_WEB_ORIGIN: "https://ok.example.com,ftp://bad.example.com",
        ELYSIUM_TESTNET_RPC_URL: "not a url secret-key-123",
        ELYIA_DATABASE_URL: "mysql://x",
        ELYIA_SESSION_SECRET: "short",
        TELEGRAM_WEBHOOK_SECRET: "bad secret!",
      });
      assert.fail("expected ConfigError");
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.issues.length, 5);
      assert.ok(!error.message.includes("secret-key-123"), "RPC values may hold keys and are never echoed");
    }
  });

  it("validates origins strictly", () => {
    assert.equal(parseOrigin("https://elyia.app", true), "https://elyia.app");
    assert.equal(parseOrigin("https://elyia.app/", true), "https://elyia.app");
    assert.equal(parseOrigin("https://elyia.app/path", true), null);
    assert.equal(parseOrigin("https://user:pw@elyia.app", true), null);
    assert.equal(parseOrigin("http://elyia.app", false), null);
    assert.equal(parseOrigin("http://localhost:5173", false), "http://localhost:5173");
    assert.equal(parseOrigin("http://localhost:5173", true), null);
  });
});
