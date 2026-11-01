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
  for (const name of ["ElyiaRouter", "ElyAccountFactory", "ElyOrders", "ElyHerd"]) {
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

  it("manifest carries ElyHerd as a standalone collection with param placeholders, never invented addresses", function () {
    const m = require("../deploy/manifest.elysium-testnet.json");
    const v = require("../deploy/elysium-testnet.venues.json");
    const h = m.collections.find((c) => c.contract === "ElyHerd");
    const arg = Object.fromEntries(h.constructor.map((a) => [a.name, a.value]));
    expect(arg.name_).to.equal("The Herd");
    expect(arg.symbol_).to.equal("HERD");
    expect(arg.initialOwner).to.equal("$PARAM.owner");
    expect(arg.treasury_).to.equal("$PARAM.treasury");
    expect(arg.wrappedNative).to.equal(v.tokens.WHYPE.address);
    expect(arg.usdToken).to.equal(v.tokens.USDC.address);
    expect(arg.priceWei).to.equal("3000000000000000000");
    expect([arg.teamAllocation, arg.wlAllocation, arg.collabAllocation, arg.publicAllocation]).to.deep.equal([111, 1611, 0, 1611]);
    expect(h.params.treasury.suggest).to.equal(null);
    expect(m.order.map((s) => s.contract)).to.not.include("ElyHerd");
  });
});
