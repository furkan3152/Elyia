// ElyOrders unit tests: signatures, conditions, replay/nonce protection, malicious keepers.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { NATIVE, MAX, VenueKind, HopKind, OrderKind, hop, route, signOrder, signForAccount } = require("./helpers.cjs");

const E = (n) => ethers.parseEther(String(n));

async function ordersFixture() {
  const [deployer, maker, keeper, attacker, other] = await ethers.getSigners();
  const T = await ethers.getContractFactory("MockERC20");
  const A = await T.deploy("A", "A", 18);
  const B = await T.deploy("B", "B", 18);
  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
  const v2 = await (await ethers.getContractFactory("MockV2Router")).deploy();
  const evil = await (await ethers.getContractFactory("EvilV2Router")).deploy();
  const oracle = await (await ethers.getContractFactory("MockOraclePool")).deploy();
  const [a, b, w, v2a, evilA] = await Promise.all([A, B, weth, v2, evil].map((x) => x.getAddress()));
  await v2.setRate(a, b, 2, 1);
  await v2.setRate(a, w, 1, 1);
  await A.mint(v2a, E(1e9));
  await B.mint(v2a, E(1e9));
  await B.mint(evilA, E(1e9));
  await weth.deposit({ value: E(100) });
  await weth.transfer(v2a, E(100));
  const router = await (await ethers.getContractFactory("ElyiaRouter")).deploy(
    deployer.address,
    a,
    [w, v2a, evilA],
    [VenueKind.WRAPPER, VenueKind.V2_ROUTER, VenueKind.V2_ROUTER],
  );
  const orders = await (await ethers.getContractFactory("ElyOrders")).deploy(await router.getAddress());
  const oa = await orders.getAddress();
  await A.mint(maker.address, E(1000));
  await A.connect(maker).approve(oa, MAX);
  return { deployer, maker, keeper, attacker, other, A, B, weth, v2, evil, oracle, router, orders, a, b, w, v2a, evilA, oa };
}

async function baseOrder(f, o = {}) {
  const now = await time.latest();
  return {
    maker: f.maker.address,
    tokenIn: f.a,
    tokenOut: f.b,
    amountIn: E(10),
    minAmountOut: E(19),
    maxTip: E(0.05),
    oracle: NATIVE,
    triggerTick: 0,
    triggerAbove: true,
    twapWindow: 0,
    maxDeviationTicks: 0,
    kind: OrderKind.LIMIT,
    executions: 1,
    interval: 0,
    startTime: now - 10,
    deadline: now + 86400,
    nonce: 1,
    ...o,
  };
}

const routesAB = (f, amt = E(10), venue) => [route(amt, [hop(HopKind.V2, venue ?? f.v2a, f.a, f.b)])];

describe("ElyOrders (unit)", function () {
  it("executes a signed limit order; maker gets output, keeper gets the tip; replay fails", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f);
    const sig = await signOrder(f.maker, f.orders, o);
    const h = await f.orders.hashOrder(o);
    await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f), E(0.05)))
      .to.emit(f.orders, "OrderExecuted")
      .withArgs(h, f.maker.address, f.keeper.address, OrderKind.LIMIT, 1, E(10), E(20), E(0.05));
    expect(await f.B.balanceOf(f.maker.address)).to.equal(E(20));
    expect(await f.A.balanceOf(f.keeper.address)).to.equal(E(0.05));
    expect(await f.A.balanceOf(f.maker.address)).to.equal(E(1000) - E(10.05));
    expect(await f.A.balanceOf(f.oa)).to.equal(0);
    expect(await f.A.allowance(f.oa, await f.router.getAddress())).to.equal(0);
    await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "FullyExecuted");
    expect(await f.orders.orderDigest(o)).to.equal(
      ethers.TypedDataEncoder.hash(
        { name: "ElyOrders", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: f.oa },
        require("./helpers.cjs").ORDER_TYPES,
        o,
      ),
    );
  });

  it("rejects forged, tampered and wrong-domain signatures", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f);
    const forged = await signOrder(f.attacker, f.orders, o);
    await expect(f.orders.connect(f.keeper).execute(o, forged, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "BadSignature");
    const sig = await signOrder(f.maker, f.orders, o);
    for (const tamper of [{ amountIn: E(20) }, { minAmountOut: E(1) }, { maxTip: E(0.1) }, { tokenOut: f.w }, { nonce: 2 }]) {
      const t = { ...o, ...tamper };
      await expect(f.orders.connect(f.keeper).execute(t, sig, routesAB(f, t.amountIn), 0)).to.be.reverted;
    }
    const orders2 = await (await ethers.getContractFactory("ElyOrders")).deploy(await f.router.getAddress());
    await f.A.connect(f.maker).approve(await orders2.getAddress(), MAX);
    await expect(orders2.connect(f.keeper).execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(orders2, "BadSignature");
  });

  it("caps the keeper tip (signed maxTip and 1% hard cap)", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f);
    const sig = await signOrder(f.maker, f.orders, o);
    await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f), E(0.05) + 1n)).to.be.revertedWithCustomError(f.orders, "TipTooHigh");
    const greedy = await baseOrder(f, { maxTip: E(0.1) + 1n });
    const gsig = await signOrder(f.maker, f.orders, greedy);
    await expect(f.orders.connect(f.keeper).execute(greedy, gsig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "TipTooHigh");
  });

  it("a malicious keeper cannot steal: bad venues, bad prices and redirection all revert", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f);
    const sig = await signOrder(f.maker, f.orders, o);
    const k = f.orders.connect(f.attacker);
    // Pays output to the attacker
    await f.evil.configure(3, f.attacker.address, NATIVE, "0x");
    await expect(k.execute(o, sig, routesAB(f, E(10), f.evilA), 0)).to.be.revertedWithCustomError(f.router, "NoOutput");
    // Bad price (1:1 instead of 2:1) is below minAmountOut
    await f.evil.configure(0, NATIVE, NATIVE, "0x");
    await expect(k.execute(o, sig, routesAB(f, E(10), f.evilA), 0)).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
    // Unlisted venue
    await expect(k.execute(o, sig, [route(E(10), [hop(HopKind.V2, f.a, f.a, f.b)])], 0)).to.be.revertedWithCustomError(f.router, "VenueNotAllowed");
    // Routes that do not add up to amountIn
    await expect(k.execute(o, sig, routesAB(f, E(5)), 0)).to.be.revertedWithCustomError(f.router, "AmountMismatch");
    // Re-entering execute through a venue
    const inner = f.orders.interface.encodeFunctionData("execute", [o, sig, routesAB(f), 0]);
    await f.evil.configure(4, NATIVE, f.oa, inner);
    await expect(k.execute(o, sig, routesAB(f, E(10), f.evilA), 0)).to.be.reverted;
    expect(await f.B.balanceOf(f.attacker.address)).to.equal(0);
    expect(await f.A.balanceOf(f.maker.address)).to.equal(E(1000));
    // The honest execution still works afterwards.
    await f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0);
  });

  it("cancel and nonce invalidation (maker only, monotonic)", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f, { nonce: 5 });
    const sig = await signOrder(f.maker, f.orders, o);
    await expect(f.orders.connect(f.attacker).cancel(o)).to.be.revertedWithCustomError(f.orders, "NotMaker");
    await expect(f.orders.connect(f.maker).cancel(o)).to.emit(f.orders, "OrderCancelled");
    await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "OrderCancelledOrInvalidated");
    const o2 = await baseOrder(f, { nonce: 6 });
    const sig2 = await signOrder(f.maker, f.orders, o2);
    await expect(f.orders.connect(f.maker).invalidateNonces(7)).to.emit(f.orders, "NoncesInvalidated").withArgs(f.maker.address, 7);
    await expect(f.orders.connect(f.keeper).execute(o2, sig2, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "OrderCancelledOrInvalidated");
    await expect(f.orders.connect(f.maker).invalidateNonces(7)).to.be.revertedWithCustomError(f.orders, "NonceTooLow");
    const o3 = await baseOrder(f, { nonce: 7 });
    await f.orders.connect(f.keeper).execute(o3, await signOrder(f.maker, f.orders, o3), routesAB(f), 0);
  });

  it("respects start time and deadline; maker allowance revocation stops execution", async function () {
    const f = await loadFixture(ordersFixture);
    const now = await time.latest();
    const early = await baseOrder(f, { startTime: now + 100 });
    await expect(f.orders.connect(f.keeper).execute(early, await signOrder(f.maker, f.orders, early), routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "NotStarted");
    const late = await baseOrder(f, { deadline: now + 5 });
    const lsig = await signOrder(f.maker, f.orders, late);
    await time.increase(10);
    await expect(f.orders.connect(f.keeper).execute(late, lsig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "Expired");
    const o = await baseOrder(f);
    await f.A.connect(f.maker).approve(f.oa, 0);
    await expect(f.orders.connect(f.keeper).execute(o, await signOrder(f.maker, f.orders, o), routesAB(f), 0)).to.be.revertedWithCustomError(f.A, "ERC20InsufficientAllowance");
  });

  it("stop-loss: TWAP + spot trigger with a deviation sanity bound", async function () {
    const f = await loadFixture(ordersFixture);
    const oracle = await f.oracle.getAddress();
    const o = await baseOrder(f, { kind: OrderKind.STOP_LOSS, oracle, triggerTick: -100, triggerAbove: false, twapWindow: 600, maxDeviationTicks: 50 });
    const sig = await signOrder(f.maker, f.orders, o);
    const k = f.orders.connect(f.keeper);
    await f.oracle.set(0, 0);
    await expect(k.execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "ConditionNotMet");
    expect(await f.orders.conditionMet(o)).to.equal(false);
    // Spot manipulated down, TWAP still high: deviation bound trips.
    await f.oracle.set(-500, 0);
    await expect(k.execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "OracleDeviation");
    // TWAP below trigger but spot pumped back above: not met.
    await f.oracle.set(-80, -110);
    await expect(k.execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "ConditionNotMet");
    await f.oracle.setBroken(true);
    await expect(k.execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "OracleCallFailed");
    await f.oracle.setBroken(false);
    await f.oracle.set(-120, -110);
    expect(await f.orders.conditionMet(o)).to.equal(true);
    await k.execute(o, sig, routesAB(f), 0);
    expect(await f.B.balanceOf(f.maker.address)).to.equal(E(20));
  });

  it("take-profit in spot-only mode", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f, { kind: OrderKind.TAKE_PROFIT, oracle: await f.oracle.getAddress(), triggerTick: 200, triggerAbove: true });
    const sig = await signOrder(f.maker, f.orders, o);
    await f.oracle.set(199, 0);
    await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "ConditionNotMet");
    await f.oracle.set(200, 0);
    await f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0);
  });

  it("DCA: N executions spaced by the interval, then done", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f, { kind: OrderKind.DCA, executions: 3, interval: 3600, amountIn: E(1), minAmountOut: E(2), maxTip: 0 });
    const sig = await signOrder(f.maker, f.orders, o);
    const k = f.orders.connect(f.keeper);
    await k.execute(o, sig, routesAB(f, E(1)), 0);
    await expect(k.execute(o, sig, routesAB(f, E(1)), 0)).to.be.revertedWithCustomError(f.orders, "TooSoon");
    await time.increase(3600);
    await k.execute(o, sig, routesAB(f, E(1)), 0);
    await time.increase(3600);
    await k.execute(o, sig, routesAB(f, E(1)), 0);
    await time.increase(3600);
    await expect(k.execute(o, sig, routesAB(f, E(1)), 0)).to.be.revertedWithCustomError(f.orders, "FullyExecuted");
    expect(await f.B.balanceOf(f.maker.address)).to.equal(E(6));
    const st = await f.orders.orderState(await f.orders.hashOrder(o));
    expect(st.executed).to.equal(3);
  });

  it("validates order shape", async function () {
    const f = await loadFixture(ordersFixture);
    const bad = [
      { kind: OrderKind.STOP_LOSS },
      { kind: OrderKind.LIMIT, executions: 2 },
      { kind: OrderKind.DCA, executions: 1, interval: 60 },
      { kind: OrderKind.TWAP, executions: 5, interval: 0 },
      { triggerTick: 5 },
      { twapWindow: 60 },
      { minAmountOut: 0 },
      { amountIn: 0 },
      { tokenIn: NATIVE },
      { tokenOut: f.a },
    ];
    for (const b of bad) {
      const o = await baseOrder(f, b);
      const sig = await signOrder(f.maker, f.orders, o);
      await expect(f.orders.connect(f.keeper).execute(o, sig, routesAB(f, o.amountIn || 1n), 0)).to.be.revertedWithCustomError(f.orders, "BadOrder");
    }
  });

  it("native HYPE output to the maker", async function () {
    const f = await loadFixture(ordersFixture);
    const o = await baseOrder(f, { tokenOut: NATIVE, minAmountOut: E(10), maxTip: 0 });
    const sig = await signOrder(f.maker, f.orders, o);
    const n0 = await ethers.provider.getBalance(f.maker.address);
    await f.orders.connect(f.keeper).execute(o, sig, [route(E(10), [hop(HopKind.V2, f.v2a, f.a, f.w), hop(HopKind.UNWRAP, f.w, f.w, NATIVE)])], 0);
    expect((await ethers.provider.getBalance(f.maker.address)) - n0).to.equal(E(10));
  });

  it("ElyAccount as maker via ERC-1271 (owner-signed, replay-safe)", async function () {
    const f = await loadFixture(ordersFixture);
    const factory = await (await ethers.getContractFactory("ElyAccountFactory")).deploy();
    await factory.createAccount(f.other.address, ethers.ZeroHash);
    const accAddr = await factory.accountAddress(f.other.address, ethers.ZeroHash);
    const account = await ethers.getContractAt("ElyAccount", accAddr);
    await f.A.mint(accAddr, E(100));
    await account.connect(f.other).execute(f.a, 0, f.A.interface.encodeFunctionData("approve", [f.oa, MAX]));
    const o = await baseOrder(f, { maker: accAddr, maxTip: 0 });
    const digest = await f.orders.orderDigest(o);
    const sig = await signForAccount(f.other, account, digest);
    // A raw signature by the owner over the digest is not accepted.
    const raw = await f.other.signTypedData(
      { name: "ElyOrders", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: f.oa },
      require("./helpers.cjs").ORDER_TYPES,
      o,
    );
    await expect(f.orders.connect(f.keeper).execute(o, raw, routesAB(f), 0)).to.be.revertedWithCustomError(f.orders, "BadSignature");
    await f.orders.connect(f.keeper).execute(o, sig, routesAB(f), 0);
    expect(await f.B.balanceOf(accAddr)).to.equal(E(20));
    // Cancel from the account through its owner.
    const o2 = await baseOrder(f, { maker: accAddr, maxTip: 0, nonce: 9 });
    await account.connect(f.other).execute(f.oa, 0, f.orders.interface.encodeFunctionData("cancel", [o2]));
    const st = await f.orders.orderState(await f.orders.hashOrder(o2));
    expect(st.cancelled).to.equal(true);
  });

  it("re-entrant tokenIn cannot double-execute", async function () {
    const f = await loadFixture(ordersFixture);
    const R = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const r = await R.getAddress();
    await R.mint(f.maker.address, E(100));
    await R.connect(f.maker).approve(f.oa, MAX);
    await f.v2.setRate(r, f.b, 2, 1);
    const o = await baseOrder(f, { tokenIn: r, maxTip: 0 });
    const sig = await signOrder(f.maker, f.orders, o);
    const routes = [route(E(10), [hop(HopKind.V2, f.v2a, r, f.b)])];
    await R.arm(f.oa, f.orders.interface.encodeFunctionData("execute", [o, sig, routes, 0]));
    await expect(f.orders.connect(f.keeper).execute(o, sig, routes, 0)).to.be.revertedWithCustomError(f.orders, "ReentrancyGuardReentrantCall");
  });
});
