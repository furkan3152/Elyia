import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { custom, decodeFunctionData, decodeFunctionResult, encodeFunctionResult, type Hex } from "viem";
import { HERD_BASE_PERKS, HERD_HOLDER_PERKS } from "@elyia/core/api/herd";
import { createApp } from "../../../app.js";
import { EvmChains } from "../../../chains/evm.js";
import { createContext, type AppContext } from "../../../context.js";
import { serve, testConfig, type Served } from "../../../__tests__/support.js";
import { MemoryStore } from "../../../store/memory.js";
import { issueToken } from "../../ops/auth/session.js";
import { createAutomation } from "../../agent/automations.js";
import { chatQuota } from "../../agent/index.js";
import { effectiveQuotas } from "../../developers/gate.js";
import { HERD_SPEC_ABI } from "../abi.js";
import { forgetHerdCaches } from "../chain.js";
import { verifyProof } from "../merkle.js";
import { forgetPerks, perksFor } from "../perks.js";
import { toCsv } from "../index.js";
import { setHerdGenerator } from "../metadata.js";
import { APPLY_LIMITS } from "../applications.js";

const ADMIN = "0x5e9ee1089755c3435139848e47e6635505d5a13a";
const HERD = "0x00000000000000000000000000000000000e1e00";
const TREASURY = "0x7000000000000000000000000000000000000007";
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const [U1, U2, U3, U4, U5, HOLDER] = [wallet(0xa1), wallet(0xa2), wallet(0xa3), wallet(0xa4), wallet(0xa5), wallet(0xb0)];

/** A simulated ElyHerd behind eth_call (the spec ABI). */
const chain = {
  head: 1_000,
  totalSupply: 12n,
  phase: 1,
  paused: false,
  balances: new Map<string, bigint>([[HOLDER, 1n]]),
  roots: [`0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`] as [Hex, Hex],
};

function answer(functionName: string, args: readonly unknown[]): unknown {
  switch (functionName) {
    case "name":
      return "The Herd";
    case "symbol":
      return "HERD";
    case "MAX_SUPPLY":
      return 3333n;
    case "totalSupply":
      return chain.totalSupply;
    case "phase":
      return chain.phase;
    case "paused":
      return chain.paused;
    case "allocations":
      return [111n, 1311n, 300n, 1611n, 2n, 6n, 1n, 3n, 0n];
    case "merkleRoots":
      return chain.roots;
    case "provenanceHash":
      return `0x${"11".repeat(32)}`;
    case "revealed":
      return false;
    case "metadataFrozen":
      return false;
    case "royaltyInfo":
      return [TREASURY, 500n];
    case "phaseConfig":
      return [1_800_000_000n, 1_800_086_400n, 0, 10n ** 18n, 0n];
    case "quote":
      return 10n ** 18n;
    case "balanceOf":
      return chain.balances.get(String(args[0]).toLowerCase()) ?? 0n;
    case "mintedBy":
      return (chain.balances.get(String(args[0]).toLowerCase()) ?? 0n) > 0n ? 5n : 0n;
    case "quoteWithSource":
      return [10n ** 18n, 0];
    case "treasury":
      return TREASURY;
    case "pendingOwner":
      return `0x${"0".repeat(40)}`;
    case "eoaOnly":
      return true;
    case "maxMintable":
      return 3333n;
    case "revealCommitBlock":
      return 0n;
    case "revealOffset":
      return 0;
    case "REVEAL_DELAY_BLOCKS":
      return 32n;
    case "isOpen":
      return Number(args[0]) === chain.phase;
    case "oracle":
      return [`0x${"0".repeat(40)}`, 0, 0, false, 0];
    case "fallbackPrice":
      return [0n, 0, 0];
    case "placeholderURI":
    case "baseURI":
    case "contractURI":
      return "";
    case "owner":
      return ADMIN;
    default:
      throw new Error(`revert: ${functionName}`);
  }
}

let ctx: AppContext;
let server: Served;
const tokens: Record<string, string> = {};

before(async () => {
  setHerdGenerator(null);
  APPLY_LIMITS.perNetworkDay = 10_000;
  ctx = createContext(testConfig({ ELYIA_SESSION_SECRET: "s".repeat(40), ELYIA_ADMIN_ADDRESSES: ADMIN, HERD_TREASURY_ADDRESS: TREASURY, ELYIA_RATE_LIMIT_AUTH: "10000", ELYIA_RATE_LIMIT_HEAVY: "10000" }), { store: new MemoryStore() });
  const rpc = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_chainId") return "0x185d9";
      if (method === "eth_blockNumber") return `0x${chain.head.toString(16)}`;
      if (method === "eth_getTransactionCount") return "0x3";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_getLogs") return [];
      if (method === "eth_getBlockByNumber") {
        const number = Number.parseInt(String(params?.[0]), 16);
        if (number > chain.head) return null;
        return { number: `0x${number.toString(16)}`, hash: `0x${number.toString(16).padStart(64, "f")}`, parentHash: `0x${"0".repeat(64)}`, timestamp: "0x6553f100", gasLimit: "0x1", gasUsed: "0x0", baseFeePerGas: "0x1", miner: `0x${"0".repeat(40)}`, difficulty: "0x0", extraData: "0x", logsBloom: `0x${"0".repeat(512)}`, nonce: "0x0000000000000000", receiptsRoot: `0x${"0".repeat(64)}`, sha3Uncles: `0x${"0".repeat(64)}`, size: "0x1", stateRoot: `0x${"0".repeat(64)}`, totalDifficulty: "0x0", transactions: [], transactionsRoot: `0x${"0".repeat(64)}`, uncles: [], mixHash: `0x${"0".repeat(64)}` };
      }
      if (method === "eth_call") {
        const call = params?.[0] as { to?: string; data: Hex };
        if (call.to?.toLowerCase() !== HERD) throw new Error("execution reverted");
        const { functionName, args } = decodeFunctionData({ abi: HERD_SPEC_ABI, data: call.data });
        const fn = HERD_SPEC_ABI.find((item) => item.type === "function" && item.name === functionName)!;
        if (fn.type === "function" && fn.stateMutability !== "view") return "0x";
        return encodeFunctionResult({ abi: HERD_SPEC_ABI, functionName, result: answer(functionName, args ?? []) } as never);
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  (ctx as { chains: EvmChains }).chains = new EvmChains(ctx.config.networks, { transport: () => rpc });
  server = await serve(createApp(ctx));
  tokens.admin = issueToken(ctx, { address: ADMIN }).token;
  for (const [name, address] of Object.entries({ U1, U2, U3, U4, U5, HOLDER })) tokens[name] = issueToken(ctx, { address }).token;
});

after(async () => {
  await server.close();
});

async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: { ...(options.token ? { "Elyia-Session": options.token } : {}), ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? ((await response.json()) as Record<string, unknown>) : await response.text();
  return { status: response.status, body: body as Record<string, any> /* eslint-disable-line @typescript-eslint/no-explicit-any -- test JSON */, type };
}

function evidenceFor(handle: string) {
  return { task_share_card: `https://x.com/${handle}/status/1850000000000000001`, task_engage_post: `https://x.com/${handle}/status/1850000000000000002` };
}

const ADMIN_ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ["GET", "/v1/admin/herd/overview"],
  ["PUT", "/v1/admin/herd/settings", { applicationsOpen: true }],
  ["GET", "/v1/admin/herd/tasks"],
  ["POST", "/v1/admin/herd/tasks", { kind: "custom", label: "Join" }],
  ["PATCH", "/v1/admin/herd/tasks/task_follow_x", { points: 2 }],
  ["DELETE", "/v1/admin/herd/tasks/task_x"],
  ["GET", "/v1/admin/herd/applications"],
  ["GET", "/v1/admin/herd/applications/export"],
  ["POST", "/v1/admin/herd/applications/decision", { ids: ["app_x"], status: "approved" }],
  ["POST", "/v1/admin/herd/applications/rescore", {}],
  ["POST", "/v1/admin/herd/applications/app_x/notes", { text: "hi" }],
  ["POST", "/v1/admin/herd/applications/app_x/flags", { cleared: true }],
  ["POST", "/v1/admin/herd/applications/app_x/verify", {}],
  ["GET", "/v1/admin/herd/raffles"],
  ["POST", "/v1/admin/herd/raffles", { winners: 1 }],
  ["POST", "/v1/admin/herd/raffles/rfl_x/draw", {}],
  ["POST", "/v1/admin/herd/raffles/rfl_x/apply", {}],
  ["GET", "/v1/admin/herd/partners"],
  ["PUT", "/v1/admin/herd/partners/kalos", { name: "Kalos", cap: 10, wallets: [] }],
  ["DELETE", "/v1/admin/herd/partners/kalos"],
  ["POST", "/v1/admin/herd/merkle/wl/build", {}],
  ["GET", "/v1/admin/herd/merkle/wl/export"],
  ["GET", "/v1/admin/herd/snapshot"],
  ["POST", "/v1/admin/herd/tx", { functionName: "pause", args: [] }],
  ["POST", "/v1/admin/herd/tx/sent", { functionName: "pause", hash: `0x${"1".repeat(64)}` }],
  ["GET", "/v1/admin/herd/dashboard"],
  ["GET", "/v1/admin/herd/audit"],
];

describe("herd admin auth", () => {
  it("refuses every admin route without a session (401) and for a non-admin wallet (403)", async () => {
    for (const [method, path, body] of ADMIN_ROUTES) {
      const anonymous = await call(method, path, body === undefined ? {} : { body });
      assert.equal(anonymous.status, 401, `${method} ${path} without a session`);
      const user = await call(method, path, { token: tokens.U1, ...(body === undefined ? {} : { body }) });
      assert.equal(user.status, 403, `${method} ${path} as a user`);
    }
  });
});

describe("herd public, not deployed", () => {
  it("says not deployed, with the planned defaults", async () => {
    const res = await call("GET", "/v1/herd");
    assert.equal(res.status, 200);
    assert.equal(res.body.source, "not-deployed");
    assert.equal(res.body.maxSupply, 3333);
    assert.deepEqual(res.body.defaults, { team: 111, public: 1611, wlAndCollab: 1611 });
    assert.equal(res.body.links.xProfile, null, "never invented");
    assert.equal(res.body.testnet, true);
  });

  it("serves the placeholder before reveal", async () => {
    const meta = await call("GET", "/v1/herd/tokens/7");
    assert.equal(meta.status, 200);
    assert.equal(meta.body.revealed, false);
    assert.match(meta.body.image, /\/v1\/herd\/images\/placeholder\.png$/u);
    const image = await fetch(`${server.url}/v1/herd/images/7.png`);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal((await call("GET", "/v1/herd/tokens/99999")).status, 404);
  });

  it("gives base perks to everyone while nothing is deployed", async () => {
    const res = await call("GET", `/v1/herd/holder/${HOLDER}`);
    assert.equal(res.body.perks.holder, false);
    assert.equal(res.body.perks.source, "not-deployed");
    assert.equal(res.body.perks.automations, HERD_BASE_PERKS.automations);
  });

  it("seeds the three spec tasks with no invented links", async () => {
    const res = await call("GET", "/v1/herd/wl/tasks");
    assert.deepEqual(res.body.tasks.map((task: { kind: string }) => task.kind), ["share-card", "follow-x", "engage-post"]);
    assert.equal(res.body.tasks[1].url, null);
    assert.equal(res.body.applicationsOpen, true);
  });
});

describe("herd application rules", () => {
  it("needs a session and the session's own wallet", async () => {
    assert.equal((await call("POST", "/v1/herd/wl/apply", { body: { wallet: U1, xHandle: "ely_one", evidence: evidenceFor("ely_one") } })).status, 401);
    const mismatch = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U2, xHandle: "ely_one", evidence: evidenceFor("ely_one") } });
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error.code, "WALLET_MISMATCH");
  });

  it("checks the required tasks and that posts are the applicant's own", async () => {
    const missing = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "ely_one", evidence: {} } });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "TASKS_INCOMPLETE");
    const foreign = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "ely_one", evidence: evidenceFor("someone_else") } });
    assert.equal(foreign.status, 400);
  });

  it("keeps one application per wallet (a second apply edits it)", async () => {
    const first = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "@Ely_One", evidence: evidenceFor("ely_one"), device: "a".repeat(32) } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.status, "pending");
    assert.equal(first.body.xHandle, "ely_one");
    assert.equal(first.body.attempts, 1);
    assert.equal(first.body.ipHash, undefined, "network hashes never leave the server");
    const again = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "ely_one", evidence: evidenceFor("ely_one") } });
    assert.equal(again.status, 201);
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.body.attempts, 1);
  });

  it("gives an X handle to one wallet only (case-insensitive)", async () => {
    const taken = await call("POST", "/v1/herd/wl/apply", { token: tokens.U2, body: { wallet: U2, xHandle: "ELY_ONE", evidence: evidenceFor("ely_one") } });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, "X_HANDLE_TAKEN");
  });

  it("allows one re-application after a rejection, then refuses", async () => {
    const id = (await call("GET", "/v1/herd/wl/me", { token: tokens.U1 })).body.application.id;
    assert.equal((await call("POST", "/v1/admin/herd/applications/decision", { token: tokens.admin, body: { ids: [id], status: "rejected", note: "no follow" } })).status, 200);
    const me = await call("GET", "/v1/herd/wl/me", { token: tokens.U1 });
    assert.equal(me.body.application.status, "rejected");
    assert.equal(me.body.reapplyLeft, 1);
    const reapply = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "ely_one", evidence: evidenceFor("ely_one") } });
    assert.equal(reapply.status, 201);
    assert.equal(reapply.body.status, "pending");
    assert.equal(reapply.body.attempts, 2);
    await call("POST", "/v1/admin/herd/applications/decision", { token: tokens.admin, body: { ids: [U1], status: "rejected" } });
    const refused = await call("POST", "/v1/herd/wl/apply", { token: tokens.U1, body: { wallet: U1, xHandle: "ely_one", evidence: evidenceFor("ely_one") } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, "REAPPLY_LIMIT");
    assert.equal((await call("GET", "/v1/herd/wl/me", { token: tokens.U1 })).body.canApply, false);
  });

  it("rate-limits attempts per wallet", async () => {
    let last = 0;
    for (let attempt = 0; attempt < 7; attempt += 1) last = (await call("POST", "/v1/herd/wl/apply", { token: tokens.U4, body: { wallet: U4, xHandle: "ely_four", evidence: {} } })).status;
    assert.equal(last, 429);
  });

  it("closes applications when the admin says so", async () => {
    await call("PUT", "/v1/admin/herd/settings", { token: tokens.admin, body: { applicationsOpen: false } });
    const closed = await call("POST", "/v1/herd/wl/apply", { token: tokens.U2, body: { wallet: U2, xHandle: "ely_two", evidence: evidenceFor("ely_two") } });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.error.code, "APPLICATIONS_CLOSED");
    await call("PUT", "/v1/admin/herd/settings", { token: tokens.admin, body: { applicationsOpen: true } });
  });

  it("moves an application to a new wallet in two signed steps, once", async () => {
    assert.equal((await call("POST", "/v1/herd/wl/apply", { token: tokens.U3, body: { wallet: U3, xHandle: "ely_three", evidence: evidenceFor("ely_three") } })).status, 201);
    assert.equal((await call("POST", "/v1/herd/wl/move/accept", { token: tokens.U5, body: { from: U3 } })).status, 404, "nothing started yet");
    const start = await call("POST", "/v1/herd/wl/move/start", { token: tokens.U3, body: { to: U5 } });
    assert.equal(start.status, 200);
    assert.equal((await call("POST", "/v1/herd/wl/move/accept", { token: tokens.U2, body: { from: U3 } })).status, 404, "only the named wallet accepts");
    const accepted = await call("POST", "/v1/herd/wl/move/accept", { token: tokens.U5, body: { from: U3 } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.wallet, U5);
    assert.equal(accepted.body.movedFrom, U3);
    assert.equal((await call("GET", "/v1/herd/wl/me", { token: tokens.U3 })).body.application, null);
    const again = await call("POST", "/v1/herd/wl/move/start", { token: tokens.U5, body: { to: U2 } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "MOVE_LIMIT");
  });
});

describe("herd admin flows", () => {
  it("lists, filters, approves in bulk, notes and builds a verifiable WL root", async () => {
    const pending = await call("GET", "/v1/admin/herd/applications?status=pending", { token: tokens.admin });
    assert.equal(pending.status, 200);
    assert.ok(pending.body.applications.some((app: { wallet: string }) => app.wallet === U5));
    assert.equal(pending.body.counts.rejected, 1);
    await call("POST", "/v1/admin/herd/applications/decision", { token: tokens.admin, body: { ids: [U5], status: "approved", note: "good usage" } });
    const note = await call("POST", `/v1/admin/herd/applications/${U5}/notes`, { token: tokens.admin, body: { text: "checked X by hand" } });
    assert.equal(note.body.notes.length, 3);
    const build = await call("POST", "/v1/admin/herd/merkle/wl/build", { token: tokens.admin, body: {} });
    assert.equal(build.body.count, 1);
    const proof = await call("GET", `/v1/herd/wl/proof/${U5}`);
    assert.equal(proof.body.list, "wl");
    assert.equal(proof.body.root, build.body.root);
    const { addressLeaf } = await import("../merkle.js");
    assert.ok(verifyProof(proof.body.proof, proof.body.root, addressLeaf(U5)));
    assert.equal((await call("GET", `/v1/herd/wl/proof/${U2}`)).body.list, null);
    const me = await call("GET", "/v1/herd/wl/me", { token: tokens.U5 });
    assert.deepEqual(me.body.onList, { list: "wl", partner: null });
  });

  it("manages tasks and partners and exports the snapshot and CSV", async () => {
    const created = await call("POST", "/v1/admin/herd/tasks", { token: tokens.admin, body: { kind: "custom", label: "Join the Telegram", points: 2, required: false, evidence: "text" } });
    assert.equal(created.status, 201);
    const patched = await call("PATCH", `/v1/admin/herd/tasks/${created.body.id}`, { token: tokens.admin, body: { active: false } });
    assert.equal(patched.body.active, false);
    assert.equal((await call("DELETE", `/v1/admin/herd/tasks/${created.body.id}`, { token: tokens.admin })).body.deleted, true);
    const partner = await call("PUT", "/v1/admin/herd/partners/kalos", { token: tokens.admin, body: { name: "Kalos", cap: 50, wallets: [U2] } });
    assert.equal(partner.body.tagHex.slice(0, 12), "0x6b616c6f73");
    await call("POST", "/v1/admin/herd/merkle/collab/build", { token: tokens.admin, body: {} });
    const collab = await call("GET", `/v1/herd/wl/proof/${U2}`);
    assert.equal(collab.body.list, "collab");
    assert.equal(collab.body.partnerTag, "kalos");
    const snap = await call("GET", "/v1/admin/herd/snapshot?format=json", { token: tokens.admin });
    const entries = snap.body.entries as { address: string; reasons: string[] }[];
    assert.deepEqual(entries.find((entry) => entry.address === U5)?.reasons, ["wl-approved"]);
    assert.deepEqual(entries.find((entry) => entry.address === U2)?.reasons, ["collab"]);
    const csv = await call("GET", "/v1/admin/herd/applications/export?format=csv", { token: tokens.admin });
    assert.match(String(csv.body), /^id,wallet,x_handle,status,score/u);
    assert.equal(toCsv(["a"], [["=HYPERLINK(1)"]]), "a\n'=HYPERLINK(1)\n");
  });

  it("logs every admin action", async () => {
    const log = await call("GET", "/v1/admin/herd/audit", { token: tokens.admin });
    const actions = new Set((log.body.audit as { action: string }[]).map((entry) => entry.action));
    for (const action of ["applications.rejected", "applications.approved", "application.note", "merkle.build", "task.create", "task.update", "task.delete", "partner.put", "snapshot.export", "applications.export", "settings", "application.move"]) assert.ok(actions.has(action), action);
  });

  it("renders the shareable card as a PNG", async () => {
    const response = await fetch(`${server.url}/v1/herd/wl/card/${U5}.png`);
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
    assert.equal(new DataView(bytes.buffer).getUint32(16), 1200, "1200 px wide");
  });
});

describe("herd deployed: chain reads, perks, prepared txs, raffle", () => {
  before(async () => {
    await ctx.store.collection("deployments").put("elysium-testnet:ElyHerd", { network: "elysium-testnet", contract: "ElyHerd", address: HERD, txHash: `0x${"2".repeat(64)}`, deployer: ADMIN, blockNumber: "900", artifactVersion: "spec", codeHash: `0x${"3".repeat(64)}`, checks: { receiptSuccess: true, createdAddress: true, creationCodeMatches: true, runtimeCodeMatches: true, deployerIsAdmin: true }, recordedAt: "2026-11-01T00:00:00.000Z", recordedBy: ADMIN });
    forgetHerdCaches(ctx);
    forgetPerks(ctx);
  });

  it("reads the collection live", async () => {
    const res = await call("GET", "/v1/herd");
    assert.equal(res.body.source, "chain");
    assert.equal(res.body.totalSupply, 12);
    assert.equal(res.body.remaining, 3321);
    assert.equal(res.body.phase, "wl");
    assert.equal(res.body.allocations.public, 1611);
    assert.equal(res.body.quotes[0].wei, "1000000000000000000");
    assert.equal(res.body.royalty.receiver, TREASURY);
    assert.equal(res.body.admin.treasury, TREASURY);
    assert.equal(res.body.admin.owner, ADMIN);
    assert.equal(res.body.open.wl, true);
    assert.equal(res.body.quotes[0].source, "fixed");
  });

  it("gives holder perks from balanceOf, and wires them into the quotas", async () => {
    const holder = await perksFor(ctx, HOLDER);
    assert.equal(holder.holder, true);
    assert.equal(holder.source, "chain");
    assert.equal(holder.automations, HERD_HOLDER_PERKS.automations);
    const plain = await perksFor(ctx, U2);
    assert.equal(plain.holder, false);
    assert.equal(plain.agentChatPerDay, HERD_BASE_PERKS.agentChatPerDay);
    // Cached: a balance change shows after the TTL (or a forget), not per request.
    chain.balances.set(U2, 1n);
    assert.equal((await perksFor(ctx, U2)).holder, false);
    forgetPerks(ctx, U2);
    assert.equal((await perksFor(ctx, U2)).holder, true);
    chain.balances.delete(U2);
    forgetPerks(ctx, U2);

    for (let index = 0; index < 13; index += 1) await createAutomation(ctx, HOLDER, { kind: "dust-sweep" } as never);
    for (let index = 0; index < 12; index += 1) await createAutomation(ctx, U2, { kind: "dust-sweep" } as never);
    await assert.rejects(createAutomation(ctx, U2, { kind: "dust-sweep" } as never), /At most 12/u);

    const quotas = await effectiveQuotas(ctx, { owner: HOLDER, quotas: { requestsPerDay: 100, plansPerDay: 10, preparesPerDay: 5, requestsPerMinute: 3 } } as never);
    assert.equal(quotas.requestsPerDay, 100 * HERD_HOLDER_PERKS.developerQuotaMultiplier);

    for (let turn = 0; turn < HERD_BASE_PERKS.agentChatPerDay; turn += 1) await chatQuota(ctx, U3);
    await assert.rejects(chatQuota(ctx, U3), /today's 200 Ely turns/u);
    await chatQuota(ctx, HOLDER);

    const res = await call("GET", `/v1/herd/holder/${HOLDER}`);
    assert.equal(res.body.balance, 1);
    assert.equal(res.body.minted, true);
  });

  it("prepares owner calldata with guards, and never sends", async () => {
    const locked = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "setAllocations", args: ["111", "1611", "0", "1611"] } });
    assert.equal(locked.status, 400, "allocations lock once a phase opened");
    const back = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "setPhase", args: ["0"] } });
    assert.equal(back.status, 400, "phases only move forward");
    const rollover = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "rollover", args: ["1", "3", "10"] } });
    assert.equal(rollover.status, 400, "WL leftovers roll into public only from the PUBLIC phase on");
    const swap = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "rollover", args: ["1", "2", "10"] } });
    assert.equal(swap.status, 200, JSON.stringify(swap.body));
    const wrongTo = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "withdraw", args: [U2] } });
    assert.equal(wrongTo.status, 400);
    const royalty = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "setRoyalty", args: [TREASURY, "1500"] } });
    assert.equal(royalty.status, 400);
    assert.equal((await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "mintPublic", args: [] } })).status, 400, "not an owner function");
    const ok = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "withdraw", args: [TREASURY] } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.to, HERD);
    assert.equal(ok.body.value, "0");
    const decoded = decodeFunctionData({ abi: HERD_SPEC_ABI, data: ok.body.data });
    assert.equal(decoded.functionName, "withdraw");
    const root = (await call("POST", "/v1/admin/herd/merkle/wl/build", { token: tokens.admin, body: {} })).body.root;
    const setRoot = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "setMerkleRoot", args: ["0", root] } });
    assert.equal(setRoot.status, 200);
    assert.deepEqual(setRoot.body.warnings, []);
    const freeze = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "freezeMetadata", args: [] } });
    assert.equal(freeze.status, 400, "freeze only after reveal");
    const commit = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "commitReveal", args: [] } });
    assert.equal(commit.status, 400, "reveal commits only once the mint is over");
    const eoa = await call("POST", "/v1/admin/herd/tx", { token: tokens.admin, body: { functionName: "setEoaOnly", args: [false] } });
    assert.ok(eoa.body.warnings.some((warning: string) => /Contracts/u.test(warning)));
    assert.equal(eoa.body.simulation.ok, true);
    assert.equal(decodeFunctionResult({ abi: HERD_SPEC_ABI, functionName: "MAX_SUPPLY", data: encodeFunctionResult({ abi: HERD_SPEC_ABI, functionName: "MAX_SUPPLY", result: 3333n }) }), 3333n);
  });

  it("runs a weighted raffle seeded by a future block, verifiably", async () => {
    for (const [token, address, handle] of [[tokens.U2, U2, "ely_two"], [tokens.HOLDER, HOLDER, "ely_holder"]] as const) {
      assert.equal((await call("POST", "/v1/herd/wl/apply", { token, body: { wallet: address, xHandle: handle, evidence: evidenceFor(handle) } })).status, 201);
    }
    const early = await call("POST", "/v1/admin/herd/raffles", { token: tokens.admin, body: { winners: 1, targetBlock: chain.head + 5 } });
    assert.equal(early.status, 400, "the block must be far enough ahead");
    const committed = await call("POST", "/v1/admin/herd/raffles", { token: tokens.admin, body: { winners: 1, blocksAhead: 50 } });
    assert.equal(committed.status, 201, JSON.stringify(committed.body));
    assert.equal(committed.body.entrants, 2);
    assert.equal((await call("POST", `/v1/admin/herd/raffles/${committed.body.id}/draw`, { token: tokens.admin, body: {} })).status, 409, "too early");
    chain.head += 60;
    const drawn = await call("POST", `/v1/admin/herd/raffles/${committed.body.id}/draw`, { token: tokens.admin, body: {} });
    assert.equal(drawn.body.status, "drawn");
    assert.equal(drawn.body.drawn.length, 1);
    const { drawWinners, raffleSeed } = await import("../raffle.js");
    const pub = await call("GET", `/v1/herd/raffles/${committed.body.id}`);
    assert.equal(pub.body.seed, raffleSeed(pub.body.blockHash, pub.body.entrantsHash, pub.body.id));
    assert.equal(pub.body.pool, undefined, "the public view hides the pool");
    const applied = await call("POST", `/v1/admin/herd/raffles/${committed.body.id}/apply`, { token: tokens.admin, body: {} });
    assert.equal(applied.body.approved, 1);
    assert.equal(typeof drawWinners, "function");
  });
});
