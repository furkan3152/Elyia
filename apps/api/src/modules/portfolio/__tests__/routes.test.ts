import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findToken } from "@elyia/core";
import type { PortfolioHistory, PortfolioSnapshot, PortfolioStreamSnapshot } from "@elyia/core/api/portfolio";
import { createApp } from "../../../app.js";
import { closeContext, createContext, type AppContext } from "../../../context.js";
import { readSse, routedFetch, serve, testConfig, type Served } from "../../../__tests__/support.js";
import { closeLedgerServices } from "../../markets/services.js";
import { fakeChains, fixture, infoEndpoint, mainnetReferenceAnswers, MAINNET_INFO, socketFactory, testnetMarketAnswers, TESTNET_INFO, type InfoBody } from "../../markets/__tests__/fakes.js";

const ADDRESS = "0x6e190168dc30077b827eb6c1eb7629a7c16f912a";

function userAnswers(): Record<string, unknown> {
  return {
    clearinghouseState: (body: InfoBody) => (body.dex ? { ...fixture<Record<string, unknown>>("testnet-clearinghouse-isolated.json", "portfolio"), assetPositions: [] } : fixture("testnet-clearinghouse-isolated.json", "portfolio")),
    spotClearinghouseState: fixture("testnet-spot-usdc.json", "portfolio"),
    userVaultEquities: fixture("testnet-vault-equities.json", "portfolio"),
    delegatorSummary: fixture("testnet-delegator-summary.json", "portfolio"),
    userNonFundingLedgerUpdates: fixture("testnet-ledger.json", "portfolio"),
    userFills: fixture("testnet-fills.json", "portfolio"),
    userFillsByTime: fixture("testnet-fills.json", "portfolio"),
    userFunding: fixture("testnet-funding.json", "portfolio"),
    portfolio: fixture("testnet-portfolio.json", "portfolio"),
  };
}

describe("portfolio routes (recorded testnet account behind fake HyperCore and EVM reads)", () => {
  let ctx: AppContext;
  let served: Served;
  const calls: InfoBody[] = [];

  before(async () => {
    const elyUsdc = findToken("elysium-testnet", "USDC")?.address?.toLowerCase() as string;
    const khype = findToken("hyperevm-testnet", "kHYPE")?.address?.toLowerCase() as string;
    const routes = {
      [TESTNET_INFO]: infoEndpoint({ ...testnetMarketAnswers(), ...userAnswers() }, calls),
      [MAINNET_INFO]: infoEndpoint({ ...mainnetReferenceAnswers(), ...userAnswers(), perpDexs: [null], allPerpMetas: [] }),
    };
    const base = createContext(testConfig({ ELYIA_RATE_LIMIT_DEFAULT: "10000", ELYIA_RATE_LIMIT_HEAVY: "10000" }), { fetch: routedFetch(routes), createSocket: socketFactory().create });
    ctx = {
      ...base,
      chains: fakeChains({ "hyperevm-testnet": { native: 10n ** 18n, [khype]: 2n * 10n ** 18n }, "elysium-testnet": { [elyUsdc]: 25_000_000n } }),
    };
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    closeLedgerServices(ctx);
    await closeContext(ctx);
  });

  async function get<T>(path: string): Promise<{ status: number; body: T }> {
    const response = await fetch(`${served.url}${path}`);
    return { status: response.status, body: (await response.json()) as T };
  }

  it("GET /v1/portfolio/:address answers one balance sheet across the three layers", async () => {
    const { status, body } = await get<PortfolioSnapshot>(`/v1/portfolio/${ADDRESS.toUpperCase().replace("0X", "0x")}`);
    assert.equal(status, 200);
    assert.equal(body.address, ADDRESS, "addresses are normalized to lower case");
    assert.equal(body.mode, "testnet");
    assert.equal(body.positions.length, 6);
    assert.deepEqual(body.layers.map((layer) => [layer.layer, layer.status]), [
      ["hypercore", "ok"],
      ["hyperevm", "ok"],
      ["elysium", "ok"],
    ]);
    const evmAssets = body.layers.flatMap((layer) => layer.lines).filter((line) => line.layer !== "hypercore").map((line) => line.asset).sort();
    assert.deepEqual(evmAssets, ["HYPE", "USDC", "kHYPE"]);
    assert.ok(body.totals.netWorthUsd > 3_000);
    assert.equal(body.pricing.label, "reference");
    assert.ok(body.pricing.khypeToHype !== null && Math.abs(body.pricing.khypeToHype - 1.0272703501522418) < 1e-12);
    assert.ok(calls.some((call) => call.type === "userNonFundingLedgerUpdates" && call.startTime === 0), "HIP-3 discovery scanned the ledger");
  });

  it("mainnet mode reads HyperCore mainnet and shows Elysium mainnet as unavailable", async () => {
    const { status, body } = await get<PortfolioSnapshot>(`/v1/portfolio/${ADDRESS}?mode=mainnet`);
    assert.equal(status, 200);
    assert.equal(body.pricing.label, "market");
    const elysium = body.layers.find((layer) => layer.layer === "elysium");
    assert.equal(elysium?.status, "unavailable");
    assert.match(elysium?.sources[0]?.message ?? "", /not readable/u);
  });

  it("refuses malformed addresses and modes", async () => {
    const bad = await get<{ error: { code: string } }>("/v1/portfolio/0x1234");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "INVALID_REQUEST");
    const mode = await get<{ error: { code: string } }>(`/v1/portfolio/${ADDRESS}?mode=devnet`);
    assert.equal(mode.status, 400);
  });

  it("GET /v1/portfolio/:address/history merges fills, funding and ledger", async () => {
    const { status, body } = await get<PortfolioHistory>(`/v1/portfolio/${ADDRESS}/history?days=90`);
    assert.equal(status, 200);
    assert.equal(body.sections.fills.status, "ok");
    assert.equal(body.sections.funding.status, "ok");
    assert.equal(body.sections.ledger.status, "ok");
    assert.ok(body.timeline.length > 0);
    assert.ok(Object.keys(body.equity).includes("allTime"));
    const days = await get<{ error: { code: string } }>(`/v1/portfolio/${ADDRESS}/history?days=365`);
    assert.equal(days.status, 400);
  });

  it("GET /v1/portfolio/:address/stream sends a snapshot at once with seq 1", async () => {
    const { status, messages } = await readSse(`${served.url}/v1/portfolio/${ADDRESS}/stream`, (received) => received.some((message) => message.event === "snapshot"), { timeoutMs: 3_000 });
    assert.equal(status, 200);
    const first = messages.find((message) => message.event === "snapshot");
    assert.equal(first?.id, "1");
    const payload = JSON.parse(first?.data ?? "{}") as PortfolioStreamSnapshot;
    assert.equal(payload.seq, 1);
    assert.match(payload.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(payload.snapshot.positions.length, 6);
  });
});
