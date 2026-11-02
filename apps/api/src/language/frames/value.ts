/**
 * Value frames: swap / wrap, bridge / move / deposit, send, stake / unstake,
 * lend / withdraw / borrow / repay, and swap-style buys on Elysium venues.
 * Word order does not matter: roles come from English prepositions and
 * Turkish case suffixes.
 */
import type { AmountSel, AssetSel, LanguageGoal, NetworkKey, Place, ValueGoal } from "@elyia/core";
import { t } from "../clarify.js";
import { flaggedTokensFor } from "@elyia/core";
import { tokenOn } from "../entities.js";
import { readNumber } from "../numbers.js";
import type { Role, Span, Tok, TokOf, Verb } from "../types.js";
import { venueById, VENUE_WORDS, type VenueWord } from "../venues.js";
import {
  amountSel,
  amountsOf,
  ask,
  familyOf,
  NETWORK_LABEL,
  NETWORK_OPTIONS,
  networkKey,
  parseAmountAnswer,
  specOf,
  useAll,
  venueOf,
  venueWarning,
  type AmountItem,
  type Bag,
  type FrameCtx,
  type Previous,
} from "./common.js";

export interface FrameResult {
  readonly goal?: LanguageGoal;
  readonly prev?: Previous;
  /** Set when the clause cannot be read (nothing guessed). */
  readonly unreadable?: { readonly en: string; readonly tr: string };
  /** STAKE_ORDER answered: rewrite "bridge X, stake part" into "stake part on HyperEVM, bridge the rest". */
  readonly reorder?: { readonly mode: "stake-first" | "bridge-only"; readonly after: number; readonly bps: number };
}

type Family = "elysium" | "hyperevm" | "hypercore";

interface PlaceRead {
  readonly family: Family | "hyperliquid";
  readonly cls?: "spot" | "perp";
  readonly span: Span;
}

const WALLET = { kind: "wallet" } as const;

function takePlace(bag: Bag, roles: readonly (Role | undefined)[]): PlaceRead | null {
  const account = bag.find("account", (tok) => roles.includes(tok.role));
  const network = bag.find("network", (tok) => roles.includes(tok.role));
  if (account) {
    bag.use(account.index);
    if (network && network.tok.family === "hypercore") bag.use(network.index);
    return { family: "hypercore", cls: account.tok.cls, span: account.tok.span };
  }
  if (network) {
    bag.use(network.index);
    // "hypercore spot" / "hypercore perps": a class word right after the network.
    const next = bag.nextAfter(network.index);
    if (network.tok.family === "hypercore" && next && next.tok.k === "flag" && (next.tok.flag === "spotword" || next.tok.flag === "perpword")) {
      bag.use(next.index);
      return { family: "hypercore", cls: next.tok.flag === "spotword" ? "spot" : "perp", span: [network.tok.span[0], next.tok.span[1]] };
    }
    return { family: network.tok.family, span: network.tok.span };
  }
  // "perps" said as a class word ("move 100 USDC to perps").
  const word = bag.find("flag", (tok, index) => {
    if (tok.flag !== "perpword" && tok.flag !== "spotword") return false;
    const prev = bag.prevBefore(index);
    return Boolean(prev && prev.tok.k === "prep" && roles.includes(prev.tok.role as Role));
  });
  if (word) {
    {
      bag.use(word.index);
      return { family: "hypercore", cls: word.tok.flag === "spotword" ? "spot" : "perp", span: word.tok.span };
    }
  }
  return null;
}

function placeOf(ctx: FrameCtx, read: { family: Family; cls?: "spot" | "perp" }): Place {
  const network = networkKey(ctx.environment, read.family);
  if (read.family === "hypercore") return { network, custody: { kind: "hypercore", class: read.cls ?? "unknown" } };
  return { network, custody: WALLET };
}

function sym(symbol: string): AssetSel {
  return symbol === "*stable" ? { class: "usd-stable" } : { symbol };
}

function symbolLabel(symbol: string): string {
  return symbol === "*stable" ? "stablecoins" : symbol;
}

function value(goal: ValueGoal): LanguageGoal {
  return { t: "value", goal };
}

/** Typo and look-alike checks of an asset token; null when the clause must wait for an answer. */
export function confirmAsset(ctx: FrameCtx, tok: TokOf<"asset">, field: string): string | null {
  if (tok.typo) {
    const answer = ask(ctx, `${field}.typo`, "ASSET_TYPO", {
      prompt: t(`Did you mean ${tok.symbol} ("${tok.typo}" is not a token Elyia knows)?`, `${tok.symbol} mi demek istediniz ("${tok.typo}" Elyia'nın bildiği bir token değil)?`),
      options: [{ id: "yes", en: `Yes, ${tok.symbol}`, tr: `Evet, ${tok.symbol}` }],
      allowsText: true,
      placeholder: t("token symbol", "token sembolü"),
    });
    if (!answer) return null;
    if (answer.text !== undefined) return answer.text.toUpperCase();
  }
  if (tok.lookalike) {
    const answer = ask(ctx, `${field}.lookalike`, "ASSET_LOOKALIKE", {
      prompt: t(`${tok.symbol} is not ${tok.lookalike}: look-alike tokens exist on Elysium testnet. Which one do you mean?`, `${tok.symbol}, ${tok.lookalike} değil: Elysium testnet'te taklit tokenlar var. Hangisini kastediyorsunuz?`),
      options: [
        { id: "canonical", en: `Canonical ${tok.lookalike}`, tr: `Resmi ${tok.lookalike}` },
        { id: "as-typed", en: `${tok.symbol} (not ${tok.lookalike}, never priced as it)`, tr: `${tok.symbol} (${tok.lookalike} değil, onun gibi fiyatlanmaz)` },
      ],
    });
    if (!answer) return null;
    return answer.option === "canonical" ? tok.lookalike : tok.symbol;
  }
  if (!tok.listed) {
    ctx.clar.warn("TOKEN_UNLISTED", t(`${tok.symbol} is not in Elyia's verified token list; the route is checked against the venue's own pool before anything is signed.`, `${tok.symbol} Elyia'nın doğrulanmış token listesinde değil; imzadan önce rota havuzun kendisiyle kontrol edilir.`), tok.span);
  }
  return tok.symbol;
}

/** Warns when the registry knows look-alikes of a token on the network ("14 WHYPE look-alikes on Elysium testnet"). */
function lookalikeNote(ctx: FrameCtx, symbol: string, network: NetworkKey | undefined): void {
  if (!network) return;
  const token = tokenOn(network, symbol);
  if (!token?.address) return;
  const count = flaggedTokensFor(network).filter((row) => (row.imitatesSymbol ?? row.imitates).toUpperCase() === symbol.toUpperCase()).length;
  if (count === 0) return;
  ctx.clar.warn(`LOOKALIKE_${symbol.toUpperCase()}`, t(`Only canonical ${symbol} (${token.address}) is routed; ${count} look-alike${count === 1 ? "" : "s"} of it exist on ${NETWORK_LABEL[familyOf(network)]}.`, `Yalnızca resmi ${symbol} (${token.address}) kullanılır; ${NETWORK_LABEL[familyOf(network)]} üzerinde ${count} taklidi var.`));
}

function amountFor(ctx: FrameCtx, item: AmountItem | undefined, field: string, symbol: string | undefined, allowMax = true): AmountSel | null {
  if (item) {
    const sel = amountSel(item);
    if (sel) return sel;
  }
  const spec = specOf(ctx, field, "AMOUNT_MISSING", {
    prompt: t(`How much${symbol ? ` ${symbolLabel(symbol)}` : ""}?`, `Ne kadar${symbol ? ` ${symbolLabel(symbol)}` : ""}?`),
    options: allowMax ? [{ id: "max", en: "All of it", tr: "Hepsi" }, { id: "half", en: "Half", tr: "Yarısı" }] : [],
    allowsText: true,
    placeholder: t("amount", "miktar"),
  });
  const answer = ctx.clar.ask(spec);
  if (!answer) return null;
  if (answer.option === "max") return { t: "max" };
  if (answer.option === "half") return { t: "portion", bps: 5_000 };
  const parsed = parseAmountAnswer(answer.text as string, ctx.locale, readNumber);
  if (!parsed) {
    ctx.clar.reject(spec, t("Type the amount as a number (for example 12.5).", "Miktarı sayı olarak yazın (örneğin 12,5)."));
    return null;
  }
  return { t: "exact", value: parsed };
}

/** Balance check from client facts: asks when an exact amount is above what the account holds there. */
function checkBalance(ctx: FrameCtx, network: NetworkKey | undefined, symbol: string | undefined, amount: AmountSel | null): AmountSel | null {
  if (!amount || amount.t !== "exact" || !network || !symbol || !ctx.facts.balances) return amount;
  const held = ctx.facts.balances.find((entry) => entry.network === network && entry.symbol.toUpperCase() === symbol.toUpperCase());
  if (!held || Number(held.amount) >= Number(amount.value)) return amount;
  const answer = ask(ctx, "amount.balance", "AMOUNT_EXCEEDS_BALANCE", {
    prompt: t(`You hold ${held.amount} ${symbol} on ${NETWORK_LABEL[familyOf(network)]}, less than ${amount.value}. Use all of it, or another amount?`, `${NETWORK_LABEL[familyOf(network)]} üzerinde ${held.amount} ${symbol} var, ${amount.value} değerinden az. Hepsini mi kullanalım, başka bir miktar mı?`),
    options: [{ id: "max", en: `All ${held.amount} ${symbol}`, tr: `Tüm ${held.amount} ${symbol}` }],
    allowsText: true,
    placeholder: t("amount", "miktar"),
  });
  if (!answer) return amount;
  if (answer.option === "max") return { t: "max" };
  const parsed = parseAmountAnswer(answer.text as string, ctx.locale, readNumber);
  return parsed ? { t: "exact", value: parsed } : amount;
}

/** The asset an amount talks about, or the chained previous output. */
interface Spend {
  readonly symbol?: string;
  readonly amount?: AmountItem;
  readonly chained: boolean;
}

function spendOf(ctx: FrameCtx, bag: Bag, amounts: readonly AmountItem[], options: { readonly exclude?: readonly Role[] } = {}): Spend {
  const exclude = options.exclude ?? ["to"];
  const amount = amounts.find((item) => !exclude.includes(item.role as Role)) ?? amounts[0];
  if (amount) useAll(bag, amount.indexes);
  let symbol = amount?.symbol;
  if (!symbol) {
    const asset = bag.find("asset", (tok) => !exclude.includes(tok.role as Role) && tok.role !== "on");
    if (asset) {
      bag.use(asset.index);
      symbol = asset.tok.symbol;
    }
  }
  const prev = ctx.prev;
  const portionish = !amount || amount.kind === "portion" || amount.kind === "max" || amount.kind === "rest";
  const chained = Boolean(prev && prev.family === "value" && prev.asset && ctx.link && portionish && (!symbol || symbol === prev.asset));
  if (chained && !symbol) symbol = prev?.asset;
  return { ...(symbol ? { symbol } : {}), ...(amount ? { amount } : {}), chained };
}

function chainedAmount(ctx: FrameCtx, spend: Spend): AmountSel | null {
  const amount = spend.amount;
  if (!amount) return { t: "previous" };
  if (amount.kind === "rest") {
    const used = ctx.prev?.used ?? 0;
    if (used <= 0 || used >= 10_000) return { t: "previous" };
    return { t: "portion", bps: 10_000 - used };
  }
  return amountSel(amount);
}

function stakeOrder(ctx: FrameCtx): boolean {
  // Kinetiq staking runs on HyperEVM: staking part of what was just bridged to Elysium needs another order.
  return Boolean(ctx.prev && ctx.prev.network && familyOf(ctx.prev.network) === "elysium" && ctx.prev.family === "value");
}

/* ------------------------------------------------------------------ swap */

function readSwap(verb: Verb, bag: Bag, ctx: FrameCtx): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const venue = venueOf(bag);
  // "buy 100 USDC worth of HYPE", "buy HYPE with 100 USDC", "100 USDC'lik HYPE al".
  let spendSymbol: string | undefined;
  let wantSymbol: string | undefined;
  let amount: AmountItem | undefined;
  let chained = false;
  if (verb === "buy") {
    const paying = amounts.find((item) => item.role === "with" || item.role === "worth" || item.kind === "usd" || (item.symbol && item.role === "from"));
    const target = bag.find("asset", (tok) => tok.role !== "with" && tok.role !== "worth" && !(paying?.indexes ?? []).includes(-1));
    if (paying) {
      useAll(bag, paying.indexes);
      amount = paying;
      spendSymbol = paying.symbol ?? (paying.kind === "usd" ? "USDC" : undefined);
      const want = bag.find("asset", (tok) => tok.symbol !== spendSymbol);
      if (want) {
        bag.use(want.index);
        wantSymbol = want.tok.symbol;
      }
    } else {
      const bought = amounts[0];
      if (bought) useAll(bag, bought.indexes);
      wantSymbol = bought?.symbol ?? (target ? target.tok.symbol : undefined);
      if (target && !bought?.symbol) bag.use(target.index);
      const payWith = bag.find("asset", (tok) => tok.role === "with" || tok.role === "from");
      if (payWith) {
        bag.use(payWith.index);
        spendSymbol = payWith.tok.symbol;
      }
      if (bought) {
        // An amount of the bought token is a target, not a spend: swaps are sized by what you pay.
        return { unreadable: t(`Say how much to pay for ${wantSymbol ?? "it"} (for example "buy ${wantSymbol ?? "HYPE"} with 100 USDC"): swaps are sized by what you spend.`, `${wantSymbol ?? "Token"} için ne kadar ödeneceğini yazın (örneğin "100 USDC ile ${wantSymbol ?? "HYPE"} al"): swap harcanan miktarla yapılır.`) };
      }
    }
  } else if (verb === "sell") {
    const sold = amounts[0];
    if (sold) {
      useAll(bag, sold.indexes);
      amount = sold;
      spendSymbol = sold.symbol;
    }
    if (!spendSymbol) {
      const asset = bag.find("asset", (tok) => tok.role !== "to" && tok.role !== "with");
      if (asset) {
        bag.use(asset.index);
        spendSymbol = asset.tok.symbol;
      }
    }
    const into = bag.find("asset", (tok) => tok.role === "to" || tok.role === "with" || tok.role === "obj");
    if (into) {
      bag.use(into.index);
      wantSymbol = into.tok.symbol;
    }
  } else {
    const spend = spendOf(ctx, bag, amounts);
    spendSymbol = spend.symbol;
    amount = spend.amount;
    chained = spend.chained;
    const want = bag.find("asset", (tok) => tok.role === "to" || (tok.role === undefined && tok.symbol !== spendSymbol));
    if (want) {
      bag.use(want.index);
      wantSymbol = want.tok.symbol;
    }
    if (verb === "wrap") wantSymbol = spendSymbol === "HYPE" || !spendSymbol ? "WHYPE" : wantSymbol;
    if (verb === "unwrap") wantSymbol = "HYPE";
    if ((verb === "wrap" || verb === "unwrap") && !spendSymbol) spendSymbol = verb === "wrap" ? "HYPE" : "WHYPE";
  }
  const where = takePlace(bag, ["on", undefined, "from"]);
  if (where?.family === "hypercore") {
    return { unreadable: t("Swaps run on Elysium or HyperEVM; on HyperCore say buy or sell spot.", "Swap Elysium veya HyperEVM'de yapılır; HyperCore'da spot al veya sat deyin.") };
  }
  if (!spendSymbol) {
    const answer = ask(ctx, "spend.asset", "INPUT_ASSET_MISSING", {
      prompt: t(`Pay with which token${wantSymbol ? ` for ${symbolLabel(wantSymbol)}` : ""}?`, `${wantSymbol ? `${symbolLabel(wantSymbol)} için ` : ""}hangi tokenla ödensin?`),
      options: [{ id: "USDC", en: "USDC", tr: "USDC" }, { id: "HYPE", en: "HYPE", tr: "HYPE" }].filter((option) => option.id !== wantSymbol),
      allowsText: true,
    });
    if (answer) spendSymbol = answer.option ?? answer.text?.toUpperCase();
  }
  if (!wantSymbol) {
    const answer = ask(ctx, "want.asset", "OUTPUT_ASSET_MISSING", {
      prompt: t(`Swap ${spendSymbol ? symbolLabel(spendSymbol) : "it"} into which token?`, `${spendSymbol ? symbolLabel(spendSymbol) : "Bunu"} hangi tokena çevirelim?`),
      options: [{ id: "USDC", en: "USDC", tr: "USDC" }, { id: "HYPE", en: "HYPE", tr: "HYPE" }].filter((option) => option.id !== spendSymbol),
      allowsText: true,
    });
    if (answer) wantSymbol = answer.option ?? answer.text?.toUpperCase();
  }
  if (spendSymbol && wantSymbol && spendSymbol === wantSymbol) {
    return { unreadable: t(`That swaps ${spendSymbol} into itself.`, `Bu ${spendSymbol} tokenını kendisine çevirir.`) };
  }
  let network: NetworkKey | undefined;
  if (venue) {
    if (venue.venue.category !== "dex" && venue.venue.category !== "launchpad" && venue.venue.category !== "aggregator") {
      return { unreadable: t(`${venue.venue.label} is not a place to swap.`, `${venue.venue.label} swap yapılacak bir yer değil.`) };
    }
    network = networkKey(ctx.environment, venue.venue.family);
    if (venue.venue.mainnetOnly && ctx.environment === "testnet") {
      return { unreadable: t(`${venue.venue.label} is announced for Elysium mainnet and has no testnet deployment.`, `${venue.venue.label} Elysium mainnet için duyuruldu; testnet'te yok.`) };
    }
    venueWarning(ctx, venue.venue);
    if (where && where.family !== venue.venue.family) {
      return { unreadable: t(`${venue.venue.label} is on ${NETWORK_LABEL[venue.venue.family]}, not ${where.family === "hyperliquid" ? "Hyperliquid" : NETWORK_LABEL[where.family]}.`, `${venue.venue.label} ${NETWORK_LABEL[venue.venue.family]} üzerinde.`) };
    }
  } else if (where && where.family !== "hyperliquid") {
    network = networkKey(ctx.environment, where.family);
  } else if (chained && ctx.prev?.network) {
    network = ctx.prev.network;
  } else {
    network = swapNetwork(ctx, spendSymbol, wantSymbol);
  }
  for (const [symbol, field] of [[spendSymbol, "spend"], [wantSymbol, "want"]] as const) {
    if (!symbol) continue;
    const tok = bag.toks.find((entry): entry is TokOf<"asset"> => entry.k === "asset" && entry.symbol === symbol);
    if (tok && (tok.typo || tok.lookalike || !tok.listed)) {
      const confirmed = confirmAsset(ctx, tok, field);
      if (confirmed === null) return { goal: undefined };
      if (field === "spend") spendSymbol = confirmed;
      else wantSymbol = confirmed;
    }
  }
  if (network && spendSymbol && wantSymbol) {
    const missing = [spendSymbol, wantSymbol].find((symbol) => symbol !== "*stable" && !tokenOn(network as NetworkKey, symbol) && !isEcosystem(symbol, network as NetworkKey));
    if (missing) return { unreadable: t(`${missing} is not a token Elyia knows on ${NETWORK_LABEL[familyOf(network)]}.`, `${missing}, ${NETWORK_LABEL[familyOf(network)]} üzerinde Elyia'nın bildiği bir token değil.`) };
  }
  let spendAmount: AmountSel | null;
  if (chained) spendAmount = chainedAmount(ctx, { amount, chained } as Spend);
  else spendAmount = amountFor(ctx, amount, "amount", spendSymbol);
  spendAmount = checkBalance(ctx, network, spendSymbol, spendAmount);
  if (spendSymbol) lookalikeNote(ctx, spendSymbol, network);
  if (wantSymbol) lookalikeNote(ctx, wantSymbol, network);
  const op = verb === "wrap" || verb === "unwrap" ? verb : venue ? "swap" : (spendSymbol === "HYPE" && wantSymbol === "WHYPE") ? "wrap" : (spendSymbol === "WHYPE" && wantSymbol === "HYPE") ? "unwrap" : "swap";
  const from: Place | undefined = network ? { network, custody: WALLET } : undefined;
  const goal: ValueGoal = {
    kind: "convert",
    op,
    spend: { ...(spendSymbol ? { asset: sym(spendSymbol) } : {}), ...(spendAmount ? { amount: spendAmount } : {}), ...(from ? { from } : {}) },
    want: { ...(wantSymbol ? { asset: sym(wantSymbol) } : {}) },
    holder: { t: "self" },
    constraints: venue ? { via: [venue.venue.id] } : {},
    ...(chained && ctx.prev ? { chain: { after: ctx.prev.chainParent ?? ctx.prev.index } } : {}),
    confidence: "exact",
  };
  return {
    goal: value(goal),
    prev: {
      index: ctx.goal,
      family: "value",
      ...(wantSymbol ? { asset: wantSymbol } : {}),
      ...(network ? { network } : {}),
      used: 0,
    },
  };
}

function isEcosystem(symbol: string, network: NetworkKey): boolean {
  return familyOf(network) === "elysium" && ["KALOS", "stKALOS", "PERPME"].includes(symbol);
}

/** True when the balance facts cover every one of `networks` (a partial list proves nothing about the rest). */
function coversAll(ctx: FrameCtx, networks: readonly string[]): boolean {
  const covered = ctx.facts.balanceNetworks;
  return !covered || networks.every((network) => covered.includes(network));
}

/** Swap network from what holds the tokens; asks when both Elysium and HyperEVM could. */
function swapNetwork(ctx: FrameCtx, spend: string | undefined, want: string | undefined): NetworkKey | undefined {
  const symbols = [spend, want].filter((symbol): symbol is string => Boolean(symbol) && symbol !== "*stable");
  const candidates = (["elysium", "hyperevm"] as const).filter((family) => {
    const key = networkKey(ctx.environment, family);
    return symbols.every((symbol) => tokenOn(key, symbol) !== null || isEcosystem(symbol, key));
  });
  if (candidates.length === 1) {
    const network = networkKey(ctx.environment, candidates[0] as Family);
    ctx.clar.assume(ctx.goal, "network", t(`on ${NETWORK_LABEL[candidates[0] as Family]} (the only network with both tokens)`, `${NETWORK_LABEL[candidates[0] as Family]} üzerinde (iki tokenın da olduğu tek ağ)`), false);
    return network;
  }
  if (candidates.length === 0) return undefined;
  const held = spend && ctx.facts.balances && coversAll(ctx, candidates.map((family) => networkKey(ctx.environment, family))) ? candidates.filter((family) => ctx.facts.balances?.some((entry) => entry.network === networkKey(ctx.environment, family) && entry.symbol.toUpperCase() === spend.toUpperCase() && Number(entry.amount) > 0)) : [];
  if (held.length === 1) {
    ctx.clar.assume(ctx.goal, "network", t(`on ${NETWORK_LABEL[held[0] as Family]} (where your ${spend} is)`, `${NETWORK_LABEL[held[0] as Family]} üzerinde (${spend} orada)`), true);
    return networkKey(ctx.environment, held[0] as Family);
  }
  const answer = ask(ctx, "network", "NETWORK_AMBIGUOUS", {
    prompt: t("Swap on which network?", "Hangi ağda swap yapılsın?"),
    options: NETWORK_OPTIONS(ctx.environment, candidates, "elysium"),
  });
  return answer?.option ? networkKey(ctx.environment, answer.option as Family) : undefined;
}

/* ------------------------------------------------------- bridge and move */

function readMove(verb: Verb, bag: Bag, ctx: FrameCtx): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const spend = spendOf(ctx, bag, amounts, { exclude: ["to"] });
  let symbol = spend.symbol;
  const flagMirror = bag.take("flag", (tok) => tok.flag === "mirror");
  const flagCanonical = bag.take("flag", (tok) => tok.flag === "canonical");
  const named = bag.find("venue", (tok) => venueById(tok.id)?.category === "bridge");
  if (named) bag.use(named.index);
  const via = named ? named.tok.id : flagMirror ? "elysium-mirror-bridge" : flagCanonical ? "elysium-canonical-bridge" : undefined;
  let dest = takePlace(bag, ["to"]);
  let source = takePlace(bag, ["from"]);
  if (!dest) {
    const bare = takePlace(bag, [undefined, "on"]);
    if (bare) dest = bare;
  }
  if (spend.chained && !source && ctx.prev?.network) source = { family: familyOf(ctx.prev.network), ...(ctx.prev.hypercore ? { cls: ctx.prev.hypercore } : {}), span: [0, 0] };
  if (!symbol) {
    const answer = ask(ctx, "spend.asset", "INPUT_ASSET_MISSING", {
      prompt: t("Move which token?", "Hangi token taşınsın?"),
      options: [{ id: "HYPE", en: "HYPE", tr: "HYPE" }, { id: "USDC", en: "USDC", tr: "USDC" }],
      allowsText: true,
    });
    if (answer) symbol = answer.option ?? answer.text?.toUpperCase();
  }
  if (dest?.family === "hyperliquid" || !dest) {
    const answer = ask(ctx, "destination", "DESTINATION_MISSING", {
      prompt: dest ? t("Hyperliquid has two layers: move it to HyperCore (spot or perps) or to HyperEVM?", "Hyperliquid'in iki katmanı var: HyperCore'a (spot veya perp) mı, HyperEVM'e mi?") : t("Move it where?", "Nereye taşınsın?"),
      options: [
        ...(dest ? [] : [{ id: "elysium", en: "Elysium", tr: "Elysium" }]),
        { id: "hyperevm", en: "HyperEVM", tr: "HyperEVM" },
        { id: "hypercore-spot", en: "HyperCore spot", tr: "HyperCore spot" },
        { id: "hypercore-perp", en: "HyperCore perps", tr: "HyperCore perp" },
      ],
    });
    dest = answer?.option ? placeAnswer(answer.option) : null;
  }
  if (source?.family === "hyperliquid") {
    const answer = ask(ctx, "source", "SOURCE_MISSING", {
      prompt: t("From HyperCore or from HyperEVM?", "HyperCore'dan mı, HyperEVM'den mi?"),
      options: [{ id: "hyperevm", en: "HyperEVM", tr: "HyperEVM" }, { id: "hypercore-spot", en: "HyperCore spot", tr: "HyperCore spot" }, { id: "hypercore-perp", en: "HyperCore perps", tr: "HyperCore perp" }],
    });
    source = answer?.option ? placeAnswer(answer.option) : null;
  }
  if (dest && dest.family !== "hyperliquid" && !source) source = defaultSource(ctx, dest as { family: Family; cls?: "spot" | "perp" }, symbol);
  if (dest && source && dest.family === source.family && (dest.family !== "hypercore" || (dest.cls ?? "unknown") === (source.cls ?? "unknown"))) {
    return { unreadable: t("That moves it to where it already is.", "Bu zaten bulunduğu yere taşır.") };
  }
  if (dest && source && dest.family !== "hyperliquid" && source.family !== "hyperliquid") {
    const pair = `${source.family}>${dest.family}`;
    if (pair === "elysium>hypercore" || pair === "hypercore>elysium") {
      return { unreadable: t("Elysium and HyperCore are not linked directly: say both legs (for example bridge to HyperEVM, then move to HyperCore).", "Elysium ve HyperCore doğrudan bağlı değil: iki adımı da yazın (önce HyperEVM'e köprüle, sonra HyperCore'a taşı).") };
    }
  }
  let amount: AmountSel | null;
  if (spend.chained) amount = chainedAmount(ctx, spend);
  else amount = amountFor(ctx, spend.amount, "amount", symbol);
  const from = source && source.family !== "hyperliquid" ? placeOf(ctx, source as { family: Family; cls?: "spot" | "perp" }) : undefined;
  const at = dest && dest.family !== "hyperliquid" ? placeOf(ctx, dest as { family: Family; cls?: "spot" | "perp" }) : undefined;
  if (symbol && from?.network && !tokenOn(from.network, symbol) && from.custody.kind !== "hypercore") {
    return { unreadable: t(`${symbol} is not a token Elyia knows on ${NETWORK_LABEL[familyOf(from.network)]}.`, `${symbol}, ${NETWORK_LABEL[familyOf(from.network)]} üzerinde Elyia'nın bildiği bir token değil.`) };
  }
  amount = checkBalance(ctx, from?.network, symbol, amount);
  const op = verb === "bridge" ? "bridge" : verb === "deposit" ? "deposit" : verb === "withdraw" ? "withdraw" : "move";
  const goal: ValueGoal = {
    kind: "relocate",
    op,
    spend: { ...(symbol ? { asset: sym(symbol) } : {}), ...(amount ? { amount } : {}), ...(from ? { from } : {}) },
    want: { ...(at ? { at } : {}) },
    holder: { t: "self" },
    constraints: via ? { via: [via] } : {},
    ...(spend.chained && ctx.prev ? { chain: { after: ctx.prev.chainParent ?? ctx.prev.index } } : {}),
    confidence: "exact",
  };
  const hypercoreClass = at?.custody.kind === "hypercore" && at.custody.class !== "unknown" ? at.custody.class : undefined;
  return {
    goal: value(goal),
    prev: { index: ctx.goal, family: "value", ...(symbol ? { asset: symbol } : {}), ...(at?.network ? { network: at.network } : {}), ...(hypercoreClass ? { hypercore: hypercoreClass } : {}), used: 0 },
  };
}

function placeAnswer(option: string): PlaceRead {
  if (option === "hypercore-spot") return { family: "hypercore", cls: "spot", span: [0, 0] };
  if (option === "hypercore-perp") return { family: "hypercore", cls: "perp", span: [0, 0] };
  return { family: option as Family, span: [0, 0] };
}

/** Where a move starts when only the destination was said. */
function defaultSource(ctx: FrameCtx, dest: { family: Family; cls?: "spot" | "perp" }, symbol: string | undefined): PlaceRead | null {
  if (dest.family === "elysium") {
    ctx.clar.assume(ctx.goal, "source", t("from HyperEVM (Elysium's bridge side)", "HyperEVM'den (Elysium köprüsünün diğer ucu)"), false);
    return { family: "hyperevm", span: [0, 0] };
  }
  if (dest.family === "hypercore" && dest.cls !== "perp" && dest.cls !== "spot") {
    ctx.clar.assume(ctx.goal, "source", t("from HyperEVM", "HyperEVM'den"), false);
    return { family: "hyperevm", span: [0, 0] };
  }
  const options = dest.family === "hyperevm"
    ? [{ id: "elysium", en: "From Elysium", tr: "Elysium'dan" }, { id: "hypercore-spot", en: "From HyperCore spot", tr: "HyperCore spot'tan" }]
    : [{ id: "hyperevm", en: "From HyperEVM", tr: "HyperEVM'den" }, { id: dest.cls === "perp" ? "hypercore-spot" : "hypercore-perp", en: dest.cls === "perp" ? "From HyperCore spot" : "From HyperCore perps", tr: dest.cls === "perp" ? "HyperCore spot'tan" : "HyperCore perp'ten" }];
  const held = symbol && ctx.facts.balances && coversAll(ctx, options.map((option) => networkKey(ctx.environment, placeAnswer(option.id).family as Family)))
    ? options.filter((option) => {
        const place = placeAnswer(option.id);
        const network = networkKey(ctx.environment, place.family as Family);
        return ctx.facts.balances?.some((entry) => entry.network === network && entry.symbol.toUpperCase() === symbol.toUpperCase() && Number(entry.amount) > 0);
      })
    : [];
  if (held.length === 1) {
    ctx.clar.assume(ctx.goal, "source", t(`${(held[0] as { en: string }).en.toLowerCase()} (where your ${symbol} is)`, `${(held[0] as { tr: string }).tr} (${symbol} orada)`), true);
    return placeAnswer((held[0] as { id: string }).id);
  }
  const answer = ask(ctx, "source", "SOURCE_MISSING", { prompt: t("Move it from where?", "Nereden taşınsın?"), options });
  return answer?.option ? placeAnswer(answer.option) : null;
}

/* ----------------------------------------------------------------- send */

function readSend(bag: Bag, ctx: FrameCtx, resolved: ReadonlyMap<string, string>): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const spend = spendOf(ctx, bag, amounts, { exclude: ["to"] });
  let symbol = spend.symbol;
  const addr = bag.take("addr");
  const name = addr ? null : bag.take("name");
  let holder: ValueGoal["holder"] | undefined = addr ? { t: "address", value: addr.value } : undefined;
  if (name) {
    const address = resolved.get(name.value);
    if (address) {
      holder = { t: "address", value: address };
      ctx.clar.assume(ctx.goal, "recipient", t(`${name.value} is ${address} (Elysium Names)`, `${name.value} = ${address} (Elysium Names)`), true);
    } else if (resolved.has(`!${name.value}`)) {
      const answer = ask(ctx, "recipient", "RECIPIENT_UNRESOLVED", {
        prompt: t(`${name.value} is not registered on Elysium Names. Send to which address?`, `${name.value} Elysium Names'te kayıtlı değil. Hangi adrese gönderilsin?`),
        options: [],
        allowsText: true,
        placeholder: t("0x address", "0x adresi"),
      });
      holder = answer?.text && /^0x[0-9a-fA-F]{40}$/u.test(answer.text) ? { t: "address", value: answer.text } : undefined;
    } else {
      holder = { t: "name", value: name.value };
      ctx.clar.warn("NAME_UNRESOLVED", t(`${name.value} is resolved through Elysium Names when the transfer is planned.`, `${name.value} transfer planlanırken Elysium Names ile çözülür.`), name.span);
    }
  }
  const self = bag.take("self");
  if (!holder && self) {
    return readMove("move", bag, ctx);
  }
  if (!holder) {
    const nick = bag.find("unknown");
    const answer = ask(ctx, "recipient", "RECIPIENT_MISSING", {
      prompt: t("Send it to which address (0x… or a .ely name)?", "Hangi adrese gönderilsin (0x… veya .ely adı)?"),
      options: [],
      allowsText: true,
      placeholder: t("0x… or name.ely", "0x… veya ad.ely"),
    });
    if (nick) return { unreadable: t("Elyia never guesses who a nickname is: give a 0x address or a .ely name.", "Elyia bir takma adın kim olduğunu tahmin etmez: 0x adresi veya .ely adı yazın.") };
    if (answer?.text) {
      if (/^0x[0-9a-fA-F]{40}$/u.test(answer.text)) holder = { t: "address", value: answer.text };
      else if (/^[a-z0-9-]+\.ely$/u.test(answer.text.toLowerCase())) holder = { t: "name", value: answer.text.toLowerCase() };
    }
  }
  const where = takePlace(bag, ["on", undefined, "from", "to"]);
  let network: NetworkKey | undefined;
  if (where && where.family !== "hyperliquid") network = networkKey(ctx.environment, where.family);
  else if (spend.chained && ctx.prev?.network) network = ctx.prev.network;
  else if (name) {
    network = networkKey(ctx.environment, "elysium");
    ctx.clar.assume(ctx.goal, "network", t("on Elysium (where .ely names live)", "Elysium üzerinde (.ely adlarının ağı)"), false);
  } else {
    const held = symbol && ctx.facts.balances && coversAll(ctx, (["elysium", "hyperevm", "hypercore"] as const).map((family) => networkKey(ctx.environment, family))) ? (["elysium", "hyperevm"] as const).filter((family) => ctx.facts.balances?.some((entry) => entry.network === networkKey(ctx.environment, family) && entry.symbol.toUpperCase() === (symbol as string).toUpperCase() && Number(entry.amount) > 0)) : [];
    if (held.length === 1) {
      network = networkKey(ctx.environment, held[0] as Family);
      ctx.clar.assume(ctx.goal, "network", t(`on ${NETWORK_LABEL[held[0] as Family]} (where your ${symbol} is)`, `${NETWORK_LABEL[held[0] as Family]} üzerinde`), true);
    } else {
      const answer = ask(ctx, "network", "TRANSFER_NETWORK", {
        prompt: t("Send on which network? The same address exists on each, and the funds only arrive on the one you pick.", "Hangi ağda gönderilsin? Aynı adres her ağda var; para yalnızca seçtiğiniz ağa gider."),
        options: NETWORK_OPTIONS(ctx.environment, ["elysium", "hyperevm", "hypercore"]),
      });
      network = answer?.option ? networkKey(ctx.environment, answer.option as Family) : undefined;
    }
  }
  if (!symbol) {
    const answer = ask(ctx, "spend.asset", "INPUT_ASSET_MISSING", { prompt: t("Send which token?", "Hangi token gönderilsin?"), options: [{ id: "HYPE", en: "HYPE", tr: "HYPE" }, { id: "USDC", en: "USDC", tr: "USDC" }], allowsText: true });
    if (answer) symbol = answer.option ?? answer.text?.toUpperCase();
  }
  if (symbol && network && familyOf(network) !== "hypercore" && !tokenOn(network, symbol)) {
    return { unreadable: t(`${symbol} is not a token Elyia knows on ${NETWORK_LABEL[familyOf(network)]}.`, `${symbol}, ${NETWORK_LABEL[familyOf(network)]} üzerinde bilinen bir token değil.`) };
  }
  let amount = spend.chained ? chainedAmount(ctx, spend) : amountFor(ctx, spend.amount, "amount", symbol);
  amount = checkBalance(ctx, network, symbol, amount);
  const from: Place | undefined = network ? (familyOf(network) === "hypercore" ? { network, custody: { kind: "hypercore", class: "spot" } } : { network, custody: WALLET }) : undefined;
  const goal: ValueGoal = {
    kind: "deliver",
    op: "send",
    spend: { ...(symbol ? { asset: sym(symbol) } : {}), ...(amount ? { amount } : {}), ...(from ? { from } : {}) },
    want: {},
    holder: holder ?? { t: "nickname" },
    constraints: {},
    ...(spend.chained && ctx.prev ? { chain: { after: ctx.prev.chainParent ?? ctx.prev.index } } : {}),
    confidence: "exact",
  };
  return { goal: value(goal), prev: { index: ctx.goal, family: "value", ...(symbol ? { asset: symbol } : {}), ...(network ? { network } : {}), used: 0 } };
}

/* ------------------------------------------------------- stake / unstake */

function readStake(bag: Bag, ctx: FrameCtx): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const spend = spendOf(ctx, bag, amounts, { exclude: ["to", "on"] });
  let symbol = spend.symbol ?? "HYPE";
  const named = bag.find("venue");
  if (named) bag.use(named.index);
  const nativeFlag = bag.take("flag", (tok) => tok.flag === "native");
  const where = takePlace(bag, ["on", undefined, "from", "to"]);
  const receiptAsset = bag.find("asset", (tok) => tok.role === "to" || tok.role === "on");
  let venue: VenueWord | null = named ? venueById(named.tok.id) : null;
  if (receiptAsset) {
    const byReceipt = VENUE_WORDS.find((entry) => entry.stakes?.receipt.toLowerCase() === receiptAsset.tok.symbol.toLowerCase());
    if (byReceipt) {
      bag.use(receiptAsset.index);
      venue = venue ?? byReceipt;
    }
  }
  if (!venue && (nativeFlag || where?.family === "hypercore")) venue = venueById("hypercore-staking");
  if (!venue) venue = VENUE_WORDS.find((entry) => entry.stakes?.asset.toLowerCase() === symbol.toLowerCase()) ?? null;
  if (!venue) return { unreadable: t(`Elyia knows no staking for ${symbol}.`, `Elyia ${symbol} için bir staking bilmiyor.`) };
  if (venue.category !== "liquid-staking" && venue.category !== "staking" && venue.category !== "vault") {
    return { unreadable: t(`${venue.label} does not stake.`, `${venue.label} staking yapmaz.`) };
  }
  if (venue.stakes && spend.symbol === undefined) symbol = venue.stakes.asset;
  if (venue.stakes && venue.stakes.asset !== symbol) return { unreadable: t(`${venue.label} stakes ${venue.stakes.asset}, not ${symbol}.`, `${venue.label} ${symbol} değil ${venue.stakes.asset} stake eder.`) };
  if (!named && !receiptAsset && venue.id === "kinetiq") {
    ctx.clar.assume(ctx.goal, "venue", t("with Kinetiq (kHYPE) on HyperEVM", "Kinetiq (kHYPE) ile HyperEVM'de"), true);
  }
  venueWarning(ctx, venue);
  const network = networkKey(ctx.environment, venue.family);
  if (where && where.family !== "hyperliquid" && where.family !== venue.family) {
    if (venue.id === "kinetiq" && where.family === "elysium") {
      return { unreadable: t("Kinetiq stakes HYPE on HyperEVM, not on Elysium: stake there first, or bridge kHYPE to Elysium after staking.", "Kinetiq HYPE'ı Elysium'da değil HyperEVM'de stake eder: önce orada stake edin, sonra kHYPE'ı Elysium'a köprüleyin.") };
    }
    return { unreadable: t(`${venue.label} is on ${NETWORK_LABEL[venue.family]}.`, `${venue.label} ${NETWORK_LABEL[venue.family]} üzerinde.`) };
  }
  if (spend.chained && venue.id === "kinetiq" && stakeOrder(ctx)) {
    const order = stakeOrderQuestion(ctx);
    if (!order) return {};
    const bps = spend.amount?.kind === "portion" ? (spend.amount.bps as number) : spend.amount?.kind === "max" || !spend.amount ? 10_000 : spend.amount.kind === "rest" ? 10_000 - (ctx.prev?.used ?? 0) : 0;
    if (bps <= 0) return { unreadable: t("Say what share to stake (for example half).", "Ne kadarının stake edileceğini yazın (örneğin yarısı).") };
    return { reorder: { mode: order, after: ctx.prev?.chainParent ?? (ctx.prev?.index as number), bps } };
  }
  const amount = spend.chained ? chainedAmount(ctx, spend) : amountFor(ctx, spend.amount, "amount", symbol);
  const goal: ValueGoal = {
    kind: "stake",
    op: "stake",
    spend: { asset: { symbol }, ...(amount ? { amount: checkBalance(ctx, network, symbol, amount) ?? amount } : {}), from: { network, custody: venue.family === "hypercore" ? { kind: "hypercore", class: "spot" } : WALLET } },
    want: venue.stakes ? { asset: { symbol: venue.stakes.receipt } } : { at: { network, custody: { kind: "venue", protocol: venue.id, category: "staking" } } },
    holder: { t: "self" },
    constraints: { via: [venue.id] },
    ...(spend.chained && ctx.prev ? { chain: { after: ctx.prev.chainParent ?? ctx.prev.index } } : {}),
    confidence: "exact",
  };
  return { goal: value(goal), prev: { index: ctx.goal, family: "value", ...(venue.stakes ? { asset: venue.stakes.receipt } : {}), network, used: 0 } };
}

/** "bridge 20 HYPE to Elysium and stake half": staking happens on HyperEVM, so the order must change. */
function stakeOrderQuestion(ctx: FrameCtx): "stake-first" | "bridge-only" | null {
  const answer = ask(ctx, "order", "STAKE_ORDER", {
    prompt: t("Kinetiq stakes on HyperEVM, not Elysium. Stake that part on HyperEVM first and bridge the rest, or only bridge?", "Kinetiq HyperEVM'de stake eder, Elysium'da değil. O kısmı önce HyperEVM'de stake edip kalanı mı köprüleyelim, yoksa sadece köprü mü?"),
    options: [
      { id: "stake-first", en: "Stake on HyperEVM first, bridge the rest", tr: "Önce HyperEVM'de stake et, kalanı köprüle" },
      { id: "bridge-only", en: "Only bridge", tr: "Sadece köprüle" },
    ],
  });
  return (answer?.option as "stake-first" | "bridge-only" | undefined) ?? null;
}

function readUnstake(bag: Bag, ctx: FrameCtx): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const spend = spendOf(ctx, bag, amounts, { exclude: ["to", "on"] });
  const named = bag.find("venue");
  if (named) bag.use(named.index);
  const nativeFlag = bag.take("flag", (tok) => tok.flag === "native");
  const where = takePlace(bag, ["on", undefined, "from"]);
  let symbol = spend.symbol ?? (named ? venueById(named.tok.id)?.stakes?.receipt : undefined) ?? "kHYPE";
  let venue: VenueWord | null = named ? venueById(named.tok.id) : VENUE_WORDS.find((entry) => entry.stakes?.receipt.toLowerCase() === symbol.toLowerCase()) ?? null;
  if (nativeFlag || where?.family === "hypercore") venue = venueById("hypercore-staking");
  if (!venue && symbol === "HYPE") venue = null;
  let route: "venue" | "swap" | null = venue && (named || venue.id !== "kinetiq") ? "venue" : null;
  if (!route) {
    const answer = ask(ctx, "route", "UNSTAKE_ROUTE", {
      prompt: symbol === "HYPE"
        ? t("Unstake which HYPE: kHYPE through Kinetiq (queue, protocol rate), sell kHYPE now on a DEX (market price), or native HyperCore staking?", "Hangi HYPE: kHYPE'ı Kinetiq ile mi çözelim (sıra, protokol kuru), kHYPE'ı şimdi bir DEX'te mi satalım (piyasa fiyatı), yoksa HyperCore yerel staking mi?")
        : t(`Unstake ${symbol} through Kinetiq (queue, protocol rate) or sell it for HYPE now on a DEX (market price)?`, `${symbol} Kinetiq ile mi çözülsün (sıra, protokol kuru), yoksa şimdi bir DEX'te HYPE'a mı satılsın (piyasa fiyatı)?`),
      options: [
        { id: "kinetiq", en: "Unstake through Kinetiq (wait for the queue)", tr: "Kinetiq ile çöz (sırayı bekle)" },
        { id: "swap", en: "Swap kHYPE for HYPE now", tr: "kHYPE'ı şimdi HYPE'a çevir" },
        ...(symbol === "HYPE" ? [{ id: "native", en: "Native HyperCore staking", tr: "HyperCore yerel staking" }] : []),
      ],
    });
    if (answer?.option === "kinetiq") {
      venue = venueById("kinetiq");
      route = "venue";
      if (symbol === "HYPE") symbol = "kHYPE";
    } else if (answer?.option === "native") {
      venue = venueById("hypercore-staking");
      route = "venue";
    } else if (answer?.option === "swap") {
      route = "swap";
      if (symbol === "HYPE") symbol = "kHYPE";
    }
  }
  if (route === "swap") {
    const network = where && where.family !== "hyperliquid" && where.family !== "hypercore" ? networkKey(ctx.environment, where.family) : swapNetwork(ctx, symbol, "HYPE");
    const amount = amountFor(ctx, spend.amount, "amount", symbol);
    const goal: ValueGoal = {
      kind: "convert",
      op: "swap",
      spend: { asset: { symbol }, ...(amount ? { amount } : {}), ...(network ? { from: { network, custody: WALLET } } : {}) },
      want: { asset: { symbol: "HYPE" } },
      holder: { t: "self" },
      constraints: {},
      confidence: "exact",
    };
    return { goal: value(goal), prev: { index: ctx.goal, family: "value", asset: "HYPE", ...(network ? { network } : {}), used: 0 } };
  }
  if (!venue || !route) {
    const amount = spend.amount ? amountSel(spend.amount) : null;
    return { goal: value({ kind: "unstake", op: "unstake", spend: { asset: { symbol }, ...(amount ? { amount } : {}) }, want: {}, holder: { t: "self" }, constraints: {}, confidence: "exact" }) };
  }
  venueWarning(ctx, venue);
  const network = networkKey(ctx.environment, venue.family);
  const amount = amountFor(ctx, spend.amount, "amount", symbol);
  const goal: ValueGoal = {
    kind: "unstake",
    op: "unstake",
    spend: { asset: { symbol }, ...(amount ? { amount } : {}), from: { network, custody: venue.family === "hypercore" ? { kind: "venue", protocol: venue.id, category: "staking" } : WALLET } },
    want: { asset: { symbol: venue.stakes?.asset ?? "HYPE" } },
    holder: { t: "self" },
    constraints: { via: [venue.id] },
    confidence: "exact",
  };
  return { goal: value(goal), prev: { index: ctx.goal, family: "value", asset: venue.stakes?.asset ?? "HYPE", network, used: 0 } };
}

/* ---------------------------------------------------------------- lending */

const LENDING = VENUE_WORDS.filter((venue) => venue.category === "lending");

function readLending(verb: Verb, bag: Bag, ctx: FrameCtx): FrameResult {
  const amounts = amountsOf(bag, { percentAsPortion: true });
  const named = bag.find("venue", (tok) => venueById(tok.id)?.category === "lending" || venueById(tok.id)?.category === "vault");
  if (named) bag.use(named.index);
  const spend = spendOf(ctx, bag, amounts, { exclude: ["to", "on"] });
  let symbol = spend.symbol;
  let venue = named ? (venueById(named.tok.id) as VenueWord) : null;
  if (!venue) {
    const answer = ask(ctx, "venue", "DESTINATION_MISSING", {
      prompt: verb === "withdraw" || verb === "repay" ? t("From which lending market?", "Hangi borç verme piyasasından?") : t("On which lending market?", "Hangi borç verme piyasasında?"),
      options: LENDING.map((entry) => ({ id: entry.id, en: entry.label, tr: entry.label })),
    });
    venue = answer?.option ? venueById(answer.option) : null;
  }
  if (venue) venueWarning(ctx, venue);
  const network = venue ? networkKey(ctx.environment, venue.family) : networkKey(ctx.environment, "elysium");
  if (!symbol) {
    const answer = ask(ctx, "asset", "INPUT_ASSET_MISSING", { prompt: t("Which token?", "Hangi token?"), options: [{ id: "USDC", en: "USDC", tr: "USDC" }, { id: "WHYPE", en: "WHYPE", tr: "WHYPE" }], allowsText: true });
    if (answer) symbol = answer.option ?? answer.text?.toUpperCase();
  }
  const amount = amountFor(ctx, spend.amount, "amount", symbol);
  const custody = { kind: "venue" as const, ...(venue ? { protocol: venue.id } : {}), category: venue?.category === "vault" ? ("vault" as const) : ("lending" as const) };
  const via = venue ? { via: [venue.id] } : {};
  const asset = symbol ? { asset: sym(symbol) } : {};
  let goal: ValueGoal;
  if (verb === "withdraw") {
    goal = { kind: "exit", op: "withdraw", spend: { ...asset, ...(amount ? { amount } : {}), from: { network, custody } }, want: { ...asset }, holder: { t: "self" }, constraints: via, confidence: "exact" };
  } else if (verb === "borrow") {
    goal = { kind: "borrow", op: "borrow", spend: {}, want: { ...asset, ...(amount ? { amount } : {}), at: { network, custody: WALLET } }, holder: { t: "self" }, constraints: via, confidence: "exact" };
  } else if (verb === "repay") {
    goal = { kind: "repay", op: "repay", spend: { ...asset, ...(amount ? { amount } : {}), from: { network, custody: WALLET } }, want: { at: { network, custody: { kind: "loan", ...(venue ? { protocol: venue.id } : {}) } } }, holder: { t: "self" }, constraints: via, confidence: "exact" };
  } else {
    goal = { kind: "earn", op: "lend", spend: { ...asset, ...(amount ? { amount } : {}), from: { network, custody: WALLET } }, want: { at: { network, custody } }, holder: { t: "self" }, constraints: via, confidence: "exact" };
  }
  return { goal: value(goal), prev: { index: ctx.goal, family: "value", ...(symbol ? { asset: symbol } : {}), network, used: 0 } };
}

/* -------------------------------------------------------------- dispatch */

export interface ValueOptions {
  /** .ely name -> address (and `!name` for names known to be unregistered). */
  readonly resolved: ReadonlyMap<string, string>;
}

/** Reads a value clause; the caller checks the bag for leftovers. */
export function readValueClause(verb: Verb, bag: Bag, ctx: FrameCtx, options: ValueOptions): FrameResult {
  const venue = bag.find("venue");
  const venueRow = venue ? venueById(venue.tok.id) : null;
  switch (verb) {
    case "swap":
    case "wrap":
    case "unwrap":
      return readSwap(verb, bag, ctx);
    case "buy":
    case "sell":
      return readSwap(verb, bag, ctx);
    case "bridge":
    case "move":
      if (bag.has("addr") || bag.has("name")) return readSend(bag, ctx, options.resolved);
      return readMove(verb, bag, ctx);
    case "deposit":
      if (venueRow?.category === "lending" || venueRow?.id === "hypercore-vaults") return readLending("lend", bag, ctx);
      if (venueRow?.stakes) return readStake(bag, ctx);
      return readMove("deposit", bag, ctx);
    case "withdraw":
      if (venueRow?.category === "lending" || venueRow?.category === "vault") return readLending("withdraw", bag, ctx);
      return readMove("withdraw", bag, ctx);
    case "send":
      if (!bag.has("addr") && !bag.has("name") && (bag.find("network", (tok) => tok.role === "to") || bag.find("account", (tok) => tok.role === "to"))) return readMove("move", bag, ctx);
      return readSend(bag, ctx, options.resolved);
    case "stake":
      return readStake(bag, ctx);
    case "unstake":
      return readUnstake(bag, ctx);
    case "lend":
    case "borrow":
    case "repay":
      return readLending(verb, bag, ctx);
    default:
      return { unreadable: t("That is not a value move.", "Bu bir değer transferi değil.") };
  }
}

export type { Tok };
