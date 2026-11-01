import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { custom, encodeDeployData, type Abi } from "viem";
import { elyiaRouterArtifact } from "@elyia/core/contracts/index";
import { createApp } from "../../../app.js";
import { EvmChains } from "../../../chains/evm.js";
import { createContext, type AppContext } from "../../../context.js";
import { serve, testConfig, type Served } from "../../../__tests__/support.js";
import { elyiaRouterDeployment, setElyiaRouterDeployment } from "../../../engine/adapters/elyiaRouter.js";
import { MemoryStore } from "../../../store/memory.js";
import { issueToken } from "../../ops/auth/session.js";
import { creationMatches, maskMetadata, routerAbiCompatible, runtimeMatches } from "../deployments.js";

const ADMIN = "0x5e9ee1089755c3435139848e47e6635505d5a13a";
const ROUTER = "0x00000000000000000000000000000000000a11ce";
const TX = `0x${"cd".repeat(32)}`;
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

/** The artifact's runtime code with its zero-filled immutable slots written (what the chain holds after the constructor). */
function filledRuntime(code: string): string {
  const body = code.slice(2);
  const run = "0".repeat(64);
  const index = body.indexOf(run);
  assert.ok(index >= 0, "the router has an immutable slot");
  const aligned = index % 2 === 0 ? index : index + 1;
  return `0x${body.slice(0, aligned)}${"0".repeat(24)}${PERMIT2.slice(2)}${body.slice(aligned + 64)}`;
}

let ctx: AppContext;
let server: Served;
let admin: string;
let runtime = "";
let input = "";

before(async () => {
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_ADMIN_ADDRESSES: ADMIN }), { store: new MemoryStore() });
  runtime = filledRuntime(elyiaRouterArtifact.deployedBytecode);
  input = encodeDeployData({ abi: elyiaRouterArtifact.abi as Abi, bytecode: elyiaRouterArtifact.bytecode as `0x${string}`, args: [ADMIN, PERMIT2, [], []] } as never);
  const rpc = custom({
    async request({ method }: { method: string }) {
      if (method === "eth_chainId") return "0x185d9";
      if (method === "eth_getTransactionReceipt") return { status: "0x1", contractAddress: ROUTER, blockNumber: "0x10", logs: [] };
      if (method === "eth_getTransactionByHash") return { from: ADMIN, to: null, input };
      if (method === "eth_getCode") return runtime;
      throw new Error(`unexpected ${method}`);
    },
  });
  (ctx as { chains: EvmChains }).chains = new EvmChains(ctx.config.networks, { transport: () => rpc });
  server = await serve(createApp(ctx));
  admin = issueToken(ctx, { address: ADMIN }).token;
});

after(async () => {
  setElyiaRouterDeployment("elysium-testnet", null);
  await server.close();
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${server.url}${path}`, { method, headers: { "Elyia-Session": admin, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("admin: bytecode matching", () => {
  it("ignores immutables and metadata, nothing else", () => {
    assert.ok(runtimeMatches(runtime, elyiaRouterArtifact.deployedBytecode));
    const tampered = `${runtime.slice(0, 10)}${runtime.slice(10, 12) === "ff" ? "fe" : "ff"}${runtime.slice(12)}`;
    assert.equal(runtimeMatches(tampered, elyiaRouterArtifact.deployedBytecode), false);
    assert.equal(maskMetadata("00a264697066735822" + "11".repeat(34) + "64736f6c6343" + "00081c" + "0033").replace(/0/gu, ""), "");
    assert.ok(creationMatches(input, elyiaRouterArtifact.bytecode));
    assert.equal(creationMatches(`0x6000${input.slice(6)}`, elyiaRouterArtifact.bytecode), false);
    assert.ok(routerAbiCompatible(elyiaRouterArtifact.abi as unknown as unknown[]));
  });
});

describe("admin: deployment registry", () => {
  it("records a verified ElyiaRouter deployment and arms the router venue", async () => {
    const recorded = await call("POST", "/v1/admin/deployments", { network: "elysium-testnet", contract: "ElyiaRouter", txHash: TX });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    const deployment = recorded.body.deployment as { address: string; checks: Record<string, boolean | null> };
    assert.equal(deployment.address, ROUTER);
    assert.deepEqual(deployment.checks, { receiptSuccess: true, createdAddress: true, creationCodeMatches: true, runtimeCodeMatches: true, deployerIsAdmin: true });
    assert.equal(elyiaRouterDeployment("elysium-testnet")?.address, ROUTER);
    const config = (await (await fetch(`${server.url}/v1/config/contracts?network=elysium-testnet`)).json()) as { networks: Array<{ contracts: Record<string, { address: string }> }>; artifacts: unknown[] };
    assert.equal(config.networks[0]?.contracts.ElyiaRouter?.address, ROUTER);
    assert.ok(Array.isArray(config.artifacts) && config.artifacts.length >= 3);
  });

  it("rejects code that differs from the artifact", async () => {
    const saved = runtime;
    runtime = `${runtime.slice(0, 200)}${"ab"}${runtime.slice(202)}`;
    const rejected = await call("POST", "/v1/admin/deployments", { network: "elysium-testnet", contract: "ElyiaRouter", txHash: TX });
    runtime = saved;
    assert.equal(rejected.status, 422);
    assert.equal((rejected.body.error as { code: string }).code, "DEPLOYMENT_REJECTED");
  });

  it("builds the owner's deploy plan from the manifest", async () => {
    const plan = await call("GET", "/v1/admin/deploy-plan?network=elysium-testnet");
    const steps = plan.body.steps as Array<{ contract: string; transaction: { data: string } | null; constructorArgs: Array<{ name: string; value: string | null }> }>;
    assert.deepEqual(steps.map((step) => step.contract), ["ElyiaRouter", "ElyAccountFactory", "ElyOrders"]);
    assert.ok(steps[0]?.transaction?.data.startsWith(elyiaRouterArtifact.bytecode.slice(0, 40)));
    assert.equal(steps[0]?.constructorArgs[0]?.value, ADMIN);
    // The router is recorded now, so ElyOrders gets its address.
    assert.match(steps[2]?.constructorArgs[0]?.value ?? "", /0x0+a11ce/u);
  });

  it("stores feature flags (admin only)", async () => {
    const updated = await call("PUT", "/v1/admin/flags", { agentLlm: false });
    assert.equal((updated.body.flags as { agentLlm: boolean }).agentLlm, false);
    const publicFlags = (await (await fetch(`${server.url}/v1/config/flags`)).json()) as { flags: { agentLlm: boolean; mcp: boolean } };
    assert.deepEqual([publicFlags.flags.agentLlm, publicFlags.flags.mcp], [false, true]);
    await call("PUT", "/v1/admin/flags", { agentLlm: true });
  });
});
