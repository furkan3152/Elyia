/**
 * Token and reading types of the language reader. Tokens carry the UTF-16
 * span of what was typed; entity tokens carry the role their English
 * preposition or Turkish case suffix gave them.
 */
import type { ConditionMetric, ConditionOp, NetworkFamily, QueryKind } from "@elyia/core";
import type { Locale } from "./numbers.js";

export type Span = readonly [number, number];

/**
 * to: "to X", "into X", Turkish dative ('a/'e/'ya/'ye);
 * from: "from X", ablative ('dan/'den);
 * on: "on/in/at/via X", locative ('da/'de);
 * with: "with/using X", instrumental (ile, 'la/'le);
 * worth: "$X of", "X worth", Turkish -lık/-lik;
 * obj: Turkish accusative ('ı/'i/'u/'ü) - the thing acted on;
 * gen: Turkish genitive ('ın/'in) - "60'ın altına".
 */
export type Role = "to" | "from" | "on" | "with" | "worth" | "obj" | "gen";

export const VERBS = Object.freeze([
  "swap", "buy", "sell", "bridge", "move", "send", "stake", "unstake", "wrap", "unwrap", "lend", "withdraw", "borrow", "repay",
  "long", "short", "open", "close", "reduce", "flatten", "cancel", "twap", "set", "protect", "alert", "show", "deposit",
] as const);
export type Verb = (typeof VERBS)[number];

export type QtyWord = "half" | "all" | "quarter" | "third" | "rest";

export type Tok =
  | { readonly k: "verb"; readonly verb: Verb; readonly span: Span; readonly chain?: true; readonly typo?: string }
  | { readonly k: "num"; readonly value: string; readonly span: Span; readonly usd?: true; readonly pct?: true; readonly neg?: true; readonly rewritten?: true; readonly ambiguous?: readonly [string, string]; readonly role?: Role; readonly scaledMillions?: true }
  | { readonly k: "asset"; readonly symbol: string; readonly span: Span; readonly role?: Role; readonly listed: boolean; readonly typo?: string; readonly lookalike?: string }
  | { readonly k: "market"; readonly coin: string; readonly kind?: "perp" | "spot"; readonly dex?: string; readonly span: Span; readonly role?: Role }
  | { readonly k: "network"; readonly family: NetworkFamily | "hyperliquid"; readonly span: Span; readonly role?: Role }
  | { readonly k: "account"; readonly cls: "spot" | "perp"; readonly span: Span; readonly role?: Role }
  | { readonly k: "venue"; readonly id: string; readonly span: Span; readonly role?: Role }
  | { readonly k: "side"; readonly side: "long" | "short"; readonly span: Span }
  | { readonly k: "lev"; readonly x: number | "max"; readonly span: Span; readonly invalid?: string }
  | { readonly k: "levword"; readonly span: Span }
  | { readonly k: "margin"; readonly mode: "cross" | "isolated"; readonly span: Span }
  | { readonly k: "order"; readonly t: "market" | "limit" | "alo" | "ioc" | "gtc" | "reduceOnly"; readonly span: Span }
  | { readonly k: "tpsl"; readonly kind: "tp" | "sl"; readonly span: Span }
  | { readonly k: "dur"; readonly minutes: number; readonly span: Span }
  | { readonly k: "sched"; readonly seconds: number; readonly span: Span; readonly weekdays?: readonly number[] }
  | { readonly k: "clock"; readonly hour: number; readonly minute: number; readonly span: Span; readonly tz?: string }
  | { readonly k: "times"; readonly n: number; readonly span: Span }
  | { readonly k: "forDays"; readonly days: number; readonly span: Span }
  | { readonly k: "cond"; readonly span: Span; readonly repeat?: true }
  | { readonly k: "cmp"; readonly op: ConditionOp | "=" | "neg" | "pos"; readonly span: Span; readonly ends?: true }
  | { readonly k: "condEnd"; readonly span: Span; readonly op?: ConditionOp | "=" }
  | { readonly k: "metric"; readonly metric: ConditionMetric; readonly span: Span }
  | { readonly k: "period"; readonly period: "1h" | "8h" | "apr"; readonly span: Span }
  | { readonly k: "prep"; readonly role: Role | "at" | "by" | "of" | "per" | "over"; readonly span: Span }
  | { readonly k: "qty"; readonly q: QtyWord; readonly span: Span; readonly role?: Role }
  | { readonly k: "scope"; readonly what: "positions" | "position" | "orders" | "everything"; readonly span: Span }
  | { readonly k: "query"; readonly what?: QueryKind; readonly span: Span }
  | { readonly k: "addr"; readonly value: string; readonly span: Span; readonly role?: Role }
  | { readonly k: "name"; readonly value: string; readonly span: Span; readonly role?: Role }
  | { readonly k: "conn"; readonly c: "then" | "and"; readonly span: Span }
  | { readonly k: "punct"; readonly p: string; readonly span: Span }
  | { readonly k: "self"; readonly span: Span }
  | { readonly k: "usd"; readonly span: Span; readonly worth?: true }
  | { readonly k: "pctword"; readonly span: Span }
  | { readonly k: "noise"; readonly span: Span }
  | { readonly k: "neg"; readonly span: Span }
  | { readonly k: "flag"; readonly flag: "native" | "mirror" | "canonical" | "random" | "breakeven" | "entry" | "mark" | "notional" | "margin" | "perpword" | "spotword" | "cap" | "telegram" | "web" | "slippage" | "signEach"; readonly span: Span }
  | { readonly k: "date"; readonly iso: string; readonly span: Span }
  | { readonly k: "until"; readonly span: Span }
  | { readonly k: "unknown"; readonly raw: string; readonly span: Span };

export type TokKind = Tok["k"];
export type TokOf<K extends TokKind> = Extract<Tok, { k: K }>;

export interface LexResult {
  readonly tokens: readonly Tok[];
  readonly locale: Locale;
}
