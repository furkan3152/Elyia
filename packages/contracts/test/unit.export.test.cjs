// Guards the exported artifacts in packages/core/src/contracts against drift from the compiled sources.
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { artifacts } = require("hardhat");

const CORE = path.join(__dirname, "..", "..", "core", "src", "contracts");

describe("Exported artifacts (packages/core/src/contracts)", function () {
  before(function () {
    // solidity-coverage instruments bytecode, so drift checks are meaningless there.
    if (process.env.ELYIA_COVERAGE === "1") this.skip();
  });
  for (const name of ["ElyiaRouter", "ElyAccountFactory", "ElyOrders"]) {
    it(`${name}.ts bytecode and ABI match the compiled artifact`, async function () {
      const a = await artifacts.readArtifact(name);
      const ts = fs.readFileSync(path.join(CORE, `${name}.ts`), "utf8");
      expect(ts.includes(`bytecode: "${a.bytecode}"`), "bytecode drift: run npm run export -w @elyia/contracts").to.equal(true);
      for (const item of a.abi.filter((x) => x.type === "function")) expect(ts.includes(`"name": "${item.name}"`)).to.equal(true);
    });
  }

  it("manifest deploys the pinned venues in a fixed order", function () {
    const m = require("../deploy/manifest.elysium-testnet.json");
    const v = require("../deploy/elysium-testnet.venues.json");
    expect(m.order.map((s) => s.contract)).to.deep.equal(["ElyiaRouter", "ElyAccountFactory", "ElyOrders"]);
    expect(m.order[0].constructor[2].value).to.deep.equal(v.venues.map((x) => x.address));
    expect(m.chainId).to.equal(99801);
  });
});
