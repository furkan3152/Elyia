// Hardhat config for @elyia/contracts.
// Unit tests run on a plain in-process chain. Fork tests (ELYIA_FORK=1) run on a fork of
// Elysium testnet (chain 99801) pinned to FORK_BLOCK so results and the RPC cache are reproducible.
// Nothing here can broadcast: there is no live network with accounts configured.
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("hardhat-gas-reporter");
if (process.env.ELYIA_COVERAGE === "1") require("solidity-coverage");

const FORK = process.env.ELYIA_FORK === "1";
// RPC pinned in packages/core/src/networks.ts (Elysium Testnet rpcUrls[0]).
const ELYSIUM_TESTNET_RPC = process.env.ELYSIUM_TESTNET_RPC || "https://testnet-rpc.elysium.kinetiq.xyz";
const FORK_BLOCK = Number(process.env.ELYIA_FORK_BLOCK || 20530000);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: require("./solidity.config.cjs"),
  networks: {
    hardhat: {
      hardfork: "cancun",
      chainId: FORK ? 99801 : 31337,
      allowUnlimitedContractSize: false,
      ...(FORK ? { forking: { url: ELYSIUM_TESTNET_RPC, blockNumber: FORK_BLOCK } } : {}),
      chains: {
        99801: { hardforkHistory: { london: 0, merge: 0, shanghai: 0, cancun: 0 } },
      },
    },
  },
  mocha: { timeout: 600000 },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "1",
    currency: "USD",
    outputFile: process.env.GAS_REPORT_FILE || undefined,
    noColors: Boolean(process.env.GAS_REPORT_FILE),
    reportPureAndViewMethods: false,
    excludeContracts: ["test/"],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
