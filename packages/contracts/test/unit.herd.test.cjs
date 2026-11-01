// Unit tests for ElyHerd ("The Herd") on the in-process chain.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { prng } = require("./helpers.cjs");
const { Phase, PriceMode, PriceSource, ListId, Bucket, wlLeaf, collabLeaf, merkle, tag, usdToWeiRef } = require("./herd.helpers.cjs");

const E = (n) => ethers.parseEther(String(n));
const PROV = ethers.sha256(ethers.toUtf8Bytes("herd provenance: ordered sha256 of 3333 images"));
const DAY = 86400;

async function herdFixture() {
  const signers = await ethers.getSigners();
  const [owner, treasury, alice, bob, carol, dave, eve, mallory] = signers;
  const Mock = await ethers.getContractFactory("MockERC20");
  const usdc = await Mock.deploy("USD Coin", "USDC", 6);
  const whype = await Mock.deploy("Wrapped HYPE", "WHYPE", 18);
  const herd = await (await ethers.getContractFactory("ElyHerd")).deploy(
    "The Herd", "HERD", owner.address, treasury.address, await whype.getAddress(), await usdc.getAddress(), E(1), 111, 1611, 0, 1611,
  );
  const Pool = await ethers.getContractFactory("MockHerdPool");
  // Real Kalos layout: token0 = USDC, token1 = WHYPE.
  const pool = await Pool.deploy(await usdc.getAddress(), await whype.getAddress());
  return { signers, owner, treasury, alice, bob, carol, dave, eve, mallory, usdc, whype, herd, pool, Pool };
}

/** Sets provenance (once), a window around now for `phase`, and moves to it. */
async function open(f, phase, { price = E(1), mode = PriceMode.FIXED, usd6 = 0, length = DAY } = {}) {
  if ((await f.herd.provenanceHash()) === ethers.ZeroHash) await f.herd.setProvenanceHash(PROV);
  const now = await time.latest();
  await f.herd.setPhaseConfig(phase, now, now + length, mode, price, usd6);
  if ((await f.herd.phase()) < phase) await f.herd.setPhase(phase);
}

/** Supply invariants that must hold after every action. */
async function checkInvariants(herd) {
  const a = await herd.allocations();
  const [team, wl, collab, pub, tm, wm, cm, pm, burned] = a.map(Number);
  expect(team + wl + collab + pub + burned).to.be.lte(3333);
  expect(tm).to.be.lte(team);
  expect(wm).to.be.lte(wl);
  expect(cm).to.be.lte(collab);
  expect(pm).to.be.lte(pub);
  const total = Number(await herd.totalSupply());
  expect(total).to.equal(tm + wm + cm + pm);
  expect(total).to.be.lte(Number(await herd.maxMintable()));
  return { team, wl, collab, pub, tm, wm, cm, pm, burned, total };
}

describe("ElyHerd", function () {
  describe("deployment and views", function () {
    it("sets name, supply, allocations, prices, royalty, owner and flags", async function () {
      const f = await loadFixture(herdFixture);
      expect(await f.herd.name()).to.equal("The Herd");
      expect(await f.herd.symbol()).to.equal("HERD");
      expect(await f.herd.MAX_SUPPLY()).to.equal(3333);
      expect(await f.herd.totalSupply()).to.equal(0);
      expect(await f.herd.phase()).to.equal(Phase.CLOSED);
      expect((await f.herd.allocations()).map(Number)).to.deep.equal([111, 1611, 0, 1611, 0, 0, 0, 0, 0]);
      for (const p of [Phase.WL, Phase.PUBLIC]) {
        const c = await f.herd.phaseConfig(p);
        expect(c.priceMode).to.equal(PriceMode.FIXED);
        expect(c.priceWei).to.equal(E(1));
      }
      const [recv, amt] = await f.herd.royaltyInfo(1, 10000);
      expect(recv).to.equal(f.treasury.address);
      expect(amt).to.equal(500);
      expect(await f.herd.owner()).to.equal(f.owner.address);
      expect(await f.herd.treasury()).to.equal(f.treasury.address);
      expect(await f.herd.eoaOnly()).to.equal(true);
      expect(await f.herd.paused()).to.equal(false);
      expect(await f.herd.maxMintable()).to.equal(3333);
      expect([...(await f.herd.merkleRoots())]).to.deep.equal([ethers.ZeroHash, ethers.ZeroHash]);
    });

    it("ERC-165: ERC-721, ERC-721 Metadata, ERC-2981, EIP-4906, ERC-165 (what Kalos and wallets check)", async function () {
      const f = await loadFixture(herdFixture);
      for (const id of ["0x80ac58cd", "0x5b5e139f", "0x2a55205a", "0x49064906", "0x01ffc9a7"]) expect(await f.herd.supportsInterface(id), id).to.equal(true);
      for (const id of ["0xd9b67a26", "0xffffffff", "0x12345678"]) expect(await f.herd.supportsInterface(id), id).to.equal(false);
    });

    it("constructor rejects a zero treasury, a zero owner and allocations above MAX_SUPPLY", async function () {
      const f = await loadFixture(herdFixture);
      const H = await ethers.getContractFactory("ElyHerd");
      const args = (o) => ["The Herd", "HERD", f.owner.address, f.treasury.address, ethers.ZeroAddress, ethers.ZeroAddress, E(1), 111, 1611, 0, 1611].map((v, i) => (i in o ? o[i] : v));
      await expect(H.deploy(...args({ 3: ethers.ZeroAddress }))).to.be.revertedWithCustomError(f.herd, "ZeroAddress");
      await expect(H.deploy(...args({ 2: ethers.ZeroAddress }))).to.be.revertedWithCustomError(f.herd, "OwnableInvalidOwner");
      await expect(H.deploy(...args({ 7: 112 }))).to.be.revertedWithCustomError(f.herd, "BadAllocations");
      await H.deploy(...args({ 8: 1611 - 1, 9: 1 })); // sum 3333 exactly is fine
    });

    it("rejects plain HYPE transfers (no receive)", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.alice.sendTransaction({ to: await f.herd.getAddress(), value: 1 })).to.be.reverted;
    });

    it("tokenURI reverts for a nonexistent token", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.tokenURI(1)).to.be.revertedWithCustomError(f.herd, "ERC721NonexistentToken");
    });
  });

  describe("phases", function () {
    it("moves forward only, needs provenance to open, emits PhaseChanged", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setPhase(Phase.WL)).to.be.revertedWithCustomError(f.herd, "ProvenanceNotSet");
      await f.herd.setProvenanceHash(PROV);
      await expect(f.herd.setPhase(Phase.CLOSED)).to.be.revertedWithCustomError(f.herd, "BadPhaseTransition");
      await expect(f.herd.setPhase(Phase.WL)).to.emit(f.herd, "PhaseChanged").withArgs(Phase.CLOSED, Phase.WL);
      await expect(f.herd.setPhase(Phase.WL)).to.be.revertedWithCustomError(f.herd, "BadPhaseTransition");
      await f.herd.setPhase(Phase.ENDED); // skipping PUBLIC is allowed
      await expect(f.herd.setPhase(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "BadPhaseTransition");
    });

    it("setPhaseConfig validates the phase, the window and USD prices", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setPhaseConfig(Phase.CLOSED, 1, 2, 0, 0, 0)).to.be.revertedWithCustomError(f.herd, "BadPhaseConfig");
      await expect(f.herd.setPhaseConfig(Phase.ENDED, 1, 2, 0, 0, 0)).to.be.revertedWithCustomError(f.herd, "BadPhaseConfig");
      await expect(f.herd.setPhaseConfig(Phase.PUBLIC, 5, 5, 0, 0, 0)).to.be.revertedWithCustomError(f.herd, "BadPhaseConfig");
      await expect(f.herd.setPhaseConfig(Phase.PUBLIC, 1, 2, PriceMode.USD, 0, 0)).to.be.revertedWithCustomError(f.herd, "BadPhaseConfig");
      await expect(f.herd.setPhaseConfig(Phase.WL, 10, 20, PriceMode.FIXED, 0, 0))
        .to.emit(f.herd, "PhaseConfigured").withArgs(Phase.WL, 10, 20, PriceMode.FIXED, 0, 0);
      expect(await f.herd.quote(Phase.WL)).to.equal(0); // WL price can be 0
      await expect(f.herd.quote(Phase.CLOSED)).to.be.revertedWithCustomError(f.herd, "WrongPhase");
    });

    it("timing edges: before start and at end revert; at start and end-1 succeed", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setProvenanceHash(PROV);
      const now = await time.latest();
      const start = now + 100, end = now + 200;
      await f.herd.setPhaseConfig(Phase.PUBLIC, start, end, 0, E(1), 0);
      await f.herd.setPhase(Phase.PUBLIC);
      await time.setNextBlockTimestamp(start - 1);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "PhaseNotOpen");
      await time.setNextBlockTimestamp(start);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      await time.setNextBlockTimestamp(end - 1);
      await f.herd.connect(f.bob).mintPublic({ value: E(1) });
      expect(await f.herd.isOpen(Phase.PUBLIC)).to.equal(true);
      await time.setNextBlockTimestamp(end);
      await expect(f.herd.connect(f.carol).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "PhaseNotOpen");
      expect(await f.herd.isOpen(Phase.PUBLIC)).to.equal(false);
    });

    it("the admin can extend or shorten a live window", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC, { length: 50 });
      const c = await f.herd.phaseConfig(Phase.PUBLIC);
      await f.herd.setPhaseConfig(Phase.PUBLIC, c.start, Number(c.start) + 10_000, 0, E(1), 0); // extend
      await time.increase(100);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      const now = await time.latest();
      await f.herd.setPhaseConfig(Phase.PUBLIC, c.start, now + 1, 0, E(1), 0); // shorten: closes at the next block
      await expect(f.herd.connect(f.bob).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "PhaseNotOpen");
    });

    it("each mint function only works in its phase", async function () {
      const f = await loadFixture(herdFixture);
      const t = merkle([wlLeaf(f.alice.address)]);
      await f.herd.setMerkleRoot(ListId.WL, t.root);
      await open(f, Phase.WL);
      await expect(f.herd.connect(f.bob).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "WrongPhase");
      await open(f, Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).mintAllowlist(t.proof(wlLeaf(f.alice.address)), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "WrongPhase");
      await f.herd.setPhase(Phase.ENDED);
      await expect(f.herd.connect(f.bob).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "WrongPhase");
    });
  });

  describe("public mint", function () {
    it("mints sequential ids, records mintedBy, keeps the price, emits Minted", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) }))
        .to.emit(f.herd, "Minted").withArgs(f.alice.address, 1, Phase.PUBLIC, E(1))
        .and.to.emit(f.herd, "Transfer").withArgs(ethers.ZeroAddress, f.alice.address, 1);
      await f.herd.connect(f.bob).mintPublic({ value: E(1) });
      expect(await f.herd.ownerOf(2)).to.equal(f.bob.address);
      expect(await f.herd.mintedBy(f.alice.address)).to.equal(1);
      expect(await f.herd.mintedBy(f.bob.address)).to.equal(2);
      expect(await f.herd.totalSupply()).to.equal(2);
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(E(2));
      expect(await f.herd.tokenURI(1)).to.equal(""); // placeholder not set yet
    });

    it("refunds the excess in the same tx and rejects underpayment", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) - 1n }))
        .to.be.revertedWithCustomError(f.herd, "InsufficientPayment").withArgs(E(1), E(1) - 1n);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(3.5) })).to.changeEtherBalances([f.alice, f.herd], [-E(1), E(1)]);
    });

    it("second mint from the same wallet reverts, even after transferring the token away", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "AlreadyMinted");
      await f.herd.connect(f.alice).transferFrom(f.alice.address, f.bob.address, 1);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "AlreadyMinted");
      await f.herd.connect(f.bob).mintPublic({ value: E(1) }); // bob holds 2 now: 1 per *minter*, transfers are free
      expect(await f.herd.balanceOf(f.bob.address)).to.equal(2);
    });

    it("1 per wallet spans phases: a WL minter cannot mint again in PUBLIC", async function () {
      const f = await loadFixture(herdFixture);
      const t = merkle([wlLeaf(f.alice.address), wlLeaf(f.bob.address)]);
      await f.herd.setMerkleRoot(ListId.WL, t.root);
      await open(f, Phase.WL);
      await f.herd.connect(f.alice).mintAllowlist(t.proof(wlLeaf(f.alice.address)), { value: E(1) });
      await open(f, Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "AlreadyMinted");
      await f.herd.connect(f.bob).mintPublic({ value: E(1) }); // WL member who did not mint can use public
    });

    it("free mint (price 0): msg.value is fully refunded", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC, { price: 0 });
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(0.5) })).to.changeEtherBalance(f.alice, 0);
      await f.herd.connect(f.bob).mintPublic();
      expect(await f.herd.totalSupply()).to.equal(2);
    });

    it("contract minter via its constructor is blocked while eoaOnly; allowed (once per contract) when off", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      const CM = await ethers.getContractFactory("HerdConstructorMinter");
      await expect(CM.connect(f.mallory).deploy(await f.herd.getAddress(), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "ContractMinter");
      await expect(f.herd.connect(f.alice).setEoaOnly(false)).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await expect(f.herd.setEoaOnly(false)).to.emit(f.herd, "EoaOnlySet").withArgs(false);
      const c = await CM.connect(f.mallory).deploy(await f.herd.getAddress(), { value: E(1) });
      expect(await c.id()).to.equal(1);
      expect(await f.herd.mintedBy(await c.getAddress())).to.equal(1);
    });

    it("pause blocks every mint; unpause resumes", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).pause()).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await f.herd.pause();
      expect(await f.herd.isOpen(Phase.PUBLIC)).to.equal(false);
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "EnforcedPause");
      await expect(f.herd.connect(f.alice).mintAllowlist([], { value: E(1) })).to.be.revertedWithCustomError(f.herd, "EnforcedPause");
      await expect(f.herd.connect(f.alice).mintCollab(tag("x"), [], { value: E(1) })).to.be.revertedWithCustomError(f.herd, "EnforcedPause");
      await f.herd.unpause();
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
    });

    it("over-cap: the public bucket is exhausted", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setAllocations(111, 1611, 0, 2);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      await f.herd.connect(f.bob).mintPublic({ value: E(1) });
      await expect(f.herd.connect(f.carol).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "AllocationExhausted");
    });
  });

  describe("allowlist and collab", function () {
    async function lists(f) {
      const wl = merkle([f.alice, f.bob, f.carol].map((s) => wlLeaf(s.address)));
      const collab = merkle([
        collabLeaf(f.dave.address, tag("PARTNER_A")),
        collabLeaf(f.eve.address, tag("PARTNER_A")),
        collabLeaf(f.mallory.address, tag("PARTNER_B")),
        collabLeaf(f.carol.address, tag("PARTNER_B")),
      ]);
      await expect(f.herd.setMerkleRoot(ListId.WL, wl.root)).to.emit(f.herd, "MerkleRootSet").withArgs(ListId.WL, wl.root);
      await f.herd.setMerkleRoot(ListId.COLLAB, collab.root);
      await f.herd.setAllocations(111, 1600, 11, 1611);
      await expect(f.herd.setCollabCap(tag("PARTNER_A"), 1)).to.emit(f.herd, "CollabCapSet").withArgs(tag("PARTNER_A"), 1);
      await f.herd.setCollabCap(tag("PARTNER_B"), 10);
      return { wl, collab };
    }

    it("valid WL proof mints at the WL price (default = public price)", async function () {
      const f = await loadFixture(herdFixture);
      const { wl } = await lists(f);
      await open(f, Phase.WL);
      await expect(f.herd.connect(f.alice).mintAllowlist(wl.proof(wlLeaf(f.alice.address)), { value: E(1) }))
        .to.emit(f.herd, "Minted").withArgs(f.alice.address, 1, Phase.WL, E(1));
      expect((await f.herd.allocations())[5]).to.equal(1);
      expect([...(await f.herd.merkleRoots())]).to.deep.equal([wl.root, await f.herd.collabRoot()]);
    });

    it("bad proof: someone else's proof, an empty proof, a cleared root", async function () {
      const f = await loadFixture(herdFixture);
      const { wl } = await lists(f);
      await open(f, Phase.WL);
      await expect(f.herd.connect(f.mallory).mintAllowlist(wl.proof(wlLeaf(f.alice.address)), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
      await expect(f.herd.connect(f.mallory).mintAllowlist([], { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
      await f.herd.setMerkleRoot(ListId.WL, ethers.ZeroHash);
      await expect(f.herd.connect(f.alice).mintAllowlist(wl.proof(wlLeaf(f.alice.address)), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
    });

    it("a collab proof cannot be used on the WL list and vice versa", async function () {
      const f = await loadFixture(herdFixture);
      const { wl, collab } = await lists(f);
      await open(f, Phase.WL);
      await expect(f.herd.connect(f.dave).mintAllowlist(collab.proof(collabLeaf(f.dave.address, tag("PARTNER_A"))), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
      await expect(f.herd.connect(f.alice).mintCollab(tag("PARTNER_A"), wl.proof(wlLeaf(f.alice.address)), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
    });

    it("collab mint with the right tag; wrong partner tag reverts; per-partner cap; counters", async function () {
      const f = await loadFixture(herdFixture);
      const { collab } = await lists(f);
      await open(f, Phase.WL);
      const pDave = collab.proof(collabLeaf(f.dave.address, tag("PARTNER_A")));
      await expect(f.herd.connect(f.dave).mintCollab(tag("PARTNER_B"), pDave, { value: E(1) })).to.be.revertedWithCustomError(f.herd, "InvalidProof");
      await expect(f.herd.connect(f.dave).mintCollab(tag("PARTNER_A"), pDave, { value: E(1) }))
        .to.emit(f.herd, "CollabMinted").withArgs(f.dave.address, 1, tag("PARTNER_A"))
        .and.to.emit(f.herd, "Minted").withArgs(f.dave.address, 1, Phase.WL, E(1));
      expect(await f.herd.collabMinted(tag("PARTNER_A"))).to.equal(1);
      const pEve = collab.proof(collabLeaf(f.eve.address, tag("PARTNER_A")));
      await expect(f.herd.connect(f.eve).mintCollab(tag("PARTNER_A"), pEve, { value: E(1) })).to.be.revertedWithCustomError(f.herd, "CollabCapReached");
      await f.herd.setCollabCap(tag("PARTNER_A"), 2);
      await f.herd.connect(f.eve).mintCollab(tag("PARTNER_A"), pEve, { value: E(1) });
      expect((await f.herd.allocations())[6]).to.equal(2);
      await expect(f.herd.setCollabCap(tag("PARTNER_A"), 1)).to.be.revertedWithCustomError(f.herd, "BadAllocations");
    });

    it("unknown partner (cap 0) reverts; the collab bucket caps all partners together", async function () {
      const f = await loadFixture(herdFixture);
      const { collab } = await lists(f);
      await f.herd.setCollabCap(tag("PARTNER_B"), 0);
      await open(f, Phase.WL);
      const pM = collab.proof(collabLeaf(f.mallory.address, tag("PARTNER_B")));
      await expect(f.herd.connect(f.mallory).mintCollab(tag("PARTNER_B"), pM, { value: E(1) })).to.be.revertedWithCustomError(f.herd, "UnknownPartner");
      await f.herd.setCollabCap(tag("PARTNER_B"), 10);
      await f.herd.rollover(Bucket.COLLAB, Bucket.WL, 10); // collab bucket 11 -> 1
      await f.herd.connect(f.mallory).mintCollab(tag("PARTNER_B"), pM, { value: E(1) });
      const pC = collab.proof(collabLeaf(f.carol.address, tag("PARTNER_B")));
      await expect(f.herd.connect(f.carol).mintCollab(tag("PARTNER_B"), pC, { value: E(1) })).to.be.revertedWithCustomError(f.herd, "AllocationExhausted");
    });

    it("WL bucket over-cap", async function () {
      const f = await loadFixture(herdFixture);
      const { wl } = await lists(f);
      await f.herd.setAllocations(111, 1, 0, 1611);
      await open(f, Phase.WL);
      await f.herd.connect(f.alice).mintAllowlist(wl.proof(wlLeaf(f.alice.address)), { value: E(1) });
      await expect(f.herd.connect(f.bob).mintAllowlist(wl.proof(wlLeaf(f.bob.address)), { value: E(1) })).to.be.revertedWithCustomError(f.herd, "AllocationExhausted");
    });

    it("a contract on the WL can mint (eoaOnly applies to public only)", async function () {
      const f = await loadFixture(herdFixture);
      const R = await (await ethers.getContractFactory("HerdReentrantMinter")).deploy(await f.herd.getAddress());
      const t = merkle([wlLeaf(await R.getAddress()), wlLeaf(f.alice.address)]);
      await f.herd.setMerkleRoot(ListId.WL, t.root);
      await open(f, Phase.WL);
      await R.setProof(t.proof(wlLeaf(await R.getAddress())));
      await R.attackAllowlist(0, { value: E(1) });
      expect(await f.herd.ownerOf(1)).to.equal(await R.getAddress());
    });
  });

  describe("team mint", function () {
    it("batches sequential ids to team wallets, exempt from 1 per wallet, capped by the team bucket", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.teamMint(f.owner.address, 1)).to.be.revertedWithCustomError(f.herd, "ProvenanceNotSet");
      await f.herd.setProvenanceHash(PROV);
      await expect(f.herd.connect(f.alice).teamMint(f.alice.address, 1)).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await expect(f.herd.teamMint(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(f.herd, "ZeroAddress");
      await expect(f.herd.teamMint(f.owner.address, 0)).to.be.revertedWithCustomError(f.herd, "BadQuantity");
      await expect(f.herd.teamMint(f.treasury.address, 50)).to.emit(f.herd, "TeamMinted").withArgs(f.treasury.address, 1, 50);
      await f.herd.teamMint(f.treasury.address, 60);
      expect(await f.herd.balanceOf(f.treasury.address)).to.equal(110);
      expect(await f.herd.ownerOf(110)).to.equal(f.treasury.address);
      await expect(f.herd.teamMint(f.treasury.address, 2)).to.be.revertedWithCustomError(f.herd, "AllocationExhausted");
      await f.herd.teamMint(f.dave.address, 1);
      expect(await f.herd.mintedBy(f.treasury.address)).to.equal(0);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.treasury).mintPublic({ value: E(1) }); // team wallet still has its own public mint
      expect(await f.herd.ownerOf(112)).to.equal(f.treasury.address);
      await checkInvariants(f.herd);
    });
  });

  describe("allocations and rollover", function () {
    it("setAllocations: only while CLOSED, sum <= MAX_SUPPLY, team >= team minted", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setAllocations(111, 1611, 1, 1611)).to.be.revertedWithCustomError(f.herd, "BadAllocations");
      await expect(f.herd.setAllocations(100, 1611, 11, 1611)).to.emit(f.herd, "AllocationsSet").withArgs(100, 1611, 11, 1611);
      await f.herd.setProvenanceHash(PROV);
      await f.herd.teamMint(f.owner.address, 10);
      await expect(f.herd.setAllocations(9, 1611, 0, 1611)).to.be.revertedWithCustomError(f.herd, "BadAllocations");
      await f.herd.setPhase(Phase.WL);
      await expect(f.herd.setAllocations(100, 1611, 11, 1611)).to.be.revertedWithCustomError(f.herd, "AllocationsLocked");
      await checkInvariants(f.herd);
    });

    it("rollover follows the phase rules and keeps the sum invariant", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setProvenanceHash(PROV);
      // WL <-> COLLAB any time before ENDED
      await expect(f.herd.rollover(Bucket.WL, Bucket.COLLAB, 100)).to.emit(f.herd, "Rollover").withArgs(Bucket.WL, Bucket.COLLAB, 100);
      await f.herd.rollover(Bucket.COLLAB, Bucket.WL, 40);
      // WL -> PUBLIC only from PUBLIC on
      await expect(f.herd.rollover(Bucket.WL, Bucket.PUBLIC, 1)).to.be.revertedWithCustomError(f.herd, "BadRollover");
      await f.herd.setPhase(Phase.WL);
      await expect(f.herd.rollover(Bucket.WL, Bucket.PUBLIC, 1)).to.be.revertedWithCustomError(f.herd, "BadRollover");
      await expect(f.herd.rollover(Bucket.PUBLIC, Bucket.TEAM, 1)).to.be.revertedWithCustomError(f.herd, "BadRollover");
      await f.herd.setPhase(Phase.PUBLIC);
      await f.herd.rollover(Bucket.WL, Bucket.PUBLIC, 1551);
      await f.herd.rollover(Bucket.COLLAB, Bucket.BURN, 10);
      await expect(f.herd.rollover(Bucket.PUBLIC, Bucket.BURN, 1)).to.be.revertedWithCustomError(f.herd, "BadRollover");
      await f.herd.setPhase(Phase.ENDED);
      await expect(f.herd.rollover(Bucket.WL, Bucket.COLLAB, 1)).to.be.revertedWithCustomError(f.herd, "BadRollover");
      await f.herd.rollover(Bucket.PUBLIC, Bucket.TEAM, 100);
      await f.herd.rollover(Bucket.PUBLIC, Bucket.BURN, 62);
      await f.herd.rollover(Bucket.TEAM, Bucket.BURN, 11);
      // invalid pairs
      for (const [a, b] of [[Bucket.TEAM, Bucket.WL], [Bucket.PUBLIC, Bucket.WL], [Bucket.BURN, Bucket.PUBLIC], [Bucket.TEAM, Bucket.PUBLIC], [Bucket.WL, Bucket.TEAM], [Bucket.WL, Bucket.WL]]) {
        await expect(f.herd.rollover(a, b, 1), `${a}->${b}`).to.be.revertedWithCustomError(f.herd, "BadRollover");
      }
      await expect(f.herd.rollover(Bucket.PUBLIC, Bucket.BURN, 0)).to.be.revertedWithCustomError(f.herd, "BadQuantity");
      const inv = await checkInvariants(f.herd);
      expect([inv.team, inv.wl, inv.collab, inv.pub, inv.burned]).to.deep.equal([200, 0, 50, 3000, 83]);
      expect(inv.team + inv.wl + inv.collab + inv.pub + inv.burned).to.equal(3333);
      expect(await f.herd.maxMintable()).to.equal(3333 - 83);
    });

    it("rollover cannot move minted supply (qty > unminted)", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setAllocations(111, 1611, 0, 3);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      await f.herd.setPhase(Phase.ENDED);
      await expect(f.herd.rollover(Bucket.PUBLIC, Bucket.TEAM, 3)).to.be.revertedWithCustomError(f.herd, "BadQuantity");
      await f.herd.rollover(Bucket.PUBLIC, Bucket.TEAM, 2);
      await expect(f.herd.connect(f.alice).rollover(Bucket.TEAM, Bucket.BURN, 1)).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await checkInvariants(f.herd);
    });
  });

  describe("USD price: Kalos V3 TWAP + admin fallback", function () {
    const USD2 = 2_000_000; // $2
    const TICK = 188_676; // live tick of the Kalos WHYPE/USDC 2% pool (~6,402 USDC/HYPE)

    async function usdSetup(f, { spot = TICK, twap = TICK } = {}) {
      await f.pool.set(spot, twap);
      await f.herd.setOracle(await f.pool.getAddress(), 600, 200);
      await open(f, Phase.PUBLIC, { mode: PriceMode.USD, usd6: USD2, price: 0 });
    }

    it("setOracle validates the window, the deviation and the pool tokens; 0 disables", async function () {
      const f = await loadFixture(herdFixture);
      const pa = await f.pool.getAddress();
      await expect(f.herd.setOracle(pa, 59, 200)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      await expect(f.herd.setOracle(pa, 86401, 200)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      await expect(f.herd.setOracle(pa, 600, 0)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      await expect(f.herd.setOracle(pa, 600, 5001)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      const other = await (await ethers.getContractFactory("MockERC20")).deploy("X", "X", 18);
      const wrong = await f.Pool.deploy(await f.usdc.getAddress(), await other.getAddress());
      await expect(f.herd.setOracle(await wrong.getAddress(), 600, 200)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      await expect(f.herd.setOracle(pa, 600, 200)).to.emit(f.herd, "OracleSet").withArgs(pa, 600, 200);
      const o = await f.herd.oracle();
      expect(o.usdIsToken0).to.equal(true);
      expect(o.usdDecimals).to.equal(6);
      await f.herd.setOracle(ethers.ZeroAddress, 0, 0);
      expect((await f.herd.oracle()).pool).to.equal(ethers.ZeroAddress);
      // A collection deployed without oracle tokens cannot enable the TWAP.
      const bare = await (await ethers.getContractFactory("ElyHerd")).deploy("H", "H", f.owner.address, f.treasury.address, ethers.ZeroAddress, ethers.ZeroAddress, 0, 1, 1, 1, 1);
      await expect(bare.setOracle(pa, 600, 200)).to.be.revertedWithCustomError(bare, "BadOracleConfig");
    });

    it("TWAP quote matches 1.0001^tick for positive/negative ticks and both token orders", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f);
      let [w, src] = await f.herd.quoteWithSource(Phase.PUBLIC);
      expect(src).to.equal(PriceSource.TWAP);
      const ref = usdToWeiRef(USD2, 6, TICK, true);
      expect(Math.abs(Number(w) - ref) / ref).to.be.lessThan(1e-9);
      expect(await f.herd.quote(Phase.PUBLIC)).to.equal(w);
      // ~$2 at ~6,402 USDC/HYPE is ~0.000312 HYPE
      expect(w).to.be.within(E(0.0003), E(0.00032));

      for (const t of [-TICK, -1, 0, 1, 77_000]) {
        await f.pool.set(t, t);
        [w] = await f.herd.quoteWithSource(Phase.PUBLIC);
        const r = usdToWeiRef(USD2, 6, t, true);
        expect(Math.abs(Number(w) - r), `tick ${t}`).to.be.lte(Math.max(1, r * 1e-9)); // ceil rounding: at most 1 wei
      }
      // USD token as token1
      const rev = await f.Pool.deploy(await f.whype.getAddress(), await f.usdc.getAddress());
      await rev.set(-TICK, -TICK);
      await f.herd.setOracle(await rev.getAddress(), 600, 200);
      expect((await f.herd.oracle()).usdIsToken0).to.equal(false);
      [w] = await f.herd.quoteWithSource(Phase.PUBLIC);
      const r2 = usdToWeiRef(USD2, 6, -TICK, false);
      expect(Math.abs(Number(w) - r2) / r2).to.be.lessThan(1e-9);
    });

    it("mint in USD mode charges the TWAP quote and refunds the slippage buffer", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f);
      const q = await f.herd.quote(Phase.PUBLIC);
      await expect(f.herd.connect(f.alice).mintPublic({ value: (q * 105n) / 100n }))
        .to.emit(f.herd, "Minted").withArgs(f.alice.address, 1, Phase.PUBLIC, q);
      await expect(f.herd.connect(f.bob).mintPublic({ value: q - 1n })).to.be.revertedWithCustomError(f.herd, "InsufficientPayment");
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(q);
    });

    it("manipulated spot (spot far from TWAP) fails closed", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f, { spot: TICK - 2000, twap: TICK }); // ~-18% spot move
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
      await f.pool.set(TICK - 19, TICK); // ~0.19%, within 2%
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
    });

    it("TWAP far from a fresh admin fallback fails closed; within tolerance uses the TWAP", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f);
      const usdPerHype6 = Math.round(1e6 / (Math.pow(1.0001, TICK) * 1e-12)); // ~6402e6
      await f.herd.setFallbackPrice(Math.round(usdPerHype6 * 0.9), 3600);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleDeviation");
      await f.herd.setFallbackPrice(Math.round(usdPerHype6 * 1.005), 3600);
      expect((await f.herd.quoteWithSource(Phase.PUBLIC))[1]).to.equal(PriceSource.TWAP);
    });

    it("cardinality-1 pool (observe reverts 'OLD') falls back to a fresh admin price; none -> OracleUnavailable", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f);
      await f.pool.setObserveReverts(true);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await expect(f.herd.setFallbackPrice(4_000_000n, 600)).to.emit(f.herd, "FallbackPriceSet").withArgs(4_000_000n, 600); // $4/HYPE
      const [w, src] = await f.herd.quoteWithSource(Phase.PUBLIC);
      expect(src).to.equal(PriceSource.FALLBACK);
      expect(w).to.equal(E(0.5)); // $2 / $4
      await f.herd.connect(f.alice).mintPublic({ value: E(0.6) });
    });

    it("stale fallback fails closed", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setFallbackPrice(4_000_000n, 600);
      await open(f, Phase.PUBLIC, { mode: PriceMode.USD, usd6: USD2, price: 0 });
      expect(await f.herd.quote(Phase.PUBLIC)).to.equal(E(0.5));
      await time.increase(601);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await expect(f.herd.connect(f.alice).mintPublic({ value: E(1) })).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
    });

    it("zero liquidity, a reverting slot0 or an extreme tick count as no TWAP", async function () {
      const f = await loadFixture(herdFixture);
      await usdSetup(f);
      await f.pool.setLiquidity(0);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await f.pool.setLiquidity(1);
      await f.pool.setSlot0Reverts(true);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await f.pool.setSlot0Reverts(false);
      await f.pool.set(-887272, -887272); // the broken zero-liquidity Kalos pools sit here
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
      await f.pool.set(400_001, 400_001);
      await expect(f.herd.quote(Phase.PUBLIC)).to.be.revertedWithCustomError(f.herd, "OracleUnavailable");
    });

    it("setFallbackPrice validates staleness; growOracleCardinality forwards to the pool", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setFallbackPrice(1, 0)).to.be.revertedWithCustomError(f.herd, "BadFallbackPrice");
      await expect(f.herd.setFallbackPrice(1, 7 * DAY + 1)).to.be.revertedWithCustomError(f.herd, "BadFallbackPrice");
      await expect(f.herd.setFallbackPrice(2n ** 128n, 60)).to.be.revertedWithCustomError(f.herd, "BadFallbackPrice");
      await f.herd.setFallbackPrice(0, 0); // disable
      await expect(f.herd.growOracleCardinality(64)).to.be.revertedWithCustomError(f.herd, "BadOracleConfig");
      await f.herd.setOracle(await f.pool.getAddress(), 600, 200);
      await expect(f.herd.connect(f.alice).growOracleCardinality(64)).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await expect(f.herd.growOracleCardinality(64)).to.emit(f.herd, "OracleCardinalityIncreased").withArgs(await f.pool.getAddress(), 64);
      expect(await f.pool.cardinalityNext()).to.equal(64);
    });

    it("fixed-mode phases ignore the oracle entirely", async function () {
      const f = await loadFixture(herdFixture);
      await f.pool.setObserveReverts(true);
      await f.herd.setOracle(await f.pool.getAddress(), 600, 200);
      await open(f, Phase.PUBLIC);
      expect([...(await f.herd.quoteWithSource(Phase.PUBLIC))]).to.deep.equal([E(1), PriceSource.FIXED]);
    });
  });

  describe("metadata: provenance, commit-reveal, freeze, contractURI", function () {
    it("provenance only before the first mint", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setProvenanceHash(ethers.ZeroHash)).to.be.revertedWithCustomError(f.herd, "ProvenanceNotSet");
      await expect(f.herd.setProvenanceHash(PROV)).to.emit(f.herd, "ProvenanceHashSet").withArgs(PROV);
      await f.herd.setProvenanceHash(PROV); // changeable while nothing is minted
      await f.herd.teamMint(f.owner.address, 1);
      await expect(f.herd.setProvenanceHash(ethers.id("other"))).to.be.revertedWithCustomError(f.herd, "ProvenanceLocked");
    });

    it("placeholder before reveal; reveal before commit reverts; commit only once the mint is over", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await expect(f.herd.setPlaceholderURI("ipfs://placeholder.json")).to.emit(f.herd, "BatchMetadataUpdate").withArgs(1, 3333);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      expect(await f.herd.tokenURI(1)).to.equal("ipfs://placeholder.json");
      await expect(f.herd.reveal()).to.be.revertedWithCustomError(f.herd, "RevealNotCommitted");
      await expect(f.herd.commitReveal()).to.be.revertedWithCustomError(f.herd, "RevealNotAllowed");
      await expect(f.herd.metadataIndexOf(1)).to.be.revertedWithCustomError(f.herd, "NotRevealed");
      await f.herd.setPhase(Phase.ENDED);
      await expect(f.herd.connect(f.alice).commitReveal()).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      const tx = await f.herd.commitReveal();
      const seedBlock = (await tx.wait()).blockNumber + 32;
      await expect(tx).to.emit(f.herd, "RevealCommitted").withArgs(seedBlock);
      await expect(f.herd.commitReveal()).to.be.revertedWithCustomError(f.herd, "RevealAlreadyCommitted");
      await expect(f.herd.setProvenanceHash(PROV)).to.be.revertedWithCustomError(f.herd, "ProvenanceLocked");
      await expect(f.herd.reveal()).to.be.revertedWithCustomError(f.herd, "RevealTooEarly");
      await mine(40);
      await expect(f.herd.reveal()).to.be.revertedWithCustomError(f.herd, "BaseURINotSet");
      await f.herd.setBaseURI("ipfs://herd/");
      const h = (await ethers.provider.getBlock(seedBlock)).hash;
      const seed = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32", "address"], [h, PROV, await f.herd.getAddress()]));
      const offset = BigInt(seed) % 3333n;
      await expect(f.herd.reveal()).to.emit(f.herd, "Revealed").withArgs(offset, seed).and.to.emit(f.herd, "BatchMetadataUpdate").withArgs(1, 3333);
      expect(await f.herd.revealed()).to.equal(true);
      expect(await f.herd.revealOffset()).to.equal(offset);
      expect(await f.herd.tokenURI(1)).to.equal("ipfs://herd/1");
      expect(await f.herd.metadataIndexOf(1)).to.equal(offset % 3333n);
      await expect(f.herd.reveal()).to.be.revertedWithCustomError(f.herd, "AlreadyRevealed");
      await expect(f.herd.commitReveal()).to.be.revertedWithCustomError(f.herd, "AlreadyRevealed");
    });

    it("an expired commit (seed hash out of the 256-block window) can be re-committed", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setProvenanceHash(PROV);
      await f.herd.setBaseURI("ipfs://herd/");
      await f.herd.setPhase(Phase.ENDED);
      await f.herd.commitReveal();
      await mine(32 + 257);
      await expect(f.herd.reveal()).to.be.revertedWithCustomError(f.herd, "RevealExpired");
      await f.herd.commitReveal();
      await mine(33);
      await f.herd.reveal();
    });

    it("commit is allowed before ENDED once sold out (3333 team-minted in batches)", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setAllocations(3333, 0, 0, 0);
      await f.herd.setProvenanceHash(PROV);
      for (let i = 0; i < 6; i++) await f.herd.teamMint(f.owner.address, 500);
      await expect(f.herd.commitReveal()).to.be.revertedWithCustomError(f.herd, "RevealNotAllowed");
      for (let i = 0; i < 3; i++) await f.herd.teamMint(f.treasury.address, 111);
      expect(await f.herd.totalSupply()).to.equal(3333);
      expect(await f.herd.phase()).to.equal(Phase.CLOSED);
      await f.herd.commitReveal();
      await checkInvariants(f.herd);
    });

    it("freezeMetadata: only after reveal, then base and placeholder URIs are frozen forever", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setProvenanceHash(PROV);
      await expect(f.herd.freezeMetadata()).to.be.revertedWithCustomError(f.herd, "NotRevealed");
      await f.herd.setBaseURI("ipfs://a/");
      await f.herd.setPhase(Phase.ENDED);
      await f.herd.commitReveal();
      await mine(33);
      await f.herd.reveal();
      await expect(f.herd.setBaseURI("ipfs://b/")).to.emit(f.herd, "BatchMetadataUpdate").withArgs(1, 3333);
      await expect(f.herd.freezeMetadata()).to.emit(f.herd, "MetadataFrozen");
      expect(await f.herd.metadataFrozen()).to.equal(true);
      await expect(f.herd.setBaseURI("ipfs://c/")).to.be.revertedWithCustomError(f.herd, "MetadataIsFrozen");
      await expect(f.herd.setPlaceholderURI("x")).to.be.revertedWithCustomError(f.herd, "MetadataIsFrozen");
      await expect(f.herd.freezeMetadata()).to.be.revertedWithCustomError(f.herd, "MetadataIsFrozen");
      expect(await f.herd.baseURI()).to.equal("ipfs://b/");
    });

    it("contractURI is settable and emits ERC-7572 ContractURIUpdated", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setContractURI("https://elyia.xyz/v1/herd/contract.json")).to.emit(f.herd, "ContractURIUpdated");
      expect(await f.herd.contractURI()).to.equal("https://elyia.xyz/v1/herd/contract.json");
      await expect(f.herd.connect(f.alice).setContractURI("x")).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
    });
  });

  describe("royalties, treasury, withdraw, ownership", function () {
    it("ERC-2981 is capped at 10%", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.setRoyalty(f.alice.address, 1001)).to.be.revertedWithCustomError(f.herd, "RoyaltyTooHigh");
      await expect(f.herd.setRoyalty(ethers.ZeroAddress, 100)).to.be.revertedWithCustomError(f.herd, "ZeroAddress");
      await expect(f.herd.setRoyalty(f.alice.address, 1000)).to.emit(f.herd, "RoyaltySet").withArgs(f.alice.address, 1000);
      expect([...(await f.herd.royaltyInfo(7, E(2)))]).to.deep.equal([f.alice.address, E(0.2)]);
    });

    it("withdraw goes only to the owner or the treasury, only by the owner", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      await f.herd.connect(f.bob).mintPublic({ value: E(1) });
      await expect(f.herd.connect(f.alice).withdraw(f.alice.address)).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await expect(f.herd.withdraw(f.alice.address)).to.be.revertedWithCustomError(f.herd, "BadRecipient");
      await expect(f.herd.withdraw(f.treasury.address)).to.changeEtherBalances([f.herd, f.treasury], [-E(2), E(2)]);
      await f.herd.connect(f.carol).mintPublic({ value: E(1) });
      await expect(f.herd.withdraw(f.owner.address)).to.emit(f.herd, "Withdrawn").withArgs(f.owner.address, E(1));
      await expect(f.herd.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.herd, "ZeroAddress");
      await expect(f.herd.setTreasury(f.dave.address)).to.emit(f.herd, "TreasurySet").withArgs(f.dave.address);
      await expect(f.herd.withdraw(f.treasury.address)).to.be.revertedWithCustomError(f.herd, "BadRecipient");
    });

    it("withdraw to a treasury that rejects HYPE reverts and keeps the funds", async function () {
      const f = await loadFixture(herdFixture);
      await open(f, Phase.PUBLIC);
      await f.herd.connect(f.alice).mintPublic({ value: E(1) });
      const rej = await (await ethers.getContractFactory("HerdRejectingMinter")).deploy();
      await f.herd.setTreasury(await rej.getAddress());
      await expect(f.herd.withdraw(await rej.getAddress())).to.be.revertedWithCustomError(f.herd, "WithdrawFailed");
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(E(1));
    });

    it("two-step ownership; renounce disabled; the old owner loses admin power", async function () {
      const f = await loadFixture(herdFixture);
      await expect(f.herd.renounceOwnership()).to.be.revertedWithCustomError(f.herd, "RenounceDisabled");
      await f.herd.transferOwnership(f.alice.address);
      expect(await f.herd.owner()).to.equal(f.owner.address);
      expect(await f.herd.pendingOwner()).to.equal(f.alice.address);
      await expect(f.herd.connect(f.bob).acceptOwnership()).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await f.herd.connect(f.alice).acceptOwnership();
      expect(await f.herd.owner()).to.equal(f.alice.address);
      await expect(f.herd.pause()).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
      await f.herd.connect(f.alice).pause();
    });

    it("every admin function is owner-only", async function () {
      const f = await loadFixture(herdFixture);
      const h = f.herd.connect(f.mallory);
      const calls = [
        () => h.teamMint(f.mallory.address, 1), () => h.setAllocations(1, 1, 1, 1), () => h.setPhaseConfig(Phase.PUBLIC, 1, 2, 0, 0, 0),
        () => h.setPhase(Phase.WL), () => h.setMerkleRoot(ListId.WL, ethers.ZeroHash), () => h.setCollabCap(tag("A"), 1),
        () => h.setOracle(ethers.ZeroAddress, 0, 0), () => h.setFallbackPrice(1, 1), () => h.growOracleCardinality(2), () => h.pause(),
        () => h.unpause(), () => h.setPlaceholderURI(""), () => h.setBaseURI(""), () => h.setContractURI(""), () => h.setProvenanceHash(PROV),
        () => h.commitReveal(), () => h.reveal(), () => h.freezeMetadata(), () => h.setRoyalty(f.mallory.address, 1),
        () => h.setTreasury(f.mallory.address), () => h.withdraw(f.mallory.address), () => h.rollover(Bucket.WL, Bucket.COLLAB, 1),
        () => h.setEoaOnly(false), () => h.renounceOwnership(), () => h.transferOwnership(f.mallory.address),
      ];
      for (const c of calls) await expect(c()).to.be.revertedWithCustomError(f.herd, "OwnableUnauthorizedAccount");
    });
  });

  describe("adversarial: reentrancy and refunds", function () {
    it("re-entering mintPublic from the refund reverts (guard); the attacker keeps exactly one token", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setEoaOnly(false);
      await open(f, Phase.PUBLIC);
      const R = await (await ethers.getContractFactory("HerdReentrantMinter")).deploy(await f.herd.getAddress());
      await R.attackPublic(1, { value: E(2) });
      expect(await R.reentered()).to.equal(true);
      expect(await R.reentryFailed()).to.equal(true);
      expect((await R.reentryError()).slice(0, 10)).to.equal(f.herd.interface.getError("ReentrancyGuardReentrantCall").selector);
      expect(await f.herd.balanceOf(await R.getAddress())).to.equal(1);
      expect(await f.herd.totalSupply()).to.equal(1);
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(E(1));
      expect(await ethers.provider.getBalance(await R.getAddress())).to.equal(E(1)); // refund arrived
    });

    it("re-entering mintAllowlist or withdraw from the refund reverts", async function () {
      const f = await loadFixture(herdFixture);
      const R = await (await ethers.getContractFactory("HerdReentrantMinter")).deploy(await f.herd.getAddress());
      const t = merkle([wlLeaf(await R.getAddress()), wlLeaf(f.alice.address)]);
      await f.herd.setMerkleRoot(ListId.WL, t.root);
      await open(f, Phase.WL);
      await R.setProof(t.proof(wlLeaf(await R.getAddress())));
      await R.attackAllowlist(2, { value: E(1.5) });
      expect(await R.reentryFailed()).to.equal(true);
      expect(await f.herd.balanceOf(await R.getAddress())).to.equal(1);

      const R2 = await (await ethers.getContractFactory("HerdReentrantMinter")).deploy(await f.herd.getAddress());
      await f.herd.setEoaOnly(false);
      await open(f, Phase.PUBLIC);
      await R2.attackPublic(3, { value: E(1.5) });
      expect(await R2.reentryFailed()).to.equal(true);
      expect(await ethers.provider.getBalance(await f.herd.getAddress())).to.equal(E(2));
    });

    it("a minter that rejects its refund cannot mint with excess (RefundFailed), but can with the exact price", async function () {
      const f = await loadFixture(herdFixture);
      await f.herd.setEoaOnly(false);
      await open(f, Phase.PUBLIC);
      const rej = await (await ethers.getContractFactory("HerdRejectingMinter")).deploy();
      await expect(rej.mint(await f.herd.getAddress(), { value: E(1.1) })).to.be.revertedWithCustomError(f.herd, "RefundFailed");
      await rej.mint(await f.herd.getAddress(), { value: E(1) });
      expect(await f.herd.balanceOf(await rej.getAddress())).to.equal(1);
    });
  });

  describe("seeded fuzz: supply invariants", function () {
    it("random mints, team batches, rollovers, phase moves and pauses keep every invariant (seed 0xE1A)", async function () {
      this.timeout(600000);
      const f = await loadFixture(herdFixture);
      const rnd = prng(0xe1a);
      const herdAddr = await f.herd.getAddress();
      // Small buckets so caps are hit often.
      await f.herd.setAllocations(9, 14, 6, 16);
      await f.herd.setProvenanceHash(PROV);
      const wallets = [];
      for (let i = 0; i < 40; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]); // 100 HYPE
        wallets.push(w);
      }
      const tags = [tag("A"), tag("B")];
      const wl = merkle(wallets.slice(0, 24).map((w) => wlLeaf(w.address)));
      const collabLeaves = wallets.slice(16, 32).map((w, i) => collabLeaf(w.address, tags[i % 2]));
      const collab = merkle(collabLeaves);
      await f.herd.setMerkleRoot(ListId.WL, wl.root);
      await f.herd.setMerkleRoot(ListId.COLLAB, collab.root);
      await f.herd.setCollabCap(tags[0], 3);
      await f.herd.setCollabCap(tags[1], 5);
      const now = await time.latest();
      await f.herd.setPhaseConfig(Phase.WL, now, now + 10 * DAY, 0, E(0.5), 0);
      await f.herd.setPhaseConfig(Phase.PUBLIC, now, now + 10 * DAY, 0, E(1), 0);
      await f.herd.setPhase(Phase.WL);

      const minted = new Map(); // wallet -> id
      let paid = 0n, withdrawn = 0n;
      let ok = 0, rejected = 0;
      const expectFail = async (p) => {
        try { await p; return false; } catch (e) { rejected++; if (process.env.HERD_FUZZ_DEBUG) console.log(e.message.slice(0, 140)); return true; }
      };
      for (let step = 0; step < 220; step++) {
        if ((await f.herd.paused()) && rnd.int(3) === 0) await f.herd.unpause();
        const phase = Number(await f.herd.phase());
        const r = rnd.int(100);
        const w = rnd.pick(wallets);
        const extra = rnd.big(E(1));
        if (r < 30) {
          const price = E(1);
          const before = minted.has(w.address);
          const failed = await expectFail(f.herd.connect(w).mintPublic({ value: price + extra }));
          if (!failed) { ok++; minted.set(w.address, Number(await f.herd.mintedBy(w.address))); paid += price; }
          if (before) expect(failed).to.equal(true);
        } else if (r < 50) {
          const idx = wallets.indexOf(w);
          const proof = idx < 24 ? wl.proof(wlLeaf(w.address)) : [];
          const before = minted.has(w.address);
          const failed = await expectFail(f.herd.connect(w).mintAllowlist(proof, { value: E(0.5) + extra }));
          if (!failed) { ok++; minted.set(w.address, Number(await f.herd.mintedBy(w.address))); paid += E(0.5); expect(idx).to.be.lessThan(24); }
          if (before || phase !== Phase.WL) expect(failed).to.equal(true);
        } else if (r < 65) {
          const idx = wallets.indexOf(w);
          const t = tags[(idx - 16) & 1];
          const proof = idx >= 16 && idx < 32 ? collab.proof(collabLeaf(w.address, t)) : [];
          const useTag = rnd.int(5) === 0 ? tags[((idx - 16) & 1) ^ 1] : t; // sometimes the wrong partner tag
          const failed = await expectFail(f.herd.connect(w).mintCollab(useTag, proof, { value: E(0.5) + extra }));
          if (!failed) { ok++; minted.set(w.address, Number(await f.herd.mintedBy(w.address))); paid += E(0.5); expect(useTag).to.equal(t); }
        } else if (r < 72) {
          const failed = await expectFail(f.herd.teamMint(rnd.pick(wallets).address, 1 + rnd.int(3)));
          if (!failed) ok++;
        } else if (r < 82) {
          const from = rnd.int(5), to = rnd.int(5);
          const failed = await expectFail(f.herd.rollover(from, to, 1 + rnd.int(3)));
          if (!failed) ok++;
        } else if (r < 86) {
          // Phase schedule with jitter: WL early, PUBLIC mid-run, ENDED near the end.
          const due = step < 70 + rnd.int(20) ? Phase.WL : step < 170 + rnd.int(20) ? Phase.PUBLIC : Phase.ENDED;
          if (phase < due) await f.herd.setPhase(phase + 1);
        } else if (r < 90) {
          if (!(await f.herd.paused()) && rnd.int(2) === 0) await f.herd.pause();
        } else if (r < 93) {
          const bal = await ethers.provider.getBalance(herdAddr);
          await f.herd.withdraw(f.treasury.address);
          withdrawn += bal;
        } else {
          await f.herd.setCollabCap(rnd.pick(tags), Number(await f.herd.collabMinted(rnd.pick(tags))) + rnd.int(4)).catch(() => rejected++);
        }
        const inv = await checkInvariants(f.herd);
        expect(await ethers.provider.getBalance(herdAddr)).to.equal(paid - withdrawn);
        if (inv.total > 0) expect(await f.herd.ownerOf(inv.total)).to.not.equal(ethers.ZeroAddress);
        await expect(f.herd.ownerOf(inv.total + 1)).to.be.revertedWithCustomError(f.herd, "ERC721NonexistentToken");
        expect(Number(await f.herd.collabMinted(tags[0]))).to.be.lte(Number(await f.herd.collabCap(tags[0])) || 1e9);
      }
      // 1 per wallet: every recorded id is unique, owned at mint time by that wallet (no transfers in the fuzz).
      const ids = [...minted.values()];
      expect(new Set(ids).size).to.equal(ids.length);
      for (const [addr, id] of minted) expect(await f.herd.ownerOf(id)).to.equal(addr);
      if (process.env.HERD_FUZZ_DEBUG) console.log({ ok, rejected, minted: minted.size, inv: await checkInvariants(f.herd) });
      expect(ok).to.be.greaterThan(20);
      expect(rejected).to.be.greaterThan(20);
    });
  });
});
