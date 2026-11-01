// Fork tests for ElyHerd against the real Kalos marketplace and the Kalos V3 WHYPE/USDC pool on
// Elysium testnet (run with ELYIA_FORK=1). Nothing is broadcast: the fork is an in-process copy of
// chain 99801 at the pinned block. Addresses: research/kalos-nft.md (verified on chain) and
// deploy/elysium-testnet.venues.json.
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");
const { loadFixture, time, mine, impersonateAccount, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { Phase, PriceMode, PriceSource, usdToWeiRef } = require("./herd.helpers.cjs");

const M = require("../deploy/elysium-testnet.venues.json");
const WHYPE = M.tokens.WHYPE.address;
const USDC = M.tokens.USDC.address;
const POOL = M.pools.kalosWHYPE_USDC_2pct.address;
const KALOS_ROUTER = M.venues.find((v) => v.key === "kalosSwapRouter").address;

// Kalos NFT marketplace (TransparentUpgradeableProxy) and one of its MARKETPLACE_ADMIN_ROLE holders.
const KALOS_MARKET = "0x0FF8b7afC288AC42f82320f54a49c400f233bF07";
const KALOS_MARKET_IMPL = "0xbC0FcA554C5DBF978850C7fffAC944a6A0a9e198";
const KALOS_ADMIN = "0x9332e35e87eAc40a0810813a7a12C458E8043184";
// The marketplace's payment token (Kalos' own WHYPE, not the canonical one).
const KALOS_WHYPE = "0x41051f27c609dB70af05b7128f15155Dc8E49Ac7";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const MARKET_ABI = [
  "function setCollectionApprovalStatus(address,uint8,address,uint256)",
  "function setCollectionCreatorFee(address,(uint32,address))",
  "function collectionApprovals(address) view returns (uint8)",
  "function collectionCreatorFees(address) view returns (uint256 fee, address recipient)",
  "function createOrUpdateListings((address nft,uint256 tokenId,uint64 quantity,uint128 pricePerItem,uint64 expirationTime,address paymentToken)[])",
  "function buyItems((address nft,uint256 tokenId,address owner,uint64 quantity,uint128 maxPricePerItem,address paymentToken,bool usingEth)[]) payable",
  "function fee() view returns (uint256)",
  "error NotERC721()",
  "error PaymentTokenNotSupported()",
  "error CollectionFeeTooHigh()",
  "error AccessControlUnauthorizedAccount(address,bytes32)",
];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8,bool)",
  "function observe(uint32[]) view returns (int56[],uint160[])",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
];
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];
const E = (n) => ethers.parseEther(String(n));
const PROV = ethers.sha256(ethers.toUtf8Bytes("herd provenance (fork)"));

const GAS = [];
async function gas(label, txPromise) {
  const r = await (await txPromise).wait();
  GAS.push({ label, gasUsed: Number(r.gasUsed) });
  return r;
}

async function herdForkFixture() {
  const [owner, treasury, seller, buyer, alice] = await ethers.getSigners();
  const Herd = await ethers.getContractFactory("ElyHerd");
  // Testnet defaults from the deploy manifest: 1 HYPE fixed, allocations 111/1611/0/1611.
  const herd = await Herd.deploy("The Herd", "HERD", owner.address, treasury.address, WHYPE, USDC, E(1), 111, 1611, 0, 1611);
  GAS.push({ label: "ElyHerd deploy", gasUsed: Number((await herd.deploymentTransaction().wait()).gasUsed) });
  await herd.setProvenanceHash(PROV);
  const market = new ethers.Contract(KALOS_MARKET, MARKET_ABI, owner);
  const pool = new ethers.Contract(POOL, POOL_ABI, owner);
  const router = new ethers.Contract(KALOS_ROUTER, ROUTER_ABI, owner);
  return { owner, treasury, seller, buyer, alice, herd, market, pool, router };
}

async function kalosAdmin() {
  await impersonateAccount(KALOS_ADMIN);
  await setBalance(KALOS_ADMIN, E(10));
  return ethers.getSigner(KALOS_ADMIN);
}

async function swapNativeToUsdc(f, amount) {
  const deadline = (await time.latest()) + 3600;
  return f.router.exactInputSingle(
    { tokenIn: WHYPE, tokenOut: USDC, fee: 20000, recipient: f.owner.address, deadline, amountIn: amount, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    { value: amount },
  );
}

describe("Fork: ElyHerd on Elysium testnet (Kalos)", function () {
  before(async function () {
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 99801n) this.skip();
    await mine(); // EDR cannot execute calls at the forked block of an unknown chain
  });

  after(function () {
    if (!GAS.length) return;
    const dir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fork-gas-herd.json"), JSON.stringify({ forkBlock: Number(process.env.ELYIA_FORK_BLOCK || 20530000), results: GAS }, null, 2) + "\n");
    console.log("\n    Fork gas (gasUsed):");
    for (const g of GAS) console.log(`      ${g.label.padEnd(64)} ${String(g.gasUsed).padStart(9)}`);
  });

  describe("Kalos marketplace listing", function () {
    it("the marketplace proxy points at the researched implementation; ElyHerd answers the ERC-165 ids Kalos and its UI use", async function () {
      const f = await loadFixture(herdForkFixture);
      const impl = ethers.getAddress("0x" + (await ethers.provider.getStorage(KALOS_MARKET, IMPL_SLOT)).slice(26));
      expect(impl).to.equal(KALOS_MARKET_IMPL);
      for (const id of ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f", "0x2a55205a", "0x49064906"]) expect(await f.herd.supportsInterface(id), id).to.equal(true);
      expect(await f.herd.supportsInterface("0xd9b67a26")).to.equal(false);
    });

    it("a Kalos admin can register ElyHerd as ERC-721 (the ERC-165 check passes); an ERC-20 is rejected with NotERC721", async function () {
      const f = await loadFixture(herdForkFixture);
      const admin = await kalosAdmin();
      const m = f.market.connect(admin);
      const ha = await f.herd.getAddress();
      expect(await m.collectionApprovals(ha)).to.equal(0);
      await expect(m.setCollectionApprovalStatus(WHYPE, 1, KALOS_WHYPE, 0)).to.be.revertedWithCustomError(f.market, "NotERC721");
      await expect(m.setCollectionApprovalStatus(ha, 1, WHYPE, 0)).to.be.revertedWithCustomError(f.market, "PaymentTokenNotSupported");
      await expect(f.market.connect(f.alice).setCollectionApprovalStatus(ha, 1, KALOS_WHYPE, 0)).to.be.revertedWithCustomError(f.market, "AccessControlUnauthorizedAccount");
      await gas("Kalos setCollectionApprovalStatus(ElyHerd)", m.setCollectionApprovalStatus(ha, 1, KALOS_WHYPE, 0));
      expect(await m.collectionApprovals(ha)).to.equal(1);
      await expect(m.setCollectionCreatorFee(ha, [2001, f.treasury.address])).to.be.revertedWithCustomError(f.market, "CollectionFeeTooHigh");
      await m.setCollectionCreatorFee(ha, [500, f.treasury.address]);
      const cf = await m.collectionCreatorFees(ha);
      expect(cf.fee).to.equal(500);
      expect(cf.recipient).to.equal(f.treasury.address);
    });

    it("listed ElyHerd sells on Kalos in native HYPE; the treasury receives the 5% creator fee", async function () {
      const f = await loadFixture(herdForkFixture);
      const admin = await kalosAdmin();
      const ha = await f.herd.getAddress();
      await f.market.connect(admin).setCollectionApprovalStatus(ha, 1, KALOS_WHYPE, 0);
      await f.market.connect(admin).setCollectionCreatorFee(ha, [500, f.treasury.address]);
      await f.herd.teamMint(f.seller.address, 1);
      await f.herd.connect(f.seller).setApprovalForAll(KALOS_MARKET, true);
      const exp = (await time.latest()) + 3600;
      await gas("Kalos createOrUpdateListings (1 ElyHerd)", f.market.connect(f.seller).createOrUpdateListings([[ha, 1, 1, E(1), exp, KALOS_WHYPE]]));
      const buy = f.market.connect(f.buyer).buyItems([[ha, 1, f.seller.address, 1, E(1), KALOS_WHYPE, true]], { value: E(1) });
      await expect(buy).to.changeEtherBalances([f.buyer, f.treasury, f.seller], [-E(1), E(0.05), E(0.93)]);
      expect(await f.herd.ownerOf(1)).to.equal(f.buyer.address);
    });
  });

  describe("Kalos V3 WHYPE/USDC TWAP", function () {
    it("ships with observation cardinality 1: right after a swap the TWAP is unavailable -> fail closed, then the admin fallback", async function () {
      const f = await loadFixture(herdForkFixture);
      const s0 = await f.pool.slot0();
      expect(s0.observationCardinality).to.equal(1);
      expect(await f.pool.token0()).to.equal(USDC);
      await f.herd.setOracle(POOL, 60, 500);
      await f.herd.setPhaseConfig(Phase.PUBLIC, await time.latest(), (await time.latest()) + 86400, PriceMode.USD, 0, 2_000_000);
      await f.herd.setPhase(Phase.PUBLIC);
      const t0 = Number((await f.pool.slot0()).tick);
      await swapNativeToUsdc(f, E(2)); // moves the tick, so it overwrites the single observation with "now"
      expect(Number((await f.pool.slot0()).tick)).to.not.equal(t0);
      await expect(f.pool.observe([60, 0])).to.be.reverted; // 'OLD'
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      // Documented fallback: an admin HYPE/USD price with a short staleness window.
      const tick = Number((await f.pool.slot0()).tick);
      const usdPerHype6 = BigInt(Math.round(1e18 / Math.pow(1.0001, tick)));
      await f.herd.setFallbackPrice(usdPerHype6, 900);
      const [w, src] = await f.herd.quoteWithSource(Phase.PUBLIC);
      expect(src).to.equal(PriceSource.FALLBACK);
      expect(w).to.equal((2_000_000n * 10n ** 18n + usdPerHype6 - 1n) / usdPerHype6);
    });

    it("after growing cardinality and accruing observations, quotes $2 from the real TWAP and mints with a refund", async function () {
      const f = await loadFixture(herdForkFixture);
      await f.herd.setOracle(POOL, 60, 500);
      await gas("ElyHerd.growOracleCardinality(32) on the Kalos pool", f.herd.growOracleCardinality(32));
      expect((await f.pool.slot0()).observationCardinalityNext).to.equal(32);
      for (let i = 0; i < 3; i++) {
        await swapNativeToUsdc(f, E(1)); // ~3 ticks: a swap only writes an observation when the tick moves
        await time.increase(45);
        await mine();
      }
      expect((await f.pool.slot0()).observationCardinality).to.be.greaterThan(1);
      expect(await f.herd.quote(Phase.PUBLIC)).to.equal(E(1)); // fixed-mode phases ignore the oracle

      await f.herd.setPhaseConfig(Phase.PUBLIC, await time.latest(), (await time.latest()) + 86400, PriceMode.USD, 0, 2_000_000);
      await f.herd.setPhase(Phase.PUBLIC);
      const [cum2] = await f.pool.observe([60, 0]);
      const tick2 = Math.floor(Number(cum2[1] - cum2[0]) / 60);
      const [q, src2] = await f.herd.quoteWithSource(Phase.PUBLIC);
      expect(src2).to.equal(PriceSource.TWAP);
      const ref2 = usdToWeiRef(2_000_000, 6, tick2, true);
      expect(Math.abs(Number(q) - ref2) / ref2).to.be.lessThan(1e-6);
      console.log(`      $2 at TWAP tick ${tick2} = ${ethers.formatEther(q)} HYPE (testnet prices are fake: ~${(1e12 / Math.pow(1.0001, tick2)).toFixed(0)} USDC/HYPE)`);
      // A fresh fallback that agrees is accepted; one that disagrees by > 5% fails closed.
      const fb = BigInt(Math.round(1e18 / Math.pow(1.0001, tick2)));
      await f.herd.setFallbackPrice(fb, 900);
      expect((await f.herd.quoteWithSource(Phase.PUBLIC))[1]).to.equal(PriceSource.TWAP);
      await f.herd.setFallbackPrice((fb * 80n) / 100n, 900);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
      await f.herd.setFallbackPrice(0, 0);
      const q3 = await f.herd.quote(Phase.PUBLIC);
      const r = await gas("ElyHerd.mintPublic USD mode (real Kalos TWAP)", f.herd.connect(f.alice).mintPublic({ value: q3 * 2n }));
      const ev = r.logs.map((l) => { try { return f.herd.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Minted");
      expect(ev.args.pricePaid).to.equal(q3);
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(q3);
    });

    it("a large spot move inside the TWAP window (manipulation) fails closed", async function () {
      const f = await loadFixture(herdForkFixture);
      await f.herd.setOracle(POOL, 60, 100);
      await f.herd.growOracleCardinality(32);
      for (let i = 0; i < 2; i++) {
        await swapNativeToUsdc(f, E(1));
        await time.increase(61);
        await mine();
      }
      await f.herd.setPhaseConfig(Phase.PUBLIC, await time.latest(), (await time.latest()) + 86400, PriceMode.USD, 0, 2_000_000);
      await f.herd.setPhase(Phase.PUBLIC);
      await f.herd.quote(Phase.PUBLIC); // healthy
      const before = Number((await f.pool.slot0()).tick);
      await swapNativeToUsdc(f, E(150)); // dump HYPE into the pool: spot moves sharply within the window
      const after = Number((await f.pool.slot0()).tick);
      expect(Math.abs(after - before)).to.be.greaterThan(100);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
    });
  });
});
