// ElyAccount + ElyAccountFactory unit tests and agent-policy fuzz.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { NATIVE, MAX, VenueKind, HopKind, hop, route, swapParams, deadlineIn, prng, signForAccount } = require("./helpers.cjs");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;

async function accountFixture() {
  const [owner, agentKey, other, attacker, owner2] = await ethers.getSigners();
  const T = await ethers.getContractFactory("MockERC20");
  const A = await T.deploy("A", "A", 18);
  const B = await T.deploy("B", "B", 18);
  const JUNK = await T.deploy("Junk", "JUNK", 18);
  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
  const v2 = await (await ethers.getContractFactory("MockV2Router")).deploy();
  const vault = await (await ethers.getContractFactory("MockVault")).deploy(await B.getAddress());
  const morpho = await (await ethers.getContractFactory("MockMorpho")).deploy();
  const [a, b, junk, w, v2a] = await Promise.all([A, B, JUNK, weth, v2].map((x) => x.getAddress()));
  await v2.setRate(a, b, 1, 1);
  await v2.setRate(b, a, 1, 1);
  await v2.setRate(a, junk, 1, 1);
  await v2.setRate(w, a, 1, 1);
  await v2.setRate(a, w, 1, 1);
  await A.mint(v2a, E(1e9));
  await B.mint(v2a, E(1e9));
  await JUNK.mint(v2a, E(1e9));
  await weth.deposit({ value: E(1000) });
  await weth.transfer(v2a, E(1000));

  const router = await (await ethers.getContractFactory("ElyiaRouter")).deploy(
    owner.address,
    a,
    [w, v2a, await vault.getAddress()],
    [VenueKind.WRAPPER, VenueKind.V2_ROUTER, VenueKind.VAULT],
  );
  const factory = await (await ethers.getContractFactory("ElyAccountFactory")).deploy();
  const salt = ethers.ZeroHash;
  const predicted = await factory.accountAddress(owner.address, salt);
  await factory.createAccount(owner.address, salt);
  const account = await ethers.getContractAt("ElyAccount", predicted);
  await A.mint(predicted, E(1000));
  await B.mint(predicted, E(1000));
  await owner.sendTransaction({ to: predicted, value: E(10) });

  const sel = {
    swap: await account.ACTION_ROUTER_SWAP(),
    deposit: await account.ACTION_VAULT_DEPOSIT(),
    redeem: await account.ACTION_VAULT_REDEEM(),
    supply: await account.ACTION_LEND_SUPPLY(),
    withdraw: await account.ACTION_LEND_WITHDRAW(),
  };
  const market = { loanToken: a, collateralToken: b, oracle: other.address, irm: other.address, lltv: E(0.8) };
  const marketId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "uint256"], [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]),
  );
  return { owner, agentKey, other, attacker, owner2, A, B, JUNK, weth, v2, vault, morpho, router, factory, account, a, b, junk, w, v2a, sel, market, marketId, salt };
}

async function grant(f, o = {}) {
  const until = o.until ?? BigInt((await time.latest()) + 7 * DAY);
  const calls = o.calls ?? [
    { target: await f.router.getAddress(), action: f.sel.swap },
    { target: await f.vault.getAddress(), action: f.sel.deposit },
    { target: await f.vault.getAddress(), action: f.sel.redeem },
    { target: await f.morpho.getAddress(), action: f.sel.supply },
    { target: await f.morpho.getAddress(), action: f.sel.withdraw },
  ];
  const tokens = o.tokens ?? [
    { token: f.a, perTxCap: E(10), dailyCap: E(25) },
    { token: f.b, perTxCap: E(10), dailyCap: E(25) },
    { token: NATIVE, perTxCap: E(1), dailyCap: E(2) },
    { token: await f.vault.getAddress(), perTxCap: E(10), dailyCap: E(25) },
    { token: f.w, perTxCap: 0, dailyCap: 0 },
  ];
  const markets = o.markets ?? [f.marketId];
  return f.account.connect(f.owner).setAgentPolicy(o.agent ?? f.agentKey.address, until, calls, tokens, markets);
}

async function swapAB(f, o = {}) {
  const amt = o.amount ?? E(1);
  const tokenIn = o.tokenIn ?? f.a;
  const tokenOut = o.tokenOut ?? f.b;
  return swapParams({
    tokenIn,
    tokenOut,
    amountIn: amt,
    minAmountOut: o.minOut ?? 0n,
    recipient: o.recipient ?? (await f.account.getAddress()),
    deadline: await deadlineIn(),
    integrator: o.integrator,
    integratorFeeBps: o.integratorFeeBps,
    routes: o.routes ?? [route(amt, [hop(HopKind.V2, f.v2a, tokenIn, tokenOut)])],
  });
}

describe("ElyAccountFactory (unit)", function () {
  it("CREATE2 address is predictable, per owner and salt, and creation is idempotent", async function () {
    const f = await loadFixture(accountFixture);
    const s1 = ethers.id("one");
    const p = await f.factory.accountAddress(f.other.address, s1);
    await expect(f.factory.connect(f.attacker).createAccount(f.other.address, s1)).to.emit(f.factory, "AccountCreated").withArgs(p, f.other.address, s1);
    const acc = await ethers.getContractAt("ElyAccount", p);
    expect(await acc.owner()).to.equal(f.other.address); // deployed by attacker, still owned by other
    await expect(f.factory.createAccount(f.other.address, s1)).to.not.emit(f.factory, "AccountCreated");
    expect(await f.factory.accountAddress(f.attacker.address, s1)).to.not.equal(p);
    await expect(f.factory.createAccount(NATIVE, s1)).to.be.revertedWithCustomError(f.factory, "ZeroAddress");
  });

  it("clones cannot be re-initialized; the implementation is locked", async function () {
    const f = await loadFixture(accountFixture);
    await expect(f.account.initialize(f.attacker.address)).to.be.revertedWithCustomError(f.account, "NotFactory");
    const impl = await ethers.getContractAt("ElyAccount", await f.factory.implementation());
    expect(await impl.owner()).to.equal(NATIVE);
    await expect(impl.initialize(f.attacker.address)).to.be.revertedWithCustomError(impl, "NotFactory");
  });
});

describe("ElyAccount (unit)", function () {
  describe("owner powers", function () {
    it("execute / executeBatch / withdraw / withdrawAll are owner-only and pay the owner", async function () {
      const f = await loadFixture(accountFixture);
      const acc = await f.account.getAddress();
      const data = f.A.interface.encodeFunctionData("transfer", [f.other.address, E(1)]);
      for (const s of [f.agentKey, f.attacker]) {
        await expect(f.account.connect(s).execute(f.a, 0, data)).to.be.revertedWithCustomError(f.account, "NotOwner");
        await expect(f.account.connect(s).executeBatch([f.a], [0], [data])).to.be.revertedWithCustomError(f.account, "NotOwner");
        await expect(f.account.connect(s).withdraw(f.a, 1)).to.be.revertedWithCustomError(f.account, "NotOwner");
        await expect(f.account.connect(s).withdrawAll([f.a])).to.be.revertedWithCustomError(f.account, "NotOwner");
        await expect(f.account.connect(s).revokeAgent()).to.be.revertedWithCustomError(f.account, "NotOwner");
        await expect(f.account.connect(s).setAgentPolicy(s.address, 9999999999, [], [], [])).to.be.revertedWithCustomError(f.account, "NotOwner");
      }
      await expect(f.account.execute(f.a, 0, data)).to.emit(f.account, "Executed");
      expect(await f.A.balanceOf(f.other.address)).to.equal(E(1));
      await f.account.executeBatch([f.a, f.a], [0, 0], [data, data]);
      expect(await f.A.balanceOf(f.other.address)).to.equal(E(3));
      await expect(f.account.executeBatch([f.a], [0, 0], [data])).to.be.revertedWithCustomError(f.account, "LengthMismatch");
      // Reverts bubble up.
      const bad = f.A.interface.encodeFunctionData("transfer", [f.other.address, E(1e9)]);
      await expect(f.account.execute(f.a, 0, bad)).to.be.revertedWithCustomError(f.A, "ERC20InsufficientBalance");
      const o0 = await f.A.balanceOf(f.owner.address);
      await expect(f.account.withdraw(f.a, E(5))).to.emit(f.account, "Withdrawn").withArgs(f.a, f.owner.address, E(5));
      expect((await f.A.balanceOf(f.owner.address)) - o0).to.equal(E(5));
      await f.account.withdrawAll([f.a, f.b, NATIVE]);
      expect(await f.A.balanceOf(acc)).to.equal(0);
      expect(await f.B.balanceOf(acc)).to.equal(0);
      expect(await ethers.provider.getBalance(acc)).to.equal(0);
    });

    it("owner can withdraw even while an agent policy is active", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      await f.account.withdraw(NATIVE, E(10));
      expect(await ethers.provider.getBalance(await f.account.getAddress())).to.equal(0);
    });
  });

  describe("policy management", function () {
    it("validates the policy", async function () {
      const f = await loadFixture(accountFixture);
      const until = BigInt((await time.latest()) + DAY);
      const r = await f.router.getAddress();
      const acc = f.account.connect(f.owner);
      await expect(acc.setAgentPolicy(NATIVE, until, [], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.owner.address, until, [], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(await f.account.getAddress(), until, [], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.agentKey.address, BigInt(await time.latest()), [], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      // Unknown action (ERC-20 transfer) can never be allowlisted.
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [{ target: f.a, action: "0xa9059cbb" }], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [{ target: f.a, action: "0x095ea7b3" }], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      // EOA target / self target
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [{ target: f.other.address, action: f.sel.swap }], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [{ target: await f.account.getAddress(), action: f.sel.swap }], [], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [], [{ token: f.a, perTxCap: 2, dailyCap: 1 }], [])).to.be.revertedWithCustomError(f.account, "BadPolicy");
      await expect(acc.setAgentPolicy(f.agentKey.address, until, [{ target: r, action: f.sel.swap }], [{ token: f.a, perTxCap: 1, dailyCap: 2 }], []))
        .to.emit(f.account, "AgentPolicySet")
        .withArgs(f.agentKey.address, until, 1);
      expect(await f.account.isCallAllowed(r, f.sel.swap)).to.equal(true);
      expect(await f.account.agentActive()).to.equal(true);
    });
  });

  describe("agent powers", function () {
    it("swaps through the allowlisted router; output lands in the account; audit event", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const acc = await f.account.getAddress();
      const p = await swapAB(f, { amount: E(4), minOut: E(4) });
      const b0 = await f.B.balanceOf(acc);
      await expect(f.account.connect(f.agentKey).agentSwap(await f.router.getAddress(), p))
        .to.emit(f.account, "AgentAction")
        .withArgs(f.agentKey.address, f.sel.swap, await f.router.getAddress(), f.a, E(4), f.b, E(4));
      expect((await f.B.balanceOf(acc)) - b0).to.equal(E(4));
      expect(await f.A.allowance(acc, await f.router.getAddress())).to.equal(0);
      const [, , , spent] = await f.account.tokenRule(f.a);
      expect(spent).to.equal(E(4));
    });

    it("native HYPE in and out through the router", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const acc = await f.account.getAddress();
      const r = await f.router.getAddress();
      const pin = await swapAB(f, { tokenIn: NATIVE, tokenOut: f.a, amount: E(1), routes: [route(E(1), [hop(HopKind.WRAP, f.w, NATIVE, f.w), hop(HopKind.V2, f.v2a, f.w, f.a)])] });
      await f.account.connect(f.agentKey).agentSwap(r, pin);
      const pout = await swapAB(f, { tokenIn: f.a, tokenOut: NATIVE, amount: E(1), routes: [route(E(1), [hop(HopKind.V2, f.v2a, f.a, f.w), hop(HopKind.UNWRAP, f.w, f.w, NATIVE)])] });
      const n0 = await ethers.provider.getBalance(acc);
      await f.account.connect(f.agentKey).agentSwap(r, pout);
      expect((await ethers.provider.getBalance(acc)) - n0).to.equal(E(1));
    });

    it("cannot send output anywhere but the account, or add an integrator fee", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      await f.router.setIntegrator(f.attacker.address, 50);
      const r = await f.router.getAddress();
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f, { recipient: f.attacker.address }))).to.be.revertedWithCustomError(f.account, "BadRecipient");
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f, { recipient: f.agentKey.address }))).to.be.revertedWithCustomError(f.account, "BadRecipient");
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f, { integrator: f.attacker.address, integratorFeeBps: 50 }))).to.be.revertedWithCustomError(f.account, "IntegratorFeeNotAllowed");
    });

    it("cannot call non-allowlisted targets or buy non-allowed tokens", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const r2 = await (await ethers.getContractFactory("ElyiaRouter")).deploy(f.attacker.address, f.a, [f.v2a], [VenueKind.V2_ROUTER]);
      await expect(f.account.connect(f.agentKey).agentSwap(await r2.getAddress(), await swapAB(f))).to.be.revertedWithCustomError(f.account, "CallNotAllowed");
      // Router allowlisted only for swap, not for vault actions.
      await expect(f.account.connect(f.agentKey).agentVaultDeposit(await f.router.getAddress(), E(1), 0)).to.be.revertedWithCustomError(f.account, "CallNotAllowed");
      await expect(f.account.connect(f.agentKey).agentSwap(await f.router.getAddress(), await swapAB(f, { tokenOut: f.junk }))).to.be.revertedWithCustomError(f.account, "TokenNotAllowed");
      // Receive-only token (weth caps 0) cannot be spent.
      await expect(f.account.connect(f.agentKey).agentSwap(await f.router.getAddress(), await swapAB(f, { tokenIn: f.w, tokenOut: f.a }))).to.be.revertedWithCustomError(f.account, "PerTxCapExceeded");
    });

    it("cannot call owner functions or sign", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const ag = f.account.connect(f.agentKey);
      await expect(ag.execute(f.a, 0, "0x")).to.be.revertedWithCustomError(f.account, "NotOwner");
      await expect(ag.withdraw(f.a, 1)).to.be.revertedWithCustomError(f.account, "NotOwner");
      await expect(ag.setAgentPolicy(f.agentKey.address, 9999999999, [], [], [])).to.be.revertedWithCustomError(f.account, "NotOwner");
      await expect(ag.revokeAgent()).to.be.revertedWithCustomError(f.account, "NotOwner");
      const h = ethers.id("permit2 permit");
      const agentSig = await signForAccount(f.agentKey, f.account, h);
      expect(await f.account.isValidSignature(h, agentSig)).to.equal("0xffffffff");
    });

    it("enforces per-tx and daily caps; the day rolls over", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const r = await f.router.getAddress();
      const ag = f.account.connect(f.agentKey);
      await expect(ag.agentSwap(r, await swapAB(f, { amount: E(10) + 1n }))).to.be.revertedWithCustomError(f.account, "PerTxCapExceeded");
      // align to the start of a day to make the test deterministic
      const now = await time.latest();
      await time.increaseTo(Math.floor(now / DAY + 1) * DAY + 10);
      await ag.agentSwap(r, await swapAB(f, { amount: E(10) }));
      await ag.agentSwap(r, await swapAB(f, { amount: E(10) }));
      await expect(ag.agentSwap(r, await swapAB(f, { amount: E(5) + 1n }))).to.be.revertedWithCustomError(f.account, "DailyCapExceeded");
      await ag.agentSwap(r, await swapAB(f, { amount: E(5) }));
      await time.increase(DAY);
      await ag.agentSwap(r, await swapAB(f, { amount: E(10) }));
      // native cap
      const pin = await swapAB(f, { tokenIn: NATIVE, tokenOut: f.a, amount: E(1) + 1n, routes: [route(E(1) + 1n, [hop(HopKind.WRAP, f.w, NATIVE, f.w), hop(HopKind.V2, f.v2a, f.w, f.a)])] });
      await expect(ag.agentSwap(r, pin)).to.be.revertedWithCustomError(f.account, "PerTxCapExceeded");
    });

    it("minOut is enforced by the account as well as the router", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      await expect(f.account.connect(f.agentKey).agentSwap(await f.router.getAddress(), await swapAB(f, { amount: E(1), minOut: E(1) + 1n }))).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
    });

    it("expiry and revocation stop the agent instantly; re-grant does not resurrect old rules", async function () {
      const f = await loadFixture(accountFixture);
      const r = await f.router.getAddress();
      await grant(f, { until: BigInt((await time.latest()) + 100) });
      await f.account.connect(f.agentKey).agentSwap(r, await swapAB(f));
      await time.increase(101);
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f))).to.be.revertedWithCustomError(f.account, "NotAgent");
      await grant(f);
      await f.account.connect(f.agentKey).agentSwap(r, await swapAB(f));
      await expect(f.account.revokeAgent()).to.emit(f.account, "AgentRevoked");
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f))).to.be.revertedWithCustomError(f.account, "NotAgent");
      expect(await f.account.agentActive()).to.equal(false);
      // New policy for the same key with no calls: old router permission is gone.
      await grant(f, { calls: [] });
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f))).to.be.revertedWithCustomError(f.account, "CallNotAllowed");
      // A different key replaces the old one.
      await grant(f, { agent: f.other.address });
      await expect(f.account.connect(f.agentKey).agentSwap(r, await swapAB(f))).to.be.revertedWithCustomError(f.account, "NotAgent");
      await f.account.connect(f.other).agentSwap(r, await swapAB(f));
    });

    it("vault deposit / redeem keep shares and assets in the account", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const acc = await f.account.getAddress();
      const v = await f.vault.getAddress();
      await expect(f.account.connect(f.agentKey).agentVaultDeposit(v, E(5), E(5))).to.emit(f.account, "AgentAction");
      expect(await f.vault.balanceOf(acc)).to.equal(E(5));
      expect(await f.B.allowance(acc, v)).to.equal(0);
      await expect(f.account.connect(f.agentKey).agentVaultDeposit(v, E(11), 0)).to.be.revertedWithCustomError(f.account, "PerTxCapExceeded");
      await expect(f.account.connect(f.agentKey).agentVaultDeposit(v, E(1), E(1) + 1n)).to.be.revertedWithCustomError(f.account, "InsufficientOutput");
      const b0 = await f.B.balanceOf(acc);
      await f.account.connect(f.agentKey).agentVaultRedeem(v, E(5), E(5));
      expect((await f.B.balanceOf(acc)) - b0).to.equal(E(5));
    });

    it("lending is pinned to allowlisted market ids (permissionless markets cannot be used to drain)", async function () {
      const f = await loadFixture(accountFixture);
      await grant(f);
      const m = await f.morpho.getAddress();
      const acc = await f.account.getAddress();
      await expect(f.account.connect(f.agentKey).agentLendSupply(m, f.market, E(3))).to.emit(f.account, "AgentAction");
      expect(await f.morpho.supplied(f.marketId, acc)).to.equal(E(3));
      const evilMarket = { ...f.market, oracle: f.attacker.address };
      await expect(f.account.connect(f.agentKey).agentLendSupply(m, evilMarket, E(1))).to.be.revertedWithCustomError(f.account, "MarketNotAllowed");
      await expect(f.account.connect(f.agentKey).agentLendSupply(m, f.market, E(11))).to.be.revertedWithCustomError(f.account, "PerTxCapExceeded");
      const a0 = await f.A.balanceOf(acc);
      await f.account.connect(f.agentKey).agentLendWithdraw(m, f.market, E(3), 0);
      expect((await f.A.balanceOf(acc)) - a0).to.equal(E(3));
      expect(await f.account.isMarketAllowed(f.marketId)).to.equal(true);
    });
  });

  describe("ERC-1271 (owner only, replay-safe)", function () {
    it("accepts the owner's wrapped signature, rejects raw-hash and cross-account replays", async function () {
      const f = await loadFixture(accountFixture);
      const h = ethers.id("some order");
      const sig = await signForAccount(f.owner, f.account, h);
      expect(await f.account.isValidSignature(h, sig)).to.equal("0x1626ba7e");
      const raw = await f.owner.signMessage(ethers.getBytes(h));
      expect(await f.account.isValidSignature(h, raw)).to.equal("0xffffffff");
      // Second account, same owner: the signature does not transfer.
      const s2 = ethers.id("second");
      await f.factory.createAccount(f.owner.address, s2);
      const acc2 = await ethers.getContractAt("ElyAccount", await f.factory.accountAddress(f.owner.address, s2));
      expect(await acc2.isValidSignature(h, sig)).to.equal("0xffffffff");
      expect(await f.account.isValidSignature(h, "0x1234")).to.equal("0xffffffff");
    });
  });

  describe("policy fuzz (model-based, seeded)", function () {
    it("an adversarial agent never exfiltrates, never exceeds caps, never acts after expiry or revocation", async function () {
      const f = await loadFixture(accountFixture);
      const rnd = prng(0xe1a);
      const acc = await f.account.getAddress();
      const r = await f.router.getAddress();
      const v = await f.vault.getAddress();
      const m = await f.morpho.getAddress();
      const r2 = await (await ethers.getContractFactory("ElyiaRouter")).deploy(f.attacker.address, f.a, [f.v2a], [VenueKind.V2_ROUTER]);
      const r2a = await r2.getAddress();
      const outsiders = [f.attacker.address, f.agentKey.address, f.other.address];
      const tokensWatched = [f.a, f.b, f.junk, v];
      async function outsideValue() {
        let s = 0n;
        for (const o of outsiders) for (const t of tokensWatched) s += await (await ethers.getContractAt("IERC20", t)).balanceOf(o);
        return s;
      }
      const caps = { [f.a]: [E(10), E(25)], [f.b]: [E(10), E(25)], [v]: [E(10), E(25)] };
      let epochOk = false;
      let until = 0;
      let spent = {};
      let day = -1;
      const regrant = async () => {
        until = (await time.latest()) + rnd.int(3) * DAY + 3600;
        await grant(f, { until: BigInt(until) });
        epochOk = true;
        spent = {};
      };
      await regrant();
      const baseOutside = await outsideValue();
      let ok = 0;
      let rejected = 0;
      for (let i = 0; i < 250; i++) {
        const roll = rnd.next();
        if (roll < 0.04) {
          await f.account.revokeAgent();
          epochOk = false;
          continue;
        }
        if (roll < 0.08) {
          await regrant();
          continue;
        }
        if (roll < 0.14) {
          await time.increase(rnd.int(DAY));
          continue;
        }
        const now = (await time.latest()) + 1;
        await time.setNextBlockTimestamp(now);
        const d = Math.floor(now / DAY);
        if (d !== day) {
          day = d;
          spent = {};
        }
        const kind = rnd.pick(["swap", "swap", "swap", "deposit", "redeem", "supply", "badRecipient", "badTarget", "junk"]);
        const amount = rnd.big(E(14));
        const tokenIn = rnd.pick([f.a, f.b]);
        const tokenOut = tokenIn === f.a ? f.b : f.a;
        const signer = rnd.next() < 0.1 ? f.attacker : f.agentKey;
        const active = epochOk && now <= until && signer === f.agentKey;
        let expectOk;
        let tx;
        const within = (tok, amt) => {
          const [perTx, daily] = caps[tok];
          return amt > 0n && amt <= perTx && (spent[tok] ?? 0n) + amt <= daily;
        };
        if (kind === "swap" || kind === "badRecipient" || kind === "badTarget" || kind === "junk") {
          const p = await swapAB(f, {
            tokenIn,
            tokenOut: kind === "junk" ? f.junk : tokenOut,
            amount,
            recipient: kind === "badRecipient" ? rnd.pick(outsiders) : acc,
          });
          expectOk = active && kind === "swap" && within(tokenIn, amount);
          tx = f.account.connect(signer).agentSwap(kind === "badTarget" ? r2a : r, p);
          if (expectOk) spent[tokenIn] = (spent[tokenIn] ?? 0n) + amount;
        } else if (kind === "deposit") {
          expectOk = active && within(f.b, amount);
          tx = f.account.connect(signer).agentVaultDeposit(v, amount, 0);
          if (expectOk) spent[f.b] = (spent[f.b] ?? 0n) + amount;
        } else if (kind === "redeem") {
          const bal = await f.vault.balanceOf(acc);
          const amt = amount > bal ? bal : amount;
          expectOk = active && within(v, amt);
          tx = f.account.connect(signer).agentVaultRedeem(v, amt, 0);
          if (expectOk) spent[v] = (spent[v] ?? 0n) + amt;
        } else {
          const mk = rnd.next() < 0.5 ? f.market : { ...f.market, oracle: f.attacker.address };
          expectOk = active && mk === f.market && within(f.a, amount);
          tx = f.account.connect(signer).agentLendSupply(m, mk, amount);
          if (expectOk) spent[f.a] = (spent[f.a] ?? 0n) + amount;
        }
        if (expectOk) {
          await tx;
          ok++;
        } else {
          await expect(tx).to.be.reverted;
          rejected++;
        }
        // Invariant: nothing ever reaches an outsider.
        expect(await outsideValue()).to.equal(baseOutside);
        // Invariant: on-chain spend counters match the model.
        if (epochOk) {
          for (const t of [f.a, f.b, v]) {
            const [, , , onchain] = await f.account.tokenRule(t);
            expect(onchain).to.equal(spent[t] ?? 0n);
          }
        }
      }
      // Owner can still take everything out at the end.
      await f.account.withdrawAll([f.a, f.b, v, NATIVE]);
      expect(await f.A.balanceOf(acc)).to.equal(0);
      expect(ok).to.be.greaterThan(20);
      expect(rejected).to.be.greaterThan(20);
    });
  });
});
