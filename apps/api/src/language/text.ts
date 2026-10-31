/**
 * Segmentation and folding. The reader never rewrites the person's text:
 * every segment keeps its UTF-16 offsets into the original string, so chips
 * and warnings can point at exactly what was typed.
 *
 * Segments are whitespace-separated words, with punctuation that matters
 * split off (`,` `;` `.` `?` `!` and comparison operators). A comma or a dot
 * between digits stays inside the number ("1,500", "0.05%"); a dot at the
 * end of a word ends the sentence.
 */

export type Span = readonly [number, number];

export interface Segment {
  /** Exactly `text.slice(start, end)`. */
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  /** Set for punctuation and operator segments. */
  readonly punct?: "," | ";" | "." | "?" | "!" | ">" | "<" | ">=" | "<=" | "=" | "->";
}

const APOSTROPHES = /[’‘`´ʼ]/gu;

/** Apostrophe variants unified (same length, so offsets survive). */
export function unifyApostrophes(text: string): string {
  return text.replace(APOSTROPHES, "'");
}

/**
 * Lower case without locale surprises: "İ" -> "i" and "I" -> "i" (a Turkish
 * dotless "ı" typed as such stays "ı"), so tickers like "LINK" and Turkish
 * words fold the same way whatever the device locale is.
 */
export function lower(text: string): string {
  return text.replace(/İ/gu, "i").replace(/I/gu, "i").toLowerCase();
}

const FOLD: Readonly<Record<string, string>> = Object.freeze({
  ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u", â: "a", î: "i", û: "u", é: "e",
});

/** ASCII fold of a lower-cased word ("köprüle" -> "kopru le", "aç" -> "ac"): lexicon keys are folded so missing Turkish letters still match. */
export function fold(text: string): string {
  let out = "";
  for (const char of lower(text)) out += FOLD[char] ?? char;
  return out;
}

const OPERATOR = /^(?:>=|<=|=>|->|→|➡|>|<|=)/u;
const PUNCT = new Set([",", ";", "?", "!", "(", ")", "[", "]", '"', "“", "”", "«", "»"]);

function operatorPunct(op: string): Segment["punct"] {
  if (op === ">=" || op === "<=" || op === ">" || op === "<" || op === "=") return op;
  return "->";
}

/** True for a character that may sit inside a word segment. */
function wordChar(text: string, index: number): boolean {
  const char = text[index] as string;
  if (/\s/u.test(char)) return false;
  if (OPERATOR.test(text.slice(index))) {
    // "-" alone is a sign ("-3%"), only "->" is an arrow.
    return false;
  }
  if (char === ",") return /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "");
  return !PUNCT.has(char);
}

/** Splits text into word, punctuation and operator segments with offsets. */
export function segment(input: string): Segment[] {
  const text = unifyApostrophes(input);
  const out: Segment[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    const op = OPERATOR.exec(text.slice(index));
    if (op) {
      const value = op[0];
      out.push({ raw: input.slice(index, index + value.length), start: index, end: index + value.length, punct: operatorPunct(value) });
      index += value.length;
      continue;
    }
    if (PUNCT.has(char) || char === ",") {
      if (char === "," || char === ";" || char === "?" || char === "!") out.push({ raw: char, start: index, end: index + 1, punct: char });
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && wordChar(text, end)) end += 1;
    if (end === index) {
      index += 1;
      continue;
    }
    // A trailing dot (or several) ends the sentence unless the word is only dots.
    let wordEnd = end;
    while (wordEnd > index + 1 && text[wordEnd - 1] === ".") wordEnd -= 1;
    // A trailing apostrophe is just punctuation.
    while (wordEnd > index + 1 && text[wordEnd - 1] === "'") wordEnd -= 1;
    out.push({ raw: input.slice(index, wordEnd), start: index, end: wordEnd });
    if (wordEnd < end && text.slice(wordEnd, end).includes(".")) out.push({ raw: ".", start: wordEnd, end: wordEnd + 1, punct: "." });
    index = end;
  }
  return out;
}

/** The apostrophe split of a word: "ETH'de" -> ["ETH", "de"]; null without an apostrophe. */
export function splitApostrophe(raw: string): { readonly base: string; readonly suffix: string } | null {
  const text = unifyApostrophes(raw);
  const at = text.indexOf("'");
  if (at <= 0 || at === text.length - 1) return null;
  return { base: raw.slice(0, at), suffix: raw.slice(at + 1) };
}
