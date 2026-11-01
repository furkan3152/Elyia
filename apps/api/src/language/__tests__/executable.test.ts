/**
 * The reader and the engine agree on what executes: the language layer takes
 * executability from the running engine's adapters (`activeProtocolIds` ->
 * `withExecutable`, the set GET /v1/protocols reports), never from a list
 * of its own. Every venue the engine executes reads without the
 * "cannot execute through it yet" warning; venues it does not execute
 * still get it.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ParseIntentResponse } from "@elyia/core/api/language";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { engineFor } from "../../engine/index.js";
import { activeProtocolIds } from "../../engine/registry.js";
import { ENGINE_ONLY_IDS, liveRegistry } from "../../modules/discovery/registry.js";
import { routedFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { executableOf, readIntent, readText } from "../index.js";
import { REGISTRY_EXECUTABLE, VENUE_WORDS } from "../venues.js";

const NOW = Date.UTC(2026, 9, 31);

/** One sentence per venue the engine executes (a new executable venue must add one). */
const SENTENCES: Readonly<Record<string, string>> = {
  "kalos-v3": "swap 10 KALOS to WHYPE on kalos v3",
  "dex-da-costa": "swap 1 HYPE to USDC on dex da costa",
  hexswap: "swap 1 HYPE to USDC on hexswap",
  perpme: "swap 1 HYPE to USDC on perpme v3",
  "hyperswap-v3": "swap 1 HYPE to USDC on hyperswap",
  signal: "swap 1 HYPE to USDC on signal",
  "kalos-stkalos": "stake 10 KALOS in the kalos vault",
  kinetiq: "stake 100 HYPE with kinetiq",
  cheshire: "lend 100 USDC on cheshire",
  "elyra-lending": "lend 100 USDC on elyra",
  "elysium-canonical-bridge": "bridge 20 HYPE to Elysium with the canonical bridge",
  "elysium-mirror-bridge": "bridge 20 HYPE to Elysium with the mirror bridge",
};

const NOT_EXECUTABLE: Readonly<Record<string, string>> = {
  ascend: "swap 1 HYPE to USDC on ascend",
  "hypercore-vaults": "deposit 100 USDC to hlp",
  "hypercore-staking": "stake 100 HYPE with native staking",
};

const warned = (reading: { readonly warnings: readonly { readonly code: string }[] }) => reading.warnings.some((warning) => warning.code === "VENUE_NOT_EXECUTABLE");
const names = (reading: { readonly goals: readonly unknown[] }, id: string) => JSON.stringify(reading.goals).includes(`"${id}"`);

describe("language executability = engine executability", () => {
  let ctx: AppContext;
  let served: Served;
  let engineSet: ReadonlySet<string>;

  before(async () => {
    ctx = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_SESSION_SECRET: "x".repeat(32) }), { fetch: routedFetch({}) });
    served = await serve(createApp(ctx));
    engineSet = new Set(activeProtocolIds(engineFor(ctx).registry.adapters).filter((id) => !ENGINE_ONLY_IDS.has(id)));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("reads executability from the running engine (the same set GET /v1/protocols reports)", () => {
    assert.deepEqual([...executableOf(ctx)].sort(), [...liveRegistry(ctx).executableIds].sort());
    assert.deepEqual([...executableOf(ctx)].sort(), [...engineSet].sort());
    assert.deepEqual([...REGISTRY_EXECUTABLE].sort(), [...engineSet].sort(), "the core registry's pinned set is the engine's");
  });

  it("has a sentence for every venue word the engine executes", () => {
    const executableWords = VENUE_WORDS.filter((venue) => engineSet.has(venue.id)).map((venue) => venue.id).sort();
    assert.deepEqual(Object.keys(SENTENCES).sort(), executableWords);
  });

  for (const [id, text] of Object.entries(SENTENCES)) {
    it(`${id}: reads without the not-executable warning`, async () => {
      const pure = readText(text, { facts: { now: NOW }, executable: executableOf(ctx) });
      assert.notEqual(pure.status, "unreadable", text);
      assert.ok(names(pure, id), `${text} names ${id}`);
      assert.equal(warned(pure), false, `${text}: ${JSON.stringify(pure.warnings)}`);
      // The server path (ctx: the engine's text path) and the default set agree.
      const served = await readIntent(text, { ctx, now: NOW });
      assert.equal(warned(served), false, text);
      assert.equal(warned(readText(text, { facts: { now: NOW } })), false, text);
    });
  }

  for (const [id, text] of Object.entries(NOT_EXECUTABLE)) {
    it(`${id}: a venue the engine does not execute still warns`, () => {
      assert.equal(engineSet.has(id), false);
      assert.equal(warned(readText(text, { facts: { now: NOW }, executable: executableOf(ctx) })), true, text);
    });
  }

  it("follows the set it is given (an engine without the adapter warns)", () => {
    const without = new Set([...engineSet].filter((id) => id !== "cheshire"));
    assert.equal(warned(readText(SENTENCES.cheshire as string, { facts: { now: NOW }, executable: without })), true);
  });

  it("POST /v1/intents/parse: Cheshire reads without the warning", async () => {
    const response = await fetch(`${served.url}/v1/intents/parse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "lend 100 USDC on cheshire" }) });
    const body = (await response.json()) as ParseIntentResponse;
    assert.equal(body.status, "ready");
    assert.equal(warned(body), false, JSON.stringify(body.warnings));
  });
});
