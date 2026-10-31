/**
 * The reader: sentence -> clauses -> frames -> goals, questions, chips.
 *
 *   control words ("cancel", "iptal") -> secret screen -> locale -> lexer
 *   -> unknown words / negations stop the reading (nothing is guessed)
 *   -> rule split (schedule anywhere, condition prefix or suffix, Turkish
 *      conditional verbs) -> clause split (then / and / ve / sonra, commas,
 *      Turkish -ıp converbs, a second verb) -> one frame per clause
 *   -> questions (max two per turn), assumptions, warnings, canonical sentence.
 */
import type { GoalItem, LanguageGoal, NetworkEnvironment, Rule, ValueGoal } from "@elyia/core";
import { validateLanguageGoals } from "@elyia/core";
import { LANGUAGE_LIMITS, LANGUAGE_SPEC, type LanguageAnswer, type LanguageChip, type LanguageStatus, type ParseIntentResponse } from "@elyia/core/api/language";
import { canonicalSentence } from "./canonical.js";
import { chipsOf } from "./chips.js";
import { Clarifier, t } from "./clarify.js";
import { marketsFor, staticMarkets, tokenOn, type MarketFact } from "./entities.js";
import { Bag, networkKey, type FrameCtx, type Previous, type ReaderFacts } from "./frames/common.js";
import { readQueryClause } from "./frames/query.js";
import { alertItem, buildRule, limitTokens, readCondition, ruleGoal, scheduleOf, type LimitTokens } from "./frames/rule.js";
import { isPerpSignal, readTradeClause, type TradeInput } from "./frames/trade.js";
import { readValueClause, type FrameResult } from "./frames/value.js";
import { detectLocale, Lexer } from "./lexer.js";
import type { Locale } from "./numbers.js";
import { fold } from "./text.js";
import type { Tok, Verb } from "./types.js";
import { venueById } from "./venues.js";

export interface ReadOptions {
  readonly locale?: Locale;
  readonly environment?: NetworkEnvironment;
  readonly answers?: readonly LanguageAnswer[];
  readonly facts?: Partial<ReaderFacts>;
  /** .ely name -> resolved address; `!name` marks a name known to be unregistered. */
  readonly resolvedNames?: ReadonlyMap<string, string>;
}

export interface Reading extends Omit<ParseIntentResponse, "thread"> {
  /** Answers this turn actually used (the caller signs them into the thread). */
  readonly usedAnswers: readonly LanguageAnswer[];
  /** `.ely` names the text mentions (the caller may resolve them and read again). */
  readonly names: readonly string[];
  /** For the engine's text path: the prompts of open questions. */
  readonly clarify?: readonly string[];
  /** For the engine's text path: why nothing can be planned. */
  readonly unsupported?: string;
}

const CONTROL = /^\s*(?:cancel|stop|never ?mind|forget it|abort|iptal|vazgeç|vazgec|boşver|bosver|dur|unut gitsin)\s*[.!]?\s*$/iu;
const PRIVATE_KEY = /(?:^|[^0-9a-f])(?:0x)?[0-9a-f]{64}(?:[^0-9a-f]|$)/iu;
const SEED_WORDS = /\b(?:seed phrase|mnemonic|private key|secret key|recovery phrase|gizli anahtar|kurtarma ifadesi|tohum)\b/iu;

const EXAMPLES: Readonly<Record<Locale, readonly string[]>> = Object.freeze({
  en: ["long ETH 5x with 200 USDC, stop at 3% below entry", "bridge 20 HYPE to Elysium and swap half to USDC on kalos", "every day buy 10 HYPE spot, 30 times", "alert me when ETH price above 4000", "what is the HYPE price?"],
  tr: ["ETH'de 5x long aç 200 USDC ile", "20 HYPE'ı Elysium'a köprüle ve yarısını USDC'ye çevir", "her gün 10 HYPE spot al, 30 kez", "ETH 4000'i geçerse haber ver", "HYPE fiyatı ne?"],
});

function defaultFacts(facts: Partial<ReaderFacts> | undefined): ReaderFacts {
  return { markets: facts?.markets ?? staticMarkets(), now: facts?.now ?? Date.now(), ...facts } as ReaderFacts;
}

/* ------------------------------------------------------------ clauses */

interface Clause {
  readonly tokens: Tok[];
  readonly link: "then" | "and" | null;
}

const GAPPABLE = new Set<Verb>(["swap", "bridge", "move", "send", "stake", "lend"]);

function isAction(tok: Tok): boolean {
  return (tok.k === "verb" && tok.verb !== "twap") || tok.k === "side";
}

/** Splits a token run into clauses at connectors and commas between two actions, at Turkish converbs, and between two verbs. */
export function splitClauses(tokens: readonly Tok[], locale: Locale): Clause[] {
  const parts: Clause[] = [];
  let current: Tok[] = [];
  let link: Clause["link"] = null;
  let pendingLink: Clause["link"] = null;
  const flush = () => {
    if (current.length > 0) parts.push({ tokens: current, link });
    current = [];
    link = pendingLink;
    pendingLink = null;
  };
  for (const tok of tokens) {
    if (tok.k === "conn" || (tok.k === "punct" && (tok.p === "," || tok.p === ";" || tok.p === "."))) {
      if (current.length > 0) {
        const linkWord = tok.k === "conn" ? tok.c : "then";
        flush();
        link = linkWord;
      } else if (tok.k === "conn") {
        link = tok.c === "then" ? "then" : link ?? "and";
      }
      continue;
    }
    current.push(tok);
    if (tok.k === "verb" && tok.chain) {
      pendingLink = "then";
      flush();
    }
  }
  flush();
  // Merge pieces that have no action of their own into the clause before ("…, stop %3", "tp 4000 and sl 3200").
  const merged: Clause[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    const ownAction = part.tokens.some(isAction) || part.tokens.some((tok) => tok.k === "query" || (tok.k === "punct" && tok.p === "?"));
    // Gapping: "swap half to USDC and the rest to KALOS" repeats the verb of the clause before.
    const prevVerb = prev?.tokens.find((tok): tok is Tok & { k: "verb" } => tok.k === "verb" && GAPPABLE.has(tok.verb));
    if (prev && !ownAction && prevVerb && part.tokens.some((tok) => tok.k === "qty") && part.tokens.some((tok) => tok.k === "asset" && tok.role === "to")) {
      merged.push({ tokens: [{ ...prevVerb, chain: undefined } as Tok, ...part.tokens], link: part.link });
      continue;
    }
    if (prev && !ownAction) {
      prev.tokens.push(...part.tokens);
      continue;
    }
    if (prev && !prev.tokens.some(isAction) && !prev.tokens.some((tok) => tok.k === "query")) {
      merged[merged.length - 1] = { tokens: [...prev.tokens, ...part.tokens], link: prev.link };
      continue;
    }
    merged.push({ tokens: [...part.tokens], link: part.link });
  }
  // A clause with two verbs: split before the second (English) or after the first (Turkish, verb-final).
  const out: Clause[] = [];
  for (const clause of merged) {
    const verbs = clause.tokens.map((tok, index) => ({ tok, index })).filter((entry) => entry.tok.k === "verb" && entry.tok.verb !== "twap" && entry.tok.verb !== "show");
    if (verbs.length < 2) {
      out.push(clause);
      continue;
    }
    let start = 0;
    let first = true;
    const cuts = locale === "tr" ? verbs.slice(0, -1).map((entry) => entry.index + 1) : verbs.slice(1).map((entry) => entry.index);
    for (const cut of cuts) {
      out.push({ tokens: clause.tokens.slice(start, cut), link: first ? clause.link : "then" });
      first = false;
      start = cut;
    }
    out.push({ tokens: clause.tokens.slice(start), link: "then" });
  }
  return out.filter((clause) => clause.tokens.length > 0);
}

/* ------------------------------------------------------------ rule split */

interface RuleSplit {
  readonly condition?: Tok[];
  readonly body: Tok[];
  readonly repeat: boolean;
}

function splitCondition(tokens: readonly Tok[]): RuleSplit | null {
  const condIndex = tokens.findIndex((tok) => tok.k === "cond");
  const turkishEnd = tokens.findIndex((tok) => tok.k === "condEnd" || (tok.k === "cmp" && tok.ends === true));
  if (condIndex === -1 && turkishEnd === -1) return null;
  const repeat = tokens.some((tok) => tok.k === "cond" && tok.repeat === true);
  if (turkishEnd !== -1 && (condIndex === -1 || condIndex < turkishEnd)) {
    const after = tokens[turkishEnd + 1];
    const end = after && after.k === "punct" && after.p === "," ? turkishEnd + 1 : turkishEnd;
    return { condition: tokens.slice(0, turkishEnd + 1), body: tokens.slice(end + 1), repeat };
  }
  const leading = tokens.slice(0, condIndex).every((tok) => tok.k === "noise");
  if (!leading) {
    // "buy HYPE if it drops below 60", "alert me when ETH > 4000"
    return { condition: tokens.slice(condIndex + 1), body: tokens.slice(0, condIndex), repeat };
  }
  let seenOp = false;
  let seenValue = false;
  for (let index = condIndex + 1; index < tokens.length; index += 1) {
    const tok = tokens[index] as Tok;
    if (tok.k === "cmp" || (tok.k === "prep" && tok.role === "over")) seenOp = true;
    if (tok.k === "num" || (tok.k === "cmp" && (tok.op === "neg" || tok.op === "pos"))) seenValue = true;
    if ((tok.k === "punct" && tok.p === ",") || (tok.k === "conn" && tok.c === "then")) {
      return { condition: tokens.slice(condIndex + 1, index), body: tokens.slice(index + 1), repeat };
    }
    if (seenOp && seenValue && (isAction(tok) || (tok.k === "verb"))) {
      return { condition: tokens.slice(condIndex + 1, index), body: tokens.slice(index), repeat };
    }
  }
  return { condition: tokens.slice(condIndex + 1), body: [], repeat };
}

/* ------------------------------------------------------------ dispatch */

const VALUE_VERBS = new Set<Verb>(["swap", "bridge", "move", "send", "stake", "unstake", "wrap", "unwrap", "lend", "withdraw", "borrow", "repay", "deposit"]);
const STABLES = new Set(["USDC", "USDH", "USDT0", "*stable"]);

interface ClauseRead extends FrameResult {
  readonly alert?: true;
}

function verbsOf(tokens: readonly Tok[]): Verb[] {
  return tokens.filter((tok): tok is Tok & { k: "verb" } => tok.k === "verb").map((tok) => tok.verb);
}

/** Buy or sell without a perp word: HyperCore spot, a perp, or a swap on Elysium / HyperEVM. */
function buySellKind(tokens: readonly Tok[], ctx: FrameCtx, verb: "buy" | "sell"): "spot" | "perp" | "swap" | "asked" | null {
  const venue = tokens.find((tok): tok is Tok & { k: "venue" } => tok.k === "venue");
  if (venue) {
    const row = venueById(venue.id);
    if (row && (row.category === "dex" || row.category === "launchpad" || row.category === "aggregator")) return "swap";
  }
  if (tokens.some((tok) => tok.k === "asset" && tok.role === "on" && (tok.symbol === "KALOS" || tok.symbol === "PERPME"))) return "swap";
  const network = tokens.find((tok): tok is Tok & { k: "network" } => tok.k === "network");
  if (network && (network.family === "elysium" || network.family === "hyperevm")) return "swap";
  if (tokens.some((tok) => tok.k === "flag" && tok.flag === "spotword") || tokens.some((tok) => tok.k === "account" && tok.cls === "spot")) return "spot";
  if (tokens.some((tok) => tok.k === "market" && tok.kind === "spot")) return "spot";
  if (network && network.family === "hypercore") return "spot";
  const coinTok = tokens.find((tok): tok is Tok & ({ k: "asset" } | { k: "market" }) => (tok.k === "asset" && !STABLES.has(tok.symbol) && tok.role !== "with") || tok.k === "market");
  const name = coinTok ? (coinTok.k === "asset" ? coinTok.symbol : coinTok.coin) : undefined;
  if (!name) return null;
  const limitish = tokens.some((tok) => (tok.k === "order" && tok.t !== "market") || tok.k === "dur" || (tok.k === "prep" && tok.role === "at"));
  const paying = tokens.some((tok) => (tok.k === "asset" || tok.k === "num") && (tok.role === "with" || tok.role === "worth")) || tokens.some((tok) => tok.k === "num" && tok.usd);
  const boughtAmount = tokens.some((tok, index) => tok.k === "num" && !tok.usd && !tok.pct && tokens[index + 1]?.k === "asset" && (tokens[index + 1] as Tok & { k: "asset" }).symbol === name);
  const spot = marketsFor(ctx.facts.markets, name, "spot").length > 0;
  const perp = marketsFor(ctx.facts.markets, name, "perp").length > 0;
  const swappable = !limitish && (verb === "sell" || paying || !boughtAmount) && ["elysium", "hyperevm"].some((family) => tokenOn(networkKey(ctx.environment, family as "elysium" | "hyperevm"), name) !== null || (family === "elysium" && ["KALOS", "stKALOS", "PERPME"].includes(name)));
  const options: Array<"spot" | "perp" | "swap"> = [];
  if (spot) options.push("spot");
  if (perp && verb === "buy") options.push("perp");
  if (swappable) options.push("swap");
  if (verb === "sell" && ctx.facts.positions?.some((position) => position.coin.toUpperCase() === name.toUpperCase() && position.side === "long")) {
    const holdsSpot = ctx.facts.balances?.some((entry) => entry.symbol.toUpperCase() === name.toUpperCase() && Number(entry.amount) > 0);
    if (!holdsSpot) {
      const answer = ctx.clar.ask({
        id: `${ctx.qid}.intent`, goal: ctx.goal, field: "intent", reason: "SELL_INTENT",
        prompt: t(`You hold no spot ${name} but have a ${name} long. Sell spot ${name}, or reduce the long?`, `Spot ${name} yok ama ${name} long pozisyonunuz var. Spot mu satılsın, long mu azaltılsın?`),
        options: [{ id: "spot", en: `Sell spot ${name}`, tr: `Spot ${name} sat` }, { id: "reduce", en: `Reduce the ${name} long`, tr: `${name} long'u azalt` }],
      });
      if (!answer?.option) return "asked";
      return answer.option === "reduce" ? "perp" : "spot";
    }
  }
  if (options.length === 0) return null;
  if (options.length === 1) {
    const only = options[0] as "spot" | "perp" | "swap";
    ctx.clar.assume(ctx.goal, "marketKind", only === "spot" ? t(`HyperCore spot ${name}`, `HyperCore spot ${name}`) : only === "perp" ? t(`${name} perp on HyperCore`, `HyperCore'da ${name} perp`) : t(`a swap on an Elysium or HyperEVM DEX`, `Elysium veya HyperEVM DEX'inde swap`), true);
    return only;
  }
  const labels = {
    spot: t(`HyperCore spot ${name}`, `HyperCore spot ${name}`),
    perp: t(`Long the ${name} perp (leverage)`, `${name} perp long (kaldıraçlı)`),
    swap: t("Swap on Elysium or HyperEVM", "Elysium veya HyperEVM'de swap"),
  };
  const answer = ctx.clar.ask({
    id: `${ctx.qid}.marketKind`, goal: ctx.goal, field: "marketKind", reason: "MARKET_KIND",
    prompt: verb === "buy" ? t(`Buy ${name} how?`, `${name} nasıl alınsın?`) : t(`Sell ${name} how?`, `${name} nasıl satılsın?`),
    options: options.map((option) => ({ id: option, ...labels[option] })),
  });
  if (!answer?.option) return "asked";
  return answer.option as "spot" | "perp" | "swap";
}

function readClause(tokens: readonly Tok[], ctx: FrameCtx, resolved: ReadonlyMap<string, string>): ClauseRead {
  const bag = new Bag(tokens);
  const verbs = verbsOf(tokens);
  const verb = verbs.find((entry) => entry !== "twap" && entry !== "show") ?? verbs[0];
  const has = (kind: Tok["k"]) => tokens.some((tok) => tok.k === kind);
  const side = tokens.find((tok): tok is Tok & { k: "side" } => tok.k === "side")?.side;
  for (const hit of bag.all("verb")) bag.use(hit.index);
  const twap = verbs.includes("twap") || (has("dur") && tokens.some((tok) => tok.k === "prep" && tok.role === "over") && (verb === "buy" || verb === "sell" || Boolean(side)));
  const run = (input: TradeInput) => readTradeClause(bag, ctx, input);
  let result: ClauseRead;
  if (twap) {
    const kindWord: "spot" | "perp" | undefined = tokens.some((tok) => tok.k === "flag" && tok.flag === "spotword") ? "spot" : side || tokens.some(isPerpSignal) ? "perp" : undefined;
    const tradeSide = side ?? (verb === "sell" ? "sell" : verb === "buy" ? "buy" : undefined);
    let kind: "spot" | "perp" | undefined = kindWord;
    if (!kind && tradeSide) {
      const picked = buySellKind(tokens.filter((tok) => tok.k !== "dur" && !(tok.k === "prep" && tok.role === "over")), ctx, tradeSide === "sell" ? "sell" : "buy");
      if (picked === "asked") return {};
      kind = picked === "swap" || picked === null ? "spot" : picked;
    }
    result = run({ intent: "twap", ...(tradeSide ? { side: tradeSide === "buy" && kind === "perp" ? "long" : tradeSide === "sell" && kind === "perp" ? "short" : tradeSide } : {}), ...(kind ? { kind } : {}) });
  } else if (!verb) {
    if (side) result = run({ intent: "open", side });
    else if (has("tpsl")) result = run({ intent: "protect" });
    else if (has("query") || has("metric") || tokens.some((tok) => tok.k === "punct" && tok.p === "?") || has("scope")) result = readQueryClause(bag, ctx);
    else result = { unreadable: t("I could not find what to do in that.", "Bunda ne yapılacağını bulamadım.") };
  } else if (verb === "show") {
    result = readQueryClause(bag, ctx);
  } else if (verb === "alert") {
    if (has("query") || has("metric") || has("scope")) result = readQueryClause(bag, ctx);
    else result = { alert: true };
  } else if (verb === "open") {
    if (side) result = run({ intent: "open", side });
    else {
      const answer = ctx.clar.ask({ id: `${ctx.qid}.side`, goal: ctx.goal, field: "side", reason: "SIDE_MISSING", prompt: t("Long or short?", "Long mu short mu?"), options: [{ id: "long", en: "Long", tr: "Long" }, { id: "short", en: "Short", tr: "Short" }] });
      result = run({ intent: "open", ...(answer?.option ? { side: answer.option as "long" | "short" } : {}) });
    }
  } else if (verb === "close") {
    const venue = tokens.find((tok): tok is Tok & { k: "venue" } => tok.k === "venue");
    if (venue && (venueById(venue.id)?.category === "lending" || venueById(venue.id)?.category === "vault")) result = readValueClause("withdraw", bag, ctx, { resolved });
    else if (tokens.some((tok) => tok.k === "scope" && tok.what === "orders")) result = run({ intent: "cancel" });
    else result = run({ intent: "close" });
  } else if (verb === "flatten") {
    result = run({ intent: "flatten" });
  } else if (verb === "reduce") {
    result = has("lev") ? run({ intent: "setLeverage" }) : run({ intent: "reduce" });
  } else if (verb === "cancel") {
    result = run({ intent: "cancel" });
  } else if (verb === "set" || (verb === "deposit" && has("tpsl"))) {
    if (has("tpsl")) result = run({ intent: "protect" });
    else if (side) result = run({ intent: "open", side });
    else if (has("lev") || has("levword") || has("margin")) result = run({ intent: "setLeverage" });
    else result = { unreadable: t("Set what? A leverage, a stop or a take profit.", "Ne ayarlansın? Kaldıraç, stop veya kâr al.") };
  } else if (verb === "buy" || verb === "sell") {
    if (side || tokens.some(isPerpSignal)) {
      result = run({ intent: "open", side: side ?? (verb === "buy" ? "long" : "short") });
    } else {
      const kind = buySellKind(tokens, ctx, verb);
      if (kind === "asked") return {};
      if (kind === "swap" || kind === null) result = readValueClause(verb, bag, ctx, { resolved });
      else if (kind === "perp" && verb === "sell") result = run({ intent: "reduce" });
      else if (kind === "perp") result = run({ intent: "open", side: "long" });
      else result = run({ intent: "order", side: verb, kind: "spot" });
    }
  } else if (VALUE_VERBS.has(verb)) {
    const negative = tokens.find((tok) => tok.k === "num" && tok.neg === true && !tok.pct);
    result = negative ? { unreadable: t("Amounts are positive numbers.", "Miktarlar pozitif sayılardır.") } : readValueClause(verb, bag, ctx, { resolved });
  } else {
    result = { unreadable: t("I could not read that.", "Bunu okuyamadım.") };
  }
  if (result.goal) {
    const left = bag.leftovers().filter((tok) => !(tok.k === "query" && tok.what === undefined) && !(tok.k === "punct"));
    if (left.length > 0) {
      return { unreadable: t(`I could not place "${describe(left[0] as Tok)}" in that.`, `"${describe(left[0] as Tok)}" ifadesini yerleştiremedim.`) };
    }
  }
  return result;
}

function describe(tok: Tok): string {
  switch (tok.k) {
    case "unknown":
      return tok.raw;
    case "num":
      return tok.value;
    case "asset":
      return tok.symbol;
    case "market":
      return tok.coin;
    case "network":
      return tok.family;
    case "venue":
      return venueById(tok.id)?.label ?? tok.id;
    case "lev":
      return `${tok.x}x`;
    default:
      return tok.k;
  }
}

/* ------------------------------------------------------------ the reader */

export function readText(text: string, options: ReadOptions = {}): Reading {
  const environment = options.environment ?? "testnet";
  const facts = defaultFacts(options.facts);
  const locale = options.locale ?? detectLocale(text);
  const clar = new Clarifier(locale, options.answers ?? []);
  const base = { spec: LANGUAGE_SPEC, locale } as const;
  const empty = (status: LanguageStatus, extra: Partial<Reading> = {}): Reading => ({
    ...base, status, goals: [], questions: [], pendingQuestions: 0, assumptions: [], chips: [], canonical: null, warnings: clar.warnings, usedAnswers: [], names: [], ...extra,
  });
  if (CONTROL.test(text)) return empty("control", { control: "cancel" });
  if (PRIVATE_KEY.test(text) || SEED_WORDS.test(text)) {
    clar.warn("SECRET_REFUSED", t("That looks like a key or a recovery phrase. Elyia never asks for one and did not read or store it. Never share it with anyone.", "Bu bir anahtar veya kurtarma ifadesine benziyor. Elyia bunu asla istemez; okumadı ve saklamadı. Kimseyle paylaşmayın."));
    return empty("unreadable", { unsupported: "secret" });
  }
  const lexer = new Lexer({ environment, markets: facts.markets });
  const tokens = lexer.lex(text, locale);
  const chips: LanguageChip[] = chipsOf(text, tokens);
  const names = tokens.filter((tok): tok is Tok & { k: "name" } => tok.k === "name").map((tok) => tok.value);
  const unknown = tokens.find((tok) => tok.k === "unknown");
  const negation = tokens.find((tok) => tok.k === "neg");
  const ambiguousNumber = tokens.find((tok): tok is Tok & { k: "num" } => tok.k === "num" && tok.ambiguous !== undefined);
  if (negation) {
    clar.warn("NEGATION", t("Elyia does not act on negations: say what you want done.", "Elyia olumsuz cümlelerle işlem yapmaz: ne yapılmasını istediğinizi yazın."), negation.span);
    return empty("unreadable", { chips, names, examples: EXAMPLES[locale], unsupported: "negation" });
  }
  if (unknown && unknown.k === "unknown") {
    clar.warn("UNKNOWN_WORD", t(`I don't know "${unknown.raw}", so I read nothing rather than guess.`, `"${unknown.raw}" kelimesini bilmiyorum; tahmin etmek yerine hiçbir şey okumadım.`), unknown.span);
    return empty("unreadable", { chips, names, examples: EXAMPLES[locale], unsupported: `unknown word: ${unknown.raw}` });
  }
  let working = [...tokens];
  if (ambiguousNumber) {
    const [first, second] = ambiguousNumber.ambiguous as readonly [string, string];
    const answer = clar.ask({
      id: `s.number.${ambiguousNumber.span[0]}`, goal: -1, field: "amount", reason: "AMOUNT_FORMAT_AMBIGUOUS",
      prompt: t(`Does "${text.slice(ambiguousNumber.span[0], ambiguousNumber.span[1])}" mean ${first} or ${second}?`, `"${text.slice(ambiguousNumber.span[0], ambiguousNumber.span[1])}" ${first} mi, ${second} mi?`),
      options: [{ id: first, en: first, tr: first.replace(".", ",") }, { id: second, en: second, tr: second }],
    });
    if (!answer?.option) return finish(text, locale, clar, [], chips, names, facts);
    working = working.map((tok) => (tok === ambiguousNumber ? { ...ambiguousNumber, value: answer.option as string, ambiguous: undefined, rewritten: true as const } : tok)) as Tok[];
  }
  for (const tok of working) {
    if (tok.k === "num" && tok.rewritten && !tok.ambiguous) {
      const typed = text.slice(tok.span[0], tok.span[1]);
      if (typed.replace(/[$%+-]/gu, "") !== tok.value) clar.assume(-1, `number.${tok.span[0]}`, t(`read "${typed}" as ${tok.value}`, `"${typed}" ${tok.value} olarak okundu`), true);
    }
  }
  const goals = readGoals(working, { environment, facts, locale, clar, resolved: options.resolvedNames ?? new Map() });
  return finish(text, locale, clar, goals.goals, chips, names, facts, goals.unreadable);
}

interface GoalsRead {
  readonly goals: LanguageGoal[];
  readonly unreadable?: { en: string; tr: string };
}

function readGoals(tokens: readonly Tok[], input: { environment: NetworkEnvironment; facts: ReaderFacts; locale: Locale; clar: Clarifier; resolved: ReadonlyMap<string, string> }): GoalsRead {
  const ctxFor = (goal: number, qid: string, prev: Previous | undefined, inRule: boolean, link: Clause["link"]): FrameCtx => ({
    locale: input.locale, environment: input.environment, facts: input.facts, clar: input.clar, goal, qid, ...(prev ? { prev } : {}), inRule, link,
  });
  const hasSchedule = tokens.some((tok) => tok.k === "sched");
  const conditionSplit = splitCondition(tokens);
  if (hasSchedule || conditionSplit) {
    const all = new Bag(conditionSplit ? conditionSplit.body : tokens);
    const ruleCtx = ctxFor(0, "g0", undefined, true, null);
    const schedule = hasSchedule ? scheduleOf(new Bag(tokens), ruleCtx) : "none";
    const limits = limitTokens(all);
    if ("bad" in limits) return { goals: [], unreadable: limits.bad };
    const remaining = all.toks.filter((tok, index) => !all.isUsed(index) && tok.k !== "sched" && tok.k !== "clock" && !(tok.k === "prep" && tok.role === "at" && hasSchedule && tokens.some((entry) => entry.k === "clock")));
    if (schedule === null) return { goals: [] };
    let when: Rule["when"] | undefined;
    if (schedule !== "none") when = schedule;
    let conditionPending = false;
    let bodyTokens = remaining;
    if (conditionSplit?.condition) {
      const read = readCondition(withSubject(conditionSplit.condition, remaining), ruleCtx);
      if (read.unreadable) return { goals: [], unreadable: read.unreadable };
      if (read.condition) when = read.condition;
      else conditionPending = true;
      bodyTokens = withBodySubject(remaining, conditionSplit.condition);
    }
    if (!when && !conditionPending) return { goals: [], unreadable: t("Say when it should run.", "Ne zaman çalışacağını yazın.") };
    const clauses = splitClauses(bodyTokens, input.locale);
    const body: GoalItem[] = [];
    let prev: Previous | undefined;
    for (const [index, clause] of clauses.entries()) {
      const read = readClause(clause.tokens, ctxFor(0, `g0.b${index}`, prev, true, clause.link), input.resolved);
      if (read.unreadable) return { goals: [], unreadable: read.unreadable };
      if (read.alert) {
        body.push(alertItem(ruleCtx, limits, conditionSplit?.repeat ?? false));
        continue;
      }
      if (!read.goal) continue;
      if (read.goal.t === "query" || read.goal.t === "rule") return { goals: [], unreadable: t("Automations can trade, move value or alert; questions are answered right away.", "Otomasyonlar işlem yapar, değer taşır veya uyarır; sorular hemen yanıtlanır.") };
      body.push(read.goal);
      if (read.prev) prev = { ...read.prev, index: body.length - 1 };
    }
    if (body.length === 0) {
      if (input.clar.questions.length > 0) return { goals: [] };
      return { goals: [], unreadable: t("Say what should happen when it fires.", "Tetiklendiğinde ne olacağını yazın.") };
    }
    if (!when) return { goals: [] };
    const built = buildRule(ruleCtx, when, body, limits as LimitTokens, conditionSplit?.repeat ?? false);
    return { goals: built.rule ? [ruleGoal(built.rule)] : [] };
  }
  const clauses = splitClauses(tokens, input.locale);
  const goals: LanguageGoal[] = [];
  let prev: Previous | undefined;
  for (const clause of clauses) {
    const index = goals.length;
    const read = readClause(clause.tokens, ctxFor(index, `g${index}`, prev, false, index === 0 ? null : clause.link ?? "and"), input.resolved);
    if (read.unreadable) return { goals: [], unreadable: read.unreadable };
    if (read.alert) return { goals: [], unreadable: t("Alert me when what? For example: alert me when ETH price above 4000.", "Ne zaman uyarayım? Örneğin: ETH 4000'i geçerse haber ver.") };
    if (read.reorder) {
      const rewritten = reorderStake(goals, read.reorder);
      if (!rewritten) return { goals: [], unreadable: t("Give the bridged amount as a number to stake part of it first.", "Önce bir kısmını stake etmek için köprülenen miktarı sayı olarak yazın.") };
      goals.splice(0, goals.length, ...rewritten);
      prev = undefined;
      continue;
    }
    if (!read.goal) {
      // A question was asked: keep a placeholder so later goals keep their indexes.
      prev = undefined;
      continue;
    }
    // "…and swap the rest": track how much of the parent output chained goals used.
    if (read.goal.t === "value" && read.goal.goal.chain && prev) {
      const amount = read.goal.goal.spend.amount;
      const used = amount?.t === "portion" ? amount.bps : 10_000;
      prev = { ...prev, used: prev.used + used, chainParent: read.goal.goal.chain.after };
      goals.push(read.goal);
      continue;
    }
    goals.push(read.goal);
    prev = read.prev ? { ...read.prev, index } : undefined;
  }
  return { goals };
}

/** A condition without a subject takes the body's market ("buy HYPE if it drops below 60"). */
function withSubject(condition: readonly Tok[], body: readonly Tok[]): Tok[] {
  if (condition.some((tok) => tok.k === "asset" || tok.k === "market")) return [...condition];
  const subject = body.find((tok) => (tok.k === "asset" && !STABLES.has(tok.symbol) && tok.role !== "with" && tok.role !== "worth") || tok.k === "market");
  return subject ? [{ ...subject, span: subject.span } as Tok, ...condition] : [...condition];
}

/** A buy/sell body without its own coin takes the condition's ("HYPE 60'ın altına düşerse 100 USDC'lik al"). */
function withBodySubject(body: readonly Tok[], condition: readonly Tok[]): Tok[] {
  const coinless = !body.some((tok) => (tok.k === "asset" && !STABLES.has(tok.symbol) && tok.role !== "with" && tok.role !== "worth") || tok.k === "market");
  const buys = body.some((tok) => tok.k === "verb" && (tok.verb === "buy" || tok.verb === "sell" || tok.verb === "open") || tok.k === "side");
  if (!coinless || !buys) return [...body];
  const subject = condition.find((tok) => (tok.k === "asset" && !STABLES.has(tok.symbol)) || tok.k === "market");
  if (!subject) return [...body];
  const { role: _role, ...bare } = subject as Tok & { role?: unknown };
  return [...body, bare as Tok];
}

/** STAKE_ORDER answered: "bridge X HYPE to Elysium, stake p%" -> "stake p% of X on HyperEVM, bridge the rest". */
function reorderStake(goals: readonly LanguageGoal[], reorder: { mode: "stake-first" | "bridge-only"; after: number; bps: number }): LanguageGoal[] | null {
  const parent = goals[reorder.after];
  if (!parent || parent.t !== "value" || parent.goal.kind !== "relocate") return null;
  if (reorder.mode === "bridge-only") return [...goals];
  const bridge = parent.goal;
  const amount = bridge.spend.amount;
  if (!amount || amount.t !== "exact") return null;
  const staked = scaleDecimal(amount.value, reorder.bps);
  const rest = subtractDecimal(amount.value, staked);
  const network = bridge.spend.from?.network;
  if (!network || !staked) return null;
  const stake: ValueGoal = {
    kind: "stake", op: "stake", spend: { asset: { symbol: "HYPE" }, amount: { t: "exact", value: staked }, from: { network, custody: { kind: "wallet" } } },
    want: { asset: { symbol: "kHYPE" } }, holder: { t: "self" }, constraints: { via: ["kinetiq"] }, confidence: "exact",
  };
  const out: LanguageGoal[] = [{ t: "value", goal: stake }];
  if (rest && rest !== "0") out.push({ t: "value", goal: { ...bridge, spend: { ...bridge.spend, amount: { t: "exact", value: rest } } } });
  return [...goals.slice(0, reorder.after), ...out, ...goals.slice(reorder.after + 1)];
}

function scaleDecimal(value: string, bps: number): string | null {
  const [whole, fraction = ""] = value.split(".");
  const digits = BigInt(`${whole}${fraction}`) * BigInt(bps);
  const scale = fraction.length + 4;
  const text = digits.toString().padStart(scale + 1, "0");
  const out = `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.?0+$/u, "");
  return out === "" || out === "0" ? null : out;
}

function subtractDecimal(a: string, b: string | null): string | null {
  if (!b) return a;
  const places = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  const toInt = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(`${whole}${fraction.padEnd(places, "0")}`);
  };
  const diff = toInt(a) - toInt(b);
  if (diff <= 0n) return null;
  const text = diff.toString().padStart(places + 1, "0");
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`.replace(/\.?0+$/u, "");
}

function finish(text: string, locale: Locale, clar: Clarifier, goals: readonly LanguageGoal[], chips: LanguageChip[], names: readonly string[], facts: ReaderFacts, unreadable?: { en: string; tr: string }): Reading {
  const questions = clar.questions;
  const base = { spec: LANGUAGE_SPEC, locale } as const;
  if (unreadable) {
    clar.warn("UNREADABLE", unreadable);
    return { ...base, status: "unreadable", goals: [], questions: [], pendingQuestions: 0, assumptions: [], chips, canonical: null, warnings: clar.warnings, usedAnswers: [...clar.used.values()], names, examples: EXAMPLES[locale], unsupported: unreadable[locale] };
  }
  if (questions.length === 0 && goals.length === 0) {
    clar.warn("NOTHING_READ", t("I found nothing to do in that.", "Bunda yapılacak bir şey bulamadım."));
    return { ...base, status: "unreadable", goals: [], questions: [], pendingQuestions: 0, assumptions: [], chips, canonical: null, warnings: clar.warnings, usedAnswers: [], names, examples: EXAMPLES[locale], unsupported: "nothing read" };
  }
  const shown = questions.slice(0, LANGUAGE_LIMITS.maxQuestions);
  if (questions.length === 0) {
    const issues = validateLanguageGoals(goals);
    if (issues.length > 0) {
      clar.warn("INVALID_READING", t(`The reading is incomplete: ${issues[0]?.message}`, `Okuma eksik: ${issues[0]?.message}`));
      return { ...base, status: "unreadable", goals: [], questions: [], pendingQuestions: 0, assumptions: [], chips, canonical: null, warnings: clar.warnings, usedAnswers: [...clar.used.values()], names, examples: EXAMPLES[locale], unsupported: issues[0]?.message ?? "invalid" };
    }
  }
  const ready = questions.length === 0;
  const plannable = goals.every((goal) => goal.t === "value" || goal.t === "trade");
  return {
    ...base,
    status: ready ? "ready" : "needs_input",
    goals,
    questions: shown,
    pendingQuestions: questions.length - shown.length,
    assumptions: clar.assumptions,
    chips,
    canonical: ready ? canonicalSentence(goals) : null,
    warnings: clar.warnings,
    usedAnswers: [...clar.used.values()],
    names,
    ...(facts.prices && Object.keys(facts.prices).length > 0 ? { priceSource: "reference:hypercore-mainnet-mids" as const } : {}),
    ...(!ready ? { clarify: shown.map((question) => question.prompt) } : {}),
    ...(ready && !plannable ? { unsupported: goals.some((goal) => goal.t === "rule") ? "Automations are armed by the Elysium Agent (POST /v1/agent/automations), not planned as an intent." : "Questions are answered, not planned." } : {}),
  };
}

export { fold };
export type { MarketFact };
