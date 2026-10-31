/**
 * The intent language layer: English and Turkish sentences -> typed goals
 * (core goals.ts), clarifying questions, live chips and a canonical sentence.
 *
 *   readIntent(text, opts)  the full reading (async: it may resolve .ely names)
 *   chipsFor(text)          fast chips for live typing (no facts, no questions)
 *   examplesFor(locale)     curated examples per category
 *
 * Deterministic and fail closed: an unknown word leaves the sentence unread,
 * a missing or ambiguous slot becomes a question, and nothing the person
 * did not say is filled in silently (assumptions are listed).
 */
import type { NetworkEnvironment } from "@elyia/core";
import { EXAMPLE_CATEGORIES, type ExampleCategory, type LanguageAnswer, type LanguageChip, type LanguageExamplesResponse, type LanguageLocale } from "@elyia/core/api/language";
import { LANGUAGE_SPEC } from "@elyia/core/api/language";
import type { AppContext } from "../context.js";
import { chipsOf } from "./chips.js";
import { staticMarkets } from "./entities.js";
import { resolveElyName } from "./facts.js";
import type { ReaderFacts } from "./frames/common.js";
import { detectLocale, Lexer } from "./lexer.js";
import { readText, type Reading } from "./reader.js";
import { mergeAnswers, ThreadSigner } from "./thread.js";

export interface ReadIntentOptions {
  readonly locale?: LanguageLocale;
  readonly environment?: NetworkEnvironment;
  readonly facts?: Partial<ReaderFacts>;
  readonly answers?: readonly LanguageAnswer[];
  /** Signed answers of earlier turns (verified with `signer`). */
  readonly thread?: string;
  readonly signer?: ThreadSigner;
  /** Resolves `name.ely` to an address (null: unregistered, undefined: unknown). */
  readonly resolveName?: (name: string) => Promise<string | null | undefined>;
  /** ms since epoch. */
  readonly now?: number;
  /** When given (the engine's text path), names resolve through Elysium Names and the mode picks the environment. */
  readonly ctx?: AppContext;
}

export interface ReadResult extends Reading {
  readonly thread: string | null;
}

const MAX_NAMES = 3;

/** Reads a sentence. Never throws for user input; the status says how it went. */
export async function readIntent(text: string, options: ReadIntentOptions = {}): Promise<ReadResult> {
  const now = options.now ?? options.ctx?.clock.now() ?? Date.now();
  const environment = options.environment ?? options.ctx?.config.mode ?? "testnet";
  const signer = options.signer ?? (options.ctx ? signerFor(options.ctx) : undefined);
  const earlier = options.thread && signer ? (signer.verify(options.thread, text, now) ?? []) : [];
  const answers = mergeAnswers(earlier, options.answers ?? []);
  const facts: Partial<ReaderFacts> = { ...options.facts, now: options.facts?.now ?? now };
  const base = { environment, answers, facts, ...(options.locale ? { locale: options.locale } : {}) };
  let reading = readText(text, base);
  const resolve = options.resolveName ?? (options.ctx ? (name: string) => resolveElyName(options.ctx as AppContext, environment, name) : undefined);
  if (resolve && reading.names.length > 0) {
    const resolved = new Map<string, string>();
    for (const name of reading.names.slice(0, MAX_NAMES)) {
      const address = await resolve(name);
      if (address) resolved.set(name, address);
      else if (address === null) resolved.set(`!${name}`, "");
    }
    reading = readText(text, { ...base, resolvedNames: resolved });
  }
  // Earlier answers that still match a question stay in the thread with this turn's.
  const kept = mergeAnswers(earlier.filter((answer) => reading.usedAnswers.some((used) => used.question === answer.question)), reading.usedAnswers);
  const thread = signer && reading.status === "needs_input" ? signer.sign(text, kept, now) : null;
  return { ...reading, thread };
}

const signers = new WeakMap<AppContext, ThreadSigner>();

export function signerFor(ctx: AppContext): ThreadSigner {
  let signer = signers.get(ctx);
  if (!signer) {
    signer = new ThreadSigner(ctx.config.sessionSecret);
    signers.set(ctx, signer);
  }
  return signer;
}

let chipLexer: Lexer | null = null;

/** Chips for live typing: lexing only, static market list, no questions. */
export function chipsFor(text: string, locale?: LanguageLocale): LanguageChip[] {
  chipLexer ??= new Lexer({ environment: "testnet", markets: staticMarkets() });
  const chosen = locale ?? detectLocale(text);
  return chipsOf(text, chipLexer.lex(text, chosen));
}

const EXAMPLES: Readonly<Record<LanguageLocale, Readonly<Record<ExampleCategory, readonly string[]>>>> = Object.freeze({
  en: {
    trade: ["long ETH 5x with 200 USDC margin", "short $1000 of BTC 3x isolated", "buy 100 HYPE spot limit 25", "twap buy 500 HYPE spot over 2h", "close my ETH long", "set ETH leverage to 10x"],
    protect: ["set sl 3% below entry on ETH long", "set tp 4000 sl 3200 on ETH", "reduce my BTC long by half", "close all positions", "cancel all orders"],
    value: ["bridge 20 HYPE to Elysium and swap half to USDC on kalos", "swap 10 HYPE to USDC on kalos", "move 100 USDC from hypercore spot to hypercore perps", "stake 100 HYPE with kinetiq", "lend 100 USDC on cheshire", "send 5 USDC to bona.ely"],
    automate: ["every day buy 10 HYPE spot, 30 times", "if HYPE drops below 60, buy $100 of HYPE spot", "if ETH funding > 0.05% per hour, close ETH short"],
    alert: ["alert me when ETH price above 4000", "notify me if HYPE drops below 60", "whenever BTC price below 90000 alert me"],
    query: ["what is the HYPE price?", "ETH funding", "show my positions", "what's my pnl", "is 0x13A130B336400409c956dF042C128238F1486ddD safe?"],
  },
  tr: {
    trade: ["ETH'de 5x long aç 200 USDC ile", "BTC'de 3x short aç 1000 dolarlık izole", "100 HYPE spot al 25'ten limit", "2 saatte 500 HYPE spot twap al", "ETH long pozisyonumu kapat", "ETH kaldıracını 10x yap"],
    protect: ["ETH long pozisyonuma girişten %3 aşağıda stop koy", "tüm pozisyonları kapat", "BTC long pozisyonumu yarıya azalt", "tüm emirleri iptal et"],
    value: ["20 HYPE'ı Elysium'a köprüle ve yarısını USDC'ye çevir", "10 HYPE'ı Kalos'ta USDC'ye çevir", "100 HYPE'ı Kinetiq'te stake et", "100 USDC'yi Cheshire'a yatır", "bona.ely'ye 5 USDC gönder"],
    automate: ["her gün 10 HYPE spot al, 30 kez", "HYPE 60'ın altına düşerse 100 USDC'lik HYPE spot al"],
    alert: ["ETH 4000'i geçerse haber ver", "HYPE 60'ın altına düşerse bana bildir"],
    query: ["HYPE fiyatı ne?", "ETH fonlama oranı ne?", "pozisyonlarımı göster", "bakiyem ne kadar?"],
  },
});

const TITLES: Readonly<Record<LanguageLocale, Readonly<Record<ExampleCategory, string>>>> = Object.freeze({
  en: { trade: "Trade", protect: "Protect", value: "Move value", automate: "Automate", alert: "Alerts", query: "Ask" },
  tr: { trade: "İşlem", protect: "Koruma", value: "Değer taşı", automate: "Otomasyon", alert: "Uyarılar", query: "Sor" },
});

const exampleCache = new Map<LanguageLocale, LanguageExamplesResponse>();

/** Curated examples with how each reads today (no facts: static markets, fixed clock). */
export function examplesFor(locale: LanguageLocale): LanguageExamplesResponse {
  const hit = exampleCache.get(locale);
  if (hit) return hit;
  const response: LanguageExamplesResponse = {
    spec: LANGUAGE_SPEC,
    locale,
    categories: EXAMPLE_CATEGORIES.map((id) => ({
      id,
      title: TITLES[locale][id],
      examples: EXAMPLES[locale][id].map((text) => {
        const reading = readText(text, { locale, facts: { now: Date.UTC(2026, 9, 31) } });
        return { text, canonical: reading.canonical, status: reading.status };
      }),
    })),
  };
  exampleCache.set(locale, response);
  return response;
}

export { readText, type Reading } from "./reader.js";
export type { ReaderFacts } from "./frames/common.js";
export type { MarketFact } from "./entities.js";
export { ThreadSigner } from "./thread.js";
