import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findToken, nativeToken, type TokenDescriptor } from "@elyia/core";
import type { AllMids, ClearinghouseState, SpotClearinghouseState, SpotMeta, UserVaultEquity } from "@elyia/core/hypercore/info";
import { buildReferenceTable } from "../../markets/reference.js";
import { fixture } from "../../markets/__tests__/fakes.js";
import { buildSnapshot, priceCoreBalance, priceToken, type EvmRead, type PortfolioSources } from "../valuation.js";

const mids = fixture<AllMids>("mainnet-mids.json");
const table = buildReferenceTable({ mids, spotMeta: fixture<SpotMeta>("mainnet-spotmeta.json"), khypeToHype: 1.0272703501522418, time: 42 });
const HYPE = Number(mids["@107"]);
const NOW = 1_793_292_000_000;

const isolated = fixture<ClearinghouseState>("testnet-clearinghouse-isolated.json", "portfolio");
const recordedSpot = fixture<SpotClearinghouseState>("testnet-spot-usdc.json", "portfolio");
const vaults = fixture<UserVaultEquity[]>("testnet-vault-equities.json", "portfolio");

function token(network: Parameters<typeof findToken>[0], symbol: string): TokenDescriptor {
  const found = symbol === "HYPE" ? nativeToken(network) : findToken(network, symbol);
  assert.ok(found, `${network} ${symbol} is in the registry`);
  return found;
}

function evm(network: EvmRead["network"], layer: EvmRead["layer"], balances: Array<[string, bigint | null]>): EvmRead {
  return { network, layer, status: "ok", message: null, blockNumber: 7n, balances: balances.map(([symbol, units]) => ({ token: token(network, symbol), units })) };
}

function sources(overrides: Partial<PortfolioSources> = {}): PortfolioSources {
  return {
    address: "0x6e190168dc30077b827eb6c1eb7629a7c16f912a",
    mode: "testnet",
    now: NOW,
    hypercoreNetwork: "hypercore-testnet",
    perps: [{ dex: "", collateral: { name: "USDC", index: 0 }, state: { value: isolated, status: "ok", message: null } }],
    spot: {
      value: {
        balances: [
          ...recordedSpot.balances,
          { coin: "HYPE", token: 1105, total: "3.5", hold: "0.5", entryNtl: "0" },
          // A tester's token that reuses the name: not linked by the registry, so not priced.
          { coin: "HYPE", token: 9_999, total: "100", hold: "0", entryNtl: "0" },
          { coin: "USDH", token: 1452, total: "20", hold: "0", entryNtl: "0" },
        ],
      },
      status: "ok",
      message: null,
    },
    vaults: { value: vaults, status: "ok", message: null },
    staking: { value: { delegated: "10.0", undelegated: "0.0", totalPendingWithdrawal: "0.0", nPendingWithdrawals: 0 }, status: "ok", message: null },
    evm: [
      evm("hyperevm-testnet", "hyperevm", [
        ["HYPE", 10n ** 18n],
        ["kHYPE", 2n * 10n ** 18n],
        ["tKNTQ", 5n * 10n ** 18n],
        ["USDC", null],
      ]),
      evm("elysium-testnet", "elysium", [
        ["USDC", 100_000_000n],
        ["tUSDC", 50_000_000n],
        ["WHYPE", 5n * 10n ** 17n],
        ["PURR", 0n],
      ]),
    ],
    prices: { table, stale: false },
    vaultNames: new Map([["0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0", "Hyperliquidity Provider (HLP)"]]),
    ...overrides,
  };
}

describe("pricing identity", () => {
  it("prices registry-linked testnet Core tokens at the mainnet reference and nothing else", () => {
    assert.equal(priceCoreBalance(table, "hypercore-testnet", 0, "USDC").priceUsd, 1);
    assert.equal(priceCoreBalance(table, "hypercore-testnet", 1105, "HYPE").priceUsd, HYPE);
    assert.equal(priceCoreBalance(table, "hypercore-testnet", 9_999, "HYPE").priceUsd, null, "a name alone is never trusted on testnet");
    assert.equal(priceCoreBalance(table, "hypercore-mainnet", 150, "HYPE").priceUsd, HYPE);
    assert.equal(priceCoreBalance(table, "hypercore-mainnet", 121, "KHYPE").ratio, 1.0272703501522418);
  });

  it("test and non-canonical tokens have no reference", () => {
    assert.equal(priceToken(table, token("elysium-testnet", "tUSDC")).priceUsd, null);
    assert.equal(priceToken(table, token("hyperevm-testnet", "tKNTQ")).priceUsd, null);
    assert.equal(priceToken(table, token("elysium-testnet", "USDC")).priceUsd, 1);
    assert.equal(priceToken(table, token("elysium-testnet", "WHYPE")).underlying, "HYPE");
  });
});

describe("balance sheet (recorded testnet account + registry balances)", () => {
  const snapshot = buildSnapshot(sources());
  const lines = snapshot.layers.flatMap((layer) => layer.lines);
  const byId = (id: string) => lines.find((entry) => entry.id === id);

  it("values the perp account once, at USDC = 1, with margin in use as locked", () => {
    const perp = byId("hypercore|perp|main");
    assert.equal(perp?.amount, isolated.marginSummary.accountValue);
    assert.equal(perp?.usd, Number(isolated.marginSummary.accountValue));
    assert.equal(Number(perp?.locked), Number((Number(isolated.marginSummary.accountValue) - Number(isolated.withdrawable)).toFixed(8)));
  });

  it("prices spot, vault, staking and wallet lines by the reference rule", () => {
    assert.equal(byId("hypercore|spot|1105")?.usd, Number((3.5 * HYPE).toFixed(6)));
    assert.equal(byId("hypercore|spot|1105")?.locked, "0.5");
    assert.equal(byId("hypercore|spot|9999")?.usd, null);
    assert.equal(byId("hypercore|spot|1452")?.priceUsd, Number(mids["@230"]));
    assert.equal(byId("hypercore|vault|0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0")?.asset, "Hyperliquidity Provider (HLP)");
    assert.match(byId("hypercore|vault|0x3ea541c902e9da1679b1f0422d30594a81fbc398")?.asset ?? "", /^Vault 0x3ea5/u);
    assert.equal(byId("hypercore|staking|HYPE")?.usd, Number((10 * HYPE).toFixed(6)));
    const khype = lines.find((entry) => entry.asset === "kHYPE");
    assert.equal(khype?.amount, "2");
    assert.ok(Math.abs((khype?.underlyingAmount ?? 0) - 2 * 1.0272703501522418) < 1e-9);
    assert.equal(lines.find((entry) => entry.asset === "tUSDC")?.usd, null);
    assert.equal(lines.find((entry) => entry.asset === "tKNTQ")?.usd, null);
    assert.equal(lines.find((entry) => entry.asset === "PURR"), undefined, "zero balances are left out");
    assert.equal(lines.find((entry) => entry.network === "hyperevm-testnet" && entry.asset === "USDC"), undefined, "a failed read is not a zero line");
  });

  it("totals only priced lines and counts the rest", () => {
    const priced = lines.reduce((total, entry) => total + (entry.usd ?? 0), 0);
    assert.ok(Math.abs(snapshot.totals.netWorthUsd - priced) < 1e-5);
    assert.equal(snapshot.totals.unpricedLines, 3);
    assert.ok(Math.abs(snapshot.totals.netWorthUsd - (snapshot.totals.byLayer.hypercore + snapshot.totals.byLayer.hyperevm + snapshot.totals.byLayer.elysium)) < 1e-5);
    assert.equal(snapshot.pricing.label, "reference");
    assert.equal(snapshot.pricing.time, 42);
    assert.ok(snapshot.notes.some((note) => /reference prices/u.test(note)));
  });

  it("lists positions with HyperCore's liquidation price, distance, ROE and funding sign", () => {
    assert.equal(snapshot.positions.length, isolated.assetPositions.length);
    const btc = snapshot.positions.find((position) => position.coin === "BTC");
    const raw = isolated.assetPositions.find((asset) => asset.position.coin === "BTC")?.position;
    assert.ok(btc && raw);
    const mark = Number(raw.positionValue) / Number(raw.szi);
    assert.equal(btc.side, "long");
    assert.equal(btc.liquidationPx, raw.liquidationPx);
    assert.ok(Math.abs((btc.liquidationDistancePct ?? 0) - ((mark - Number(raw.liquidationPx)) / mark) * 100) < 1e-3);
    assert.equal(btc.roePct, Number((Number(raw.returnOnEquity) * 100).toFixed(4)));
    assert.equal(btc.fundingSinceOpen, -Number(raw.cumFunding.sinceOpen), "HyperCore counts paid funding positive; the wire says received = positive");
    const bnb = snapshot.positions.find((position) => position.coin === "BNB");
    assert.equal(bnb?.side, "short");
    assert.ok((bnb?.fundingSinceOpen ?? 0) > 0, "the recorded BNB short received funding");
    assert.equal(snapshot.positions.find((position) => position.coin === "KAITO")?.liquidationRisk, "none");
    assert.ok(snapshot.positions[0] && snapshot.positions[1] && Math.abs(snapshot.positions[0].positionValue) >= Math.abs(snapshot.positions[1].positionValue));
  });

  it("reports account health from the clearinghouse summaries", () => {
    const [account] = snapshot.accounts;
    assert.equal(account?.withdrawable, Number(isolated.withdrawable));
    assert.equal(account?.crossMarginRatioPct, 0, "no cross positions: no cross maintenance");
    assert.ok(Math.abs((account?.accountLeverage ?? 0) - Number(isolated.marginSummary.totalNtlPos) / Number(isolated.marginSummary.accountValue)) < 1e-4);
  });

  it("nets exposure by underlying: perp delta + spot + staking + LST equivalents", () => {
    const hype = snapshot.exposure.find((row) => row.underlying === "HYPE");
    assert.ok(hype);
    assert.ok(Math.abs(hype.spot - (3.5 + 10 + 1 + 0.5)) < 1e-9, "Core spot, staking, native gas and WHYPE");
    assert.ok(Math.abs(hype.lst - 2 * 1.0272703501522418) < 1e-9);
    assert.equal(hype.perp, 0);
    assert.ok(Math.abs((hype.netUsd ?? 0) - hype.net * HYPE) < 1e-4);
    const bnb = snapshot.exposure.find((row) => row.underlying === "BNB");
    assert.equal(bnb?.perp, -1.758);
    assert.equal(bnb?.priceUsd, Number(mids.BNB), "testnet perps are valued at the mainnet reference mid");
    const usd = snapshot.exposure.find((row) => row.underlying === "USD");
    assert.equal(usd?.isCash, true);
    assert.equal(snapshot.exposure.find((row) => row.underlying === "KNTQ"), undefined);
  });

  it("is deterministic for the same input (stream digests rely on it)", () => {
    assert.deepEqual(buildSnapshot(sources()), snapshot);
  });
});

describe("degraded inputs", () => {
  it("without reference prices every USD figure is null and says why", () => {
    const snapshot = buildSnapshot(sources({ prices: null }));
    assert.equal(snapshot.totals.netWorthUsd, snapshot.layers.flatMap((layer) => layer.lines).filter((entry) => entry.priceUsd !== null).reduce((total, entry) => total + (entry.usd ?? 0), 0));
    assert.ok(snapshot.layers.flatMap((layer) => layer.lines).filter((entry) => entry.layer !== "hypercore").every((entry) => entry.usd === null));
    assert.ok(snapshot.notes.some((note) => /unavailable/u.test(note)));
  });

  it("marks layers partial, error or unavailable from their sources", () => {
    const snapshot = buildSnapshot(
      sources({
        spot: { value: null, status: "error", message: "boom" },
        evm: [{ network: "elysium-mainnet", layer: "elysium", status: "unavailable", message: "prelaunch", blockNumber: null, balances: [] }],
      }),
    );
    assert.equal(snapshot.layers.find((layer) => layer.layer === "hypercore")?.status, "partial");
    assert.equal(snapshot.layers.find((layer) => layer.layer === "elysium")?.status, "unavailable");
    assert.equal(snapshot.layers.find((layer) => layer.layer === "hyperevm")?.status, "unavailable", "no source at all");
  });

  it("mainnet mode labels prices as market prices", () => {
    const snapshot = buildSnapshot(sources({ mode: "mainnet", hypercoreNetwork: "hypercore-mainnet", evm: [] }));
    assert.equal(snapshot.pricing.label, "market");
    assert.ok(!snapshot.notes.some((note) => /Testnet holdings/u.test(note)));
  });
});
