// Shared helpers for @elyia/contracts tests.
const { ethers } = require("hardhat");

const NATIVE = ethers.ZeroAddress;
const MAX = ethers.MaxUint256;

const VenueKind = { NONE: 0, WRAPPER: 1, V2_ROUTER: 2, V3_ROUTER_V1: 3, V3_ROUTER_02: 4, VAULT: 5 };
const HopKind = { WRAP: 0, UNWRAP: 1, V2: 2, V3_V1: 3, V3_02: 4 };
const Op = {
  PULL: 0,
  PULL_PERMIT2: 1,
  PULL_PERMIT2_ALLOWANCE: 2,
  WRAP: 3,
  UNWRAP: 4,
  SWAP: 5,
  VAULT_DEPOSIT: 6,
  VAULT_REDEEM: 7,
  SWEEP: 8,
};
const OrderKind = { LIMIT: 0, STOP_LOSS: 1, TAKE_PROFIT: 2, DCA: 3, TWAP: 4 };

const HOP_T = "tuple(uint8 kind,address venue,address tokenIn,address tokenOut,uint24 fee)";
const ROUTE_T = `tuple(uint256 amountIn,${HOP_T}[] hops)`;
const SWAP_T =
  `tuple(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline,` +
  `address integrator,uint16 integratorFeeBps,${ROUTE_T}[] routes)`;
const PERMIT_T = "tuple(tuple(address token,uint256 amount) permitted,uint256 nonce,uint256 deadline)";

const coder = ethers.AbiCoder.defaultAbiCoder();

function hop(kind, venue, tokenIn, tokenOut, fee = 0) {
  return { kind, venue, tokenIn, tokenOut, fee };
}

function route(amountIn, hops) {
  return { amountIn, hops };
}

async function deadlineIn(seconds = 3600) {
  const b = await ethers.provider.getBlock("latest");
  return BigInt(b.timestamp + seconds);
}

function swapParams(o) {
  return {
    tokenIn: o.tokenIn,
    tokenOut: o.tokenOut,
    amountIn: o.amountIn,
    minAmountOut: o.minAmountOut ?? 0n,
    recipient: o.recipient,
    deadline: o.deadline,
    integrator: o.integrator ?? NATIVE,
    integratorFeeBps: o.integratorFeeBps ?? 0,
    routes: o.routes,
  };
}

const act = {
  pull: (token, amount) => ({ op: Op.PULL, data: coder.encode(["address", "uint256"], [token, amount]) }),
  pullPermit2: (permit, amount, sig) => ({
    op: Op.PULL_PERMIT2,
    data: coder.encode([PERMIT_T, "uint256", "bytes"], [permit, amount, sig]),
  }),
  pullPermit2Allowance: (token, amount) => ({
    op: Op.PULL_PERMIT2_ALLOWANCE,
    data: coder.encode(["address", "uint160"], [token, amount]),
  }),
  wrap: (wrapper, amount) => ({ op: Op.WRAP, data: coder.encode(["address", "uint256"], [wrapper, amount]) }),
  unwrap: (wrapper, amount) => ({ op: Op.UNWRAP, data: coder.encode(["address", "uint256"], [wrapper, amount]) }),
  swap: (p) => ({ op: Op.SWAP, data: coder.encode([SWAP_T], [p]) }),
  deposit: (vault, assets, receiver, minShares = 0n) => ({
    op: Op.VAULT_DEPOSIT,
    data: coder.encode(["address", "uint256", "address", "uint256"], [vault, assets, receiver, minShares]),
  }),
  redeem: (vault, shares, receiver, minAssets = 0n) => ({
    op: Op.VAULT_REDEEM,
    data: coder.encode(["address", "uint256", "address", "uint256"], [vault, shares, receiver, minAssets]),
  }),
  sweep: (token, recipient, minAmount = 0n) => ({
    op: Op.SWEEP,
    data: coder.encode(["address", "address", "uint256"], [token, recipient, minAmount]),
  }),
};

async function balanceOf(token, who) {
  const addr = typeof who === "string" ? who : await who.getAddress();
  if (token === NATIVE) return ethers.provider.getBalance(addr);
  const t = await ethers.getContractAt("IERC20", token);
  return t.balanceOf(addr);
}

/** Deterministic PRNG (mulberry32) for reproducible fuzzing. */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    big: (max) => (BigInt(Math.floor(next() * 1e9)) * max) / 1_000_000_000n,
  };
}

async function signOrder(signer, orders, order) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: "ElyOrders", version: "1", chainId: net.chainId, verifyingContract: await orders.getAddress() };
  return signer.signTypedData(domain, ORDER_TYPES, order);
}

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "maxTip", type: "uint256" },
    { name: "oracle", type: "address" },
    { name: "triggerTick", type: "int24" },
    { name: "triggerAbove", type: "bool" },
    { name: "twapWindow", type: "uint32" },
    { name: "maxDeviationTicks", type: "uint24" },
    { name: "kind", type: "uint8" },
    { name: "executions", type: "uint32" },
    { name: "interval", type: "uint32" },
    { name: "startTime", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

/** Signs ElyAccountMessage(hash) in the account's domain, the only form ElyAccount accepts for ERC-1271. */
async function signForAccount(ownerSigner, account, hash) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: "ElyAccount", version: "1", chainId: net.chainId, verifyingContract: await account.getAddress() };
  return ownerSigner.signTypedData(domain, { ElyAccountMessage: [{ name: "hash", type: "bytes32" }] }, { hash });
}

module.exports = {
  NATIVE,
  MAX,
  VenueKind,
  HopKind,
  Op,
  OrderKind,
  SWAP_T,
  PERMIT_T,
  hop,
  route,
  swapParams,
  deadlineIn,
  act,
  balanceOf,
  prng,
  signOrder,
  signForAccount,
  ORDER_TYPES,
};
