// Shared test fixtures: a user, their accounts and a realistic intent graph.
import { edgesFromSteps, formatAccountId, hypercore as hc, nativeAssetId, erc20AssetId, marginAssetId } from "../dist/index.js";

export const USER = "0x5e9ee1089755c3435139848e47e6635505d5a13a";
export const OTHER = "0x1719884eb866cb12b2287399b15f7db5e7d775ea";
export const AGENT = "0xaa75418d6af464d2be641ce8a575e1113df53a9d";

export const accounts = {
  elysium: formatAccountId("elysium-testnet", USER),
  hyperevm: formatAccountId("hyperevm-testnet", USER),
  hypercore: formatAccountId("hypercore-testnet", USER),
};

export const HYPE_ELY = { asset: nativeAssetId("elysium-testnet"), symbol: "HYPE", decimals: 18 };
export const HYPE_HEVM = { asset: nativeAssetId("hyperevm-testnet"), symbol: "HYPE", decimals: 18 };
export const USDC_ELY = { asset: erc20AssetId("elysium-testnet", "0x7D29d8047B905000459c0E80c34a26CeedcB47b2"), symbol: "USDC", decimals: 6 };
export const MARGIN = { asset: marginAssetId("testnet"), symbol: "USDC", decimals: 6 };

/** A step with sensible defaults; override any field. */
export function step(overrides) {
  const network = overrides.network ?? "elysium-testnet";
  const chain = { "elysium-testnet": "eip155:99801", "hyperevm-testnet": "eip155:998", "hypercore-testnet": "hypercore:testnet" }[network];
  return {
    id: "s1",
    index: 0,
    kind: "swap",
    title: "Step",
    network,
    chain,
    account: formatAccountId(network, USER),
    protocol: "elysium-canonical-bridge",
    mode: "wallet",
    inputs: [],
    outputs: [],
    dependsOn: [],
    status: "ready",
    evidence: [],
    ...overrides,
  };
}

/** "Bridge 20 HYPE to Elysium, then long BTC 5x with a stop" across the three layers. */
export function sampleGraph(overrides = {}) {
  const steps = [
    step({
      id: "s1",
      index: 0,
      kind: "bridge",
      title: "Bridge 20 HYPE to Elysium",
      network: "hyperevm-testnet",
      inputs: [{ ...HYPE_HEVM, expected: "20000000000000000000", usd: "800.00" }],
      outputs: [{ ...HYPE_ELY, expected: "20000000000000000000", minimum: "20000000000000000000" }],
      recipient: accounts.elysium,
      settlement: { kind: "cross-network", destinationNetwork: "elysium-testnet", mechanism: "orbit-deposit", expectedSeconds: 60 },
      status: "ready",
    }),
    step({
      id: "s2",
      index: 1,
      kind: "leverage",
      title: "Set BTC leverage to 5x",
      network: "hypercore-testnet",
      protocol: "hypercore-perps",
      mode: "agent",
      leverage: { market: "BTC", assetIndex: 3, leverage: 5, isCross: true },
      status: "blocked",
    }),
    step({
      id: "s3",
      index: 2,
      kind: "order",
      title: "Long 0.01 BTC",
      network: "hypercore-testnet",
      protocol: "hypercore-perps",
      mode: "agent",
      dependsOn: ["s2"],
      order: {
        market: "BTC",
        marketKind: "perp",
        assetIndex: 3,
        side: "buy",
        sz: "0.01",
        limitPx: "80048",
        tif: "Ioc",
        reduceOnly: false,
        cloid: hc.cloidFromInt(1),
        grouping: "na",
        worstPx: "80048",
      },
      status: "blocked",
    }),
  ];
  return {
    spec: "elyia.intent/v1",
    id: "int_0123456789abcdef0123456789abcdef",
    text: "bridge 20 HYPE to Elysium and long BTC 5x",
    source: "text",
    environment: "testnet",
    accounts: [accounts.elysium, accounts.hyperevm, accounts.hypercore],
    steps,
    edges: edgesFromSteps(steps),
    status: "planned",
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    expiresAt: "2026-10-29T12:30:00.000Z",
    summary: { title: "Bridge and long", networks: ["hyperevm-testnet", "elysium-testnet", "hypercore-testnet"], inputs: [], outputs: [], signatures: { wallet: 1, agent: 2 }, crossNetwork: true },
    warnings: [],
    ...overrides,
  };
}
