import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  DEFAULT_RULE_BOOK,
  POLICY_RULES,
  RULE_BOOK_SCHEMA,
  RULE_BOOK_TEMPLATES,
  accountMatchesPattern,
  buildPolicyFacts,
  canonicalJson,
  decimalProductMicros,
  evaluatePolicy,
  formatUsdMicros,
  intentNotionalUsdMicros,
  loosenedRules,
  normalizeAssetEntry,
  ruleBookHash,
  scheduleState,
  usdMicros,
  validateRuleBook,
  erc20AssetId,
  effectiveUnpriced,
  tokenAmountUnits,
  UNPRICED_DEFAULT_MAX,
} from "../dist/index.js";
import { HYPE_ELY, OTHER, USER, USDC_ELY, accounts, sampleGraph } from "./fixtures.mjs";

const usd = (value) => usdMicros(value);
const own = [accounts.elysium, accounts.hyperevm, accounts.hypercore];

function asset(base, amount, usdValue, listed = true) {
  return { asset: base.asset, symbol: base.symbol, decimals: base.decimals, amount, listed, usdMicros: usdValue === null ? null : usd(usdValue) };
}

function swapStep(overrides = {}) {
  return {
    id: "s1",
    index: 0,
    kind: "swap",
    protocol: "nest",
    network: "elysium-testnet",
    root: true,
    inputs: [asset(HYPE_ELY, "1000000000000000000", "40")],
    outputs: [asset(USDC_ELY, "40000000", "40")],
    recipient: accounts.elysium,
    slippageBps: 50,
    signer: "wallet",
    ...overrides,
  };
}

function orderStep(trade = {}, overrides = {}) {
  return {
    id: "s1",
    index: 0,
    kind: "order",
    protocol: "hypercore-perps",
    network: "hypercore-testnet",
    root: true,
    inputs: [],
    outputs: [],
    recipient: accounts.hypercore,
    signer: "agent",
    agentAction: "order",
    trade: { market: "BTC", marketKind: "perp", side: "buy", sz: "0.01", notionalUsdMicros: usd("800.48"), leverage: 5, reduceOnly: false, isTrigger: false, isTwap: false, ...trade },
    ...overrides,
  };
}

const TRADING_FACTS = { openOrders: 3, openNotionalUsdMicros: usd("1000"), dayVolumeUsdMicros: usd("2000"), dayRealizedLossUsdMicros: usd("10") };

function facts(steps, overrides = {}) {
  return {
    stage: "prepare",
    origin: "user",
    stored: true,
    accounts: own,
    steps,
    usage: { dayUsdMicros: 0n, weekUsdMicros: 0n },
    trading: TRADING_FACTS,
    now: Date.parse("2026-10-29T12:00:00Z"),
    ...overrides,
  };
}

const book = (rules) => {
  const result = validateRuleBook({ schema: RULE_BOOK_SCHEMA, ...rules });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
};
const rulesOf = (evaluation) => evaluation.reasons.map((reason) => reason.rule);

/* ------------------------------------------------------------ documents */

test("validateRuleBook normalises and refuses malformed documents with paths", () => {
  const result = validateRuleBook({
    schema: RULE_BOOK_SCHEMA,
    trading: { markets: { allow: ["eth", "btc", "eth"] }, maxNotionalUsd: "1000.50" },
    recipients: { mode: "allowlist", allow: [`eip155:99801:${OTHER.toUpperCase().replace("0X", "0x")}`, `*:${OTHER}`] },
    assets: { allow: ["usdc@elysium-testnet", "group:hype"] },
    caps: { dailyUsd: "0100.00" },
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.value.trading.markets.allow, ["BTC", "ETH"]);
  assert.equal(result.value.trading.maxNotionalUsd, "1000.5");
  assert.equal(result.value.caps.dailyUsd, "100");
  assert.deepEqual(result.value.assets.allow, ["USDC@elysium-testnet", "group:HYPE"]);
  assert.deepEqual(result.value.recipients.allow, [`*:${OTHER}`, `eip155:99801:${OTHER}`]);

  const bad = validateRuleBook({
    schema: "elyia.rulebook/v2",
    mode: "yolo",
    trading: { maxLeverage: 2.5, maxNotionalUsd: 1000, markets: { allow: ["BTC; DROP"] } },
    agent: { actions: ["usdSend", "withdraw3"] },
    kinds: { allow: ["call"] },
    protocols: { deny: ["not-a-protocol"] },
    confirm: { when: ["always"] },
    extra: true,
  });
  assert.equal(bad.ok, false);
  const paths = bad.issues.map((issue) => issue.path);
  for (const path of ["schema", "mode", "trading.maxLeverage", "trading.maxNotionalUsd", "trading.markets.allow[0]", "agent.actions[0]", "agent.actions[1]", "kinds.allow[0]", "protocols.deny[0]", "confirm.when[0]", "extra"]) {
    assert.ok(paths.includes(path), `${path} in ${paths.join(", ")}`);
  }
  assert.equal(validateRuleBook({ schema: RULE_BOOK_SCHEMA, recipients: { mode: "allowlist" } }).ok, false, "an empty allowlist is refused");
  assert.equal(validateRuleBook({ schema: RULE_BOOK_SCHEMA, schedule: { timezone: "Mars/Olympus", windows: [{ days: ["mon"], from: "09:00", to: "17:00" }] } }).ok, false);
  assert.equal(validateRuleBook({ schema: RULE_BOOK_SCHEMA, schedule: { timezone: "UTC", windows: [{ days: ["mon"], from: "22:00", to: "02:00" }] } }).ok, false);
  assert.equal(validateRuleBook([]).ok, false);
});

test("rule book hash: canonical JSON + SHA-256, frozen for the default book", () => {
  const hash = ruleBookHash(DEFAULT_RULE_BOOK);
  assert.equal(hash, `sha256:${createHash("sha256").update(canonicalJson(DEFAULT_RULE_BOOK)).digest("hex")}`);
  assert.equal(hash, "sha256:005b17f6682a8670a1f22453bba6c4a6fd9b92d312c9c20f28470c1a6f5a5380", "changing the default book changes every client pin: bump this deliberately (2026-11-01: unpriced testnet cap)");
  const reordered = validateRuleBook({ ...DEFAULT_RULE_BOOK, confirm: { when: ["unlisted-asset", "external-recipient"], leverageAbove: 10, aboveUsd: "2500" } });
  assert.equal(ruleBookHash(reordered.value), hash, "key and list order never change the hash");
  for (const template of Object.values(RULE_BOOK_TEMPLATES)) assert.equal(validateRuleBook(template).ok, true);
});

test("loosenedRules flags every widening and nothing else", () => {
  const strict = book({ trading: { maxLeverage: 5, maxNotionalUsd: "500", reduceOnly: true, markets: { allow: ["BTC"] } }, recipients: { mode: "own" }, caps: { dailyUsd: "100" }, agent: { modes: ["propose"] } });
  assert.deepEqual(loosenedRules(strict, strict), []);
  const looser = book({ trading: { maxLeverage: 10, maxNotionalUsd: "500", markets: { allow: ["BTC", "ETH"] } }, recipients: { mode: "any" }, agent: { modes: ["keeper", "propose"] } });
  assert.deepEqual(loosenedRules(strict, looser).sort(), ["agent.modes", "caps.dailyUsd", "recipients.mode", "trading.markets.allow", "trading.maxLeverage", "trading.reduceOnly"].sort());
  assert.deepEqual(loosenedRules(looser, strict).filter((path) => path !== "trading.reduceOnly"), [], "tightening is not loosening");
  assert.deepEqual(loosenedRules(book({}), book({ mode: "paused" })), []);
  assert.deepEqual(loosenedRules(book({ mode: "paused" }), book({})), ["mode"]);
});

test("patterns and entries", () => {
  assert.equal(accountMatchesPattern(`hypercore:testnet:${USER}`, `*:${USER.toUpperCase().replace("0X", "0x")}`), true);
  assert.equal(accountMatchesPattern(`eip155:998:${USER}`, `eip155:99801:${USER}`), false);
  assert.equal(normalizeAssetEntry("kHYPE@hyperevm-mainnet"), "kHYPE@hyperevm-mainnet");
  assert.equal(normalizeAssetEntry("DOGE"), null);
  assert.equal(formatUsdMicros(1_234_567n), "1.24", "rounded up (conservative)");
  assert.equal(decimalProductMicros("0.01", "80048"), usd("800.48"));
});

/* ----------------------------------------------------------- evaluation */

test("the default book allows a small testnet swap and a 5x BTC long", () => {
  const swap = evaluatePolicy(DEFAULT_RULE_BOOK, facts([swapStep()]));
  assert.equal(swap.decision, "allow", JSON.stringify(swap.reasons));
  assert.equal(swap.notionalUsdMicros, usd("40"));
  const long = evaluatePolicy(DEFAULT_RULE_BOOK, facts([orderStep()]));
  assert.equal(long.decision, "allow", JSON.stringify(long.reasons));
  assert.ok(long.rules.some((rule) => rule.rule === "trading.maxLeverage" && rule.status === "pass"));
});

test("fail closed: an unpriced input under a USD cap denies", () => {
  const evaluation = evaluatePolicy(book({ caps: { perIntentUsd: "1000" } }), facts([swapStep({ inputs: [asset(HYPE_ELY, "1000", null)] })]));
  assert.equal(evaluation.decision, "deny");
  assert.deepEqual(rulesOf(evaluation), ["facts.unavailable"]);
  assert.equal(evaluation.code, "POLICY_FACTS_UNAVAILABLE");
  assert.equal(evaluation.notionalUsdMicros, null);
});

test("fail closed: unknown open orders, volume, losses, leverage, notional or usage deny", () => {
  const cases = [
    [{ trading: { maxOpenOrders: 10 } }, facts([orderStep()], { trading: { ...TRADING_FACTS, openOrders: null } })],
    [{ trading: { maxOpenOrders: 10 } }, facts([orderStep()], { trading: undefined })],
    [{ trading: { dailyVolumeUsd: "5000" } }, facts([orderStep()], { trading: { ...TRADING_FACTS, dayVolumeUsdMicros: null } })],
    [{ trading: { dailyLossUsd: "100" } }, facts([orderStep()], { trading: { ...TRADING_FACTS, dayRealizedLossUsdMicros: null } })],
    [{ trading: { maxLeverage: 10 } }, facts([orderStep({ leverage: null })])],
    [{ trading: { maxNotionalUsd: "1000" } }, facts([orderStep({ notionalUsdMicros: null })])],
    [{ trading: { maxOpenNotionalUsd: "5000" } }, facts([orderStep()], { trading: { ...TRADING_FACTS, openNotionalUsdMicros: null } })],
    [{ caps: { dailyUsd: "1000" } }, facts([swapStep()], { usage: undefined })],
    [{ limits: { maxFeeUsd: "1" } }, facts([swapStep()], { feesUsdMicros: null })],
    [{ confirm: { leverageAbove: 3 } }, facts([orderStep({ leverage: null })])],
    [{ confirm: { aboveUsd: "100" } }, facts([swapStep({ inputs: [asset(HYPE_ELY, "1", null)] })])],
  ];
  for (const [rules, input] of cases) {
    const evaluation = evaluatePolicy(book(rules), input);
    assert.equal(evaluation.decision, "deny", JSON.stringify(rules));
    assert.ok(rulesOf(evaluation).includes("facts.unavailable"), JSON.stringify(rules));
  }
});

test("trading rules: one pass and one fail each", () => {
  const deny = (rules, steps, extra) => rulesOf(evaluatePolicy(book(rules), facts(steps, extra)));
  const allow = (rules, steps, extra) => evaluatePolicy(book(rules), facts(steps, extra)).decision;
  assert.equal(allow({ trading: { markets: { allow: ["BTC", "ETH"] } } }, [orderStep()]), "allow");
  assert.deepEqual(deny({ trading: { markets: { allow: ["ETH"] } } }, [orderStep()]), ["trading.markets.allow"]);
  assert.deepEqual(deny({ trading: { markets: { deny: ["btc"] } } }, [orderStep()]), ["trading.markets.deny"]);
  assert.equal(allow({ trading: { markets: { allow: ["HYPE"] } } }, [orderStep({ market: "@1035", displayName: "HYPE/USDC", marketKind: "spot", leverage: 1 })]), "allow", "an asset entry covers its spot pair");
  assert.equal(allow({ trading: { maxNotionalUsd: "1000" } }, [orderStep()]), "allow");
  assert.deepEqual(deny({ trading: { maxNotionalUsd: "500" } }, [orderStep()]), ["trading.maxNotionalUsd"]);
  assert.deepEqual(deny({ trading: { maxOpenNotionalUsd: "1500" } }, [orderStep()]), ["trading.maxOpenNotionalUsd"]);
  assert.equal(allow({ trading: { maxLeverage: 5 } }, [orderStep()]), "allow");
  assert.deepEqual(deny({ trading: { maxLeverage: 3 } }, [orderStep()]), ["trading.maxLeverage"]);
  assert.deepEqual(deny({ trading: { maxLeverage: 3 } }, [orderStep({ sz: "0", notionalUsdMicros: 0n, leverage: 10 }, { kind: "leverage", agentAction: "updateLeverage" })]), ["trading.maxLeverage"], "setting leverage is checked too");
  assert.deepEqual(deny({ trading: { reduceOnly: true } }, [orderStep()]), ["trading.reduceOnly"]);
  assert.equal(allow({ trading: { reduceOnly: true } }, [orderStep({ reduceOnly: true, side: "sell" })]), "allow");
  assert.equal(allow({ trading: { maxOpenOrders: 4 } }, [orderStep()]), "allow");
  assert.deepEqual(deny({ trading: { maxOpenOrders: 3 } }, [orderStep()]), ["trading.maxOpenOrders"]);
  assert.deepEqual(deny({ trading: { dailyVolumeUsd: "2500" } }, [orderStep()]), ["trading.dailyVolumeUsd"]);
  assert.equal(allow({ trading: { dailyVolumeUsd: "3000" } }, [orderStep()]), "allow");
  assert.deepEqual(deny({ trading: { dailyLossUsd: "10" } }, [orderStep()]), ["trading.dailyLossUsd"], "the loss stop is reached at the cap");
  assert.equal(allow({ trading: { dailyLossUsd: "10" } }, [orderStep({ reduceOnly: true, side: "sell" })]), "allow", "closing still works after the loss stop");
  assert.deepEqual(deny({ trading: { triggers: false } }, [orderStep({ isTrigger: true, reduceOnly: true })]), ["trading.triggers"]);
  assert.deepEqual(deny({ trading: { twap: false } }, [orderStep({ isTwap: true }, { kind: "twap", agentAction: "twapOrder" })]), ["trading.twap"]);
  assert.deepEqual(deny({ trading: { maxSlippageBps: 50 } }, [orderStep({ slippageBps: 120 })]), ["trading.maxSlippageBps"]);
  assert.equal(allow({ trading: { maxSlippageBps: 150 } }, [orderStep({ slippageBps: 120 })]), "allow");
});

test("reduce-only orders are exempt from size limits so positions can always be closed", () => {
  const huge = orderStep({ reduceOnly: true, side: "sell", notionalUsdMicros: usd("1000000"), leverage: null });
  const strict = book({ trading: { maxNotionalUsd: "10", maxLeverage: 1, maxOpenNotionalUsd: "10", dailyVolumeUsd: "10" }, caps: { perIntentUsd: "10", perStepUsd: "10" } });
  const evaluation = evaluatePolicy(strict, facts([huge], { trading: { openOrders: null, openNotionalUsdMicros: null, dayVolumeUsdMicros: null, dayRealizedLossUsdMicros: null } }));
  assert.equal(evaluation.decision, "allow", JSON.stringify(evaluation.reasons));
  assert.equal(intentNotionalUsdMicros([huge]).value, 0n);
});

test("the kill switch blocks new risk but lets you de-risk", () => {
  const paused = book({ mode: "paused" });
  assert.deepEqual(rulesOf(evaluatePolicy(paused, facts([orderStep()]))), ["mode.paused"]);
  assert.equal(evaluatePolicy(paused, facts([orderStep()])).code, "POLICY_PAUSED");
  assert.deepEqual(rulesOf(evaluatePolicy(paused, facts([swapStep()]))), ["mode.paused"]);
  assert.equal(evaluatePolicy(paused, facts([orderStep({ reduceOnly: true, side: "sell" })])).decision, "allow");
  assert.equal(evaluatePolicy(paused, facts([orderStep({}, { kind: "cancel", agentAction: "cancel", trade: undefined })])).decision, "allow");
  assert.deepEqual(rulesOf(evaluatePolicy(book({ mode: "dry-run" }), facts([swapStep()]))), ["mode.dryRun"]);
  assert.equal(evaluatePolicy(book({ mode: "dry-run" }), facts([swapStep()], { stage: "plan", stored: false })).decision, "allow");
});

test("agent floor: agents only sign trading L1 actions, the Keeper fewer, whatever the book says", () => {
  const permissive = book({ agent: { actions: ["order", "updateIsolatedMargin"], modes: ["browser", "keeper", "propose"] } });
  assert.deepEqual(rulesOf(evaluatePolicy(permissive, facts([orderStep({}, { agentAction: "usdSend" })]))), ["agent.actions"], "a withdrawal-type action is never agent-signable");
  assert.deepEqual(rulesOf(evaluatePolicy(permissive, facts([orderStep({}, { agentAction: undefined })]))), ["agent.actions"], "unknown action type fails closed");
  assert.deepEqual(rulesOf(evaluatePolicy(permissive, facts([orderStep({}, { kind: "margin", agentAction: "updateIsolatedMargin", trade: undefined, signer: "keeper" })]))), ["agent.actions"], "the Keeper never moves margin");
  assert.equal(evaluatePolicy(permissive, facts([orderStep({}, { kind: "margin", agentAction: "updateIsolatedMargin", trade: undefined })])).decision, "allow");
  assert.deepEqual(rulesOf(evaluatePolicy(book({ agent: { actions: ["cancel"] } }), facts([orderStep()]))), ["agent.actions"]);
});

test("execution modes: Keeper is opt-in; automations use enabled modes only", () => {
  assert.deepEqual(rulesOf(evaluatePolicy(DEFAULT_RULE_BOOK, facts([orderStep({}, { signer: "keeper" })]))), ["agent.modes"], "Keeper is off by default");
  assert.equal(evaluatePolicy(book({ agent: { modes: ["keeper"] } }), facts([orderStep({}, { signer: "keeper" })], { origin: "automation" })).decision, "allow");
  assert.deepEqual(rulesOf(evaluatePolicy(book({ agent: { modes: ["propose"] } }), facts([orderStep()], { origin: "automation" }))), ["agent.modes"]);
  assert.equal(evaluatePolicy(book({ agent: { modes: ["propose"] } }), facts([orderStep()], { origin: "user" })).decision, "allow", "a person trading with their own browser key");
});

test("recipients: own means the same 0x address on any layer; deny always wins", () => {
  const ownBook = book({ recipients: { mode: "own" } });
  assert.equal(evaluatePolicy(ownBook, facts([swapStep({ recipient: `hypercore:testnet:${USER}` })])).decision, "allow");
  assert.deepEqual(rulesOf(evaluatePolicy(ownBook, facts([swapStep({ recipient: `eip155:99801:${OTHER}` })]))), ["recipients.own"]);
  const listed = book({ recipients: { mode: "allowlist", allow: [`*:${OTHER}`] } });
  assert.equal(evaluatePolicy(listed, facts([swapStep({ recipient: `eip155:998:${OTHER}` })])).decision, "allow");
  assert.deepEqual(rulesOf(evaluatePolicy(listed, facts([swapStep({ recipient: "eip155:998:0x0000000000000000000000000000000000000001" })]))), ["recipients.allowlist"]);
  assert.deepEqual(rulesOf(evaluatePolicy(book({ recipients: { mode: "any", deny: [`*:${OTHER}`] } }), facts([swapStep({ recipient: `eip155:998:${OTHER}` })]))), ["recipients.deny"]);
});

test("caps, limits and lanes", () => {
  const deny = (rules, steps, extra) => rulesOf(evaluatePolicy(book(rules), facts(steps, extra)));
  assert.deepEqual(deny({ caps: { perIntentUsd: "30" } }, [swapStep()]), ["caps.perIntentUsd"]);
  assert.deepEqual(deny({ caps: { perStepUsd: "30" } }, [swapStep()]), ["caps.perStepUsd"]);
  assert.deepEqual(deny({ caps: { dailyUsd: "100" } }, [swapStep()], { usage: { dayUsdMicros: usd("70"), weekUsdMicros: 0n } }), ["caps.dailyUsd"]);
  assert.deepEqual(deny({ caps: { weeklyUsd: "100" } }, [swapStep()], { usage: { dayUsdMicros: 0n, weekUsdMicros: usd("61") } }), ["caps.weeklyUsd"]);
  assert.equal(evaluatePolicy(book({ caps: { dailyUsd: "100" } }), facts([swapStep()], { usage: { dayUsdMicros: usd("60"), weekUsdMicros: 0n } })).decision, "allow");
  assert.equal(evaluatePolicy(book({ caps: { dailyUsd: "100" } }), facts([swapStep()], { usage: { dayUsdMicros: usd("70"), weekUsdMicros: 0n } })).code, "POLICY_LIMIT_REACHED");
  assert.deepEqual(deny({ limits: { maxSlippageBps: 30 } }, [swapStep()]), ["limits.maxSlippageBps"]);
  assert.deepEqual(deny({ limits: { maxSteps: 1 } }, [swapStep(), swapStep({ id: "s2", index: 1 })]), ["limits.maxSteps"]);
  assert.deepEqual(deny({ limits: { maxFeeUsd: "0.10" } }, [swapStep()], { feesUsdMicros: usd("0.50") }), ["limits.maxFeeUsd"]);
  const bridge = swapStep({ kind: "bridge", network: "elysium-testnet", destinationNetwork: "hyperevm-testnet", estimatedSeconds: 475200, protocol: "elysium-canonical-bridge" });
  assert.deepEqual(deny({ limits: { maxSeconds: 3600 } }, [bridge]), ["limits.maxSeconds"]);
  assert.deepEqual(deny({ limits: { maxSeconds: 3600 } }, [{ ...bridge, estimatedSeconds: undefined }]), ["facts.unavailable"]);
  assert.deepEqual(deny({ networks: { environments: ["mainnet"] } }, [swapStep()]), ["networks.environments"]);
  assert.deepEqual(deny({ networks: { allow: ["hyperevm-testnet"] } }, [swapStep()]), ["networks.allow"]);
  assert.deepEqual(deny({ kinds: { allow: ["order"] } }, [swapStep()]), ["kinds.allow"]);
  assert.deepEqual(deny({ protocols: { deny: ["nest"] } }, [swapStep()]), ["protocols.deny"]);
  assert.deepEqual(deny({ protocols: { allow: ["uniswap"] } }, [swapStep()]), ["protocols.allow"]);
  assert.deepEqual(deny({ assets: { allow: ["USDC"] } }, [swapStep()]), ["assets.allow"], "HYPE input not allowed");
  assert.equal(evaluatePolicy(book({ assets: { allow: ["group:HYPE", "USDC@elysium-testnet"] } }), facts([swapStep()])).decision, "allow");
  assert.deepEqual(deny({ assets: { unlisted: "deny" } }, [swapStep({ outputs: [asset(USDC_ELY, "1", "1", false)] })]), ["assets.unlisted"]);
});

test("confirmations: the worst outcome wins and every reason is listed", () => {
  const confirm = book({ confirm: { aboveUsd: "500", leverageAbove: 3, when: ["external-recipient", "agent-proposal", "cross-network", "unlisted-asset"] } });
  const evaluation = evaluatePolicy(confirm, facts([orderStep()], { origin: "automation" }));
  assert.equal(evaluation.decision, "confirm");
  assert.deepEqual(rulesOf(evaluation).sort(), ["confirm.agentProposal", "confirm.aboveUsd", "confirm.leverageAbove"].sort());
  assert.equal(evaluation.code, "POLICY_CONFIRMATION_REQUIRED");
  const external = evaluatePolicy(confirm, facts([swapStep({ recipient: `eip155:99801:${OTHER}`, outputs: [asset(USDC_ELY, "1", "1", false)] })]));
  assert.deepEqual(rulesOf(external).sort(), ["confirm.externalRecipient", "confirm.unlistedAsset"]);
  const mixed = evaluatePolicy(book({ ...confirm, trading: { maxLeverage: 2 } }), facts([orderStep()]));
  assert.equal(mixed.decision, "deny", "deny beats confirm");
  assert.ok(rulesOf(mixed).includes("confirm.leverageAbove") && rulesOf(mixed).includes("trading.maxLeverage"));
  for (const reason of mixed.reasons) assert.ok(POLICY_RULES[reason.rule], reason.rule);
});

test("schedule: open and closed windows in a time zone, DST handled by Intl, closed only blocks new risk", () => {
  const hours = { timezone: "Europe/Berlin", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "17:30" }] };
  // Thursday 2026-10-29 12:00 UTC = 13:00 in Berlin (CET, after the DST change on 25 October).
  assert.equal(scheduleState(hours, Date.parse("2026-10-29T12:00:00Z")).open, true);
  const evening = scheduleState(hours, Date.parse("2026-10-29T17:00:00Z"));
  assert.equal(evening.open, false);
  assert.equal(evening.nextChange, "2026-10-30T08:00:00.000Z");
  assert.ok(evening.retryAfterSeconds > 0);
  // 2026-10-23 is still CEST (UTC+2): 08:00 UTC is 10:00 local.
  assert.equal(scheduleState(hours, Date.parse("2026-10-23T07:30:00Z")).open, true);
  const closedBook = book({ schedule: hours });
  const night = facts([orderStep()], { now: Date.parse("2026-10-29T22:00:00Z") });
  assert.deepEqual(rulesOf(evaluatePolicy(closedBook, night)), ["schedule.window"]);
  assert.equal(evaluatePolicy(closedBook, night).code, "POLICY_SCHEDULE_CLOSED");
  assert.equal(evaluatePolicy(closedBook, { ...night, steps: [orderStep({ reduceOnly: true, side: "sell" })] }).decision, "allow");
  assert.equal(scheduleState({ timezone: "Not/AZone", windows: hours.windows }).error, true, "an unreadable zone fails closed");
});

/* --------------------------------------------------------- facts builder */

test("buildPolicyFacts prices with the caller's oracle and fails closed on unknowns", () => {
  const graph = sampleGraph();
  const prices = new Map([[HYPE_ELY.asset.replace("99801", "998"), usd("40")]]);
  const built = buildPolicyFacts(graph, { stage: "prepare", priceUsdMicros: (id) => prices.get(id) ?? null, trading: TRADING_FACTS, usage: { dayUsdMicros: 0n, weekUsdMicros: 0n } });
  assert.equal(built.origin, "user");
  assert.equal(built.steps[0].inputs[0].usdMicros, usd("800"), "20 HYPE at $40");
  assert.equal(built.steps[0].destinationNetwork, "elysium-testnet");
  assert.equal(built.steps[0].signer, "wallet");
  assert.equal(built.steps[1].agentAction, "updateLeverage");
  assert.equal(built.steps[2].agentAction, "order");
  assert.equal(built.steps[2].trade.leverage, 5, "leverage comes from the intent's own leverage step");
  assert.equal(built.steps[2].trade.notionalUsdMicros, usd("800.48"));
  assert.equal(evaluatePolicy(DEFAULT_RULE_BOOK, built).decision, "allow", JSON.stringify(evaluatePolicy(DEFAULT_RULE_BOOK, built).reasons));
  const blind = buildPolicyFacts(graph, { stage: "prepare", priceUsdMicros: () => null, trading: TRADING_FACTS, usage: { dayUsdMicros: 0n, weekUsdMicros: 0n } });
  const refused = evaluatePolicy(DEFAULT_RULE_BOOK, blind);
  assert.equal(refused.decision, "deny");
  assert.ok(rulesOf(refused).includes("facts.unavailable"));
  const automation = buildPolicyFacts({ ...graph, source: "automation" }, { stage: "sign", priceUsdMicros: (id) => prices.get(id) ?? null, trading: TRADING_FACTS, usage: { dayUsdMicros: 0n, weekUsdMicros: 0n } });
  assert.equal(automation.origin, "automation");
});

/* ------------------------------------------- unpriced tokens (2026-11-01) */

const KALOS = { asset: erc20AssetId("elysium-testnet", "0x8a2201953AF29e8BE7700bcB53dA3ce5caD18726"), symbol: "KALOS", decimals: 18 };
const LAUNCH = { asset: erc20AssetId("elysium-testnet", "0x8aa6F0835805Ca99f370634415d502ec5c603Baf"), symbol: "SIG", decimals: 18 };
const MAINNET_TOKEN = { asset: erc20AssetId("hyperevm-mainnet", "0x1111111111111111111111111111111111111111"), symbol: "ODD", decimals: 18 };
const HYPE_MAIN = { asset: "eip155:999/slip44:2457", symbol: "HYPE", decimals: 18 };
const unpricedFact = (base, whole) => ({ ...asset(base, (BigInt(whole) * 10n ** 18n).toString(), null, base !== LAUNCH && base !== MAINNET_TOKEN), noReference: true });

test("unpriced rules: default book caps test tokens at 1000, validation and normalisation", () => {
  assert.equal(UNPRICED_DEFAULT_MAX, "1000");
  assert.deepEqual(DEFAULT_RULE_BOOK.unpriced, { testnet: "cap", defaultMax: "1000" });
  assert.deepEqual(effectiveUnpriced(book()), { testnet: "cap", defaultMax: "1000", tokens: [] }, "absent section: the documented default");
  const ok = validateRuleBook({ schema: RULE_BOOK_SCHEMA, unpriced: { testnet: "cap", defaultMax: "250.500", tokens: [{ asset: "stKALOS", max: "50" }, { asset: "kalos", max: "5000" }, { asset: LAUNCH.asset, max: "100000" }] } });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  assert.equal(ok.value.unpriced.defaultMax, "250.5");
  assert.deepEqual(ok.value.unpriced.tokens.map((cap) => cap.asset), ["KALOS", LAUNCH.asset.toLowerCase(), "stKALOS"], "normalised and sorted");
  for (const bad of [
    { testnet: "maybe" },
    { defaultMax: 1000 },
    { defaultMax: "-1" },
    { tokens: [{ asset: "group:HYPE", max: "1" }] },
    { tokens: [{ asset: "NOPE", max: "1" }] },
    { tokens: [{ asset: "KALOS" }] },
    { tokens: [{ asset: "KALOS", max: "1" }, { asset: "kalos", max: "2" }] },
    { tokens: [{ asset: "KALOS", max: "1", extra: true }] },
    { mainnet: "cap" },
  ]) assert.equal(validateRuleBook({ schema: RULE_BOOK_SCHEMA, unpriced: bad }).ok, false, JSON.stringify(bad));
  assert.equal(RULE_BOOK_TEMPLATES.careful.unpriced.testnet, "deny");
  assert.equal(tokenAmountUnits("1.5", 6), 1_500_000n);
  assert.equal(tokenAmountUnits("0.1234567", 6), 123_456n, "extra digits are cut: the cap only shrinks");
});

test("unpriced rules: loosening is flagged", () => {
  const strict = book({ unpriced: { testnet: "deny", defaultMax: "10", tokens: [{ asset: "KALOS", max: "5" }] } });
  assert.deepEqual(loosenedRules(strict, strict), []);
  assert.deepEqual(loosenedRules(strict, book({ unpriced: { testnet: "cap", defaultMax: "10", tokens: [{ asset: "KALOS", max: "5" }] } })), ["unpriced.testnet"]);
  assert.deepEqual(loosenedRules(strict, book({ unpriced: { testnet: "deny", defaultMax: "11", tokens: [{ asset: "KALOS", max: "5" }] } })), ["unpriced.defaultMax"]);
  assert.deepEqual(loosenedRules(strict, book({ unpriced: { testnet: "deny", defaultMax: "10", tokens: [{ asset: "KALOS", max: "6" }] } })), ["unpriced.tokens"]);
  assert.deepEqual(loosenedRules(strict, book({ unpriced: { testnet: "deny", defaultMax: "10" } })), ["unpriced.tokens"], "dropping a per-token cap falls back to a larger default");
  assert.deepEqual(loosenedRules(book({ unpriced: { defaultMax: "10" } }), book()), ["unpriced.defaultMax"], "absent = the 1000-token default");
  assert.deepEqual(loosenedRules(book(), book({ unpriced: { testnet: "deny", defaultMax: "1" } })), [], "tightening is never flagged");
});

test("unpriced on testnet: allowed within the cap, valued at $0, with a note", () => {
  const evaluation = evaluatePolicy(DEFAULT_RULE_BOOK, facts([swapStep({ inputs: [unpricedFact(KALOS, 10)], outputs: [asset(USDC_ELY, "1000000", "1")] })]));
  assert.equal(evaluation.decision, "allow", JSON.stringify(evaluation.reasons));
  assert.equal(evaluation.notionalUsdMicros, 0n);
  assert.equal(evaluation.unpriced.length, 1);
  assert.deepEqual({ ...evaluation.unpriced[0], message: undefined }, { asset: KALOS.asset, symbol: "KALOS", network: "elysium-testnet", role: "input", amount: (10n * 10n ** 18n).toString(), decimals: 18, cap: "1000", status: "allowed", message: undefined, path: "steps[0].inputs[0]" });
  assert.match(evaluation.unpriced[0].message, /no reference price: testnet only, capped at 1000 KALOS/u);
  assert.ok(evaluation.rules.some((rule) => rule.rule === "assets.unpriced" && rule.status === "pass"));
  // A launch-token buy: HYPE in (priced), the unpriced token out (noted, not capped).
  const buy = evaluatePolicy(DEFAULT_RULE_BOOK, facts([swapStep({ outputs: [unpricedFact(LAUNCH, 5_000_000)] })]));
  assert.equal(buy.decision, "confirm", "the launch token is unverified: the default book asks to confirm");
  assert.deepEqual(rulesOf(buy), ["confirm.unlistedAsset"]);
  assert.equal(buy.unpriced[0].role, "output");
  assert.equal(buy.unpriced[0].status, "allowed");
  assert.equal(buy.notionalUsdMicros, usd("40"));
});

test("unpriced on testnet: over the cap, per-token caps and deny mode refuse", () => {
  const over = evaluatePolicy(DEFAULT_RULE_BOOK, facts([swapStep({ inputs: [unpricedFact(KALOS, 600)] }), swapStep({ id: "s2", index: 1, inputs: [unpricedFact(KALOS, 600)] })]));
  assert.equal(over.decision, "deny");
  assert.equal(rulesOf(over)[0], "assets.unpriced", "summed per intent: 1200 > 1000");
  assert.ok(rulesOf(over).every((rule) => rule === "assets.unpriced" || rule === "facts.unavailable"), "a refused amount stays unpriced for the USD rules too");
  assert.equal(over.code, "POLICY_DENIED");
  assert.match(over.reasons[0].message, /1200 KALOS is above the 1000 KALOS cap/u);
  const own = book({ unpriced: { tokens: [{ asset: "KALOS", max: "5000" }, { asset: "KALOS@elysium-testnet", max: "2000" }] } });
  assert.equal(evaluatePolicy(own, facts([swapStep({ inputs: [unpricedFact(KALOS, 1500)] })])).decision, "allow", "the smallest matching per-token cap (2000) wins");
  assert.equal(evaluatePolicy(own, facts([swapStep({ inputs: [unpricedFact(KALOS, 2500)] })])).decision, "deny");
  const refusing = evaluatePolicy(book({ unpriced: { testnet: "deny" } }), facts([swapStep({ inputs: [unpricedFact(KALOS, 1)] })]));
  assert.equal(refusing.decision, "deny");
  assert.equal(refusing.reasons[0].rule, "assets.unpriced");
  assert.equal(evaluatePolicy(RULE_BOOK_TEMPLATES.careful, facts([swapStep({ outputs: [unpricedFact(KALOS, 1)] })])).unpriced[0].status, "refused");
});

test("unpriced on mainnet: always refused, whatever the book says", () => {
  const loose = book({ networks: { environments: ["mainnet", "testnet"] }, unpriced: { testnet: "cap", defaultMax: "1000000000", tokens: [{ asset: MAINNET_TOKEN.asset, max: "1000000000" }] } });
  const mainnetSwap = (overrides) => swapStep({ network: "hyperevm-mainnet", inputs: [asset(HYPE_MAIN, "1000000000000000000", "40")], outputs: [unpricedFact(MAINNET_TOKEN, 1)], recipient: "eip155:999:" + USER, ...overrides });
  const buy = evaluatePolicy(loose, facts([mainnetSwap()], { accounts: [...own, "eip155:999:" + USER] }));
  assert.equal(buy.decision, "deny");
  assert.deepEqual(rulesOf(buy), ["assets.unpriced"]);
  assert.match(buy.reasons[0].message, /on mainnet Elyia never routes into a token it cannot value/u);
  const sell = evaluatePolicy(loose, facts([mainnetSwap({ inputs: [unpricedFact(MAINNET_TOKEN, 1)], outputs: [asset(HYPE_MAIN, "1", "0.01")] })], { accounts: [...own, "eip155:999:" + USER] }));
  assert.equal(sell.decision, "deny");
  assert.ok(rulesOf(sell).includes("assets.unpriced"));
  assert.ok(rulesOf(sell).includes("facts.unavailable") || sell.unpriced[0].status === "refused");
});

test("a price that could not be read is never treated as unpriced (oracle outage fails closed)", () => {
  const outage = evaluatePolicy(DEFAULT_RULE_BOOK, facts([swapStep({ inputs: [asset(HYPE_ELY, "1000000000000000000", null)] })]));
  assert.equal(outage.decision, "deny");
  assert.deepEqual(rulesOf(outage), ["facts.unavailable"]);
  assert.deepEqual(outage.unpriced, []);
  const graph = sampleGraph();
  const marked = buildPolicyFacts(graph, { stage: "plan", priceUsdMicros: () => null, hasReferencePrice: () => false });
  assert.equal(marked.steps[0].inputs[0].noReference, true);
  const unmarked = buildPolicyFacts(graph, { stage: "plan", priceUsdMicros: () => null, hasReferencePrice: () => true });
  assert.equal(unmarked.steps[0].inputs[0].noReference, undefined);
  assert.equal(buildPolicyFacts(graph, { stage: "plan", priceUsdMicros: () => null }).steps[0].inputs[0].noReference, undefined, "no source: fail closed");
});
