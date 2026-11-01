import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KIND_CATEGORY,
  NETWORKS,
  PROTOCOLS,
  PROTOCOL_CATEGORIES,
  PROTOCOL_KINDS,
  bestDeploymentStatus,
  capableProtocols,
  countByCategory,
  countByKind,
  countByProtocolStatus,
  countByStatus,
  deploymentOn,
  deriveProtocolStatus,
  executableProtocols,
  getProtocol,
  isChecksumAddressValid,
  isEvmAddress,
  listProtocols,
  protocolById,
  protocolSummary,
  protocolsFor,
  protocolsIn,
  protocolsTouching,
  toChecksumAddress,
  validateProtocolRows,
  withExecutable,
} from "../dist/index.js";

test("every seeded row validates, ids are unique and every address is checksummed", () => {
  assert.deepEqual(validateProtocolRows(PROTOCOLS), []);
  assert.equal(new Set(PROTOCOLS.map((protocol) => protocol.id)).size, PROTOCOLS.length);
  for (const protocol of PROTOCOLS) {
    for (const deployment of protocol.deployments) {
      for (const [role, value] of Object.entries(deployment.contracts)) {
        if (isEvmAddress(value)) assert.ok(isChecksumAddressValid(value), `${protocol.id} ${role}`);
      }
      if (deployment.status === "live" || deployment.status === "testnet-live") assert.ok(deployment.evidence, `${protocol.id} on ${deployment.network} needs evidence`);
    }
  }
});

test("core protocols are seeded with their known statuses", () => {
  const status = (id, network) => deploymentOn(getProtocol(id), network)?.status;
  assert.equal(status("elysium-canonical-bridge", "elysium-testnet"), "testnet-live");
  assert.equal(status("elysium-canonical-bridge", "hyperevm-mainnet"), "coming", "mainnet gateways are unpublished");
  assert.equal(status("elysium-mirror-bridge", "hyperevm-testnet"), "testnet-live");
  assert.equal(status("hypercore-perps", "hypercore-mainnet"), "live");
  assert.equal(status("hypercore-twap", "hypercore-testnet"), "testnet-live");
  assert.equal(status("hypercore-vaults", "hypercore-testnet"), "testnet-live");
  assert.equal(status("hypercore-staking", "hypercore-testnet"), "testnet-live");
  assert.equal(status("hyperevm-core-link", "hyperevm-testnet"), "testnet-live");
  assert.equal(status("hyperevm-corewriter", "hyperevm-mainnet"), "live");
  assert.equal(status("elysium-corewriter", "elysium-mainnet"), "coming");
  assert.deepEqual(deploymentOn(getProtocol("elysium-corewriter"), "elysium-mainnet")?.contracts, {}, "no address until published");
  assert.equal(status("elysium-hypercore-read", "elysium-mainnet"), "coming");
  assert.equal(status("kinetiq", "hyperevm-mainnet"), "live");
  assert.equal(status("kinetiq", "hyperevm-testnet"), "testnet-live", "StakingManager identity inferred, stake() simulated (census 2026-10-31)");
  assert.equal(status("uniswap", "elysium-mainnet"), "announced");
  assert.equal(deploymentOn(getProtocol("pump-fun"), "elysium-mainnet")?.since, "2026-11-09");
  assert.equal(status("nest", "elysium-mainnet"), "coming");
  for (const id of ["dawn", "speculate", "montra", "citadel", "corepad", "enso", "kyberswap", "conduit", "chainstack", "dwellir", "hypedexer", "alchemy", "multicall3", "permit2"]) {
    assert.ok(getProtocol(id), id);
  }
  assert.equal(status("enso", "elysium-testnet"), "testnet-live", "deployed and confirmed by the census, unused");
  assert.equal(getProtocol("corepad")?.github, "CorePad-team");
});

test("registry addresses agree with networks.ts", () => {
  const bridge = getProtocol("elysium-canonical-bridge");
  const child = deploymentOn(bridge, "elysium-testnet").contracts;
  const parent = deploymentOn(bridge, "hyperevm-testnet").contracts;
  const pinned = NETWORKS["elysium-testnet"].elysiumBridge;
  assert.equal(child.l2GatewayRouter, pinned.child.l2GatewayRouter);
  assert.equal(child.l2StandardGateway, pinned.child.l2StandardGateway);
  assert.equal(child.l2WhypeGateway, pinned.child.l2WhypeGateway);
  for (const role of ["rollup", "bridge", "inbox", "sequencerInbox", "outbox", "l1GatewayRouter", "l1StandardGateway", "l1WhypeGateway"]) {
    assert.equal(parent[role], pinned.parent[role], role);
  }
  const mainnet = deploymentOn(bridge, "hyperevm-mainnet").contracts;
  for (const role of ["rollup", "bridge", "inbox", "sequencerInbox", "outbox"]) assert.equal(mainnet[role], NETWORKS["elysium-mainnet"].elysiumBridge.parent[role], role);
  assert.equal(deploymentOn(getProtocol("elysium-mirror-bridge"), "elysium-testnet").contracts.bridgeFactory, pinned.child.bridgeFactory);
  assert.equal(deploymentOn(getProtocol("multicall3"), "elysium-testnet").contracts.multicall3, NETWORKS["elysium-testnet"].contracts.multicall3);
});

test("helpers: per network, executable, capable, counts", () => {
  const elysium = protocolsFor("elysium-testnet").map((protocol) => protocol.id);
  assert.ok(elysium.includes("elysium-canonical-bridge"));
  assert.ok(!elysium.includes("uniswap"), "Uniswap has nothing on testnet");
  assert.ok(protocolsFor("elysium-mainnet", ["announced"]).some((protocol) => protocol.id === "uniswap"));
  assert.ok(protocolsIn("testnet").length > protocolsIn("mainnet").length / 2);
  const executable = executableProtocols().map((protocol) => protocol.id);
  for (const id of ["elysium-canonical-bridge", "hypercore-perps", "hypercore-spot", "hypercore-twap", "hyperevm-core-link"]) assert.ok(executable.includes(id), id);
  for (const id of ["signal", "hyperswap-v3"]) assert.ok(executable.includes(id), `${id}: an engine adapter executes it`);
  for (const id of ["uniswap", "elysium-corewriter", "hypercore-vaults", "hypercore-staking", "elyspump", "elysium-names"]) assert.ok(!executable.includes(id), id);
  assert.deepEqual(capableProtocols("hyperevm-testnet", "swap").map((protocol) => protocol.id).sort(), ["hyperswap-v3"]);
  assert.deepEqual(capableProtocols("hypercore-testnet", "long").map((protocol) => protocol.id), ["hypercore-perps"]);
  assert.deepEqual(capableProtocols("hyperevm-testnet", "bridge").map((protocol) => protocol.id).sort(), ["elysium-canonical-bridge", "elysium-mirror-bridge"]);
  assert.deepEqual(capableProtocols("elysium-mainnet", "swap"), [], "nothing executable on mainnet before launch");
  const counts = countByCategory();
  assert.deepEqual(Object.keys(counts).sort(), [...PROTOCOL_CATEGORIES].sort());
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), PROTOCOLS.length);
  assert.ok(counts.launchpad >= 23, "launchpads plus NFT rows");
  const statuses = countByStatus();
  assert.ok(statuses["testnet-live"] > 0 && statuses.coming > 0 && statuses.announced > 0 && statuses.unverified > 0);
});

test("withExecutable reports what a running service really executes", () => {
  const live = withExecutable(["hypercore-perps", "uniswap"]);
  assert.equal(live.find((protocol) => protocol.id === "hypercore-perps")?.executable, true);
  assert.equal(live.find((protocol) => protocol.id === "elysium-canonical-bridge")?.executable, false);
  assert.equal(live.find((protocol) => protocol.id === "elysium-corewriter")?.executable, false, "no verbs, never executable");
});

test("appended rows are checked as plain data", () => {
  const router = toChecksumAddress("0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f");
  const good = {
    id: "new-dex",
    name: "New DEX",
    category: "dex",
    kind: "dex",
    status: "unknown",
    description: "A DEX found on a tracker.",
    url: "https://example.org",
    deployments: [
      {
        network: "elysium-testnet",
        status: "unverified",
        contracts: { router },
        contractInfo: [{ key: "router", role: "SwapRouter", address: router, codeBytes: 12070, checkedAt: "2026-10-31", evidence: "getters factory()" }],
        evidence: "tracker",
      },
    ],
    capabilities: ["swap"],
    executable: false,
    tags: [],
  };
  assert.deepEqual(validateProtocolRows([good]), []);
  const messages = (row) => validateProtocolRows([row]).map((issue) => issue.message);
  const deployment = good.deployments[0];
  assert.ok(messages({ ...good, id: "New DEX" }).some((message) => /kebab/u.test(message)));
  assert.ok(messages({ ...good, category: "casino" }).some((message) => /category/u.test(message)));
  assert.ok(messages({ ...good, kind: "casino" }).some((message) => /unknown kind/u.test(message)));
  assert.ok(messages({ ...good, kind: "game" }).some((message) => /files under category prediction/u.test(message)));
  assert.ok(messages({ ...good, status: "live" }).some((message) => /unknown status/u.test(message)));
  assert.ok(messages({ ...good, status: "live-testnet" }).some((message) => /disagrees with its deployments/u.test(message)));
  assert.ok(messages({ ...good, status: "deprecated" }).some((message) => /deprecated tag/u.test(message)));
  assert.deepEqual(messages({ ...good, status: "deprecated", tags: ["deprecated"] }), []);
  assert.ok(messages({ ...good, url: "http://example.org" }).some((message) => /https/u.test(message)));
  assert.ok(messages({ ...good, executable: true }).some((message) => /live deployment/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, status: "live" }] }).some((message) => /testnet-live/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contracts: { router: "not an address" }, contractInfo: [] }] }).some((message) => /neither an address/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, network: "solana" }] }).some((message) => /unknown network/u.test(message)));
  assert.equal(validateProtocolRows([good, good]).some((issue) => /duplicate/u.test(issue.message)), true);
  // Verified-only contracts, EIP-55, tags, prelaunch flag, adapter hints.
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contractInfo: [] }] }).some((message) => /unverified contract/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contractInfo: [{ ...deployment.contractInfo[0], codeBytes: 0 }] }] }).some((message) => /only contracts with bytecode/u.test(message)));
  const lower = router.toLowerCase();
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contracts: { router: lower }, contractInfo: [{ ...deployment.contractInfo[0], address: lower }] }] }).some((message) => /EIP-55/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contractInfo: [{ ...deployment.contractInfo[0], address: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234" }] }] }).some((message) => /does not match/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...deployment, contractInfo: [{ ...deployment.contractInfo[0], checkedAt: "yesterday" }] }] }).some((message) => /checkedAt/u.test(message)));
  assert.ok(messages({ ...good, tags: ["Name Collision"] }).some((message) => /tag/u.test(message)));
  assert.ok(messages({ ...good, tags: ["prelaunch-mainnet"] }).some((message) => /prelaunch/u.test(message)));
  assert.ok(messages({ ...good, mainnetPrelaunch: true }).some((message) => /prelaunch/u.test(message)));
  const fn = { contract: "SwapRouter", address: router, network: "elysium-testnet", signature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", selector: "0x414bf389", verification: "bytecode" };
  const hints = { candidate: true, tier: "selectors", verbs: ["swap"], functions: [fn], simulations: [] };
  assert.deepEqual(messages({ ...good, adapter: hints }), []);
  assert.ok(messages({ ...good, adapter: { ...hints, functions: [{ ...fn, selector: "0x414BF389" }] } }).some((message) => /selector/u.test(message)));
  assert.ok(messages({ ...good, adapter: { ...hints, functions: [{ ...fn, address: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234" }] } }).some((message) => /not a verified contract/u.test(message)));
  assert.ok(messages({ ...good, adapter: { ...hints, tier: "maybe" } }).some((message) => /tier/u.test(message)));
  assert.ok(messages({ ...good, adapter: { ...hints, functions: [] } }).some((message) => /at least one/u.test(message)));
});

/* ------------------------------------------------- census (2026-10-31) */

const CENSUS = "/home/user/elyia-design/research/elysium-protocols.json";

test("registry size: 31 hand rows + 154 census rows - 21 merged = 164, every census row once", () => {
  // 2026-11-01: + hyperswap-v3 (hand row, HyperEVM testnet + mainnet).
  assert.equal(PROTOCOLS.length, 164);
  const census = PROTOCOLS.filter((protocol) => protocol.researchId);
  assert.equal(census.length, 154);
  assert.equal(new Set(census.map((protocol) => protocol.researchId)).size, 154);
  for (const [researchId, id] of [["kinetiq-khype", "kinetiq"], ["hypercore-read-precompile", "elysium-hypercore-read"], ["whype-canonical", "wrapped-hype"], ["corepad", "corepad"]]) {
    assert.equal(PROTOCOLS.find((protocol) => protocol.researchId === researchId)?.id, id, researchId);
  }
});

test("pinned counts per kind, category and status", () => {
  assert.deepEqual(countByKind(), {
    bridge: 5, perps: 9, "spot-orderbook": 1, dex: 18, aggregator: 6, lending: 9, cdp: 0, "liquid-staking": 3, staking: 1, vault: 11,
    launchpad: 23, prediction: 8, oracle: 3, infra: 23, wallet: 2, indexer: 1, analytics: 0,
    game: 13, tools: 12, nft: 10, rwa: 3, names: 1, otc: 1, stablecoin: 1,
  });
  assert.deepEqual(countByProtocolStatus(), { "live-mainnet": 13, "live-testnet": 89, "announced-mainnet": 33, unknown: 28, deprecated: 1 });
  assert.deepEqual(countByStatus(), { live: 13, "testnet-live": 106, announced: 26, coming: 19, unverified: 11 });
  const counts = countByCategory();
  for (const kind of PROTOCOL_KINDS) assert.ok(PROTOCOL_CATEGORIES.includes(KIND_CATEGORY[kind]), kind);
  assert.equal(counts.prediction, 8 + 13, "games file under prediction");
  for (const protocol of PROTOCOLS) assert.equal(protocol.category, KIND_CATEGORY[protocol.kind], protocol.id);
});

test("status is derived from deployments; deprecated is explicit", () => {
  for (const protocol of PROTOCOLS) {
    if (protocol.status === "deprecated") assert.ok(protocol.tags.includes("deprecated"), protocol.id);
    else assert.equal(protocol.status, deriveProtocolStatus(protocol.deployments), protocol.id);
  }
  assert.equal(getProtocol("elys-faucet-token")?.status, "deprecated");
  assert.equal(getProtocol("elyspump")?.status, "announced-mainnet", "private-mainnet only, public launch 2026-11-09");
  assert.equal(getProtocol("aave")?.status, "unknown");
  assert.equal(getProtocol("kalos-v3")?.status, "live-testnet");
  assert.equal(getProtocol("hypercore-perps")?.status, "live-mainnet");
  assert.equal(bestDeploymentStatus(getProtocol("nest")), "coming");
  assert.equal(bestDeploymentStatus(getProtocol("aave")), null);
});

test("every EVM contract is verified: contractInfo, bytecode, EIP-55, census-verified", async () => {
  const { readFile } = await import("node:fs/promises");
  const census = JSON.parse(await readFile(CENSUS, "utf8"));
  const unverified = new Set(census.flatMap((row) => row.contracts.filter((contract) => !contract.verified).map((contract) => `${contract.network}|${contract.address.toLowerCase()}`)));
  let total = 0;
  for (const protocol of PROTOCOLS) {
    for (const deployment of protocol.deployments) {
      const evm = NETWORKS[deployment.network].vm === "evm";
      for (const [key, value] of Object.entries(deployment.contracts)) {
        if (!isEvmAddress(value)) continue;
        assert.ok(isChecksumAddressValid(value) && toChecksumAddress(value) === value, `${protocol.id} ${key}`);
        if (!evm) continue;
        const info = deployment.contractInfo?.find((contract) => contract.key === key);
        assert.ok(info && info.codeBytes > 0 && info.address === value, `${protocol.id} ${deployment.network} ${key}`);
        assert.ok(!unverified.has(`${deployment.network}|${value.toLowerCase()}`), `${protocol.id} ${key} is unverified in the census`);
        total += 1;
      }
    }
  }
  assert.equal(total, 548, "539 of 2026-10-31 + 9 HyperSwap V3 contracts of 2026-11-01");
  const bridge = deploymentOn(getProtocol("elysium-canonical-bridge"), "elysium-testnet");
  assert.equal(bridge.contracts.nodeInterface, undefined, "NodeInterface 0x…C8 has no bytecode: not listed");
  assert.equal(deploymentOn(getProtocol("elyspump"), "elysium-mainnet")?.contracts.launchpadV1, undefined, "unverified on the relay: not listed");
});

test("listProtocols filters by network, category/kind, status, executable and tag", () => {
  const all = listProtocols();
  assert.equal(all.length, PROTOCOLS.length);
  const nft = listProtocols({ category: "nft" });
  assert.equal(nft.length, 10);
  assert.ok(nft.every((protocol) => protocol.kind === "nft"));
  assert.equal(listProtocols({ category: "launchpad" }).length, 33, "the coarse category also matches its kinds");
  assert.equal(listProtocols({ kind: "launchpad" }).length, 23);
  assert.ok(listProtocols({ network: "elysium-mainnet", status: "announced-mainnet" }).some((protocol) => protocol.id === "elyspump"));
  assert.deepEqual(listProtocols({ status: "deprecated" }).map((protocol) => protocol.id), ["elys-faucet-token"]);
  assert.deepEqual(
    listProtocols({ executable: true }).map((protocol) => protocol.id).sort(),
    [
      "cheshire", "dex-da-costa", "elyra-lending", "elysium-canonical-bridge", "elysium-mirror-bridge", "hexswap", "hypercore-perps", "hypercore-spot",
      "hypercore-transfers", "hypercore-twap", "hyperevm-core-link", "hyperswap-v3", "kalos-stkalos", "kalos-v3", "kinetiq", "perpme", "signal", "wrapped-hype",
    ],
  );
  assert.deepEqual(listProtocols({ network: "elysium-testnet", executable: true, category: "dex" }).map((protocol) => protocol.id).sort(), ["dex-da-costa", "hexswap", "kalos-v3"], "PerpMe is a launchpad with a V3 venue");
  assert.deepEqual(listProtocols({ tag: "name-collision" }).map((protocol) => protocol.id), ["elyra-lending"]);
  assert.ok(listProtocols({ tag: "prelaunch-mainnet" }).every((protocol) => protocol.mainnetPrelaunch === true));
  assert.equal(listProtocols({ tag: "prelaunch-mainnet" }).length, 17);
  assert.ok(listProtocols({ status: ["live-testnet", "live-mainnet"], network: "elysium-testnet" }).length >= 90);
  assert.equal(listProtocols({ network: "elysium-testnet", deploymentStatus: "unverified" }).every((protocol) => deploymentOn(protocol, "elysium-testnet")?.status === "unverified"), true);
  assert.equal(protocolById("kalos-v3"), getProtocol("kalos-v3"));
  assert.equal(protocolById("nope"), null);
});

test("protocolsTouching finds every registry contract at an address, any case", () => {
  const router = protocolsTouching("0x752f6816bc514e1eeff852b2eadcd96f6c0f9f3f");
  assert.equal(router.length, 1);
  assert.equal(router[0].protocol.id, "kalos-v3");
  assert.equal(router[0].network, "elysium-testnet");
  assert.match(router[0].contract.role, /SwapRouter/u);
  const multicall = protocolsTouching("0xcA11bde05977b3631167028862bE2a173976CA11");
  assert.deepEqual([...new Set(multicall.map((touch) => touch.network))].sort(), ["elysium-mainnet", "elysium-testnet", "hyperevm-mainnet", "hyperevm-testnet"]);
  assert.equal(protocolsTouching("0xcA11bde05977b3631167028862bE2a173976CA11", "elysium-testnet").length, 1);
  assert.deepEqual(protocolsTouching("0x0000000000000000000000000000000000000001"), []);
  assert.deepEqual(protocolsTouching("not an address"), []);
});

test("adapter hints: 26 census candidates, verified selectors only", () => {
  const candidates = PROTOCOLS.filter((protocol) => protocol.adapter?.candidate).map((protocol) => protocol.id).sort();
  assert.equal(candidates.length, 26);
  for (const id of ["kalos-v3", "dex-da-costa", "perpme", "hexswap", "elysium-names", "kalos-stkalos", "multicall3", "wrapped-hype", "elysium-canonical-bridge"]) {
    assert.equal(getProtocol(id)?.adapter?.tier, "simulated", id);
  }
  for (const id of ["signal", "ascend", "chainzy", "neuriio", "bunnypad", "reactor-perps", "cheshire", "elyspump", "kyberswap"]) assert.ok(candidates.includes(id), id);
  const kalos = getProtocol("kalos-v3").adapter;
  assert.ok(kalos.functions.some((fn) => fn.selector === "0x414bf389" && /^exactInputSingle\(/u.test(fn.signature)));
  assert.match(getProtocol("elyspump").adapter.caveat, /never send user transactions/u);
  assert.ok(getProtocol("elyspump").tags.includes("relay-read-only"));
  // Hints never make a protocol executable: only an engine adapter does (Signal: the launch-router buy adapter).
  assert.equal(getProtocol("signal").executable, true);
  assert.deepEqual(getProtocol("signal").capabilities, ["swap"]);
  assert.equal(getProtocol("ascend").executable, false, "selectors verified, no adapter");
  assert.deepEqual(getProtocol("kalos-stkalos").capabilities, ["deposit", "withdraw"]);
});

test("tags carry the census' warnings", () => {
  const tagged = (tag) => listProtocols({ tag }).map((protocol) => protocol.id);
  assert.ok(tagged("unaudited").includes("supercolony"));
  assert.ok(tagged("community-tracker").length > 60);
  assert.ok(tagged("lookalike-tokens").includes("wrapped-hype") === false, "canonical WHYPE is not a look-alike owner");
  for (const id of ["perpme", "dex-da-costa", "hexswap", "elypact", "elara-khype-vault", "supercolony", "kalos-v3"]) assert.ok(tagged("lookalike-tokens").includes(id), id);
  assert.ok(tagged("impersonation").includes("yldex-franklin-lookalike"));
  assert.ok(tagged("custodial").includes("justrekt"));
  assert.ok(tagged("unbranded").includes("cheshire"));
  assert.ok(tagged("not-announced").includes("aave"));
});

test("protocolSummary is the light listing row", () => {
  const summary = protocolSummary(getProtocol("kalos-v3"));
  assert.deepEqual(Object.keys(summary).sort(), ["adapterTier", "capabilities", "category", "executable", "id", "kind", "name", "networks", "status", "tags", "url"]);
  assert.equal(summary.adapterTier, "simulated");
  assert.equal(summary.networks[0].network, "elysium-testnet");
  assert.ok(summary.networks[0].contracts >= 20);
});
