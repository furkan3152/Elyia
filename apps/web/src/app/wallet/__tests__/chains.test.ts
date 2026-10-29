import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NETWORKS } from "@elyia/core/networks";

import { DEFINED_CHAINS, evmNetwork, isWalletOffered, walletChainKeys, walletChains } from "../chains";
import { walletConnectBuildWarning, walletConnectProjectId } from "../walletConnectProjectId";

describe("wallet chains", () => {
  it("defines Elysium 99801 (not viem's 1338) from the registry's public RPCs", () => {
    const chain = DEFINED_CHAINS["elysium-testnet"];
    assert.equal(chain.id, 99801);
    assert.equal(chain.nativeCurrency.symbol, "HYPE");
    assert.deepEqual(chain.rpcUrls.default.http, NETWORKS["elysium-testnet"].vm === "evm" ? [...NETWORKS["elysium-testnet"].rpcUrls] : []);
    assert.equal(chain.blockExplorers?.default.url, "https://test-explorer.elysium.kinetiq.xyz");
    assert.equal(chain.contracts?.multicall3?.address, "0xcA11bde05977b3631167028862bE2a173976CA11");
    assert.equal(chain.testnet, true);
  });

  it("defines the mainnets but offers only live testnets in testnet mode", () => {
    assert.equal(DEFINED_CHAINS["elysium-mainnet"].id, 99901);
    assert.equal(DEFINED_CHAINS["hyperevm-mainnet"].id, 999);
    assert.deepEqual(walletChainKeys("testnet"), ["elysium-testnet", "hyperevm-testnet"]);
    assert.deepEqual(walletChains("testnet").map((chain) => chain.id), [99801, 998]);
  });

  it("never offers prelaunch Elysium mainnet", () => {
    assert.equal(isWalletOffered(evmNetwork("elysium-mainnet"), "mainnet"), false);
    assert.equal(walletChainKeys("mainnet").includes("elysium-mainnet"), false);
    assert.equal(isWalletOffered(evmNetwork("elysium-testnet"), "mainnet"), false, "never across environments");
  });
});

describe("WalletConnect project id", () => {
  it("accepts only a 32-hex Reown id", () => {
    assert.equal(walletConnectProjectId("21FEF48091F12692CAD574A6F7753643"), "21fef48091f12692cad574a6f7753643");
    assert.equal(walletConnectProjectId(" 21fef48091f12692cad574a6f7753643 "), "21fef48091f12692cad574a6f7753643");
    for (const bad of [undefined, "", "your_project_id", "<REOWN_ID>", "https://cloud.reown.com", 42]) assert.equal(walletConnectProjectId(bad), null);
  });

  it("warns only for a set-but-invalid id", () => {
    assert.equal(walletConnectBuildWarning(""), null);
    assert.equal(walletConnectBuildWarning(undefined), null);
    assert.equal(walletConnectBuildWarning("21fef48091f12692cad574a6f7753643"), null);
    assert.match(walletConnectBuildWarning("your_project_id") ?? "", /hidden/u);
  });
});
