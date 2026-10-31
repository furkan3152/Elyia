/**
 * The engine end to end over fakes: plan (venue auction with reference-price
 * deviation and fake-price warnings), Rule Book gating, prepare (unsigned
 * requests decoded), submit (references verified from receipt logs) and the
 * lifecycle; plus vaults, lending, Signal, look-alike refusal, .ely names.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { testConfig } from "../../__tests__/support.js";
import { erc20Abi, ERC4626_ABI, QUOTER_V2_ABI, SWAP_ROUTER_V1_ABI, V3_POOL_ABI } from "../abis.js";
import { createEngine, type Engine } from "../index.js";
import { priceWarnings, referenceDeviation } from "../auction.js";
import { elyLabel } from "../names.js";
import { CHESHIRE_USDC_VAULT, DEX_DA_COSTA, ELYRA_LENDING, ELY_NAMES, KALOS_V3, SIGNAL_V4 } from "../venues.js";
import { fixture, OTHER, OWNER, rawLog, transferLog, type Fixture } from "./fakes.js";

const USDC = "0x7d29d8047b905000459c0e80c34a26ceedcb47b2";
const WHYPE = "0xcd57f65c2b0e5881cfc2e609f7cd53b746e1f234";
const POOL = "0x591aa2ec4275135c640d07f9eaa35cdad52ab05c";
const DDC_PAIR = "0xfb3a6f0b6ec7837eaf298efe0e5dc534bf1d746a";
const ACCOUNT = `eip155:99801:${OWNER}` as const;
const ZERO = "0x0000000000000000000000000000000000000000";

function swapLog(pool: string, amountOut: bigint): ReturnType<typeof rawLog> {
  const topics = encodeEventTopics({ abi: V3_POOL_ABI, eventName: "Swap", args: { sender: KALOS_V3.router, recipient: OWNER } }) as Hex[];
  return rawLog(pool, topics, encodeAbiParameters([{ type: "int256" }, { type: "int256" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }], [-amountOut, 10n ** 16n, 1n, 1n, 0]));
}

/** Kalos: one WHYPE/USDC 2% pool quoting `out`; Dex Da Costa quoting `ddcOut` (or no pair). */
function markets(f: Fixture, out: bigint, ddcOut: bigint | null): void {
  f.evm.on(KALOS_V3.factory, "getPool", (args: readonly unknown[]) => (args[2] === 20_000 ? POOL : ZERO));
  f.evm.on(POOL, "factory", KALOS_V3.factory).on(POOL, "liquidity", 10n ** 20n);
  f.evm.on("*", "allowance", 0n);
  f.evm.callHandler = (_network, request) => {
    if (request.to.toLowerCase() === KALOS_V3.quoter) return { ok: true, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }], [out, 0n, 0, 0n]) };
    return { ok: false, revertData: null, message: "unexpected call" };
  };
  f.evm.on(DEX_DA_COSTA.factory, "getPair", ddcOut === null ? ZERO : DDC_PAIR);
  f.evm.on(DDC_PAIR, "factory", DEX_DA_COSTA.factory);
  f.evm.on(DEX_DA_COSTA.router, "getAmountsOut", (args: readonly unknown[]) => [args[0], ddcOut ?? 0n]);
  f.evm.balances.set(OWNER, 10n ** 20n);
}

describe("intent engine over fakes", () => {
  let ctx: AppContext;
  let f: Fixture;
  let engine: Engine;

  before(() => {
    ctx = createContext(testConfig());
  });
  after(async () => {
    await closeContext(ctx);
  });
  beforeEach(() => {
    f = fixture();
    engine = createEngine(ctx, { deps: f.deps });
  });

  const create = (actions: Parameters<Engine["service"]["create"]>[0]["actions"], dryRun = false) =>
    engine.service.create({ actions, accounts: [ACCOUNT], environment: "testnet", signer: "agent", dryRun, source: "structured" });

  it("auctions HYPE -> USDC across Kalos V3 and Dex Da Costa, flags the fake testnet price, then prepares, verifies and settles", async () => {
    markets(f, 95_000_000n, 94_000_000n);
    const created = await create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01" }]);
    const [step] = created.intent.steps;
    assert.ok(step);
    assert.equal(step.protocol, "kalos-v3");
    assert.equal(step.status, "ready");
    assert.equal(step.outputs[0]?.expected, "95000000");
    assert.equal(step.outputs[0]?.minimum, "94525000");
    assert.deepEqual(created.quotes.map((quote) => [quote.protocol, quote.winner]), [["kalos-v3", true], ["dex-da-costa", false]]);
    // 0.01 HYPE at $40 = $0.40 in, 95 USDC out: +23,650% against the reference.
    assert.equal(created.quotes[0]?.referenceDeviationBps, 2_365_000);
    assert.equal(created.quotes[0]?.referenceUsd, "95.00");
    assert.ok(step.warnings?.some((warning) => warning.startsWith("Fake price: Kalos V3")));
    assert.equal(created.policy.decision, "allow");

    const prepared = await engine.service.prepare(created.intent.id, "s1", {});
    const [request] = prepared.payload.requests;
    assert.ok(request && request.vm === "evm");
    assert.equal(request.to, KALOS_V3.router);
    assert.equal(request.value, "10000000000000000");
    const decoded = decodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, data: request.data });
    assert.equal((decoded.args[0] as { amountOutMinimum: bigint }).amountOutMinimum, 94_525_000n);
    assert.equal(prepared.intent.steps[0]?.status, "awaiting-signature");
    assert.match(prepared.payload.quoteBinding, /^sha256:[0-9a-f]{64}$/u);

    const hash = f.evm.land("elysium-testnet", { to: KALOS_V3.router, data: request.data, value: 10n ** 16n, logs: [swapLog(POOL, 95_100_000n), transferLog(USDC, POOL, OWNER, 95_100_000n)] });
    const submitted = await engine.service.submit(created.intent.id, "s1", [hash]);
    assert.equal(submitted.verification, "confirmed");
    assert.equal(submitted.step.status, "settled");
    assert.equal(submitted.step.actualOutputs?.[0]?.expected, "95100000");
    const journey = await engine.service.journey(created.intent.id);
    assert.equal(journey.status, "completed");
    await assert.rejects(engine.service.submit(created.intent.id, "s1", ["0x" + "11".repeat(32)]), (error: { code?: string }) => error.code === "STEP_NOT_AWAITING_SIGNATURE");
  });

  it("fails the step when the receipt credits less than the on-chain minimum, and refuses a transaction that is not the prepared one", async () => {
    markets(f, 95_000_000n, null);
    const created = await create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "0.01", protocol: "kalos-v3" }]);
    const prepared = await engine.service.prepare(created.intent.id, "s1", {});
    const request = prepared.payload.requests[0] as { data: Hex };
    const foreign = f.evm.land("elysium-testnet", { to: KALOS_V3.router, data: "0xdeadbeef" });
    await assert.rejects(engine.service.submit(created.intent.id, "s1", [foreign]), (error: { code?: string }) => error.code === "REFERENCE_MISMATCH");
    const short = f.evm.land("elysium-testnet", { to: KALOS_V3.router, data: request.data, value: 10n ** 16n, logs: [swapLog(POOL, 1n), transferLog(USDC, POOL, OWNER, 1n)] });
    const submitted = await engine.service.submit(created.intent.id, "s1", [short]);
    assert.equal(submitted.verification, "failed");
    assert.equal(submitted.step.failure?.code, "OUTCOME_NOT_PROVEN");
  });

  it("dry-runs without storing, and the Rule Book asks to confirm an external recipient (.ely name resolved on-chain)", async () => {
    f.evm.balances.set(OWNER, 10n ** 20n);
    f.evm.on(ELY_NAMES["elysium-testnet"] as string, "resolve", (args: readonly unknown[]) => (args[0] === "bona" ? OTHER : ZERO));
    const created = await create([{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "1", recipient: "Bona.ely" }], true);
    assert.equal(created.dryRun, true);
    assert.equal(created.intent.steps[0]?.recipient, `eip155:99801:${OTHER}`);
    assert.ok(created.intent.warnings.some((warning) => warning.includes("bona.ely resolved to")));
    assert.equal(created.policy.decision, "confirm");
    await assert.rejects(engine.service.get(created.intent.id));
    await assert.rejects(create([{ kind: "transfer", network: "elysium-testnet", from: "HYPE", amount: "1", recipient: "ghost.ely" }], true), (error: { code?: string }) => error.code === "NAME_UNRESOLVED");
    assert.throws(() => elyLabel("bоna.ely"), /not a valid/u); // Cyrillic "о"
    assert.equal(elyLabel("0xabc"), null);
  });

  it("deposits into the Cheshire USDC vault (approve + deposit) and verifies the Deposit event and share mint", async () => {
    f.evm.on(CHESHIRE_USDC_VAULT.vault, "asset", CHESHIRE_USDC_VAULT.asset).on(CHESHIRE_USDC_VAULT.vault, "previewDeposit", (args: readonly unknown[]) => args[0]);
    f.evm.on("*", "allowance", 0n).on(USDC, "balanceOf", 10n ** 12n);
    const created = await create([{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "2", protocol: "cheshire" }]);
    const step = created.intent.steps[0];
    assert.equal(step?.kind, "deposit");
    assert.equal(step?.outputs[0]?.symbol, "cUSDC");
    assert.equal(step?.outputs[0]?.minimum, "1998000");
    const prepared = await engine.service.prepare(created.intent.id, "s1", { confirmed: true });
    const [approve, deposit] = prepared.payload.requests as unknown as readonly { to: string; data: Hex }[];
    assert.equal(decodeFunctionData({ abi: erc20Abi, data: (approve as { data: Hex }).data }).functionName, "approve");
    assert.equal(decodeFunctionData({ abi: ERC4626_ABI, data: (deposit as { data: Hex }).data }).functionName, "deposit");
    const depositTopics = encodeEventTopics({ abi: ERC4626_ABI, eventName: "Deposit", args: { sender: OWNER, owner: OWNER } }) as Hex[];
    const hashes = [
      f.evm.land("elysium-testnet", { to: USDC as Address, data: (approve as { data: Hex }).data }),
      f.evm.land("elysium-testnet", { to: CHESHIRE_USDC_VAULT.vault, data: (deposit as { data: Hex }).data, logs: [transferLog(CHESHIRE_USDC_VAULT.vault, ZERO, OWNER, 2_000_000n), rawLog(CHESHIRE_USDC_VAULT.vault, depositTopics, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2_000_000n, 2_000_000n]))] }),
    ];
    const submitted = await engine.service.submit(created.intent.id, "s1", hashes);
    assert.equal(submitted.step.status, "settled");
  });

  it("refuses a lending supply the market would revert (simulated first), and plans one it accepts", async () => {
    const market = ELYRA_LENDING.markets[0];
    assert.ok(market);
    f.evm.on(ELYRA_LENDING.core, "market", [10n ** 12n, 10n ** 18n, 10n ** 9n, 10n ** 15n, 1_793_000_000n, 0n]);
    f.evm.on("*", "allowance", 0n).on(USDC, "balanceOf", (args: readonly unknown[]) => (String(args[0]).toLowerCase() === ELYRA_LENDING.core ? 10n ** 9n : 10n ** 12n));
    let accept = false;
    f.evm.simulateHandler = (_network, request) => request.calls.map((_, index) => ({ status: accept || index === 0 ? "success" : "reverted", returnData: "0x", gasUsed: 1n, logs: [] }));
    // Balance slot discovery for the simulated USDC balance: slot 51.
    const { balanceKey } = await import("./fakes.js");
    f.evm.storage.set(`${USDC}:${balanceKey(ELYRA_LENDING.core, 51n)}`, `0x${(10n ** 9n).toString(16).padStart(64, "0")}`);
    await assert.rejects(create([{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "5", protocol: "elyra-lending" }], true), (error: { code?: string }) => error.code === "ROUTE_UNAVAILABLE");
    accept = true;
    const created = await create([{ kind: "deposit", network: "elysium-testnet", from: "USDC", amount: "5", protocol: "elyra-lending" }], true);
    assert.equal(created.intent.steps[0]?.route?.params?.market, market.id);
    assert.ok(created.intent.steps[0]?.warnings?.some((warning) => warning.includes("third-party app")));
  });

  it("refuses withdrawing more than a lending market's free liquidity", async () => {
    f.evm.on(ELYRA_LENDING.core, "market", [100n, 100n * 10n ** 6n, 100n, 100n * 10n ** 6n, 1_793_000_000n, 0n]);
    f.evm.on(ELYRA_LENDING.core, "position", [50n * 10n ** 6n, 0n, 0n]);
    await assert.rejects(create([{ kind: "withdraw", network: "elysium-testnet", to: "WHYPE", amount: "0.00000000000000004", protocol: "elyra-lending" }], true), (error: { code?: string; message?: string }) => error.code === "ROUTE_UNAVAILABLE" && /free to withdraw/u.test(error.message ?? ""));
  });

  it("buys a Signal launch token only when its derived pool quotes", async () => {
    f.evm.balances.set(OWNER, 10n ** 20n);
    const token = "0x8aa6f0835805ca99f370634415d502ec5c603baf";
    f.evm.on(token, "symbol", "GCR").on(token, "decimals", 18);
    f.evm.callHandler = (_network, request) => (request.to.toLowerCase() === SIGNAL_V4.quoter ? { ok: false, revertData: null, message: "PoolNotInitialized" } : { ok: false, revertData: null, message: "?" });
    await assert.rejects(create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: token, amount: "0.01", protocol: "signal" }], true), (error: { code?: string }) => error.code === "ROUTE_UNAVAILABLE");
    f.evm.callHandler = () => ({ ok: true, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1_591n * 10n ** 18n, 80_000n]) });
    const created = await create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: token, amount: "0.01", protocol: "signal" }], true);
    assert.equal(created.intent.steps[0]?.protocol, "signal");
    assert.equal(created.policy.decision, "confirm");
    // Without naming the venue an unlisted token never resolves.
    await assert.rejects(create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: token, amount: "0.01" }], true), (error: { code?: string }) => error.code === "TOKEN_UNVERIFIED");
  });

  it("never routes a flagged look-alike token, even when the venue is named", async () => {
    f.evm.balances.set(OWNER, 10n ** 20n);
    await assert.rejects(
      create([{ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "0x757a34dd7b411546C6dd8f510B52e4381102f9B0", amount: "0.01", protocol: "kalos-v3" }], true),
      (error: { code?: string }) => error.code === "TOKEN_LOOKALIKE",
    );
  });

  it("the quote helper and fake-price warnings", async () => {
    const planned = { inputs: [{ asset: "eip155:99801/slip44:60", symbol: "HYPE", decimals: 18, expected: "1000000000000000000" }], outputs: [{ asset: `eip155:99801/erc20:${USDC}`, symbol: "USDC", decimals: 6, expected: "38000000" }] };
    const deviation = await referenceDeviation(f.deps, planned as never);
    assert.equal(deviation.bps, -500);
    assert.equal(deviation.usd, "38.00");
    const quote = (label: string, net: bigint, bps: number | null) => ({ adapter: { label } as never, planned: {} as never, netMinimum: net, deviationBps: bps, referenceUsd: null });
    assert.deepEqual(priceWarnings(quote("A", 100n, -500), [quote("B", 99n, -600)], "mainnet"), []);
    const warnings = priceWarnings(quote("A", 300n, 50_000), [quote("B", 100n, 0)], "testnet");
    assert.equal(warnings.length, 2);
    assert.match(warnings[0] as string, /^Fake price: A's testnet pool pays 500% more/u);
    assert.match(warnings[1] as string, /A quotes 200% more than B/u);
    void WHYPE;
    void QUOTER_V2_ABI;
  });
});
