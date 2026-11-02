import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { elyiaRouterArtifact } from "@elyia/core/contracts/index";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbi, type Address, type Hex } from "viem";
import { allowanceMappingSlot, allowanceSlot, bestRoute, ELYIA_ROUTER_ABI, HOP_KIND, probeMappingSlot, routerAllowlist, VIRTUAL_ROUTER } from "../adapters/elyiaRouter.js";
import { mappingSlot } from "../adapters/evmCommon.js";
import type { EngineDeps } from "../deps.js";
import type { CallRequest, SimulationRequest } from "../ports/evm.js";
import type { ResolvedAsset } from "../assets.js";
import { KALOS_V3 } from "../venues.js";

const USDC = "0x7d29d8047b905000459c0e80c34a26ceedcb47b2";
const POOL = "0x591aa2ec4275135c640d07f9eaa35cdad52ab05c";
const ZERO = "0x0000000000000000000000000000000000000000";
const TRUE_SLOT = 2n;

const hype = { network: "elysium-testnet", id: "eip155:99801/slip44:60", symbol: "HYPE", decimals: 18, native: true, address: null, verified: true } as unknown as ResolvedAsset;
const usdc = { network: "elysium-testnet", id: `eip155:99801/erc20:${USDC}`, symbol: "USDC", decimals: 6, native: false, address: USDC, verified: true } as unknown as ResolvedAsset;

function fakeDeps(simulations: SimulationRequest[]): EngineDeps {
  const evm = {
    async read(_network: string, request: { functionName: string; args?: readonly unknown[] }) {
      if (request.functionName === "getPool") return request.args?.[2] === 20_000 ? POOL : ZERO;
      if (request.functionName === "getPair") return ZERO;
      if (request.functionName === "factory") return KALOS_V3.factory;
      if (request.functionName === "liquidity") return 10n ** 18n;
      throw new Error(`unexpected read ${request.functionName}`);
    },
    async call(_network: string, request: CallRequest) {
      // A real EVM answers venueKind(probe) with the value in its slot: emulate slot 2.
      assert.ok(request.code?.[VIRTUAL_ROUTER], "the probe runs against the artifact code (state override)");
      const { args } = decodeFunctionData({ abi: ELYIA_ROUTER_ABI, data: request.data });
      const written = request.storage?.[VIRTUAL_ROUTER] ?? {};
      const value = written[mappingSlot(args?.[0] as Hex, TRUE_SLOT)];
      return { ok: true as const, data: encodeAbiParameters([{ type: "uint256" }], [value ? BigInt(value) : 0n]) };
    },
    async simulate(_network: string, request: SimulationRequest) {
      simulations.push(request);
      const last = request.calls.at(-1);
      const { args } = decodeFunctionData({ abi: ELYIA_ROUTER_ABI, data: last?.data as Hex });
      const params = (args?.[0] ?? {}) as { routes: Array<{ amountIn: bigint }> };
      const out = params.routes.reduce((sum, route) => sum + route.amountIn / 10n ** 12n * 6n, 0n);
      return [{ status: "success" as const, returnData: encodeFunctionResult({ abi: ELYIA_ROUTER_ABI, functionName: "swap", result: out }), gasUsed: 200_000n, logs: [] }];
    },
  };
  return { evm, clock: { now: () => 1_800_000_000_000 } } as unknown as EngineDeps;
}

describe("engine: ElyiaRouter venue", () => {
  it("finds the venueKind slot by probing the artifact code", async () => {
    const deps = fakeDeps([]);
    assert.equal(await probeMappingSlot(deps, "elysium-testnet", elyiaRouterArtifact.deployedBytecode as Hex, "venueKind"), TRUE_SLOT);
  });

  it("quotes before deployment with eth_simulateV1 code + storage overrides", async () => {
    const simulations: SimulationRequest[] = [];
    const deps = fakeDeps(simulations);
    const best = await bestRoute(deps, "elysium-testnet", { address: VIRTUAL_ROUTER, deployed: false, code: elyiaRouterArtifact.deployedBytecode as Hex }, hype, usdc, 10n ** 18n, null);
    assert.equal(best.out, 6_000_000n);
    assert.equal(best.label, "Kalos V3 2%");
    assert.deepEqual(best.routes[0]?.hops.map((hop) => hop.kind), [HOP_KIND.WRAP, HOP_KIND.V3_V1]);
    const sim = simulations[0] as SimulationRequest;
    assert.equal(sim.code?.[VIRTUAL_ROUTER], elyiaRouterArtifact.deployedBytecode);
    const slots = sim.storage?.[VIRTUAL_ROUTER] ?? {};
    assert.equal(BigInt(slots[mappingSlot(KALOS_V3.router, TRUE_SLOT)] ?? "0x0"), 3n, "Kalos router allowlisted as V3_ROUTER_V1");
    assert.equal(BigInt(slots[mappingSlot(KALOS_V3.wrappedNative, TRUE_SLOT)] ?? "0x0"), 1n, "WHYPE allowlisted as WRAPPER");
    assert.equal(sim.calls.at(-1)?.value, 10n ** 18n, "native HYPE goes in as msg.value");
  });

  it("allowlists exactly the pinned venues for the constructor", () => {
    const list = routerAllowlist("elysium-testnet").map((entry) => `${entry.label}:${entry.kind}`);
    assert.ok(list.includes("Kalos V3:3"));
    assert.ok(list.includes("Dex Da Costa:2"));
    assert.ok(list.includes("WHYPE:1"));
  });

  it("quotes a deployed router with eth_call when the RPC has no eth_simulateV1 (a plain fork)", async () => {
    const ROUTER = "0x70e000000000000000000000000000000000fc49" as Address;
    const calls: CallRequest[] = [];
    const deps = {
      evm: {
        ...fakeDeps([]).evm,
        async simulate() {
          return null;
        },
        async call(_network: string, request: CallRequest) {
          calls.push(request);
          const { args } = decodeFunctionData({ abi: ELYIA_ROUTER_ABI, data: request.data });
          const params = (args?.[0] ?? {}) as { routes: Array<{ amountIn: bigint }> };
          const out = params.routes.reduce((sum, route) => sum + (route.amountIn / 10n ** 12n) * 6n, 0n);
          return { ok: true as const, data: encodeFunctionResult({ abi: ELYIA_ROUTER_ABI, functionName: "swap", result: out }) };
        },
      },
      clock: { now: () => 1_800_000_000_000 },
    } as unknown as EngineDeps;
    const best = await bestRoute(deps, "elysium-testnet", { address: ROUTER, deployed: true, code: null }, hype, usdc, 10n ** 18n, null);
    assert.equal(best.out, 6_000_000n, "the router venue stays in the auction");
    const swap = calls.at(-1) as CallRequest;
    assert.equal(swap.to, ROUTER);
    assert.equal(swap.value, 10n ** 18n, "native HYPE goes in as msg.value");
    assert.ok(swap.balances && Object.values(swap.balances)[0]! >= 10n ** 18n, "the dummy sender is funded by override");
  });

  it("finds an ERC-20 allowance slot by eth_call overrides", async () => {
    const TOKEN = USDC as Address;
    const SPENDER = "0x70e000000000000000000000000000000000fc49" as Address;
    const SLOT = 1n;
    const allowanceAbi = parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]);
    const deps = {
      evm: {
        async call(_network: string, request: CallRequest) {
          const { args } = decodeFunctionData({ abi: allowanceAbi, data: request.data });
          const value = request.storage?.[TOKEN]?.[allowanceSlot(args[0], args[1], SLOT)];
          return { ok: true as const, data: encodeAbiParameters([{ type: "uint256" }], [value ? BigInt(value) : 0n]) };
        },
      },
    } as unknown as EngineDeps;
    assert.equal(await allowanceMappingSlot(deps, "elysium-testnet", TOKEN, SPENDER), SLOT);
  });
});
