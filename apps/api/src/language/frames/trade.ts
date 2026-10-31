/**
 * Trade frames (HyperCore): open long/short, spot buy/sell orders, close,
 * reduce, flatten, cancel, TWAP, set leverage, TP/SL. Leverage, side, size
 * basis, limit price and stop basis are the person's purpose: missing or
 * ambiguous ones are asked, never filled in.
 */
import type { LanguageGoal, MarketSel, PriceSel, SizeSel, TradeGoal, Trigger } from "@elyia/core";
import { TWAP_MINUTES_RANGE } from "@elyia/core";
import { t } from "../clarify.js";
import { marketsFor, type MarketFact } from "../entities.js";
import { readNumber } from "../numbers.js";
import type { Tok, TokOf, Verb } from "../types.js";
import { venueById } from "../venues.js";
import { amountsOf, ask, parseAmountAnswer, specOf, useAll, type AmountItem, type Bag, type FrameCtx } from "./common.js";
import type { FrameResult } from "./value.js";

const STABLES = new Set(["USDC", "USDH", "USDT0", "USDT", "*stable"]);

function trade(goal: TradeGoal): LanguageGoal {
  return { t: "trade", goal };
}

interface MarketPick {
  readonly sel: MarketSel;
  readonly fact?: MarketFact;
}

/** The market of a trade clause: an explicit market token, or a coin (asset) that is not the quote. */
function pickMarket(bag: Bag, ctx: FrameCtx, kind: "perp" | "spot" | undefined, sizing: readonly AmountItem[]): MarketPick | null | "unknown" | { readonly asked: string } {
  const explicit = bag.find("market");
  let coin: string | undefined;
  let dex: string | undefined;
  let explicitKind: "perp" | "spot" | undefined;
  if (explicit) {
    bag.use(explicit.index);
    coin = explicit.tok.coin;
    dex = explicit.tok.dex;
    explicitKind = explicit.tok.kind;
  } else {
    const sized = sizing.find((item) => item.symbol && !STABLES.has(item.symbol));
    const asset = sized ? null : bag.find("asset", (tok) => !STABLES.has(tok.symbol) && tok.role !== "with" && tok.role !== "worth");
    if (asset) bag.use(asset.index);
    coin = sized?.symbol ?? asset?.tok.symbol;
  }
  if (!coin) return null;
  const wanted = explicitKind ?? kind;
  if (coin.startsWith("@")) return { sel: { coin, kind: "spot" } };
  const facts = marketsFor(ctx.facts.markets, coin, wanted).filter((fact) => dex === undefined || (fact.dex ?? "") === dex);
  if (facts.length === 0) {
    if (dex) return { sel: { coin, kind: "perp", dex } };
    return "unknown";
  }
  const perps = facts.filter((fact) => fact.kind === "perp");
  if (wanted === "perp" && perps.length > 1 && dex === undefined && !perps.some((fact) => !fact.dex)) {
    const answer = ask(ctx, "market", "MARKET_AMBIGUOUS", {
      prompt: t(`${coin} trades on several perp dexes. Which one?`, `${coin} birden fazla perp borsasında işlem görüyor. Hangisi?`),
      options: perps.map((fact) => ({ id: fact.dex ?? "", en: `${fact.dex}:${fact.coin}`, tr: `${fact.dex}:${fact.coin}` })),
    });
    if (!answer?.option) return { asked: coin };
    const fact = perps.find((entry) => (entry.dex ?? "") === answer.option) as MarketFact;
    return { sel: { coin: fact.coin, kind: "perp", ...(fact.dex ? { dex: fact.dex } : {}) }, fact };
  }
  const fact = (wanted === "spot" ? facts.find((entry) => entry.kind === "spot") : perps.find((entry) => !entry.dex) ?? perps[0]) ?? facts[0];
  if (!fact) return "unknown";
  return { sel: { coin: fact.coin, kind: wanted ?? fact.kind, ...(fact.dex ? { dex: fact.dex } : {}) }, fact };
}

type Picked = MarketPick | null | "unknown" | { readonly asked: string };

function isAsked(picked: Picked): picked is { readonly asked: string } {
  return typeof picked === "object" && picked !== null && "asked" in picked;
}

function marketUnknown(ctx: FrameCtx, bag: Bag): FrameResult {
  const word = bag.toks.find((tok): tok is TokOf<"asset"> => tok.k === "asset" && !STABLES.has(tok.symbol));
  return { unreadable: t(`${word?.symbol ?? "That"} is not a HyperCore market Elyia knows.`, `${word?.symbol ?? "Bu"}, Elyia'nın bildiği bir HyperCore piyasası değil.`) };
}

function askMarket(ctx: FrameCtx, what: { en: string; tr: string }): MarketPick | null {
  const answer = ask(ctx, "market", "MARKET_UNKNOWN", { prompt: what, options: [], allowsText: true, placeholder: t("market (BTC, ETH, HYPE…)", "piyasa (BTC, ETH, HYPE…)") });
  if (!answer?.text) return null;
  const facts = marketsFor(ctx.facts.markets, answer.text, "perp");
  const fact = facts.find((entry) => !entry.dex) ?? facts[0];
  return fact ? { sel: { coin: fact.coin, kind: "perp", ...(fact.dex ? { dex: fact.dex } : {}) }, fact } : null;
}

/* ------------------------------------------------------------ pieces */

function leverageOf(bag: Bag, ctx: FrameCtx, fact: MarketFact | undefined, required: boolean): TradeGoal["leverage"] | null | undefined {
  const lev = bag.take("lev");
  bag.take("levword");
  const marginTok = bag.take("margin");
  const mode = marginTok?.mode;
  let x: number | "max" | undefined = lev?.x;
  if (lev?.invalid) {
    const low = Math.max(1, Math.floor(Number(lev.invalid.replace(",", "."))));
    const answer = ask(ctx, "leverage", "LEVERAGE_FORMAT", {
      prompt: t(`HyperCore leverage is a whole number: ${low}x or ${low + 1}x?`, `HyperCore kaldıracı tam sayıdır: ${low}x mi ${low + 1}x mi?`),
      options: [{ id: String(low), en: `${low}x`, tr: `${low}x` }, { id: String(low + 1), en: `${low + 1}x`, tr: `${low + 1}x` }],
    });
    if (!answer?.option) return null;
    x = Number(answer.option);
  }
  if (x === "max") {
    if (fact?.maxLeverage) {
      x = fact.maxLeverage;
      ctx.clar.assume(ctx.goal, "leverage", t(`${x}x (the market's maximum)`, `${x}x (piyasanın en yüksek kaldıracı)`), true);
    } else {
      x = undefined;
    }
  }
  if (x === undefined) {
    if (!required) return mode ? { x: 1, mode } : undefined;
    const spec = specOf(ctx, "leverage", "LEVERAGE_MISSING", {
      prompt: t("What leverage?", "Kaç kaldıraç?"),
      options: [1, 2, 3, 5, 10].filter((value) => !fact?.maxLeverage || value <= fact.maxLeverage).map((value) => ({ id: String(value), en: `${value}x`, tr: `${value}x` })),
      allowsText: true,
      placeholder: t("for example 5x", "örneğin 5x"),
    });
    const answer = ctx.clar.ask(spec);
    if (!answer) return null;
    const typed = answer.option ?? (answer.text as string).replace(/x$/iu, "").replace(/^x/iu, "");
    const value = Number(typed);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      ctx.clar.reject(spec, t("Leverage is a whole number such as 3 or 10.", "Kaldıraç 3 veya 10 gibi bir tam sayıdır."));
      return null;
    }
    x = value;
  }
  if (fact?.maxLeverage && x > fact.maxLeverage) {
    const answer = ask(ctx, "leverage.max", "LEVERAGE_ABOVE_MAX", {
      prompt: t(`${fact.coin} allows at most ${fact.maxLeverage}x. Use ${fact.maxLeverage}x?`, `${fact.coin} en fazla ${fact.maxLeverage}x kaldıraç destekler. ${fact.maxLeverage}x kullanılsın mı?`),
      options: [{ id: "max", en: `Use ${fact.maxLeverage}x`, tr: `${fact.maxLeverage}x kullan` }],
      allowsText: true,
    });
    if (!answer) return null;
    x = answer.option === "max" ? fact.maxLeverage : Number((answer.text as string).replace(/x$/iu, ""));
    if (!Number.isInteger(x) || x < 1 || x > fact.maxLeverage) return null;
  }
  let finalMode = mode;
  if (!finalMode) {
    finalMode = fact?.onlyIsolated ? "isolated" : "cross";
    ctx.clar.assume(ctx.goal, "margin", fact?.onlyIsolated ? t("isolated margin (the market is isolated-only)", "izole marjin (piyasa yalnızca izole)") : t("cross margin", "çapraz marjin"), true);
  }
  return { x, mode: finalMode };
}

/** Sizing of an open or order: base units, USD notional, USD margin, or a portion of the account. */
function sizeOf(bag: Bag, ctx: FrameCtx, sizing: AmountItem[], coin: string, leverage: number | undefined, spot: boolean): SizeSel | null {
  const marginFlag = bag.find("flag", (tok) => tok.flag === "margin");
  const notionalFlag = bag.find("flag", (tok) => tok.flag === "notional");
  const base = sizing.find((item) => item.symbol && item.symbol.toUpperCase() === coin.toUpperCase());
  if (base && base.kind === "exact") {
    useAll(bag, base.indexes);
    return { t: "base", value: base.value as string };
  }
  const usd = sizing.find((item) => item.kind === "usd" || (item.symbol !== undefined && STABLES.has(item.symbol)));
  const bare = sizing.find((item) => item.kind === "exact" && !item.symbol);
  const portion = sizing.find((item) => item.kind === "portion" || item.kind === "max");
  if (usd && usd.kind !== "portion" && usd.value) {
    useAll(bag, usd.indexes);
    const ofNext = bag.nextAfter(usd.indexes[usd.indexes.length - 1] as number);
    const isOf = ofNext && ofNext.tok.k === "prep" && ofNext.tok.role === "of";
    if (isOf) bag.use(ofNext.index);
    if (marginFlag || usd.role === "with") {
      if (marginFlag) bag.use(marginFlag.index);
      if (spot) return { t: "notional", usd: usd.value };
      return { t: "margin", usd: usd.value };
    }
    if (notionalFlag || usd.role === "worth" || isOf || spot || leverage === 1) {
      if (notionalFlag) bag.use(notionalFlag.index);
      return { t: "notional", usd: usd.value };
    }
    const answer = ask(ctx, "size.basis", "SIZE_BASIS_AMBIGUOUS", {
      prompt: t(`Is ${usd.value} USD the position size (notional) or the margin you put in?`, `${usd.value} USD pozisyon büyüklüğü (nosyonel) mü, yoksa koyduğunuz marjin mi?`),
      options: [
        { id: "notional", en: `$${usd.value} position size`, tr: `$${usd.value} pozisyon büyüklüğü`, ...(leverage ? { detail: t(`margin about $${trimDecimal(Number(usd.value) / leverage)}`, `marjin yaklaşık $${trimDecimal(Number(usd.value) / leverage)}`) } : {}) },
        { id: "margin", en: `$${usd.value} margin`, tr: `$${usd.value} marjin`, ...(leverage ? { detail: t(`position about $${trimDecimal(Number(usd.value) * leverage)}`, `pozisyon yaklaşık $${trimDecimal(Number(usd.value) * leverage)}`) } : {}) },
      ],
    });
    if (!answer?.option) return null;
    return answer.option === "margin" ? { t: "margin", usd: usd.value } : { t: "notional", usd: usd.value };
  }
  if (bare && bare.value) {
    useAll(bag, bare.indexes);
    if (marginFlag) {
      bag.use(marginFlag.index);
      return spot ? { t: "notional", usd: bare.value } : { t: "margin", usd: bare.value };
    }
    if (notionalFlag) {
      bag.use(notionalFlag.index);
      return { t: "notional", usd: bare.value };
    }
    const answer = ask(ctx, "size.basis", "SIZE_BASIS_AMBIGUOUS", {
      prompt: t(`${bare.value} what: ${coin}, or USD?`, `${bare.value} ne: ${coin} mi, USD mi?`),
      options: [
        { id: "base", en: `${bare.value} ${coin}`, tr: `${bare.value} ${coin}` },
        { id: "notional", en: `$${bare.value} position size`, tr: `$${bare.value} pozisyon büyüklüğü` },
        ...(spot ? [] : [{ id: "margin", en: `$${bare.value} margin`, tr: `$${bare.value} marjin` }]),
      ],
    });
    if (!answer?.option) return null;
    if (answer.option === "base") return { t: "base", value: bare.value };
    return answer.option === "margin" ? { t: "margin", usd: bare.value } : { t: "notional", usd: bare.value };
  }
  if (portion) {
    useAll(bag, portion.indexes);
    if (portion.kind === "max") return { t: "max" };
    return { t: "portion", bps: portion.bps as number, of: "accountValue" };
  }
  const spec = specOf(ctx, "size", "AMOUNT_MISSING", {
    prompt: t(`How big? A ${coin} amount, or USD.`, `Ne büyüklükte? ${coin} miktarı veya USD.`),
    options: [],
    allowsText: true,
    placeholder: t(`0.5 ${coin} or $500`, `0,5 ${coin} veya $500`),
  });
  const answer = ctx.clar.ask(spec);
  if (!answer?.text) return null;
  const typed = answer.text.trim();
  const isUsd = /^\$|usd|usdc|dolar/iu.test(typed);
  const parsed = parseAmountAnswer(typed.replace(new RegExp(`\\s*${coin}$`, "iu"), ""), ctx.locale, readNumber);
  if (!parsed) {
    ctx.clar.reject(spec, t("Type a size such as 0.5 or $500.", "0,5 veya $500 gibi bir büyüklük yazın."));
    return null;
  }
  if (isUsd) return spot || leverage === 1 ? { t: "notional", usd: parsed } : { t: "notional", usd: parsed };
  return { t: "base", value: parsed };
}

function trimDecimal(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "?";
}

/** A limit price: "at 3000", "@ 3000", "limit 3000", "3000 limit", TR "3000'den" / "3000 fiyatından". */
function priceOf(bag: Bag, ctx: FrameCtx, field = "price"): PriceSel | null | undefined {
  const at = bag.find("prep", (tok) => tok.role === "at");
  if (at) {
    const next = bag.nextAfter(at.index);
    if (next && next.tok.k === "num" && !next.tok.pct && !next.tok.usd && !bag.isUsed(next.index)) {
      bag.use(at.index);
      bag.use(next.index);
      bag.take("order", (tok) => tok.t === "limit");
      return { t: "limit", px: next.tok.value };
    }
    const prev = bag.prevBefore(at.index);
    if (ctx.locale === "tr" && prev && prev.tok.k === "num" && !prev.tok.pct && !bag.isUsed(prev.index)) {
      bag.use(at.index);
      bag.use(prev.index);
      bag.take("order", (tok) => tok.t === "limit");
      return { t: "limit", px: prev.tok.value };
    }
  }
  const limit = bag.find("order", (tok) => tok.t === "limit");
  const market = bag.take("order", (tok) => tok.t === "market");
  if (limit) {
    bag.use(limit.index);
    const next = bag.nextAfter(limit.index);
    const prev = bag.prevBefore(limit.index);
    for (const near of [next, prev]) {
      if (near && near.tok.k === "num" && !near.tok.pct && !near.tok.usd && !bag.isUsed(near.index) && !isSized(bag, near.index)) {
        bag.use(near.index);
        return { t: "limit", px: near.tok.value };
      }
    }
    const spec = specOf(ctx, field, "PRICE_MISSING", { prompt: t("Limit at what price?", "Limit fiyatı ne olsun?"), options: [], allowsText: true, placeholder: t("price", "fiyat") });
    const answer = ctx.clar.ask(spec);
    if (!answer?.text) return null;
    const parsed = parseAmountAnswer(answer.text, ctx.locale, readNumber);
    if (!parsed) {
      ctx.clar.reject(spec, t("Type the price as a number.", "Fiyatı sayı olarak yazın."));
      return null;
    }
    return { t: "limit", px: parsed };
  }
  if (ctx.locale === "tr") {
    const from = bag.find("num", (tok) => tok.role === "from" && !tok.pct && !tok.usd && !isSized(bag, bag.toks.indexOf(tok)));
    if (from) {
      bag.use(from.index);
      return { t: "limit", px: from.tok.value };
    }
  }
  return market ? undefined : undefined;
}

/** True when the number at `index` is followed by an asset (it is a size, not a price). */
function isSized(bag: Bag, index: number): boolean {
  const next = bag.nextAfter(index);
  return Boolean(next && next.tok.k === "asset");
}

interface TriggerRead {
  readonly kind: "tp" | "sl";
  readonly num?: TokOf<"num">;
  readonly breakeven?: boolean;
  readonly entry?: boolean;
  readonly index: number;
}

/** Reads every TP/SL in the clause ("tp 4000", "stop at -3%", "sl 3% below entry", TR "stop %3", "3200'den stop"). */
function triggersOf(bag: Bag): TriggerRead[] | "bad" {
  const out: TriggerRead[] = [];
  for (const hit of bag.all("tpsl")) {
    bag.use(hit.index);
    let cursor = hit.index;
    let num: TokOf<"num"> | undefined;
    let breakeven = false;
    let entry = false;
    for (let step = 0; step < 4; step += 1) {
      const next = bag.nextAfter(cursor);
      if (!next || bag.isUsed(next.index)) break;
      const tok = next.tok;
      if (tok.k === "prep" && (tok.role === "at" || tok.role === "to" || tok.role === "of")) {
        bag.use(next.index);
        cursor = next.index;
        continue;
      }
      if (tok.k === "num" && !num && !isSized(bag, next.index)) {
        num = tok;
        bag.use(next.index);
        cursor = next.index;
        continue;
      }
      if (tok.k === "flag" && tok.flag === "breakeven") {
        breakeven = true;
        bag.use(next.index);
        cursor = next.index;
        continue;
      }
      if (num && tok.k === "cmp" && (tok.op === "<" || tok.op === ">")) {
        bag.use(next.index);
        cursor = next.index;
        continue;
      }
      if (num && tok.k === "flag" && (tok.flag === "entry" || tok.flag === "mark")) {
        entry = true;
        bag.use(next.index);
        cursor = next.index;
        continue;
      }
      break;
    }
    if (!num && !breakeven) {
      // Turkish order: "3200'den stop", "girişten %3 aşağıda stop".
      let at = hit.index;
      for (let step = 0; step < 3 && !num; step += 1) {
        const prev = bag.prevBefore(at);
        if (!prev || bag.isUsed(prev.index)) break;
        const tok = prev.tok;
        if (tok.k === "num") {
          num = tok;
          bag.use(prev.index);
        } else if (tok.k === "cmp" && (tok.op === "<" || tok.op === ">")) {
          bag.use(prev.index);
        } else if (tok.k === "flag" && (tok.flag === "entry" || tok.flag === "mark")) {
          entry = true;
          bag.use(prev.index);
        } else break;
        at = prev.index;
      }
      if (num && !entry) {
        const before = bag.prevBefore(at);
        if (before && !bag.isUsed(before.index) && before.tok.k === "flag" && before.tok.flag === "entry") {
          entry = true;
          bag.use(before.index);
        }
      }
    }
    if (!num && !breakeven) return "bad";
    out.push({ kind: hit.tok.kind, ...(num ? { num } : {}), ...(breakeven ? { breakeven } : {}), ...(entry ? { entry } : {}), index: hit.index });
  }
  return out;
}

function triggerOf(ctx: FrameCtx, read: TriggerRead, side: "long" | "short" | "buy" | "sell" | undefined, leverage: number | undefined): Trigger | null {
  if (read.breakeven) return { kind: read.kind, px: { t: "breakeven" }, exec: "market" };
  const num = read.num as TokOf<"num">;
  if (!num.pct) return { kind: read.kind, px: { t: "limit", px: num.value }, exec: "market" };
  const long = side === "long" || side === "buy";
  const dir = (read.kind === "sl") === long ? "below" : "above";
  let pct = num.value;
  if (!read.entry && (leverage === undefined || leverage > 1)) {
    const word = read.kind === "sl" ? t("stop", "stop") : t("take profit", "kâr al");
    const answer = ask(ctx, `${read.kind}.basis`, "STOP_BASIS", {
      prompt: t(`Is the ${num.value}% ${word.en} a ${num.value}% price move, or ${num.value}% of your margin?`, `%${num.value} ${word.tr} fiyatta %${num.value} hareket mi, marjininizin %${num.value}'i mi?`),
      options: [
        { id: "price", en: `${num.value}% price move`, tr: `Fiyatta %${num.value}` },
        { id: "margin", en: `${num.value}% of margin`, tr: `Marjinin %${num.value}'i`, ...(leverage ? { detail: t(`a ${trimDecimal(Number(num.value) / leverage)}% price move at ${leverage}x`, `${leverage}x'te fiyatta %${trimDecimal(Number(num.value) / leverage)}`) } : {}) },
      ],
    });
    if (!answer?.option) return null;
    if (answer.option === "margin") {
      if (!leverage) return null;
      pct = trimPct(Number(num.value) / leverage);
      ctx.clar.assume(ctx.goal, `${read.kind}.price`, t(`${num.value}% of margin = ${pct}% price move at ${leverage}x`, `marjinin %${num.value}'i = ${leverage}x'te fiyatta %${pct}`), true);
    }
  }
  return { kind: read.kind, px: { t: "offset", pct, from: "entry", dir }, exec: "market" };
}

function trimPct(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return String(rounded);
}

function tifOf(bag: Bag): TradeGoal["tif"] | undefined {
  const tif = bag.take("order", (tok) => tok.t === "alo" || tok.t === "ioc" || tok.t === "gtc");
  return tif ? (tif.t as "alo" | "ioc" | "gtc") : undefined;
}

function slippageOf(bag: Bag): number | undefined {
  const flag = bag.find("flag", (tok) => tok.flag === "slippage");
  if (!flag) return undefined;
  bag.use(flag.index);
  const near = [bag.nextAfter(flag.index), bag.prevBefore(flag.index)].find((entry) => entry && entry.tok.k === "num" && entry.tok.pct);
  if (!near) return undefined;
  bag.use(near.index);
  return Math.round(Number((near.tok as TokOf<"num">).value) * 100);
}

/* ------------------------------------------------------------- frames */

export type TradeIntent = "open" | "order" | "close" | "reduce" | "flatten" | "cancel" | "twap" | "setLeverage" | "protect";

export interface TradeInput {
  readonly intent: TradeIntent;
  readonly side?: "long" | "short" | "buy" | "sell";
  readonly kind?: "perp" | "spot";
}

function openFrame(bag: Bag, ctx: FrameCtx, input: TradeInput): FrameResult {
  const spot = input.kind === "spot";
  bag.take("side");
  // Stops, targets and the limit price first: their numbers are not sizes.
  const triggers = triggersOf(bag);
  if (triggers === "bad") return { unreadable: t("Give the stop or take profit as a price or a percent.", "Stop veya kâr al seviyesini fiyat ya da yüzde olarak yazın.") };
  const price = priceOf(bag, ctx);
  const sizing = amountsOf(bag, { percentAsPortion: false });
  const picked = pickMarket(bag, ctx, input.kind ?? "perp", sizing);
  if (picked === "unknown") return marketUnknown(ctx, bag);
  let market: MarketPick | null = isAsked(picked) ? null : picked;
  const askedCoin = isAsked(picked) ? picked.asked : undefined;
  if (picked === null) market = askMarket(ctx, t(input.side === "short" ? "Short which market?" : "Long which market?", input.side === "short" ? "Hangi piyasada short?" : "Hangi piyasada long?"));
  const fact = market?.fact;
  const leverage = spot ? undefined : leverageOf(bag, ctx, fact, input.intent === "open");
  const levX = leverage && typeof leverage.x === "number" ? leverage.x : undefined;
  const sizeCoin = market?.sel.coin ?? askedCoin;
  const size = sizeCoin ? sizeOf(bag, ctx, sizing, sizeCoin, levX ?? (leverage === null ? undefined : 1), spot) : null;
  const side = input.side;
  let tp: Trigger | null | undefined;
  let sl: Trigger | null | undefined;
  for (const read of triggers) {
    const trigger = triggerOf(ctx, read, side, levX);
    if (read.kind === "tp") tp = trigger;
    else sl = trigger;
  }
  const tif = tifOf(bag);
  const reduceOnly = bag.take("order", (tok) => tok.t === "reduceOnly");
  const slippage = slippageOf(bag);
  bag.take("flag", (tok) => tok.flag === (spot ? "spotword" : "perpword"));
  bag.take("scope", (tok) => tok.what === "position");
  const goal: TradeGoal = {
    kind: input.intent === "open" ? "open" : "order",
    market: market?.sel ?? { coin: "?", kind: spot ? "spot" : "perp" },
    ...(side ? { side } : {}),
    ...(size ? { size } : {}),
    ...(leverage ? { leverage } : {}),
    ...(price ? { price } : {}),
    ...(tif ? { tif } : {}),
    ...(reduceOnly ? { reduceOnly: true } : {}),
    ...(tp ? { tp } : {}),
    ...(sl ? { sl } : {}),
    ...(slippage !== undefined ? { maxSlippageBps: slippage } : {}),
    confidence: "exact",
  };
  return { goal: trade(goal), prev: { index: ctx.goal, family: "trade", ...(market ? { market: market.sel } : {}), used: 0 } };
}

/** The position a close/reduce/protect talks about: a named market, the only open one, or a question. */
function positionMarket(bag: Bag, ctx: FrameCtx, allowAll: boolean): MarketSel | { all: true } | null | "unknown" {
  const scope = bag.find("scope", (tok) => tok.what === "positions" || tok.what === "everything");
  const all = bag.find("qty", (tok) => tok.q === "all");
  const picked = pickMarket(bag, ctx, "perp", []);
  if (picked === "unknown") return "unknown";
  if (isAsked(picked)) return null;
  if (picked) {
    bag.take("scope", (tok) => tok.what === "position" || tok.what === "positions");
    return picked.sel;
  }
  if (allowAll && (scope || (all && !bag.has("num")))) {
    if (scope) bag.use(scope.index);
    if (all) bag.use(all.index);
    return { all: true };
  }
  if (ctx.prev?.family === "trade" && ctx.prev.market && ctx.link) return ctx.prev.market;
  bag.take("scope", (tok) => tok.what === "position");
  const positions = ctx.facts.positions ?? [];
  const side = bag.find("side");
  const matching = positions.filter((position) => !side || position.side === side.tok.side);
  if (matching.length === 1) {
    const only = matching[0] as { coin: string };
    ctx.clar.assume(ctx.goal, "market", t(`your ${only.coin} position (your only open one)`, `${only.coin} pozisyonunuz (tek açık pozisyon)`), true);
    return { coin: only.coin, kind: "perp" };
  }
  const answer = ask(ctx, "market", "POSITION_AMBIGUOUS", {
    prompt: t("Which position?", "Hangi pozisyon?"),
    options: [
      ...matching.slice(0, 6).map((position) => ({ id: position.coin, en: `${position.coin} ${position.side}`, tr: `${position.coin} ${position.side}` })),
      ...(allowAll ? [{ id: "*", en: "All positions", tr: "Tüm pozisyonlar" }] : []),
    ],
    allowsText: true,
    placeholder: t("market", "piyasa"),
  });
  if (!answer) return null;
  if (answer.option === "*") return { all: true };
  const coin = answer.option ?? answer.text?.toUpperCase();
  return coin ? { coin, kind: "perp" } : null;
}

function closeFrame(bag: Bag, ctx: FrameCtx, input: TradeInput): FrameResult {
  if (input.intent === "flatten") {
    bag.take("scope");
    bag.take("qty", (tok) => tok.q === "all");
    if (bag.has("market") || bag.has("asset")) return { unreadable: t("Flatten closes every position; to close one, say close and the market.", "Flatten tüm pozisyonları kapatır; birini kapatmak için kapat ve piyasayı yazın.") };
    return { goal: trade({ kind: "close", market: { all: true }, confidence: "exact" }) };
  }
  const sizing = amountsOf(bag, { percentAsPortion: true }).filter((item) => item.kind === "portion" || item.kind === "max");
  const portion = sizing.find((item) => item.kind === "portion");
  if (portion) useAll(bag, portion.indexes);
  const market = positionMarket(bag, ctx, true);
  if (market === "unknown") return marketUnknown(ctx, bag);
  const sideTok = bag.take("side");
  bag.take("qty", (tok) => tok.q === "all");
  bag.take("scope");
  bag.take("flag", (tok) => tok.flag === "perpword");
  const price = priceOf(bag, ctx);
  const reduce = input.intent === "reduce" || Boolean(portion);
  let size: SizeSel | undefined = portion ? { t: "portion", bps: portion.bps as number, of: "position" } : undefined;
  if (reduce && !size) {
    const answer = ask(ctx, "size", "AMOUNT_MISSING", {
      prompt: t("Reduce by how much?", "Ne kadar azaltılsın?"),
      options: [{ id: "2500", en: "25%", tr: "%25" }, { id: "5000", en: "Half", tr: "Yarısı" }, { id: "7500", en: "75%", tr: "%75" }],
      allowsText: true,
    });
    if (answer?.option) size = { t: "portion", bps: Number(answer.option), of: "position" };
    else if (answer?.text) {
      const pct = Number(answer.text.replace(/[%\s]/gu, "").replace(",", "."));
      if (pct > 0 && pct <= 100) size = { t: "portion", bps: Math.round(pct * 100), of: "position" };
    }
  }
  if (market && "all" in market && reduce) return { unreadable: t("Reduce one position at a time: say which market.", "Pozisyonları tek tek azaltın: hangi piyasa olduğunu yazın.") };
  const goal: TradeGoal = {
    kind: reduce && size?.t === "portion" && size.bps < 10_000 ? "reduce" : "close",
    market: market ?? { coin: "?", kind: "perp" },
    ...(sideTok ? { side: sideTok.side } : {}),
    ...(reduce && size && size.t === "portion" && size.bps < 10_000 ? { size } : {}),
    ...(price ? { price } : {}),
    confidence: "exact",
  };
  return { goal: trade(goal), prev: { index: ctx.goal, family: "trade", ...(market && "coin" in market ? { market } : {}), used: 0 } };
}

function cancelFrame(bag: Bag, ctx: FrameCtx): FrameResult {
  bag.take("scope", (tok) => tok.what === "orders" || tok.what === "everything");
  const all = bag.take("qty", (tok) => tok.q === "all");
  const picked = pickMarket(bag, ctx, undefined, []);
  if (picked === "unknown") return marketUnknown(ctx, bag);
  bag.take("order", (tok) => tok.t === "limit");
  bag.take("tpsl");
  const named = picked && !isAsked(picked) ? picked : null;
  const market: TradeGoal["market"] = named ? named.sel : { all: true };
  if (!all && !named) ctx.clar.assume(ctx.goal, "market", t("every market", "tüm piyasalar"), false);
  return { goal: trade({ kind: "cancel", market, confidence: "exact" }) };
}

function twapFrame(bag: Bag, ctx: FrameCtx, input: TradeInput): FrameResult {
  bag.take("side");
  const sizing = amountsOf(bag, { percentAsPortion: false });
  const kind = input.kind ?? "perp";
  const picked = pickMarket(bag, ctx, kind, sizing);
  if (picked === "unknown") return marketUnknown(ctx, bag);
  const market = isAsked(picked) || picked === null ? askMarket(ctx, t("TWAP which market?", "Hangi piyasada TWAP?")) : picked;
  const dur = bag.take("dur");
  bag.take("prep", (tok) => tok.role === "over");
  const random = bag.take("flag", (tok) => tok.flag === "random");
  const reduceOnly = bag.take("order", (tok) => tok.t === "reduceOnly");
  bag.take("flag", (tok) => tok.flag === (kind === "spot" ? "spotword" : "perpword"));
  const leverage = kind === "perp" && bag.has("lev") ? leverageOf(bag, ctx, market?.fact, false) : undefined;
  const size = market ? sizeOf(bag, ctx, sizing, market.sel.coin, leverage && typeof leverage.x === "number" ? leverage.x : 1, kind === "spot") : null;
  let minutes = dur?.minutes;
  if (minutes === undefined || minutes < TWAP_MINUTES_RANGE.min || minutes > TWAP_MINUTES_RANGE.max) {
    const answer = ask(ctx, "twap.minutes", "DURATION_RANGE", {
      prompt: minutes === undefined ? t("Spread it over how long?", "Ne kadar süreye yayılsın?") : t("A HyperCore TWAP runs 5 minutes to 24 hours. Over how long?", "HyperCore TWAP 5 dakika ile 24 saat arasında çalışır. Ne kadar sürsün?"),
      options: [{ id: "30", en: "30 minutes", tr: "30 dakika" }, { id: "60", en: "1 hour", tr: "1 saat" }, { id: "240", en: "4 hours", tr: "4 saat" }, { id: "1440", en: "24 hours", tr: "24 saat" }],
    });
    minutes = answer?.option ? Number(answer.option) : undefined;
  }
  const goal: TradeGoal = {
    kind: "twap",
    market: market?.sel ?? { coin: "?", kind },
    ...(input.side ? { side: input.side } : {}),
    ...(size ? { size } : {}),
    ...(leverage ? { leverage } : {}),
    ...(reduceOnly ? { reduceOnly: true } : {}),
    ...(minutes !== undefined ? { twap: { minutes, ...(random ? { randomize: true } : {}) } } : {}),
    confidence: "exact",
  };
  return { goal: trade(goal), prev: { index: ctx.goal, family: "trade", ...(market ? { market: market.sel } : {}), used: 0 } };
}

function leverageFrame(bag: Bag, ctx: FrameCtx): FrameResult {
  const picked = pickMarket(bag, ctx, "perp", []);
  if (picked === "unknown") return marketUnknown(ctx, bag);
  let market = isAsked(picked) ? null : picked;
  if (!market && ctx.prev?.family === "trade" && ctx.prev.market && ctx.link) market = { sel: ctx.prev.market };
  if (!market && !isAsked(picked)) market = askMarket(ctx, t("Set leverage on which market?", "Hangi piyasada kaldıraç ayarlansın?"));
  bag.take("scope", (tok) => tok.what === "position");
  bag.take("flag", (tok) => tok.flag === "perpword");
  const leverage = leverageOf(bag, ctx, market?.fact, true);
  return { goal: trade({ kind: "setLeverage", market: market?.sel ?? { coin: "?", kind: "perp" }, ...(leverage ? { leverage } : {}), confidence: "exact" }) };
}

function protectFrame(bag: Bag, ctx: FrameCtx): FrameResult {
  const market = positionMarket(bag, ctx, true);
  if (market === "unknown") return marketUnknown(ctx, bag);
  const sideTok = bag.take("side");
  bag.take("scope");
  bag.take("flag", (tok) => tok.flag === "perpword");
  const triggers = triggersOf(bag);
  if (triggers === "bad" || triggers.length === 0) return { unreadable: t("Give the stop or take profit as a price or a percent.", "Stop veya kâr al seviyesini fiyat ya da yüzde olarak yazın.") };
  const position = market && "coin" in market ? ctx.facts.positions?.find((entry) => entry.coin.toUpperCase() === market.coin.toUpperCase()) : undefined;
  const side = sideTok?.side ?? position?.side;
  let tp: Trigger | null | undefined;
  let sl: Trigger | null | undefined;
  for (const read of triggers) {
    if (read.num?.pct && !side) {
      ask(ctx, "side", "SIDE_MISSING", { prompt: t("Is it a long or a short?", "Long mu short mu?"), options: [{ id: "long", en: "Long", tr: "Long" }, { id: "short", en: "Short", tr: "Short" }] });
      continue;
    }
    const trigger = triggerOf(ctx, read, side, position?.leverage);
    if (read.kind === "tp") tp = trigger;
    else sl = trigger;
  }
  const goal: TradeGoal = {
    kind: "protect",
    market: market ?? { coin: "?", kind: "perp" },
    ...(side ? { side } : {}),
    ...(tp ? { tp } : {}),
    ...(sl ? { sl } : {}),
    confidence: "exact",
  };
  return { goal: trade(goal) };
}

export function readTradeClause(bag: Bag, ctx: FrameCtx, input: TradeInput): FrameResult {
  const venue = bag.find("venue");
  if (venue) {
    const row = venueById(venue.tok.id);
    return { unreadable: t(`Elyia trades on HyperCore; ${row?.label ?? "that venue"} trading is not supported.`, `Elyia HyperCore'da işlem yapar; ${row?.label ?? "bu platform"} desteklenmiyor.`) };
  }
  // A HyperCore network word is just where it happens.
  bag.take("network", (tok) => tok.family === "hypercore" || tok.family === "hyperliquid");
  switch (input.intent) {
    case "open":
    case "order":
      return openFrame(bag, ctx, input);
    case "close":
    case "reduce":
    case "flatten":
      return closeFrame(bag, ctx, input);
    case "cancel":
      return cancelFrame(bag, ctx);
    case "twap":
      return twapFrame(bag, ctx, input);
    case "setLeverage":
      return leverageFrame(bag, ctx);
    case "protect":
      return protectFrame(bag, ctx);
  }
}

export function isPerpSignal(tok: Tok): boolean {
  return tok.k === "side" || tok.k === "lev" || tok.k === "levword" || tok.k === "margin" || (tok.k === "market" && tok.kind === "perp") || (tok.k === "flag" && tok.flag === "perpword");
}

export type { Verb };
