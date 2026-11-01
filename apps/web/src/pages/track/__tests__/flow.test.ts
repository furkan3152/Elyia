import assert from "node:assert/strict";
import { test } from "node:test";

import type { CreateIntentResponse } from "@elyia/core/api/intents";
import { concatHex, decodeFunctionData, numberToHex, pad, type Hex } from "viem";

import { ARB_SYS_ABI, CORE_DEPOSIT_WALLET_ABI, ERC20_ABI } from "../flow/abis";
import { addLeg, parseJourneys, parseWatched, upsertJourney, upsertWatched, type JourneyRecord } from "../flow/journeyStore";
import { CORE_DEX, planOffline } from "../flow/localPlanner";
import { childIdOf, ethDepositTxId, ticketState, TICKET_LIFETIME_SEC, withdrawalSeconds } from "../flow/orbit";
import { DEFAULT_RULE_BOOK_HASH, ruleBookLine } from "../../../topo/ruleBook";
import { direction, formatBase, formatEta, phaseState, routeFromPlanner, shortRouteId } from "../flow/routeModel";
import { parseTrackQuery, traceMoving, type Trace } from "../flow/trace";
import { traceRoute } from "../traceRoute";

const ACCOUNT = "0x1683Ce24F61f40D0b140EFDC78dC3fdcc7Eb18fa";

/* Live kind-12 deposit on Elysium testnet: L1 0x264dafab…a40c -> L2 0x12675ff2…39e1. */
const DEPOSIT = {
  msgIdx: 1872777n,
  aliasedSender: "0x2794CE24F61F40d0b140EFdc78dC3FdcC7EB2A0b",
  to: "0x1683Ce24F61f40D0b140EFDC78dC3fdcc7Eb18fa",
  value: 99990893300000000n,
  l2: "0x12675ff2443e751b84bf1af6dcf593ae9e9a64d37aac0c019729eca6d81639e1",
} as const;
const DEPOSIT_DATA = concatHex([DEPOSIT.to, pad(numberToHex(DEPOSIT.value), { size: 32 })]);

test("orbit: the kind-12 deposit id matches a live Elysium testnet deposit", () => {
  assert.equal(ethDepositTxId(99801, DEPOSIT.msgIdx, DEPOSIT.aliasedSender, DEPOSIT_DATA), DEPOSIT.l2);
  const child = childIdOf({ messageIndex: DEPOSIT.msgIdx, kind: 12, sender: DEPOSIT.aliasedSender, baseFeeL1: 0n, data: DEPOSIT_DATA, timestamp: 0n }, 99801);
  assert.deepEqual(child, { kind: "deposit", id: DEPOSIT.l2 });
  assert.equal(childIdOf({ messageIndex: 1n, kind: 3, sender: DEPOSIT.aliasedSender, baseFeeL1: 0n, data: "0x", timestamp: 0n }, 99801), null);
});

test("orbit: ticket states from creation, presence and age", () => {
  const now = 2_000_000_000;
  assert.equal(ticketState({ created: false, stillHeld: false, timeoutSec: null, createdAtSec: null, nowSec: now }), "unknown");
  assert.equal(ticketState({ created: true, stillHeld: true, timeoutSec: now + 1000, createdAtSec: now - 10, nowSec: now }), "created");
  assert.equal(ticketState({ created: true, stillHeld: true, timeoutSec: now + 1000, createdAtSec: now - 600, nowSec: now }), "needs-redeem");
  assert.equal(ticketState({ created: true, stillHeld: false, timeoutSec: null, createdAtSec: now - 600, nowSec: now }), "redeemed");
  assert.equal(ticketState({ created: true, stillHeld: false, timeoutSec: null, createdAtSec: now - TICKET_LIFETIME_SEC - 1, nowSec: now }), "expired");
  assert.equal(withdrawalSeconds(10), 1810);
  assert.equal(withdrawalSeconds(483_840), 485_640);
});

test("routeModel: amounts, ETAs, directions", () => {
  assert.equal(formatBase("1964048129", 6), "1,964.04");
  assert.equal(formatBase("500000000000000000", 18), "0.5");
  assert.equal(formatBase("4884064408088433", 18), "0.004884");
  assert.equal(formatEta(2), "2 s");
  assert.equal(formatEta(120), "~2 min");
  assert.equal(formatEta(485_640), "~5 d 15 h");
  assert.equal(direction("ridge", "summit"), "ascend");
  assert.equal(direction("summit", "ridge"), "descend");
  assert.equal(direction("floor", "floor"), "traverse");
  assert.equal(phaseState("your-turn"), "next");
  assert.equal(phaseState("in-flight"), "climbing");
  assert.equal(shortRouteId("int_abc").length, 4);
});

test("routeModel: a planner dry run becomes a route card without invented lines", () => {
  const response = {
    intent: {
      id: "int_ec04e916f344763dcd6695da50442730",
      accounts: ["eip155:998:0x00000000000000000000000000000000000e1a1a"],
      warnings: [],
      summary: { totalFeesUsd: "0.01", estimatedSeconds: 120 },
      steps: [
        {
          id: "s1",
          kind: "bridge",
          title: "Bridge 0.5 HYPE from HyperEVM Testnet to Elysium Testnet",
          network: "hyperevm-testnet",
          protocol: "elysium-canonical-bridge",
          mode: "wallet",
          inputs: [{ symbol: "HYPE", decimals: 18, expected: "500000000000000000" }],
          outputs: [{ symbol: "HYPE", decimals: 18, expected: "500000000000000000", minimum: "500000000000000000" }],
          settlement: { kind: "cross-network", destinationNetwork: "elysium-testnet", expectedSeconds: 120 },
          feesUsd: "0.01",
          estimatedSeconds: 120,
        },
      ],
    },
    journey: { stops: [{ stepId: "s1", phase: "your-turn" }] },
    policy: { decision: "allow", ruleBookHash: "sha256:350c", reasons: [], notionalUsd: "47.98" },
    quotes: [{ stepId: "s1", protocol: "elysium-canonical-bridge", expected: "500000000000000000", minimum: "500000000000000000", symbol: "HYPE", decimals: 18, winner: true }],
  } as unknown as CreateIntentResponse;
  const route = routeFromPlanner(response, "bridge 0.5 HYPE to Elysium", 1);
  assert.equal(route.steps.length, 1);
  const [step] = route.steps;
  assert.equal(step!.layer, "ridge");
  assert.equal(step!.toLayer, "summit");
  assert.equal(step!.action, "ascend");
  assert.equal(step!.state, "next");
  assert.equal(step!.inOut, "0.5 HYPE → 0.5 HYPE");
  assert.equal(route.fees, "$0.01");
  assert.deepEqual(route.signatures, { done: 0, needed: 1, note: undefined });
  assert.deepEqual(route.rules, ["Rule Book: allowed", "$47.98 at reference price", "to your own address"]);
  assert.equal(route.minimum, null);
  assert.equal(route.quotes[0]!.label, "canonical bridge");
  assert.deepEqual(route.unpriced, []);
});

test("routeModel: the Rule Book's unpriced-token outcome (cap, testnet only) and its marks", () => {
  // Shapes of a live dry run (2026-11-01): 10 KALOS allowed under the cap, 5,000 KALOS refused.
  const note = (amountText: string, status: "allowed" | "refused") => ({ asset: "eip155:99801/erc20:0x8a2201953AF29e8BE7700bcB53dA3ce5caD18726", symbol: "KALOS", network: "elysium-testnet", role: "input", amount: "0", decimals: 18, path: "steps[0].inputs[0]", cap: "1000", status, message: "m", amountText });
  const base = {
    intent: { id: "int_00000000000000000000000000000001", accounts: ["eip155:99801:0x00000000000000000000000000000000000e1a1a"], warnings: [], summary: { totalFeesUsd: null }, steps: [] },
    journey: { stops: [] },
    quotes: [],
  };
  const allowed = routeFromPlanner({ ...base, policy: { decision: "allow", ruleBookHash: DEFAULT_RULE_BOOK_HASH, reasons: [], notionalUsd: "0.00", unpriced: [note("10", "allowed")] } } as unknown as CreateIntentResponse, "swap 10 KALOS to WHYPE on kalos", 1);
  assert.deepEqual(allowed.unpriced, [{ symbol: "KALOS", role: "input", amountText: "10", cap: "1000", status: "allowed", message: "m" }]);
  assert.equal(ruleBookLine(allowed.binding!), `default Rule Book · ${DEFAULT_RULE_BOOK_HASH.slice(0, 15)}…`);
  assert.match(ruleBookLine("sha256:" + "a".repeat(64)), /^your Rule Book · sha256:aaaaaaaa…$/u);
  const refused = routeFromPlanner(
    {
      ...base,
      policy: {
        decision: "deny",
        ruleBookHash: DEFAULT_RULE_BOOK_HASH,
        reasons: [
          { rule: "assets.unpriced", outcome: "deny", message: "5000 KALOS is above the 1000 KALOS cap for tokens without a reference price.", path: "steps[0].inputs[0]" },
          { rule: "facts.unavailable", outcome: "deny", message: "A fact your rules need is unknown.", path: "x" },
        ],
        notionalUsd: null,
        unpriced: [note("5000", "refused")],
      },
    } as unknown as CreateIntentResponse,
    "swap 5000 KALOS to WHYPE on kalos",
    1,
  );
  assert.equal(refused.unpriced[0]!.status, "refused");
  // The unpriced reason lives in its own block; a denial is never drawn with a tick.
  assert.deepEqual(refused.rules.filter((rule) => typeof rule !== "string"), [{ text: "A fact your rules need is unknown.", mark: "fail" }]);
});

test("offline planner: the moves it builds are the pinned transactions", () => {
  const ctx = { account: ACCOUNT as `0x${string}`, mode: "testnet" as const, sentence: "s", grade: 1 as const, now: 1 };
  const up = planOffline({ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "0.5" }, ctx);
  assert.ok(up.ok);
  const deposit = up.plan.steps[0]!.requests[0]!;
  assert.equal(deposit.kind, "evm");
  if (deposit.kind === "evm") {
    assert.equal(deposit.to, "0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0");
    assert.equal(deposit.data, "0x439370b1");
    assert.equal(deposit.value, 500000000000000000n);
    assert.equal(deposit.chainId, 998);
  }
  const down = planOffline({ kind: "bridge", network: "elysium-testnet", toNetwork: "hyperevm-testnet", from: "HYPE", amount: "1" }, ctx);
  assert.ok(down.ok);
  const withdraw = down.plan.steps[0]!.requests[0]!;
  if (withdraw.kind === "evm") assert.deepEqual(decodeFunctionData({ abi: ARB_SYS_ABI, data: withdraw.data }).args, [ACCOUNT]);
  assert.ok(down.plan.steps[1]!.offlineOnly, "the claim needs the planner");
  const core = planOffline({ kind: "link", network: "hyperevm-testnet", toNetwork: "hypercore-testnet", from: "USDC", amount: "25" }, ctx);
  assert.ok(core.ok);
  const [approve, deposit2] = core.plan.steps[0]!.requests;
  if (approve?.kind === "evm" && deposit2?.kind === "evm") {
    assert.deepEqual(decodeFunctionData({ abi: ERC20_ABI, data: approve.data }).args, ["0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206", 25_000_000n]);
    assert.deepEqual(decodeFunctionData({ abi: CORE_DEPOSIT_WALLET_ABI, data: deposit2.data }).args, [25_000_000n, CORE_DEX.perps]);
  } else assert.fail("two EVM requests");
  const margin = planOffline({ kind: "margin", network: "hypercore-testnet", from: "USDC", amount: "5", params: { toPerp: false } }, ctx);
  assert.ok(margin.ok);
  const signed = margin.plan.steps[0]!.requests[0]!;
  assert.equal(signed.kind, "user-signed");
  if (signed.kind === "user-signed") {
    const built = signed.build(99801, 1_700_000_000_000);
    assert.equal(built.action.type, "usdClassTransfer");
    assert.equal(built.typedData.domain.chainId, 99801);
  }
  assert.equal(planOffline({ kind: "stake", network: "hyperevm-testnet", from: "HYPE", amount: "0.05" }, ctx).ok, false);
  assert.equal(planOffline({ kind: "swap", network: "elysium-testnet", from: "HYPE", to: "USDC", amount: "1" }, ctx).ok, false);
  assert.equal(planOffline({ kind: "bridge", network: "hyperevm-testnet", toNetwork: "elysium-testnet", from: "HYPE", amount: "abc" }, ctx).ok, false);
});

test("journey store: parsing drops junk, upserts stay capped and unique", () => {
  const record: JourneyRecord = { id: "j_1", source: "offline", routeId: "AB12", sentence: "bridge", createdAt: 1, layers: ["ridge", "summit"], legs: [] };
  assert.deepEqual(parseJourneys("not json"), []);
  assert.deepEqual(parseJourneys(JSON.stringify([record, { id: 3 }, { ...record, id: "j_2", layers: ["moon"] }])), [record]);
  const once = upsertJourney([record], { ...record, sentence: "again" });
  assert.equal(once.length, 1);
  assert.equal(once[0]!.sentence, "again");
  const leg = { stepId: "s1", network: "hyperevm-testnet" as const, reference: "0xabc", label: "deposit", at: 2 };
  assert.equal(addLeg(addLeg(record, leg), leg).legs.length, 1);
  assert.deepEqual(parseWatched(JSON.stringify([{ address: "0x12", label: "x", addedAt: 1 }])), []);
  const watched = upsertWatched([], { address: ACCOUNT, label: "me", addedAt: 1 });
  assert.equal(upsertWatched(watched, { address: ACCOUNT.toLowerCase(), label: "again", addedAt: 2 }).length, 1);
});

test("track queries and traces: hashes, intents, tickets that need a redeem", () => {
  assert.equal(parseTrackQuery(` ${DEPOSIT.l2} `).kind, "hash");
  assert.equal(parseTrackQuery("int_ec04e916f344763dcd6695da50442730").kind, "intent");
  assert.equal(parseTrackQuery(ACCOUNT).kind, "address");
  assert.equal(parseTrackQuery("j_AB12_lx9").kind, "journey");
  assert.equal(parseTrackQuery("hello").kind, "unknown");

  const receipt = { status: "success", blockNumber: 18_453_081n, transactionHash: DEPOSIT.l2 as Hex, logs: [], gasUsed: 0n, effectiveGasPrice: 0n };
  const ticket: Trace = { kind: "ticket", found: { network: "elysium-testnet", receipt: receipt as never, timestamp: 1_793_000_000 }, ticket: "needs-redeem", ticketTimeout: 1_793_600_000 };
  const view = traceRoute(ticket, 1_793_000_600);
  assert.equal(view.action, "redeem");
  assert.equal(view.ticketId, DEPOSIT.l2);
  assert.deepEqual(view.stages.map((stage) => stage.state), ["done", "done", "alert", "todo"]);
  assert.equal(view.steps.at(-1)!.state, "next");
  assert.ok(traceMoving(ticket, 1_793_000_600));

  const descent: Trace = { kind: "descent", found: { network: "elysium-testnet", receipt: receipt as never, timestamp: 1000 }, destination: ACCOUNT, value: 10n ** 18n, position: 5n, claimableAt: 2810, confirmBlocks: 10 };
  assert.equal(traceRoute(descent, 2000).steps[1]!.state, "waiting");
  assert.equal(traceRoute(descent, 3000).steps[1]!.state, "next");
  assert.equal(traceMoving(descent, 3000), false);
});
