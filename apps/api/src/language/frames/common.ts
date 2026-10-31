/**
 * Shared pieces of the frame readers: the token bag (every meaningful token
 * must be used or the clause is not read), amount groups, places, and the
 * per-clause context.
 */
import { layersFor, type AmountSel, type NetworkEnvironment, type NetworkKey } from "@elyia/core";
import type { LanguageReason } from "@elyia/core/api/language";
import { t, type AskSpec, type Clarifier } from "../clarify.js";
import type { MarketFact } from "../entities.js";
import type { Locale } from "../numbers.js";
import type { QtyWord, Role, Span, Tok, TokOf } from "../types.js";
import { venueById, type VenueWord } from "../venues.js";

export interface ReaderFacts {
  readonly markets: readonly MarketFact[];
  readonly balances?: readonly { readonly network: string; readonly symbol: string; readonly amount: string }[];
  readonly positions?: readonly { readonly coin: string; readonly side: "long" | "short"; readonly size: string; readonly leverage?: number }[];
  /** Reference USD prices by symbol (HyperCore mainnet mids). */
  readonly prices?: Readonly<Record<string, string>>;
  readonly timezone?: string;
  readonly telegramLinked?: boolean;
  /** ms since epoch (rule expiries). */
  readonly now: number;
}

/** What the previous goal of the sentence produced, for "and swap half to USDC". */
export interface Previous {
  readonly index: number;
  readonly family: "value" | "trade";
  readonly asset?: string;
  readonly network?: NetworkKey;
  readonly hypercore?: "spot" | "perp";
  readonly market?: { readonly coin: string; readonly kind: "perp" | "spot"; readonly dex?: string };
  /** Portion (bps) of the previous output already used by chained goals. */
  readonly used: number;
  readonly chainParent?: number;
}

export interface FrameCtx {
  readonly locale: Locale;
  readonly environment: NetworkEnvironment;
  readonly facts: ReaderFacts;
  readonly clar: Clarifier;
  /** Index of the goal this clause becomes (questions point at it). */
  readonly goal: number;
  /** Question id prefix ("g0", "g1.b0"). */
  readonly qid: string;
  readonly prev?: Previous;
  readonly inRule: boolean;
  /** Link to the previous clause. */
  readonly link: "then" | "and" | null;
}

export function ask(ctx: FrameCtx, field: string, reason: LanguageReason, spec: Omit<AskSpec, "id" | "goal" | "field" | "reason">) {
  return ctx.clar.ask({ id: `${ctx.qid}.${field}`, goal: ctx.goal, field, reason, ...spec });
}

export function specOf(ctx: FrameCtx, field: string, reason: LanguageReason, spec: Omit<AskSpec, "id" | "goal" | "field" | "reason">): AskSpec {
  return { id: `${ctx.qid}.${field}`, goal: ctx.goal, field, reason, ...spec };
}

/* ------------------------------------------------------------------ bag */

const IGNORABLE = new Set(["noise", "punct", "prep", "conn", "usd", "self"]);

export class Bag {
  private readonly used = new Set<number>();

  constructor(readonly toks: readonly Tok[]) {}

  get size(): number {
    return this.toks.length;
  }

  find<K extends Tok["k"]>(kind: K, predicate: (tok: TokOf<K>, index: number) => boolean = () => true): { tok: TokOf<K>; index: number } | null {
    for (let index = 0; index < this.toks.length; index += 1) {
      const tok = this.toks[index] as Tok;
      if (tok.k === kind && !this.used.has(index) && predicate(tok as TokOf<K>, index)) return { tok: tok as TokOf<K>, index };
    }
    return null;
  }

  all<K extends Tok["k"]>(kind: K, predicate: (tok: TokOf<K>, index: number) => boolean = () => true): Array<{ tok: TokOf<K>; index: number }> {
    const out: Array<{ tok: TokOf<K>; index: number }> = [];
    this.toks.forEach((tok, index) => {
      if (tok.k === kind && !this.used.has(index) && predicate(tok as TokOf<K>, index)) out.push({ tok: tok as TokOf<K>, index });
    });
    return out;
  }

  has(kind: Tok["k"]): boolean {
    return this.find(kind) !== null;
  }

  take<K extends Tok["k"]>(kind: K, predicate?: (tok: TokOf<K>, index: number) => boolean): TokOf<K> | null {
    const hit = this.find(kind, predicate);
    if (!hit) return null;
    this.used.add(hit.index);
    return hit.tok;
  }

  use(index: number): void {
    this.used.add(index);
  }

  isUsed(index: number): boolean {
    return this.used.has(index);
  }

  at(index: number): Tok | undefined {
    return this.toks[index];
  }

  /** Meaningful tokens no reader used. */
  leftovers(): Tok[] {
    return this.toks.filter((tok, index) => !this.used.has(index) && !IGNORABLE.has(tok.k));
  }

  /** The next unused token after `index` that is not noise. */
  nextAfter(index: number): { tok: Tok; index: number } | null {
    for (let at = index + 1; at < this.toks.length; at += 1) {
      const tok = this.toks[at] as Tok;
      if (tok.k === "noise" || tok.k === "usd") continue;
      return { tok, index: at };
    }
    return null;
  }

  prevBefore(index: number): { tok: Tok; index: number } | null {
    for (let at = index - 1; at >= 0; at -= 1) {
      const tok = this.toks[at] as Tok;
      if (tok.k === "noise") continue;
      return { tok, index: at };
    }
    return null;
  }
}

/* -------------------------------------------------------------- amounts */

export interface AmountItem {
  readonly kind: "exact" | "usd" | "portion" | "max" | "rest";
  readonly value?: string;
  readonly bps?: number;
  /** The asset written with the amount ("10 HYPE"). */
  readonly symbol?: string;
  readonly role?: Role;
  readonly span: Span;
  readonly indexes: readonly number[];
  readonly num?: TokOf<"num">;
  readonly assetTok?: TokOf<"asset">;
}

const QTY_BPS: Readonly<Record<QtyWord, number>> = Object.freeze({ half: 5_000, quarter: 2_500, third: 3_333, all: 10_000, rest: 0 });

/**
 * Amount groups in a clause: "10 HYPE", "$200", "200 USDC", "half my HYPE",
 * "50% of USDC", "all", "%3" (percent numbers that are not portions are
 * left for the trade readers: callers pass `percentAsPortion`).
 */
export function amountsOf(bag: Bag, options: { readonly percentAsPortion: boolean }): AmountItem[] {
  const out: AmountItem[] = [];
  bag.toks.forEach((tok, index) => {
    if (bag.isUsed(index)) return;
    if (tok.k === "num") {
      if (tok.pct && !options.percentAsPortion) return;
      if (tok.ambiguous) return;
      const immediate = bag.at(index + 1);
      const next = immediate && immediate.k === "usd" ? { tok: immediate, index: index + 1 } : bag.nextAfter(index);
      let usd = tok.usd === true || (next?.tok.k === "usd");
      const indexes = [index];
      let assetTok: TokOf<"asset"> | undefined;
      if (next?.tok.k === "usd") indexes.push(next.index);
      const worth = next?.tok.k === "usd" && next.tok.worth === true;
      const after = next?.tok.k === "usd" ? bag.nextAfter(next.index) : next;
      // "5% of HYPE", "10 HYPE", "200 USDC"
      const ofSkip = after && after.tok.k === "prep" && after.tok.role === "of" ? bag.nextAfter(after.index) : after;
      let marketCoin: string | undefined;
      if (ofSkip && ofSkip.tok.k === "asset" && !bag.isUsed(ofSkip.index) && !usd && ofSkip.tok.role !== "to" && ofSkip.tok.role !== "on" && (tok.pct ? true : ofSkip === after)) {
        assetTok = ofSkip.tok;
        indexes.push(ofSkip.index);
      } else if (after && after.tok.k === "market" && !usd && !tok.pct && !bag.isUsed(after.index) && after.tok.role !== "on") {
        // "0.5 ETH": a perp coin written after the number is the size unit.
        marketCoin = after.tok.coin;
        indexes.push(after.index);
      }
      if (tok.pct) {
        const bps = Math.round(Number(tok.value) * 100);
        out.push({ kind: "portion", bps, ...(assetTok ? { symbol: assetTok.symbol, assetTok } : {}), role: tok.role ?? assetTok?.role, span: tok.span, indexes, num: tok });
        return;
      }
      if (usd) usd = true;
      out.push({
        kind: usd ? "usd" : "exact",
        value: tok.value,
        ...(assetTok ? { symbol: assetTok.symbol, assetTok } : marketCoin ? { symbol: marketCoin } : {}),
        role: tok.role ?? (worth ? "worth" : assetTok?.role),
        span: assetTok ? [tok.span[0], assetTok.span[1]] : tok.span,
        indexes,
        num: tok,
      });
      return;
    }
    if (tok.k === "qty") {
      const indexes = [index];
      let assetTok: TokOf<"asset"> | undefined;
      const next = bag.nextAfter(index);
      const skip = next && next.tok.k === "prep" && next.tok.role === "of" ? bag.nextAfter(next.index) : next;
      if (skip && skip.tok.k === "asset" && !bag.isUsed(skip.index) && skip.tok.role !== "to" && skip.tok.role !== "on") {
        assetTok = skip.tok;
        indexes.push(skip.index);
      } else {
        // Turkish "HYPE'ın yarısını": the genitive asset before the portion.
        const prev = bag.prevBefore(index);
        if (prev && prev.tok.k === "asset" && (prev.tok.role === "gen" || prev.tok.role === "obj") && !bag.isUsed(prev.index)) {
          assetTok = prev.tok;
          indexes.push(prev.index);
        }
      }
      const kind = tok.q === "all" ? "max" : tok.q === "rest" ? "rest" : "portion";
      out.push({ kind, ...(kind === "portion" ? { bps: QTY_BPS[tok.q] } : {}), ...(assetTok ? { symbol: assetTok.symbol, assetTok } : {}), role: tok.role ?? assetTok?.role, span: tok.span, indexes });
    }
  });
  return out;
}

export function useAll(bag: Bag, indexes: readonly number[]): void {
  for (const index of indexes) bag.use(index);
}

export function amountSel(item: AmountItem): AmountSel | null {
  switch (item.kind) {
    case "exact":
      return { t: "exact", value: item.value as string };
    case "usd":
      return { t: "usd", value: item.value as string };
    case "portion":
      return item.bps === 10_000 ? { t: "max" } : { t: "portion", bps: item.bps as number };
    case "max":
      return { t: "max" };
    case "rest":
      return null;
  }
}

/* --------------------------------------------------------------- places */

export function networkKey(environment: NetworkEnvironment, family: "elysium" | "hyperevm" | "hypercore"): NetworkKey {
  return layersFor(environment)[family].key;
}

export function familyOf(network: NetworkKey): "elysium" | "hyperevm" | "hypercore" {
  return network.startsWith("elysium") ? "elysium" : network.startsWith("hyperevm") ? "hyperevm" : "hypercore";
}

export const NETWORK_LABEL: Readonly<Record<"elysium" | "hyperevm" | "hypercore", string>> = Object.freeze({ elysium: "Elysium", hyperevm: "HyperEVM", hypercore: "HyperCore" });

/** Venue tokens and asset tokens that name a venue after "on"/'da ("on kalos", "PerpMe'de"). */
export function venueOf(bag: Bag): { venue: VenueWord; index: number } | null {
  const named = bag.find("venue");
  if (named) {
    bag.use(named.index);
    return { venue: venueById(named.tok.id) as VenueWord, index: named.index };
  }
  const asVenue = bag.find("asset", (tok) => tok.role === "on" && venueByAssetName(tok.symbol) !== null);
  if (asVenue) {
    bag.use(asVenue.index);
    return { venue: venueByAssetName(asVenue.tok.symbol) as VenueWord, index: asVenue.index };
  }
  return null;
}

function venueByAssetName(symbol: string): VenueWord | null {
  const lowered = symbol.toLowerCase();
  if (lowered === "kalos") return venueById("kalos-v3");
  if (lowered === "perpme") return venueById("perpme");
  return null;
}

export function venueWarning(ctx: FrameCtx, venue: VenueWord, at?: Span): void {
  if (venue.mainnetOnly && ctx.environment === "testnet") {
    ctx.clar.warn("VENUE_MAINNET_ONLY", t(`${venue.label} is announced for Elysium mainnet; it has no testnet deployment.`, `${venue.label} Elysium mainnet için duyuruldu; testnet'te yok.`), at);
  } else if (!venue.engine) {
    ctx.clar.warn("VENUE_NOT_EXECUTABLE", t(`Elyia reads ${venue.label} but cannot execute through it yet; the plan will say so.`, `Elyia ${venue.label} adını okuyor ama henüz onun üzerinden işlem yapamıyor; plan bunu belirtecek.`), at);
  }
}

export const NETWORK_OPTIONS = (environment: NetworkEnvironment, families: readonly ("elysium" | "hyperevm" | "hypercore")[], recommended?: string) =>
  families.map((family) => ({ id: family, en: NETWORK_LABEL[family], tr: NETWORK_LABEL[family], ...(recommended === family ? { recommended: true } : {}), detail: t(networkKey(environment, family), networkKey(environment, family)) }));

/** Parses a typed amount answer ("25", "1,5" in Turkish). */
export function parseAmountAnswer(text: string, locale: Locale, readNumber: (raw: string, locale: Locale) => { value: string; ambiguous?: readonly [string, string] } | null): string | null {
  const cleaned = text.replace(/^\$/u, "").replace(/\s*(usd|usdc|dolar|\$)$/iu, "").trim();
  const read = readNumber(cleaned, locale);
  if (!read || read.ambiguous || /^0(?:\.0+)?$/u.test(read.value)) return null;
  return read.value;
}
