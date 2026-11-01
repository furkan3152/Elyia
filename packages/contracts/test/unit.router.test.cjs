// ElyiaRouter unit tests (mock venues): routing, native in/out, fees, safety, adversarial venues.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { NATIVE, MAX, VenueKind, HopKind, hop, route, swapParams, deadlineIn, act, balanceOf } = require("./helpers.cjs");

const E = (n) => ethers.parseEther(String(n));

async function deployRouterFixture() {
  const [owner, user, other, feeTo, integrator, attacker] = await ethers.getSigners();
  const T = await ethers.getContractFactory("MockERC20");
  const A = await T.deploy("Token A", "A", 18);
  const B = await T.deploy("Token B", "B", 18);
  const C = await T.deploy("Token C", "C", 6);
  const weth = await (await ethers.getContractFactory("MockWETH")).deploy();
  const v2 = await (await ethers.getContractFactory("MockV2Router")).deploy();
  const v3 = await (await ethers.getContractFactory("MockV3RouterV1")).deploy();
  const v302 = await (await ethers.getContractFactory("MockV3Router02")).deploy();
  const vault = await (await ethers.getContractFactory("MockVault")).deploy(await B.getAddress());
  const thief = await (await ethers.getContractFactory("ThiefVault")).deploy(await B.getAddress());
  const evil = await (await ethers.getContractFactory("EvilV2Router")).deploy();
  const permit2Stub = await T.deploy("stub", "STUB", 18); // any contract; unit tests do not use Permit2

  const [a, b, c, w] = await Promise.all([A, B, C, weth].map((x) => x.getAddress()));
  // Rates: A->B 2x, B->C 1:1 (decimals ignored by mocks), A->C 3x, weth->B 10x, B->weth 1/10, A->weth 1/5
  for (const r of [v2, v3, v302]) {
    await r.setRate(a, b, 2, 1);
    await r.setRate(b, c, 1, 1);
    await r.setRate(a, c, 3, 1);
    await r.setRate(w, b, 10, 1);
    await r.setRate(b, w, 1, 10);
    await r.setRate(a, w, 1, 5);
    const addr = await r.getAddress();
    await A.mint(addr, E(1e9));
    await B.mint(addr, E(1e9));
    await C.mint(addr, E(1e9));
    await weth.connect(owner).deposit({ value: E(1000) });
    await weth.connect(owner).transfer(addr, E(1000));
  }
  await B.mint(await evil.getAddress(), E(1e9));

  const Router = await ethers.getContractFactory("ElyiaRouter");
  const router = await Router.deploy(
    owner.address,
    await permit2Stub.getAddress(),
    [w, await v2.getAddress(), await v3.getAddress(), await v302.getAddress(), await vault.getAddress()],
    [VenueKind.WRAPPER, VenueKind.V2_ROUTER, VenueKind.V3_ROUTER_V1, VenueKind.V3_ROUTER_02, VenueKind.VAULT],
  );
  const ra = await router.getAddress();
  await A.mint(user.address, E(1e6));
  await B.mint(user.address, E(1e6));
  await A.connect(user).approve(ra, MAX);
  await B.connect(user).approve(ra, MAX);
  return { owner, user, other, feeTo, integrator, attacker, A, B, C, weth, v2, v3, v302, vault, thief, evil, router, a, b, c, w, ra };
}

describe("ElyiaRouter (unit)", function () {
  describe("deployment and admin", function () {
    it("registers initial venues and owner", async function () {
      const f = await loadFixture(deployRouterFixture);
      expect(await f.router.owner()).to.equal(f.owner.address);
      expect(await f.router.venueKind(f.w)).to.equal(VenueKind.WRAPPER);
      expect(await f.router.venueKind(await f.v2.getAddress())).to.equal(VenueKind.V2_ROUTER);
      expect(await f.router.protocolFeeBps()).to.equal(0);
    });

    it("rejects zero Permit2, EOA venues and length mismatch", async function () {
      const f = await loadFixture(deployRouterFixture);
      const Router = await ethers.getContractFactory("ElyiaRouter");
      await expect(Router.deploy(f.owner.address, NATIVE, [], [])).to.be.revertedWithCustomError(f.router, "ZeroAddress");
      await expect(Router.deploy(f.owner.address, f.a, [f.other.address], [VenueKind.V2_ROUTER])).to.be.revertedWithCustomError(
        f.router,
        "VenueNotAllowed",
      );
      await expect(Router.deploy(f.owner.address, f.a, [f.a], [])).to.be.revertedWithCustomError(f.router, "AmountMismatch");
    });

    it("only the owner can configure; fee caps are hard", async function () {
      const f = await loadFixture(deployRouterFixture);
      const r = f.router;
      await expect(r.connect(f.other).setVenue(f.a, VenueKind.V2_ROUTER)).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
      await expect(r.connect(f.other).setProtocolFee(1, f.feeTo.address)).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
      await expect(r.connect(f.other).setIntegrator(f.integrator.address, 1)).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
      await expect(r.connect(f.other).pause()).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
      await expect(r.connect(f.other).rescue(f.a, f.other.address, 1)).to.be.revertedWithCustomError(r, "OwnableUnauthorizedAccount");
      await expect(r.setProtocolFee(31, f.feeTo.address)).to.be.revertedWithCustomError(r, "FeeTooHigh");
      await expect(r.setProtocolFee(10, NATIVE)).to.be.revertedWithCustomError(r, "ZeroAddress");
      await expect(r.setProtocolFee(30, f.feeTo.address)).to.emit(r, "ProtocolFeeSet").withArgs(30, f.feeTo.address);
      await expect(r.setIntegrator(f.integrator.address, 51)).to.be.revertedWithCustomError(r, "FeeTooHigh");
      await expect(r.setIntegrator(NATIVE, 10)).to.be.revertedWithCustomError(r, "ZeroAddress");
      await expect(r.setIntegrator(f.integrator.address, 50)).to.emit(r, "IntegratorSet");
      await expect(r.setVenue(f.other.address, VenueKind.V2_ROUTER)).to.be.revertedWithCustomError(r, "VenueNotAllowed");
      await expect(r.setVenue(f.ra, VenueKind.V2_ROUTER)).to.be.revertedWithCustomError(r, "ZeroAddress");
      await expect(r.setVenue(await f.v2.getAddress(), VenueKind.NONE)).to.emit(r, "VenueSet");
    });

    it("renounce is disabled; ownership moves only in two steps", async function () {
      const f = await loadFixture(deployRouterFixture);
      await expect(f.router.renounceOwnership()).to.be.revertedWithCustomError(f.router, "RenounceDisabled");
      await f.router.transferOwnership(f.other.address);
      expect(await f.router.owner()).to.equal(f.owner.address);
      await expect(f.router.connect(f.attacker).acceptOwnership()).to.be.revertedWithCustomError(f.router, "OwnableUnauthorizedAccount");
      await f.router.connect(f.other).acceptOwnership();
      expect(await f.router.owner()).to.equal(f.other.address);
    });
  });

  describe("swaps", function () {
    it("single hop on each venue kind", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const venues = [
        [HopKind.V2, await f.v2.getAddress(), 0],
        [HopKind.V3_V1, await f.v3.getAddress(), 3000],
        [HopKind.V3_02, await f.v302.getAddress(), 500],
      ];
      for (const [kind, venue, fee] of venues) {
        const p = swapParams({
          tokenIn: f.a,
          tokenOut: f.b,
          amountIn: E(10),
          minAmountOut: E(20),
          recipient: f.other.address,
          deadline: dl,
          routes: [route(E(10), [hop(kind, venue, f.a, f.b, fee)])],
        });
        const before = await f.B.balanceOf(f.other.address);
        await expect(f.router.connect(f.user).swap(p))
          .to.emit(f.router, "Swap")
          .withArgs(f.user.address, f.other.address, f.a, f.b, E(10), E(20), 0, NATIVE, 0);
        expect((await f.B.balanceOf(f.other.address)) - before).to.equal(E(20));
      }
      expect(await f.A.balanceOf(f.ra)).to.equal(0);
      expect(await f.B.balanceOf(f.ra)).to.equal(0);
      // No allowance left on any venue.
      for (const [, venue] of venues) expect(await f.A.allowance(f.ra, venue)).to.equal(0);
    });

    it("splits across venues and enforces the total", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const routes = [
        route(E(5), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)]),
        route(E(3), [hop(HopKind.V3_V1, await f.v3.getAddress(), f.a, f.b, 3000)]),
        route(E(2), [hop(HopKind.V3_02, await f.v302.getAddress(), f.a, f.b, 3000)]),
      ];
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(10), minAmountOut: E(20), recipient: f.user.address, deadline: dl, routes });
      const before = await f.B.balanceOf(f.user.address);
      await f.router.connect(f.user).swap(p);
      expect((await f.B.balanceOf(f.user.address)) - before).to.equal(E(20));
      const bad = { ...p, amountIn: E(11) };
      await expect(f.router.connect(f.user).swap(bad)).to.be.revertedWithCustomError(f.router, "AmountMismatch");
    });

    it("multi-hop A -> B -> C", async function () {
      const f = await loadFixture(deployRouterFixture);
      const p = swapParams({
        tokenIn: f.a,
        tokenOut: f.c,
        amountIn: E(4),
        minAmountOut: E(8),
        recipient: f.user.address,
        deadline: await deadlineIn(),
        routes: [route(E(4), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b), hop(HopKind.V3_V1, await f.v3.getAddress(), f.b, f.c, 100)])],
      });
      await f.router.connect(f.user).swap(p);
      expect(await f.C.balanceOf(f.user.address)).to.equal(E(8));
    });

    it("native HYPE in (wrap hop) and native HYPE out (unwrap hop)", async function () {
      const f = await loadFixture(deployRouterFixture);
      const v2 = await f.v2.getAddress();
      const pin = swapParams({
        tokenIn: NATIVE,
        tokenOut: f.b,
        amountIn: E(1),
        minAmountOut: E(10),
        recipient: f.user.address,
        deadline: await deadlineIn(),
        routes: [route(E(1), [hop(HopKind.WRAP, f.w, NATIVE, f.w), hop(HopKind.V2, v2, f.w, f.b)])],
      });
      await expect(f.router.connect(f.user).swap(pin, { value: E(2) })).to.be.revertedWithCustomError(f.router, "UnexpectedValue");
      const b0 = await f.B.balanceOf(f.user.address);
      await f.router.connect(f.user).swap(pin, { value: E(1) });
      expect((await f.B.balanceOf(f.user.address)) - b0).to.equal(E(10));

      const pout = swapParams({
        tokenIn: f.b,
        tokenOut: NATIVE,
        amountIn: E(10),
        minAmountOut: E(1),
        recipient: f.other.address,
        deadline: await deadlineIn(),
        routes: [route(E(10), [hop(HopKind.V2, v2, f.b, f.w), hop(HopKind.UNWRAP, f.w, f.w, NATIVE)])],
      });
      const n0 = await ethers.provider.getBalance(f.other.address);
      await f.router.connect(f.user).swap(pout);
      expect((await ethers.provider.getBalance(f.other.address)) - n0).to.equal(E(1));
      expect(await ethers.provider.getBalance(f.ra)).to.equal(0);
      // ERC-20 input with msg.value is rejected.
      await expect(f.router.connect(f.user).swap(pout, { value: 1 })).to.be.revertedWithCustomError(f.router, "UnexpectedValue");
    });

    it("reverts when minAmountOut is not met or the deadline passed", async function () {
      const f = await loadFixture(deployRouterFixture);
      const base = {
        tokenIn: f.a,
        tokenOut: f.b,
        amountIn: E(1),
        recipient: f.user.address,
        routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])],
      };
      await expect(
        f.router.connect(f.user).swap(swapParams({ ...base, minAmountOut: E(2) + 1n, deadline: await deadlineIn() })),
      ).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
      const dl = await deadlineIn(10);
      await time.increase(11);
      await expect(f.router.connect(f.user).swap(swapParams({ ...base, deadline: dl }))).to.be.revertedWithCustomError(f.router, "DeadlineExpired");
    });

    it("rejects malformed routes", async function () {
      const f = await loadFixture(deployRouterFixture);
      const v2 = await f.v2.getAddress();
      const v3 = await f.v3.getAddress();
      const dl = await deadlineIn();
      const mk = (o) => swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(1), recipient: f.user.address, deadline: dl, ...o });
      const r = f.router.connect(f.user);
      await expect(r.swap(mk({ routes: [] }))).to.be.revertedWithCustomError(f.router, "BadRouteCount");
      await expect(r.swap(mk({ amountIn: E(9), routes: Array.from({ length: 9 }, () => route(E(1), [hop(HopKind.V2, v2, f.a, f.b)])) }))).to.be.revertedWithCustomError(f.router, "BadRouteCount");
      await expect(r.swap(mk({ routes: [route(E(1), [])] }))).to.be.revertedWithCustomError(f.router, "BadHopCount");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V2, v2, f.b, f.c)])] }))).to.be.revertedWithCustomError(f.router, "BrokenPath");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V2, v2, f.a, f.c)])] }))).to.be.revertedWithCustomError(f.router, "BrokenPath");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V2, v3, f.a, f.b)])] }))).to.be.revertedWithCustomError(f.router, "VenueNotAllowed");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V2, f.a, f.a, f.b)])] }))).to.be.revertedWithCustomError(f.router, "VenueNotAllowed");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V3_V1, v3, f.a, f.b, 0)])] }))).to.be.revertedWithCustomError(f.router, "BadHop");
      await expect(r.swap(mk({ routes: [route(E(1), [hop(HopKind.V2, v2, f.a, f.b, 3000)])] }))).to.be.revertedWithCustomError(f.router, "BadHop");
      await expect(r.swap(mk({ tokenOut: f.a, routes: [route(E(1), [hop(HopKind.V2, v2, f.a, f.a)])] }))).to.be.revertedWithCustomError(f.router, "SameToken");
      await expect(r.swap(mk({ recipient: NATIVE, routes: [route(E(1), [hop(HopKind.V2, v2, f.a, f.b)])] }))).to.be.revertedWithCustomError(f.router, "ZeroAddress");
      await expect(r.swap(mk({ amountIn: 0, routes: [route(0, [hop(HopKind.V2, v2, f.a, f.b)])] }))).to.be.revertedWithCustomError(f.router, "ZeroAmount");
      await expect(r.swap(mk({ amountIn: MAX, routes: [route(MAX, [hop(HopKind.V2, v2, f.a, f.b)])] }))).to.be.revertedWithCustomError(f.router, "ZeroAmount");
      // Wrap hop must output the wrapper itself.
      const wrapBad = swapParams({ tokenIn: NATIVE, tokenOut: f.b, amountIn: 1n, recipient: f.user.address, deadline: dl, routes: [route(1n, [hop(HopKind.WRAP, f.w, NATIVE, f.b)])] });
      await expect(r.swap(wrapBad, { value: 1 })).to.be.revertedWithCustomError(f.router, "BadHop");
      // Native on a V2 hop is rejected.
      const nativeV2 = swapParams({ tokenIn: NATIVE, tokenOut: f.b, amountIn: 1n, recipient: f.user.address, deadline: dl, routes: [route(1n, [hop(HopKind.V2, v2, NATIVE, f.b)])] });
      await expect(r.swap(nativeV2, { value: 1 })).to.be.revertedWithCustomError(f.router, "BadHop");
    });
  });

  describe("fees", function () {
    it("takes protocol and integrator fees from the output, net checked against minOut", async function () {
      const f = await loadFixture(deployRouterFixture);
      await f.router.setProtocolFee(30, f.feeTo.address);
      await f.router.setIntegrator(f.integrator.address, 50);
      const p = swapParams({
        tokenIn: f.a,
        tokenOut: f.b,
        amountIn: E(100),
        minAmountOut: E(200) - E(200) * 80n / 10000n,
        recipient: f.user.address,
        deadline: await deadlineIn(),
        integrator: f.integrator.address,
        integratorFeeBps: 50,
        routes: [route(E(100), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])],
      });
      const u0 = await f.B.balanceOf(f.user.address);
      await expect(f.router.connect(f.user).swap(p))
        .to.emit(f.router, "Swap")
        .withArgs(f.user.address, f.user.address, f.a, f.b, E(100), E(198.4), E(0.6), f.integrator.address, E(1));
      expect(await f.B.balanceOf(f.feeTo.address)).to.equal(E(0.6));
      expect(await f.B.balanceOf(f.integrator.address)).to.equal(E(1));
      expect((await f.B.balanceOf(f.user.address)) - u0).to.equal(E(198.4));
      // minOut is net of fees
      await expect(f.router.connect(f.user).swap({ ...p, minAmountOut: E(198.4) + 1n })).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
    });

    it("rejects unregistered integrators and fees above the integrator cap", async function () {
      const f = await loadFixture(deployRouterFixture);
      await f.router.setIntegrator(f.integrator.address, 20);
      const base = {
        tokenIn: f.a,
        tokenOut: f.b,
        amountIn: E(1),
        recipient: f.user.address,
        deadline: await deadlineIn(),
        routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])],
      };
      const r = f.router.connect(f.user);
      await expect(r.swap(swapParams({ ...base, integrator: f.other.address, integratorFeeBps: 1 }))).to.be.revertedWithCustomError(f.router, "IntegratorNotAllowed");
      await expect(r.swap(swapParams({ ...base, integrator: f.integrator.address, integratorFeeBps: 21 }))).to.be.revertedWithCustomError(f.router, "IntegratorNotAllowed");
      await expect(r.swap(swapParams({ ...base, integrator: NATIVE, integratorFeeBps: 1 }))).to.be.revertedWithCustomError(f.router, "IntegratorNotAllowed");
      await r.swap(swapParams({ ...base, integrator: f.integrator.address, integratorFeeBps: 20 }));
      await f.router.setIntegrator(f.integrator.address, 0);
      await expect(r.swap(swapParams({ ...base, integrator: f.integrator.address, integratorFeeBps: 20 }))).to.be.revertedWithCustomError(f.router, "IntegratorNotAllowed");
    });
  });

  describe("kill switch, dust and rescue", function () {
    it("pause blocks swaps and multicall; rescue still works", async function () {
      const f = await loadFixture(deployRouterFixture);
      await f.router.pause();
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [route(1n, [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      await expect(f.router.connect(f.user).swap(p)).to.be.revertedWithCustomError(f.router, "EnforcedPause");
      await expect(f.router.connect(f.user).multicall(await deadlineIn(), [])).to.be.revertedWithCustomError(f.router, "EnforcedPause");
      await f.A.mint(f.ra, 5n);
      await expect(f.router.rescue(f.a, f.owner.address, 5n)).to.emit(f.router, "Rescued").withArgs(f.a, f.owner.address, 5n);
      await f.router.unpause();
      await f.router.connect(f.user).swap(p);
    });

    it("pre-existing dust is never usable by a caller and is not swept to them", async function () {
      const f = await loadFixture(deployRouterFixture);
      await f.A.mint(f.ra, E(7));
      const dl = await deadlineIn();
      // Sweep returns zero (dust is not "available" to this call).
      await f.router.connect(f.attacker).multicall(dl, [act.sweep(f.a, f.attacker.address)]);
      expect(await f.A.balanceOf(f.attacker.address)).to.equal(0);
      // CONTRACT_BALANCE swap over dust only -> zero amount.
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: MAX, recipient: f.attacker.address, deadline: dl, routes: [route(MAX, [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      await expect(f.router.connect(f.attacker).multicall(dl, [act.swap(p)])).to.be.revertedWithCustomError(f.router, "ZeroAmount");
      // Explicit amount over dust only -> insufficient balance.
      await expect(f.router.connect(f.attacker).multicall(dl, [act.swap({ ...p, amountIn: E(1), routes: [route(E(1), p.routes[0].hops)] })])).to.be.revertedWithCustomError(f.router, "InsufficientBalance");
      expect(await f.A.balanceOf(f.ra)).to.equal(E(7));
    });

    it("refuses stray native HYPE", async function () {
      const f = await loadFixture(deployRouterFixture);
      await expect(f.user.sendTransaction({ to: f.ra, value: 1 })).to.be.revertedWithCustomError(f.router, "UnexpectedNative");
    });
  });

  describe("multicall", function () {
    it("pull -> swap -> ERC-4626 deposit (all balance) leaves nothing behind", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(10), recipient: f.ra, deadline: dl, routes: [route(E(10), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(10)), act.swap(p), act.deposit(await f.vault.getAddress(), MAX, f.user.address, E(20))]))
        .to.emit(f.router, "VaultDeposited")
        .withArgs(f.user.address, await f.vault.getAddress(), f.user.address, E(20), E(20));
      expect(await f.vault.balanceOf(f.user.address)).to.equal(E(20));
      expect(await f.B.balanceOf(f.ra)).to.equal(0);
      expect(await f.B.allowance(f.ra, await f.vault.getAddress())).to.equal(0);
    });

    it("native -> wrap -> swap (CONTRACT_BALANCE) -> deposit", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: f.w, tokenOut: f.b, amountIn: MAX, recipient: f.ra, deadline: dl, routes: [route(MAX, [hop(HopKind.V3_V1, await f.v3.getAddress(), f.w, f.b, 3000)])] });
      await f.router.connect(f.user).multicall(dl, [act.wrap(f.w, MAX), act.swap(p), act.deposit(await f.vault.getAddress(), MAX, f.other.address)], { value: E(2) });
      expect(await f.vault.balanceOf(f.other.address)).to.equal(E(20));
    });

    it("pull shares -> redeem; wrap -> unwrap -> sweep native", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const vault = await f.vault.getAddress();
      await f.B.connect(f.user).approve(vault, E(5));
      await f.vault.connect(f.user).deposit(E(5), f.user.address);
      await f.vault.connect(f.user).approve(f.ra, E(5));
      const b0 = await f.B.balanceOf(f.other.address);
      await f.router.connect(f.user).multicall(dl, [act.pull(vault, E(5)), act.redeem(vault, MAX, f.other.address, E(5))]);
      expect((await f.B.balanceOf(f.other.address)) - b0).to.equal(E(5));
      const n0 = await ethers.provider.getBalance(f.other.address);
      await f.router.connect(f.user).multicall(dl, [act.wrap(f.w, E(1)), act.unwrap(f.w, MAX), act.sweep(NATIVE, f.other.address, E(1))], { value: E(1) });
      expect((await ethers.provider.getBalance(f.other.address)) - n0).to.equal(E(1));
    });

    it("reverts if funds would stay in the router (sweep check)", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1))])).to.be.revertedWithCustomError(f.router, "FundsLeftInRouter").withArgs(f.a);
      await expect(f.router.connect(f.user).multicall(dl, [], { value: 1 })).to.be.revertedWithCustomError(f.router, "FundsLeftInRouter").withArgs(NATIVE);
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(1), recipient: f.ra, deadline: dl, routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1)), act.swap(p)])).to.be.revertedWithCustomError(f.router, "FundsLeftInRouter").withArgs(f.b);
      // Standalone swap to the router itself also fails the check.
      await expect(f.router.connect(f.user).swap(p)).to.be.revertedWithCustomError(f.router, "FundsLeftInRouter");
      await expect(f.router.connect(f.user).multicall(dl, [act.wrap(f.w, E(1)), act.sweep(f.w, f.user.address, E(2))], { value: E(1) })).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
    });

    it("rejects unlisted / thieving vaults and enforces minShares and the deadline", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(1), recipient: f.ra, deadline: dl, routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      const thief = await f.thief.getAddress();
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1)), act.swap(p), act.deposit(thief, MAX, f.user.address)])).to.be.revertedWithCustomError(f.router, "VenueNotAllowed");
      await f.router.setVenue(thief, VenueKind.VAULT); // even if the owner lists a bad vault
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1)), act.swap(p), act.deposit(thief, MAX, f.user.address)])).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1)), act.swap(p), act.deposit(await f.vault.getAddress(), MAX, f.user.address, E(2) + 1n)])).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
      const past = (await deadlineIn(0)) - 1n;
      await expect(f.router.connect(f.user).multicall(past, [])).to.be.revertedWithCustomError(f.router, "DeadlineExpired");
    });

    it("SWAP with CONTRACT_BALANCE requires exactly one route", async function () {
      const f = await loadFixture(deployRouterFixture);
      const dl = await deadlineIn();
      const v2 = await f.v2.getAddress();
      const h = [hop(HopKind.V2, v2, f.a, f.b)];
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: MAX, recipient: f.user.address, deadline: dl, routes: [route(MAX, h), route(MAX, h)] });
      await expect(f.router.connect(f.user).multicall(dl, [act.pull(f.a, E(1)), act.swap(p)])).to.be.revertedWithCustomError(f.router, "BadRouteCount");
    });
  });

  describe("adversarial venues and reentrancy", function () {
    async function evilFixture() {
      const f = await loadFixture(deployRouterFixture);
      const evil = await f.evil.getAddress();
      await f.router.setVenue(evil, VenueKind.V2_ROUTER);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(10), recipient: f.user.address, deadline: dl, routes: [route(E(10), [hop(HopKind.V2, evil, f.a, f.b)])] });
      return { ...f, evilAddr: evil, p, dl };
    }

    it("venue pulling less than approved: leftover detected, allowance reset", async function () {
      const f = await evilFixture();
      await f.evil.configure(1, NATIVE, NATIVE, "0x");
      await expect(f.router.connect(f.user).swap(f.p)).to.be.revertedWithCustomError(f.router, "FundsLeftInRouter").withArgs(f.a);
    });

    it("venue paying nothing or paying elsewhere: NoOutput", async function () {
      const f = await evilFixture();
      await f.evil.configure(2, NATIVE, NATIVE, "0x");
      await expect(f.router.connect(f.user).swap(f.p)).to.be.revertedWithCustomError(f.router, "NoOutput");
      await f.evil.configure(3, f.attacker.address, NATIVE, "0x");
      await expect(f.router.connect(f.user).swap(f.p)).to.be.revertedWithCustomError(f.router, "NoOutput");
    });

    it("venue trying to pull more than the exact allowance fails", async function () {
      const f = await evilFixture();
      await f.evil.configure(5, NATIVE, NATIVE, "0x");
      await expect(f.router.connect(f.user).swap(f.p)).to.be.reverted;
    });

    it("venue re-entering the router is blocked", async function () {
      const f = await evilFixture();
      const inner = f.router.interface.encodeFunctionData("multicall", [f.dl, [act.sweep(f.a, f.attacker.address)]]);
      await f.evil.configure(4, NATIVE, f.ra, inner);
      await expect(f.router.connect(f.user).swap(f.p)).to.be.revertedWithCustomError(f.router, "ReentrancyGuardReentrantCall");
      const inner2 = f.router.interface.encodeFunctionData("rescue", [f.a, f.attacker.address, 1n]);
      await f.evil.configure(4, NATIVE, f.ra, inner2);
      await expect(f.router.connect(f.user).swap(f.p)).to.be.reverted;
    });

    it("malicious token re-entering during pull is blocked", async function () {
      const f = await loadFixture(deployRouterFixture);
      const R = await (await ethers.getContractFactory("ReentrantToken")).deploy();
      const r = await R.getAddress();
      await R.mint(f.user.address, E(10));
      await R.connect(f.user).approve(f.ra, MAX);
      await f.v2.setRate(r, f.b, 1, 1);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: r, tokenOut: f.b, amountIn: E(1), recipient: f.user.address, deadline: dl, routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), r, f.b)])] });
      await R.arm(f.ra, f.router.interface.encodeFunctionData("multicall", [dl, []]));
      await expect(f.router.connect(f.user).swap(p)).to.be.revertedWithCustomError(f.router, "ReentrancyGuardReentrantCall");
    });

    it("never pulls from anyone but msg.sender", async function () {
      const f = await loadFixture(deployRouterFixture);
      // user has an unlimited allowance to the router; attacker cannot use it.
      const dl = await deadlineIn();
      await expect(f.router.connect(f.attacker).multicall(dl, [act.pull(f.a, E(1)), act.sweep(f.a, f.attacker.address)])).to.be.revertedWithCustomError(f.A, "ERC20InsufficientAllowance");
      const p = swapParams({ tokenIn: f.a, tokenOut: f.b, amountIn: E(1), recipient: f.attacker.address, deadline: dl, routes: [route(E(1), [hop(HopKind.V2, await f.v2.getAddress(), f.a, f.b)])] });
      await expect(f.router.connect(f.attacker).swap(p)).to.be.revertedWithCustomError(f.A, "ERC20InsufficientAllowance");
    });

    it("recipient rejecting native output reverts the whole swap", async function () {
      const f = await loadFixture(deployRouterFixture);
      const rej = await (await ethers.getContractFactory("RejectNative")).deploy();
      const p = swapParams({ tokenIn: f.b, tokenOut: NATIVE, amountIn: E(10), recipient: await rej.getAddress(), deadline: await deadlineIn(), routes: [route(E(10), [hop(HopKind.V2, await f.v2.getAddress(), f.b, f.w), hop(HopKind.UNWRAP, f.w, f.w, NATIVE)])] });
      await expect(f.router.connect(f.user).swap(p)).to.be.revertedWithCustomError(f.router, "NativeTransferFailed");
    });

    it("too many distinct tokens in one call is rejected", async function () {
      const f = await loadFixture(deployRouterFixture);
      const T = await ethers.getContractFactory("MockERC20");
      const dl = await deadlineIn();
      const actions = [];
      for (let i = 0; i < 16; i++) {
        const t = await T.deploy("t", "t", 18);
        await t.mint(f.user.address, 1n);
        await t.connect(f.user).approve(f.ra, 1n);
        actions.push(act.pull(await t.getAddress(), 1n));
      }
      await expect(f.router.connect(f.user).multicall(dl, actions)).to.be.revertedWithCustomError(f.router, "TooManyTokens");
    });
  });
});

module.exports = { deployRouterFixture };
