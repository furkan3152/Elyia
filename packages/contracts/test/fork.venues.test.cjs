// Fork tests against the real Elysium testnet venues (run with ELYIA_FORK=1).
// Nothing is broadcast: the fork is an in-process copy of chain 99801 at a pinned block.
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { NATIVE, MAX, VenueKind, HopKind, OrderKind, hop, route, swapParams, deadlineIn, act, balanceOf, signOrder } = require("./helpers.cjs");

const M = require("../deploy/elysium-testnet.venues.json");
const T = Object.fromEntries(Object.entries(M.tokens).map(([k, v]) => [k, v.address]));
const V = Object.fromEntries(M.venues.map((v) => [v.key, v.address]));
const P = Object.fromEntries(Object.entries(M.pools).map(([k, v]) => [k, v.address]));
const E = (n) => ethers.parseEther(String(n));

const GAS = [];
async function gas(label, txPromise) {
  const tx = await txPromise;
  const r = await tx.wait();
  GAS.push({ label, gasUsed: Number(r.gasUsed) });
  return r;
}

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)",
];
const V2_ABI = ["function getAmountsOut(uint256,address[]) view returns (uint256[])", "function factory() view returns (address)", "function WETH() view returns (address)"];
const V3R_ABI = ["function WETH9() view returns (address)", "function factory() view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function increaseObservationCardinalityNext(uint16)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];
const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
};

async function forkFixture() {
  const [owner, user, keeper, attacker, feeTo, integrator] = await ethers.getSigners();
  const Router = await ethers.getContractFactory("ElyiaRouter");
  const router = await Router.deploy(
    owner.address,
    M.permit2.address,
    M.venues.map((v) => v.address),
    M.venues.map((v) => VenueKind[v.kind]),
  );
  const factory = await (await ethers.getContractFactory("ElyAccountFactory")).deploy();
  const orders = await (await ethers.getContractFactory("ElyOrders")).deploy(await router.getAddress());
  const quoter = new ethers.Contract(M.quoters.kalosQuoterV2.address, QUOTER_ABI, owner);
  return { owner, user, keeper, attacker, feeTo, integrator, router, factory, orders, quoter, ra: await router.getAddress() };
}

async function quoteKalos(f, tokenIn, tokenOut, fee, amountIn) {
  const r = await f.quoter.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 });
  return r[0];
}

const nativeTo = {
  kalosUSDC: (amt) => route(amt, [hop(HopKind.WRAP, V.whype, NATIVE, T.WHYPE), hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.USDC, 20000)]),
  ddcUSDC: (amt) => route(amt, [hop(HopKind.WRAP, V.ddcWeth, NATIVE, T.DDC_WETH), hop(HopKind.V2, V.dexDaCostaRouter, T.DDC_WETH, T.USDC)]),
  kalosKALOS: (amt) => route(amt, [hop(HopKind.WRAP, V.whype, NATIVE, T.WHYPE), hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.KALOS, 3000)]),
};

describe("Fork: Elysium testnet venues", function () {
  before(async function () {
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 99801n) this.skip();
    // EDR cannot execute calls *at* the forked block of an unknown chain; mine one local block.
    await mine();
  });

  after(function () {
    if (!GAS.length) return;
    const dir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fork-gas.json"), JSON.stringify({ forkBlock: Number(process.env.ELYIA_FORK_BLOCK || 20530000), results: GAS }, null, 2) + "\n");
    console.log("\n    Fork gas (gasUsed):");
    for (const g of GAS) console.log(`      ${g.label.padEnd(64)} ${String(g.gasUsed).padStart(9)}`);
  });

  describe("venue pins", function () {
    it("every pinned address has code and appears in packages/core", async function () {
      const core = ["protocolData.ts", "networks.ts"].map((n) => fs.readFileSync(path.join(__dirname, "..", "..", "core", "src", n), "utf8")).join("\n").toLowerCase();
      const all = [M.permit2.address, ...Object.values(T), ...Object.values(V), ...Object.values(P), M.quoters.kalosQuoterV2.address];
      for (const a of all) {
        expect(core.includes(a.toLowerCase()), `${a} not in core`).to.equal(true);
        expect((await ethers.provider.getCode(a)).length, `${a} has no code`).to.be.greaterThan(2);
      }
    });

    it("router getters match the pinned wrappers and factories", async function () {
      const [s] = await ethers.getSigners();
      const kalos = new ethers.Contract(V.kalosSwapRouter, V3R_ABI, s);
      expect(await kalos.WETH9()).to.equal(T.WHYPE);
      expect(await kalos.factory()).to.equal("0x520bF060F58ceE054f725877279328F5f73A7893");
      const pm = new ethers.Contract(V.perpmeSwapRouterV1, V3R_ABI, s);
      expect(await pm.WETH9()).to.equal(T.PERPME_WETH9);
      const ddc = new ethers.Contract(V.dexDaCostaRouter, V2_ABI, s);
      expect(await ddc.WETH()).to.equal(T.DDC_WETH);
      const hex = new ethers.Contract(V.hexSwapRouter, V2_ABI, s);
      expect(await hex.factory()).to.equal("0xf5269ec7452b71aA79e5eA9D2dEFbCeEF76d2c92");
      const st = await ethers.getContractAt("IERC4626", V.stKALOS);
      expect(await st.asset()).to.equal(T.KALOS);
      expect(await (await ethers.getContractAt("IERC4626", V.cheshireWHYPEVault)).asset()).to.equal(T.DDC_WETH);
      expect(await (await ethers.getContractAt("IERC4626", V.cheshireUSDCVault)).asset()).to.equal(T.USDC);
    });
  });

  describe("ElyiaRouter on real venues", function () {
    it("Kalos V3: native HYPE -> USDC matches the QuoterV2 exactly", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const q = await quoteKalos(f, T.WHYPE, T.USDC, 20000, amt);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, minAmountOut: q, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] });
      const b0 = await balanceOf(T.USDC, f.user);
      await gas("swap native->USDC Kalos V3 (wrap+1 hop)", f.router.connect(f.user).swap(p, { value: amt }));
      expect((await balanceOf(T.USDC, f.user)) - b0).to.equal(q);
      expect(await balanceOf(T.USDC, f.ra)).to.equal(0);
      expect(await balanceOf(T.WHYPE, f.ra)).to.equal(0);
    });

    it("minOut = quote + 1 reverts; expired deadline reverts", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const q = await quoteKalos(f, T.WHYPE, T.USDC, 20000, amt);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, minAmountOut: q + 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] });
      await expect(f.router.connect(f.user).swap(p, { value: amt })).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
      const dl = await deadlineIn(5);
      await time.increase(6);
      await expect(f.router.connect(f.user).swap({ ...p, minAmountOut: 0, deadline: dl }, { value: amt })).to.be.revertedWithCustomError(f.router, "DeadlineExpired");
    });

    it("Dex Da Costa V2 (own WETH): native HYPE -> USDC matches getAmountsOut", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const ddc = new ethers.Contract(V.dexDaCostaRouter, V2_ABI, f.user);
      const q = (await ddc.getAmountsOut(amt, [T.DDC_WETH, T.USDC]))[1];
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, minAmountOut: q, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.ddcUSDC(amt)] });
      const b0 = await balanceOf(T.USDC, f.user);
      await gas("swap native->USDC Dex Da Costa V2 (wrap+1 hop)", f.router.connect(f.user).swap(p, { value: amt }));
      expect((await balanceOf(T.USDC, f.user)) - b0).to.equal(q);
    });

    it("HexSwap V2 (own wrapped native): native HYPE -> tUSDT", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const hex = new ethers.Contract(V.hexSwapRouter, V2_ABI, f.user);
      const q = (await hex.getAmountsOut(amt, [T.HEX_WNATIVE, T.HEX_tUSDT]))[1];
      const r = route(amt, [hop(HopKind.WRAP, V.hexWrappedNative, NATIVE, T.HEX_WNATIVE), hop(HopKind.V2, V.hexSwapRouter, T.HEX_WNATIVE, T.HEX_tUSDT)]);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.HEX_tUSDT, amountIn: amt, minAmountOut: q, recipient: f.user.address, deadline: await deadlineIn(), routes: [r] });
      const b0 = await balanceOf(T.HEX_tUSDT, f.user);
      await gas("swap native->tUSDT HexSwap V2 (wrap+1 hop)", f.router.connect(f.user).swap(p, { value: amt }));
      expect((await balanceOf(T.HEX_tUSDT, f.user)) - b0).to.equal(q);
    });

    it("PerpMe V3 (own WETH9): native HYPE -> PERPME (1% pool)", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const r = route(amt, [hop(HopKind.WRAP, V.perpmeWeth9, NATIVE, T.PERPME_WETH9), hop(HopKind.V3_V1, V.perpmeSwapRouterV1, T.PERPME_WETH9, T.PERPME, 10000)]);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.PERPME, amountIn: amt, minAmountOut: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [r] });
      const b0 = await balanceOf(T.PERPME, f.user);
      await gas("swap native->PERPME PerpMe V3 (wrap+1 hop)", f.router.connect(f.user).swap(p, { value: amt }));
      expect((await balanceOf(T.PERPME, f.user)) - b0).to.be.greaterThan(0);
    });

    it("split: 60% Kalos V3 + 40% Dex Da Costa V2, native -> USDC", async function () {
      const f = await loadFixture(forkFixture);
      const a1 = E(0.006);
      const a2 = E(0.004);
      const q1 = await quoteKalos(f, T.WHYPE, T.USDC, 20000, a1);
      const q2 = (await new ethers.Contract(V.dexDaCostaRouter, V2_ABI, f.user).getAmountsOut(a2, [T.DDC_WETH, T.USDC]))[1];
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: a1 + a2, minAmountOut: q1 + q2, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(a1), nativeTo.ddcUSDC(a2)] });
      const b0 = await balanceOf(T.USDC, f.user);
      await gas("swap native->USDC split Kalos 60% + DDC 40%", f.router.connect(f.user).swap(p, { value: a1 + a2 }));
      expect((await balanceOf(T.USDC, f.user)) - b0).to.equal(q1 + q2);
    });

    it("multi-hop on Kalos: native -> WHYPE -> KALOS -> USDC", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const r = route(amt, [
        hop(HopKind.WRAP, V.whype, NATIVE, T.WHYPE),
        hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.KALOS, 3000),
        hop(HopKind.V3_V1, V.kalosSwapRouter, T.KALOS, T.USDC, 20000),
      ]);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, minAmountOut: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [r] });
      const b0 = await balanceOf(T.USDC, f.user);
      await gas("swap native->KALOS->USDC Kalos multi-hop (wrap+2 hops)", f.router.connect(f.user).swap(p, { value: amt }));
      expect((await balanceOf(T.USDC, f.user)) - b0).to.be.greaterThan(0);
    });

    it("cross-venue, cross-wrapper: USDC -(DDC)-> DDC WETH -> HYPE -> WHYPE -(Kalos)-> KALOS, then native out", async function () {
      const f = await loadFixture(forkFixture);
      const ra = f.ra;
      // Get USDC first.
      const amt = E(0.02);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] }), { value: amt });
      const usdc = await ethers.getContractAt("IERC20", T.USDC);
      const bal = await usdc.balanceOf(f.user.address);
      await usdc.connect(f.user).approve(ra, MAX);
      const half = bal / 2n;
      const r = route(half, [
        hop(HopKind.V2, V.dexDaCostaRouter, T.USDC, T.DDC_WETH),
        hop(HopKind.UNWRAP, V.ddcWeth, T.DDC_WETH, NATIVE),
        hop(HopKind.WRAP, V.whype, NATIVE, T.WHYPE),
        hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.KALOS, 3000),
      ]);
      const k0 = await balanceOf(T.KALOS, f.user);
      await gas("swap USDC->KALOS via DDC + unwrap + wrap + Kalos (4 hops)", f.router.connect(f.user).swap(swapParams({ tokenIn: T.USDC, tokenOut: T.KALOS, amountIn: half, minAmountOut: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [r] })));
      expect((await balanceOf(T.KALOS, f.user)) - k0).to.be.greaterThan(0);
      // Native out through DDC WETH unwrap.
      const n0 = await ethers.provider.getBalance(f.keeper.address);
      const rest = await usdc.balanceOf(f.user.address);
      await gas("swap USDC->native HYPE via DDC V2 + unwrap", f.router.connect(f.user).swap(swapParams({ tokenIn: T.USDC, tokenOut: NATIVE, amountIn: rest, minAmountOut: 1n, recipient: f.keeper.address, deadline: await deadlineIn(), routes: [route(rest, [hop(HopKind.V2, V.dexDaCostaRouter, T.USDC, T.DDC_WETH), hop(HopKind.UNWRAP, V.ddcWeth, T.DDC_WETH, NATIVE)])] })));
      expect((await ethers.provider.getBalance(f.keeper.address)) - n0).to.be.greaterThan(0);
      // Canonical WHYPE unwrap also fits the receive() path.
      const kal = await balanceOf(T.KALOS, f.user);
      await (await ethers.getContractAt("IERC20", T.KALOS)).connect(f.user).approve(ra, MAX);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: T.KALOS, tokenOut: NATIVE, amountIn: kal, minAmountOut: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [route(kal, [hop(HopKind.V3_V1, V.kalosSwapRouter, T.KALOS, T.WHYPE, 3000), hop(HopKind.UNWRAP, V.whype, T.WHYPE, NATIVE)])] }));
      for (const t of [NATIVE, T.USDC, T.KALOS, T.WHYPE, T.DDC_WETH]) expect(await balanceOf(t, ra)).to.equal(0);
    });

    it("protocol fee (30 bps) and integrator fee (50 bps) on a real swap", async function () {
      const f = await loadFixture(forkFixture);
      await f.router.setProtocolFee(30, f.feeTo.address);
      await f.router.setIntegrator(f.integrator.address, 50);
      const amt = E(0.01);
      const q = await quoteKalos(f, T.WHYPE, T.USDC, 20000, amt);
      const pf = (q * 30n) / 10000n;
      const inf = (q * 50n) / 10000n;
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, minAmountOut: q - pf - inf, recipient: f.user.address, deadline: await deadlineIn(), integrator: f.integrator.address, integratorFeeBps: 50, routes: [nativeTo.kalosUSDC(amt)] });
      await gas("swap native->USDC Kalos with protocol + integrator fee", f.router.connect(f.user).swap(p, { value: amt }));
      expect(await balanceOf(T.USDC, f.feeTo)).to.equal(pf);
      expect(await balanceOf(T.USDC, f.integrator)).to.equal(inf);
    });

    it("multicall: native -> wrap -> swap on Kalos -> deposit into stKALOS (one transaction, no approvals)", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.01);
      const dl = await deadlineIn();
      const p = swapParams({ tokenIn: T.WHYPE, tokenOut: T.KALOS, amountIn: MAX, recipient: f.ra, deadline: dl, routes: [route(MAX, [hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.KALOS, 3000)])] });
      const s0 = await balanceOf(T.stKALOS, f.user);
      await gas("multicall native->wrap->Kalos swap->stKALOS deposit", f.router.connect(f.user).multicall(dl, [act.wrap(V.whype, MAX), act.swap(p), act.deposit(V.stKALOS, MAX, f.user.address, 1n)], { value: amt }));
      expect((await balanceOf(T.stKALOS, f.user)) - s0).to.be.greaterThan(0);
      for (const t of [NATIVE, T.WHYPE, T.KALOS, T.stKALOS]) expect(await balanceOf(t, f.ra)).to.equal(0);
    });

    it("multicall: native -> wrap DDC WETH -> deposit into Cheshire wHYPE vault", async function () {
      const f = await loadFixture(forkFixture);
      const dl = await deadlineIn();
      const c0 = await balanceOf(V.cheshireWHYPEVault, f.user);
      await gas("multicall native->wrap DDC WETH->Cheshire vault deposit", f.router.connect(f.user).multicall(dl, [act.wrap(V.ddcWeth, MAX), act.deposit(V.cheshireWHYPEVault, MAX, f.user.address, 1n)], { value: E(0.01) }));
      expect((await balanceOf(V.cheshireWHYPEVault, f.user)) - c0).to.be.greaterThan(0);
      // And redeem back to native in one go: pull shares -> redeem to router -> unwrap -> sweep.
      const shares = await balanceOf(V.cheshireWHYPEVault, f.user);
      await (await ethers.getContractAt("IERC20", V.cheshireWHYPEVault)).connect(f.user).approve(f.ra, shares);
      const n0 = await ethers.provider.getBalance(f.keeper.address);
      await gas("multicall pull shares->Cheshire redeem->unwrap->sweep HYPE", f.router.connect(f.user).multicall(dl, [act.pull(V.cheshireWHYPEVault, shares), act.redeem(V.cheshireWHYPEVault, MAX, f.ra, 1n), act.unwrap(V.ddcWeth, MAX), act.sweep(NATIVE, f.keeper.address, 1n)]));
      expect((await ethers.provider.getBalance(f.keeper.address)) - n0).to.be.greaterThan(0);
    });

    it("Permit2: one signature pulls USDC and swaps; a front-runner cannot reuse it", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.02);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] }), { value: amt });
      const usdc = await ethers.getContractAt("IERC20", T.USDC);
      await usdc.connect(f.user).approve(M.permit2.address, MAX); // one-time Permit2 approval
      const bal = await usdc.balanceOf(f.user.address);
      const net = await ethers.provider.getNetwork();
      const domain = { name: "Permit2", chainId: net.chainId, verifyingContract: M.permit2.address };
      const permit = { permitted: { token: T.USDC, amount: bal }, nonce: 7n, deadline: await deadlineIn() };
      const sig = await f.user.signTypedData(domain, PERMIT2_TYPES, { ...permit, spender: f.ra });
      const r = route(bal, [hop(HopKind.V2, V.dexDaCostaRouter, T.USDC, T.DDC_WETH), hop(HopKind.UNWRAP, V.ddcWeth, T.DDC_WETH, NATIVE)]);
      const p = swapParams({ tokenIn: T.USDC, tokenOut: NATIVE, amountIn: bal, minAmountOut: 1n, recipient: f.user.address, deadline: await deadlineIn(), routes: [r] });
      // Front-runner submits the same permit with themselves as recipient: Permit2 checks the signer is msg.sender.
      await expect(f.router.connect(f.attacker).swapWithPermit2({ ...p, recipient: f.attacker.address }, permit, sig)).to.be.reverted;
      await gas("swapWithPermit2 USDC->native via DDC", f.router.connect(f.user).swapWithPermit2(p, permit, sig));
      expect(await usdc.balanceOf(f.user.address)).to.equal(0);
      // Replay of the consumed nonce fails.
      await expect(f.router.connect(f.user).swapWithPermit2(p, permit, sig)).to.be.reverted;
    });

    it("Permit2 inside multicall: pull USDC by signature -> deposit into Cheshire USDC vault", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.02);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] }), { value: amt });
      const usdc = await ethers.getContractAt("IERC20", T.USDC);
      await usdc.connect(f.user).approve(M.permit2.address, MAX);
      const bal = await usdc.balanceOf(f.user.address);
      const net = await ethers.provider.getNetwork();
      const permit = { permitted: { token: T.USDC, amount: bal }, nonce: 8n, deadline: await deadlineIn() };
      const sig = await f.user.signTypedData({ name: "Permit2", chainId: net.chainId, verifyingContract: M.permit2.address }, PERMIT2_TYPES, { ...permit, spender: f.ra });
      const dl = await deadlineIn();
      await gas("multicall Permit2 pull USDC->Cheshire USDC vault deposit", f.router.connect(f.user).multicall(dl, [act.pullPermit2(permit, bal, sig), act.deposit(V.cheshireUSDCVault, MAX, f.user.address, 1n)]));
      expect(await balanceOf(V.cheshireUSDCVault, f.user)).to.be.greaterThan(0);
    });
  });

  describe("Permit2 allowance mode", function () {
    it("PULL_PERMIT2_ALLOWANCE pulls only from msg.sender's Permit2 allowance", async function () {
      const f = await loadFixture(forkFixture);
      const amt = E(0.02);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.USDC, amountIn: amt, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosUSDC(amt)] }), { value: amt });
      const usdc = await ethers.getContractAt("IERC20", T.USDC);
      await usdc.connect(f.user).approve(M.permit2.address, MAX);
      const bal = await usdc.balanceOf(f.user.address);
      const permit2 = new ethers.Contract(M.permit2.address, ["function approve(address token,address spender,uint160 amount,uint48 expiration)"], f.user);
      await permit2.approve(T.USDC, f.ra, bal, Number(await time.latest()) + 3600);
      const dl = await deadlineIn();
      // The attacker cannot spend the user's Permit2 allowance to the router.
      await expect(f.router.connect(f.attacker).multicall(dl, [act.pullPermit2Allowance(T.USDC, bal), act.sweep(T.USDC, f.attacker.address)])).to.be.reverted;
      await gas("multicall Permit2 allowance pull USDC->Cheshire USDC vault", f.router.connect(f.user).multicall(dl, [act.pullPermit2Allowance(T.USDC, bal), act.deposit(V.cheshireUSDCVault, MAX, f.user.address, 1n)]));
      expect(await usdc.balanceOf(f.user.address)).to.equal(0);
      expect(await balanceOf(V.cheshireUSDCVault, f.user)).to.be.greaterThan(0);
    });
  });

  describe("ElyAccount on real venues", function () {
    it("agent swaps on Kalos and stakes into stKALOS within caps; exfiltration attempts fail; owner withdraws all", async function () {
      const f = await loadFixture(forkFixture);
      await gas("ElyAccountFactory.createAccount (clone + init)", f.factory.createAccount(f.user.address, ethers.ZeroHash));
      const accAddr = await f.factory.accountAddress(f.user.address, ethers.ZeroHash);
      const acc = await ethers.getContractAt("ElyAccount", accAddr);
      await f.user.sendTransaction({ to: accAddr, value: E(1) });
      const until = BigInt((await time.latest()) + 86400);
      await gas(
        "ElyAccount.setAgentPolicy (3 calls, 4 tokens)",
        acc.connect(f.user).setAgentPolicy(
          f.keeper.address,
          until,
          [
            { target: f.ra, action: await acc.ACTION_ROUTER_SWAP() },
            { target: V.stKALOS, action: await acc.ACTION_VAULT_DEPOSIT() },
            { target: V.stKALOS, action: await acc.ACTION_VAULT_REDEEM() },
          ],
          [
            { token: NATIVE, perTxCap: E(0.05), dailyCap: E(0.1) },
            { token: T.KALOS, perTxCap: E(1e9), dailyCap: E(1e9) },
            { token: T.stKALOS, perTxCap: E(1e9), dailyCap: E(1e9) },
            { token: T.USDC, perTxCap: 0, dailyCap: 0 },
          ],
          [],
        ),
      );
      const amt = E(0.05);
      const p = swapParams({ tokenIn: NATIVE, tokenOut: T.KALOS, amountIn: amt, minAmountOut: 1n, recipient: accAddr, deadline: await deadlineIn(), routes: [nativeTo.kalosKALOS(amt)] });
      await gas("ElyAccount.agentSwap native->KALOS (Kalos)", acc.connect(f.keeper).agentSwap(f.ra, p));
      const kal = await balanceOf(T.KALOS, accAddr);
      expect(kal).to.be.greaterThan(0);
      await expect(acc.connect(f.keeper).agentSwap(f.ra, { ...p, amountIn: E(0.06), routes: [nativeTo.kalosKALOS(E(0.06))] })).to.be.revertedWithCustomError(acc, "PerTxCapExceeded");
      await expect(acc.connect(f.keeper).agentSwap(f.ra, { ...p, recipient: f.keeper.address })).to.be.revertedWithCustomError(acc, "BadRecipient");
      await gas("ElyAccount.agentVaultDeposit KALOS->stKALOS", acc.connect(f.keeper).agentVaultDeposit(V.stKALOS, kal, 1n));
      const sh = await balanceOf(T.stKALOS, accAddr);
      expect(sh).to.be.greaterThan(0);
      await gas("ElyAccount.agentVaultRedeem stKALOS->KALOS", acc.connect(f.keeper).agentVaultRedeem(V.stKALOS, sh / 2n, 1n));
      await acc.connect(f.keeper).agentSwap(f.ra, p);
      // Daily native cap (0.1) is now used up.
      await expect(acc.connect(f.keeper).agentSwap(f.ra, p)).to.be.revertedWithCustomError(acc, "DailyCapExceeded");
      await acc.connect(f.user).revokeAgent();
      await expect(acc.connect(f.keeper).agentVaultRedeem(V.stKALOS, 1n, 0)).to.be.revertedWithCustomError(acc, "NotAgent");
      await gas("ElyAccount.withdrawAll (4 tokens)", acc.connect(f.user).withdrawAll([NATIVE, T.KALOS, T.stKALOS, T.USDC]));
      for (const t of [NATIVE, T.KALOS, T.stKALOS]) expect(await balanceOf(t, accAddr)).to.equal(0);
    });
  });

  describe("ElyOrders on real venues", function () {
    async function makerWithWhype(f, amount) {
      const w = new ethers.Contract(T.WHYPE, ["function deposit() payable", "function approve(address,uint256) returns (bool)"], f.user);
      await w.deposit({ value: amount });
      await w.approve(await f.orders.getAddress(), MAX);
    }

    async function warmOracle(f) {
      // Kalos pools ship with observation cardinality 1. Grow it and write a few observations.
      const pool = new ethers.Contract(P.kalosKALOS_WHYPE_03pct, POOL_ABI, f.owner);
      await pool.increaseObservationCardinalityNext(32);
      for (let i = 0; i < 4; i++) {
        const amt = E(0.001);
        await f.router.connect(f.owner).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.KALOS, amountIn: amt, recipient: f.owner.address, deadline: await deadlineIn(), routes: [nativeTo.kalosKALOS(amt)] }), { value: amt });
        await time.increase(120);
        await mine();
      }
      return pool;
    }

    it("limit order WHYPE -> KALOS executes at >= minOut; keeper tip paid; replay rejected", async function () {
      const f = await loadFixture(forkFixture);
      await makerWithWhype(f, E(1));
      const amt = E(0.1);
      const q = await quoteKalos(f, T.WHYPE, T.KALOS, 3000, amt);
      const now = await time.latest();
      const o = {
        maker: f.user.address, tokenIn: T.WHYPE, tokenOut: T.KALOS, amountIn: amt, minAmountOut: (q * 99n) / 100n, maxTip: E(0.0005),
        oracle: NATIVE, triggerTick: 0, triggerAbove: true, twapWindow: 0, maxDeviationTicks: 0, kind: OrderKind.LIMIT,
        executions: 1, interval: 0, startTime: now - 1, deadline: now + 3600, nonce: 1,
      };
      const sig = await signOrder(f.user, f.orders, o);
      const routes = [route(amt, [hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.KALOS, 3000)])];
      const k0 = await balanceOf(T.KALOS, f.user);
      await gas("ElyOrders.execute limit WHYPE->KALOS (Kalos)", f.orders.connect(f.keeper).execute(o, sig, routes, E(0.0005)));
      expect((await balanceOf(T.KALOS, f.user)) - k0).to.be.greaterThanOrEqual(o.minAmountOut);
      expect(await balanceOf(T.WHYPE, f.keeper)).to.equal(E(0.0005));
      await expect(f.orders.connect(f.keeper).execute(o, sig, routes, 0)).to.be.revertedWithCustomError(f.orders, "FullyExecuted");
      // A keeper routing through a worse venue path cannot push the maker below minOut.
      const o2 = { ...o, nonce: 2, minAmountOut: q * 2n };
      const sig2 = await signOrder(f.user, f.orders, o2);
      await expect(f.orders.connect(f.attacker).execute(o2, sig2, routes, 0)).to.be.revertedWithCustomError(f.router, "InsufficientOutput");
    });

    it("stop-loss with a real Kalos pool TWAP: blocked above trigger, executes below it", async function () {
      const f = await loadFixture(forkFixture);
      const pool = await warmOracle(f);
      expect(await pool.token0()).to.equal(T.KALOS);
      // Maker holds KALOS and wants out if KALOS (token0) priced in WHYPE drops: tick <= trigger.
      const amt = E(0.05);
      await f.router.connect(f.user).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.KALOS, amountIn: amt, recipient: f.user.address, deadline: await deadlineIn(), routes: [nativeTo.kalosKALOS(amt)] }), { value: amt });
      const kal = await balanceOf(T.KALOS, f.user);
      await (await ethers.getContractAt("IERC20", T.KALOS)).connect(f.user).approve(await f.orders.getAddress(), MAX);
      const tick = Number((await pool.slot0())[1]);
      const now = await time.latest();
      const base = {
        maker: f.user.address, tokenIn: T.KALOS, tokenOut: T.WHYPE, amountIn: kal, minAmountOut: 1n, maxTip: 0,
        oracle: P.kalosKALOS_WHYPE_03pct, triggerAbove: false, twapWindow: 240, maxDeviationTicks: 200, kind: OrderKind.STOP_LOSS,
        executions: 1, interval: 0, startTime: now - 1, deadline: now + 86400,
      };
      const routes = [route(kal, [hop(HopKind.V3_V1, V.kalosSwapRouter, T.KALOS, T.WHYPE, 3000)])];
      const notYet = { ...base, triggerTick: tick - 100, nonce: 1 };
      await expect(f.orders.connect(f.keeper).execute(notYet, await signOrder(f.user, f.orders, notYet), routes, 0)).to.be.revertedWithCustomError(f.orders, "ConditionNotMet");
      expect(await f.orders.conditionMet(notYet)).to.equal(false);
      const hit = { ...base, triggerTick: tick + 100, nonce: 2 };
      expect(await f.orders.conditionMet(hit)).to.equal(true);
      const w0 = await balanceOf(T.WHYPE, f.user);
      await gas("ElyOrders.execute stop-loss KALOS->WHYPE with TWAP check", f.orders.connect(f.keeper).execute(hit, await signOrder(f.user, f.orders, hit), routes, 0));
      expect((await balanceOf(T.WHYPE, f.user)) - w0).to.be.greaterThan(0);
      // A too-tight deviation bound trips once spot moves away from the TWAP.
      const tight = { ...base, triggerTick: tick + 5000, maxDeviationTicks: 0, nonce: 3, amountIn: 1n };
      const big = E(2);
      await f.router.connect(f.owner).swap(swapParams({ tokenIn: NATIVE, tokenOut: T.KALOS, amountIn: big, recipient: f.owner.address, deadline: await deadlineIn(), routes: [nativeTo.kalosKALOS(big)] }), { value: big });
      expect(await f.orders.conditionMet(tight)).to.equal(false);
    });

    it("DCA: three WHYPE -> USDC buys on Kalos spaced by the interval", async function () {
      const f = await loadFixture(forkFixture);
      await makerWithWhype(f, E(1));
      const amt = E(0.01);
      const now = await time.latest();
      const o = {
        maker: f.user.address, tokenIn: T.WHYPE, tokenOut: T.USDC, amountIn: amt, minAmountOut: 1n, maxTip: 0,
        oracle: NATIVE, triggerTick: 0, triggerAbove: true, twapWindow: 0, maxDeviationTicks: 0, kind: OrderKind.DCA,
        executions: 3, interval: 600, startTime: now - 1, deadline: now + 86400, nonce: 11,
      };
      const sig = await signOrder(f.user, f.orders, o);
      const routes = [route(amt, [hop(HopKind.V3_V1, V.kalosSwapRouter, T.WHYPE, T.USDC, 20000)])];
      await gas("ElyOrders.execute DCA fill 1 (Kalos)", f.orders.connect(f.keeper).execute(o, sig, routes, 0));
      await expect(f.orders.connect(f.keeper).execute(o, sig, routes, 0)).to.be.revertedWithCustomError(f.orders, "TooSoon");
      await time.increase(600);
      await f.orders.connect(f.keeper).execute(o, sig, routes, 0);
      await time.increase(600);
      await f.orders.connect(f.keeper).execute(o, sig, routes, 0);
      await time.increase(600);
      await expect(f.orders.connect(f.keeper).execute(o, sig, routes, 0)).to.be.revertedWithCustomError(f.orders, "FullyExecuted");
      expect(await balanceOf(T.WHYPE, await f.orders.getAddress())).to.equal(0);
    });
  });
});
