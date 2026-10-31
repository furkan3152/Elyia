/**
 * Text -> typed tokens. Longest phrase first over folded words; numbers,
 * leverage, percents, durations, clock times, addresses, .ely names and
 * explicit markets are read by shape; Turkish case suffixes become roles;
 * English prepositions give the next entity its role. Anything else is an
 * `unknown` token (its clause is not read).
 */
import type { NetworkEnvironment } from "@elyia/core";
import { assetVocabulary, STABLE_CLASS_WORDS, type AssetWord, type MarketFact } from "./entities.js";
import { candidates } from "./fuzzy.js";
import { isEnglishWord, isTurkishWord, lookup, maxPhraseWords, type Template } from "./lexicon.js";
import { isNumberWord, numberFromWords, readNumber, type Locale } from "./numbers.js";
import { fold, lower, segment, splitApostrophe, type Segment } from "./text.js";
import { stemSplits, suffixRole, TURKISH_LETTERS, TURKISH_LIKELY } from "./turkish.js";
import type { Role, Span, Tok } from "./types.js";

export interface LexOptions {
  readonly locale?: Locale;
  readonly environment: NetworkEnvironment;
  readonly markets: readonly MarketFact[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const ELY_NAME = /^[a-z0-9][a-z0-9-]{0,62}\.ely$/u;
const LEVERAGE = /^(?:(\d+(?:[.,]\d+)?)x|x(\d+(?:[.,]\d+)?))$/u;
const PERCENT = /^([+-]?)(?:%(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)%)$/u;
const USD = /^([+-]?)(?:\$(\d[\d.,]*(?:k|m|mn|b|bn)?)|(\d[\d.,]*(?:k|m|mn|b|bn)?)\$)$/u;
const DURATION = /^(\d+(?:\.\d+)?)(m|min|mins|h|hr|hrs|d|dk|sa)$/u;
const CLOCK = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/u;
const MARKET = /^([a-z][a-z0-9]{0,11}):([a-z0-9]{1,16})$|^([a-z0-9]{1,16})-(perp|perps|usd|usdc)$|^([a-z0-9]{1,16})\/(usdc|usdh|usdt0|usdt)$|^@(\d{1,5})$/iu;
const NUMBERISH = /^[+-]?\d/u;

const DURATION_WORDS: Readonly<Record<string, number>> = Object.freeze({
  minute: 1, minutes: 1, min: 1, mins: 1, m: 1, dakika: 1, dk: 1, dakikada: 1, dakikalik: 1,
  hour: 60, hours: 60, hr: 60, hrs: 60, h: 60, saat: 60, saatte: 60, saatlik: 60,
  day: 1_440, days: 1_440, d: 1_440, gun: 1_440, gunde: 1_440, gunluk: 1_440,
  week: 10_080, weeks: 10_080, hafta: 10_080, haftada: 10_080,
});
const TIMES_WORDS = new Set(["times", "time", "runs", "run", "kez", "defa", "kere", "sefer"]);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const WEEKDAYS: Readonly<Record<string, number>> = Object.freeze({
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6,
});

interface Word {
  readonly seg: Segment;
  /** Folded text of the whole segment. */
  readonly folded: string;
  /** Folded base before an apostrophe (or the whole word). */
  readonly base: string;
  readonly rawBase: string;
  /** Role of the apostrophe suffix: undefined = no apostrophe, null = roleless suffix. */
  readonly suffix?: Role | null;
  readonly badSuffix?: true;
}

function toWord(seg: Segment): Word {
  const split = seg.punct ? null : splitApostrophe(seg.raw);
  if (!split) return { seg, folded: fold(seg.raw), base: fold(seg.raw), rawBase: seg.raw };
  // English contractions and possessives ("what's", "don't", "ETH's") are not Turkish suffixes.
  if (/^(?:s|t|re|ll|d|ve|m)$/iu.test(split.suffix)) {
    const whole = fold(seg.raw);
    return { seg, folded: whole, base: lookup(whole, "en") ? whole : fold(split.base), rawBase: lookup(whole, "en") ? seg.raw : split.base, ...(lookup(whole, "en") ? {} : { suffix: null }) };
  }
  const role = suffixRole(fold(split.suffix));
  return {
    seg,
    folded: fold(seg.raw),
    base: fold(split.base),
    rawBase: split.base,
    ...(role === undefined ? { badSuffix: true as const } : { suffix: role }),
  };
}

/** Detects Turkish from letters, suffixes and words; English otherwise. */
export function detectLocale(text: string): Locale {
  const words = segment(text).filter((seg) => !seg.punct);
  let tr = TURKISH_LETTERS.test(text) ? 3 : TURKISH_LIKELY.test(text) ? 1 : 0;
  let en = 0;
  for (const seg of words) {
    const split = splitApostrophe(seg.raw);
    if (split && suffixRole(fold(split.suffix)) !== undefined && !/^(?:s|t|re|ll|d|ve|m)$/iu.test(split.suffix)) tr += 2;
    const folded = fold(seg.raw);
    if (isTurkishWord(folded)) tr += 1;
    else if (isEnglishWord(folded)) en += 1;
  }
  return tr > en ? "tr" : "en";
}

function span(a: Segment, b: Segment = a): Span {
  return [a.start, b.end];
}

function withSpan(template: Template, at: Span): Tok {
  return { ...template, span: at } as Tok;
}

function minutesOf(value: number, unit: string): number | null {
  const per = DURATION_WORDS[unit];
  if (per === undefined) return null;
  const minutes = value * per;
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

export class Lexer {
  private readonly assets: ReadonlyMap<string, AssetWord>;
  private readonly marketBases: ReadonlyMap<string, MarketFact[]>;

  constructor(private readonly options: LexOptions) {
    this.assets = assetVocabulary(options.environment);
    const bases = new Map<string, MarketFact[]>();
    for (const market of options.markets) {
      const key = market.coin.toLowerCase();
      bases.set(key, [...(bases.get(key) ?? []), market]);
    }
    this.marketBases = bases;
  }

  lex(text: string, locale: Locale): Tok[] {
    const words = segment(text).map(toWord);
    const out: Tok[] = [];
    let index = 0;
    while (index < words.length) {
      const consumed = this.readAt(words, index, locale, out);
      index += Math.max(1, consumed);
    }
    return assignRoles(fundingPeriods(out), locale);
  }

  /** Reads tokens starting at words[index]; returns how many words were consumed. */
  private readAt(words: readonly Word[], index: number, locale: Locale, out: Tok[]): number {
    const word = words[index] as Word;
    const seg = word.seg;
    if (seg.punct) {
      if (seg.punct === ">" || seg.punct === "<" || seg.punct === ">=" || seg.punct === "<=" || seg.punct === "=") {
        out.push(withSpan(lookup(seg.punct, "en") as Template, span(seg)));
      } else if (seg.punct === "->") {
        out.push({ k: "prep", role: "to", span: span(seg) });
      } else {
        out.push({ k: "punct", p: seg.punct, span: span(seg) });
      }
      return 1;
    }
    const shaped = this.readShape(words, index, locale);
    if (shaped) {
      out.push(...shaped.tokens);
      return shaped.consumed;
    }
    // Longest phrase first (apostrophe words only alone, by their base).
    for (let size = Math.min(maxPhraseWords(), words.length - index); size >= 1; size -= 1) {
      const slice = words.slice(index, index + size);
      if (slice.some((entry) => entry.seg.punct)) continue;
      if (size > 1 && slice.slice(0, -1).some((entry) => entry.suffix !== undefined || entry.badSuffix)) continue;
      const last = slice[slice.length - 1] as Word;
      const phrase = slice.map((entry, at) => (at === slice.length - 1 ? entry.base : entry.folded)).join(" ");
      const lowered = slice.map((entry, at) => (at === slice.length - 1 ? lower(entry.rawBase) : lower(entry.seg.raw))).join(" ");
      const at = span((slice[0] as Word).seg, last.seg);
      const entity = this.entity(lowered, phrase, at);
      const template = entity ? null : lookup(phrase, locale);
      if (!entity && !template) continue;
      if (last.badSuffix) {
        out.push({ k: "unknown", raw: words.slice(index, index + size).map((entry) => entry.seg.raw).join(" "), span: at });
        return size;
      }
      const token = entity ?? withSpan(template as Template, at);
      out.push(last.suffix ? withRole(token, last.suffix) : token);
      return size;
    }
    // Turkish suffix glued to a known name ("elysiuma", "hypeı").
    if (locale === "tr" && word.suffix === undefined) {
      for (const split of stemSplits(word.folded)) {
        const entity = this.entity(lower(seg.raw).slice(0, split.stem.length), split.stem, span(seg));
        if (entity && entity.k !== "unknown") {
          out.push(split.role ? withRole(entity, split.role) : entity);
          return 1;
        }
        const template = lookup(split.stem, locale);
        if (template && (template.k === "scope" || template.k === "metric" || template.k === "query" || template.k === "levword" || template.k === "account")) {
          out.push(withSpan(template, span(seg)));
          return 1;
        }
      }
    }
    out.push(this.unknown(word, locale));
    return 1;
  }

  private unknown(word: Word, locale: Locale): Tok {
    const at = span(word.seg);
    // An asset typo is offered as a question; anything else stays unknown.
    if (/^[a-z][a-z0-9]{3,9}$/u.test(word.base) && lookup(word.base, locale) === null) {
      const near = candidates(word.base, [...this.assets.keys()].filter((key) => !key.includes(" ")));
      if (near.length === 1) {
        const asset = this.assets.get(near[0] as string) as AssetWord;
        const token: Tok = { k: "asset", symbol: asset.symbol, listed: asset.listed, typo: word.seg.raw, span: at };
        return word.suffix ? withRole(token, word.suffix) : token;
      }
    }
    return { k: "unknown", raw: word.seg.raw, span: at };
  }

  /** Assets, markets and classes by name. */
  private entity(lowered: string, folded: string, at: Span): Tok | null {
    if (STABLE_CLASS_WORDS.includes(folded)) return { k: "asset", symbol: "*stable", listed: true, span: at };
    const asset = this.assets.get(lowered) ?? this.assets.get(folded);
    if (asset) {
      return { k: "asset", symbol: asset.symbol, listed: asset.listed, ...(asset.lookalike ? { lookalike: asset.lookalike } : {}), span: at };
    }
    if (!folded.includes(" ") && this.marketBases.has(folded) && lookup(folded, "en") === null && lookup(folded, "tr") === null) {
      const facts = this.marketBases.get(folded) as MarketFact[];
      return { k: "market", coin: (facts[0] as MarketFact).coin, span: at };
    }
    return null;
  }

  /** Shape-read tokens: addresses, names, numbers (+ unit words), percents, leverage, durations, clocks, markets. */
  private readShape(words: readonly Word[], index: number, locale: Locale): { tokens: Tok[]; consumed: number } | null {
    const word = words[index] as Word;
    const seg = word.seg;
    const raw = word.rawBase.trim();
    const role = word.suffix ?? undefined;
    const next = words[index + 1];
    const nextBase = next && !next.seg.punct ? next.base : "";
    const one = (token: Tok): { tokens: Tok[]; consumed: number } => ({ tokens: [role ? withRole(token, role) : token], consumed: 1 });

    if (ADDRESS.test(raw)) return one({ k: "addr", value: raw, span: span(seg) });
    const date = DATE.exec(raw);
    if (date) {
      const iso = `${date[1]}-${date[2]}-${date[3]}T00:00:00.000Z`;
      if (!Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString() === iso) return one({ k: "date", iso, span: span(seg) });
      return null;
    }
    if (ELY_NAME.test(lower(raw))) return one({ k: "name", value: lower(raw), span: span(seg) });
    const market = MARKET.exec(raw);
    if (market) {
      if (market[1] && market[2]) {
        if (lower(market[1]) === "hl" || lower(market[1]) === "http" || lower(market[1]) === "https") return null;
        return one({ k: "market", coin: market[2].toUpperCase(), dex: lower(market[1]), kind: "perp", span: span(seg) });
      }
      if (market[3]) return one({ k: "market", coin: this.coinCase(market[3]), kind: "perp", span: span(seg) });
      if (market[5]) return one({ k: "market", coin: this.coinCase(market[5]), kind: "spot", span: span(seg) });
      if (market[7]) return one({ k: "market", coin: `@${market[7]}`, kind: "spot", span: span(seg) });
    }
    const usd = USD.exec(raw);
    if (usd) {
      const read = readNumber((usd[2] ?? usd[3]) as string, locale, { allowMillions: true });
      if (read) return one({ k: "num", value: read.value, usd: true, ...(usd[1] === "-" ? { neg: true as const } : {}), ...flags(read), span: span(seg) });
      return null;
    }
    const pct = PERCENT.exec(raw);
    if (pct) {
      const read = readNumber((pct[2] ?? pct[3]) as string, locale);
      if (read) return one({ k: "num", value: read.value, pct: true, ...(pct[1] === "-" ? { neg: true as const } : {}), ...flags(read), span: span(seg) });
      return null;
    }
    const lev = LEVERAGE.exec(lower(raw));
    if (lev) {
      const typed = (lev[1] ?? lev[2]) as string;
      const value = Number(typed.replace(",", "."));
      return one(Number.isInteger(value) && value >= 1 ? { k: "lev", x: value, span: span(seg) } : { k: "lev", x: Math.max(1, Math.floor(value)), invalid: typed, span: span(seg) });
    }
    const dur = DURATION.exec(lower(raw));
    if (dur && !(dur[2] === "m" && next && this.isCurrencyWord(next))) {
      const minutes = minutesOf(Number(dur[1]), dur[2] === "sa" ? "saat" : (dur[2] as string));
      if (minutes) return one({ k: "dur", minutes, span: span(seg) });
    }
    const clock = CLOCK.exec(lower(raw));
    if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
      let hour = Number(clock[1]);
      const minute = Number(clock[2] ?? 0);
      if (clock[3] === "pm" && hour < 12) hour += 12;
      if (clock[3] === "am" && hour === 12) hour = 0;
      if (hour <= 23 && minute <= 59) {
        const tz = nextBase === "utc" || nextBase === "gmt" ? "UTC" : undefined;
        return { tokens: [{ k: "clock", hour, minute, ...(tz ? { tz } : {}), span: tz && next ? span(seg, next.seg) : span(seg) }], consumed: tz ? 2 : 1 };
      }
    }
    // "every day" / "every 4 hours" / "every monday" / "her gün" / "her 4 saatte bir" / "daily".
    const schedule = this.schedule(words, index, locale);
    if (schedule) return schedule;
    if (NUMBERISH.test(raw)) {
      const sign = raw.startsWith("-") ? "-" : "";
      const body = raw.replace(/^[+-]/u, "");
      const read = readNumber(body, locale, { allowMillions: Boolean(next && this.isCurrencyWord(next)) });
      if (!read) return null;
      const base: Tok = { k: "num", value: read.value, ...(sign ? { neg: true as const } : {}), ...flags(read), ...(/m(?:n)?$/u.test(body) ? { scaledMillions: true as const } : {}), span: span(seg) };
      return this.afterNumber(words, index, base, role, locale);
    }
    if (isNumberWord(word.base, locale) && !word.badSuffix) {
      const run: Word[] = [];
      for (let at = index; at < words.length; at += 1) {
        const entry = words[at] as Word;
        if (entry.seg.punct || !isNumberWord(entry.base, locale)) break;
        run.push(entry);
        if (entry.suffix !== undefined) break;
      }
      const value = numberFromWords(run.map((entry) => entry.base), locale);
      const last = run[run.length - 1] as Word;
      const after = words[index + run.length];
      // Turkish "bir" alone is an article unless an asset or a unit follows ("bir HYPE", "bir saat").
      const article = run.length === 1 && word.base === "bir";
      const unitAfter = Boolean(after && !after.seg.punct && (this.entity(lower(after.rawBase), after.base, span(after.seg)) || DURATION_WORDS[after.base] !== undefined));
      if (value !== null && (!article || unitAfter)) {
        const token: Tok & { k: "num" } = { k: "num", value: String(value), rewritten: true, span: span(seg, last.seg) };
        const read = this.afterNumber(words, index + run.length - 1, token, last.suffix ?? undefined, locale);
        return { tokens: read.tokens, consumed: run.length - 1 + read.consumed };
      }
    }
    return null;
  }

  /** A number and the unit words after it: "5 x" (leverage), "2 hours", "10 times", "30 days" (+ boyunca), "3 percent". */
  private afterNumber(words: readonly Word[], index: number, token: Tok & { k: "num" }, role: Role | undefined, locale: Locale): { tokens: Tok[]; consumed: number } {
    const next = words[index + 1];
    const value = Number(token.value);
    const withRoleIf = (tok: Tok): Tok => (role ? withRole(tok, role) : tok);
    if (next && !next.seg.punct && !token.usd) {
      const unit = next.base;
      // "90 bin", "90 binin altına", "2 thousand": a scale word after digits.
      const scale = /^(?:bin|thousand)/u.test(unit) ? ((): Role | null | undefined => (unit === "bin" || unit === "thousand" ? null : suffixRole(unit.slice(3))))() : undefined;
      if (scale !== undefined && Number.isFinite(value)) {
        const scaled: Tok = { ...token, value: String(value * 1_000), rewritten: true, span: span((words[index] as Word).seg, next.seg), ...(scale ? { role: scale } : {}) };
        return { tokens: [scaled], consumed: 2 };
      }
      const at = span((words[index] as Word).seg, next.seg);
      if (unit === "x" || (unit === "kat" && locale === "tr")) {
        const lev: Tok = Number.isInteger(value) && value >= 1 ? { k: "lev", x: value, span: at } : { k: "lev", x: Math.max(1, Math.floor(value)), invalid: token.value, span: at };
        return { tokens: [next.suffix ? withRole(lev, next.suffix) : lev], consumed: 2 };
      }
      if (unit === "times" && words[index + 2] && ["leverage", "lev"].includes((words[index + 2] as Word).base)) {
        return { tokens: [{ k: "lev", x: value, span: span((words[index] as Word).seg, (words[index + 2] as Word).seg) }], consumed: 3 };
      }
      if (TIMES_WORDS.has(unit) && Number.isInteger(value)) return { tokens: [{ k: "times", n: value, span: at }], consumed: 2 };
      if ((unit === "percent" || unit === "pct") && locale === "en") return { tokens: [withRoleIf({ ...token, pct: true, span: at })], consumed: 2 };
      const minutes = minutesOf(value, unit);
      if (minutes !== null && !(unit === "m" || unit === "d" || unit === "h")) {
        const following = words[index + 2];
        if ((unit.startsWith("day") || unit.startsWith("gun") || unit.startsWith("week") || unit.startsWith("hafta")) && following && following.base === "boyunca") {
          return { tokens: [{ k: "forDays", days: minutes / 1_440, span: span((words[index] as Word).seg, following.seg) }], consumed: 3 };
        }
        const durTok: Tok = { k: "dur", minutes, span: at };
        return { tokens: [next.suffix ? withRole(durTok, next.suffix) : durTok], consumed: following && following.base === "boyunca" ? 3 : 2 };
      }
    }
    return { tokens: [withRoleIf(token)], consumed: 1 };
  }

  private schedule(words: readonly Word[], index: number, locale: Locale): { tokens: Tok[]; consumed: number } | null {
    const word = words[index] as Word;
    const simple: Readonly<Record<string, number>> = locale === "tr"
      ? { gunluk: 86_400, saatlik: 3_600, haftalik: 604_800, "her gun": 86_400, "her saat": 3_600, "her hafta": 604_800, "her sabah": 86_400, "her aksam": 86_400, "gunde bir": 86_400, "her gun bir": 86_400 }
      : { daily: 86_400, hourly: 3_600, weekly: 604_800, "every day": 86_400, "each day": 86_400, "every hour": 3_600, "each hour": 3_600, "every week": 604_800, "each week": 604_800, "once a day": 86_400, "once a week": 604_800, "once an hour": 3_600, "every minute": 60, "a day": 86_400, "per day": 86_400, "a week": 604_800, "per week": 604_800 };
    for (const size of [3, 2, 1]) {
      const slice = words.slice(index, index + size);
      if (slice.length < size || slice.some((entry) => entry.seg.punct)) continue;
      const phrase = slice.map((entry) => entry.base).join(" ");
      const seconds = simple[phrase];
      if (seconds !== undefined) return { tokens: [{ k: "sched", seconds, span: span(word.seg, (slice[size - 1] as Word).seg) }], consumed: size };
    }
    const lead = locale === "tr" ? ["her"] : ["every", "each"];
    if (!lead.includes(word.base)) return null;
    const next = words[index + 1];
    if (!next || next.seg.punct) return null;
    const weekday = WEEKDAYS[next.base];
    if (weekday !== undefined) return { tokens: [{ k: "sched", seconds: 604_800, weekdays: [weekday], span: span(word.seg, next.seg) }], consumed: 2 };
    const count = readNumber(next.base, locale) ?? (isNumberWord(next.base, locale) ? { value: String(numberFromWords([next.base], locale) ?? "") } : null);
    const unitWord = words[index + 2];
    if (count && unitWord && !unitWord.seg.punct) {
      const minutes = minutesOf(Number(count.value), unitWord.base);
      if (minutes !== null) {
        const tail = words[index + 3];
        const consumed = tail && !tail.seg.punct && tail.base === "bir" ? 4 : 3;
        return { tokens: [{ k: "sched", seconds: minutes * 60, span: span(word.seg, (words[index + consumed - 1] as Word).seg) }], consumed };
      }
    }
    return null;
  }

  private isCurrencyWord(word: Word): boolean {
    if (word.seg.punct) return false;
    const asset = this.assets.get(lower(word.rawBase)) ?? this.assets.get(word.base);
    return Boolean(asset) || ["usd", "dollars", "dolar", "usdc", "bucks"].includes(word.base);
  }

  private coinCase(raw: string): string {
    const facts = this.marketBases.get(raw.toLowerCase());
    return facts ? (facts[0] as MarketFact).coin : raw.toUpperCase();
  }
}

function flags(read: { readonly rewritten?: true; readonly ambiguous?: readonly [string, string] }): { rewritten?: true; ambiguous?: readonly [string, string] } {
  return { ...(read.rewritten ? { rewritten: true as const } : {}), ...(read.ambiguous ? { ambiguous: read.ambiguous } : {}) };
}

const ROLE_HOLDERS = new Set(["num", "asset", "market", "network", "account", "venue", "addr", "name", "qty"]);

export function withRole(token: Tok, role: Role): Tok {
  return ROLE_HOLDERS.has(token.k) ? ({ ...token, role } as Tok) : token;
}

/**
 * English prepositions give their role to the entities right after them
 * ("to Elysium", "with 200 USDC" -> the number and the asset, "from my perps").
 * Noise and self words in between keep the role pending.
 */
/** "hourly funding" / "saatlik fonlama": an hourly word next to funding is the rate period, not a schedule. */
function fundingPeriods(tokens: readonly Tok[]): Tok[] {
  return tokens.map((tok, index) => {
    if (tok.k !== "sched" || tok.seconds !== 3_600) return tok;
    const near = [tokens[index - 1], tokens[index + 1]];
    return near.some((entry) => entry?.k === "metric" && entry.metric === "funding") ? ({ k: "period", period: "1h", span: tok.span } as Tok) : tok;
  });
}

function roleOf(token: Tok & { k: "prep" }): Role | null {
  const role = token.role;
  return role === "to" || role === "from" || role === "on" || role === "with" || role === "worth" ? role : null;
}

function assignRoles(tokens: readonly Tok[], locale: Locale): Tok[] {
  const out: Tok[] = [];
  let pending: Role | null = null;
  for (const token of tokens) {
    if (token.k === "prep") {
      const role = roleOf(token);
      if (locale === "tr") {
        // Turkish postpositions follow their noun ("200 USDC ile", "Kalos üzerinden"): the entities just before take the role.
        if (role) {
          for (let at = out.length - 1; at >= 0; at -= 1) {
            const prev = out[at] as Tok;
            if (!ROLE_HOLDERS.has(prev.k)) break;
            if (!("role" in prev) || prev.role === undefined) out[at] = withRole(prev, role);
          }
        }
        out.push(token);
        continue;
      }
      if (role === "worth") {
        // "100 USDC worth of HYPE": the amount before "worth" is what is paid.
        for (let at = out.length - 1; at >= 0; at -= 1) {
          const prev = out[at] as Tok;
          if (!ROLE_HOLDERS.has(prev.k)) break;
          if (!("role" in prev) || prev.role === undefined) out[at] = withRole(prev, role);
        }
        pending = null;
        out.push(token);
        continue;
      }
      pending = role;
      out.push(token);
      continue;
    }
    if (ROLE_HOLDERS.has(token.k)) {
      const hasRole = "role" in token && token.role !== undefined;
      out.push(pending && !hasRole ? withRole(token, pending) : token);
      // "with 200 USDC" / "with half my USDC": the asset after an amount shares its role.
      if (token.k !== "num" && token.k !== "qty") pending = null;
      continue;
    }
    if (token.k !== "noise" && token.k !== "self" && token.k !== "usd" && token.k !== "flag") pending = null;
    out.push(token);
  }
  return out;
}
