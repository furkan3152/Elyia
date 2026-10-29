import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NETWORKS,
  PROTOCOLS,
  PROTOCOL_CATEGORIES,
  capableProtocols,
  countByCategory,
  countByStatus,
  deploymentOn,
  executableProtocols,
  getProtocol,
  isChecksumAddressValid,
  isEvmAddress,
  protocolsFor,
  protocolsIn,
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
  assert.equal(status("kinetiq", "hyperevm-testnet"), "unverified");
  assert.equal(status("uniswap", "elysium-mainnet"), "announced");
  assert.equal(deploymentOn(getProtocol("pump-fun"), "elysium-mainnet")?.since, "2026-11-09");
  assert.equal(status("nest", "elysium-mainnet"), "coming");
  for (const id of ["dawn", "speculate", "montra", "citadel", "corepad", "enso", "kyberswap", "conduit", "chainstack", "dwellir", "hypedexer", "alchemy", "multicall3", "permit2"]) {
    assert.ok(getProtocol(id), id);
  }
  assert.equal(status("enso", "elysium-testnet"), "unverified");
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
  for (const id of ["uniswap", "elysium-corewriter", "kinetiq", "hypercore-vaults"]) assert.ok(!executable.includes(id), id);
  assert.deepEqual(capableProtocols("hypercore-testnet", "long").map((protocol) => protocol.id), ["hypercore-perps"]);
  assert.deepEqual(capableProtocols("hyperevm-testnet", "bridge").map((protocol) => protocol.id).sort(), ["elysium-canonical-bridge", "elysium-mirror-bridge"]);
  assert.deepEqual(capableProtocols("elysium-mainnet", "swap"), [], "nothing executable on mainnet before launch");
  const counts = countByCategory();
  assert.deepEqual(Object.keys(counts).sort(), [...PROTOCOL_CATEGORIES].sort());
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), PROTOCOLS.length);
  assert.ok(counts.launchpad >= 4);
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
  const good = {
    id: "new-dex",
    name: "New DEX",
    category: "dex",
    description: "A DEX found on a tracker.",
    url: "https://example.org",
    deployments: [{ network: "elysium-testnet", status: "unverified", contracts: { router: "0xCfBAa9Cfce952Ca4F4069874fF1Df8c05e37a3c7" }, evidence: "tracker" }],
    capabilities: ["swap"],
    executable: false,
    tags: [],
  };
  assert.deepEqual(validateProtocolRows([good]), []);
  const messages = (row) => validateProtocolRows([row]).map((issue) => issue.message);
  assert.ok(messages({ ...good, id: "New DEX" }).some((message) => /kebab/u.test(message)));
  assert.ok(messages({ ...good, category: "casino" }).some((message) => /category/u.test(message)));
  assert.ok(messages({ ...good, url: "http://example.org" }).some((message) => /https/u.test(message)));
  assert.ok(messages({ ...good, executable: true }).some((message) => /live deployment/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...good.deployments[0], status: "live" }] }).some((message) => /testnet-live/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...good.deployments[0], contracts: { router: "not an address" } }] }).some((message) => /neither an address/u.test(message)));
  assert.ok(messages({ ...good, deployments: [{ ...good.deployments[0], network: "solana" }] }).some((message) => /unknown network/u.test(message)));
  assert.equal(validateProtocolRows([good, good]).some((issue) => /duplicate/u.test(issue.message)), true);
});
