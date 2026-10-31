/**
 * Numbers as people type them, in English and Turkish.
 *
 * Every rewrite of what was typed ("5k" -> 5000, "1,5" -> 1.5) is reported
 * so it shows as a material chip. A separator that could be a decimal mark
 * or a thousands mark ("1,500" in Turkish, "1,5" in English, "1.500" in
 * Turkish) is never decided silently: the reader asks.
 */
export type Locale = "en" | "tr";

export interface NumberRead {
  /** Canonical decimal string ("5000", "1.5", "0.05"). */
  readonly value: string;
  /** Set when `value` differs from the digits typed ("5k", "1,5", "1,000"). */
  readonly rewritten?: true;
  /** Both readings when the separator is ambiguous ("1,500" -> ["1.5", "1500"]). */
  readonly ambiguous?: readonly [string, string];
}

const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,30})?$/u;

/** Leading zeros dropped and trailing fraction zeros removed; null when not a plain decimal. */
export function canonicalDecimal(text: string): string | null {
  let out = text.startsWith(".") ? `0${text}` : text;
  out = out.replace(/^0+(?=\d)/u, "");
  if (out.includes(".")) out = out.replace(/0+$/u, "").replace(/\.$/u, "");
  return DECIMAL.test(out) ? out : null;
}

/** `value * 10^exp` as a decimal string ("1.5", 3 -> "1500"). */
export function shiftDecimal(value: string, exp: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match || !Number.isInteger(exp) || Math.abs(exp) > 30) return null;
  let digits = `${match[1]}${match[2] ?? ""}`;
  let point = (match[1] as string).length + exp;
  if (point <= 0) {
    digits = `${"0".repeat(1 - point)}${digits}`;
    point = 1;
  }
  if (point > digits.length) digits = digits.padEnd(point, "0");
  return canonicalDecimal(`${digits.slice(0, point)}.${digits.slice(point)}`.replace(/\.$/u, ""));
}

const SCALES: Readonly<Record<string, number>> = Object.freeze({ k: 3, m: 6, mn: 6, b: 9, bn: 9 });

/**
 * One number as typed (no sign, no unit), or null. `scale` lets the caller
 * forbid "m" (minutes in "30m") or allow it (only with a currency).
 */
export function readNumber(raw: string, locale: Locale, options: { readonly allowMillions?: boolean } = {}): NumberRead | null {
  const text = raw.trim().toLowerCase();
  if (text.length === 0 || text.length > 40) return null;
  const scaled = /^(\d+(?:[.,]\d+)?)(k|m|mn|b|bn)$/u.exec(text);
  if (scaled) {
    const unit = scaled[2] as string;
    if (unit !== "k" && !options.allowMillions) return null;
    const base = readNumber(scaled[1] as string, locale);
    if (!base || base.ambiguous) return null;
    const value = shiftDecimal(base.value, SCALES[unit] as number);
    return value && value !== "0" ? { value, rewritten: true } : null;
  }
  if (/^\d+$/u.test(text) || /^\d*\.\d+$/u.test(text) || /^\d+\.\d+$/u.test(text)) {
    // A single dot: in Turkish "1.500" is fifteen hundred, in English one and a half.
    if (locale === "tr" && /^\d{1,3}\.\d{3}$/u.test(text)) {
      const asDecimal = canonicalDecimal(text);
      const asThousands = canonicalDecimal(text.replace(".", ""));
      return asDecimal && asThousands ? { value: asDecimal, ambiguous: [asDecimal, asThousands] } : null;
    }
    const value = canonicalDecimal(text);
    return value ? (value !== text ? { value, rewritten: true } : { value }) : null;
  }
  // "1,000" / "1,000,000.5" (English thousands) and "1.000.000,5" (Turkish thousands).
  if (/^\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?$/u.test(text) || /^\d{1,3}(?:,\d{3})+\.\d+$/u.test(text)) {
    const value = canonicalDecimal(text.replace(/,/gu, ""));
    return value ? { value, rewritten: true } : null;
  }
  if (/^\d{1,3}(?:\.\d{3}){2,}(?:,\d+)?$/u.test(text) || /^\d{1,3}(?:\.\d{3})+,\d+$/u.test(text)) {
    const value = canonicalDecimal(text.replace(/\./gu, "").replace(",", "."));
    return value ? { value, rewritten: true } : null;
  }
  const comma = /^(\d+),(\d+)$/u.exec(text);
  if (comma) {
    const whole = comma[1] as string;
    const fraction = comma[2] as string;
    const asDecimal = canonicalDecimal(`${whole}.${fraction}`);
    const asThousands = canonicalDecimal(`${whole}${fraction}`);
    if (!asDecimal || !asThousands) return null;
    const thousandsShape = fraction.length === 3 && whole.length <= 3;
    if (locale === "tr") {
      // Turkish decimal comma, unless it also looks like an English thousands group.
      return thousandsShape ? { value: asDecimal, ambiguous: [asDecimal, asThousands] } : { value: asDecimal, rewritten: true };
    }
    return thousandsShape ? { value: asThousands, rewritten: true } : { value: asDecimal, ambiguous: [asDecimal, asThousands] };
  }
  return null;
}

/* ------------------------------------------------------------ number words */

const EN_UNITS: Readonly<Record<string, number>> = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});
const EN_SCALES: Readonly<Record<string, number>> = Object.freeze({ hundred: 100, thousand: 1_000 });

/** Folded Turkish number words ("üç" -> "uc"). */
const TR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90,
});
const TR_SCALES: Readonly<Record<string, number>> = Object.freeze({ yuz: 100, bin: 1_000 });

/** True when the folded word is a number word of the locale. */
export function isNumberWord(word: string, locale: Locale): boolean {
  return locale === "tr" ? word in TR_UNITS || word in TR_SCALES : word in EN_UNITS || word in EN_SCALES || word === "a";
}

/**
 * The value of a run of folded number words ("two hundred", "iki yüz",
 * "bin beş yüz"), or null when they do not form one number. English "a"
 * counts only before a scale ("a hundred").
 */
export function numberFromWords(words: readonly string[], locale: Locale): number | null {
  if (words.length === 0) return null;
  const units = locale === "tr" ? TR_UNITS : EN_UNITS;
  const scales = locale === "tr" ? TR_SCALES : EN_SCALES;
  let total = 0;
  let current = 0;
  let seen = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (locale === "en" && word === "a") {
      if (index !== 0 || !(words[1] && words[1] in scales)) return null;
      current = 1;
      continue;
    }
    if (word in units) {
      current += units[word] as number;
      seen = true;
    } else if (word in scales) {
      const scale = scales[word] as number;
      if (scale === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * scale;
        current = 0;
      }
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}
